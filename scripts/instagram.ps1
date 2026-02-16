# scripts/instagram.ps1
# Standalone Instagram posting script for Macedonian Music Master Lista
#
# Features:
#   - Generates weekly chart carousel images (with cover art collage)
#   - Supports standard and alternative chart modes
#   - Previews images for review before posting
#   - Posts carousel to Instagram via Graph API
#
# Usage:
#   ./scripts/instagram.ps1                    # Standard chart, review before posting
#   ./scripts/instagram.ps1 -ChartMode alt     # Alternative chart
#   ./scripts/instagram.ps1 -SkipReview        # Post without review prompt
#   ./scripts/instagram.ps1 -GenerateOnly      # Generate images only, don't post
#   ./scripts/instagram.ps1 -Force             # Ignore day-of-week and already-posted checks

param(
    [ValidateSet("standard", "alt")]
    [string]$ChartMode = "standard",
    [switch]$SkipReview,
    [switch]$GenerateOnly,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$scriptRoot = Split-Path -Parent $PSScriptRoot  # Go up from scripts/ to repo root
if (-not (Test-Path (Join-Path $scriptRoot "chart-data.json"))) {
    # Fallback: maybe running from repo root directly
    $scriptRoot = $PSScriptRoot
    if (-not (Test-Path (Join-Path $scriptRoot "chart-data.json"))) {
        Write-Host "ERROR: Cannot find chart-data.json. Run from the repo root or scripts/ folder." -ForegroundColor Red
        exit 1
    }
}

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

function Get-WeekLabel {
    $now = Get-Date
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $weekNum = $culture.Calendar.GetWeekOfYear($now, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)
    return "W{0:D2} {1}" -f $weekNum, $now.Year
}

function Get-DateRangeLabel {
    $now = Get-Date
    $diffToMonday = ([int]$now.DayOfWeek + 6) % 7
    $start = $now.Date.AddDays(-$diffToMonday)
    $end = $start.AddDays(6)
    $monthNames = @(
        "Јануари", "Февруари", "Март", "Април", "Мај", "Јуни",
        "Јули", "Август", "Септември", "Октомври", "Ноември", "Декември"
    )
    $startMonth = $monthNames[$start.Month - 1]
    $endMonth = $monthNames[$end.Month - 1]
    $startStr = "{0:D2} {1}" -f $start.Day, $startMonth
    $endStr = "{0:D2} {1} {2}" -f $end.Day, $endMonth, $end.Year
    return "$startStr - $endStr"
}

# ============================================================================
#  INSTAGRAM TOKEN MANAGEMENT
# ============================================================================

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

# ============================================================================
#  THEME COLORS (dark mode matching toplista.mk)
# ============================================================================

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
$script:themeAltAccent  = "#9b59b6"  # Purple accent for alt chart

# Cyrillic strings built via char codes (PS 5.1 safe)
$script:cyrTopSinglovi = "$([char]0x0422)$([char]0x043E)$([char]0x043F) $([char]0x0421)$([char]0x0438)$([char]0x043D)$([char]0x0433)$([char]0x043B)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
$script:cyrAlternativna = "$([char]0x0410)$([char]0x043B)$([char]0x0442)$([char]0x0435)$([char]0x0440)$([char]0x043D)$([char]0x0430)$([char]0x0442)$([char]0x0438)$([char]0x0432)$([char]0x043D)$([char]0x0430)"

# ============================================================================
#  IMAGE HELPERS
# ============================================================================

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

function Draw-ImageCover {
    param($g, $img, [int]$x, [int]$y, [int]$w, [int]$h)
    if (-not $img) { return }
    $srcW = $img.Width
    $srcH = $img.Height
    if ($srcW -le 0 -or $srcH -le 0) { return }

    $destRatio = [double]$w / [double]$h
    $srcRatio = [double]$srcW / [double]$srcH

    if ($srcRatio -gt $destRatio) {
        $cropH = $srcH
        $cropW = [int]($srcH * $destRatio)
        $srcX = [int](($srcW - $cropW) / 2)
        $srcY = 0
    } else {
        $cropW = $srcW
        $cropH = [int]($srcW / $destRatio)
        $srcX = 0
        $srcY = [int](($srcH - $cropH) / 2)
    }

    $destRect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
    $srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $cropW, $cropH)
    $g.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
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
    Draw-ImageCover $g $img $x $y $w $h
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
    switch ($rank) {
        1 { return [System.Drawing.Color]::FromArgb(20, 212, 160, 0) }
        2 { return [System.Drawing.Color]::FromArgb(15, 138, 138, 138) }
        3 { return [System.Drawing.Color]::FromArgb(15, 168, 104, 48) }
        default { return [System.Drawing.Color]::Transparent }
    }
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

# ============================================================================
#  CHART DATA PROCESSING
# ============================================================================

# Deduplicates collab releases (same releaseId = same track, multiple artists)
function Merge-Collabs {
    param($releases)
    $map = @{}
    foreach ($r in $releases) {
        $key = $r.releaseId
        if (-not $key) { $key = $r.topTrackId }
        if (-not $key) { $key = "$($r.releaseTitle)|$($r.bandName)|$($r.releaseDate)" }
        if ([string]::IsNullOrWhiteSpace($key)) { continue }
        if ($map.ContainsKey($key)) {
            $existing = $map[$key]
            $existingArtists = $existing.bandName -split ", "
            if ($existingArtists -notcontains $r.bandName) {
                $existing.bandName = ($existingArtists + @($r.bandName)) -join ", "
            }
            if ([int]$r.popularity -gt [int]$existing.popularity) { $existing.popularity = $r.popularity }
        } else {
            $map[$key] = [PSCustomObject]@{
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

# Genre filter data (matching index.html logic)
$script:rapGenres = @('Рап', 'Трап', 'Хип Хоп', 'Бум Бап', 'Поп-Рап')
$script:electronicGenres = @('Електронска', 'Техно', 'Хаус', 'Транс', 'Синтвејв', 'Синт-Поп', 'EDM', 'ДНБ', 'Драм', 'Амбиентална', 'Вејпорвејв', 'Драм ен Бас', 'Психоделичен Транс', 'Гоа', 'Глич', 'Чилаут', 'Електро-амбиентал', 'Трип Хоп', 'Псајбас', 'Псајдаб')
$script:popGenres = @('Поп', 'Поп-Рок', 'Поп Рок', 'Данс Поп', 'Синт-Поп', 'К-Поп', 'Турбо-Фолк', 'R&B', 'Поп-Фолк', "Р'н'Б", 'Шлагер', 'Соул')
$script:nonAltGenres = $script:rapGenres + $script:electronicGenres + $script:popGenres

function Test-ArtistMatchesAlt {
    param([string]$artistName, $bandsData)
    
    $band = $bandsData | Where-Object { $_.name -eq $artistName } | Select-Object -First 1
    if (-not $band -or -not $band.genre) { return $false }
    
    $genreStr = $band.genre.ToLower()
    # Skip unknown genres
    $noData = "$([char]0x043D)$([char]0x0435)$([char]0x0434)$([char]0x043E)$([char]0x0441)$([char]0x0442)$([char]0x0438)$([char]0x0433)$([char]0x0430)$([char]0x0430)$([char]0x0442) $([char]0x043F)$([char]0x043E)$([char]0x0434)$([char]0x0430)$([char]0x0442)$([char]0x043E)$([char]0x0446)$([char]0x0438)"
    if ($genreStr -eq $noData.ToLower()) { return $false }
    
    $artistGenres = $genreStr -split "," | ForEach-Object { $_.Trim() }
    $excludeLower = $script:nonAltGenres | ForEach-Object { $_.ToLower() }
    
    foreach ($ag in $artistGenres) {
        if ($excludeLower -contains $ag) {
            return $false
        }
    }
    return $true
}

# Get singles chart: filter singles, prefer last 2 months, backfill if needed, sort by popularity
# (Matches the website index.html logic exactly)
function Get-SinglesChart {
    param($allReleases, [int]$count = 10, [string]$genreFilter = "all", $bandsData = $null)

    # Deduplicate collabs first
    $deduped = Merge-Collabs $allReleases

    # Filter singles only
    $singles = @($deduped | Where-Object { $_.releaseType -eq "single" })

    # Apply genre filter if alt
    if ($genreFilter -eq "alt" -and $bandsData) {
        $singles = @($singles | Where-Object {
            # Check each artist in a collab
            $artists = $_.bandName -split ", "
            $matchesAlt = $false
            foreach ($a in $artists) {
                if (Test-ArtistMatchesAlt $a $bandsData) {
                    $matchesAlt = $true
                    break
                }
            }
            $matchesAlt
        })
    }

    # Sort by release date descending
    $sortedByDate = @($singles | Sort-Object {
        try { [DateTime]::Parse($_.releaseDate) } catch { [DateTime]::MinValue }
    } -Descending)

    # Prefer last 2 months, backfill with older if pool < 20 (matches website logic)
    $twoMonthsAgo = (Get-Date).AddMonths(-2).ToString("yyyy-MM-dd")
    $recentSingles = @($sortedByDate | Where-Object { $_.releaseDate -ge $twoMonthsAgo })
    $pool = [System.Collections.ArrayList]@($recentSingles)
    if ($pool.Count -lt 20) {
        $olderSingles = @($sortedByDate | Where-Object { $_.releaseDate -lt $twoMonthsAgo })
        $needed = 20 - $pool.Count
        $backfill = @($olderSingles | Select-Object -First $needed)
        foreach ($r in $backfill) { [void]$pool.Add($r) }
    }

    # Sort by popularity descending, take top $count
    $ranked = @($pool | Sort-Object { [int]$_.popularity } -Descending | Select-Object -First $count)

    return $ranked
}

# ============================================================================
#  SLIDE GENERATORS
# ============================================================================

function New-TitleSlide {
    param([string]$dateLabel, $topReleases, [bool]$isAlt = $false)

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

    # --- Cover art collage (fill the entire slide in a 5-col grid) ---
    $gridCols = 5
    $coverGridSize = [Math]::Ceiling($W / $gridCols)
    $gridRows = [Math]::Ceiling($H / $coverGridSize)
    $totalCells = $gridCols * $gridRows
    $coverCount = $topReleases.Count
    $gridStartY = 0
    $overlayAlpha = 160  # semi-transparent overlay on top of covers

    if ($coverCount -gt 0) {
        Write-Step "  Downloading cover art for title collage ($coverCount covers)..." "DarkGray"
        for ($ci = 0; $ci -lt $totalCells; $ci++) {
            $col = $ci % $gridCols
            $row = [Math]::Floor($ci / $gridCols)
            $cx = $col * $coverGridSize
            $cy = $gridStartY + ($row * $coverGridSize)

            $release = $topReleases[$ci % $coverCount]
            if ($release.thumbnail) {
                $coverImg = Download-ImageFromUrl $release.thumbnail
                if ($coverImg) {
                    Draw-ImageCover $g $coverImg $cx $cy $coverGridSize $coverGridSize
                    $coverImg.Dispose()
                } else {
                    $placeBr = New-SolidBrush $script:themeCoverBg
                    $g.FillRectangle($placeBr, $cx, $cy, $coverGridSize, $coverGridSize)
                    $placeBr.Dispose()
                }
            } else {
                $placeBr = New-SolidBrush $script:themeCoverBg
                $g.FillRectangle($placeBr, $cx, $cy, $coverGridSize, $coverGridSize)
                $placeBr.Dispose()
            }
        }

        # Dark gradient overlay so text is readable on top of covers
        # Top area: lighter, Bottom area: darker
        $overlayBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            [System.Drawing.Point]::new(0, 0),
            [System.Drawing.Point]::new(0, $H),
            [System.Drawing.Color]::FromArgb(190, 0, 0, 0),
            [System.Drawing.Color]::FromArgb(240, 0, 0, 0)
        )
        $g.FillRectangle($overlayBrush, 0, 0, $W, $H)
        $overlayBrush.Dispose()

        $dimBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(50, 0, 0, 0))
        $g.FillRectangle($dimBr, 0, 0, $W, $H)
        $dimBr.Dispose()
    }

    # --- Vertically centered content block: logo + title + date ---
    $fontBigTitle = New-Object System.Drawing.Font("Segoe UI", 52, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeSongClr

    if ($isAlt) {
        $titleText = "$($script:cyrAlternativna) $($script:cyrTopSinglovi)"
        $fontBigTitle.Dispose()
        $fontBigTitle = New-Object System.Drawing.Font("Segoe UI", 40, [System.Drawing.FontStyle]::Bold)
        $titleBr.Dispose()
        $titleBr = New-SolidBrush $script:themeAltAccent
    } else {
        $titleText = $script:cyrTopSinglovi
    }

    $fontWeekBig = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $weekBr = New-SolidBrush $script:themeWeekClr

    # Measure actual text heights
    $titleSize = $g.MeasureString($titleText, $fontBigTitle)
    $dateSize = $g.MeasureString($dateLabel, $fontWeekBig)
    $logoSize = 280
    $gap = 30
    $totalBlockH = $logoSize + $gap + $titleSize.Height + 12 + $dateSize.Height
    $blockTop = [Math]::Max(60, ($H - $totalBlockH) / 2)

    # Logo
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoX = ($W - $logoSize) / 2
            $logoY = $blockTop
            Draw-ImageRounded $g $logoImg ([int]$logoX) ([int]$logoY) $logoSize $logoSize ([int]($logoSize / 2))
            $logoImg.Dispose()
        } catch {}
    }

    # Title
    $titleY = $blockTop + $logoSize + $gap
    $g.DrawString($titleText, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, $titleY, $W, ($titleSize.Height + 10)), $sfCenter)

    # Date
    $dateY = $titleY + $titleSize.Height + 12
    $g.DrawString($dateLabel, $fontWeekBig, $weekBr, [System.Drawing.RectangleF]::new(0, $dateY, $W, ($dateSize.Height + 10)), $sfCenter)

    # Cleanup
    foreach ($obj in @($bgBr, $sfCenter, $fontBigTitle, $titleBr, $fontWeekBig,
                       $weekBr)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-ReleaseSlide {
    param($release, [int]$rank, $igHandle, [string]$weekLabel, [bool]$isAlt = $false)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    $fontHeader = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $headerTxtBr = New-SolidBrush $script:themeHeaderClr
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    $headerText = if ($isAlt) { "$($script:cyrAlternativna) $($script:cyrTopSinglovi)" } else { $script:cyrTopSinglovi }
    if ($isAlt) {
        $headerTxtBr.Dispose()
        $headerTxtBr = New-SolidBrush $script:themeAltAccent
        $fontHeader.Dispose()
        $fontHeader = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
    }
    $headerSize = $g.MeasureString($headerText, $fontHeader)
    $headerY = [Math]::Floor(($headerH - $headerSize.Height) / 2)
    $g.DrawString($headerText, $fontHeader, $headerTxtBr, [System.Drawing.RectangleF]::new(0, $headerY, $W, ($headerSize.Height + 10)), $sfCenter)

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
    $rankMeas = $g.MeasureString($rankLabel, $fontBigRank)
    $g.DrawString($rankLabel, $fontBigRank, $rankBr, [System.Drawing.RectangleF]::new(0, 96, $W, ($rankMeas.Height + 10)), $sfCenter)

    # --- Album artwork (large, centered) ---
    $artSize = 640
    $artX = ($W - $artSize) / 2
    $artY = 96 + $rankMeas.Height + 16

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

    # --- Measure text heights for proper spacing ---
    $fontSongTitle = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
    $songTitleBr = New-SolidBrush $script:themeSongClr
    $songStr = $release.releaseTitle
    if ($songStr.Length -gt 30) { $songStr = $songStr.Substring(0, 27) + "..." }
    $songMeas = $g.MeasureString($songStr, $fontSongTitle)

    $fontArtistName = New-Object System.Drawing.Font("Segoe UI", 24)
    $artistNameBr = New-SolidBrush $script:themeArtistClr
    $artistStr = $release.bandName
    if ($artistStr.Length -gt 35) { $artistStr = $artistStr.Substring(0, 32) + "..." }
    $artistMeas = $g.MeasureString($artistStr, $fontArtistName)

    $fontIG = New-Object System.Drawing.Font("Segoe UI", 20)
    $igMeas = if ($igHandle) { $g.MeasureString($igHandle, $fontIG) } else { $null }

    # Calculate total text block below art and center it in remaining space
    $textBlockH = $songMeas.Height + 8 + $artistMeas.Height
    if ($igMeas) { $textBlockH += 8 + $igMeas.Height }
    $spaceBelow = $H - ($artY + $artSize)
    $textTop = $artY + $artSize + [Math]::Max(12, ($spaceBelow - $textBlockH) / 2)

    $songTitleY = $textTop
    $g.DrawString($songStr, $fontSongTitle, $songTitleBr, [System.Drawing.RectangleF]::new(40, $songTitleY, ($W - 80), ($songMeas.Height + 10)), $sfCenter)

    $artistY = $songTitleY + $songMeas.Height + 8
    $g.DrawString($artistStr, $fontArtistName, $artistNameBr, [System.Drawing.RectangleF]::new(40, $artistY, ($W - 80), ($artistMeas.Height + 10)), $sfCenter)

    # --- Instagram handle ---
    if ($igHandle) {
        $igBlueBr = New-SolidBrush "#3897f0"
        $igY = $artistY + $artistMeas.Height + 8
        $g.DrawString($igHandle, $fontIG, $igBlueBr, [System.Drawing.RectangleF]::new(0, $igY, $W, ($igMeas.Height + 10)), $sfCenter)
        $igBlueBr.Dispose()
    }
    $fontIG.Dispose()

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontHeader, $headerTxtBr, $sfCenter,
                       $fontBigRank, $rankBr,
                       $fontSongTitle, $songTitleBr, $fontArtistName,
                       $artistNameBr)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-ListSlide {
    param($topReleases, $igHandles, [string]$weekLabel, [bool]$isAlt = $false)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Full card background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    $fontTitle = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeHeaderClr

    if ($isAlt) {
        $titleText = "$($script:cyrAlternativna) $($script:cyrTopSinglovi)"
        $titleBr.Dispose()
        $titleBr = New-SolidBrush $script:themeAltAccent
        $fontTitle.Dispose()
        $fontTitle = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
    } else {
        $titleText = $script:cyrTopSinglovi
    }
    $titleMeas = $g.MeasureString($titleText, $fontTitle)
    $titleY = [Math]::Floor(($headerH - $titleMeas.Height) / 2)
    $g.DrawString($titleText, $fontTitle, $titleBr, 30, $titleY)

    # Header logo (right side)
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
    $listTop = $headerH + 8
    $itemCount = [Math]::Min($topReleases.Count, 10)
    $bottomPad = 20
    $availH = $H - $listTop - $bottomPad
    $itemH = [Math]::Floor($availH / $itemCount)
    $coverSize = [Math]::Min(90, $itemH - 16)
    $padX = 26

    $fontRank = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $fontSong = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $fontArtist = New-Object System.Drawing.Font("Segoe UI", 14)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 1)

    $songSample = $g.MeasureString("Ag", $fontSong)
    $artistSample = $g.MeasureString("Ag", $fontArtist)
    $textBlockH = $songSample.Height + $artistSample.Height + 6

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

        # Bottom border
        if ($i -lt ($itemCount - 1)) {
            $g.DrawLine($borderPen, $padX, ($y + $itemH), ($W - $padX), ($y + $itemH))
        }

        # Rank number
        $rankBr = New-SolidBrush (Get-RankColor $rank)
        $rankStr = "$rank"
        $rankSize = $g.MeasureString($rankStr, $fontRank)
        $rankX = $padX + 40 - $rankSize.Width
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
        $songY = $y + [Math]::Max(6, ($itemH - $textBlockH) / 2)
        $g.DrawString($songStr, $fontSong, $songBr, $textX, $songY)
        $songBr.Dispose()

        $artistStr = $r.bandName
        if ($igHandles.ContainsKey($r.bandName)) {
            $artistStr = "$($r.bandName) ($($igHandles[$r.bandName]))"
        }
        if ($artistStr.Length -gt 45) { $artistStr = $artistStr.Substring(0, 42) + "..." }
        $artistBr = New-SolidBrush $script:themeArtistClr
        $artistY = $songY + $songSample.Height + 4
        $g.DrawString($artistStr, $fontArtist, $artistBr, $textX, $artistY)
        $artistBr.Dispose()
    }

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontTitle, $titleBr, $fontRank, $fontSong, $fontArtist, $borderPen)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

function New-PromoSlide {
    param([string]$weekLabel, [bool]$isAlt = $false)

    $W = 1080; $H = 1350
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBr = New-SolidBrush $script:themeCardBg
    $g.FillRectangle($bgBr, 0, 0, $W, $H)

    # --- Header bar ---
    $headerH = 80
    $headerBr = New-SolidBrush $script:themeHeaderBg
    $g.FillRectangle($headerBr, 0, 0, $W, $headerH)

    $fontHeader = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $headerTxtBr = New-SolidBrush $script:themeHeaderClr
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    $headerText = "toplista.mk"
    $headerMeas = $g.MeasureString($headerText, $fontHeader)
    $headerY = [Math]::Floor(($headerH - $headerMeas.Height) / 2)
    $g.DrawString($headerText, $fontHeader, $headerTxtBr, [System.Drawing.RectangleF]::new(0, $headerY, $W, ($headerMeas.Height + 10)), $sfCenter)

    # --- Large logo (centered) ---
    $logoPath = Join-Path $scriptRoot "logo.png"
    if (Test-Path $logoPath) {
        try {
            $logoImg = [System.Drawing.Image]::FromFile($logoPath)
            $logoSize = 240
            $logoX = ($W - $logoSize) / 2
            $logoY = 160
            Draw-ImageRounded $g $logoImg ([int]$logoX) ([int]$logoY) $logoSize $logoSize ($logoSize / 2)
            $logoImg.Dispose()
        } catch {}
    }

    # --- Title ---
    $fontBigTitle = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Bold)
    $titleBr = New-SolidBrush $script:themeSongClr
    # "Македонска Музичка"
    $line1 = "$([char]0x041C)$([char]0x0430)$([char]0x043A)$([char]0x0435)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0441)$([char]0x043A)$([char]0x0430) $([char]0x041C)$([char]0x0443)$([char]0x0437)$([char]0x0438)$([char]0x0447)$([char]0x043A)$([char]0x0430)"
    $l1Meas = $g.MeasureString($line1, $fontBigTitle)
    $g.DrawString($line1, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, 440, $W, ($l1Meas.Height + 10)), $sfCenter)

    # "Мастер Листа"
    $line2 = "$([char]0x041C)$([char]0x0430)$([char]0x0441)$([char]0x0442)$([char]0x0435)$([char]0x0440) $([char]0x041B)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0430)"
    $l2Y = 440 + $l1Meas.Height + 4
    $l2Meas = $g.MeasureString($line2, $fontBigTitle)
    $g.DrawString($line2, $fontBigTitle, $titleBr, [System.Drawing.RectangleF]::new(0, $l2Y, $W, ($l2Meas.Height + 10)), $sfCenter)

    # --- Subtitle ---
    $fontSub = New-Object System.Drawing.Font("Segoe UI", 22)
    $subBr = New-SolidBrush $script:themeArtistClr
    # "Отворена база на македонски"
    $sub1 = "$([char]0x041E)$([char]0x0442)$([char]0x0432)$([char]0x043E)$([char]0x0440)$([char]0x0435)$([char]0x043D)$([char]0x0430) $([char]0x0431)$([char]0x0430)$([char]0x0437)$([char]0x0430) $([char]0x043D)$([char]0x0430) $([char]0x043C)$([char]0x0430)$([char]0x043A)$([char]0x0435)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0441)$([char]0x043A)$([char]0x0438)"
    $s1Y = $l2Y + $l2Meas.Height + 20
    $s1Meas = $g.MeasureString($sub1, $fontSub)
    $g.DrawString($sub1, $fontSub, $subBr, [System.Drawing.RectangleF]::new(0, $s1Y, $W, ($s1Meas.Height + 10)), $sfCenter)
    # "музички артисти и бендови"
    $sub2 = "$([char]0x043C)$([char]0x0443)$([char]0x0437)$([char]0x0438)$([char]0x0447)$([char]0x043A)$([char]0x0438) $([char]0x0430)$([char]0x0440)$([char]0x0442)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0438) $([char]0x0438) $([char]0x0431)$([char]0x0435)$([char]0x043D)$([char]0x0434)$([char]0x043E)$([char]0x0432)$([char]0x0438)"
    $s2Y = $s1Y + $s1Meas.Height + 4
    $s2Meas = $g.MeasureString($sub2, $fontSub)
    $g.DrawString($sub2, $fontSub, $subBr, [System.Drawing.RectangleF]::new(0, $s2Y, $W, ($s2Meas.Height + 10)), $sfCenter)

    # --- Divider ---
    $divPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($script:themeBorderClr), 2)
    $divY = $s2Y + $s2Meas.Height + 20
    $g.DrawLine($divPen, 200, $divY, ($W - 200), $divY)

    # --- CTA lines ---
    $fontCTA = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $ctaBr = New-SolidBrush $script:themeGold
    # "Додај го твојот"
    $cta1 = "$([char]0x0414)$([char]0x043E)$([char]0x0434)$([char]0x0430)$([char]0x0458) $([char]0x0433)$([char]0x043E) $([char]0x0442)$([char]0x0432)$([char]0x043E)$([char]0x0458)$([char]0x043E)$([char]0x0442)"
    $cta1Y = $divY + 30
    $cta1Meas = $g.MeasureString($cta1, $fontCTA)
    $g.DrawString($cta1, $fontCTA, $ctaBr, [System.Drawing.RectangleF]::new(0, $cta1Y, $W, ($cta1Meas.Height + 10)), $sfCenter)
    # "омилен артист!"
    $cta2 = "$([char]0x043E)$([char]0x043C)$([char]0x0438)$([char]0x043B)$([char]0x0435)$([char]0x043D) $([char]0x0430)$([char]0x0440)$([char]0x0442)$([char]0x0438)$([char]0x0441)$([char]0x0442)!"
    $cta2Y = $cta1Y + $cta1Meas.Height + 4
    $cta2Meas = $g.MeasureString($cta2, $fontCTA)
    $g.DrawString($cta2, $fontCTA, $ctaBr, [System.Drawing.RectangleF]::new(0, $cta2Y, $W, ($cta2Meas.Height + 10)), $sfCenter)

    # --- Sub-CTA ---
    $fontSubCTA = New-Object System.Drawing.Font("Segoe UI", 22)
    $subCtaBr = New-SolidBrush $script:themeArtistClr
    # "Уреди, додај и придонеси на листата"
    $subCta = "$([char]0x0423)$([char]0x0440)$([char]0x0435)$([char]0x0434)$([char]0x0438), $([char]0x0434)$([char]0x043E)$([char]0x0434)$([char]0x0430)$([char]0x0458) $([char]0x0438) $([char]0x043F)$([char]0x0440)$([char]0x0438)$([char]0x0434)$([char]0x043E)$([char]0x043D)$([char]0x0435)$([char]0x0441)$([char]0x0438) $([char]0x043D)$([char]0x0430) $([char]0x043B)$([char]0x0438)$([char]0x0441)$([char]0x0442)$([char]0x0430)$([char]0x0442)$([char]0x0430)"
    $subCtaY = $cta2Y + $cta2Meas.Height + 16
    $subCtaMeas = $g.MeasureString($subCta, $fontSubCTA)
    $g.DrawString($subCta, $fontSubCTA, $subCtaBr, [System.Drawing.RectangleF]::new(0, $subCtaY, $W, ($subCtaMeas.Height + 10)), $sfCenter)

    # --- URL box ---
    $urlBoxY = $subCtaY + $subCtaMeas.Height + 30
    $urlBoxW = 400
    $urlBoxH = 60
    $urlBoxX = ($W - $urlBoxW) / 2
    $urlBgBr = New-SolidBrush $script:themeFooterBg
    Draw-RoundedRect $g $urlBgBr ([int]$urlBoxX) ([int]$urlBoxY) $urlBoxW $urlBoxH 12
    $fontUrlBig = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $urlTxtBr = New-SolidBrush "#ffffff"
    $urlMeas = $g.MeasureString("toplista.mk", $fontUrlBig)
    $urlTxtY = $urlBoxY + [Math]::Floor(($urlBoxH - $urlMeas.Height) / 2)
    $g.DrawString("toplista.mk", $fontUrlBig, $urlTxtBr, [System.Drawing.RectangleF]::new(0, $urlTxtY, $W, ($urlMeas.Height + 10)), $sfCenter)

    # Cleanup
    foreach ($obj in @($bgBr, $headerBr, $fontHeader, $headerTxtBr, $sfCenter,
                       $fontBigTitle, $titleBr, $fontSub, $subBr, $divPen,
                       $fontCTA, $ctaBr, $fontSubCTA, $subCtaBr, $urlBgBr,
                       $fontUrlBig, $urlTxtBr)) {
        try { $obj.Dispose() } catch {}
    }
    $g.Dispose()

    return $bmp
}

# ============================================================================
#  INSTAGRAM API HELPERS
# ============================================================================

function Build-InstagramCaption {
    param($topReleases, $igHandles, [string]$weekLabel, [bool]$isAlt = $false)

    $chartTitle = if ($isAlt) { "$($script:cyrAlternativna) $($script:cyrTopSinglovi)" } else { $script:cyrTopSinglovi }

    $lines = @()
    $lines += "$chartTitle - $weekLabel"
    $lines += ""

    for ($i = 0; $i -lt $topReleases.Count; $i++) {
        $release = $topReleases[$i]
        $rank = $i + 1

        $songName = if ($release.topTrackName) { $release.topTrackName } else { $release.releaseTitle }
        $artistName = $release.bandName

        $handleParts = @()
        if ($rank -le 3) {
            foreach ($singleArtist in ($release.bandName -split ", ")) {
                if ($igHandles.ContainsKey($singleArtist)) {
                    $handleParts += $igHandles[$singleArtist]
                }
            }
        }
        $handleStr = ""
        if ($handleParts.Count -gt 0) {
            $handleStr = " (" + ($handleParts -join ", ") + ")"
        }

        $lines += "${rank}. ${artistName}${handleStr} - $songName"
    }

    $lines += ""
    $tags = "#toplista #muzika #mkmusic #chart #newmusic #spotify #macedonia"
    if ($isAlt) {
        $tags += " #alternativemusic #indie #rock"
    }
    $lines += $tags

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

# ============================================================================
#  MAIN WORKFLOW
# ============================================================================

$isAlt = $ChartMode -eq "alt"
$chartLabel = if ($isAlt) { "ALTERNATIVE" } else { "STANDARD" }

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host "  INSTAGRAM CHART POST ($chartLabel)" -ForegroundColor Magenta
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
Write-Host ("=" * 70) -ForegroundColor Magenta

# --- Pre-flight checks ---
if (-not $Force) {
    $isMonday = (Get-Date).DayOfWeek -eq [DayOfWeek]::Monday
    if (-not $isMonday) {
        Write-Step "Not Monday - use -Force to post anyway" "DarkYellow"
    }
}

$weekLabel = Get-WeekLabel
$dateRangeLabel = Get-DateRangeLabel
$stateKey = if ($isAlt) { "lastIgAltPostWeek" } else { "lastIgPostWeek" }

if (-not $Force) {
    $state = Get-RunState
    if ($state -and $state.$stateKey -and $state.$stateKey -eq $weekLabel) {
        Write-Step "Already posted $chartLabel chart for $weekLabel" "DarkGray"
        Write-Step "Use -Force to repost, or clear $stateKey in .last-run-state.json" "DarkGray"
        exit 0
    }
}

# --- Load credentials (only needed for posting, not for generate-only) ---
$creds = $null
$credentialsPath = Join-Path $scriptRoot "instagram-credentials.json"

if (-not $GenerateOnly) {
    if (-not (Test-Path $credentialsPath)) {
        Write-Step "instagram-credentials.json not found" "Red"
        Write-Step "Use -GenerateOnly to just generate images without posting" "Yellow"
        exit 1
    }
    try {
        $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Step "Failed to parse instagram-credentials.json" "Red"
        exit 1
    }
    if (-not $creds.accessToken -or -not $creds.igBusinessAccountId) {
        Write-Step "instagram-credentials.json must contain accessToken and igBusinessAccountId" "Red"
        exit 1
    }

    # Refresh token
    $tokenValid = Refresh-InstagramToken $creds $credentialsPath
    if (-not $tokenValid) { exit 1 }
    $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
}

# --- Load chart data ---
Write-Section "LOADING DATA"

$chartPath = Join-Path $scriptRoot "chart-data.json"
if (-not (Test-Path $chartPath)) {
    Write-Step "chart-data.json not found - run chart task first" "Red"
    exit 1
}
$chartData = Get-Content $chartPath -Raw -Encoding UTF8 | ConvertFrom-Json

# Load bands.json for Instagram handles and genre filtering
$bandsPath = Join-Path $scriptRoot "bands.json"
$igHandles = @{}
$bandsData = @()
if (Test-Path $bandsPath) {
    $bandsJson = Get-Content $bandsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bandsData = @($bandsJson.muzickaMasterLista)
    foreach ($band in $bandsData) {
        if ($band.links -and $band.links.instagram) {
            if ($band.links.instagram -match "instagram\.com/([^/?]+)") {
                $handle = "@$($matches[1].TrimEnd('/'))"
                $igHandles[$band.name] = $handle
            }
        }
    }
    Write-Step "Loaded $($igHandles.Count) Instagram handles from bands.json"
    if ($isAlt) {
        Write-Step "Genre filtering: alternative (excluding Rap/Trap, Electronic, Pop)"
    }
}

# Get chart (top 10, with genre filter for alt)
$genreFilter = if ($isAlt) { "alt" } else { "all" }
$topReleases = Get-SinglesChart $chartData.releases 10 $genreFilter $bandsData

# Also get top 20 for the cover art collage
$top20ForCovers = Get-SinglesChart $chartData.releases 20 $genreFilter $bandsData

if ($topReleases.Count -lt 3) {
    Write-Step "Need at least 3 singles for carousel, found $($topReleases.Count)" "Red"
    exit 1
}

Write-Step "Top $($topReleases.Count) $chartLabel singles:"
for ($i = 0; $i -lt $topReleases.Count; $i++) {
    $r = $topReleases[$i]
    $songName = if ($r.topTrackName) { $r.topTrackName } else { $r.releaseTitle }
    $h = if ($igHandles.ContainsKey($r.bandName)) { " $($igHandles[$r.bandName])" } else { "" }
    Write-Host "    $($i+1). $($r.bandName)$h - $songName (pop: $($r.popularity))" -ForegroundColor Gray
}
Write-Host ""

# --- Generate slide images ---
Write-Section "GENERATING SLIDES"

$tempDir = Join-Path $scriptRoot ".ig-temp"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

$slideFiles = @()

# Slide 1: Title card with cover art collage
Write-Step "Generating slide 1 (Title with cover art collage)..."
$titleBmp = New-TitleSlide $dateRangeLabel $top20ForCovers $isAlt
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
    $relBmp = New-ReleaseSlide $topReleases[$i] $rank $handle $weekLabel $isAlt
    $relPath = Join-Path $tempDir "slide-$($rank + 1)-release.jpg"
    Save-SlideAsJpeg $relBmp $relPath
    $relBmp.Dispose()
    $slideFiles += $relPath
    Write-Step "  Saved: slide-$($rank + 1)-release.jpg" "DarkGray"
}

# Slide 5: Full top 10 list
Write-Step "Generating slide 5 (Top 10 list)..."
$listBmp = New-ListSlide $topReleases $igHandles $weekLabel $isAlt
$listPath = Join-Path $tempDir "slide-5-list.jpg"
Save-SlideAsJpeg $listBmp $listPath
$listBmp.Dispose()
$slideFiles += $listPath
Write-Step "  Saved: slide-5-list.jpg" "DarkGray"

# Slide 6: Promo / CTA slide
Write-Step "Generating slide 6 (Promo)..."
$promoBmp = New-PromoSlide $weekLabel $isAlt
$promoPath = Join-Path $tempDir "slide-6-promo.jpg"
Save-SlideAsJpeg $promoBmp $promoPath
$promoBmp.Dispose()
$slideFiles += $promoPath
Write-Step "  Saved: slide-6-promo.jpg" "DarkGray"

Write-Step "Generated $($slideFiles.Count) slides" "Green"

# --- Build caption (show it now for review) ---
$caption = Build-InstagramCaption $topReleases $igHandles $weekLabel $isAlt
Write-Host ""
Write-Host "--- Caption Preview ---" -ForegroundColor Cyan
Write-Host $caption -ForegroundColor Gray
Write-Host "-----------------------" -ForegroundColor Cyan
Write-Host ""

# --- Review step ---
if ($GenerateOnly) {
    Write-Step "Images saved to: $tempDir" "Green"
    Write-Step "Open the folder to review:" "Yellow"
    Write-Host "    explorer.exe `"$tempDir`"" -ForegroundColor Gray
    # Open folder in Explorer
    Start-Process explorer.exe $tempDir
    Write-Host ""
    Write-Host "Done (generate-only mode). To post, run without -GenerateOnly." -ForegroundColor Green
    exit 0
}

if (-not $SkipReview) {
    Write-Section "IMAGE REVIEW"
    Write-Step "Opening image folder for review..." "Yellow"
    Start-Process explorer.exe $tempDir
    Write-Host ""
    Write-Host "  Review the $($slideFiles.Count) slides in:" -ForegroundColor Yellow
    Write-Host "    $tempDir" -ForegroundColor Gray
    Write-Host ""
    
    $response = Read-Host "  Post to Instagram? [y/N]"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Step "Cancelled by user. Images kept in: $tempDir" "DarkYellow"
        exit 0
    }
    Write-Host ""
}

# --- Upload slides to temp host ---
Write-Section "UPLOADING & POSTING"
Write-Step "Uploading slides to temporary image host..."
$imageUrls = @()
foreach ($slidePath in $slideFiles) {
    $fileName = [System.IO.Path]::GetFileName($slidePath)
    Write-Step "  Uploading $fileName..." "DarkGray"
    $url = Upload-TempImage $slidePath
    if (-not $url) {
        Write-Step "  Failed to upload $fileName" "Red"
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        exit 1
    }
    $imageUrls += $url
    Write-Step "  -> $url" "DarkGray"
    Start-Sleep -Milliseconds 300
}
Write-Step "All $($imageUrls.Count) slides uploaded" "Green"

# --- Post carousel ---
Write-Step "Posting 6-slide carousel to Instagram..."
$postId = Publish-InstagramCarousel $creds.igBusinessAccountId $creds.accessToken $imageUrls $caption

# Cleanup temp files
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

if ($postId) {
    Write-Step "Instagram carousel published! Post ID: $postId" "Green"

    # Record post in run state
    $state = Get-RunState
    if (-not $state) { $state = [PSCustomObject]@{} }
    if ($state.PSObject.Properties.Name -contains $stateKey) {
        $state.$stateKey = $weekLabel
    } else {
        $state | Add-Member -NotePropertyName $stateKey -NotePropertyValue $weekLabel -Force
    }
    Save-RunState $state
    Write-Step "Recorded $chartLabel post for $weekLabel in run state" "DarkGray"

    Write-Host ""
    Write-Host "Done!" -ForegroundColor Green
}
else {
    Write-Step "Instagram posting failed" "Red"
    exit 1
}
