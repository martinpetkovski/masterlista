# extract-service-links.ps1
# Reads all artists from bands.json and extracts additional streaming service links
# Uses the Songlink/Odesli API to find links across platforms

# Add System.Web for URL encoding
Add-Type -AssemblyName System.Web

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$bandsJsonPath = Join-Path $scriptPath "bands.json"

# Mapping from Songlink platform names to our JSON keys (matching bands.json structure)
$platformMapping = @{
    "spotify"      = "spotify"
    "appleMusic"   = "itunes"        # bands.json uses 'itunes' for Apple Music
    "youtubeMusic" = "youtube_music"
    "youtube"      = "youtube"
    "amazonMusic"  = "amazon_music"
    "deezer"       = "deezer"
    "tidal"        = "tidal"
    "soundcloud"   = "soundcloud"
    "napster"      = "napster"
    "audiomack"    = "audiomack"
}

# Services we want to add (matching bands.json keys)
$priorityServices = @("spotify", "itunes", "youtube_music", "youtube", "deezer", "tidal", "soundcloud")

function Get-SonglinkData {
    param([string]$url)
    
    $encodedUrl = [System.Web.HttpUtility]::UrlEncode($url)
    $apiUrl = "https://api.song.link/v1-alpha.1/links?url=$encodedUrl"
    
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
        return $response
    }
    catch {
        # Handle rate limiting - wait and retry once
        if ($_.Exception.Response.StatusCode -eq 429) {
            Start-Sleep -Seconds 5
            try {
                $response = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
                return $response
            }
            catch {
                return $null
            }
        }
        return $null
    }
}

function Normalize-ArtistName {
    param([string]$name)
    
    if (-not $name) { return "" }
    
    # Normalize for comparison: lowercase, remove diacritics, special chars
    $normalized = $name.ToLower().Trim()
    
    # Remove common suffixes/prefixes
    $normalized = $normalized -replace '\s*\(.*?\)\s*', ''  # Remove parentheses content
    $normalized = $normalized -replace '\s*\[.*?\]\s*', ''  # Remove brackets content
    $normalized = $normalized -replace "['\x60\x27\x22\u2019\u2018\u201C\u201D]", ''  # Remove quotes/apostrophes
    $normalized = $normalized -replace '[^\p{L}\p{N}\s]', '' # Keep only letters, numbers, spaces
    $normalized = $normalized -replace '\s+', ' '           # Normalize whitespace
    
    return $normalized.Trim()
}

function Test-ArtistMatch {
    param(
        [string]$expectedName,
        [string]$foundName
    )
    
    if (-not $expectedName -or -not $foundName) { return $false }
    
    $normalizedExpected = Normalize-ArtistName $expectedName
    $normalizedFound = Normalize-ArtistName $foundName
    
    # Exact match after normalization
    if ($normalizedExpected -eq $normalizedFound) { return $true }
    
    # One contains the other (for cases like Artist vs Artist Band)
    if ($normalizedExpected.Contains($normalizedFound) -or $normalizedFound.Contains($normalizedExpected)) {
        # Only if the shorter one is at least 3 chars
        $shorter = if ($normalizedExpected.Length -lt $normalizedFound.Length) { $normalizedExpected } else { $normalizedFound }
        if ($shorter.Length -ge 3) { return $true }
    }
    
    return $false
}

function Get-LinksFromSonglink {
    param(
        [string]$sourceUrl
    )
    
    $results = @{
        links = @{}
        artistName = $null
    }
    
    try {
        $songlinkData = Get-SonglinkData $sourceUrl
        
        if ($songlinkData) {
            # Try to get the artist name from the API response
            $foundArtistName = $null
            
            # The API returns entities with artistName
            if ($songlinkData.entitiesByUniqueId) {
                $entities = $songlinkData.entitiesByUniqueId.PSObject.Properties
                foreach ($entity in $entities) {
                    if ($entity.Value.artistName) {
                        $foundArtistName = $entity.Value.artistName
                        break
                    }
                }
            }
            
            $results.artistName = $foundArtistName
            
            # Always extract links - trust the source URL from bands.json
            if ($songlinkData.linksByPlatform) {
                $platforms = $songlinkData.linksByPlatform.PSObject.Properties
                foreach ($platform in $platforms) {
                    $songlinkName = $platform.Name
                    if ($platformMapping.ContainsKey($songlinkName)) {
                        $ourKey = $platformMapping[$songlinkName]
                        $url = $platform.Value.url
                        if ($url) {
                            $results.links[$ourKey] = $url
                        }
                    }
                }
            }
        }
    }
    catch {
        # Silently fail and return empty results
    }
    
    return $results
}

function Get-SourceLinkFromArtist {
    param($links)
    
    # Priority order for source links to use with Songlink API
    # Include 'itunes' which is how Apple Music is stored in bands.json
    $sourceOrder = @("spotify", "itunes", "deezer", "tidal", "youtube_music", "soundcloud")
    
    foreach ($source in $sourceOrder) {
        if ($links.PSObject.Properties.Name -contains $source -and $links.$source) {
            return $links.$source
        }
    }
    
    return $null
}

function Get-SpotifyTrackFromArtist {
    param([string]$spotifyUrl)
    
    # Extract artist ID from Spotify URL
    if ($spotifyUrl -match "artist[/:]([a-zA-Z0-9]+)") {
        $artistId = $matches[1]
        
        # Use Spotify's public embed API to get top tracks (no auth needed)
        $embedUrl = "https://open.spotify.com/embed/artist/$artistId"
        
        try {
            $headers = @{
                "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            $response = Invoke-WebRequest -Uri $embedUrl -Headers $headers -TimeoutSec 10 -UseBasicParsing
            
            # Try to find a track URL in the embed page
            if ($response.Content -match '"uri":"spotify:track:([a-zA-Z0-9]+)"') {
                return "https://open.spotify.com/track/$($matches[1])"
            }
        }
        catch {
            # Ignore errors
        }
    }
    
    return $null
}

function Convert-ToArtistUrl {
    param(
        [string]$url,
        [string]$platform
    )
    
    # Try to convert track/album URLs to artist URLs for various platforms
    switch ($platform) {
        "itunes" {
            # Apple Music: extract artist ID if possible
            if ($url -match "music\.apple\.com/[a-z]{2}/album/[^/]+/(\d+)") {
                # Album URL - we'd need to fetch it to get artist, just return as-is
                return $url
            }
            return $url
        }
        "deezer" {
            # Deezer track/album to artist
            if ($url -match "deezer\.com/[a-z]{2,}/?(track|album)/(\d+)") {
                # Would need API call, return as-is
                return $url
            }
            return $url
        }
        "tidal" {
            return $url
        }
        default {
            return $url
        }
    }
}

# Global variable to track if we need to save
$script:bandsData = $null
$script:updated = 0

function Save-Progress {
    param([bool]$isFinal = $false)
    
    if ($script:bandsData -and $script:updated -gt 0) {
        $prefix = if ($isFinal) { "" } else { "Interrupted! " }
        Write-Host ""
        Write-Host "${prefix}Saving progress..." -ForegroundColor Yellow
        
        # Create backup
        $backupPath = Join-Path $scriptPath "bands.json.backup"
        Copy-Item $bandsJsonPath $backupPath -Force
        Write-Host "Backup saved to bands.json.backup" -ForegroundColor Gray
        
        # Save updated data
        $script:bandsData | ConvertTo-Json -Depth 10 | Set-Content $bandsJsonPath -Encoding UTF8
        Write-Host "bands.json updated with $($script:updated) artist(s)!" -ForegroundColor Green
    }
}

function Main {
    Write-Host ""
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host "  EXTRACT SERVICE LINKS - Macedonian Music Database" -ForegroundColor Cyan
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host ""
    
    # Load bands.json
    if (-not (Test-Path $bandsJsonPath)) {
        Write-Host "Error: bands.json not found at $bandsJsonPath" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Loading bands.json..." -ForegroundColor Yellow
    $script:bandsData = Get-Content $bandsJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    
    $totalArtists = $script:bandsData.muzickaMasterLista.Count
    Write-Host "Found $totalArtists artists" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop (progress will be saved)" -ForegroundColor DarkGray
    Write-Host ""
    
    $script:updated = 0
    $skipped = 0
    $errors = 0
    $noSource = 0
    
    for ($i = 0; $i -lt $script:bandsData.muzickaMasterLista.Count; $i++) {
        $artist = $script:bandsData.muzickaMasterLista[$i]
        $artistName = $artist.name
        $progress = [math]::Round((($i + 1) / $totalArtists) * 100, 1)
        
        Write-Host "[$($i + 1)/$totalArtists] ($progress%) " -NoNewline -ForegroundColor Gray
        Write-Host "$artistName" -NoNewline -ForegroundColor White
        
        # Get a source link we can use
        $sourceLink = $null
        try {
            $sourceLink = Get-SourceLinkFromArtist $artist.links
        }
        catch {
            Write-Host " - Error reading links" -ForegroundColor Red
            $errors++
            continue
        }
        
        if (-not $sourceLink) {
            Write-Host " - No usable source link" -ForegroundColor DarkGray
            $noSource++
            continue
        }
        
        # Check if we already have most links
        $existingLinks = @()
        if ($artist.links) {
            try {
                $existingLinks = $artist.links.PSObject.Properties.Name
            }
            catch {
                $existingLinks = @()
            }
        }
        
        $missingPriority = $priorityServices | Where-Object { $_ -notin $existingLinks }
        
        if ($missingPriority.Count -eq 0) {
            Write-Host " - Already complete" -ForegroundColor DarkGreen
            $skipped++
            continue
        }
        
        Write-Host " - Fetching..." -NoNewline -ForegroundColor Yellow
        
        # Small delay to avoid rate limiting
        Start-Sleep -Milliseconds 800
        
        # If source is a Spotify artist URL, try to get a track URL first
        $urlToQuery = $sourceLink
        if ($sourceLink -match "open\.spotify\.com/artist/") {
            $trackUrl = Get-SpotifyTrackFromArtist $sourceLink
            if ($trackUrl) {
                $urlToQuery = $trackUrl
                Write-Host " (track)" -NoNewline -ForegroundColor DarkCyan
            }
        }
        
        try {
            $result = Get-LinksFromSonglink $urlToQuery
            
            $newLinks = $result.links
            
            if ($null -eq $newLinks -or $newLinks.Count -eq 0) {
                Write-Host " No additional links found" -ForegroundColor DarkGray
                $skipped++
                continue
            }
            
            # Add new links that don't already exist
            $addedCount = 0
            foreach ($service in $newLinks.Keys) {
                if ($service -notin $existingLinks) {
                    # Add the new property
                    $artist.links | Add-Member -NotePropertyName $service -NotePropertyValue $newLinks[$service] -Force
                    $addedCount++
                }
            }
            
            if ($addedCount -gt 0) {
                $matchInfo = if ($result.artistName) { " ($($result.artistName))" } else { "" }
                Write-Host " +$addedCount links$matchInfo" -ForegroundColor Green
                $script:updated++
            }
            else {
                Write-Host " No new links" -ForegroundColor DarkGray
                $skipped++
            }
        }
        catch {
            Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Red
            $errors++
        }
    }
    
    Write-Host ""
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host "  SUMMARY" -ForegroundColor Cyan
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Total artists:    $totalArtists" -ForegroundColor White
    Write-Host "  Updated:          $($script:updated)" -ForegroundColor Green
    Write-Host "  Skipped:          $skipped" -ForegroundColor Yellow
    Write-Host "  No source link:   $noSource" -ForegroundColor DarkGray
    Write-Host "  Errors:           $errors" -ForegroundColor Red
    Write-Host ""
    
    if ($script:updated -gt 0) {
        Save-Progress -isFinal $true
    }
    else {
        Write-Host "No changes to save." -ForegroundColor Yellow
    }
    
    Write-Host ""
}

# Register handler for Ctrl+C
try {
    [Console]::TreatControlCAsInput = $false
}
catch {
    # Ignore if not available
}

# Run main
Main
