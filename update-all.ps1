# update-all.ps1
# Unified update script for Macedonian Music Master Lista
#
# Tasks:
#   1.  Chart data   - Fetches Spotify data and generates chart-data.json + weekly snapshots
#   1b. YT Matching  - Matches release tracks to YouTube videos, saves unverified links to releases.json
#   1c. Verification - Pushes releases.json to GitHub, waits for manual link verification
#   1d. YT Popularity - Calculates YouTube-based popularity scores, patches chart-data.json
#   2.  Scrape       - Scrapes sites for articles and interview channels, updates raw and filtered media feeds
#   3.  Service links - Detects new bands.json entries and extracts streaming links for them
#   4.  Curators     - Fetches playlist tracklists for curators from streaming APIs
#   4b. Playlists    - Updates Spotify playlists (top current, top all-time, new releases)
#   5.  Site Master  - Generates site-master.json with all pre-computed data for client pages
#
# Usage:
#   ./update-all.ps1               # Run all tasks
#   ./update-all.ps1 -SkipChart    # Skip chart generation
#   ./update-all.ps1 -SkipScrape   # Skip article scraping
#   ./update-all.ps1 -SkipLinks    # Skip service link extraction
#   ./update-all.ps1 -SkipCurators # Skip curator tracklist generation
#   ./update-all.ps1 -SkipPlaylists # Skip Spotify playlist update
#   ./update-all.ps1 -SkipYouTubeMatching   # Skip YouTube link matching
#   ./update-all.ps1 -SkipVerification       # Skip YouTube verification wait (proceed directly)
#   ./update-all.ps1 -VerificationTimeoutMinutes 60 # Continue if verification is not done within 1 hour
#   ./update-all.ps1 -AutomationPhase publish-verification # Run pre-verification tasks and publish releases.json
#   ./update-all.ps1 -AutomationPhase finalize-after-verification # Run post-verification tasks
#   ./update-all.ps1 -SkipYouTubePopularity # Skip YouTube popularity calculation
#   ./update-all.ps1 -SkipSiteMaster # Skip site-master.json generation
#   ./update-all.ps1 -SkipRadio # Skip radio source generation
#   ./update-all.ps1 -Only cleanup  # Run only release cleanup
#   ./update-all.ps1 -Only chart   # Run only chart task
#   ./update-all.ps1 -Only ytmatching  # Run only YouTube link matching
#   ./update-all.ps1 -Only ytpopularity # Run only YouTube popularity calculation
#   ./update-all.ps1 -Only scrape  # Run only article scraping
#   ./update-all.ps1 -Only links   # Run only service links task
#   ./update-all.ps1 -Only curators # Run only curator tracklists
#   ./update-all.ps1 -Only playlists # Run only Spotify playlist update
#   ./update-all.ps1 -Only sitemaster # Run only site-master generation
#   ./update-all.ps1 -Only radio # Run only radio source generation

param(
    [switch]$SkipChart,
    [switch]$SkipScrape,
    [switch]$SkipLinks,
    [switch]$SkipYouTubeMatching,
    [switch]$SkipVerification,
    [switch]$SkipYouTubePopularity,
    [int]$VerificationTimeoutMinutes = 0,
    [ValidateSet("full", "publish-verification", "finalize-after-verification")]
    [string]$AutomationPhase = "full",
    [switch]$SkipCurators,
    [switch]$SkipPlaylists,
    [switch]$SkipSiteMaster,
    [switch]$SkipRadio,
    [switch]$SkipCleanup,
    [ValidateSet("cleanup", "chart", "ytmatching", "ytpopularity", "scrape", "links", "curators", "playlists", "sitemaster", "radio")]
    [string]$Only
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web

$scriptRoot = $PSScriptRoot
$configRoot = Join-Path $scriptRoot "config"
$credentialsRoot = Join-Path $configRoot "credentials"
$cacheRoot = Join-Path $scriptRoot ".cache"
$backupsRoot = Join-Path $scriptRoot "backups"
$staticDataRoot = Join-Path $scriptRoot "data\static"
$editableDataRoot = Join-Path $scriptRoot "data\dynamic\editable"
$generatedDataRoot = Join-Path $scriptRoot "data\dynamic\generated"
$releasesRepoPath = "data/dynamic/editable/releases.json"

if (-not (Test-Path $cacheRoot)) {
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
}

if (-not (Test-Path $backupsRoot)) {
    New-Item -ItemType Directory -Path $backupsRoot -Force | Out-Null
}

$statePath = Join-Path $cacheRoot "last-run-state.json"

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

$script:YouTubeApiUnits = 0
function Add-YouTubeApiUnitsFromLine {
    param([object]$Line)

    $text = [string]$Line
    if ($text -match 'YouTube API quota used:\s*~?([0-9,]+)\s+units') {
        $unitText = $Matches[1] -replace ',', ''
        $units = 0
        if ([int]::TryParse($unitText, [ref]$units)) {
            $script:YouTubeApiUnits += $units
        }
    }
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

    $credentialsPath = Join-Path $credentialsRoot "spotify-credentials.json"

    if (-not (Test-Path $credentialsPath)) {
        Write-Step "config/credentials/spotify-credentials.json not found, skipping chart update" "Red"
        return $false
    }

    Write-Step "Reading Spotify credentials..."
    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse config/credentials/spotify-credentials.json" "Red"
        return $false
    }

    if (-not $creds.clientId -or -not $creds.clientSecret) {
        Write-Step "config/credentials/spotify-credentials.json must contain clientId and clientSecret" "Red"
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
#  TASK 1b: YOUTUBE POPULARITY
# ============================================================================

function Update-YouTubePopularity {
    Write-Section "TASK 1b: YOUTUBE POPULARITY"

    $credentialsPath = Join-Path $credentialsRoot "youtube-credentials.json"

    if (-not (Test-Path $credentialsPath)) {
        Write-Step "config/credentials/youtube-credentials.json not found, skipping YouTube popularity" "Red"
        return $false
    }

    Write-Step "Reading YouTube credentials..."
    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse config/credentials/youtube-credentials.json" "Red"
        return $false
    }

    if (-not $creds.apiKey) {
        Write-Step "config/credentials/youtube-credentials.json must contain apiKey" "Red"
        return $false
    }

    $env:YOUTUBE_API_KEY = $creds.apiKey

    $nodeScript = Join-Path $scriptRoot "scripts\generate-chart-data-youtube.js"
    if (-not (Test-Path $nodeScript)) {
        Write-Step "scripts/generate-chart-data-youtube.js not found" "Red"
        return $false
    }

    Write-Step "Running YouTube popularity calculation..."
    $ytStart = Get-Date
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

        $outputQueue = [System.Collections.Concurrent.ConcurrentQueue[PSCustomObject]]::new()

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

        while (-not $proc.HasExited) {
            $item = $null

            while ($outputQueue.TryDequeue([ref]$item)) {
                $lastOutputTime = Get-Date

                if ($item.Stream -eq 'out') {
                    Add-YouTubeApiUnitsFromLine $item.Text
                    if ($item.Text -match '\((\d+)%\)') {
                        $lastPct = [int]$Matches[1]
                    }
                    $lastStatus = $item.Text
                    Write-Host "    [yt] $($item.Text)" -ForegroundColor DarkGray
                }
                else {
                    Write-Host "    [yt] $($item.Text)" -ForegroundColor DarkYellow
                }
            }

            $elapsed = [math]::Round(((Get-Date) - $ytStart).TotalSeconds, 0)
            $progressParams = @{
                Id       = 1
                Activity = "YouTube Popularity  [${elapsed}s elapsed]"
                Status   = $lastStatus
            }
            if ($lastPct -ge 0) {
                $progressParams.PercentComplete = $lastPct
            }
            Write-Progress @progressParams

            Start-Sleep -Milliseconds 500
        }

        # Drain remaining output
        $item = $null
        while ($outputQueue.TryDequeue([ref]$item)) {
            if ($item.Stream -eq 'out') {
                Add-YouTubeApiUnitsFromLine $item.Text
                Write-Host "    [yt] $($item.Text)" -ForegroundColor DarkGray
            }
            else {
                Write-Host "    [yt] $($item.Text)" -ForegroundColor DarkYellow
            }
        }

        $proc.WaitForExit()
        Write-Progress -Id 1 -Activity "YouTube Popularity" -Completed

        Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue
        Remove-Job -Id $stdoutEvent.Id -Force -ErrorAction SilentlyContinue
        Remove-Job -Id $stderrEvent.Id -Force -ErrorAction SilentlyContinue

        if ($proc.ExitCode -ne 0) {
            Write-Step "YouTube popularity script exited with code $($proc.ExitCode)" "Red"
            return $false
        }
    }
    catch {
        Write-Progress -Id 1 -Activity "YouTube Popularity" -Completed
        Write-Step "Failed to run YouTube popularity script: $_" "Red"
        return $false
    }

    Write-Step "YouTube popularity updated successfully" "Green"
    Write-Elapsed $ytStart
    return $true
}

# ============================================================================
#  TASK 1b: YOUTUBE LINK MATCHING (match-only mode)
# ============================================================================

function Update-YouTubeMatching {
    Write-Section "TASK 1b: YOUTUBE LINK MATCHING"

    $credentialsPath = Join-Path $credentialsRoot "youtube-credentials.json"

    if (-not (Test-Path $credentialsPath)) {
        Write-Step "config/credentials/youtube-credentials.json not found, skipping" "Red"
        return $false
    }

    Write-Step "Reading YouTube credentials..."
    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse config/credentials/youtube-credentials.json" "Red"
        return $false
    }

    if (-not $creds.apiKey) {
        Write-Step "config/credentials/youtube-credentials.json must contain apiKey" "Red"
        return $false
    }

    $env:YOUTUBE_API_KEY = $creds.apiKey

    $nodeScript = Join-Path $scriptRoot "scripts\generate-chart-data-youtube.js"
    if (-not (Test-Path $nodeScript)) {
        Write-Step "scripts/generate-chart-data-youtube.js not found" "Red"
        return $false
    }

    Write-Step "Running YouTube link matching (match-only mode)..."
    $matchStart = Get-Date
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "`"$nodeScript`" --match-only"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $psi.WorkingDirectory = $scriptRoot

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi

        $outputQueue = [System.Collections.Concurrent.ConcurrentQueue[PSCustomObject]]::new()

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

        $lastStatus = "Starting..."
        $lastPct = -1

        while (-not $proc.HasExited) {
            $item = $null

            while ($outputQueue.TryDequeue([ref]$item)) {
                if ($item.Stream -eq 'out') {
                    Add-YouTubeApiUnitsFromLine $item.Text
                    if ($item.Text -match '\((\d+)%\)') {
                        $lastPct = [int]$Matches[1]
                    }
                    $lastStatus = $item.Text
                    Write-Host "    [yt-match] $($item.Text)" -ForegroundColor DarkGray
                }
                else {
                    Write-Host "    [yt-match] $($item.Text)" -ForegroundColor DarkYellow
                }
            }

            $elapsed = [math]::Round(((Get-Date) - $matchStart).TotalSeconds, 0)
            $progressParams = @{
                Id       = 1
                Activity = "YouTube Link Matching  [${elapsed}s elapsed]"
                Status   = $lastStatus
            }
            if ($lastPct -ge 0) {
                $progressParams.PercentComplete = $lastPct
            }
            Write-Progress @progressParams

            Start-Sleep -Milliseconds 500
        }

        # Drain remaining output
        $item = $null
        while ($outputQueue.TryDequeue([ref]$item)) {
            if ($item.Stream -eq 'out') {
                Add-YouTubeApiUnitsFromLine $item.Text
                Write-Host "    [yt-match] $($item.Text)" -ForegroundColor DarkGray
            }
            else {
                Write-Host "    [yt-match] $($item.Text)" -ForegroundColor DarkYellow
            }
        }

        $proc.WaitForExit()
        Write-Progress -Id 1 -Activity "YouTube Link Matching" -Completed

        Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue
        Remove-Job -Id $stdoutEvent.Id -Force -ErrorAction SilentlyContinue
        Remove-Job -Id $stderrEvent.Id -Force -ErrorAction SilentlyContinue

        if ($proc.ExitCode -ne 0) {
            Write-Step "YouTube matching script exited with code $($proc.ExitCode)" "Red"
            return $false
        }
    }
    catch {
        Write-Progress -Id 1 -Activity "YouTube Link Matching" -Completed
        Write-Step "Failed to run YouTube matching script: $_" "Red"
        return $false
    }

    Write-Step "YouTube link matching completed" "Green"
    Write-Elapsed $matchStart
    return $true
}

# ============================================================================
#  TASK 1c: YOUTUBE LINK VERIFICATION (push + wait for GitHub)
# ============================================================================

function Wait-ForYouTubeVerification {
    param(
        [int]$TimeoutMinutes = 0,
        [switch]$PublishOnly
    )

    Write-Section "TASK 1c: YOUTUBE LINK VERIFICATION"

    $checkScript = Join-Path $scriptRoot "scripts\check-yt-verification.js"
    $submitScript = Join-Path $scriptRoot "scripts\push-releases-verification.js"
    if (-not (Test-Path $checkScript)) {
        Write-Step "scripts/check-yt-verification.js not found" "Red"
        return $false
    }
    if (-not (Test-Path $submitScript)) {
        Write-Step "scripts/push-releases-verification.js not found" "Red"
        return $false
    }

    # Check current verification status
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $checkOutput = & node $checkScript 2>&1
    $checkExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($checkExit -eq 0) {
        Write-Step "All YouTube links are already verified" "Green"
        return $true
    }

    try {
        $stats = $checkOutput | Where-Object { $_ -notmatch '^\s*$' } | Select-Object -Last 1 | ConvertFrom-Json
    }
    catch {
        Write-Step "Could not parse verification status" "Red"
        return $false
    }

    Write-Step "Unverified: $($stats.unverified) | Verified: $($stats.verified) | Will-not-verify: $($stats.willNotVerify)"

    # Publish releases.json to GitHub so verification can be done remotely.
    Write-Step "Publishing releases.json to GitHub for remote verification..."
    $submitResult = $null
    try {
        $submitRaw = & node $submitScript --unverified $stats.unverified
        if ($LASTEXITCODE -ne 0) {
            throw "push-releases-verification.js exited with code $LASTEXITCODE"
        }
        $submitResult = $submitRaw | ConvertFrom-Json
    }
    catch {
        Write-Step "GitHub publish failed: $_" "Red"
        return $false
    }

    $branch = $submitResult.branch
    $pushSha = $submitResult.commitSha
    $shortSha = if ($pushSha.Length -ge 7) { $pushSha.Substring(0, 7) } else { $pushSha }
    Write-Step "Published releases.json on origin/$branch (commit $shortSha)" "Green"
    Write-Host ""
    Write-Host "  +---------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  WAITING FOR YOUTUBE LINK VERIFICATION                  |" -ForegroundColor Yellow
    Write-Host "  |                                                         |" -ForegroundColor Yellow
    Write-Host "  |  1. Open the GitHub file and review unverified links   |" -ForegroundColor Yellow
    Write-Host "  |  2. Change 'unverified' to 'verified' or               |" -ForegroundColor Yellow
    Write-Host "  |     'will-not-verify' for each link                    |" -ForegroundColor Yellow
    Write-Host "  |  3. Commit your edit in GitHub's web UI                |" -ForegroundColor Yellow
    Write-Host "  |                                                         |" -ForegroundColor Yellow
    if ($TimeoutMinutes -gt 0) {
        Write-Host "  |  Script will auto-continue after $TimeoutMinutes minute(s) max      |" -ForegroundColor Yellow
    }
    else {
        Write-Host "  |  Script will auto-continue when all links are verified  |" -ForegroundColor Yellow
    }
    Write-Host "  |  Press Ctrl+C to abort                                 |" -ForegroundColor Yellow
    Write-Host "  +---------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""
    if ($submitResult.editUrl) {
        Write-Step "Verify from anywhere via GitHub edit URL:" "Cyan"
        Write-Host "    $($submitResult.editUrl)" -ForegroundColor DarkCyan
    }
    if ($submitResult.blobUrl) {
        Write-Step "Read-only file URL:" "DarkGray"
        Write-Host "    $($submitResult.blobUrl)" -ForegroundColor DarkGray
    }
    Write-Host ""

    if ($PublishOnly) {
        Write-Step "Published releases.json for verification; not waiting in this phase" "Green"
        return $true
    }

    $POLL_INTERVAL_SEC = 30
    $waitStart = Get-Date
    $deadline = if ($TimeoutMinutes -gt 0) { $waitStart.AddMinutes($TimeoutMinutes) } else { $null }

    if ($deadline) {
        Write-Step "Waiting up to $TimeoutMinutes minute(s) for verification before continuing" "Cyan"
    }

    while ($true) {
        if ($deadline -and (Get-Date) -ge $deadline) {
            Write-Progress -Id 1 -Activity "YouTube link verification" -Completed
            Write-Step "Verification timeout reached; continuing with remaining update tasks" "Yellow"
            return $true
        }

        $sleepSeconds = $POLL_INTERVAL_SEC
        if ($deadline) {
            $remainingSeconds = [math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
            if ($remainingSeconds -le 0) { continue }
            $sleepSeconds = [math]::Min($POLL_INTERVAL_SEC, $remainingSeconds)
        }

        Start-Sleep -Seconds $sleepSeconds

        $elapsed = [math]::Round(((Get-Date) - $waitStart).TotalMinutes, 1)
        Write-Progress -Id 1 -Activity "Waiting for YouTube link verification" `
            -Status "Polling GitHub every ${POLL_INTERVAL_SEC}s... (${elapsed} min elapsed)"

        # Fetch latest from remote
        Push-Location $scriptRoot
        $remoteSha = $null
        try {
            git fetch origin $branch --quiet 2>$null
            $remoteSha = (git log "origin/$branch" -1 --format="%H" -- $releasesRepoPath).Trim()
        }
        catch {
            Write-Step "Git fetch failed, retrying..." "DarkYellow"
            Pop-Location
            continue
        }
        Pop-Location

        if ($remoteSha -eq $pushSha) {
            continue  # No new commits touching releases.json
        }

        # New commit detected
        Write-Step "New commit detected on GitHub ($(($remoteSha).Substring(0,7)))" "Cyan"
        Push-Location $scriptRoot
        try {
            git pull --ff-only --quiet
        }
        catch {
            Write-Step "Git pull failed: $_" "Red"
            Pop-Location
            continue
        }
        Pop-Location

        # Re-check verification
        $ErrorActionPreference = "Continue"
        $checkOutput = & node $checkScript 2>&1
        $checkExit = $LASTEXITCODE
        $ErrorActionPreference = "Stop"

        if ($checkExit -eq 0) {
            Write-Progress -Id 1 -Activity "YouTube link verification" -Completed
            Write-Step "All YouTube links verified!" "Green"
            return $true
        }

        try {
            $stats = $checkOutput | Where-Object { $_ -notmatch '^\s*$' } | Select-Object -Last 1 | ConvertFrom-Json
        }
        catch {
            $stats = @{ unverified = "?" }
        }
        Write-Step "Still $($stats.unverified) unverified link(s) remaining. Waiting..." "Yellow"
        $pushSha = $remoteSha  # Update baseline for next poll cycle
    }
}

# ============================================================================
#  TASK 2: SCRAPE ARTICLES + INTERVIEWS
# ============================================================================

function Update-ScrapeArticles {
    Write-Section "TASK 2: SCRAPE ARTICLES + INTERVIEWS"
    $scrapeStart = Get-Date

    $scrapeScript = Join-Path (Join-Path $scriptRoot "scripts") "scrape-articles.js"
    $interviewScript = Join-Path (Join-Path $scriptRoot "scripts") "fetch-interviews.js"
    $mediaScript = Join-Path (Join-Path $scriptRoot "scripts") "build-media-feeds.js"
    if (-not (Test-Path $scrapeScript)) {
        Write-Step "scripts/scrape-articles.js not found, skipping" "Red"
        return $false
    }

    if (-not (Test-Path $interviewScript)) {
        Write-Step "scripts/fetch-interviews.js not found, skipping" "Red"
        return $false
    }

    $hasLegacyMediaScript = Test-Path $mediaScript
    if (-not $hasLegacyMediaScript) {
        Write-Step "build-media-feeds.js is deprecated; filtered media is now generated by scripts/generate-site-master.ps1" "DarkGray"
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

        Write-Step "Fetching interview videos from configured YouTube channels..."
        $interviewOutput = & node $interviewScript 2>&1
        $interviewExit = $LASTEXITCODE

        foreach ($line in $interviewOutput) {
            Add-YouTubeApiUnitsFromLine $line
            if ($line -is [System.Management.Automation.ErrorRecord]) {
                Write-Host "    $($line.ToString())" -ForegroundColor DarkYellow
            } else {
                Write-Host "    $line" -ForegroundColor Gray
            }
        }

        if ($interviewExit -ne 0) {
            Write-Step "Interview fetcher finished with exit code $interviewExit" "DarkYellow"
        } else {
            Write-Step "Interview fetcher completed successfully" "Green"
        }

        if ($hasLegacyMediaScript) {
            Write-Step "Rebuilding filtered article and interview feeds..."
            $mediaOutput = & node $mediaScript 2>&1
            $mediaExit = $LASTEXITCODE

            foreach ($line in $mediaOutput) {
                if ($line -is [System.Management.Automation.ErrorRecord]) {
                    Write-Host "    $($line.ToString())" -ForegroundColor DarkYellow
                } else {
                    Write-Host "    $line" -ForegroundColor Gray
                }
            }

            if ($mediaExit -ne 0) {
                Write-Step "Filtered media rebuild finished with exit code $mediaExit" "DarkYellow"
            } else {
                Write-Step "Filtered media rebuild completed successfully" "Green"
            }
        } else {
            Write-Step "Skipping legacy filtered media rebuild step (now covered by site-master generation)" "DarkGray"
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

    $bandsJsonPath = Join-Path $editableDataRoot "bands.json"

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
        $backupPath = Join-Path $backupsRoot "bands.json.backup"
        Copy-Item $bandsJsonPath $backupPath -Force
        Write-Step "Backup saved to backups/bands.json.backup" "Gray"

        $bandsData | ConvertTo-Json -Depth 10 | Set-Content $bandsJsonPath -Encoding UTF8
        Write-Step "bands.json updated" "Green"
    }
    else {
        Write-Step "No new service links found for new artists" "DarkGray"
    }

    Write-Elapsed $linksStart
    return $true
}

function Update-CuratorTracklists {
    Write-Section "TASK 4: CURATOR TRACKLISTS"

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

    $outputPath = Join-Path $generatedDataRoot "curators-tracklists.json"
    if (Test-Path $outputPath) {
        $size = [math]::Round((Get-Item $outputPath).Length / 1KB, 1)
        Write-Step "Generated curators-tracklists.json (${size} KB)" "Green"
    }

    Write-Step "Curator tracklists completed" "Green"
    return $true
}

# ============================================================================
#  TASK 4b: SPOTIFY PLAYLISTS
# ============================================================================

function Update-SpotifyPlaylists {
    Write-Section "TASK 4b: SPOTIFY PLAYLISTS"

    $playlistConfig = Join-Path $staticDataRoot "spotify-playlists.json"
    if (-not (Test-Path $playlistConfig)) {
        Write-Step "spotify-playlists.json not found, skipping" "Red"
        return $false
    }

    $credentialsPath = Join-Path $credentialsRoot "spotify-credentials.json"
    if (-not (Test-Path $credentialsPath)) {
        Write-Step "config/credentials/spotify-credentials.json not found, skipping" "Red"
        return $false
    }

    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse config/credentials/spotify-credentials.json" "Red"
        return $false
    }

    if (-not $creds.refreshToken) {
        Write-Step "config/credentials/spotify-credentials.json must contain refreshToken for playlist updates" "Yellow"
        Write-Step "Skipping playlist generation (no refresh token)" "DarkGray"
        return $true
    }

    $env:SPOTIFY_CLIENT_ID = $creds.clientId
    $env:SPOTIFY_CLIENT_SECRET = $creds.clientSecret
    $env:SPOTIFY_REFRESH_TOKEN = $creds.refreshToken

    $nodeScript = Join-Path $scriptRoot "scripts\generate-spotify-playlists.js"
    if (-not (Test-Path $nodeScript)) {
        Write-Step "scripts/generate-spotify-playlists.js not found" "Red"
        return $false
    }

    Write-Step "Running Spotify playlist generation..."
    $plStart = Get-Date
    try {
        $output = & node $nodeScript 2>&1
        foreach ($line in $output) {
            if ($line -is [System.Management.Automation.ErrorRecord]) {
                Write-Host "    $($line.ToString())" -ForegroundColor DarkYellow
            } else {
                Write-Host "    $line" -ForegroundColor Gray
            }
        }

        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            Write-Step "Playlist script exited with code $LASTEXITCODE" "Red"
            return $false
        }
    }
    catch {
        Write-Step "Playlist generation failed: $_" "Red"
        return $false
    }

    Write-Step "Spotify playlists updated" "Green"
    Write-Elapsed $plStart
    return $true
}

# ============================================================================
#  TASK 6: RADIO SOURCE
# ============================================================================

function Update-RadioSource {
    Write-Section "TASK 6: RADIO SOURCE"

    $nodeScript = Join-Path $scriptRoot "scripts\generate-radio-source.js"
    if (-not (Test-Path $nodeScript)) {
        Write-Step "scripts/generate-radio-source.js not found" "Red"
        return $false
    }

    Write-Step "Running radio source generation..."
    $radioStart = Get-Date
    try {
        $output = & node $nodeScript 2>&1
        foreach ($line in $output) {
            if ($line -is [System.Management.Automation.ErrorRecord]) {
                Write-Host "    $($line.ToString())" -ForegroundColor DarkYellow
            } else {
                Write-Host "    $line" -ForegroundColor Gray
            }
        }

        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            Write-Step "Radio source script exited with code $LASTEXITCODE" "Red"
            return $false
        }
    }
    catch {
        Write-Step "Radio source generation failed: $_" "Red"
        return $false
    }

    Write-Step "Radio source generated" "Green"
    Write-Elapsed $radioStart
    return $true
}

function Invoke-UpdateTask {
    param(
        [string]$Name,
        [scriptblock]$ScriptBlock
    )

    try {
        $taskResult = & $ScriptBlock
        if ($taskResult -is [array]) {
            return [bool]$taskResult[-1]
        }
        return [bool]$taskResult
    }
    catch {
        Write-Step "$Name failed unexpectedly: $_" "Red"
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
$runCleanup   = -not $SkipCleanup
$runChart     = -not $SkipChart
$runYouTubeMatching = -not $SkipYouTubeMatching
$runVerification = -not $SkipVerification
$runYouTubePopularity = -not $SkipYouTubePopularity
$runScrape    = -not $SkipScrape
$runLinks     = -not $SkipLinks
$runCurators  = -not $SkipCurators
$runPlaylists = -not $SkipPlaylists
$runSiteMaster = -not $SkipSiteMaster
$runRadio = -not $SkipRadio

if ($Only) {
    $runCleanup   = $Only -eq "cleanup"
    $runChart     = $Only -eq "chart"
    $runYouTubeMatching = $Only -eq "ytmatching"
    $runVerification = $Only -eq "ytmatching"  # verification pairs with matching
    $runYouTubePopularity = $Only -eq "ytpopularity"
    $runScrape    = $Only -eq "scrape"
    $runLinks     = $Only -eq "links"
    $runCurators  = $Only -eq "curators"
    $runPlaylists = $Only -eq "playlists"
    $runSiteMaster = $Only -eq "sitemaster"
    $runRadio = $Only -eq "radio"
}

if ($AutomationPhase -eq "publish-verification") {
    $runCleanup = -not $SkipCleanup
    $runChart = -not $SkipChart
    $runYouTubeMatching = -not $SkipYouTubeMatching
    $runVerification = -not $SkipVerification
    $runYouTubePopularity = $false
    $runScrape = $false
    $runLinks = $false
    $runCurators = $false
    $runPlaylists = $false
    $runSiteMaster = $false
    $runRadio = $false
}
elseif ($AutomationPhase -eq "finalize-after-verification") {
    $runCleanup = $false
    $runChart = $false
    $runYouTubeMatching = $false
    $runVerification = $false
    $runYouTubePopularity = -not $SkipYouTubePopularity
    $runScrape = -not $SkipScrape
    $runLinks = -not $SkipLinks
    $runCurators = -not $SkipCurators
    $runPlaylists = -not $SkipPlaylists
    $runSiteMaster = -not $SkipSiteMaster
    $runRadio = -not $SkipRadio
}

$results = @{}
$taskTimings = @{}
$criticalTaskNames = switch ($AutomationPhase) {
    "publish-verification" { @("Chart Data", "YouTube Matching", "YouTube Verification") }
    "finalize-after-verification" { @("YouTube Popularity", "Site Master") }
    default { @("Chart Data", "YouTube Matching", "YouTube Verification", "YouTube Popularity", "Site Master", "Radio Source") }
}

# Count how many tasks will actually run for the overall progress bar
$script:taskTotal = @($runCleanup, $runChart, $runYouTubeMatching, $runVerification, $runYouTubePopularity, $runScrape, $runLinks, $runCurators, $runPlaylists, $runSiteMaster, $runRadio) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
$script:taskIndex = 0

# --- Task 0: Cleanup Releases ---
if ($runCleanup) {
    Set-OverallProgress "Cleanup Releases"
    Write-Section "TASK 0: CLEANUP RELEASES"
    $t = Get-Date
    try {
        $cleanupScript = Join-Path (Join-Path $scriptRoot "scripts") "cleanup-releases.js"
        if (Test-Path $cleanupScript) {
            $output = node $cleanupScript 2>&1
            $output | ForEach-Object { Write-Step $_ }
            $results["Cleanup Releases"] = $true
        }
        else {
            Write-Step "scripts/cleanup-releases.js not found" "Red"
            $results["Cleanup Releases"] = $false
        }
    }
    catch {
        Write-Step "Cleanup failed: $_" "Red"
        $results["Cleanup Releases"] = $false
    }
    $taskTimings["Cleanup Releases"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping release cleanup" "DarkGray"
}

# --- Task 1: Chart Data ---
if ($runChart) {
    Set-OverallProgress "Chart Data"
    $t = Get-Date
    $results["Chart Data"] = Invoke-UpdateTask "Chart Data" { Update-ChartData }
    $taskTimings["Chart Data"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping chart data" "DarkGray"
}

# --- Task 1b: YouTube Link Matching ---
if ($runYouTubeMatching) {
    Set-OverallProgress "YouTube Link Matching"
    $t = Get-Date
    $results["YouTube Matching"] = Invoke-UpdateTask "YouTube Matching" { Update-YouTubeMatching }
    $taskTimings["YouTube Matching"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping YouTube link matching" "DarkGray"
}

# --- Task 1c: YouTube Link Verification (push + wait for GitHub) ---
if ($runVerification -and $results["YouTube Matching"] -ne $false) {
    Set-OverallProgress "YouTube Verification"
    $t = Get-Date
    $results["YouTube Verification"] = Invoke-UpdateTask "YouTube Verification" { Wait-ForYouTubeVerification -TimeoutMinutes $VerificationTimeoutMinutes -PublishOnly:($AutomationPhase -eq "publish-verification") }
    $taskTimings["YouTube Verification"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)

    if (-not $results["YouTube Verification"]) {
        Write-Step "Verification failed or aborted — skipping YouTube popularity" "Red"
        $runYouTubePopularity = $false
    }
}
elseif ($runVerification) {
    Write-Step "Skipping verification (matching did not run or failed)" "DarkGray"
}
else {
    Write-Step "Skipping YouTube verification" "DarkGray"
}

# --- Task 1d: YouTube Popularity ---
if ($runYouTubePopularity) {
    Set-OverallProgress "YouTube Popularity"
    $t = Get-Date
    $results["YouTube Popularity"] = Invoke-UpdateTask "YouTube Popularity" { Update-YouTubePopularity }
    $taskTimings["YouTube Popularity"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping YouTube popularity" "DarkGray"
}

# --- Task 2: Scrape Articles + Interviews ---
if ($runScrape) {
    Set-OverallProgress "Scrape Articles + Interviews"
    $t = Get-Date
    $results["Scrape Articles + Interviews"] = Invoke-UpdateTask "Scrape Articles + Interviews" { Update-ScrapeArticles }
    $taskTimings["Scrape Articles + Interviews"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping article and interview scraping" "DarkGray"
}

# --- Task 3: Service Links ---
if ($runLinks) {
    Set-OverallProgress "Service Links"
    $t = Get-Date
    $results["Service Links"] = Invoke-UpdateTask "Service Links" { Update-ServiceLinks }
    $taskTimings["Service Links"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping service links" "DarkGray"
}

# --- Task 4: Curator Tracklists ---
if ($runCurators) {
    Set-OverallProgress "Curator Tracklists"
    $t = Get-Date
    $results["Curator Tracklists"] = Invoke-UpdateTask "Curator Tracklists" { Update-CuratorTracklists }
    $taskTimings["Curator Tracklists"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping curator tracklists" "DarkGray"
}

# --- Task 4b: Spotify Playlists ---
if ($runPlaylists) {
    Set-OverallProgress "Spotify Playlists"
    $t = Get-Date
    $results["Spotify Playlists"] = Invoke-UpdateTask "Spotify Playlists" { Update-SpotifyPlaylists }
    $taskTimings["Spotify Playlists"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping Spotify playlists" "DarkGray"
}

# --- Task 5: Site Master ---
if ($runSiteMaster) {
    Set-OverallProgress "Site Master"
    Write-Section "TASK 5: SITE MASTER (PRE-COMPUTED DATA)"
    $t = Get-Date
    try {
        $smScript = Join-Path (Join-Path $scriptRoot "scripts") "generate-site-master.ps1"
        if (Test-Path $smScript) {
            & $smScript
            $results["Site Master"] = $true
        }
        else {
            Write-Step "generate-site-master.ps1 not found at $smScript" "Red"
            $results["Site Master"] = $false
        }
    }
    catch {
        Write-Step "Site Master generation failed: $_" "Red"
        $results["Site Master"] = $false
    }
    $taskTimings["Site Master"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping site-master generation" "DarkGray"
}

# --- Task 6: Radio Source ---
if ($runRadio) {
    Set-OverallProgress "Radio Source"
    $t = Get-Date
    $results["Radio Source"] = Invoke-UpdateTask "Radio Source" { Update-RadioSource }
    $taskTimings["Radio Source"] = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
}
else {
    Write-Step "Skipping radio source generation" "DarkGray"
}

Write-Progress -Id 0 -Activity "Master Lista Update" -Completed

# --- Save run state (always, so bands.json baseline is tracked) ---
$bandsJsonPath = Join-Path $editableDataRoot "bands.json"
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
    if ((-not $results[$task]) -and ($criticalTaskNames -notcontains $task)) {
        $status = "FAILED, NON-BLOCKING"
        $color = "Yellow"
    }
    $timing = if ($taskTimings.ContainsKey($task)) { " ($($taskTimings[$task])s)" } else { "" }
    Write-Host "  [$status] $task$timing" -ForegroundColor $color
}

$reportedYouTubeTasks = @("YouTube Matching", "YouTube Popularity", "Scrape Articles + Interviews") | Where-Object { $results.ContainsKey($_) }
if ($reportedYouTubeTasks.Count -gt 0) {
    Write-Host "  YouTube API units used: ~$script:YouTubeApiUnits (reported by YouTube tasks)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  Completed in $([math]::Round($elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
Write-Host ""

$failedTasks = @($results.Keys | Where-Object { -not $results[$_] })
$criticalFailedTasks = @($failedTasks | Where-Object { $criticalTaskNames -contains $_ })
$nonBlockingFailedTasks = @($failedTasks | Where-Object { $criticalTaskNames -notcontains $_ })

if ($nonBlockingFailedTasks.Count -gt 0) {
    Write-Host "  Non-blocking failed task(s): $($nonBlockingFailedTasks -join ', ')" -ForegroundColor Yellow
}

if ($criticalFailedTasks.Count -gt 0) {
    Write-Host "  Critical failed task(s): $($criticalFailedTasks -join ', ')" -ForegroundColor Red
    exit 1
}

exit 0
