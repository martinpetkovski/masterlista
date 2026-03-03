# generate-site-master.ps1
# Generates site-master.json with all pre-calculated data needed to render the site.
# This eliminates client-side calculations — the site just reads and displays.
#
# Usage:
#   ./scripts/generate-site-master.ps1

param()

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host "  Generating site-master.json" -ForegroundColor Cyan
Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date

# ============================================================================
#  LOAD SOURCE DATA
# ============================================================================

Write-Host "  > Loading source data..." -ForegroundColor Yellow

$bandsPath = Join-Path $projectRoot "bands.json"
$chartPath = Join-Path $projectRoot "chart-data.json"
$articlesPath = Join-Path $projectRoot "articles.json"
$eventsPath = Join-Path $projectRoot "events.json"
$curatorsPath = Join-Path $projectRoot "curators.json"
$curatorTracklistsPath = Join-Path $projectRoot "curators-tracklists.json"
$xotelLinksPath = Join-Path $projectRoot "xotel-links.json"
$xotelVideosPath = Join-Path $projectRoot "xotel-videos.json"
$blacklistPath = Join-Path $projectRoot "news-word-blacklist.txt"
$chartHistoryDir = Join-Path $projectRoot "chart-history"

# Load bands.json
$bandsJson = Get-Content $bandsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bandsData = $bandsJson.muzickaMasterLista

# Load chart-data.json
$chartJson = Get-Content $chartPath -Raw -Encoding UTF8 | ConvertFrom-Json
$releases = $chartJson.releases

# Load articles.json
$articlesJson = Get-Content $articlesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$allArticles = $articlesJson.articles

# Load events.json
$eventsJson = Get-Content $eventsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$eventsData = $eventsJson.events

# Load curators.json
$curatorsJson = if (Test-Path $curatorsPath) { Get-Content $curatorsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$curatorsData = if ($curatorsJson) { $curatorsJson.curators } else { @() }

# Load curators-tracklists.json
$curatorTracklistsJson = if (Test-Path $curatorTracklistsPath) { Get-Content $curatorTracklistsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }

# Load xotel-links.json
$xotelLinks = if (Test-Path $xotelLinksPath) { Get-Content $xotelLinksPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { @() }

# Load xotel-videos.json
$xotelVideos = if (Test-Path $xotelVideosPath) { Get-Content $xotelVideosPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { @() }

# Load news word blacklist
$blacklistWords = @()
if (Test-Path $blacklistPath) {
    $blacklistWords = Get-Content $blacklistPath -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') }
}

Write-Host "  > Loaded: $($bandsData.Count) bands, $($releases.Count) releases, $($allArticles.Count) articles, $($eventsData.Count) events" -ForegroundColor DarkGray

# ============================================================================
#  GENRE CONFIGURATION (mirrors common.js)
# ============================================================================

$rapGenres = @('Рап', 'Трап', 'Хип Хоп', 'Бум Бап', 'Поп-Рап')
$electronicGenres = @('Електронска', 'Техно', 'Хаус', 'Транс', 'Синтвејв', 'Синт-Поп', 'EDM', 'ДНБ', 'Драм', 'Амбиентална', 'Вејпорвејв', 'Драм ен Бас', 'Психоделичен Транс', 'Гоа', 'Глич', 'Чилаут', 'Електро-амбиентал', 'Трип Хоп', 'Псајбас', 'Псајдаб')
$popGenres = @('Поп', 'Поп-Рок', 'Поп Рок', 'Данс Поп', 'Синт-Поп', 'К-Поп', 'Турбо-Фолк', 'R&B', 'Поп-Фолк', "Р'н'Б", 'Шлагер', 'Соул')
$nonAltGenres = $rapGenres + $electronicGenres + $popGenres

# ============================================================================
#  HELPER FUNCTIONS
# ============================================================================

# ISO Week calculation (matching common.js getISOWeek)
function Get-ISOWeek {
    param([DateTime]$Date)
    $d = $Date.Date
    $dow = [int]$d.DayOfWeek
    if ($dow -eq 0) { $dow = 7 }
    $d = $d.AddDays(4 - $dow)
    $yearStart = [DateTime]::new($d.Year, 1, 1)
    $weekNum = [Math]::Ceiling((($d - $yearStart).Days + 1) / 7.0)
    return @{ year = $d.Year; week = $weekNum }
}

# Get artist info from bands data (matching common.js getArtistInfoByName)
function Get-ArtistInfo {
    param([string]$artistName)
    if (-not $artistName) { return $null }
    $normalised = $artistName.ToLower().Trim()
    foreach ($b in $bandsData) {
        if ($b.name.ToLower().Trim() -eq $normalised) { return $b }
    }
    # Try first artist in collab
    $firstArtist = ($artistName -split ',')[0].Trim().ToLower()
    if ($firstArtist -ne $normalised) {
        foreach ($b in $bandsData) {
            if ($b.name.ToLower().Trim() -eq $firstArtist) { return $b }
        }
    }
    return $null
}

# Split genre string to array
function Split-Genres {
    param([string]$genreStr)
    if (-not $genreStr -or $genreStr.ToLower() -eq 'недостигаат податоци') { return @() }
    return ($genreStr -split ',\s*') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
}

# Check if artist matches genre filter (matching common.js artistMatchesGenre)
function Test-ArtistGenre {
    param([string]$artistName, [string]$genreFilter)
    if ($genreFilter -eq 'all') { return $true }
    $info = Get-ArtistInfo $artistName
    if (-not $info -or -not $info.genre) { return $false }
    $artistGenres = Split-Genres $info.genre
    if ($artistGenres.Count -eq 0) { return $false }
    
    if ($genreFilter -eq 'alt') {
        if ($info.genre.ToLower() -eq 'недостигаат податоци') { return $false }
        $excludeLower = $nonAltGenres | ForEach-Object { $_.ToLower() }
        foreach ($ag in $artistGenres) {
            if ($excludeLower -contains $ag) { return $false }
        }
        return $true
    }
    
    $configGenres = switch ($genreFilter) {
        'rap' { $rapGenres }
        'electronic' { $electronicGenres }
        'pop' { $popGenres }
        default { @() }
    }
    $configLower = $configGenres | ForEach-Object { $_.ToLower() }
    foreach ($ag in $artistGenres) {
        if ($configLower -contains $ag) { return $true }
    }
    return $false
}

# Check if artist matches city filter
function Test-ArtistCity {
    param([string]$artistName, [string]$cityFilter)
    if ($cityFilter -eq 'all') { return $true }
    $cityLabels = @{ 'skopje' = 'скопје'; 'bitola' = 'битола' }
    $target = $cityLabels[$cityFilter]
    if (-not $target) { return $true }
    $info = Get-ArtistInfo $artistName
    if (-not $info -or -not $info.city) { return $false }
    return $info.city.ToLower().Contains($target)
}

# Deduplicate collaborative releases (matching common.js deduplicateCollabs)
function Invoke-DeduplicateCollabs {
    param([array]$releasesArr)
    $map = [ordered]@{}
    foreach ($r in $releasesArr) {
        $id = $r.releaseId
        if ($map.Contains($id)) {
            $existing = $map[$id]
            $names = $existing.bandName -split ', '
            if ($names -notcontains $r.bandName) {
                $existing.bandName = ($names + $r.bandName) -join ', '
            }
            if (($r.popularity -as [int]) -gt ($existing.popularity -as [int])) { $existing.popularity = $r.popularity }
            if (($r.followers -as [int]) -gt ($existing.followers -as [int])) { $existing.followers = $r.followers }
            $existing | Add-Member -NotePropertyName isCollab -NotePropertyValue $true -Force
        } else {
            # Clone the object
            $clone = $r | ConvertTo-Json -Depth 5 | ConvertFrom-Json
            $map[$id] = $clone
        }
    }
    return @($map.Values)
}

# Chart sort comparator (matching common.js chartSort: popularity desc, followers desc, name asc)
function Sort-ChartRanking {
    param([array]$items)
    return $items | Sort-Object @(
        @{ Expression = { -([int]($_.popularity -as [int])) } },
        @{ Expression = { -([int]($_.followers -as [int])) } },
        @{ Expression = { $_.bandName } }
    )
}

# Build chart ranking (matching common.js buildChartRanking)
function Build-ChartRanking {
    param(
        [array]$releasesArr,
        [string]$type = 'single',
        [string]$genre = 'all',
        [string]$city = 'all',
        [int]$count = 20
    )
    
    $deduped = Invoke-DeduplicateCollabs $releasesArr
    
    # Filter by release type
    $filtered = if ($type -eq 'album') {
        $deduped | Where-Object { $_.releaseType -eq 'album' -or $_.releaseType -eq 'compilation' }
    } else {
        $deduped | Where-Object { $_.releaseType -eq 'single' }
    }
    $filtered = @($filtered)
    
    # Filter by genre
    if ($genre -ne 'all') {
        $filtered = @($filtered | Where-Object { Test-ArtistGenre $_.bandName $genre })
    }
    
    # Filter by city
    if ($city -ne 'all') {
        $filtered = @($filtered | Where-Object { Test-ArtistCity $_.bandName $city })
    }
    
    # count=0 means return ALL
    if ($count -eq 0) {
        return @(Sort-ChartRanking $filtered)
    }
    
    # Eligibility cutoff with backfill — 4 weeks for singles, 8 weeks for albums
    $minPool = [Math]::Max($count, 20)
    $cutoffWeeks = if ($type -eq 'album') { 8 } else { 4 }
    $cutoffDate = (Get-Date).AddDays(-($cutoffWeeks * 7))
    $cutoff = $cutoffDate.ToString("yyyy-MM-dd")
    
    $recent = @($filtered | Where-Object { $_.releaseDate -ge $cutoff })
    $pool = [System.Collections.ArrayList]::new()
    $pool.AddRange($recent)
    
    if ($pool.Count -lt $minPool) {
        $older = @($filtered | Where-Object { $_.releaseDate -lt $cutoff } | Sort-Object { $_.releaseDate } -Descending)
        $needed = $minPool - $pool.Count
        $backfill = $older | Select-Object -First $needed
        if ($backfill) { $pool.AddRange(@($backfill)) }
    }
    
    $sorted = @(Sort-ChartRanking @($pool))
    return @($sorted | Select-Object -First $count)
}

# ============================================================================
#  LOAD CHART HISTORY
# ============================================================================

Write-Host "  > Loading chart history..." -ForegroundColor Yellow

$chartHistoryWeeks = @()  # Array of { weekId, releases }
$historyFiles = Get-ChildItem -Path $chartHistoryDir -Filter "chart-*.json" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

foreach ($file in $historyFiles) {
    $weekId = $file.BaseName -replace '^chart-', ''
    $data = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $chartHistoryWeeks += @{
        weekId = $weekId
        releases = $data.releases
    }
}

Write-Host "  > Loaded $($chartHistoryWeeks.Count) chart history weeks" -ForegroundColor DarkGray

# Get previous week's data (second newest)
$previousWeekReleases = @()
if ($chartHistoryWeeks.Count -ge 2) {
    $previousWeekReleases = $chartHistoryWeeks[1].releases
} elseif ($chartHistoryWeeks.Count -ge 1) {
    # If only one history week, use it as previous (current chart-data.json is "this week")
    $previousWeekReleases = $chartHistoryWeeks[0].releases
}

# ============================================================================
#  1. PRE-CALCULATE CHARTS
# ============================================================================

Write-Host "  > Calculating chart rankings..." -ForegroundColor Yellow

$genreFilters = @('all', 'alt', 'rap', 'electronic', 'pop')
$typeFilters = @('single', 'album')

# Build ranked charts for all genre combinations (standard = count 20, plus count 0 for advanced)
$charts = @{}
foreach ($genre in $genreFilters) {
    foreach ($type in $typeFilters) {
        $key = "${genre}_${type}"
        $ranked = Build-ChartRanking -releasesArr $releases -type $type -genre $genre -count 20
        
        # Build previous chart map for position/popularity changes
        $prevRanked = Build-ChartRanking -releasesArr $previousWeekReleases -type $type -genre $genre -count 20
        $prevMap = @{}
        for ($i = 0; $i -lt $prevRanked.Count; $i++) {
            $prevMap[$prevRanked[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($prevRanked[$i].popularity -as [int])
            }
        }
        
        # Enrich ranked items with position changes
        $enriched = @()
        for ($i = 0; $i -lt $ranked.Count; $i++) {
            $r = $ranked[$i]
            $pos = $i + 1
            $posChange = $null
            $popChange = $null
            $isNew = $true
            
            if ($prevMap.ContainsKey($r.releaseId)) {
                $prev = $prevMap[$r.releaseId]
                $posChange = $prev.position - $pos  # positive = moved up
                $popChange = ([int]($r.popularity -as [int])) - $prev.popularity
                $isNew = $false
            }
            
            $artistInfo = Get-ArtistInfo $r.bandName
            
            $enriched += [PSCustomObject]@{
                releaseId     = $r.releaseId
                bandName      = $r.bandName
                artistId      = $r.artistId
                releaseTitle  = $r.releaseTitle
                releaseType   = $r.releaseType
                releaseDate   = $r.releaseDate
                releaseUrl    = $r.releaseUrl
                thumbnail     = $r.thumbnail
                totalTracks   = $r.totalTracks
                popularity    = [int]($r.popularity -as [int])
                followers     = [int]($r.followers -as [int])
                spotifyUrl    = $r.spotifyUrl
                topTrackName  = $r.topTrackName
                topTrackId    = $r.topTrackId
                topTrackUrl   = $r.topTrackUrl
                position      = $pos
                positionChange = $posChange
                popularityChange = $popChange
                isNewEntry    = $isNew
                confirmed     = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
                isCollab      = if ($r.isCollab) { $true } else { $false }
            }
        }
        
        $charts[$key] = $enriched
    }
}

# Also build advanced (count=0) charts for all genre filters
$advancedCharts = @{}
foreach ($genre in $genreFilters) {
    foreach ($type in $typeFilters) {
        $key = "${genre}_${type}_advanced"
        $ranked = Build-ChartRanking -releasesArr $releases -type $type -genre $genre -count 0
        
        $prevRanked = Build-ChartRanking -releasesArr $previousWeekReleases -type $type -genre $genre -count 0
        $prevMap = @{}
        for ($i = 0; $i -lt $prevRanked.Count; $i++) {
            $prevMap[$prevRanked[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($prevRanked[$i].popularity -as [int])
            }
        }
    
    $enriched = @()
    for ($i = 0; $i -lt $ranked.Count; $i++) {
        $r = $ranked[$i]
        $pos = $i + 1
        $posChange = $null
        $popChange = $null
        $isNew = $true
        
        if ($prevMap.ContainsKey($r.releaseId)) {
            $prev = $prevMap[$r.releaseId]
            $posChange = $prev.position - $pos
            $popChange = ([int]($r.popularity -as [int])) - $prev.popularity
            $isNew = $false
        }
        
        $artistInfo = Get-ArtistInfo $r.bandName
        
        $enriched += [PSCustomObject]@{
            releaseId     = $r.releaseId
            bandName      = $r.bandName
            artistId      = $r.artistId
            releaseTitle  = $r.releaseTitle
            releaseType   = $r.releaseType
            releaseDate   = $r.releaseDate
            releaseUrl    = $r.releaseUrl
            thumbnail     = $r.thumbnail
            totalTracks   = $r.totalTracks
            popularity    = [int]($r.popularity -as [int])
            followers     = [int]($r.followers -as [int])
            spotifyUrl    = $r.spotifyUrl
            topTrackName  = $r.topTrackName
            topTrackId    = $r.topTrackId
            topTrackUrl   = $r.topTrackUrl
            position      = $pos
            positionChange = $posChange
            popularityChange = $popChange
            isNewEntry    = $isNew
            confirmed     = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            isCollab      = if ($r.isCollab) { $true } else { $false }
            genre         = if ($artistInfo) { $artistInfo.genre } else { $null }
            city          = if ($artistInfo) { $artistInfo.city } else { $null }
        }
    }
    
    $advancedCharts[$key] = $enriched
    }
}

Write-Host "  > Built charts for $($charts.Keys.Count) genre/type combos + $($advancedCharts.Keys.Count) advanced" -ForegroundColor DarkGray

# ============================================================================
#  2. BUILD CHART HISTORY MAP (for tooltips, per-release weekly positions)
# ============================================================================

Write-Host "  > Building chart history map..." -ForegroundColor Yellow

# For tooltip display: last 10 weeks of ranked history per release, keyed by genre
$tooltipWeekCount = [Math]::Min(10, $chartHistoryWeeks.Count)
$releaseHistoryByGenre = @{}  # genre -> { releaseId -> array of { weekId, popularity, singlesPos, albumsPos } }

foreach ($genre in $genreFilters) {
    $genreHistoryMap = @{}  # releaseId -> array
    
    for ($w = 0; $w -lt $tooltipWeekCount; $w++) {
        $weekData = $chartHistoryWeeks[$w]
        $weekId = $weekData.weekId
        $weekReleases = $weekData.releases
        
        # Rank singles and albums for this historical week with genre filter
        $rankedSingles = Build-ChartRanking -releasesArr $weekReleases -type 'single' -genre $genre -count 20
        $rankedAlbums = Build-ChartRanking -releasesArr $weekReleases -type 'album' -genre $genre -count 20
        
        $singlesPos = @{}
        for ($i = 0; $i -lt $rankedSingles.Count; $i++) {
            $singlesPos[$rankedSingles[$i].releaseId] = $i + 1
        }
        $albumsPos = @{}
        for ($i = 0; $i -lt $rankedAlbums.Count; $i++) {
            $albumsPos[$rankedAlbums[$i].releaseId] = $i + 1
        }
        
        # Get all unique releases for this week that match genre filter
        $deduped = Invoke-DeduplicateCollabs $weekReleases
        $filtered = if ($genre -eq 'all') { $deduped } else {
            @($deduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
        }
        
        foreach ($r in $filtered) {
            $rid = $r.releaseId
            if (-not $genreHistoryMap.ContainsKey($rid)) {
                $genreHistoryMap[$rid] = @()
            }
            $genreHistoryMap[$rid] += @{
                weekId = $weekId
                popularity = [int]($r.popularity -as [int])
                singlesPos = if ($singlesPos.ContainsKey($rid)) { $singlesPos[$rid] } else { $null }
                albumsPos = if ($albumsPos.ContainsKey($rid)) { $albumsPos[$rid] } else { $null }
            }
        }
    }
    
    # Sort each release's history oldest-first
    foreach ($rid in @($genreHistoryMap.Keys)) {
        $genreHistoryMap[$rid] = @($genreHistoryMap[$rid] | Sort-Object { $_.weekId })
    }
    
    $releaseHistoryByGenre[$genre] = $genreHistoryMap
}

# Keep backward-compat: releaseHistoryMap = all genre
$releaseHistoryMap = $releaseHistoryByGenre['all']

Write-Host "  > Built history for $($releaseHistoryMap.Count) releases across $tooltipWeekCount weeks (x$($genreFilters.Count) genres)" -ForegroundColor DarkGray

# ============================================================================
#  3. ARTIST POPULARITY GRAPHS (for artist.html — 20 weeks)
# ============================================================================

Write-Host "  > Building artist popularity graphs..." -ForegroundColor Yellow

$artistGraphWeekCount = [Math]::Min(20, $chartHistoryWeeks.Count)
$artistPopularityGraphs = @{}  # artistName(lower) -> array of { weekId, value, hasNewRelease }

for ($w = 0; $w -lt $artistGraphWeekCount; $w++) {
    $weekData = $chartHistoryWeeks[$w]
    $weekId = $weekData.weekId
    $weekReleases = $weekData.releases
    
    # Parse week boundaries for new release detection
    $yearWeek = $weekId -split '-W'
    $wYear = [int]$yearWeek[0]
    $wWeek = [int]$yearWeek[1]
    # Calculate Monday of that ISO week
    $jan4 = [DateTime]::new($wYear, 1, 4)
    $dayOfWeek = [int]$jan4.DayOfWeek
    if ($dayOfWeek -eq 0) { $dayOfWeek = 7 }
    $weekMonday = $jan4.AddDays(($wWeek - 1) * 7 - $dayOfWeek + 1)
    $weekSunday = $weekMonday.AddDays(6)
    $weekMondayStr = $weekMonday.ToString("yyyy-MM-dd")
    $weekSundayStr = $weekSunday.ToString("yyyy-MM-dd")
    
    # Group releases by artist name (lowercase)
    $artistWeekPop = @{}
    $artistNewRelease = @{}
    
    foreach ($r in $weekReleases) {
        $key = $r.bandName.ToLower().Trim()
        if (-not $artistWeekPop.ContainsKey($key)) {
            $artistWeekPop[$key] = 0
            $artistNewRelease[$key] = $false
        }
        $artistWeekPop[$key] += [int]($r.popularity -as [int])
        
        # Check if release date falls within this week
        if ($r.releaseDate -ge $weekMondayStr -and $r.releaseDate -le $weekSundayStr) {
            $artistNewRelease[$key] = $true
        }
    }
    
    foreach ($artistKey in $artistWeekPop.Keys) {
        if (-not $artistPopularityGraphs.ContainsKey($artistKey)) {
            $artistPopularityGraphs[$artistKey] = @()
        }
        $artistPopularityGraphs[$artistKey] += @{
            weekId = $weekId
            value = $artistWeekPop[$artistKey]
            hasNewRelease = $artistNewRelease[$artistKey]
        }
    }
}

# Sort each artist's graph data oldest-first
foreach ($key in @($artistPopularityGraphs.Keys)) {
    $artistPopularityGraphs[$key] = @($artistPopularityGraphs[$key] | Sort-Object { $_.weekId })
}

Write-Host "  > Built popularity graphs for $($artistPopularityGraphs.Count) artists" -ForegroundColor DarkGray

# ============================================================================
#  4. ALL-TIME ARTISTS (sorted by followers, per genre)
# ============================================================================

Write-Host "  > Building all-time artist rankings..." -ForegroundColor Yellow

$deduped = Invoke-DeduplicateCollabs $releases
$allTimeArtistsByGenre = @{}  # genre -> array of top 100 artists

foreach ($genre in $genreFilters) {
    $artistFollowerMap = @{}  # artistId -> { bandName, followers, spotifyUrl, thumbnail }
    foreach ($r in $deduped) {
        $aid = $r.artistId
        if (-not $aid) { continue }
        # Apply genre filter
        if ($genre -ne 'all') {
            $info = Get-ArtistInfo $r.bandName
            if (-not $info) { continue }
            if (-not (Test-ArtistGenre $r.bandName $genre)) { continue }
        }
        $existing = $artistFollowerMap[$aid]
        if (-not $existing -or ([int]($r.followers -as [int])) -gt $existing.followers) {
            $bandInfo = Get-ArtistInfo $r.bandName
            $artistFollowerMap[$aid] = @{
                artistId = $aid
                bandName = if ($bandInfo) { $bandInfo.name } else { $r.bandName }
                followers = [int]($r.followers -as [int])
                spotifyUrl = $r.spotifyUrl
                thumbnail = $r.thumbnail
                confirmed = if ($bandInfo) { [bool]$bandInfo.confirmed } else { $false }
            }
        }
    }
    $allTimeArtistsByGenre[$genre] = @($artistFollowerMap.Values | Sort-Object { -$_.followers } | Select-Object -First 100)
}

# Backward compat: allTimeArtists = 'all' genre
$allTimeArtists = $allTimeArtistsByGenre['all']

Write-Host "  > Ranked all-time artists for $($genreFilters.Count) genres" -ForegroundColor DarkGray

# ============================================================================
#  5. LATEST RELEASES (newest 20, deduped, per genre)
# ============================================================================

Write-Host "  > Building latest releases..." -ForegroundColor Yellow

$latestReleasesByGenre = @{}  # genre -> array of latest 20

foreach ($genre in $genreFilters) {
    $genreFiltered = if ($genre -eq 'all') { $deduped } else {
        @($deduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
    }
    $latestReleasesByGenre[$genre] = @($genreFiltered | Sort-Object { $_.releaseDate } -Descending | Select-Object -First 20 |
        ForEach-Object {
            $typeLabel = switch ($_.releaseType) {
                'album' { 'Албум' }
                'compilation' { 'Комп.' }
                default { 'Сингл' }
            }
            $artistInfo = Get-ArtistInfo $_.bandName
            [PSCustomObject]@{
                releaseId    = $_.releaseId
                bandName     = $_.bandName
                artistId     = $_.artistId
                releaseTitle = $_.releaseTitle
                releaseType  = $_.releaseType
                releaseDate  = $_.releaseDate
                releaseUrl   = $_.releaseUrl
                thumbnail    = $_.thumbnail
                totalTracks  = $_.totalTracks
                popularity   = [int]($_.popularity -as [int])
                followers    = [int]($_.followers -as [int])
                spotifyUrl   = $_.spotifyUrl
                typeLabel    = $typeLabel
                confirmed    = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            }
        })
}

# Backward compat
$latestReleases = $latestReleasesByGenre['all']

# ============================================================================
#  6. HOT SONGS (songs with positive popularity change vs last week)
# ============================================================================

Write-Host "  > Calculating hot songs..." -ForegroundColor Yellow

$currentRanked = Build-ChartRanking -releasesArr $releases -type 'single' -genre 'all' -count 0
$prevRanked = Build-ChartRanking -releasesArr $previousWeekReleases -type 'single' -genre 'all' -count 0
$prevMapHot = @{}
for ($i = 0; $i -lt $prevRanked.Count; $i++) {
    $prevMapHot[$prevRanked[$i].releaseId] = @{
        position = $i + 1
        popularity = [int]($prevRanked[$i].popularity -as [int])
    }
}

$hotSongs = @()
for ($i = 0; $i -lt $currentRanked.Count; $i++) {
    $r = $currentRanked[$i]
    if ($prevMapHot.ContainsKey($r.releaseId)) {
        $prev = $prevMapHot[$r.releaseId]
        $popChange = ([int]($r.popularity -as [int])) - $prev.popularity
        if ($popChange -gt 0) {
            $artistInfo = Get-ArtistInfo $r.bandName
            $hotSongs += [PSCustomObject]@{
                releaseId    = $r.releaseId
                bandName     = $r.bandName
                releaseTitle = $r.releaseTitle
                releaseUrl   = $r.releaseUrl
                thumbnail    = $r.thumbnail
                popularity   = [int]($r.popularity -as [int])
                popularityChange = $popChange
                confirmed    = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            }
        }
    }
}

Write-Host "  > Found $($hotSongs.Count) hot songs" -ForegroundColor DarkGray

# ============================================================================
#  7. RISING ARTISTS
# ============================================================================

Write-Host "  > Calculating rising artists..." -ForegroundColor Yellow

$now = Get-Date
$twoYearCutoff = ($now.AddYears(-2)).ToString("yyyy-MM-dd")

# Group releases by artist
$artistReleaseGroups = @{}
foreach ($r in $releases) {
    $name = $r.bandName
    if (-not $artistReleaseGroups.ContainsKey($name)) {
        $artistReleaseGroups[$name] = @()
    }
    $artistReleaseGroups[$name] += $r
}

$risingArtists = @()
foreach ($name in $artistReleaseGroups.Keys) {
    $rels = @($artistReleaseGroups[$name] | Sort-Object releaseDate)
    
    # Skip if ANY release is older than 2 years
    if ($rels[0].releaseDate -lt $twoYearCutoff) { continue }
    
    # Skip if 10+ releases (Spotify API cap — can't verify truly new)
    if ($rels.Count -ge 10) { continue }
    
    $latestRelease = $rels[-1]
    $latestPop = [int]($latestRelease.popularity -as [int])
    $earliestPop = [int]($rels[0].popularity -as [int])
    $maxPop = ($rels | ForEach-Object { [int]($_.popularity -as [int]) } | Measure-Object -Maximum).Maximum
    
    # Minimum popularity threshold
    if ($maxPop -lt 3) { continue }
    
    $popTrend = if ($rels.Count -gt 1) { $latestPop - $earliestPop } else { 0 }
    $daysSinceLatest = [Math]::Floor(($now - [DateTime]::ParseExact($latestRelease.releaseDate, 'yyyy-MM-dd', $null)).TotalDays)
    $recencyBonus = [Math]::Max(0, 180 - $daysSinceLatest)
    $activityBonus = if ($rels.Count -ge 2) { 25 } else { 0 }
    $score = $latestPop + [Math]::Max(0, $popTrend) * 2 + $recencyBonus + $activityBonus
    
    $bandInfo = Get-ArtistInfo $name
    
    # Determine badge
    $badge = if ($popTrend -gt 5) { "hot" }
             elseif ($rels.Count -ge 3) { "rising" }
             else { "fresh" }
    $badgeLabel = switch ($badge) {
        "hot" { "📈 ВО ПОДЕМ" }
        "rising" { "🔥 АКТИВЕН" }
        "fresh" { "✨ НОВ" }
    }
    
    $risingArtists += [PSCustomObject]@{
        name       = if ($bandInfo) { $bandInfo.name } else { $name }
        image      = if ($bandInfo -and $bandInfo.image) { $bandInfo.image } else { $latestRelease.thumbnail }
        genre      = if ($bandInfo) { $bandInfo.genre } else { '' }
        score      = $score
        count      = $rels.Count
        maxPop     = $maxPop
        latestPop  = $latestPop
        popTrend   = $popTrend
        badge      = $badge
        badgeLabel = $badgeLabel
        confirmed  = if ($bandInfo) { [bool]$bandInfo.confirmed } else { $false }
    }
}

# Sort by score descending
$risingArtists = @($risingArtists | Sort-Object { -$_.score })

Write-Host "  > Found $($risingArtists.Count) rising artist candidates" -ForegroundColor DarkGray

# ============================================================================
#  8. ACTIVITY STATUS PER ARTIST
# ============================================================================

Write-Host "  > Computing artist activity statuses..." -ForegroundColor Yellow

$oneYearAgoStr = ($now.AddYears(-1)).ToString("yyyy-MM-dd")
$twoYearCutoffActivity = ($now.AddYears(-2)).ToString("yyyy-MM-dd")
$threeYearCutoff = ($now.AddYears(-3)).ToString("yyyy-MM-dd")

# Build latest release date per artist
$latestReleaseDateByArtist = @{}
foreach ($r in $releases) {
    if (-not $r.bandName -or -not $r.releaseDate) { continue }
    $key = $r.bandName.ToLower().Trim()
    if (-not $latestReleaseDateByArtist.ContainsKey($key) -or $r.releaseDate -gt $latestReleaseDateByArtist[$key]) {
        $latestReleaseDateByArtist[$key] = $r.releaseDate
    }
}

# Check recent events per artist
$recentEventArtists = @{}
foreach ($e in $eventsData) {
    if ($e.date -ge $oneYearAgoStr -and $e.artists) {
        foreach ($a in $e.artists) {
            $recentEventArtists[$a.ToLower()] = $true
        }
    }
}

$artistActivityMap = @{}
foreach ($b in $bandsData) {
    $key = $b.name.ToLower().Trim()
    
    if ($recentEventArtists.ContainsKey($key)) {
        $artistActivityMap[$key] = 'Активен'
        continue
    }
    
    $dateStr = $latestReleaseDateByArtist[$key]
    if (-not $dateStr) {
        $artistActivityMap[$key] = 'Непознато'
        continue
    }
    
    if ($dateStr -ge $twoYearCutoffActivity) {
        $artistActivityMap[$key] = 'Активен'
    } elseif ($dateStr -ge $threeYearCutoff) {
        $artistActivityMap[$key] = 'Можеби'
    } else {
        $artistActivityMap[$key] = 'Неактивен'
    }
}

Write-Host "  > Computed activity for $($artistActivityMap.Count) artists" -ForegroundColor DarkGray

# ============================================================================
#  9. NEWS (filtered and matched against artists, with blacklist)
# ============================================================================

Write-Host "  > Filtering and matching news articles..." -ForegroundColor Yellow

# Build Cyrillic-safe word boundary pattern
$boundaryChars = '[\s,;:.!?\-\u2013\u2014\/\(\)\[\]"''\ |«»\u201E\u201C\u2018\u2019\u201c\u201d]'

# Build artist name patterns (skip names <= 2 chars)
$artistPatterns = @()
foreach ($b in $bandsData) {
    if ($b.name -and $b.name.Length -gt 2) {
        $artistPatterns += @{
            name = $b.name
            pattern = $b.name
        }
    }
}

function Test-ArticleBlacklist {
    param([string]$title, [string]$description)
    $text = "$title $description".ToLower()
    foreach ($word in $blacklistWords) {
        if ($text.Contains($word.ToLower())) {
            return $true  # Blacklisted
        }
    }
    return $false
}

function Get-MatchedArtists {
    param([string]$title, [string]$description)
    $haystack = "$title $description"
    # Use ArrayList so ConvertTo-Json always emits [] not a scalar or {}
    $matched = [System.Collections.ArrayList]@()
    
    foreach ($artist in $artistPatterns) {
        $pattern = $artist.pattern
        # Capitalize first letter
        $term = if ($pattern.Length -gt 0 -and -not ($pattern[0] -match '^\d')) {
            $pattern[0].ToString().ToUpper() + $pattern.Substring(1)
        } else { $pattern }
        
        # Escape regex special chars
        $escaped = [regex]::Escape($term)
        $regex = "(?:^|$boundaryChars)$escaped(?:$|$boundaryChars)"
        
        if ([regex]::IsMatch($haystack, $regex)) {
            if (-not $matched.Contains($artist.name)) {
                [void]$matched.Add($artist.name)
            }
        }
    }
    return ,$matched
}

# Process all articles: filter by blacklist, then match artists
$matchedArticles = @()
$allFilteredArticles = @()

foreach ($article in $allArticles) {
    # Apply blacklist
    if (Test-ArticleBlacklist $article.title $article.description) {
        continue
    }
    
    $artists = Get-MatchedArtists $article.title $article.description
    
    $filteredArticle = [PSCustomObject]@{
        title         = $article.title
        link          = $article.link
        description   = $article.description
        date          = $article.date
        source        = $article.source
        siteUrl       = $article.siteUrl
        iconUrl       = $article.iconUrl
        thumbnail     = $article.thumbnail
        matchedArtists = $artists
    }
    
    $allFilteredArticles += $filteredArticle
    
    if ($artists.Count -gt 0) {
        $matchedArticles += $filteredArticle
    }
}

# Sort by date descending
$matchedArticles = @($matchedArticles | Sort-Object { $_.date } -Descending)
$allFilteredArticles = @($allFilteredArticles | Sort-Object { $_.date } -Descending)

Write-Host "  > Filtered articles: $($allFilteredArticles.Count) passed blacklist, $($matchedArticles.Count) matched artists" -ForegroundColor DarkGray

# ============================================================================
#  10. UPCOMING EVENTS (next 14 days)
# ============================================================================

Write-Host "  > Processing events..." -ForegroundColor Yellow

$todayStr = $now.ToString("yyyy-MM-dd")
$twoWeeksStr = ($now.AddDays(14)).ToString("yyyy-MM-dd")

$upcomingEvents = @($eventsData |
    Where-Object { $_.date -ge $todayStr -and $_.date -le $twoWeeksStr } |
    Sort-Object date)

# All events sorted
$allEvents = @($eventsData | Sort-Object { $_.date } -Descending)

Write-Host "  > $($upcomingEvents.Count) upcoming events (next 14 days)" -ForegroundColor DarkGray

# ============================================================================
#  11. RELEASE RADAR (latest 5 releases)
# ============================================================================

$releaseRadar = @($deduped | Sort-Object { $_.releaseDate } -Descending | Select-Object -First 5 |
    ForEach-Object {
        $typeLabel = switch ($_.releaseType) {
            'album' { 'Албум' }
            'compilation' { 'Комп.' }
            default { 'Сингл' }
        }
        $artistInfo = Get-ArtistInfo $_.bandName
        [PSCustomObject]@{
            releaseId    = $_.releaseId
            bandName     = $_.bandName
            releaseTitle = $_.releaseTitle
            releaseType  = $_.releaseType
            releaseDate  = $_.releaseDate
            releaseUrl   = $_.releaseUrl
            thumbnail    = $_.thumbnail
            popularity   = [int]($_.popularity -as [int])
            typeLabel    = $typeLabel
            confirmed    = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
        }
    })

# ============================================================================
#  12. HEADER COLLAGE THUMBNAILS
# ============================================================================

$headerThumbs = @($charts["all_single"] | ForEach-Object { $_.thumbnail } | Where-Object { $_ })

# ============================================================================
#  13. XOTEL VIDEOS
# ============================================================================

$xotelVideoIds = @()
foreach ($link in $xotelLinks) {
    # Support both plain URL strings and objects with .url property
    $url = if ($link -is [string]) { $link } else { $link.url }
    if ($url -match '(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})') {
        $xotelVideoIds += $Matches[1]
    }
}

# ============================================================================
#  14. ISO WEEK INFO
# ============================================================================

$isoWeek = Get-ISOWeek -Date $now
$weekLabel = "W$($isoWeek.week.ToString().PadLeft(2,'0')) $($isoWeek.year)"

# ============================================================================
#  15. BUILD RELEASE SPARKLINES PER ARTIST (for artist.html)
# ============================================================================

Write-Host "  > Building per-release sparklines..." -ForegroundColor Yellow

# For each release, build weekly popularity values from chart history
$releaseSparklines = @{}
$sparkWeekCount = [Math]::Min(20, $chartHistoryWeeks.Count)

for ($w = 0; $w -lt $sparkWeekCount; $w++) {
    $weekData = $chartHistoryWeeks[$w]
    $weekId = $weekData.weekId
    foreach ($r in $weekData.releases) {
        $rid = $r.releaseId
        if (-not $releaseSparklines.ContainsKey($rid)) {
            $releaseSparklines[$rid] = @()
        }
        $releaseSparklines[$rid] += @{
            weekId = $weekId
            popularity = [int]($r.popularity -as [int])
        }
    }
}

# Sort oldest-first
foreach ($rid in @($releaseSparklines.Keys)) {
    $releaseSparklines[$rid] = @($releaseSparklines[$rid] | Sort-Object { $_.weekId })
}

Write-Host "  > Built sparklines for $($releaseSparklines.Count) releases" -ForegroundColor DarkGray

# ============================================================================
#  ASSEMBLE site-master.json
# ============================================================================

Write-Host ""
Write-Host "  > Assembling site-master.json..." -ForegroundColor Yellow

# Convert hashtable-based structures to proper objects for JSON serialization
$chartsOutput = @{}
foreach ($key in $charts.Keys) {
    $chartsOutput[$key] = @($charts[$key])
}

$advancedChartsOutput = @{}
foreach ($key in $advancedCharts.Keys) {
    $advancedChartsOutput[$key] = @($advancedCharts[$key])
}

# Convert releaseHistoryMap (per-genre)
$historyMapOutput = @{}
foreach ($genre in $releaseHistoryByGenre.Keys) {
    $genreMap = @{}
    foreach ($rid in $releaseHistoryByGenre[$genre].Keys) {
        $genreMap[$rid] = @($releaseHistoryByGenre[$genre][$rid])
    }
    $historyMapOutput[$genre] = $genreMap
}

# Convert allTimeArtistsByGenre
$allTimeArtistsByGenreOutput = @{}
foreach ($genre in $allTimeArtistsByGenre.Keys) {
    $allTimeArtistsByGenreOutput[$genre] = @($allTimeArtistsByGenre[$genre])
}

# Convert latestReleasesByGenre
$latestReleasesByGenreOutput = @{}
foreach ($genre in $latestReleasesByGenre.Keys) {
    $latestReleasesByGenreOutput[$genre] = @($latestReleasesByGenre[$genre])
}

# Convert artist popularity graphs
$graphsOutput = @{}
foreach ($key in $artistPopularityGraphs.Keys) {
    $graphsOutput[$key] = @($artistPopularityGraphs[$key])
}

# Convert activity map
$activityOutput = @{}
foreach ($key in $artistActivityMap.Keys) {
    $activityOutput[$key] = $artistActivityMap[$key]
}

# Convert release sparklines
$sparklinesOutput = @{}
foreach ($rid in $releaseSparklines.Keys) {
    $sparklinesOutput[$rid] = @($releaseSparklines[$rid])
}

$siteMaster = [PSCustomObject]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    isoWeek = $isoWeek
    weekLabel = $weekLabel
    
    # Chart data (original, for reference)
    chartData = [PSCustomObject]@{
        generatedAt   = $chartJson.generatedAt
        totalReleases = $chartJson.totalReleases
        totalArtists  = $chartJson.totalArtists
        releases      = $releases
    }
    
    # Pre-ranked charts: keys like "all_single", "alt_album", etc.
    # Each entry contains enriched items with position, positionChange, popularityChange, isNewEntry
    charts = $chartsOutput
    
    # Advanced (unlimited) charts for 'all' genre
    advancedCharts = $advancedChartsOutput
    
    # Per-release chart history (for tooltips), keyed by genre: genre -> { releaseId -> [{weekId, popularity, singlesPos, albumsPos}] }
    releaseHistory = $historyMapOutput
    
    # All-time top artists sorted by followers, keyed by genre
    allTimeArtists = $allTimeArtists
    allTimeArtistsByGenre = $allTimeArtistsByGenreOutput
    
    # Latest 20 releases sorted by date, keyed by genre
    latestReleases = $latestReleases
    latestReleasesByGenre = $latestReleasesByGenreOutput
    
    # Hot songs (positive popularity change vs last week)
    hotSongs = $hotSongs
    
    # Rising artist candidates (sorted by score desc)
    risingArtists = $risingArtists
    
    # Release radar (latest 5)
    releaseRadar = $releaseRadar
    
    # Activity status per artist: artistName(lower) -> status string
    artistActivity = $activityOutput
    
    # Artist popularity graphs: artistName(lower) -> [{weekId, value, hasNewRelease}]
    artistPopularityGraphs = $graphsOutput
    
    # Per-release sparklines: releaseId -> [{weekId, popularity}]
    releaseSparklines = $sparklinesOutput
    
    # Filtered news articles (matched against artist names, blacklist applied)
    news = [PSCustomObject]@{
        lastUpdated    = $articlesJson.lastUpdated
        matched        = $matchedArticles
        allFiltered    = $allFilteredArticles
    }
    
    # Events
    events = [PSCustomObject]@{
        upcoming = $upcomingEvents
        all      = $allEvents
    }
    
    # Header collage thumbnails (top 20 singles thumbnails)
    headerThumbs = $headerThumbs
    
    # Xotel video IDs
    xotelVideoIds = $xotelVideoIds
    
    # Xotel links (original)
    xotelLinks = $xotelLinks
}

# Write to file
$outputPath = Join-Path $projectRoot "site-master.json"
$json = $siteMaster | ConvertTo-Json -Depth 15 -Compress
[System.IO.File]::WriteAllText($outputPath, $json, [System.Text.Encoding]::UTF8)

$fileSize = [Math]::Round((Get-Item $outputPath).Length / 1KB, 1)
$elapsed = [Math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

Write-Host ""
Write-Host "  > site-master.json generated successfully!" -ForegroundColor Green
Write-Host "  > Size: ${fileSize} KB" -ForegroundColor DarkGray
Write-Host "  > Completed in ${elapsed}s" -ForegroundColor DarkGray
Write-Host ""
