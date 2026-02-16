# update-all.ps1
# Unified update script for Macedonian Music Master Lista
#
# Tasks:
#   1. Chart data - Fetches Spotify data and generates chart-data.json + weekly snapshots
#   2. Articles   - Fetches RSS feeds for today's articles, archives to articles.json
#   2b. Scrape    - Scrapes sites for articles not in RSS, merges into articles.json
#   3. Service links - Detects new bands.json entries and extracts streaming links for them
#   4. Instagram  - Delegates to scripts/instagram.ps1 (weekly chart carousel)
#   5. Curators   - Fetches playlist tracklists for curators from streaming APIs
#
# Usage:
#   ./update-all.ps1               # Run all tasks
#   ./update-all.ps1 -SkipChart    # Skip chart generation
#   ./update-all.ps1 -SkipArticles # Skip RSS archiving
#   ./update-all.ps1 -SkipScrape   # Skip article scraping
#   ./update-all.ps1 -SkipLinks    # Skip service link extraction
#   ./update-all.ps1 -SkipInstagram # Skip Instagram posting
#   ./update-all.ps1 -SkipCurators # Skip curator tracklist generation
#   ./update-all.ps1 -Only chart   # Run only chart task
#   ./update-all.ps1 -Only articles # Run only articles task
#   ./update-all.ps1 -Only scrape  # Run only article scraping
#   ./update-all.ps1 -Only links   # Run only service links task
#   ./update-all.ps1 -Only instagram # Run only Instagram posting
#   ./update-all.ps1 -Only curators # Run only curator tracklists

param(
    [switch]$SkipChart,
    [switch]$SkipArticles,
    [switch]$SkipScrape,
    [switch]$SkipLinks,
    [switch]$SkipInstagram,
    [switch]$SkipCurators,
    [ValidateSet("chart", "articles", "scrape", "links", "instagram", "curators")]
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

function Write-Elapsed {
    param([datetime]$Start)
    $sec = [math]::Round(((Get-Date) - $Start).TotalSeconds, 1)
    Write-Host "  > Completed in ${sec}s" -ForegroundColor DarkGray
}

# Overall-progress helper (call before each task)
$script:taskIndex = 0
$script:taskTotal = 0
function Set-OverallProgress {
    param([string]$TaskName)
    $script:taskIndex++
    $pct = [math]::Floor(($script:taskIndex / $script:taskTotal) * 100)
    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 0)
    Write-Progress -Id 0 -Activity "Master Lista Update  [${elapsed}s]" `
        -Status "Task $($script:taskIndex)/$($script:taskTotal): $TaskName" `
        -PercentComplete $pct
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
    $chartStart = Get-Date
    # Use async event-based I/O to avoid stdout/stderr deadlock
    # and allow the elapsed timer to update continuously
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "`"$nodeScript`""
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $psi.WorkingDirectory = $scriptRoot

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi

        # Thread-safe queue for collecting output asynchronously
        $outputQueue = [System.Collections.Concurrent.ConcurrentQueue[PSCustomObject]]::new()

        # Register async event handlers so stdout and stderr are drained in parallel
        $stdoutEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
            if ($EventArgs.Data) {
                $Event.MessageData.Enqueue([PSCustomObject]@{ Stream = 'out'; Text = $EventArgs.Data })
            }
        } -MessageData $outputQueue

        $stderrEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
            if ($EventArgs.Data) {
                $Event.MessageData.Enqueue([PSCustomObject]@{ Stream = 'err'; Text = $EventArgs.Data })
            }
        } -MessageData $outputQueue

        $null = $proc.Start()
        $proc.BeginOutputReadLine()
        $proc.BeginErrorReadLine()

        $lastOutputTime = Get-Date
        $lastStatus = "Starting..."
        $lastPct = -1
        $stalled = $false
        $STALL_WARN_SEC = 30
        $STALL_TIMEOUT_SEC = 180

        # Poll loop: process queued output and keep the timer/progress bar alive
        while (-not $proc.HasExited) {
            $gotOutput = $false
            $item = $null

            while ($outputQueue.TryDequeue([ref]$item)) {
                $gotOutput = $true
                $lastOutputTime = Get-Date
                $stalled = $false

                if ($item.Stream -eq 'out') {
                    # Parse percentage from node output like "Processing albums batch 3/15 (20%)"
                    if ($item.Text -match '\((\d+)%\)') {
                        $lastPct = [int]$Matches[1]
                    }
                    $lastStatus = $item.Text
                    Write-Host "    [node] $($item.Text)" -ForegroundColor DarkGray
                }
                else {
                    Write-Host "    [node] $($item.Text)" -ForegroundColor DarkYellow
                }
            }

            # Update progress bar on every tick (even without new output)
            $elapsed = [math]::Round(((Get-Date) - $chartStart).TotalSeconds, 0)
            $silentSec = [math]::Round(((Get-Date) - $lastOutputTime).TotalSeconds, 0)

            $statusText = $lastStatus
            if ($silentSec -ge $STALL_WARN_SEC) {
                $statusText = "$lastStatus  (no output for ${silentSec}s - waiting on API?)"
                if (-not $stalled) {
                    Write-Host "    [wait] No output for ${STALL_WARN_SEC}s, still waiting on Spotify API..." -ForegroundColor Yellow
                    $stalled = $true
                }
            }
            if ($silentSec -ge $STALL_TIMEOUT_SEC) {
                Write-Host "    [timeout] No output for ${STALL_TIMEOUT_SEC}s, killing node process" -ForegroundColor Red
                $proc.Kill()
                break
            }

            $progressParams = @{
                Id       = 1
                Activity = "Chart Data  [${elapsed}s elapsed]"
                Status   = $statusText
            }
            if ($lastPct -ge 0) {
                $progressParams.PercentComplete = $lastPct
            }
            Write-Progress @progressParams

            Start-Sleep -Milliseconds 500
        }

        # Drain any remaining queued output
        $item = $null
        while ($outputQueue.TryDequeue([ref]$item)) {
            if ($item.Stream -eq 'out') {
                Write-Host "    [node] $($item.Text)" -ForegroundColor DarkGray
            }
            else {
                Write-Host "    [node] $($item.Text)" -ForegroundColor DarkYellow
            }
        }

        $proc.WaitForExit()
        Write-Progress -Id 1 -Activity "Chart Data" -Completed

        # Clean up event registrations
        Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue
        Remove-Job -Id $stdoutEvent.Id -Force -ErrorAction SilentlyContinue
        Remove-Job -Id $stderrEvent.Id -Force -ErrorAction SilentlyContinue

        if ($proc.ExitCode -ne 0) {
            Write-Step "Node script exited with code $($proc.ExitCode)" "Red"
            return $false
        }
    }
    catch {
        Write-Progress -Id 1 -Activity "Chart Data" -Completed
        Write-Step "Failed to run node script: $_" "Red"
        return $false
    }

    Write-Step "Chart data updated successfully" "Green"

    # --- Post-process: Patch artist images from external services ---
    Write-Step "Patching artist images from external services..."
    $patchScript = Join-Path $scriptRoot "scripts\patch-artist-images.js"
    try {
        $patchOutput = & node $patchScript 2>&1
        foreach ($line in $patchOutput) {
            if ($line) {
                Write-Host "    [patch] $line" -ForegroundColor DarkGray
            }
        }
        Write-Step "Artist images patched" "Green"
    }
    catch {
        Write-Step "Patch artist images failed (non-critical): $_" "Yellow"
    }

    Write-Elapsed $chartStart
    return $true
}

# ============================================================================
#  TASK 2: RSS FEED ARTICLES
# ============================================================================

function Update-Articles {
    Write-Section "TASK 2: RSS FEED ARTICLES"
    $articleStart = Get-Date

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
    $feedIndex = 0

    foreach ($feed in $feeds) {
        $feedIndex++
        $feedName = $feed.name
        $pct = [math]::Floor(($feedIndex / $feeds.Count) * 100)
        $elapsed = [math]::Round(((Get-Date) - $articleStart).TotalSeconds, 0)
        Write-Progress -Id 1 -Activity "RSS Feeds  [${elapsed}s elapsed]" `
            -Status "[$feedIndex/$($feeds.Count)] $feedName" `
            -PercentComplete $pct
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

    Write-Progress -Id 1 -Activity "RSS Feeds" -Completed
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

    Write-Elapsed $articleStart
    return $true
}

# ============================================================================
#  TASK 2b: SCRAPE ARTICLES (complement to RSS)
# ============================================================================

function Update-ScrapeArticles {
    Write-Section "TASK 2b: SCRAPE ARTICLES"
    $scrapeStart = Get-Date

    $scrapeScript = Join-Path (Join-Path $scriptRoot "scripts") "scrape-articles.js"
    if (-not (Test-Path $scrapeScript)) {
        Write-Step "scripts/scrape-articles.js not found, skipping" "Red"
        return $false
    }

    Write-Step "Running article scraper (WP API + HTML)..."
    try {
        # Temporarily allow stderr (non-fatal site warnings) without terminating
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = & node $scrapeScript 2>&1
        $scrapeExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP

        foreach ($line in $output) {
            if ($line -is [System.Management.Automation.ErrorRecord]) {
                Write-Host "    $($line.ToString())" -ForegroundColor DarkYellow
            } else {
                Write-Host "    $line" -ForegroundColor Gray
            }
        }

        if ($scrapeExit -ne 0) {
            Write-Step "Scraper finished with exit code $scrapeExit" "DarkYellow"
        } else {
            Write-Step "Scraper completed successfully" "Green"
        }
    }
    catch {
        $ErrorActionPreference = $prevEAP
        Write-Step "Scraper failed: $_" "Red"
        return $false
    }

    Write-Elapsed $scrapeStart
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
    $linksStart = Get-Date

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
    $processedCount = 0

    for ($i = 0; $i -lt $bandsData.muzickaMasterLista.Count; $i++) {
        $artist = $bandsData.muzickaMasterLista[$i]
        if (-not $newEntrySet.ContainsKey($artist.name)) { continue }

        $processedCount++
        $pct = [math]::Floor(($processedCount / $newEntries.Count) * 100)
        $elapsed = [math]::Round(((Get-Date) - $linksStart).TotalSeconds, 0)
        Write-Progress -Id 1 -Activity "Service Links  [${elapsed}s elapsed]" `
            -Status "[$processedCount/$($newEntries.Count)] $($artist.name)" `
            -PercentComplete $pct

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

    Write-Progress -Id 1 -Activity "Service Links" -Completed
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

    Write-Elapsed $linksStart
    return $true
}

# ============================================================================
#  TASK 4: INSTAGRAM WEEKLY CHART POST
#  (Delegated to scripts/instagram.ps1 - can also run independently)
# ============================================================================

function Update-Instagram {
    Write-Section "TASK 4: INSTAGRAM WEEKLY CHART"

    # Delegate to standalone script (supports review, alt charts, etc.)
    $igScript = Join-Path $scriptRoot "scripts\instagram.ps1"
    if (-not (Test-Path $igScript)) {
        Write-Step "scripts/instagram.ps1 not found" "Red"
        return $false
    }

    # When called from update-all, skip review (automated) and force (ignore day check)
    $isForced = $Only -eq "instagram"
    $forceFlag = if ($isForced) { "-Force" } else { "" }

    Write-Step "Running scripts/instagram.ps1 -SkipReview $forceFlag..."
    try {
        $igArgs = @{ SkipReview = $true }
        if ($isForced) { $igArgs["Force"] = $true }
        & $igScript @igArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Step "Instagram script exited with code $LASTEXITCODE" "Red"
            return $false
        }
    }
    catch {
        Write-Step "Instagram script failed: $_" "Red"
        return $false
    }

    Write-Step "Instagram task completed" "Green"
    return $true
}


function Update-CuratorTracklists {
    Write-Section "TASK 5: CURATOR TRACKLISTS"

    $curatorScript = Join-Path $scriptRoot "scripts\generate-curator-tracklists.ps1"
    if (-not (Test-Path $curatorScript)) {
        Write-Step "scripts/generate-curator-tracklists.ps1 not found" "Red"
        return $false
    }

    Write-Step "Running curator tracklist generation..."
    try {
        & $curatorScript
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            Write-Step "Curator tracklist script exited with code $LASTEXITCODE" "Red"
            return $false
        }
    }
    catch {
        Write-Step "Curator tracklist script failed: $_" "Red"
        return $false
    }

    $outputPath = Join-Path $scriptRoot "curators-tracklists.json"
    if (Test-Path $outputPath) {
        $size = [math]::Round((Get-Item $outputPath).Length / 1KB, 1)
        Write-Step "Generated curators-tracklists.json (${size} KB)" "Green"
    }

    Write-Step "Curator tracklists completed" "Green"
    return $true
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
$runScrape    = -not $SkipScrape
$runLinks     = -not $SkipLinks
$runInstagram = -not $SkipInstagram
$runCurators  = -not $SkipCurators

if ($Only) {
    $runChart     = $Only -eq "chart"
    $runArticles  = $Only -eq "articles"
    $runScrape    = $Only -eq "scrape"
    $runLinks     = $Only -eq "links"
    $runInstagram = $Only -eq "instagram"
    $runCurators  = $Only -eq "curators"
}

$results = @{}
$taskTimings = @{}

# Count how many tasks will actually run for the overall progress bar
$script:taskTotal = @($runChart, $runArticles, $runScrape, $runLinks, $runInstagram, $runCurators) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
$script:taskIndex = 0

# --- Task 1: Chart Data ---
if ($runChart) {
    Set-OverallProgress "Chart Data"
    $t = Get-Date
    $results["Chart Data"] = Update-ChartData
    $taskTimings["Chart Data"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping chart data" "DarkGray"
}

# --- Task 2: Articles ---
if ($runArticles) {
    Set-OverallProgress "Articles"
    $t = Get-Date
    $results["Articles"] = Update-Articles
    $taskTimings["Articles"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping articles" "DarkGray"
}

# --- Task 2b: Scrape Articles ---
if ($runScrape) {
    Set-OverallProgress "Scrape Articles"
    $t = Get-Date
    $results["Scrape Articles"] = Update-ScrapeArticles
    $taskTimings["Scrape Articles"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping article scraping" "DarkGray"
}

# --- Task 3: Service Links ---
if ($runLinks) {
    Set-OverallProgress "Service Links"
    $t = Get-Date
    $results["Service Links"] = Update-ServiceLinks
    $taskTimings["Service Links"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping service links" "DarkGray"
}

# --- Task 4: Instagram ---
if ($runInstagram) {
    Set-OverallProgress "Instagram"
    $t = Get-Date
    $results["Instagram"] = Update-Instagram
    $taskTimings["Instagram"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping Instagram posting" "DarkGray"
}

# --- Task 5: Curator Tracklists ---
if ($runCurators) {
    Set-OverallProgress "Curator Tracklists"
    $t = Get-Date
    $results["Curator Tracklists"] = Update-CuratorTracklists
    $taskTimings["Curator Tracklists"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping curator tracklists" "DarkGray"
}

Write-Progress -Id 0 -Activity "Master Lista Update" -Completed

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
    $timing = if ($taskTimings.ContainsKey($task)) { " ($($taskTimings[$task])s)" } else { "" }
    Write-Host "  [$status] $task$timing" -ForegroundColor $color
}

Write-Host ""
Write-Host "  Completed in $([math]::Round($elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
Write-Host ""
