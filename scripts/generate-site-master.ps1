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

# Pre-compute lowercase genre sets for fast lookup (HashSet)
$rapGenresLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$rapGenres | ForEach-Object { [void]$rapGenresLower.Add($_.ToLower()) }
$electronicGenresLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$electronicGenres | ForEach-Object { [void]$electronicGenresLower.Add($_.ToLower()) }
$popGenresLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$popGenres | ForEach-Object { [void]$popGenresLower.Add($_.ToLower()) }
$nonAltGenresLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$nonAltGenres | ForEach-Object { [void]$nonAltGenresLower.Add($_.ToLower()) }

# ============================================================================
#  ARTIST LOOKUP CACHE (O(1) instead of O(n) per lookup)
# ============================================================================

# Build hash map: lowercased name -> band object
$artistLookup = @{}
foreach ($b in $bandsData) {
    $key = $b.name.ToLower().Trim()
    if (-not $artistLookup.ContainsKey($key)) {
        $artistLookup[$key] = $b
    }
}

# Pre-compute genre classification per artist: artistName(lower) -> { all=$true, alt=$bool, rap=$bool, electronic=$bool, pop=$bool }
$artistGenreCache = @{}
foreach ($b in $bandsData) {
    $key = $b.name.ToLower().Trim()
    $genres = @()
    if ($b.genre -and $b.genre.ToLower() -ne 'недостигаат податоци') {
        $genres = @(($b.genre -split ',\s*') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
    }
    $matchesRap = $false; $matchesElectronic = $false; $matchesPop = $false; $matchesAlt = $true
    if ($genres.Count -eq 0) {
        $matchesAlt = $false
    } else {
        foreach ($g in $genres) {
            if ($rapGenresLower.Contains($g)) { $matchesRap = $true }
            if ($electronicGenresLower.Contains($g)) { $matchesElectronic = $true }
            if ($popGenresLower.Contains($g)) { $matchesPop = $true }
            if ($nonAltGenresLower.Contains($g)) { $matchesAlt = $false }
        }
    }
    $artistGenreCache[$key] = @{
        all = $true
        alt = $matchesAlt
        rap = $matchesRap
        electronic = $matchesElectronic
        pop = $matchesPop
    }
}

Write-Host "  > Built lookup cache for $($artistLookup.Count) artists" -ForegroundColor DarkGray

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

# Get artist info from bands data — O(1) hash lookup
function Get-ArtistInfo {
    param([string]$artistName)
    if (-not $artistName) { return $null }
    $normalised = $artistName.ToLower().Trim()
    $result = $artistLookup[$normalised]
    if ($result) { return $result }
    # Try first artist in collab
    $firstArtist = ($artistName -split ',')[0].Trim().ToLower()
    if ($firstArtist -ne $normalised) {
        return $artistLookup[$firstArtist]
    }
    return $null
}

# Check if artist matches genre filter — O(1) cache lookup
function Test-ArtistGenre {
    param([string]$artistName, [string]$genreFilter)
    if ($genreFilter -eq 'all') { return $true }
    $normalised = $artistName.ToLower().Trim()
    $cached = $artistGenreCache[$normalised]
    if (-not $cached) {
        # Try first artist in collab
        $firstArtist = ($artistName -split ',')[0].Trim().ToLower()
        $cached = $artistGenreCache[$firstArtist]
    }
    if (-not $cached) { return $false }
    return $cached[$genreFilter]
}

# Check if artist matches city filter — O(1) hash lookup
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
# Uses property-by-property clone instead of JSON serialization for ~100x speedup
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
            # Clone via property copy (avoids expensive JSON roundtrip)
            $props = @{}
            foreach ($p in $r.PSObject.Properties) {
                $props[$p.Name] = $p.Value
            }
            $clone = [PSCustomObject]$props
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
# Accepts optional $preDeduped to skip internal dedup when already done
function Build-ChartRanking {
    param(
        [array]$releasesArr,
        [string]$type = 'single',
        [string]$genre = 'all',
        [string]$city = 'all',
        [int]$count = 20,
        [array]$preDeduped = $null
    )
    
    $deduped = if ($preDeduped) { $preDeduped } else { Invoke-DeduplicateCollabs $releasesArr }
    
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

# Pre-deduplicate releases once for reuse across all chart computations
$mainReleasesDeduped = Invoke-DeduplicateCollabs $releases
$prevReleasesDeduped = Invoke-DeduplicateCollabs $previousWeekReleases

# Pre-filter releases by genre once (avoids re-filtering inside every Build-ChartRanking call)
$mainByGenre = @{}
$prevByGenre = @{}
foreach ($genre in $genreFilters) {
    if ($genre -eq 'all') {
        $mainByGenre[$genre] = $mainReleasesDeduped
        $prevByGenre[$genre] = $prevReleasesDeduped
    } else {
        $mainByGenre[$genre] = @($mainReleasesDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
        $prevByGenre[$genre] = @($prevReleasesDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
    }
}

# Pre-compute previous-week ranked maps once per genre/type (shared between standard and advanced)
$prevMapsUnlimited = @{}
foreach ($genre in $genreFilters) {
    foreach ($type in $typeFilters) {
        $key = "${genre}_${type}"
        $prevRanked = Build-ChartRanking -releasesArr $previousWeekReleases -type $type -genre 'all' -count 0 -preDeduped $prevByGenre[$genre]
        $prevMap = @{}
        for ($i = 0; $i -lt $prevRanked.Count; $i++) {
            $prevMap[$prevRanked[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($prevRanked[$i].popularity -as [int])
            }
        }
        $prevMapsUnlimited[$key] = $prevMap
    }
}

# Helper: enrich ranked items with position changes, returns ArrayList
function Enrich-ChartItems {
    param([array]$ranked, [hashtable]$prevMap, [bool]$includeGenreCity = $false)
    $enriched = [System.Collections.ArrayList]::new($ranked.Count)
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
        
        $item = [PSCustomObject]@{
            releaseId        = $r.releaseId
            bandName         = $r.bandName
            artistId         = $r.artistId
            releaseTitle     = $r.releaseTitle
            releaseType      = $r.releaseType
            releaseDate      = $r.releaseDate
            releaseUrl       = $r.releaseUrl
            thumbnail        = $r.thumbnail
            totalTracks      = $r.totalTracks
            popularity       = [int]($r.popularity -as [int])
            followers        = [int]($r.followers -as [int])
            spotifyUrl       = $r.spotifyUrl
            position         = $pos
            positionChange   = $posChange
            popularityChange = $popChange
            isNewEntry       = $isNew
            confirmed        = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            isCollab         = if ($r.isCollab) { $true } else { $false }
        }
        if ($includeGenreCity) {
            $item | Add-Member -NotePropertyName genre -NotePropertyValue $(if ($artistInfo) { $artistInfo.genre } else { $null })
            $item | Add-Member -NotePropertyName city -NotePropertyValue $(if ($artistInfo) { $artistInfo.city } else { $null })
        }
        [void]$enriched.Add($item)
    }
    return @($enriched)
}

# Build ranked charts for all genre combinations (standard = count 20, plus count 0 for advanced)
$charts = @{}
$advancedCharts = @{}
foreach ($genre in $genreFilters) {
    foreach ($type in $typeFilters) {
        $key = "${genre}_${type}"
        $prevMap = $prevMapsUnlimited[$key]
        
        # Standard (top 20) — build prev map with count=20 positions using pre-filtered data
        $prevRankedStd = Build-ChartRanking -releasesArr $previousWeekReleases -type $type -genre 'all' -count 20 -preDeduped $prevByGenre[$genre]
        $prevMapStd = @{}
        for ($i = 0; $i -lt $prevRankedStd.Count; $i++) {
            $prevMapStd[$prevRankedStd[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($prevRankedStd[$i].popularity -as [int])
            }
        }
        
        $ranked = Build-ChartRanking -releasesArr $releases -type $type -genre 'all' -count 20 -preDeduped $mainByGenre[$genre]
        $charts[$key] = @(Enrich-ChartItems -ranked $ranked -prevMap $prevMapStd)
        
        # Advanced (unlimited) — reuse the pre-computed prev map
        $advKey = "${genre}_${type}_advanced"
        $rankedAdv = Build-ChartRanking -releasesArr $releases -type $type -genre 'all' -count 0 -preDeduped $mainByGenre[$genre]
        $advancedCharts[$advKey] = @(Enrich-ChartItems -ranked $rankedAdv -prevMap $prevMap -includeGenreCity $true)
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

# Pre-deduplicate each history week once (avoids re-deduplicating 5 genres × N weeks)
$historyWeekDeduped = @{}
for ($w = 0; $w -lt $tooltipWeekCount; $w++) {
    $historyWeekDeduped[$w] = Invoke-DeduplicateCollabs $chartHistoryWeeks[$w].releases
}

foreach ($genre in $genreFilters) {
    $genreHistoryMap = @{}  # releaseId -> ArrayList of entries
    
    for ($w = 0; $w -lt $tooltipWeekCount; $w++) {
        $weekData = $chartHistoryWeeks[$w]
        $weekId = $weekData.weekId
        $weekDeduped = $historyWeekDeduped[$w]
        
        # Pre-filter by genre once for this week (used by both singles and albums ranking)
        $genreFiltered = if ($genre -eq 'all') { $weekDeduped } else {
            @($weekDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
        }
        
        # Rank singles and albums from pre-filtered list — skip genre filtering inside Build-ChartRanking
        # by passing genre='all' since we already filtered
        $rankedSingles = Build-ChartRanking -releasesArr $weekData.releases -type 'single' -genre 'all' -count 20 -preDeduped $genreFiltered
        $rankedAlbums = Build-ChartRanking -releasesArr $weekData.releases -type 'album' -genre 'all' -count 20 -preDeduped $genreFiltered
        
        $singlesPos = @{}
        for ($i = 0; $i -lt $rankedSingles.Count; $i++) {
            $singlesPos[$rankedSingles[$i].releaseId] = $i + 1
        }
        $albumsPos = @{}
        for ($i = 0; $i -lt $rankedAlbums.Count; $i++) {
            $albumsPos[$rankedAlbums[$i].releaseId] = $i + 1
        }
        
        # Use pre-filtered releases for genre
        foreach ($r in $genreFiltered) {
            $rid = $r.releaseId
            if (-not $genreHistoryMap.ContainsKey($rid)) {
                $genreHistoryMap[$rid] = [System.Collections.ArrayList]::new()
            }
            [void]$genreHistoryMap[$rid].Add(@{
                weekId = $weekId
                popularity = [int]($r.popularity -as [int])
                singlesPos = if ($singlesPos.ContainsKey($rid)) { $singlesPos[$rid] } else { $null }
                albumsPos = if ($albumsPos.ContainsKey($rid)) { $albumsPos[$rid] } else { $null }
            })
        }
    }
    
    # Sort each release's history oldest-first
    foreach ($rid in @($genreHistoryMap.Keys)) {
        $genreHistoryMap[$rid] = @($genreHistoryMap[$rid] | Sort-Object { $_.weekId })
    }
    
    $releaseHistoryByGenre[$genre] = $genreHistoryMap
}

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
            $artistPopularityGraphs[$artistKey] = [System.Collections.ArrayList]::new()
        }
        [void]$artistPopularityGraphs[$artistKey].Add(@{
            weekId = $weekId
            value = $artistWeekPop[$artistKey]
            hasNewRelease = $artistNewRelease[$artistKey]
        })
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

$deduped = $mainReleasesDeduped
$allTimeArtistsByGenre = @{}  # genre -> array of top 100 artists

foreach ($genre in $genreFilters) {
    $artistFollowerMap = @{}  # artistId -> { bandName, followers, spotifyUrl, thumbnail }
    # Use pre-filtered genre data
    $genreDeduped = $mainByGenre[$genre]
    foreach ($r in $genreDeduped) {
        $aid = $r.artistId
        if (-not $aid) { continue }
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

Write-Host "  > Ranked all-time artists for $($genreFilters.Count) genres" -ForegroundColor DarkGray

# ============================================================================
#  5. LATEST RELEASES (newest 20, deduped, per genre)
# ============================================================================

Write-Host "  > Building latest releases..." -ForegroundColor Yellow

$latestReleasesByGenre = @{}  # genre -> array of latest 20

foreach ($genre in $genreFilters) {
    # Reuse pre-filtered genre data
    $genreFiltered = $mainByGenre[$genre]
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

# Backward compat no longer needed — latestReleasesByGenre always has 'all' key

# ============================================================================
#  5b. TRIM RELEASE HISTORY TO DISPLAYED ITEMS ONLY
# ============================================================================
# Tooltips (releaseHistory) are only shown for standard chart items (top 20 singles/albums)
# and latest releases — NOT for advanced charts. Trim to avoid generating ~1300 KB of unused data.

Write-Host "  > Trimming release history to displayed chart items..." -ForegroundColor Yellow

$totalHistoryBefore = 0
$totalHistoryAfter = 0
foreach ($genre in $genreFilters) {
    $neededIds = [System.Collections.Generic.HashSet[string]]::new()
    # Standard chart releases (top 20 singles + top 20 albums)
    $sKey = "${genre}_single"
    $aKey = "${genre}_album"
    if ($charts.ContainsKey($sKey)) { foreach ($r in $charts[$sKey]) { [void]$neededIds.Add($r.releaseId) } }
    if ($charts.ContainsKey($aKey)) { foreach ($r in $charts[$aKey]) { [void]$neededIds.Add($r.releaseId) } }
    # Latest releases for this genre
    if ($latestReleasesByGenre.ContainsKey($genre)) { foreach ($r in $latestReleasesByGenre[$genre]) { [void]$neededIds.Add($r.releaseId) } }
    
    $fullMap = $releaseHistoryByGenre[$genre]
    $totalHistoryBefore += $fullMap.Count
    $trimmedMap = @{}
    foreach ($rid in @($fullMap.Keys)) {
        if ($neededIds.Contains($rid)) {
            $trimmedMap[$rid] = $fullMap[$rid]
        }
    }
    $releaseHistoryByGenre[$genre] = $trimmedMap
    $totalHistoryAfter += $trimmedMap.Count
}

Write-Host "  > Trimmed release history: $totalHistoryBefore -> $totalHistoryAfter entries across $($genreFilters.Count) genres" -ForegroundColor DarkGray

# ============================================================================
#  6. HOT SONGS (songs with positive popularity change vs last week)
# ============================================================================

Write-Host "  > Calculating hot songs..." -ForegroundColor Yellow

$currentRanked = Build-ChartRanking -releasesArr $releases -type 'single' -genre 'all' -count 0 -preDeduped $mainByGenre['all']
# Reuse the pre-computed previous-week map from section 1
$prevMapHot = $prevMapsUnlimited['all_single']

$hotSongs = [System.Collections.ArrayList]::new()
for ($i = 0; $i -lt $currentRanked.Count; $i++) {
    $r = $currentRanked[$i]
    if ($prevMapHot.ContainsKey($r.releaseId)) {
        $prev = $prevMapHot[$r.releaseId]
        $popChange = ([int]($r.popularity -as [int])) - $prev.popularity
        if ($popChange -gt 0) {
            $artistInfo = Get-ArtistInfo $r.bandName
            [void]$hotSongs.Add([PSCustomObject]@{
                releaseId    = $r.releaseId
                bandName     = $r.bandName
                releaseTitle = $r.releaseTitle
                releaseUrl   = $r.releaseUrl
                thumbnail    = $r.thumbnail
                popularity   = [int]($r.popularity -as [int])
                popularityChange = $popChange
                confirmed    = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            })
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
        $artistReleaseGroups[$name] = [System.Collections.ArrayList]::new()
    }
    [void]$artistReleaseGroups[$name].Add($r)
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

# Build and pre-compile artist name patterns (skip names <= 2 chars)
$artistPatterns = @()
foreach ($b in $bandsData) {
    if ($b.name -and $b.name.Length -gt 2) {
        $pattern = $b.name
        $term = if ($pattern.Length -gt 0 -and -not ($pattern[0] -match '^\d')) {
            $pattern[0].ToString().ToUpper() + $pattern.Substring(1)
        } else { $pattern }
        $escaped = [regex]::Escape($term)
        $regexStr = "(?:^|$boundaryChars)$escaped(?:$|$boundaryChars)"
        $artistPatterns += @{
            name = $b.name
            compiledRegex = [regex]::new($regexStr, [System.Text.RegularExpressions.RegexOptions]::Compiled)
        }
    }
}

# Pre-lowercase blacklist words once
$blacklistWordsLower = @($blacklistWords | ForEach-Object { $_.ToLower() })

function Test-ArticleBlacklist {
    param([string]$title, [string]$description)
    $text = "$title $description".ToLower()
    foreach ($word in $blacklistWordsLower) {
        if ($text.Contains($word)) {
            return $true
        }
    }
    return $false
}

function Get-MatchedArtists {
    param([string]$title, [string]$description)
    $haystack = "$title $description"
    $matched = [System.Collections.ArrayList]@()
    
    foreach ($artist in $artistPatterns) {
        if ($artist.compiledRegex.IsMatch($haystack)) {
            if (-not $matched.Contains($artist.name)) {
                [void]$matched.Add($artist.name)
            }
        }
    }
    return ,$matched
}

# Process all articles: filter by blacklist, then match artists
$matchedArticles = [System.Collections.ArrayList]::new()

foreach ($article in $allArticles) {
    # Apply blacklist
    if (Test-ArticleBlacklist $article.title $article.description) {
        continue
    }
    
    $artists = Get-MatchedArtists $article.title $article.description
    
    if ($artists.Count -gt 0) {
        [void]$matchedArticles.Add([PSCustomObject]@{
            title         = $article.title
            link          = $article.link
            description   = $article.description
            date          = $article.date
            source        = $article.source
            siteUrl       = $article.siteUrl
            iconUrl       = $article.iconUrl
            thumbnail     = $article.thumbnail
            matchedArtists = $artists
        })
    }
}

# Sort by date descending
$matchedArticles = @($matchedArticles | Sort-Object { $_.date } -Descending)

Write-Host "  > Filtered articles: $($matchedArticles.Count) matched artists" -ForegroundColor DarkGray

# ============================================================================
#  10. RELEASE RADAR (latest 5 releases)
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
#  12. BUILD RELEASE SPARKLINES PER ARTIST (for artist.html)
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
            $releaseSparklines[$rid] = [System.Collections.ArrayList]::new()
        }
        [void]$releaseSparklines[$rid].Add(@{
            weekId = $weekId
            popularity = [int]($r.popularity -as [int])
        })
    }
}

# Sort oldest-first
foreach ($rid in @($releaseSparklines.Keys)) {
    $releaseSparklines[$rid] = @($releaseSparklines[$rid] | Sort-Object { $_.weekId })
}

# Remove sparklines with only 1 data point (artist.html requires >= 2 to render SVG sparkline)
$sparkBefore = $releaseSparklines.Count
$toRemove = [System.Collections.ArrayList]::new()
foreach ($rid in $releaseSparklines.Keys) {
    if ($releaseSparklines[$rid].Count -lt 2) { [void]$toRemove.Add($rid) }
}
foreach ($rid in $toRemove) { $releaseSparklines.Remove($rid) }

Write-Host "  > Built sparklines for $($releaseSparklines.Count) releases (removed $($sparkBefore - $releaseSparklines.Count) with <2 weeks)" -ForegroundColor DarkGray

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

# Strip fields from chartData.releases that are unused by client code
# (topTrackName, topTrackId, topTrackUrl are only in pre-computed charts, not accessed from raw data)
$strippedReleases = @($releases | ForEach-Object {
    $props = [ordered]@{}
    foreach ($p in $_.PSObject.Properties) {
        if ($p.Name -notin @('topTrackName', 'topTrackId', 'topTrackUrl')) {
            $props[$p.Name] = $p.Value
        }
    }
    [PSCustomObject]$props
})

$siteMaster = [PSCustomObject]@{
    generatedAt = $chartJson.generatedAt
    
    # Chart data (stripped of unused fields)
    chartData = [PSCustomObject]@{
        generatedAt   = $chartJson.generatedAt
        totalReleases = $chartJson.totalReleases
        totalArtists  = $chartJson.totalArtists
        releases      = $strippedReleases
    }
    
    # Pre-ranked charts: keys like "all_single", "alt_album", etc.
    charts = $chartsOutput
    
    # Advanced (unlimited) charts
    advancedCharts = $advancedChartsOutput
    
    # Per-release chart history (for tooltips), keyed by genre
    releaseHistory = $historyMapOutput
    
    # All-time top artists sorted by followers, keyed by genre
    # (allTimeArtistsByGenre['all'] serves as the fallback — no separate allTimeArtists needed)
    allTimeArtistsByGenre = $allTimeArtistsByGenreOutput
    
    # Latest 20 releases sorted by date, keyed by genre
    # (latestReleasesByGenre['all'] serves as the fallback — no separate latestReleases needed)
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
    }
    
    # Header collage thumbnails (top 20 singles thumbnails)
    headerThumbs = $headerThumbs
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
