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
$releasesPath = Join-Path $projectRoot "releases.json"
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

# Load releases.json (release catalog)
$releasesJson = Get-Content $releasesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseCatalog = $releasesJson.releases

# Load chart-data.json (weekly views/popularity)
$chartJson = Get-Content $chartPath -Raw -Encoding UTF8 | ConvertFrom-Json
$chartReleases = $chartJson.releases

# Merge releases.json + chart-data.json into unified releases array
$chartMap = @{}
foreach ($cr in $chartReleases) {
    $chartMap[$cr.releaseId] = $cr
}
# Sync chart-data.json youtubeViews from releases.json (picks up newly verified links).
# Uses releases.json's youtubeViews field which was computed by generate-chart-data-youtube.js
# with correct global video deduplication.
$ytViewsSynced = 0
$relCatalogMap = @{}
foreach ($r in $releaseCatalog) {
    $relCatalogMap[$r.releaseId] = $r
}
foreach ($cr in $chartReleases) {
    $r = $relCatalogMap[$cr.releaseId]
    [long]$correctViews = if ($r) { [long]($r.youtubeViews -as [long]) } else { 0 }
    $storedViews = [long]($cr.youtubeViews -as [long])
    if ($correctViews -ne $storedViews) {
        $cr.youtubeViews = $correctViews
        $ytViewsSynced++
    }
}
if ($ytViewsSynced -gt 0) {
    Write-Host "  > Synced youtubeViews for $ytViewsSynced release(s) from verified youtubeTracks" -ForegroundColor Cyan
    # Save updated chart-data.json via Node.js (preserves JSON formatting)
    $syncScriptPath = Join-Path (Join-Path $projectRoot "scripts") "sync-chart-views.js"
    node $syncScriptPath
    # Reload chart-data.json to pick up the saved changes
    $chartJson = Get-Content $chartPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $chartReleases = $chartJson.releases
    $chartMap = @{}
    foreach ($cr in $chartReleases) {
        $chartMap[$cr.releaseId] = $cr
    }
}
$releases = @($releaseCatalog | ForEach-Object {
    $r = $_
    $cr = $chartMap[$r.releaseId]
    if (-not $cr) { return }  # Skip releases not in chart-data.json
    $merged = [ordered]@{}
    foreach ($p in $r.PSObject.Properties) {
        $merged[$p.Name] = $p.Value
    }
    $merged['popularity'] = $cr.popularity
    $merged['followers'] = $cr.followers
    $merged['youtubeViews'] = $cr.youtubeViews
    $merged['youtubeTrackCount'] = $cr.youtubeTrackCount
    $merged['spotifyPopularity'] = $cr.spotifyPopularity
    [PSCustomObject]$merged
})

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
#  GENRE CONFIGURATION (loaded from chart-genres.json)
# ============================================================================

$chartGenresPath = Join-Path $PSScriptRoot "..\chart-genres.json"
$chartGenresData = Get-Content $chartGenresPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rapGenres = @($chartGenresData.rap)
$electronicGenres = @($chartGenresData.electronic)
$popGenres = @($chartGenresData.pop)
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
            if (($r.youtubeViews -as [int]) -gt ($existing.youtubeViews -as [int])) { $existing.youtubeViews = $r.youtubeViews }
            if (($r.viewsDelta -as [int]) -gt ($existing.viewsDelta -as [int])) { $existing | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $r.viewsDelta -Force }
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

# Chart sort comparator (matching common.js chartSort: null-delta last, viewsDelta desc, youtubeViews desc, name asc)
function Sort-ChartRanking {
    param([array]$items)
    return $items | Sort-Object @(
        @{ Expression = { if ($null -eq $_.viewsDelta) { 1 } else { 0 } } },
        @{ Expression = { -([int]($_.viewsDelta -as [int])) } },
        @{ Expression = { -([int]($_.youtubeViews -as [int])) } },
        @{ Expression = { $_.bandName } }
    )
}

# Keep at most 2 releases per artist, preferring the most popular ones.
function Limit-PerArtist {
    param([array]$items)
    $byArtist = @{}
    foreach ($r in $items) {
        $key = $r.bandName.ToLower().Trim()
        if (-not $byArtist.ContainsKey($key)) { $byArtist[$key] = @() }
        $byArtist[$key] += $r
    }
    $keepIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($key in $byArtist.Keys) {
        $top2 = @(Sort-ChartRanking $byArtist[$key]) | Select-Object -First 2
        foreach ($r in $top2) { [void]$keepIds.Add($r.releaseId) }
    }
    return @($items | Where-Object { $keepIds.Contains($_.releaseId) })
}

# Expand releases to individual songs for the advanced singles chart.
# Single-track releases keep their original releaseId; multi-track get composite IDs.
function Expand-ReleasesToSongs {
    param([array]$deduped)
    $songs = [System.Collections.ArrayList]::new()
    foreach ($r in $deduped) {
        $tracks = $r.youtubeTracks
        if (-not $tracks -or $tracks.Count -eq 0) {
            $spotifyNames = $r.trackNames
            if ($spotifyNames -and $spotifyNames.Count -gt 1) {
                for ($ti = 0; $ti -lt $spotifyNames.Count; $ti++) {
                    $tName = $spotifyNames[$ti]
                    if (-not $tName) { continue }
                    $songId = "$($r.releaseId):t$ti"
                    $song = [PSCustomObject]@{
                        releaseId    = $songId
                        bandName     = $r.bandName
                        artistId     = $r.artistId
                        releaseTitle = $tName
                        releaseType  = $r.releaseType
                        releaseDate  = $r.releaseDate
                        releaseUrl   = $r.releaseUrl
                        thumbnail    = $r.thumbnail
                        totalTracks  = $r.totalTracks
                        popularity   = [int]($r.popularity -as [int])
                        followers    = [int]($r.followers -as [int])
                        youtubeViews = 0
                        spotifyUrl   = $r.spotifyUrl
                    }
                    $song | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $null -Force
                    if ($r.isCollab) { $song | Add-Member -NotePropertyName isCollab -NotePropertyValue $true -Force }
                    [void]$songs.Add($song)
                }
            } else {
                [void]$songs.Add($r)
            }
            continue
        }

        $totalViews = [int]($r.youtubeViews -as [int])
        $releaseDelta = $r.viewsDelta

        $tracksByName = [ordered]@{}
        foreach ($track in $tracks) {
            $tName = $track.name
            if (-not $tracksByName.Contains($tName)) {
                $tracksByName[$tName] = @{ views = 0; index = $tracksByName.Count }
            }
            $tracksByName[$tName].views += [int]($track.views -as [int])
        }

        foreach ($tName in $tracksByName.Keys) {
            $tData = $tracksByName[$tName]
            $trackViews = $tData.views
            $ti = $tData.index

            $trackDelta = $null
            if ($null -ne $releaseDelta -and $totalViews -gt 0) {
                $trackDelta = [int]([math]::Round([double]$releaseDelta * $trackViews / $totalViews))
            }

            $songId = if ($tracksByName.Count -eq 1) { $r.releaseId } else { "$($r.releaseId):t$ti" }

            $song = [PSCustomObject]@{
                releaseId    = $songId
                bandName     = $r.bandName
                artistId     = $r.artistId
                releaseTitle = $tName
                releaseType  = $r.releaseType
                releaseDate  = $r.releaseDate
                releaseUrl   = $r.releaseUrl
                thumbnail    = $r.thumbnail
                totalTracks  = $r.totalTracks
                popularity   = [int]($r.popularity -as [int])
                followers    = [int]($r.followers -as [int])
                youtubeViews = $trackViews
                spotifyUrl   = $r.spotifyUrl
            }
            $song | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $trackDelta -Force
            if ($r.isCollab) { $song | Add-Member -NotePropertyName isCollab -NotePropertyValue $true -Force }
            [void]$songs.Add($song)
        }

        # Spotify trackNames not covered by YouTube tracks
        $spotifyNames = $r.trackNames
        if ($spotifyNames -and $spotifyNames.Count -gt 0) {
            $ytNamesLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            foreach ($tn in $tracksByName.Keys) { [void]$ytNamesLower.Add($tn.ToLower().Trim()) }
            $extraIdx = $tracksByName.Count
            foreach ($sn in $spotifyNames) {
                if (-not $sn) { continue }
                if ($ytNamesLower.Contains($sn.ToLower().Trim())) { continue }
                $songId = "$($r.releaseId):t$extraIdx"
                $song = [PSCustomObject]@{
                    releaseId    = $songId
                    bandName     = $r.bandName
                    artistId     = $r.artistId
                    releaseTitle = $sn
                    releaseType  = $r.releaseType
                    releaseDate  = $r.releaseDate
                    releaseUrl   = $r.releaseUrl
                    thumbnail    = $r.thumbnail
                    totalTracks  = $r.totalTracks
                    popularity   = [int]($r.popularity -as [int])
                    followers    = [int]($r.followers -as [int])
                    youtubeViews = 0
                    spotifyUrl   = $r.spotifyUrl
                }
                $song | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $null -Force
                if ($r.isCollab) { $song | Add-Member -NotePropertyName isCollab -NotePropertyValue $true -Force }
                [void]$songs.Add($song)
                $extraIdx++
            }
        }
    }
    return @($songs)
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
    
    # Cutoff — 4 weeks for singles, 8 weeks for albums
    $cutoffWeeks = if ($type -eq 'album') { 8 } else { 4 }
    $cutoffDate = (Get-Date).AddDays(-($cutoffWeeks * 7))
    $cutoff = $cutoffDate.ToString("yyyy-MM-dd")
    
    # 1. Start with recent releases, enforce 2-per-artist (keep most popular)
    $recent = @($filtered | Where-Object { ($_.effectiveReleaseDate, $_.releaseDate -ne $null)[0] -ge $cutoff })
    $pool = @(Limit-PerArtist $recent)
    
    # 2. Backfill with most recent older releases, one at a time,
    #    re-enforcing 2-per-artist after each addition
    $older = @($filtered | Where-Object { ($_.effectiveReleaseDate, $_.releaseDate -ne $null)[0] -lt $cutoff } | Sort-Object { ($_.effectiveReleaseDate, $_.releaseDate -ne $null)[0] } -Descending)
    
    $oi = 0
    while ($pool.Count -lt $count -and $oi -lt $older.Count) {
        $pool = @($pool) + @($older[$oi])
        $oi++
        $pool = @(Limit-PerArtist $pool)
    }
    
    # Final sort by popularity for display order
    return @(Sort-ChartRanking $pool | Select-Object -First $count)
}

# ============================================================================
#  LOAD CHART HISTORY
# ============================================================================

Write-Host "  > Loading chart history..." -ForegroundColor Yellow

# Build release catalog lookup map for hydrating compact chart-history entries
$catalogMap = @{}
foreach ($r in $releaseCatalog) {
    $catalogMap[$r.releaseId] = $r
}

$chartHistoryWeeks = @()  # Array of { weekId, releases }
$historyFiles = Get-ChildItem -Path $chartHistoryDir -Filter "chart-*.json" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

foreach ($file in $historyFiles) {
    $weekId = $file.BaseName -replace '^chart-', ''
    $data = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    # Chart-history files use compact format (releaseId + metrics only).
    # Hydrate each entry with metadata from releases.json catalog.
    $hydrated = @($data.releases | ForEach-Object {
        $compact = $_
        $catalog = $catalogMap[$compact.releaseId]
        if (-not $catalog) { return }  # Skip releases no longer in catalog
        $merged = [ordered]@{}
        foreach ($p in $catalog.PSObject.Properties) {
            $merged[$p.Name] = $p.Value
        }
        $merged['popularity'] = $compact.popularity
        $merged['followers'] = $compact.followers
        $merged['youtubeViews'] = if ($null -ne $compact.youtubeViews) { $compact.youtubeViews } else { 0 }
        $merged['youtubeTrackCount'] = if ($null -ne $compact.youtubeTrackCount) { $compact.youtubeTrackCount } else { 0 }
        $merged['spotifyPopularity'] = if ($null -ne $compact.spotifyPopularity) { $compact.spotifyPopularity } else { 0 }
        [PSCustomObject]$merged
    })
    $chartHistoryWeeks += @{
        weekId = $weekId
        releases = $hydrated
    }
}

Write-Host "  > Loaded $($chartHistoryWeeks.Count) chart history weeks (hydrated from catalog)" -ForegroundColor DarkGray

# Get previous week's data for viewsDelta calculation (current views - prev views)
# Chart-history is only updated on Mondays by the YouTube script, so index 0
# (the most recent snapshot) is the proper baseline for weekly delta calculation.
# On Monday, chart-history index 0 was just written with the same views as chart-data.json,
# so deltas would all be 0. Use index 1 (the week before) to get meaningful deltas.
$previousWeekReleases = @()
$viewsDeltaPrevIndex = 0
if ([datetime]::Now.DayOfWeek -eq [System.DayOfWeek]::Monday -and $chartHistoryWeeks.Count -gt 1) {
    $viewsDeltaPrevIndex = 1
    Write-Host "  > Monday detected — using previous week (index 1) for viewsDelta baseline" -ForegroundColor Cyan
}
if ($chartHistoryWeeks.Count -gt $viewsDeltaPrevIndex) {
    $previousWeekReleases = $chartHistoryWeeks[$viewsDeltaPrevIndex].releases
    Write-Host "  > ViewsDelta baseline: $($chartHistoryWeeks[$viewsDeltaPrevIndex].weekId)" -ForegroundColor DarkGray
}

# For chevron indicators: compare the two most recent chart-history snapshots
$chevronCurrentReleases = @()
$chevronPreviousReleases = @()
if ($chartHistoryWeeks.Count -ge 1) {
    $chevronCurrentReleases = $chartHistoryWeeks[0].releases
    Write-Host "  > Chevron current week: $($chartHistoryWeeks[0].weekId)" -ForegroundColor DarkGray
}
if ($chartHistoryWeeks.Count -ge 2) {
    $chevronPreviousReleases = $chartHistoryWeeks[1].releases
    Write-Host "  > Chevron previous week: $($chartHistoryWeeks[1].weekId)" -ForegroundColor DarkGray
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

# Pre-compute viewsDelta (current - previous week youtubeViews) and attach to each release
$prevViewsMap = @{}
$prevTrackCountMap = @{}
foreach ($pr in $prevReleasesDeduped) {
    $prevViewsMap[$pr.releaseId] = [int]($pr.youtubeViews -as [int])
    if ($pr.youtubeTrackCount) { $prevTrackCountMap[$pr.releaseId] = [int]($pr.youtubeTrackCount -as [int]) }
}

# Determine the Monday of the previous chart-history week
$prevChartMonday = $null
if ($chartHistoryWeeks.Count -gt $viewsDeltaPrevIndex) {
    $prevWeekId = $chartHistoryWeeks[$viewsDeltaPrevIndex].weekId  # e.g. "2026-W11"
    if ($prevWeekId -match '^(\d{4})-W(\d{2})$') {
        $isoYear = [int]$Matches[1]
        $isoWeek = [int]$Matches[2]
        # ISO week 1 contains Jan 4; Monday of week 1 = Jan 4 minus its weekday offset
        $jan4 = [datetime]::new($isoYear, 1, 4)
        $dow = [int]$jan4.DayOfWeek; if ($dow -eq 0) { $dow = 7 }  # Sunday=7
        $week1Monday = $jan4.AddDays(1 - $dow)
        $prevChartMonday = $week1Monday.AddDays(7 * ($isoWeek - 1))
        Write-Host "  > Previous chart Monday: $($prevChartMonday.ToString('yyyy-MM-dd'))" -ForegroundColor DarkGray
    }
}

function Get-ViewsDelta($r, $prevViewsMap, $prevChartMonday) {
    $curViews = [int]($r.youtubeViews -as [int])
    if ($curViews -le 0) { return $null }

    # Determine release date
    $relDate = $null
    $effectiveDateStr = if ($r.effectiveReleaseDate) { $r.effectiveReleaseDate } else { $r.releaseDate }
    if ($effectiveDateStr) { try { $relDate = [datetime]::Parse($effectiveDateStr) } catch {} }

    # Released AFTER previous chart Monday → all current views are the delta
    if ($relDate -and $prevChartMonday -and $relDate -ge $prevChartMonday) {
        return $curViews
    }

    # Released BEFORE previous chart Monday → delta = current - previous
    if ($prevViewsMap.ContainsKey($r.releaseId)) {
        $prevViews = $prevViewsMap[$r.releaseId]
        if ($prevViews -le 0) { return $null }   # no baseline data → skip
        return ($curViews - $prevViews)
    }

    return $null
}

foreach ($r in $mainReleasesDeduped) {
    $delta = Get-ViewsDelta $r $prevViewsMap $prevChartMonday
    $r | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $delta -Force
}
# Also attach viewsDelta to original $releases so it's included in chartData output
foreach ($r in $releases) {
    $delta = Get-ViewsDelta $r $prevViewsMap $prevChartMonday
    $r | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $delta -Force
}

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

# Pre-compute previous-week ranked maps for unlimited charts (only 'all' genre needed;
# genre subsets are reconstructed client-side from the all-chart data)
# Chevron maps: compare the two most recent chart-history snapshots for stable week-over-week indicators
$chevronPrevDeduped = Invoke-DeduplicateCollabs $chevronPreviousReleases
$chevronCurDeduped = Invoke-DeduplicateCollabs $chevronCurrentReleases
$chevronPrevByGenre = @{}
$chevronCurByGenre = @{}
foreach ($genre in $genreFilters) {
    if ($genre -eq 'all') {
        $chevronPrevByGenre[$genre] = $chevronPrevDeduped
        $chevronCurByGenre[$genre] = $chevronCurDeduped
    } else {
        $chevronPrevByGenre[$genre] = @($chevronPrevDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
        $chevronCurByGenre[$genre] = @($chevronCurDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
    }
}

$prevMapsUnlimited = @{}
$curSnapshotMapsUnlimited = @{}
foreach ($type in $typeFilters) {
    $key = "all_${type}"
    # Build map from chevronPrevious (W11) — what position each release had in W11
    $prevRanked = Build-ChartRanking -releasesArr $chevronPreviousReleases -type $type -genre 'all' -count 0 -preDeduped $chevronPrevByGenre['all']
    $prevMap = @{}
    for ($i = 0; $i -lt $prevRanked.Count; $i++) {
        $prevMap[$prevRanked[$i].releaseId] = @{
            position = $i + 1
            popularity = [int]($prevRanked[$i].popularity -as [int])
            youtubeViews = [int]($prevRanked[$i].youtubeViews -as [int])
        }
    }
    $prevMapsUnlimited[$key] = $prevMap

    # Build map from chevronCurrent (W12) — what position each release had in W12
    $curRanked = Build-ChartRanking -releasesArr $chevronCurrentReleases -type $type -genre 'all' -count 0 -preDeduped $chevronCurByGenre['all']
    $curMap = @{}
    for ($i = 0; $i -lt $curRanked.Count; $i++) {
        $curMap[$curRanked[$i].releaseId] = @{
            position = $i + 1
            popularity = [int]($curRanked[$i].popularity -as [int])
            youtubeViews = [int]($curRanked[$i].youtubeViews -as [int])
        }
    }
    $curSnapshotMapsUnlimited[$key] = $curMap
}

# Build song-expanded prev/cur maps for the advanced singles chart.
# These use the same song expansion logic so composite IDs (releaseId:tN) match.
$prevSongsExpanded = @(Sort-ChartRanking (Expand-ReleasesToSongs $chevronPrevByGenre['all']))
$prevMapSongsUnlimited = @{}
for ($i = 0; $i -lt $prevSongsExpanded.Count; $i++) {
    $prevMapSongsUnlimited[$prevSongsExpanded[$i].releaseId] = @{
        position = $i + 1
        popularity = [int]($prevSongsExpanded[$i].popularity -as [int])
        youtubeViews = [int]($prevSongsExpanded[$i].youtubeViews -as [int])
    }
}
$curSongsExpanded = @(Sort-ChartRanking (Expand-ReleasesToSongs $chevronCurByGenre['all']))
$curMapSongsUnlimited = @{}
for ($i = 0; $i -lt $curSongsExpanded.Count; $i++) {
    $curMapSongsUnlimited[$curSongsExpanded[$i].releaseId] = @{
        position = $i + 1
        popularity = [int]($curSongsExpanded[$i].popularity -as [int])
        youtubeViews = [int]($curSongsExpanded[$i].youtubeViews -as [int])
    }
}

# Helper: enrich ranked items with position changes, returns ArrayList
# $prevMap: previous chart-history snapshot for chevron comparison (W11)
# $curSnapshotMap: current chart-history snapshot for chevron comparison (W12)
# When both are provided, chevrons compare W12 position vs W11 position (stable week-over-week)
function Enrich-ChartItems {
    param([array]$ranked, [hashtable]$prevMap, [hashtable]$curSnapshotMap = @{}, [bool]$includeGenreCity = $false)
    $enriched = [System.Collections.ArrayList]::new($ranked.Count)
    for ($i = 0; $i -lt $ranked.Count; $i++) {
        $r = $ranked[$i]
        $pos = $i + 1
        $posChange = $null
        $popChange = $null
        $isNew = $true
        
        # Use last week's snapshot (curSnap = W12) to compare against current position
        $curSnap = if ($curSnapshotMap.Count -gt 0) { $curSnapshotMap[$r.releaseId] } else { $null }
        
        if ($curSnap) {
            # Song was in last week's chart — compare last week position to current position
            $posChange = $curSnap.position - $pos  # positive = moved up
            $popChange = ([int]($r.youtubeViews -as [int])) - $curSnap.youtubeViews
            $isNew = $false
        } elseif ($prevMap.Count -gt 0 -and $prevMap.ContainsKey($r.releaseId)) {
            # Not in last week but was in the week before — still compare to current
            $prev = $prevMap[$r.releaseId]
            $posChange = $prev.position - $pos
            $popChange = ([int]($r.youtubeViews -as [int])) - $prev.youtubeViews
            $isNew = $false
        }
        # Otherwise: not in any previous week — new entry ($isNew = $true)
        
        $artistInfo = Get-ArtistInfo $r.bandName
        
        $item = [PSCustomObject]@{
            releaseId        = $r.releaseId
            bandName         = $r.bandName
            artistId         = $r.artistId
            releaseTitle     = $r.releaseTitle
            releaseType      = $r.releaseType
            releaseDate      = $r.releaseDate
            effectiveReleaseDate = $r.effectiveReleaseDate
            releaseUrl       = $r.releaseUrl
            thumbnail        = $r.thumbnail
            totalTracks      = $r.totalTracks
            popularity       = [int]($r.popularity -as [int])
            followers        = [int]($r.followers -as [int])
            youtubeViews     = [int]($r.youtubeViews -as [int])
            spotifyUrl       = $r.spotifyUrl
            position         = $pos
            positionChange   = $posChange
            popularityChange = $popChange
            viewsDelta       = $r.viewsDelta
            isNewEntry       = $isNew
            confirmed        = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            isCollab         = if ($r.isCollab) { $true } else { $false }
        }
        if ($includeGenreCity) {
            $item | Add-Member -NotePropertyName genre -NotePropertyValue $(if ($artistInfo) { $artistInfo.genre } else { $null })
            $item | Add-Member -NotePropertyName city -NotePropertyValue $(if ($artistInfo) { $artistInfo.city } else { $null })
            # Genre category code for client-side filtering (a=alt, r=rap, e=electronic, p=pop)
            $artistKey = $r.bandName.ToLower().Trim()
            $gCache = $artistGenreCache[$artistKey]
            if (-not $gCache) { $gCache = $artistGenreCache[($r.bandName -split ',')[0].Trim().ToLower()] }
            $gcCode = ''
            if ($gCache) {
                if ($gCache.alt) { $gcCode += 'a' }
                if ($gCache.rap) { $gcCode += 'r' }
                if ($gCache.electronic) { $gcCode += 'e' }
                if ($gCache.pop) { $gcCode += 'p' }
            }
            $item | Add-Member -NotePropertyName _gc -NotePropertyValue $gcCode -Force
        }
        [void]$enriched.Add($item)
    }
    return @($enriched)
}

# Build ranked charts for all genre combinations (standard = count 20)
# Advanced (unlimited) charts only for 'all' genre — genre subsets reconstructed client-side
$charts = @{}
$advancedCharts = @{}
foreach ($genre in $genreFilters) {
    foreach ($type in $typeFilters) {
        $key = "${genre}_${type}"
        
        # Standard (top 20) — build chevron maps from chart-history snapshots
        $prevRankedStd = Build-ChartRanking -releasesArr $chevronPreviousReleases -type $type -genre 'all' -count 20 -preDeduped $chevronPrevByGenre[$genre]
        $prevMapStd = @{}
        for ($i = 0; $i -lt $prevRankedStd.Count; $i++) {
            $prevMapStd[$prevRankedStd[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($prevRankedStd[$i].popularity -as [int])
                youtubeViews = [int]($prevRankedStd[$i].youtubeViews -as [int])
            }
        }
        $curRankedStd = Build-ChartRanking -releasesArr $chevronCurrentReleases -type $type -genre 'all' -count 20 -preDeduped $chevronCurByGenre[$genre]
        $curMapStd = @{}
        for ($i = 0; $i -lt $curRankedStd.Count; $i++) {
            $curMapStd[$curRankedStd[$i].releaseId] = @{
                position = $i + 1
                popularity = [int]($curRankedStd[$i].popularity -as [int])
                youtubeViews = [int]($curRankedStd[$i].youtubeViews -as [int])
            }
        }
        
        $ranked = Build-ChartRanking -releasesArr $releases -type $type -genre 'all' -count 20 -preDeduped $mainByGenre[$genre]
        $charts[$key] = @(Enrich-ChartItems -ranked $ranked -prevMap $prevMapStd -curSnapshotMap $curMapStd)
        
        # Advanced (unlimited) — only for 'all' genre; genre subsets reconstructed client-side via _gc field
        if ($genre -eq 'all') {
        $prevMap = $prevMapsUnlimited["all_${type}"]
        $curSnapshotMap = $curSnapshotMapsUnlimited["all_${type}"]
        $advKey = "all_${type}_advanced"
        
        if ($type -eq 'single') {
            # Songs expansion: include individual tracks from ALL release types (singles + albums)
            $songs = Expand-ReleasesToSongs $mainByGenre['all']
            $sortedSongs = @(Sort-ChartRanking $songs)
            # Use song-expanded prev/cur maps so composite IDs match and positions are comparable
            $advancedCharts[$advKey] = @(Enrich-ChartItems -ranked $sortedSongs -prevMap $prevMapSongsUnlimited -curSnapshotMap $curMapSongsUnlimited -includeGenreCity $true)
        } else {
            # Albums: unchanged — reuse the pre-computed prev map
            $rankedAdv = Build-ChartRanking -releasesArr $releases -type $type -genre 'all' -count 0 -preDeduped $mainByGenre['all']
            $advancedCharts[$advKey] = @(Enrich-ChartItems -ranked $rankedAdv -prevMap $prevMap -curSnapshotMap $curSnapshotMap -includeGenreCity $true)
        }
        }  # end if ($genre -eq 'all')
    }
}

Write-Host "  > Built charts for $($charts.Keys.Count) genre/type combos + $($advancedCharts.Keys.Count) advanced (all-genre only; genre subsets via _gc)" -ForegroundColor DarkGray

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
            [void]$genreHistoryMap[$rid].Add([ordered]@{
                weekId = $weekId
                popularity = [int]($r.popularity -as [int])
                youtubeViews = [int]($r.youtubeViews -as [int])
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
        # Split collab artist names so each gets credit for the views
        $artistKeys = @($r.bandName.ToLower().Trim() -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        foreach ($key in $artistKeys) {
            if (-not $artistWeekPop.ContainsKey($key)) {
                $artistWeekPop[$key] = 0
                $artistNewRelease[$key] = $false
            }
            $artistWeekPop[$key] += [int]($r.youtubeViews -as [int])
            
            # Check if release date falls within this week (use effectiveReleaseDate for singles/songs)
            $effDate = if ($r.effectiveReleaseDate) { $r.effectiveReleaseDate } else { $r.releaseDate }
            if ($effDate -ge $weekMondayStr -and $effDate -le $weekSundayStr) {
                $artistNewRelease[$key] = $true
            }
        }
    }
    
    foreach ($artistKey in $artistWeekPop.Keys) {
        if (-not $artistPopularityGraphs.ContainsKey($artistKey)) {
            $artistPopularityGraphs[$artistKey] = [System.Collections.ArrayList]::new()
        }
        [void]$artistPopularityGraphs[$artistKey].Add([ordered]@{
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
#  3b. ARTIST CUMULATIVE RANKING (by sum of viewsDeltas across all releases)
# ============================================================================

Write-Host "  > Building artist cumulative ranking..." -ForegroundColor Yellow

# Build per-artist cumulative delta from mainReleasesDeduped (which has viewsDelta attached)
$artistDeltaMap = @{}  # artistKey -> total viewsDelta
foreach ($r in $mainReleasesDeduped) {
    foreach ($name in @($r.bandName.ToLower().Trim() -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        if (-not $artistDeltaMap.ContainsKey($name)) { $artistDeltaMap[$name] = 0 }
        $artistDeltaMap[$name] += [int]($r.viewsDelta -as [int])
    }
}

$artistCumulativeRanking = [System.Collections.ArrayList]::new()
$maxCumulativePopularity = 0

# Deduplicate by resolved bandName to avoid duplicates from collabs
$cumulativeByName = [ordered]@{}  # resolvedName -> entry

foreach ($artistKey in $artistDeltaMap.Keys) {
    $cumulativePop = $artistDeltaMap[$artistKey]
    if ($cumulativePop -le 0) { continue }

    # Find a representative release for thumbnail and artistId
    $artistReleases = @($mainReleasesDeduped | Where-Object { @($_.bandName.ToLower().Trim() -split ',' | ForEach-Object { $_.Trim() }) -contains $artistKey })
    $topRelease = $artistReleases | Sort-Object { [int]($_.viewsDelta -as [int]) } -Descending | Select-Object -First 1

    if ($topRelease) {
        $bandInfo = Get-ArtistInfo $artistKey
        $resolvedName = if ($bandInfo) { $bandInfo.name } else { $topRelease.bandName }
        $resolvedKey = $resolvedName.ToLower().Trim()

        if ($cumulativeByName.Contains($resolvedKey)) {
            # Merge: add delta, keep best thumbnail
            $existing = $cumulativeByName[$resolvedKey]
            $existing.cumulativePopularity += $cumulativePop
        } else {
            $artistImage = if ($bandInfo -and $bandInfo.image) { $bandInfo.image } else { $topRelease.thumbnail }
            $cumulativeByName[$resolvedKey] = [ordered]@{
                bandName = $resolvedName
                artistId = $topRelease.artistId
                cumulativePopularity = $cumulativePop
                thumbnail = $artistImage
                spotifyUrl = $topRelease.spotifyUrl
                confirmed = if ($bandInfo) { [bool]$bandInfo.confirmed } else { $false }
            }
        }
    }
}

foreach ($entry in $cumulativeByName.Values) {
    if ($entry.cumulativePopularity -gt $maxCumulativePopularity) { $maxCumulativePopularity = $entry.cumulativePopularity }
    [void]$artistCumulativeRanking.Add($entry)
}

$artistCumulativeRanking = @($artistCumulativeRanking | Sort-Object { -$_.cumulativePopularity } | Select-Object -First 100)

# Collect all artist names that have any chart data (including 0 cumulative popularity)
$artistsWithChartData = [System.Collections.ArrayList]::new()
foreach ($artistKey in $artistPopularityGraphs.Keys) {
    $graph = $artistPopularityGraphs[$artistKey]
    if ($graph.Count -eq 0) { continue }
    $artistReleases = @($mainReleasesDeduped | Where-Object { @($_.bandName.ToLower().Trim() -split ',' | ForEach-Object { $_.Trim() }) -contains $artistKey })
    $topRelease = $artistReleases | Sort-Object { [int]($_.youtubeViews -as [int]) } -Descending | Select-Object -First 1
    if ($topRelease) {
        $bandInfo = Get-ArtistInfo $topRelease.bandName
        $name = if ($bandInfo) { $bandInfo.name } else { $topRelease.bandName }
        [void]$artistsWithChartData.Add($name.ToLower().Trim())
    }
}

Write-Host "  > Ranked $($artistCumulativeRanking.Count) artists by cumulative viewsDelta (max: $maxCumulativePopularity), $($artistsWithChartData.Count) total with chart data" -ForegroundColor DarkGray

# ============================================================================
#  3c. GLOBAL PEAK POPULARITY (max viewsDelta of any single release)
# ============================================================================

$globalPeakPopularity = 0
foreach ($r in $mainReleasesDeduped) {
    $delta = [int]($r.viewsDelta -as [int])
    if ($delta -gt $globalPeakPopularity) { $globalPeakPopularity = $delta }
}

Write-Host "  > Global peak viewsDelta: $globalPeakPopularity" -ForegroundColor DarkGray

# ============================================================================
#  4. ALL-TIME ARTISTS (sorted by total YouTube views, per genre)
# ============================================================================

Write-Host "  > Building all-time artist rankings..." -ForegroundColor Yellow

$deduped = $mainReleasesDeduped
$allTimeArtistsByGenre = @{}  # genre -> array of top 100 artists

foreach ($genre in $genreFilters) {
    $artistViewsMap = @{}  # artistKey(lower) -> { bandName, totalViews, totalDelta, followers, spotifyUrl, thumbnail }
    # Use pre-filtered genre data
    $genreDeduped = $mainByGenre[$genre]
    foreach ($r in $genreDeduped) {
        $aid = $r.artistId
        if (-not $aid) { continue }
        $views = [long]($r.youtubeViews -as [long])
        $delta = [long]($r.viewsDelta -as [long])
        # Split collab names so each artist gets credit for the views
        $artistNames = @($r.bandName -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        foreach ($artistName in $artistNames) {
            $key = $artistName.ToLower().Trim()
            $existing = $artistViewsMap[$key]
            if ($existing) {
                $existing.totalViews += $views
                $existing.totalDelta += $delta
                # Keep the best thumbnail/followers
                if (([int]($r.followers -as [int])) -gt $existing.followers) {
                    $existing.followers = [int]($r.followers -as [int])
                    $existing.thumbnail = $r.thumbnail
                }
            } else {
                $bandInfo = Get-ArtistInfo $artistName
                $artistImage = if ($bandInfo -and $bandInfo.image) { $bandInfo.image } else { $r.thumbnail }
                $artistViewsMap[$key] = [ordered]@{
                    artistId = $aid
                    bandName = if ($bandInfo) { $bandInfo.name } else { $artistName }
                    totalViews = $views
                    totalDelta = $delta
                    followers = [int]($r.followers -as [int])
                    spotifyUrl = $r.spotifyUrl
                    thumbnail = $artistImage
                    confirmed = if ($bandInfo) { [bool]$bandInfo.confirmed } else { $false }
                }
            }
        }
    }
    $allTimeArtistsByGenre[$genre] = @($artistViewsMap.Values | Sort-Object { -$_.totalViews } | Select-Object -First 100)
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
                effectiveReleaseDate = $_.effectiveReleaseDate
                releaseUrl   = $_.releaseUrl
                thumbnail    = $_.thumbnail
                totalTracks  = $_.totalTracks
                popularity   = [int]($_.popularity -as [int])
                followers    = [int]($_.followers -as [int])
                youtubeViews = [int]($_.youtubeViews -as [int])
                viewsDelta   = $_.viewsDelta
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
        $viewsDelta = ([int]($r.youtubeViews -as [int])) - [int]($prev.youtubeViews -as [int])
        if ($viewsDelta -gt 0) {
            $artistInfo = Get-ArtistInfo $r.bandName
            [void]$hotSongs.Add([PSCustomObject]@{
                releaseId    = $r.releaseId
                bandName     = $r.bandName
                releaseTitle = $r.releaseTitle
                releaseUrl   = $r.releaseUrl
                thumbnail    = $r.thumbnail
                youtubeViews = [int]($r.youtubeViews -as [int])
                viewsDelta   = $viewsDelta
                popularityChange = $viewsDelta
                confirmed    = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
            })
        }
    }
}

# Sort hot songs by viewsDelta descending and keep top 100 for index page
$hotSongsAll = $hotSongs
$hotSongs = [System.Collections.ArrayList]::new()
$hotSongsAll | Sort-Object -Property viewsDelta -Descending | Select-Object -First 100 | ForEach-Object { [void]$hotSongs.Add($_) }
Write-Host "  > Found $($hotSongs.Count) hot songs (capped at 100 from $($hotSongsAll.Count))" -ForegroundColor DarkGray

# ============================================================================
#  6b. RELEASE STATS (precomputed for index page — avoids loading releases.json)
# ============================================================================

Write-Host "  > Precomputing release stats..." -ForegroundColor Yellow

$totalSongs = 0; $verifiedSongs = 0; $unverifiedSongs = 0; $wnvSongs = 0; $noYtSongs = 0; [long]$totalViews = 0
foreach ($r in $releaseCatalog) {
    $yt = $r.youtubeTracks
    if (-not $yt) { $yt = @() }
    $sourceNames = $r.trackNames
    if (-not $sourceNames) { $sourceNames = @() }
    # Merge trackNames + youtubeTracks names (deduped)
    $seenKeys = @{}
    $songNames = [System.Collections.ArrayList]::new()
    foreach ($sn in $sourceNames) {
        if (-not $sn) { continue }
        $key = $sn.ToLower().Trim()
        if (-not $key -or $seenKeys.ContainsKey($key)) { continue }
        $seenKeys[$key] = $true
        [void]$songNames.Add($sn)
    }
    foreach ($y in $yt) {
        if (-not $y.name) { continue }
        $key = $y.name.ToLower().Trim()
        if (-not $key -or $seenKeys.ContainsKey($key)) { continue }
        $seenKeys[$key] = $true
        [void]$songNames.Add($y.name)
    }
    if ($songNames.Count -eq 0 -and $r.releaseTitle) { [void]$songNames.Add($r.releaseTitle) }
    # Build ytByName lookup
    $ytByName = @{}
    foreach ($y in $yt) {
        if (-not $y.name) { continue }
        $nk = $y.name.ToLower().Trim()
        if (-not $nk) { continue }
        if (-not $ytByName.ContainsKey($nk)) { $ytByName[$nk] = [System.Collections.ArrayList]::new() }
        [void]$ytByName[$nk].Add($y)
    }
    $totalSongs += $songNames.Count
    foreach ($sn in $songNames) {
        $songKey = $sn.ToLower().Trim()
        $matches2 = $ytByName[$songKey]
        if (-not $matches2 -or $matches2.Count -eq 0) { $noYtSongs++; continue }
        $hasV = $false; $hasU = $false; $hasW = $false
        foreach ($mk in $matches2) {
            if ($mk.verified -eq 'verified') { $hasV = $true }
            elseif ($mk.verified -eq 'will-not-verify') { $hasW = $true }
            else { $hasU = $true }
        }
        if ($hasV) { $verifiedSongs++ }
        elseif ($hasU) { $unverifiedSongs++ }
        elseif ($hasW) { $wnvSongs++ }
        else { $unverifiedSongs++ }
    }
    if ($r.youtubeViews) { $totalViews += [long]$r.youtubeViews }
}

$releaseStats = [PSCustomObject]@{
    totalReleases   = $releaseCatalog.Count
    totalArtists    = [int]$releasesJson.totalArtists
    totalSongs      = $totalSongs
    verifiedSongs   = $verifiedSongs
    unverifiedSongs = $unverifiedSongs
    wnvSongs        = $wnvSongs
    noYtSongs       = $noYtSongs
    totalViews      = $totalViews
}

Write-Host "  > Release stats: $totalSongs songs, $verifiedSongs verified, $totalViews views" -ForegroundColor DarkGray

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
    $rels = @($artistReleaseGroups[$name] | Sort-Object { ($_.effectiveReleaseDate, $_.releaseDate -ne $null)[0] })
    
    # Skip if ANY release is older than 2 years
    $earliestEffDate = ($rels[0].effectiveReleaseDate, $rels[0].releaseDate -ne $null)[0]
    if ($earliestEffDate -lt $twoYearCutoff) { continue }
    
    # Skip if 10+ releases (Spotify API cap — can't verify truly new)
    if ($rels.Count -ge 10) { continue }
    
    $latestRelease = $rels[-1]
    $latestViews = [int]($latestRelease.youtubeViews -as [int])
    $earliestViews = [int]($rels[0].youtubeViews -as [int])
    $maxViews = ($rels | ForEach-Object { [int]($_.youtubeViews -as [int]) } | Measure-Object -Maximum).Maximum
    
    # Minimum views threshold
    if ($maxViews -lt 100) { continue }
    
    $viewsTrend = if ($rels.Count -gt 1) { $latestViews - $earliestViews } else { 0 }
    $latestEffDate = if ($latestRelease.effectiveReleaseDate) { $latestRelease.effectiveReleaseDate } else { $latestRelease.releaseDate }
    $daysSinceLatest = [Math]::Floor(($now - [DateTime]::ParseExact($latestEffDate, 'yyyy-MM-dd', $null)).TotalDays)
    $recencyBonus = [Math]::Max(0, 180 - $daysSinceLatest)
    $activityBonus = if ($rels.Count -ge 2) { 25 } else { 0 }
    $score = [Math]::Round($latestViews / 100) + [Math]::Max(0, [Math]::Round($viewsTrend / 100)) * 2 + $recencyBonus + $activityBonus
    
    $bandInfo = Get-ArtistInfo $name
    
    # Determine badge
    $badge = if ($viewsTrend -gt 500) { "hot" }
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
        maxViews   = $maxViews
        latestViews = $latestViews
        viewsTrend = $viewsTrend
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
#  10. RELEASE RADAR (latest 10 releases)
# ============================================================================

$releaseRadar = @($deduped | Sort-Object { $_.releaseDate } -Descending | Select-Object -First 10 |
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
        [void]$releaseSparklines[$rid].Add([ordered]@{
            weekId = $weekId
            youtubeViews = [int]($r.youtubeViews -as [int])
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

# Helper: Convert array of objects to columnar format { _cols: [...], _rows: [[...], ...] }
# This reduces JSON size dramatically by storing property names only once (in _cols) instead of
# repeating them for every entry. Trailing null values are trimmed from each row.
function ConvertTo-Columnar {
    param(
        [array]$Items,
        [string[]]$ExcludeFields = @()
    )
    if (-not $Items -or $Items.Count -eq 0) {
        return [ordered]@{ _cols = @(); _rows = @() }
    }
    
    # Determine column order from first item, excluding specified fields
    $cols = @($Items[0].PSObject.Properties.Name | Where-Object { $_ -notin $ExcludeFields })
    
    $rows = [System.Collections.ArrayList]::new($Items.Count)
    foreach ($item in $Items) {
        $row = [object[]]::new($cols.Count)
        for ($ci = 0; $ci -lt $cols.Count; $ci++) {
            $row[$ci] = $item.($cols[$ci])
        }
        # Trim trailing nulls from each row to save space
        $lastNonNull = $cols.Count - 1
        while ($lastNonNull -ge 0 -and $null -eq $row[$lastNonNull]) { $lastNonNull-- }
        if ($lastNonNull -lt $cols.Count - 1) {
            if ($lastNonNull -lt 0) {
                $row = @()
            } else {
                $row = $row[0..$lastNonNull]
            }
        }
        [void]$rows.Add($row)
    }
    
    return [ordered]@{ _cols = $cols; _rows = @($rows) }
}

# Convert hashtable-based structures to proper objects for JSON serialization
# IMPORTANT: Use [ordered]@{} and sort keys to ensure deterministic JSON output.
# Regular @{} hashtables have non-deterministic enumeration order, causing
# the entire site-master.json to appear changed in git even when data is identical.
$chartsOutput = [ordered]@{}
foreach ($key in $charts.Keys | Sort-Object) {
    $chartsOutput[$key] = @($charts[$key])
}

# Convert advancedCharts to columnar format (excludes isCollab — always false, never read by clients)
$advancedChartsOutput = [ordered]@{}
foreach ($key in $advancedCharts.Keys | Sort-Object) {
    $advancedChartsOutput[$key] = ConvertTo-Columnar -Items $advancedCharts[$key] -ExcludeFields @('isCollab')
}

# Convert releaseHistoryMap (per-genre)
$historyMapOutput = [ordered]@{}
foreach ($genre in $releaseHistoryByGenre.Keys | Sort-Object) {
    $genreMap = [ordered]@{}
    foreach ($rid in $releaseHistoryByGenre[$genre].Keys | Sort-Object) {
        $genreMap[$rid] = @($releaseHistoryByGenre[$genre][$rid])
    }
    $historyMapOutput[$genre] = $genreMap
}

# Convert allTimeArtistsByGenre
$allTimeArtistsByGenreOutput = [ordered]@{}
foreach ($genre in $allTimeArtistsByGenre.Keys | Sort-Object) {
    $allTimeArtistsByGenreOutput[$genre] = @($allTimeArtistsByGenre[$genre])
}

# Convert latestReleasesByGenre
$latestReleasesByGenreOutput = [ordered]@{}
foreach ($genre in $latestReleasesByGenre.Keys | Sort-Object) {
    $latestReleasesByGenreOutput[$genre] = @($latestReleasesByGenre[$genre])
}

# Convert artist popularity graphs
$graphsOutput = [ordered]@{}
foreach ($key in $artistPopularityGraphs.Keys | Sort-Object) {
    $graphsOutput[$key] = @($artistPopularityGraphs[$key])
}

# Convert activity map
$activityOutput = [ordered]@{}
foreach ($key in $artistActivityMap.Keys | Sort-Object) {
    $activityOutput[$key] = $artistActivityMap[$key]
}

# Convert release sparklines
$sparklinesOutput = [ordered]@{}
foreach ($rid in $releaseSparklines.Keys | Sort-Object) {
    $sparklinesOutput[$rid] = @($releaseSparklines[$rid])
}

# Strip fields from chartData.releases that are unused by client code, remove derivable
# YouTube URLs (clients reconstruct from videoId), and convert to columnar format
$strippedReleases = @($releases | ForEach-Object {
    $props = [ordered]@{}
    foreach ($p in $_.PSObject.Properties) {
        # Skip unused fields
        if ($p.Name -in @('topTrackName', 'topTrackId', 'topTrackUrl', 'spotifyPopularity')) { continue }
        if ($p.Name -eq 'youtubeTracks' -and $p.Value) {
            # Strip 'url' from each youtube track (derivable from videoId)
            $cleaned = @($p.Value | ForEach-Object {
                $tp = [ordered]@{}
                foreach ($tp2 in $_.PSObject.Properties) {
                    if ($tp2.Name -ne 'url') { $tp[$tp2.Name] = $tp2.Value }
                }
                [PSCustomObject]$tp
            })
            $props[$p.Name] = $cleaned
        } else {
            $props[$p.Name] = $p.Value
        }
    }
    [PSCustomObject]$props
})
$columnarReleases = ConvertTo-Columnar -Items $strippedReleases

# ============================================================================
#  WRITE SPLIT FILES (loaded only by pages that need them)
# ============================================================================

# advanced-charts.json — only loaded by charts.html (Напредно view)
$advancedChartsJson = $advancedChartsOutput | ConvertTo-Json -Depth 15 -Compress
$advChartsPath = Join-Path $projectRoot "advanced-charts.json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($advChartsPath, $advancedChartsJson, $utf8NoBom)
Write-Host "  > Wrote advanced-charts.json ($([math]::Round((Get-Item $advChartsPath).Length / 1024, 1)) KB)" -ForegroundColor DarkGray

# artist-data.json — only loaded by artist.html (sparklines, graphs, activity)
$artistData = [PSCustomObject]@{
    artistPopularityGraphs = $graphsOutput
    releaseSparklines      = $sparklinesOutput
    artistActivity         = $activityOutput
}
$artistDataJson = $artistData | ConvertTo-Json -Depth 15 -Compress
$artistDataPath = Join-Path $projectRoot "artist-data.json"
[System.IO.File]::WriteAllText($artistDataPath, $artistDataJson, $utf8NoBom)
Write-Host "  > Wrote artist-data.json ($([math]::Round((Get-Item $artistDataPath).Length / 1024, 1)) KB)" -ForegroundColor DarkGray

$siteMaster = [PSCustomObject]@{
    generatedAt = $chartJson.generatedAt
    
    # Chart data (stripped of unused fields, releases in columnar format)
    chartData = [PSCustomObject]@{
        generatedAt   = $chartJson.generatedAt
        totalReleases = $chartJson.totalReleases
        totalArtists  = $chartJson.totalArtists
        releases      = $columnarReleases
    }
    
    # Pre-ranked charts: keys like "all_single", "alt_album", etc.
    charts = $chartsOutput
    
    # Per-release chart history (for tooltips), keyed by genre
    releaseHistory = $historyMapOutput
    
    # All-time top artists sorted by total YouTube views, keyed by genre
    allTimeArtistsByGenre = $allTimeArtistsByGenreOutput
    
    # Top 100 artists sorted by cumulative popularity (sum of all release popularities)
    artistCumulativeRanking = $artistCumulativeRanking
    
    # Max cumulative popularity of any artist (for VU meter scaling)
    maxCumulativePopularity = $maxCumulativePopularity
    
    # All artist names (lowercased) that have chart data (including 0 popularity)
    artistsWithChartData = $artistsWithChartData
    
    # Max popularity of any single release (for VU meter scaling on artist page)
    globalPeakPopularity = $globalPeakPopularity
    
    # Latest 20 releases sorted by date, keyed by genre
    latestReleasesByGenre = $latestReleasesByGenreOutput
    
    # Hot songs (top 100 with positive popularity change vs last week)
    hotSongs = $hotSongs
    
    # Rising artist candidates (sorted by score desc)
    risingArtists = $risingArtists
    
    # Release radar (latest 10)
    releaseRadar = $releaseRadar
    
    # Precomputed release stats (avoids loading releases.json on index page)
    releaseStats = $releaseStats
    
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
[System.IO.File]::WriteAllText($outputPath, $json, $utf8NoBom)

$fileSize = [Math]::Round((Get-Item $outputPath).Length / 1KB, 1)
$elapsed = [Math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

Write-Host ""
Write-Host "  > site-master.json generated successfully!" -ForegroundColor Green
Write-Host "  > Size: ${fileSize} KB" -ForegroundColor DarkGray
Write-Host "  > Completed in ${elapsed}s" -ForegroundColor DarkGray
Write-Host ""
