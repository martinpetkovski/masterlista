# update-all.ps1
# Unified update script for Macedonian Music Master Lista
#
# Tasks:
#   1. Chart data - Fetches Spotify data and generates chart-data.json + weekly snapshots
#   2. Articles   - Fetches RSS feeds for today's articles, archives to articles.json
#   3. Service links - Detects new bands.json entries and extracts streaming links for them
#   4. Instagram  - Posts weekly top 10 chart as carousel to Instagram (Mondays only)
#
# Usage:
#   ./update-all.ps1               # Run all tasks
#   ./update-all.ps1 -SkipChart    # Skip chart generation
#   ./update-all.ps1 -SkipArticles # Skip RSS archiving
#   ./update-all.ps1 -SkipLinks    # Skip service link extraction
#   ./update-all.ps1 -SkipInstagram # Skip Instagram posting
#   ./update-all.ps1 -Only chart   # Run only chart task
#   ./update-all.ps1 -Only articles # Run only articles task
#   ./update-all.ps1 -Only links   # Run only service links task
#   ./update-all.ps1 -Only instagram # Run only Instagram posting

param(
    [switch]$SkipChart,
    [switch]$SkipArticles,
    [switch]$SkipLinks,
    [switch]$SkipInstagram,
    [ValidateSet("chart", "articles", "links", "instagram")]
    [string]$Only
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web

$scriptRoot = $PSScriptRoot
$statePath = Join-Path $scriptRoot ".last-run-state.json"

# ============================================================================
#  UTILITY
# ============================================================================

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message, [string]$Color = "Yellow")
    Write-Host "  > $Message" -ForegroundColor $Color
}

function Get-RunState {
    if (Test-Path $statePath) {
        try {
            return Get-Content $statePath -Raw | ConvertFrom-Json
        }
        catch {
            return $null
        }
    }
    return $null
}

function Save-RunState {
    param($state)
    $state | ConvertTo-Json -Depth 5 | Set-Content $statePath -Encoding UTF8
}

# ============================================================================
#  TASK 1: CHART DATA
# ============================================================================

function Update-ChartData {
    Write-Section "TASK 1: CHART DATA"

    $credentialsPath = Join-Path $scriptRoot "spotify-credentials.json"

    if (-not (Test-Path $credentialsPath)) {
        Write-Step "spotify-credentials.json not found, skipping chart update" "Red"
        return $false
    }

    Write-Step "Reading Spotify credentials..."
    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse spotify-credentials.json" "Red"
        return $false
    }

    if (-not $creds.clientId -or -not $creds.clientSecret) {
        Write-Step "spotify-credentials.json must contain clientId and clientSecret" "Red"
        return $false
    }

    $env:SPOTIFY_CLIENT_ID = $creds.clientId
    $env:SPOTIFY_CLIENT_SECRET = $creds.clientSecret

    if ($creds.discordWebhookUrl) {
        $env:DISCORD_WEBHOOK_URL = $creds.discordWebhookUrl
        Write-Step "Discord webhook configured"
    }

    $nodeScript = Join-Path $scriptRoot "scripts\generate-chart-data.js"

    Write-Step "Running chart data generation..."
    try {
        node $nodeScript
        if ($LASTEXITCODE -ne 0) {
            Write-Step "Node script exited with code $LASTEXITCODE" "Red"
            return $false
        }
    }
    catch {
        Write-Step "Failed to run node script: $_" "Red"
        return $false
    }

    Write-Step "Chart data updated successfully" "Green"
    return $true
}

# ============================================================================
#  TASK 2: RSS FEED ARTICLES
# ============================================================================

function Update-Articles {
    Write-Section "TASK 2: RSS FEED ARTICLES"

    $feedsPath = Join-Path $scriptRoot "rss-feeds.json"
    $articlesPath = Join-Path $scriptRoot "articles.json"

    if (-not (Test-Path $feedsPath)) {
        Write-Step "rss-feeds.json not found, skipping" "Red"
        return $false
    }

    Write-Step "Loading RSS feeds..."
    $feeds = Get-Content $feedsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Step "Found $($feeds.Count) feed(s)"

    # Load existing articles archive
    $existingArticles = @()
    if (Test-Path $articlesPath) {
        try {
            $articlesJson = Get-Content $articlesPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $existingArticles = @($articlesJson.articles)
            Write-Step "Loaded $($existingArticles.Count) existing article(s) from archive"
        }
        catch {
            Write-Step "Could not parse existing articles.json, starting fresh" "DarkYellow"
            $existingArticles = @()
        }
    }
    else {
        Write-Step "No articles.json found, creating new archive"
    }

    # Build a set of existing article links for deduplication
    $existingLinks = @{}
    foreach ($article in $existingArticles) {
        if ($article.link) {
            $existingLinks[$article.link] = $true
        }
    }

    Write-Step "Fetching all articles from feeds..."

    $newArticles = [System.Collections.ArrayList]::new()
    $feedErrors = 0

    foreach ($feed in $feeds) {
        $feedName = $feed.name
        Write-Host "    $feedName... " -NoNewline -ForegroundColor Gray

        try {
            # Fetch the RSS/Atom feed
            $response = Invoke-WebRequest -Uri $feed.feedUrl -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
            [xml]$xml = $response.Content

            $items = @()

            # Set up namespace manager for media: elements (used by rss.app feeds etc.)
            $nsMgr = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
            $nsMgr.AddNamespace("media", "http://search.yahoo.com/mrss/")

            # Handle RSS 2.0 format
            if ($xml.rss) {
                $items = @($xml.rss.channel.item)
            }
            # Handle Atom format
            elseif ($xml.feed) {
                $items = @($xml.feed.entry)
            }
            # Handle RDF/RSS 1.0
            elseif ($xml.SelectNodes("//*[local-name()='item']")) {
                $items = @($xml.SelectNodes("//*[local-name()='item']"))
            }

            $feedCount = 0

            foreach ($item in $items) {
                if (-not $item) { continue }

                # Extract the article date
                $articleDate = $null
                $dateStr = $null

                # RSS 2.0: pubDate
                if ($item.pubDate) {
                    $dateStr = $item.pubDate
                }
                # Atom: published or updated
                elseif ($item.published) {
                    $dateStr = $item.published
                }
                elseif ($item.updated) {
                    $dateStr = $item.updated
                }
                # dc:date (Dublin Core)
                elseif ($item.date) {
                    $dateStr = $item.date
                }

                if ($dateStr) {
                    try {
                        $articleDate = [DateTime]::Parse($dateStr)
                    }
                    catch {
                        # Try RFC 822 format common in RSS
                        try {
                            $articleDate = [System.DateTimeOffset]::Parse($dateStr).DateTime
                        }
                        catch {
                            # No parseable date, skip
                            continue
                        }
                    }
                }

                $articleDay = if ($articleDate) { $articleDate.ToString("yyyy-MM-dd") } else { $null }

                # Extract link
                $link = $null
                if ($item.link -and $item.link -is [string]) {
                    $link = $item.link.Trim()
                }
                elseif ($item.link.href) {
                    $link = $item.link.href.Trim()
                }
                elseif ($item.link.'#text') {
                    $link = $item.link.'#text'.Trim()
                }
                elseif ($item.link -is [System.Xml.XmlElement]) {
                    $link = $item.link.GetAttribute("href")
                }

                if (-not $link) { continue }

                # Skip if already archived
                if ($existingLinks.ContainsKey($link)) { continue }

                # Extract title
                $title = ""
                if ($item.title -is [string]) {
                    $title = $item.title.Trim()
                }
                elseif ($item.title.'#text') {
                    $title = $item.title.'#text'.Trim()
                }
                elseif ($item.title -is [System.Xml.XmlElement]) {
                    $title = $item.title.InnerText.Trim()
                }

                # Extract description/summary (first 300 chars)
                $description = ""
                if ($item.description -is [string]) {
                    $description = $item.description
                }
                elseif ($item.description.'#cdata-section') {
                    $description = $item.description.'#cdata-section'
                }
                elseif ($item.summary -is [string]) {
                    $description = $item.summary
                }
                elseif ($item.content -is [string]) {
                    $description = $item.content
                }

                # Strip HTML tags and trim
                if ($description) {
                    $description = $description -replace '<[^>]+>', '' -replace '&nbsp;', ' ' -replace '&#\d+;', '' -replace '&amp;', '&'
                    $description = ($description -replace '\s+', ' ').Trim()
                    if ($description.Length -gt 300) {
                        $description = $description.Substring(0, 297) + "..."
                    }
                }

                # Extract thumbnail/image if available
                $thumbnail = $null
                if ($item.enclosure -and $item.enclosure.url -and $item.enclosure.type -match "image") {
                    $thumbnail = $item.enclosure.url
                }
                if (-not $thumbnail -and $item -is [System.Xml.XmlElement]) {
                    # Use XPath for namespace-prefixed media elements (PowerShell property access fails on these)
                    $mediaThumbnail = $item.SelectSingleNode("media:thumbnail", $nsMgr)
                    if ($mediaThumbnail -and $mediaThumbnail.url) {
                        $thumbnail = $mediaThumbnail.url
                    }
                    if (-not $thumbnail) {
                        $mediaContent = $item.SelectSingleNode("media:content[@medium='image']", $nsMgr)
                        if ($mediaContent -and $mediaContent.url) {
                            $thumbnail = $mediaContent.url
                        }
                    }
                }
                # Fallback: extract first <img src="..."> from description HTML
                if (-not $thumbnail) {
                    $rawDesc = ""
                    if ($item.description -is [string]) { $rawDesc = $item.description }
                    elseif ($item.description.'#cdata-section') { $rawDesc = $item.description.'#cdata-section' }
                    if ($rawDesc -match '<img[^>]+src=["'']([^"'']+)["'']') {
                        $thumbnail = $Matches[1]
                    }
                }

                $articleObj = [PSCustomObject]@{
                    title       = $title
                    link        = $link
                    description = $description
                    date        = if ($articleDay) { $articleDay } else { $null }
                    source      = $feedName
                    siteUrl     = $feed.siteUrl
                    iconUrl     = $feed.iconUrl
                    thumbnail   = $thumbnail
                    fetchedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                }

                $null = $newArticles.Add($articleObj)
                $existingLinks[$link] = $true
                $feedCount++
            }

            if ($feedCount -gt 0) {
                Write-Host "$feedCount new article(s)" -ForegroundColor Green
            }
            else {
                Write-Host "no new articles" -ForegroundColor DarkGray
            }
        }
        catch {
            Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
            $feedErrors++
        }
    }

    Write-Host ""

    if ($newArticles.Count -gt 0) {
        Write-Step "Adding $($newArticles.Count) new article(s) to archive..."

        # Merge new articles with existing ones (newest first)
        $allArticles = @($newArticles) + @($existingArticles)
        $allArticles = $allArticles | Sort-Object { $_.date } -Descending

        $archiveData = [PSCustomObject]@{
            lastUpdated   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            totalArticles = $allArticles.Count
            articles      = @($allArticles)
        }

        $archiveData | ConvertTo-Json -Depth 5 | Set-Content $articlesPath -Encoding UTF8
        Write-Step "articles.json updated: $($allArticles.Count) total articles" "Green"
    }
    else {
        Write-Step "No new articles found" "DarkGray"
    }

    if ($feedErrors -gt 0) {
        Write-Step "$feedErrors feed(s) had errors" "DarkYellow"
    }

    return $true
}

# ============================================================================
#  TASK 3: SERVICE LINKS FOR NEW BANDS
# ============================================================================

# --- Songlink API helpers (from extract-service-links.ps1) ---

$platformMapping = @{
    "spotify"      = "spotify"
    "appleMusic"   = "itunes"
    "youtubeMusic" = "youtube_music"
    "youtube"      = "youtube"
    "amazonMusic"  = "amazon_music"
    "deezer"       = "deezer"
    "tidal"        = "tidal"
    "soundcloud"   = "soundcloud"
    "napster"      = "napster"
    "audiomack"    = "audiomack"
}

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
        if ($_.Exception.Response.StatusCode -eq 429) {
            Start-Sleep -Seconds 5
            try {
                $response = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
                return $response
            }
            catch { return $null }
        }
        return $null
    }
}

function Get-SourceLinkFromArtist {
    param($links)
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
    if ($spotifyUrl -match "artist[/:]([a-zA-Z0-9]+)") {
        $artistId = $matches[1]
        $embedUrl = "https://open.spotify.com/embed/artist/$artistId"
        try {
            $headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
            $response = Invoke-WebRequest -Uri $embedUrl -Headers $headers -TimeoutSec 10 -UseBasicParsing
            if ($response.Content -match '"uri":"spotify:track:([a-zA-Z0-9]+)"') {
                return "https://open.spotify.com/track/$($matches[1])"
            }
        }
        catch { }
    }
    return $null
}

function Get-LinksFromSonglink {
    param([string]$sourceUrl)

    $results = @{ links = @{}; artistName = $null }

    try {
        $songlinkData = Get-SonglinkData $sourceUrl
        if ($songlinkData) {
            if ($songlinkData.entitiesByUniqueId) {
                $entities = $songlinkData.entitiesByUniqueId.PSObject.Properties
                foreach ($entity in $entities) {
                    if ($entity.Value.artistName) {
                        $results.artistName = $entity.Value.artistName
                        break
                    }
                }
            }
            if ($songlinkData.linksByPlatform) {
                $platforms = $songlinkData.linksByPlatform.PSObject.Properties
                foreach ($platform in $platforms) {
                    $songlinkName = $platform.Name
                    if ($platformMapping.ContainsKey($songlinkName)) {
                        $ourKey = $platformMapping[$songlinkName]
                        $url = $platform.Value.url
                        if ($url) { $results.links[$ourKey] = $url }
                    }
                }
            }
        }
    }
    catch { }

    return $results
}

function Update-ServiceLinks {
    Write-Section "TASK 3: SERVICE LINKS FOR NEW BANDS"

    $bandsJsonPath = Join-Path $scriptRoot "bands.json"

    if (-not (Test-Path $bandsJsonPath)) {
        Write-Step "bands.json not found, skipping" "Red"
        return $false
    }

    # Load current state
    $state = Get-RunState
    $previousNames = @()
    if ($state -and $state.artistNames) {
        $previousNames = @($state.artistNames)
    }

    # Load bands.json
    Write-Step "Loading bands.json..."
    $bandsData = Get-Content $bandsJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $currentNames = @($bandsData.muzickaMasterLista | ForEach-Object { $_.name })

    Write-Step "Current artists: $($currentNames.Count), previously tracked: $($previousNames.Count)"

    # Find new entries
    if ($previousNames.Count -eq 0) {
        Write-Step "First run - saving current artist list as baseline (no extraction needed)" "DarkYellow"
        Write-Step "On subsequent runs, only newly added artists will be processed"
        return $true
    }

    $previousSet = @{}
    foreach ($name in $previousNames) { $previousSet[$name] = $true }

    $newEntries = @($currentNames | Where-Object { -not $previousSet.ContainsKey($_) })

    if ($newEntries.Count -eq 0) {
        Write-Step "No new artists detected since last run" "DarkGray"
        return $true
    }

    Write-Step "$($newEntries.Count) new artist(s) found:" "Green"
    foreach ($name in $newEntries) {
        Write-Host "    + $name" -ForegroundColor Green
    }
    Write-Host ""

    # Process only the new entries
    $updated = 0
    $newEntrySet = @{}
    foreach ($name in $newEntries) { $newEntrySet[$name] = $true }

    for ($i = 0; $i -lt $bandsData.muzickaMasterLista.Count; $i++) {
        $artist = $bandsData.muzickaMasterLista[$i]
        if (-not $newEntrySet.ContainsKey($artist.name)) { continue }

        $artistName = $artist.name
        Write-Host "    $artistName" -NoNewline -ForegroundColor White

        # Get source link
        $sourceLink = $null
        try { $sourceLink = Get-SourceLinkFromArtist $artist.links }
        catch {
            Write-Host " - Error reading links" -ForegroundColor Red
            continue
        }

        if (-not $sourceLink) {
            Write-Host " - No usable source link" -ForegroundColor DarkGray
            continue
        }

        # Check missing services
        $existingLinks = @()
        if ($artist.links) {
            try { $existingLinks = $artist.links.PSObject.Properties.Name }
            catch { $existingLinks = @() }
        }

        $missingPriority = $priorityServices | Where-Object { $_ -notin $existingLinks }

        if ($missingPriority.Count -eq 0) {
            Write-Host " - Already complete" -ForegroundColor DarkGreen
            continue
        }

        Write-Host " - Fetching..." -NoNewline -ForegroundColor Yellow
        Start-Sleep -Milliseconds 800

        # Try track URL for Spotify artist links
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

            if ($null -eq $result.links -or $result.links.Count -eq 0) {
                Write-Host " No additional links found" -ForegroundColor DarkGray
                continue
            }

            $addedCount = 0
            foreach ($service in $result.links.Keys) {
                if ($service -notin $existingLinks) {
                    $artist.links | Add-Member -NotePropertyName $service -NotePropertyValue $result.links[$service] -Force
                    $addedCount++
                }
            }

            if ($addedCount -gt 0) {
                $matchInfo = if ($result.artistName) { " ($($result.artistName))" } else { "" }
                Write-Host " +$addedCount links$matchInfo" -ForegroundColor Green
                $updated++
            }
            else {
                Write-Host " No new links" -ForegroundColor DarkGray
            }
        }
        catch {
            Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host ""

    if ($updated -gt 0) {
        Write-Step "Saving bands.json with $updated updated artist(s)..."

        # Backup
        $backupPath = Join-Path $scriptRoot "bands.json.backup"
        Copy-Item $bandsJsonPath $backupPath -Force
        Write-Step "Backup saved to bands.json.backup" "Gray"

        $bandsData | ConvertTo-Json -Depth 10 | Set-Content $bandsJsonPath -Encoding UTF8
        Write-Step "bands.json updated" "Green"
    }
    else {
        Write-Step "No new service links found for new artists" "DarkGray"
    }

    return $true
}

# ============================================================================
#  TASK 4: INSTAGRAM WEEKLY CHART POST
# ============================================================================

Add-Type -AssemblyName System.Drawing

function Refresh-InstagramToken {
    param($creds, [string]$credentialsPath)

    Write-Step "Checking if Instagram token needs refresh..."

    try {
        $testUrl = "https://graph.instagram.com/v21.0/me?fields=id,username&access_token=$($creds.accessToken)"
        $testResult = Invoke-RestMethod -Uri $testUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
        Write-Step "Token valid for user: $($testResult.username)" "Green"

        $refreshUrl = "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=$($creds.accessToken)"
        try {
            $refreshResult = Invoke-RestMethod -Uri $refreshUrl -Method Get -TimeoutSec 15 -ErrorAction Stop
            if ($refreshResult.access_token) {
                $creds.accessToken = $refreshResult.access_token
                $creds | ConvertTo-Json -Depth 5 | Set-Content $credentialsPath -Encoding UTF8
                Write-Step "Token refreshed (expires in $([math]::Round($refreshResult.expires_in / 86400)) days)" "Green"
            }
        }
        catch {
            Write-Step "Token refresh skipped (still valid)" "DarkGray"
        }

        return $true
    }
    catch {
        Write-Step "Instagram token is invalid or expired: $($_.Exception.Message)" "Red"
        Write-Step "Generate a new token at developers.facebook.com and update instagram-credentials.json" "Yellow"
        return $false
    }
}

function Get-WeekLabel {
    $now = Get-Date
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $weekNum = $culture.Calendar.GetWeekOfYear($now, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
    return "W{0:D2} {1}" -f $weekNum, $now.Year
}

# --- Image generation helpers (dark theme matching toplista.mk share card) ---

# Theme colors (dark mode from website)
$script:themeCardBg     = "#141a1f"
$script:themeHeaderBg   = "#000000"
$script:themeHeaderClr  = "#ffffff"
$script:themeSongClr    = "#e8eaed"
$script:themeArtistClr  = "#9aa0a6"
$script:themeFooterBg   = "#1c2428"
$script:themeBorderClr  = "#2d3439"
$script:themeWeekClr    = "#8c929a"
$script:themeDateClr    = "#5f6368"
$script:themeRankClr    = "#5f6368"
$script:themeGold       = "#ffd700"
$script:themeSilver     = "#c0c0c0"
$script:themeBronze     = "#cd7f32"
$script:themeCoverBg    = "#1c2428"

function Download-ImageFromUrl {
    param([string]$url)
    try {
        $wc = New-Object System.Net.WebClient
        $bytes = $wc.DownloadData($url)
        $ms = New-Object System.IO.MemoryStream(,$bytes)
        return [System.Drawing.Image]::FromStream($ms)
    }
    catch {
        return $null
    }
}

function New-SolidBrush { param([string]$hex)
    $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
    return New-Object System.Drawing.SolidBrush($c)
}

function Draw-RoundedRect {
    param($g, $brush, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
    $path.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $path.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose()
}

function Draw-ImageRounded {
    param($g, $img, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
    $path.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $path.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $oldClip = $g.Clip
    $g.SetClip($path, [System.Drawing.Drawing2D.CombineMode]::Replace)
    $g.DrawImage($img, $x, $y, $w, $h)
    $g.Clip = $oldClip
    $path.Dispose()
}

function Get-RankColor {
    param([int]$rank)
    switch ($rank) {
        1 { return $script:themeGold }
        2 { return $script:themeSilver }
        3 { return $script:themeBronze }
        default { return $script:themeRankClr }
    }
}

function Get-RankItemBg {
    param([int]$rank)
    # Subtle highlight backgrounds for top 3, matching the website
    switch ($rank) {
        1 { return [System.Drawing.Color]::FromArgb(20, 212, 160, 0) }
        2 { return [System.Drawing.Color]::FromArgb(15, 138, 138, 138) }
        3 { return [System.Drawing.Color]::FromArgb(15, 168, 104, 48) }
        default { return [System.Drawing.Color]::Transparent }
    }
}

# Deduplicates collab releases (same releaseId = same track, multiple artists)
function Merge-Collabs {
    param($releases)
    $map = @{}
    foreach ($r in $releases) {
        $rid = $r.releaseId
        if ($map.ContainsKey($rid)) {
            $existing = $map[$rid]
            $existingArtists = $existing.bandName -split ", "
            if ($existingArtists -notcontains $r.bandName) {
                $existing.bandName = ($existingArtists + @($r.bandName)) -join ", "
            }
            if ([int]$r.popularity -gt [int]$existing.popularity) { $existing.popularity = $r.popularity }
        } else {
            # Clone to avoid mutating original
            $map[$rid] = [PSCustomObject]@{
                bandName      = $r.bandName
                artistId      = $r.artistId
                releaseId     = $r.releaseId
                releaseTitle  = $r.releaseTitle
                releaseType   = $r.releaseType
                releaseDate   = $r.releaseDate
                thumbnail     = $r.thumbnail
                popularity    = $r.popularity
                topTrackName  = $r.topTrackName
                topTrackId    = $r.topTrackId
                followers     = $r.followers
                spotifyUrl    = $r.spotifyUrl
            }
        }
    }
    return @($map.Values)
}

# Get singles chart: filter singles, take 20 most recent by date, sort by popularity
function Get-SinglesChart {
    param($allReleases, [int]$count = 10)

    # Deduplicate collabs first
    $deduped = Merge-Collabs $allReleases

    # Filter singles only
    $singles = @($deduped | Where-Object { $_.releaseType -eq "single" })

    # Sort by release date descending, take 20 most recent
    $recent = @($singles | Sort-Object {
        try { [DateTime]::Parse($_.releaseDate) } catch { [DateTime]::MinValue }
    } -Descending | Select-Object -First 20)

    # Sort by popularity descending
    $ranked = @($recent | Sort-Object { [int]$_.popularity } -Descending | Select-Object -First $count)

    return $ranked
}

function New-ListSlide {
    param($topReleases, $igHandles, [string]$weekLabel)

    # Scale factor: website card is 420px, we render at ~2.57x for 1080px
    $S = 2.57
    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Full card background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar (black) ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    # Header title: Cyrillic via char codes (no emoji - System.Drawing can't render them)
    $fontTitle = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeHeaderClr
    $titleText = "$([char]0x0422)$([char]0x043E)$([char]0x043F) $([char]0x0421)$([char]0x0438)$([char]0x043D)$([char]0x0433)$([char]0x043B)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
    $g.DrawString($titleText, $fontTitle, $titleBr, 30, 22)

    # Header logo (right side) - load from file if present
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoSize = 50
            $g.DrawImage($logoImg, ($W - $logoSize - 24), (($headerH - $logoSize) / 2), $logoSize, $logoSize)
            $logoImg.Dispose()
        } catch {}
    }

    # --- Chart items ---
    $listTop = $headerH + 12
    $itemCount = [Math]::Min($topReleases.Count, 10)
    $availH = $H - $listTop - 68  # reserve for footer
    $itemH = [Math]::Floor($availH / $itemCount)
    $coverSize = [Math]::Min(100, $itemH - 16)
    $padX = 26

    $fontRank = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
    $fontSong = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
    $fontArtist = New-Object System.Drawing.Font("Segoe UI", 18)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 1)

    for ($i = 0; $i -lt $itemCount; $i++) {
        $r = $topReleases[$i]
        $rank = $i + 1
        $y = $listTop + ($i * $itemH)

        # Row background for top 3
        $rowBgColor = Get-RankItemBg $rank
        if ($rowBgColor -ne [System.Drawing.Color]::Transparent) {
            $rowBgBr = New-Object System.Drawing.SolidBrush($rowBgColor)
            $g.FillRectangle($rowBgBr, 0, $y, $W, $itemH)
            $rowBgBr.Dispose()
        }

        # Bottom border (except last item)
        if ($i -lt ($itemCount - 1)) {
            $g.DrawLine($borderPen, $padX, ($y + $itemH), ($W - $padX), ($y + $itemH))
        }

        # Rank number
        $rankBr = New-SolidBrush (Get-RankColor $rank)
        $rankStr = "$rank"
        $rankSize = $g.MeasureString($rankStr, $fontRank)
        $rankX = $padX + 40 - $rankSize.Width  # right-align in 40px box
        $rankY = $y + ($itemH - $rankSize.Height) / 2
        $g.DrawString($rankStr, $fontRank, $rankBr, $rankX, $rankY)
        $rankBr.Dispose()

        # Cover art
        $coverX = $padX + 55
        $coverY = $y + ($itemH - $coverSize) / 2
        $coverBgBr = New-SolidBrush $script:themeCoverBg

        if ($r.thumbnail) {
            $coverImg = Download-ImageFromUrl $r.thumbnail
            if ($coverImg) {
                Draw-ImageRounded $g $coverImg ([int]$coverX) ([int]$coverY) $coverSize $coverSize 8
                $coverImg.Dispose()
            } else {
                Draw-RoundedRect $g $coverBgBr ([int]$coverX) ([int]$coverY) $coverSize $coverSize 8
            }
        } else {
            Draw-RoundedRect $g $coverBgBr ([int]$coverX) ([int]$coverY) $coverSize $coverSize 8
        }
        $coverBgBr.Dispose()

        # Song title + artist name
        $textX = $coverX + $coverSize + 16
        $maxTextW = $W - $textX - $padX

        $songStr = $r.releaseTitle
        if ($songStr.Length -gt 35) { $songStr = $songStr.Substring(0, 32) + "..." }
        $songBr = New-SolidBrush $script:themeSongClr
        $songY = $y + ($itemH / 2) - 28
        $g.DrawString($songStr, $fontSong, $songBr, $textX, $songY)
        $songBr.Dispose()

        $artistStr = $r.bandName
        if ($igHandles.ContainsKey($r.bandName)) {
            $artistStr = "$($r.bandName) ($($igHandles[$r.bandName]))"
        }
        if ($artistStr.Length -gt 45) { $artistStr = $artistStr.Substring(0, 42) + "..." }
        $artistBr = New-SolidBrush $script:themeArtistClr
        $artistY = $songY + 32
        $g.DrawString($artistStr, $fontArtist, $artistBr, $textX, $artistY)
        $artistBr.Dispose()
    }

    # --- Footer ---
    $footerH = 56
    $footerY = $H - $footerH
    $footerBr = New-SolidBrush $script:themeFooterBg
    $g.FillRectangle($footerBr, 0, $footerY, $W, $footerH)

    # Footer top border
    $g.DrawLine($borderPen, 0, $footerY, $W, $footerY)

    $fontWeek = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $fontUrl = New-Object System.Drawing.Font("Segoe UI", 14)
    $weekBr = New-SolidBrush $script:themeWeekClr
    $urlBr = New-SolidBrush $script:themeDateClr

    $g.DrawString($weekLabel, $fontWeek, $weekBr, $padX, ($footerY + 16))

    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Far
    $g.DrawString("toplista.mk", $fontUrl, $urlBr, [System.Drawing.RectangleF]::new(0, ($footerY + 18), ($W - $padX), 26), $sfRight)

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontTitle, $titleBr, $fontRank, $fontSong, $fontArtist,
                       $borderPen, $footerBr, $fontWeek, $fontUrl, $weekBr, $urlBr, $sfRight)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-ReleaseSlide {
    param($release, [int]$rank, $igHandle, [string]$weekLabel)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar (black) ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    $fontHeader = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $headerTxtBr = New-SolidBrush $script:themeHeaderClr
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    # Cyrillic via char codes (no emoji)
    $headerText = "$([char]0x0422)$([char]0x043E)$([char]0x043F) $([char]0x0421)$([char]0x0438)$([char]0x043D)$([char]0x0433)$([char]0x043B)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
    $g.DrawString($headerText, $fontHeader, $headerTxtBr, [System.Drawing.RectangleF]::new(0, 22, $W, 40), $sfCenter)

    # Logo in header (right side)
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoSize = 50
            $g.DrawImage($logoImg, ($W - $logoSize - 24), (($headerH - $logoSize) / 2), $logoSize, $logoSize)
            $logoImg.Dispose()
        } catch {}
    }

    # --- Rank badge ---
    $rankColor = Get-RankColor $rank
    $fontBigRank = New-Object System.Drawing.Font("Segoe UI", 72, [System.Drawing.FontStyle]::Bold)
    $rankBr = New-SolidBrush $rankColor
    $rankLabel = "#${rank}"
    $g.DrawString($rankLabel, $fontBigRank, $rankBr, [System.Drawing.RectangleF]::new(0, 100, $W, 100), $sfCenter)

    # --- Album artwork (large, centered) ---
    $artSize = 680
    $artX = ($W - $artSize) / 2
    $artY = 220

    if ($release.thumbnail) {
        Write-Step "  Downloading artwork for $($release.bandName)..." "DarkGray"
        $albumImg = Download-ImageFromUrl $release.thumbnail
        if ($albumImg) {
            Draw-ImageRounded $g $albumImg ([int]$artX) ([int]$artY) $artSize $artSize 16
            $albumImg.Dispose()
        }
        else {
            $placeBr = New-SolidBrush $script:themeCoverBg
            Draw-RoundedRect $g $placeBr ([int]$artX) ([int]$artY) $artSize $artSize 16
            $placeBr.Dispose()
        }
    }

    # --- Song title ---
    $fontSongTitle = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
    $songTitleBr = New-SolidBrush $script:themeSongClr
    $songTitleY = $artY + $artSize + 36
    $songStr = $release.releaseTitle
    if ($songStr.Length -gt 30) { $songStr = $songStr.Substring(0, 27) + "..." }
    $g.DrawString($songStr, $fontSongTitle, $songTitleBr, [System.Drawing.RectangleF]::new(40, $songTitleY, ($W - 80), 55), $sfCenter)

    # --- Artist name ---
    $fontArtistName = New-Object System.Drawing.Font("Segoe UI", 26)
    $artistNameBr = New-SolidBrush $script:themeArtistClr
    $artistY = $songTitleY + 55
    $artistStr = $release.bandName
    if ($artistStr.Length -gt 35) { $artistStr = $artistStr.Substring(0, 32) + "..." }
    $g.DrawString($artistStr, $fontArtistName, $artistNameBr, [System.Drawing.RectangleF]::new(40, $artistY, ($W - 80), 40), $sfCenter)

    # --- Instagram handle ---
    if ($igHandle) {
        $fontIG = New-Object System.Drawing.Font("Segoe UI", 22)
        $igBlueBr = New-SolidBrush "#3897f0"
        $igY = $artistY + 45
        $g.DrawString($igHandle, $fontIG, $igBlueBr, [System.Drawing.RectangleF]::new(0, $igY, $W, 35), $sfCenter)
        $fontIG.Dispose()
        $igBlueBr.Dispose()
    }

    # --- Footer ---
    $footerH = 56
    $footerY = $H - $footerH
    $footerBr = New-SolidBrush $script:themeFooterBg
    $g.FillRectangle($footerBr, 0, $footerY, $W, $footerH)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 1)
    $g.DrawLine($borderPen, 0, $footerY, $W, $footerY)

    $fontWeek = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $fontUrl = New-Object System.Drawing.Font("Segoe UI", 14)
    $weekBr = New-SolidBrush $script:themeWeekClr
    $urlBr = New-SolidBrush $script:themeDateClr

    $g.DrawString($weekLabel, $fontWeek, $weekBr, 26, ($footerY + 16))

    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Far
    $g.DrawString("toplista.mk", $fontUrl, $urlBr, [System.Drawing.RectangleF]::new(0, ($footerY + 18), ($W - 26), 26), $sfRight)

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontHeader, $headerTxtBr, $sfCenter,
                       $fontBigRank, $rankBr, $fontSongTitle, $songTitleBr,
                       $fontArtistName, $artistNameBr, $footerBr, $borderPen,
                       $fontWeek, $fontUrl, $weekBr, $urlBr, $sfRight)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-TitleSlide {
    param([string]$weekLabel)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    # --- Large logo (centered) ---
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoSize = 320
            $logoX = ($W - $logoSize) / 2
            $logoY = 200
            Draw-ImageRounded $g $logoImg ([int]$logoX) ([int]$logoY) $logoSize $logoSize ([int]($logoSize / 2))
            $logoImg.Dispose()
        } catch {}
    }

    # --- "Топ Синглови" title ---
    $fontBigTitle = New-Object System.Drawing.Font("Segoe UI", 52, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeSongClr
    $titleText = "$([char]0x0422)$([char]0x043E)$([char]0x043F) $([char]0x0421)$([char]0x0438)$([char]0x043D)$([char]0x0433)$([char]0x043B)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
    $g.DrawString($titleText, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, 600, $W, 75), $sfCenter)

    # --- Week label ---
    $fontWeekBig = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
    $weekBr = New-SolidBrush $script:themeWeekClr
    $g.DrawString($weekLabel, $fontWeekBig, $weekBr, [System.Drawing.RectangleF]::new(0, 700, $W, 55), $sfCenter)

    # --- Subtle "toplista.mk" ---
    $fontSiteUrl = New-Object System.Drawing.Font("Segoe UI", 24)
    $urlBr = New-SolidBrush $script:themeDateClr
    $g.DrawString("toplista.mk", $fontSiteUrl, $urlBr, [System.Drawing.RectangleF]::new(0, 800, $W, 40), $sfCenter)

    # --- Footer ---
    $footerH = 56
    $footerY = $H - $footerH
    $footerBr = New-SolidBrush $script:themeFooterBg
    $g.FillRectangle($footerBr, 0, $footerY, $W, $footerH)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 1)
    $g.DrawLine($borderPen, 0, $footerY, $W, $footerY)

    $fontFtWeek = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $fontFtUrl = New-Object System.Drawing.Font("Segoe UI", 14)
    $ftWeekBr = New-SolidBrush $script:themeWeekClr
    $ftUrlBr = New-SolidBrush $script:themeDateClr

    $g.DrawString($weekLabel, $fontFtWeek, $ftWeekBr, 26, ($footerY + 16))
    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Far
    $g.DrawString("toplista.mk", $fontFtUrl, $ftUrlBr, [System.Drawing.RectangleF]::new(0, ($footerY + 18), ($W - 26), 26), $sfRight)

    # Cleanup
    foreach ($obj in @($bgBr, $sfCenter, $fontBigTitle, $titleBr, $fontWeekBig, $weekBr,
                       $fontSiteUrl, $urlBr, $footerBr, $borderPen, $fontFtWeek, $fontFtUrl,
                       $ftWeekBr, $ftUrlBr, $sfRight)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-PromoSlide {
    param([string]$weekLabel)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar (black) ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    $fontHeader = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $headerTxtBr = New-SolidBrush $script:themeHeaderClr
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    $headerText = "toplista.mk"
    $g.DrawString($headerText, $fontHeader, $headerTxtBr, [System.Drawing.RectangleF]::new(0, 22, $W, 40), $sfCenter)

    # --- Large logo (centered) ---
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoSize = 240
            $logoX = ($W - $logoSize) / 2
            $logoY = 160
            # Draw logo with rounded clip
            Draw-ImageRounded $g $logoImg ([int]$logoX) ([int]$logoY) $logoSize $logoSize ($logoSize / 2)
            $logoImg.Dispose()
        } catch {}
    }

    # --- Title: "Македонска Музичка" ---
    $fontBigTitle = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeSongClr
    # "Македонска Музичка"
    $line1 = "$([char]0x041C)$([char]0x0430)$([char]0x043A)$([char]0x0435)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0441)$([char]0x043A)$([char]0x0430) $([char]0x041C)$([char]0x0443)$([char]0x0437)$([char]0x0438)$([char]0x0447)$([char]0x043A)$([char]0x0430)"
    $g.DrawString($line1, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, 440, $W, 55), $sfCenter)

    # --- Title: "Мастер Листа" ---
    # "Мастер Листа"
    $line2 = "$([char]0x041C)$([char]0x0430)$([char]0x0441)$([char]0x0442)$([char]0x0435)$([char]0x0440) $([char]0x041B)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0430)"
    $g.DrawString($line2, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, 500, $W, 55), $sfCenter)

    # --- Subtitle: "Отворена база на македонски музички артисти и бендови" ---
    $fontSub = New-Object System.Drawing.Font("Segoe UI", 22)
    $subBr = New-SolidBrush $script:themeArtistClr
    # "Отворена база на македонски"
    $sub1 = "$([char]0x041E)$([char]0x0442)$([char]0x0432)$([char]0x043E)$([char]0x0440)$([char]0x0435)$([char]0x043D)$([char]0x0430) $([char]0x0431)$([char]0x0430)$([char]0x0437)$([char]0x0430) $([char]0x043D)$([char]0x0430) $([char]0x043C)$([char]0x0430)$([char]0x043A)$([char]0x0435)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0441)$([char]0x043A)$([char]0x0438)"
    $g.DrawString($sub1, $fontSub, $subBr, [System.Drawing.RectangleF]::new(0, 585, $W, 35), $sfCenter)
    # "музички артисти и бендови"
    $sub2 = "$([char]0x043C)$([char]0x0443)$([char]0x0437)$([char]0x0438)$([char]0x0447)$([char]0x043A)$([char]0x0438) $([char]0x0430)$([char]0x0440)$([char]0x0442)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0438) $([char]0x0438) $([char]0x0431)$([char]0x0435)$([char]0x043D)$([char]0x0434)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
    $g.DrawString($sub2, $fontSub, $subBr, [System.Drawing.RectangleF]::new(0, 622, $W, 35), $sfCenter)

    # --- Divider line ---
    $divPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 2)
    $g.DrawLine($divPen, 200, 700, ($W - 200), 700)

    # --- CTA lines ---
    $fontCTA = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $ctaBr = New-SolidBrush $script:themeGold
    # "Додај го твојот"
    $cta1 = "$([char]0x0414)$([char]0x043E)$([char]0x0434)$([char]0x0430)$([char]0x0458) $([char]0x0433)$([char]0x043E) $([char]0x0442)$([char]0x0432)$([char]0x043E)$([char]0x0458)$([char]0x043E)$([char]0x0442)"
    $g.DrawString($cta1, $fontCTA, $ctaBr, [System.Drawing.RectangleF]::new(0, 745, $W, 45), $sfCenter)
    # "омилен артист!"
    $cta2 = "$([char]0x043E)$([char]0x043C)$([char]0x0438)$([char]0x043B)$([char]0x0435)$([char]0x043D) $([char]0x0430)$([char]0x0440)$([char]0x0442)$([char]0x0438)$([char]0x0441)$([char]0x0442)!"
    $g.DrawString($cta2, $fontCTA, $ctaBr, [System.Drawing.RectangleF]::new(0, 795, $W, 45), $sfCenter)

    # --- Sub-CTA ---
    $fontSubCTA = New-Object System.Drawing.Font("Segoe UI", 22)
    $subCtaBr = New-SolidBrush $script:themeArtistClr
    # "Уреди, додај и придонеси на листата"
    $subCta = "$([char]0x0423)$([char]0x0440)$([char]0x0435)$([char]0x0434)$([char]0x0438), $([char]0x0434)$([char]0x043E)$([char]0x0434)$([char]0x0430)$([char]0x0458) $([char]0x0438) $([char]0x043F)$([char]0x0440)$([char]0x0438)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0435)$([char]0x0441)$([char]0x0438) $([char]0x043D)$([char]0x0430) $([char]0x043B)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0430)$([char]0x0442)$([char]0x0430)"
    $g.DrawString($subCta, $fontSubCTA, $subCtaBr, [System.Drawing.RectangleF]::new(0, 878, $W, 35), $sfCenter)

    # --- URL box ---
    $urlBoxY = 960
    $urlBoxW = 400
    $urlBoxH = 60
    $urlBoxX = ($W - $urlBoxW) / 2
    $urlBgBr = New-SolidBrush $script:themeFooterBg
    Draw-RoundedRect $g $urlBgBr ([int]$urlBoxX) ([int]$urlBoxY) $urlBoxW $urlBoxH 12
    $fontUrlBig = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $urlTxtBr = New-SolidBrush "#ffffff"
    $g.DrawString("toplista.mk", $fontUrlBig, $urlTxtBr, [System.Drawing.RectangleF]::new(0, ($urlBoxY + 10), $W, 45), $sfCenter)

    # --- Footer ---
    $footerH = 56
    $footerY = $H - $footerH
    $footerBr = New-SolidBrush $script:themeFooterBg
    $g.FillRectangle($footerBr, 0, $footerY, $W, $footerH)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 1)
    $g.DrawLine($borderPen, 0, $footerY, $W, $footerY)

    $fontWeek = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $fontUrl = New-Object System.Drawing.Font("Segoe UI", 14)
    $weekBr = New-SolidBrush $script:themeWeekClr
    $urlBr = New-SolidBrush $script:themeDateClr

    $g.DrawString($weekLabel, $fontWeek, $weekBr, 26, ($footerY + 16))

    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Far
    $g.DrawString("toplista.mk", $fontUrl, $urlBr, [System.Drawing.RectangleF]::new(0, ($footerY + 18), ($W - 26), 26), $sfRight)

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontHeader, $headerTxtBr, $sfCenter,
                       $fontBigTitle, $titleBr, $fontSub, $subBr, $divPen,
                       $fontCTA, $ctaBr, $fontSubCTA, $subCtaBr, $urlBgBr,
                       $fontUrlBig, $urlTxtBr,
                       $footerBr, $borderPen, $fontWeek, $fontUrl, $weekBr, $urlBr, $sfRight)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function Save-SlideAsJpeg {
    param([System.Drawing.Bitmap]$bmp, [string]$path)
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 95L)
    $bmp.Save($path, $jpegCodec, $encoderParams)
    $encoderParams.Dispose()
}

function Upload-TempImage {
    param([string]$filePath)
    # Upload to litterbox.catbox.moe (temp host, 24h expiry, no auth)
    # Falls back to catbox.moe (permanent) if litterbox fails
    try {
        $result = & curl.exe -s -F "reqtype=fileupload" -F "time=24h" -F "fileToUpload=@$filePath" "https://litterbox.catbox.moe/resources/internals/api.php" 2>&1
        $url = ($result | Out-String).Trim()
        if ($url -match "^https?://") {
            return $url
        }
    }
    catch {}

    # Fallback: catbox permanent
    try {
        $result = & curl.exe -s -F "reqtype=fileupload" -F "fileToUpload=@$filePath" "https://catbox.moe/user/api.php" 2>&1
        $url = ($result | Out-String).Trim()
        if ($url -match "^https?://") {
            return $url
        }
    }
    catch {}

    return $null
}

# --- Instagram API helpers ---

function Build-InstagramCaption {
    param($topReleases, $igHandles, [string]$weekLabel)

    # Build Cyrillic strings via char codes (PS 5.1 without BOM can't read literal Cyrillic)
    $cyrTopSinglovi = "$([char]0x0422)$([char]0x043E)$([char]0x043F) $([char]0x0421)$([char]0x0438)$([char]0x043D)$([char]0x0433)$([char]0x043B)$([char]0x043E)$([char]0x0432)$([char]0x0438)"

    $lines = @()
    $lines += "$cyrTopSinglovi - $weekLabel"
    $lines += ""

    for ($i = 0; $i -lt $topReleases.Count; $i++) {
        $release = $topReleases[$i]
        $rank = $i + 1

        # Use topTrackName as song name if available, otherwise releaseTitle
        $songName = if ($release.topTrackName) { $release.topTrackName } else { $release.releaseTitle }

        $artistName = $release.bandName

        # Append IG handle if available
        $handleParts = @()
        # Check each artist in a collab
        foreach ($singleArtist in ($release.bandName -split ", ")) {
            if ($igHandles.ContainsKey($singleArtist)) {
                $handleParts += $igHandles[$singleArtist]
            }
        }
        $handleStr = ""
        if ($handleParts.Count -gt 0) {
            $handleStr = " (" + ($handleParts -join ", ") + ")"
        }

        $lines += "${rank}. ${artistName}${handleStr} - $songName"
    }

    $lines += ""
    $lines += "toplista.mk"
    $lines += ""
    $lines += "#toplista #muzika #mkmusic #chart #newmusic #spotify #macedonia"

    return ($lines -join "`n")
}

function Publish-InstagramCarousel {
    param(
        [string]$igAccountId,
        [string]$accessToken,
        [array]$imageUrls,
        [string]$caption
    )

    $apiBase = "https://graph.instagram.com/v21.0"

    # Step 1: Create child containers
    $childIds = @()
    for ($i = 0; $i -lt $imageUrls.Count; $i++) {
        Write-Step "  Creating container for slide $($i + 1)/$($imageUrls.Count)..."
        $body = @{
            image_url        = $imageUrls[$i]
            is_carousel_item = "true"
            access_token     = $accessToken
        }
        try {
            $result = Invoke-RestMethod -Uri "$apiBase/$igAccountId/media" -Method Post -Body $body -TimeoutSec 30 -ErrorAction Stop
            $childIds += $result.id
            Write-Step "  Slide $($i + 1): container $($result.id)" "DarkGray"
        }
        catch {
            Write-Step "  Failed slide $($i + 1): $($_.Exception.Message)" "Red"
            return $null
        }
        Start-Sleep -Milliseconds 500
    }

    # Step 2: Carousel container
    Write-Step "Creating carousel container..."
    $carouselBody = @{
        media_type   = "CAROUSEL"
        children     = ($childIds -join ",")
        caption      = $caption
        access_token = $accessToken
    }
    # Manually UTF-8 encode the form body (PS 5.1 default encoding corrupts Cyrillic)
    $formParts = @()
    foreach ($k in $carouselBody.Keys) {
        $formParts += "$k=$([System.Uri]::EscapeDataString($carouselBody[$k]))"
    }
    $formBytes = [System.Text.Encoding]::UTF8.GetBytes($formParts -join "&")
    try {
        $carouselResult = Invoke-RestMethod -Uri "$apiBase/$igAccountId/media" -Method Post -Body $formBytes -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30 -ErrorAction Stop
        $carouselId = $carouselResult.id
        Write-Step "Carousel container: $carouselId" "DarkGray"
    }
    catch {
        Write-Step "Failed to create carousel: $($_.Exception.Message)" "Red"
        return $null
    }

    # Step 3: Wait for processing
    Write-Step "Waiting for media processing..."
    $maxWait = 90
    $waited = 0
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 5
        $waited += 5
        try {
            $statusResult = Invoke-RestMethod -Uri "$apiBase/$carouselId`?fields=status_code&access_token=$accessToken" -Method Get -TimeoutSec 15
            if ($statusResult.status_code -eq "FINISHED") {
                Write-Step "Media processing complete" "Green"
                break
            }
            elseif ($statusResult.status_code -eq "ERROR") {
                Write-Step "Media processing failed" "Red"
                return $null
            }
            Write-Step "  Processing... ($waited s)" "DarkGray"
        }
        catch {
            Write-Step "  Waiting... ($waited s)" "DarkGray"
        }
    }

    # Step 4: Publish
    Write-Step "Publishing carousel post..."
    $publishBody = @{
        creation_id  = $carouselId
        access_token = $accessToken
    }
    try {
        $publishResult = Invoke-RestMethod -Uri "$apiBase/$igAccountId/media_publish" -Method Post -Body $publishBody -TimeoutSec 30 -ErrorAction Stop
        return $publishResult.id
    }
    catch {
        Write-Step "Failed to publish: $($_.Exception.Message)" "Red"
        return $null
    }
}

function Update-Instagram {
    Write-Section "TASK 4: INSTAGRAM WEEKLY CHART"

    # Only post on Mondays (or when forced with -Only instagram)
    $isMonday = (Get-Date).DayOfWeek -eq [DayOfWeek]::Monday
    $isForced = $Only -eq "instagram"

    if (-not $isMonday -and -not $isForced) {
        Write-Step "Not Monday - skipping Instagram post (use -Only instagram to force)" "DarkGray"
        return $true
    }

    if ($isForced -and -not $isMonday) {
        Write-Step "Forced run (not Monday)" "DarkYellow"
    }

    # Check if we already posted this week
    $weekLabel = Get-WeekLabel
    $state = Get-RunState
    if ($state -and $state.lastIgPostWeek -and $state.lastIgPostWeek -eq $weekLabel) {
        Write-Step "Already posted for $weekLabel - skipping (clear lastIgPostWeek in .last-run-state.json to repost)" "DarkGray"
        return $true
    }

    # Load credentials
    $credentialsPath = Join-Path $scriptRoot "instagram-credentials.json"
    if (-not (Test-Path $credentialsPath)) {
        Write-Step "instagram-credentials.json not found, skipping" "Red"
        return $false
    }

    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse instagram-credentials.json" "Red"
        return $false
    }

    if (-not $creds.accessToken -or -not $creds.igBusinessAccountId) {
        Write-Step "instagram-credentials.json must contain accessToken and igBusinessAccountId" "Red"
        return $false
    }

    # Refresh token
    $tokenValid = Refresh-InstagramToken $creds $credentialsPath
    if (-not $tokenValid) { return $false }
    $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json

    # Load chart data
    $chartPath = Join-Path $scriptRoot "chart-data.json"
    if (-not (Test-Path $chartPath)) {
        Write-Step "chart-data.json not found - run chart task first" "Red"
        return $false
    }
    $chartData = Get-Content $chartPath -Raw -Encoding UTF8 | ConvertFrom-Json

    # Load bands.json for Instagram handles
    $bandsPath = Join-Path $scriptRoot "bands.json"
    $igHandles = @{}
    if (Test-Path $bandsPath) {
        $bandsData = Get-Content $bandsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($band in $bandsData.muzickaMasterLista) {
            if ($band.links -and $band.links.instagram) {
                if ($band.links.instagram -match "instagram\.com/([^/?]+)") {
                    $handle = "@$($matches[1].TrimEnd('/'))"
                    $igHandles[$band.name] = $handle
                }
            }
        }
        Write-Step "Loaded $($igHandles.Count) Instagram handles from bands.json"
    }

    # Singles chart: filter singles, take 20 most recent by date, sort by popularity, dedup collabs
    $topReleases = Get-SinglesChart $chartData.releases 10

    if ($topReleases.Count -lt 3) {
        Write-Step "Need at least 3 singles for carousel, found $($topReleases.Count)" "Red"
        return $false
    }

    Write-Step "Top $($topReleases.Count) singles:"
    for ($i = 0; $i -lt $topReleases.Count; $i++) {
        $r = $topReleases[$i]
        $songName = if ($r.topTrackName) { $r.topTrackName } else { $r.releaseTitle }
        $h = if ($igHandles.ContainsKey($r.bandName)) { " $($igHandles[$r.bandName])" } else { "" }
        Write-Host "    $($i+1). $($r.bandName)$h - $songName (pop: $($r.popularity))" -ForegroundColor Gray
    }
    Write-Host ""

    # --- Generate 5 slide images ---
    $tempDir = Join-Path $scriptRoot ".ig-temp"
    if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

    $slideFiles = @()

    # Slide 1: Title card (logo + "Топ Синглови" + week)
    Write-Step "Generating slide 1 (Title)..."
    $titleBmp = New-TitleSlide $weekLabel
    $titlePath = Join-Path $tempDir "slide-1-title.jpg"
    Save-SlideAsJpeg $titleBmp $titlePath
    $titleBmp.Dispose()
    $slideFiles += $titlePath
    Write-Step "  Saved: slide-1-title.jpg" "DarkGray"

    # Slides 2-4: Individual release cards for #1, #2, #3
    for ($i = 0; $i -lt 3; $i++) {
        $rank = $i + 1
        Write-Step "Generating slide $($rank + 1) (no. ${rank}: $($topReleases[$i].bandName))..."
        $handle = if ($igHandles.ContainsKey($topReleases[$i].bandName)) { $igHandles[$topReleases[$i].bandName] } else { $null }
        $relBmp = New-ReleaseSlide $topReleases[$i] $rank $handle $weekLabel
        $relPath = Join-Path $tempDir "slide-$($rank + 1)-release.jpg"
        Save-SlideAsJpeg $relBmp $relPath
        $relBmp.Dispose()
        $slideFiles += $relPath
        Write-Step "  Saved: slide-$($rank + 1)-release.jpg" "DarkGray"
    }

    # Slide 5: Full top 10 list
    Write-Step "Generating slide 5 (Top 10 list)..."
    $listBmp = New-ListSlide $topReleases $igHandles $weekLabel
    $listPath = Join-Path $tempDir "slide-5-list.jpg"
    Save-SlideAsJpeg $listBmp $listPath
    $listBmp.Dispose()
    $slideFiles += $listPath
    Write-Step "  Saved: slide-5-list.jpg" "DarkGray"

    # Slide 6: Promo / CTA slide
    Write-Step "Generating slide 6 (Promo)..."
    $promoBmp = New-PromoSlide $weekLabel
    $promoPath = Join-Path $tempDir "slide-6-promo.jpg"
    Save-SlideAsJpeg $promoBmp $promoPath
    $promoBmp.Dispose()
    $slideFiles += $promoPath
    Write-Step "  Saved: slide-6-promo.jpg" "DarkGray"

    Write-Step "Generated $($slideFiles.Count) slides" "Green"

    # --- Upload slides to temp host ---
    Write-Step "Uploading slides to temporary image host..."
    $imageUrls = @()
    foreach ($slidePath in $slideFiles) {
        $fileName = [System.IO.Path]::GetFileName($slidePath)
        Write-Step "  Uploading $fileName..." "DarkGray"
        $url = Upload-TempImage $slidePath
        if (-not $url) {
            Write-Step "  Failed to upload $fileName" "Red"
            # Cleanup
            Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
            return $false
        }
        $imageUrls += $url
        Write-Step "  -> $url" "DarkGray"
        Start-Sleep -Milliseconds 300
    }
    Write-Step "All $($imageUrls.Count) slides uploaded" "Green"

    # --- Build caption ---
    $caption = Build-InstagramCaption $topReleases $igHandles $weekLabel
    Write-Step "Caption built ($($caption.Length) chars)"

    # --- Post carousel ---
    Write-Step "Posting 6-slide carousel to Instagram..."
    $postId = Publish-InstagramCarousel $creds.igBusinessAccountId $creds.accessToken $imageUrls $caption

    # Cleanup temp files
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    if ($postId) {
        Write-Step "Instagram carousel published! Post ID: $postId" "Green"

        # Record that we posted for this week so we don't double-post
        $state = Get-RunState
        if (-not $state) { $state = [PSCustomObject]@{} }
        if ($state.PSObject.Properties.Name -contains 'lastIgPostWeek') {
            $state.lastIgPostWeek = $weekLabel
        } else {
            $state | Add-Member -NotePropertyName 'lastIgPostWeek' -NotePropertyValue $weekLabel -Force
        }
        Save-RunState $state
        Write-Step "Recorded post for $weekLabel in run state" "DarkGray"

        return $true
    }
    else {
        Write-Step "Instagram posting failed" "Red"
        return $false
    }
}

# ============================================================================
#  MAIN
# ============================================================================

$startTime = Get-Date

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host "  MASTER LISTA - UNIFIED UPDATE" -ForegroundColor Magenta
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
Write-Host ("=" * 70) -ForegroundColor Magenta

# Determine which tasks to run
$runChart     = -not $SkipChart
$runArticles  = -not $SkipArticles
$runLinks     = -not $SkipLinks
$runInstagram = -not $SkipInstagram

if ($Only) {
    $runChart     = $Only -eq "chart"
    $runArticles  = $Only -eq "articles"
    $runLinks     = $Only -eq "links"
    $runInstagram = $Only -eq "instagram"
}

$results = @{}

# --- Task 1: Chart Data ---
if ($runChart) {
    $results["Chart Data"] = Update-ChartData
}
else {
    Write-Step "Skipping chart data" "DarkGray"
}

# --- Task 2: Articles ---
if ($runArticles) {
    $results["Articles"] = Update-Articles
}
else {
    Write-Step "Skipping articles" "DarkGray"
}

# --- Task 3: Service Links ---
if ($runLinks) {
    $results["Service Links"] = Update-ServiceLinks
}
else {
    Write-Step "Skipping service links" "DarkGray"
}

# --- Task 4: Instagram ---
if ($runInstagram) {
    $results["Instagram"] = Update-Instagram
}
else {
    Write-Step "Skipping Instagram posting" "DarkGray"
}

# --- Save run state (always, so bands.json baseline is tracked) ---
$bandsJsonPath = Join-Path $scriptRoot "bands.json"
$artistNames = @()
if (Test-Path $bandsJsonPath) {
    try {
        $bd = Get-Content $bandsJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $artistNames = @($bd.muzickaMasterLista | ForEach-Object { $_.name })
    }
    catch { }
}

# Merge into existing state so fields like lastIgPostWeek are preserved
$runState = Get-RunState
if (-not $runState) { $runState = [PSCustomObject]@{} }

$mergeFields = @{
    lastRun     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    artistNames = $artistNames
    artistCount = $artistNames.Count
}
foreach ($key in $mergeFields.Keys) {
    if ($runState.PSObject.Properties.Name -contains $key) {
        $runState.$key = $mergeFields[$key]
    } else {
        $runState | Add-Member -NotePropertyName $key -NotePropertyValue $mergeFields[$key] -Force
    }
}
Save-RunState $runState

# --- Summary ---
$elapsed = (Get-Date) - $startTime

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host "  SUMMARY" -ForegroundColor Magenta
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host ""

foreach ($task in $results.Keys) {
    $status = if ($results[$task]) { "OK" } else { "FAILED" }
    $color = if ($results[$task]) { "Green" } else { "Red" }
    Write-Host "  [$status] $task" -ForegroundColor $color
}

Write-Host ""
Write-Host "  Completed in $([math]::Round($elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
Write-Host ""
