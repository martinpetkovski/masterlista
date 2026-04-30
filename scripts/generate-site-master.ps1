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

$staticDataRoot = Join-Path $projectRoot "data\static"
$editableDataRoot = Join-Path $projectRoot "data\dynamic\editable"
$generatedDataRoot = Join-Path $projectRoot "data\dynamic\generated"

$bandsPath = Join-Path $editableDataRoot "bands.json"
$releasesPath = Join-Path $editableDataRoot "releases.json"
$chartPath = Join-Path $generatedDataRoot "chart-data.json"
$articlesPath = Join-Path $generatedDataRoot "articles.json"
$interviewsPath = Join-Path $generatedDataRoot "interviews.json"
$eventsPath = Join-Path $editableDataRoot "events.json"
$curatorsPath = Join-Path $staticDataRoot "curators.json"
$curatorTracklistsPath = Join-Path $generatedDataRoot "curators-tracklists.json"
$blacklistPath = Join-Path $projectRoot "config\automation\news-word-blacklist.txt"
$chartHistoryDir = Join-Path $generatedDataRoot "chart-history"

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
    $merged['viewsDelta'] = if ($null -ne $cr.viewsDelta) { $cr.viewsDelta } else { $null }
    $merged['youtubeVideoIds'] = if ($cr.youtubeVideoIds) { @($cr.youtubeVideoIds) } else { @() }
    [PSCustomObject]$merged
})

# Load articles.json
$articlesJson = Get-Content $articlesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$allArticles = $articlesJson.articles

# Load interviews.json
$interviewsJson = if (Test-Path $interviewsPath) { Get-Content $interviewsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$allInterviews = if ($interviewsJson) { $interviewsJson.interviews } else { @() }

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

$chartGenresPath = Join-Path $staticDataRoot "chart-genres.json"
$chartGenresData = Get-Content $chartGenresPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rapGenres = @($chartGenresData.rap)
$electronicGenres = @($chartGenresData.electronic)
$popGenres = @($chartGenresData.pop)
$altExplicitGenres = @($chartGenresData.alternative)
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
$altExplicitGenresLower = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$altExplicitGenres | ForEach-Object { [void]$altExplicitGenresLower.Add($_.ToLower()) }

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
    $matchesRap = $false; $matchesElectronic = $false; $matchesPop = $false; $matchesAlt = $true; $explicitAlt = $false
    if ($genres.Count -eq 0) {
        $matchesAlt = $false
    } else {
        foreach ($g in $genres) {
            if ($rapGenresLower.Contains($g)) { $matchesRap = $true }
            if ($electronicGenresLower.Contains($g)) { $matchesElectronic = $true }
            if ($popGenresLower.Contains($g)) { $matchesPop = $true }
            if ($altExplicitGenresLower.Contains($g)) { $explicitAlt = $true }
            if ($nonAltGenresLower.Contains($g)) { $matchesAlt = $false }
        }
        if ($explicitAlt) { $matchesAlt = $true }
    }
    $artistGenreCache[$key] = @{
        all = $true
        alt = $matchesAlt
        rap = $matchesRap
        electronic = $matchesElectronic
        pop = $matchesPop
        genres = @($genres)
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

$chartEligibilityCache = @{}
$negativeViewsDeltaIssueCode = 'negative-views-delta'
$negativeViewsDeltaIssueLabel = 'ГРЕШКА'

function Set-ReleaseChartIssueProperty {
    param([object]$release, [string]$name, $value)
    if (-not $release -or -not $name) { return }
    if ($null -ne $release.PSObject.Properties[$name]) {
        $release.$name = $value
    } else {
        $release | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
    }
}

function Clear-ReleaseChartIssue {
    param([object]$release)
    if (-not $release) { return }

    Set-ReleaseChartIssueProperty $release 'chartIssueCode' $null
    Set-ReleaseChartIssueProperty $release 'chartIssueLabel' $null
    Set-ReleaseChartIssueProperty $release 'chartIssueReason' $null
}

function Get-NegativeViewsDeltaIssueReason {
    param([object]$release, [string]$baselineWeekId)

    $currentViews = [int]($release.youtubeViews -as [int])
    $delta = [int]($release.viewsDelta -as [int])
    $baselineViews = $currentViews - $delta
    if ($baselineViews -lt 0) { $baselineViews = 0 }

    if ($baselineWeekId) {
        return "Негативен views delta ($currentViews < $baselineViews) наспроти архивата $baselineWeekId"
    }

    return "Негативен views delta ($currentViews < $baselineViews) наспроти архивската недела"
}

function Set-NegativeViewsDeltaIssue {
    param([object]$release, [string]$baselineWeekId)
    if (-not $release) { return }

    Clear-ReleaseChartIssue $release
    Set-ReleaseChartIssueProperty $release 'chartIssueCode' $negativeViewsDeltaIssueCode
    Set-ReleaseChartIssueProperty $release 'chartIssueLabel' $negativeViewsDeltaIssueLabel
    Set-ReleaseChartIssueProperty $release 'chartIssueReason' (Get-NegativeViewsDeltaIssueReason $release $baselineWeekId)
}

function Set-NegativeViewsDeltaIssues {
    param([array]$items, [string]$baselineWeekId)

    $count = 0
    foreach ($item in @($items)) {
        if (-not $item) { continue }
        Clear-ReleaseChartIssue $item

        $delta = $item.viewsDelta -as [int]
        if ($null -ne $delta -and [int]$delta -lt 0) {
            Set-NegativeViewsDeltaIssue $item $baselineWeekId
            $count++
        }
    }

    return $count
}

function Get-ArtistLabels {
    param([object]$artistInfo)
    if (-not $artistInfo -or -not $artistInfo.label) { return @() }
    $labelText = [string]$artistInfo.label
    if ([string]::IsNullOrWhiteSpace($labelText)) { return @() }
    if ($labelText.ToLower() -eq 'недостигаат податоци') { return @() }
    return @($labelText -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
}

function Test-ArtistHasLabel {
    param([string]$artistName, [string]$label)
    if (-not $artistName -or -not $label) { return $false }

    $target = $label.Trim().ToLower()
    $artistNames = @($artistName -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($artistNames.Count -eq 0) { $artistNames = @($artistName) }

    foreach ($name in $artistNames) {
        $info = Get-ArtistInfo $name
        if (-not $info) { continue }
        if ((Get-ArtistLabels $info) -contains $target) { return $true }
    }

    return $false
}

function Test-ReleaseChartEligibility {
    param([object]$release)
    if (-not $release) { return $false }

    $cacheKey = if ($release.releaseId) {
        "$($release.releaseId)|$([string]$release.chartIssueCode)"
    } else {
        "$($release.bandName)|$($release.releaseTitle)|$($release.releaseDate)|$([string]$release.chartIssueCode)"
    }

    if ($chartEligibilityCache.ContainsKey($cacheKey)) {
        return [bool]$chartEligibilityCache[$cacheKey]
    }

    $eligible = -not $release.chartIssueCode -and -not (Test-ArtistHasLabel $release.bandName 'AI')
    $chartEligibilityCache[$cacheKey] = $eligible
    return $eligible
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

function Get-ReleaseEffectiveDateString {
    param([object]$release)
    if ($release.effectiveReleaseDate) { return [string]$release.effectiveReleaseDate }
    if ($release.releaseDate) { return [string]$release.releaseDate }
    return $null
}

function Get-ReleaseDateValue {
    param([object]$release)
    $dateStr = Get-ReleaseEffectiveDateString $release
    if (-not $dateStr) { return $null }
    try {
        return [datetime]::Parse($dateStr)
    }
    catch {
        return $null
    }
}

function Get-ReleaseAgeDays {
    param([object]$release, [datetime]$referenceDate)
    $releaseDate = Get-ReleaseDateValue $release
    if (-not $releaseDate) { return 9999 }
    $ageDays = [int][Math]::Floor(($referenceDate.Date - $releaseDate.Date).TotalDays)
    if ($ageDays -lt 0) { return 0 }
    return $ageDays
}

function Get-HotSongGenreBuckets {
    param([string]$artistName)

    $bucketSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $artistNames = @($artistName -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($artistNames.Count -eq 0 -and $artistName) { $artistNames = @($artistName.Trim()) }

    foreach ($name in $artistNames) {
        $artistKey = $name.ToLower().Trim()
        $cached = $artistGenreCache[$artistKey]
        if (-not $cached) {
            $info = Get-ArtistInfo $name
            if ($info) { $cached = $artistGenreCache[$info.name.ToLower().Trim()] }
        }
        if (-not $cached) { continue }

        foreach ($genre in @($cached.genres)) {
            if ($genre) {
                [void]$bucketSet.Add([string]$genre)
            }
        }
    }

    if ($bucketSet.Count -eq 0) {
        [void]$bucketSet.Add('other')
    } else {
        $specificBuckets = @($bucketSet | Where-Object { $_ -notin @('pop', 'alternative') } | Sort-Object -Unique)
        if ($specificBuckets.Count -gt 0) {
            return @($specificBuckets)
        }
    }

    return @($bucketSet | Sort-Object -Unique)
}

function Get-HotSongRecencyMultiplier {
    param([int]$ageDays)
    $freshWindowDays = 183.0
    $maxBonus = 0.36

    if ($ageDays -le 0) {
        return [math]::Round(1.0 + $maxBonus, 3)
    }
    if ($ageDays -ge $freshWindowDays) {
        return 1.00
    }

    $progress = [double]$ageDays / $freshWindowDays
    $bonus = $maxBonus * [Math]::Pow((1.0 - $progress), 1.25)
    return [math]::Round(1.0 + $bonus, 3)
}

function Get-HotSongScore {
    param([int]$viewsDelta, [int]$ageDays)
    if ($viewsDelta -le 0) { return 0.0 }
    $multiplier = Get-HotSongRecencyMultiplier $ageDays
    return [math]::Log10([double]$viewsDelta + 1.0) * $multiplier
}

function Get-HotSongNormalizedBuckets {
    param([object]$genreBuckets)

    $songBuckets = @($genreBuckets | Where-Object { $_ } | Sort-Object -Unique)
    if ($songBuckets.Count -eq 0) {
        return @('other')
    }

    return @($songBuckets)
}

function Get-HotSongBalanceBuckets {
    param([object]$genreBuckets)

    return @(Get-HotSongNormalizedBuckets $genreBuckets)
}

function Get-HotSongGenreRepresentationMultiplier {
    param(
        [double]$count,
        [double]$minCount,
        [double]$maxCount,
        [double]$minMultiplier = 0.55,
        [double]$maxMultiplier = 1.18,
        [double]$curvePower = 0.9
    )

    if ($maxCount -le $minCount) {
        return 1.0
    }

    $progress = ($count - $minCount) / ($maxCount - $minCount)
    $progress = [Math]::Min(1.0, [Math]::Max(0.0, $progress))
    $multiplier = $maxMultiplier - (($maxMultiplier - $minMultiplier) * [Math]::Pow($progress, $curvePower))
    return [math]::Round($multiplier, 4)
}

function Get-HotSongSelectionMeta {
    param([object]$candidate, [hashtable]$genreCounts)

    $candidateBuckets = @(Get-HotSongBalanceBuckets $candidate.genreBuckets)
    if ($candidateBuckets.Count -eq 0) {
        $candidateBuckets = @('other')
    }

    $relevantBuckets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($bucket in $candidateBuckets) {
        [void]$relevantBuckets.Add($bucket)
    }
    foreach ($bucket in $genreCounts.Keys) {
        [void]$relevantBuckets.Add([string]$bucket)
    }

    $minCount = [double]::PositiveInfinity
    $maxCount = [double]::NegativeInfinity
    foreach ($bucket in $relevantBuckets) {
        $count = if ($genreCounts.ContainsKey($bucket)) { [double]$genreCounts[$bucket] } else { 0.0 }
        if ($count -lt $minCount) { $minCount = $count }
        if ($count -gt $maxCount) { $maxCount = $count }
    }
    if ([double]::IsNaN($minCount) -or [double]::IsInfinity($minCount)) { $minCount = 0.0 }
    if ([double]::IsNaN($maxCount) -or [double]::IsInfinity($maxCount)) { $maxCount = 0.0 }

    $primaryBucket = $candidateBuckets[0]
    $bucketFactors = @{}
    $factorTotal = 0.0
    foreach ($bucket in $candidateBuckets) {
        $count = if ($genreCounts.ContainsKey($bucket)) { [double]$genreCounts[$bucket] } else { 0.0 }
        $bucketFactor = Get-HotSongGenreRepresentationMultiplier $count $minCount $maxCount 0.74 1.12 0.9
        $bucketFactors[$bucket] = $bucketFactor
        $factorTotal += $bucketFactor
    }

    $selectionFactor = if ($candidateBuckets.Count -gt 0) {
        [math]::Round(($factorTotal / [double]$candidateBuckets.Count), 4)
    } else {
        1.0
    }

    foreach ($bucket in $candidateBuckets) {
        $bucketFactor = [double]$bucketFactors[$bucket]
        $primaryFactor = [double]$bucketFactors[$primaryBucket]
        if ($selectionFactor -ge 1.0) {
            if ($bucketFactor -gt $primaryFactor -or ($bucketFactor -eq $primaryFactor -and $bucket -lt $primaryBucket)) {
                $primaryBucket = $bucket
            }
        } elseif ($bucketFactor -lt $primaryFactor -or ($bucketFactor -eq $primaryFactor -and $bucket -lt $primaryBucket)) {
            $primaryBucket = $bucket
        }
    }

    $adjustedScore = [double]$candidate.hotScore * $selectionFactor

    return [PSCustomObject]@{
        primaryBucket = $primaryBucket
        penaltyFactor = $selectionFactor
        adjustedScore = [math]::Round($adjustedScore, 6)
    }
}

function Get-HotSongGenreMultiplierMap {
    param([array]$hotSongs)

    $genreCounts = @{}

    foreach ($song in @($hotSongs)) {
        $songBuckets = @(Get-HotSongBalanceBuckets $song.genreBuckets)
        if ($songBuckets.Count -eq 0) {
            $songBuckets = @('other')
        }

        foreach ($bucket in $songBuckets) {
            if (-not $genreCounts.ContainsKey($bucket)) {
                $genreCounts[$bucket] = 0
            }
            $genreCounts[$bucket] = [int]$genreCounts[$bucket] + 1
        }
    }

    $activeBuckets = @($genreCounts.GetEnumerator() | Where-Object { [int]$_.Value -gt 0 })
    if ($activeBuckets.Count -eq 0) {
        return @{}
    }

    $minCount = [double](($activeBuckets | Measure-Object -Property Value -Minimum).Minimum)
    $maxCount = [double](($activeBuckets | Measure-Object -Property Value -Maximum).Maximum)
    $multiplierMap = @{}

    foreach ($entry in $activeBuckets) {
        $count = [double]$entry.Value
        $multiplierMap[$entry.Key] = Get-HotSongGenreRepresentationMultiplier $count $minCount $maxCount
    }

    return $multiplierMap
}

function Get-HotSongBalanceMeta {
    param([object]$song, [hashtable]$genreMultiplierMap)

    $songBuckets = @(Get-HotSongBalanceBuckets $song.genreBuckets)
    if ($songBuckets.Count -eq 0) {
        $songBuckets = @('other')
    }

    $balanceBucket = $songBuckets[0]
    $balanceTotal = 0.0
    $bucketMultipliers = @{}

    foreach ($bucket in $songBuckets) {
        $multiplier = if ($genreMultiplierMap.ContainsKey($bucket)) { [double]$genreMultiplierMap[$bucket] } else { 1.0 }
        $bucketMultipliers[$bucket] = $multiplier
        $balanceTotal += $multiplier
    }

    $balanceMultiplier = if ($songBuckets.Count -gt 0) {
        [math]::Round(($balanceTotal / [double]$songBuckets.Count), 4)
    } else {
        1.0
    }

    foreach ($bucket in $songBuckets) {
        $multiplier = [double]$bucketMultipliers[$bucket]
        $primaryMultiplier = [double]$bucketMultipliers[$balanceBucket]
        if ($balanceMultiplier -ge 1.0) {
            if ($multiplier -gt $primaryMultiplier -or ($multiplier -eq $primaryMultiplier -and $bucket -lt $balanceBucket)) {
                $balanceBucket = $bucket
            }
        } elseif ($multiplier -lt $primaryMultiplier -or ($multiplier -eq $primaryMultiplier -and $bucket -lt $balanceBucket)) {
            $balanceBucket = $bucket
        }
    }

    return [PSCustomObject]@{
        genreBucket       = $balanceBucket
        penaltyFactor     = $balanceMultiplier
        adjustedHotScore  = [math]::Round(([double]$song.hotScore * $balanceMultiplier), 4)
    }
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

# Chart sort comparator (matching common.js chartSort: null-delta last,
# nonzero deltas before zero, then viewsDelta desc, youtubeViews desc, name asc)
function Sort-ChartRanking {
    param([array]$items)
    return $items | Sort-Object @(
        @{ Expression = { if ($null -eq $_.viewsDelta) { 1 } else { 0 } } },
        @{ Expression = { if ([int]($_.viewsDelta -as [int]) -eq 0) { 1 } else { 0 } } },
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
        $deltaVideoIdSet = $null
        if ($r._deltaVideoIds) {
            $deltaVideoIdSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            foreach ($videoId in @($r._deltaVideoIds)) {
                if ($videoId) { [void]$deltaVideoIdSet.Add([string]$videoId) }
            }
        }
        $deltaCountedVideoIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)

        $tracksByName = [ordered]@{}
        foreach ($track in $tracks) {
            $tName = $track.name
            if (-not $tracksByName.Contains($tName)) {
                $tracksByName[$tName] = @{ views = 0; deltaViews = 0; index = $tracksByName.Count }
            }
            $trackViews = [int]($track.views -as [int])
            $tracksByName[$tName].views += $trackViews
            $videoId = [string]$track.videoId
            if ($deltaVideoIdSet -and $videoId -and $deltaVideoIdSet.Contains($videoId) -and (-not $deltaCountedVideoIds.Contains($videoId)) -and (($track.verified) -eq 'verified')) {
                $tracksByName[$tName].deltaViews += $trackViews
                [void]$deltaCountedVideoIds.Add($videoId)
            }
        }

        $deltaTotalViews = if ($deltaVideoIdSet) {
            [int](($tracksByName.Values | ForEach-Object { [int]($_.deltaViews -as [int]) } | Measure-Object -Sum).Sum)
        } else {
            $totalViews
        }

        foreach ($tName in $tracksByName.Keys) {
            $tData = $tracksByName[$tName]
            $trackViews = $tData.views
            $ti = $tData.index

            $trackDelta = $null
            if ($null -ne $releaseDelta -and $deltaTotalViews -gt 0) {
                $deltaTrackViews = if ($deltaVideoIdSet) { [int]($tData.deltaViews -as [int]) } else { $trackViews }
                $trackDelta = if ($deltaTrackViews -gt 0) { [int]([math]::Round([double]$releaseDelta * $deltaTrackViews / $deltaTotalViews)) } else { 0 }
            } elseif ($null -ne $releaseDelta -and $deltaVideoIdSet) {
                $trackDelta = 0
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
    $deduped = @($deduped | Where-Object { Test-ReleaseChartEligibility $_ })
    
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
        $merged['viewsDelta'] = if ($null -ne $compact.viewsDelta) { $compact.viewsDelta } else { $null }
        $merged['youtubeVideoIds'] = if ($compact.youtubeVideoIds) { @($compact.youtubeVideoIds) } else { @() }
        [PSCustomObject]$merged
    })
    # Count verified videos (releases with linked YouTube video IDs)
    $verifiedCount = 0
    foreach ($cr in $data.releases) {
        if (($cr.youtubeVideoIds -and $cr.youtubeVideoIds.Count -gt 0) -or ($cr.youtubeTrackCount -and [int]$cr.youtubeTrackCount -gt 0)) {
            $verifiedCount++
        }
    }

    $chartHistoryWeeks += @{
        weekId = $weekId
        releases = $hydrated
        generatedAt = $data.generatedAt
        totalReleases = if ($data.totalReleases) { [int]$data.totalReleases } else { $data.releases.Count }
        totalArtists = if ($data.totalArtists) { [int]$data.totalArtists } else { 0 }
        verifiedVideos = $verifiedCount
    }
}

Write-Host "  > Loaded $($chartHistoryWeeks.Count) chart history weeks (hydrated from catalog)" -ForegroundColor DarkGray

# Live charts compare against the newest archived snapshot. If that produces no
# positive deltas yet, current display freezes on the prior archived week.
$deltaBaselineWeek = if ($chartHistoryWeeks.Count -gt 0) { $chartHistoryWeeks[0] } else { $null }
$displayFallbackWeek = if ($chartHistoryWeeks.Count -gt 1) { $chartHistoryWeeks[1] } else { $null }
$displayFallbackReferenceWeek = if ($chartHistoryWeeks.Count -gt 2) { $chartHistoryWeeks[2] } else { $null }

$previousWeekReleases = @()
if ($deltaBaselineWeek) {
    $previousWeekReleases = $deltaBaselineWeek.releases
    Write-Host "  > Live viewsDelta baseline: $($deltaBaselineWeek.weekId)" -ForegroundColor DarkGray
}
if ($displayFallbackWeek) {
    Write-Host "  > Frozen fallback display week: $($displayFallbackWeek.weekId)" -ForegroundColor DarkGray
}
if ($displayFallbackReferenceWeek) {
    Write-Host "  > Frozen fallback reference week: $($displayFallbackReferenceWeek.weekId)" -ForegroundColor DarkGray
}

$chevronCurrentReleases = @()
$chevronPreviousReleases = @()
$chevronCurrentWeekId = $null
$chevronPreviousWeekId = $null
$usingFrozenChartState = $false
$currentDisplayWeekId = if ($deltaBaselineWeek) { $deltaBaselineWeek.weekId } else { $null }

# ============================================================================
#  1. PRE-CALCULATE CHARTS
# ============================================================================

Write-Host "  > Calculating chart rankings..." -ForegroundColor Yellow

$genreFilters = @('all', 'alt', 'rap', 'electronic', 'pop')
$typeFilters = @('single', 'album')

# Pre-deduplicate releases once for reuse across all chart computations
$mainReleasesDeduped = @(Invoke-DeduplicateCollabs $releases | Where-Object { Test-ReleaseChartEligibility $_ })
$prevReleasesDeduped = @(Invoke-DeduplicateCollabs $previousWeekReleases | Where-Object { Test-ReleaseChartEligibility $_ })

# Pre-compute viewsDelta (current - previous week youtubeViews) and attach to each release
$prevViewsMap = @{}
$prevVideoIdsMap = @{}
foreach ($pr in $prevReleasesDeduped) {
    $prevViewsMap[$pr.releaseId] = [int]($pr.youtubeViews -as [int])
    if ($pr.youtubeVideoIds -and $pr.youtubeVideoIds.Count -gt 0) { $prevVideoIdsMap[$pr.releaseId] = @($pr.youtubeVideoIds) }
}

function Set-DeltaVideoIds {
    param([object]$release, [array]$videoIds)
    if (-not $release) { return }

    $value = if ($videoIds -and $videoIds.Count -gt 0) { @($videoIds) } else { $null }
    if ($release.PSObject.Properties['_deltaVideoIds']) {
        $release._deltaVideoIds = $value
    } else {
        $release | Add-Member -NotePropertyName '_deltaVideoIds' -NotePropertyValue $value -Force
    }
}

function Get-VerifiedViewsForVideoIds {
    param([object]$release, [array]$videoIds)
    if (-not $release -or -not $release.youtubeTracks -or -not $videoIds -or $videoIds.Count -le 0) { return 0 }

    $videoIdSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($videoId in @($videoIds)) {
        if ($videoId) { [void]$videoIdSet.Add([string]$videoId) }
    }
    if ($videoIdSet.Count -le 0) { return 0 }

    $countedVideoIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [long]$views = 0
    foreach ($track in @($release.youtubeTracks)) {
        $videoId = [string]$track.videoId
        if (-not $videoId -or -not $videoIdSet.Contains($videoId) -or $countedVideoIds.Contains($videoId)) { continue }
        if (($track.verified) -ne 'verified') { continue }
        $views += [long]($track.views -as [long])
        [void]$countedVideoIds.Add($videoId)
    }
    return $views
}

function Get-ViewsDelta {
    param(
        [object]$release,
        [hashtable]$previousViewsMap,
        [hashtable]$previousVideoIdsMap,
        $previousChartMonday,
        [switch]$UseCurrentTrackVideoFilter
    )

    Set-DeltaVideoIds $release $null

    $curViews = [long]($release.youtubeViews -as [long])
    if ($curViews -le 0) { return $null }

    # Determine release date
    $relDate = $null
    $effectiveDateStr = if ($release.effectiveReleaseDate) { $release.effectiveReleaseDate } else { $release.releaseDate }
    if ($effectiveDateStr) { try { $relDate = [datetime]::Parse($effectiveDateStr) } catch {} }

    # Released AFTER previous chart Monday → all current views are the delta
    if ($relDate -and $previousChartMonday -and $relDate -ge $previousChartMonday) {
        return $curViews
    }

    # Released BEFORE previous chart Monday → delta = current - previous
    if ($previousViewsMap.ContainsKey($release.releaseId)) {
        $prevViews = [long]($previousViewsMap[$release.releaseId] -as [long])
        $prevVideoIds = if ($previousVideoIdsMap -and $previousVideoIdsMap.ContainsKey($release.releaseId)) { @($previousVideoIdsMap[$release.releaseId]) } else { @() }
        if ($UseCurrentTrackVideoFilter -and $prevVideoIds.Count -gt 0) {
            Set-DeltaVideoIds $release $prevVideoIds
            $comparableViews = Get-VerifiedViewsForVideoIds $release $prevVideoIds
            return ($comparableViews - $prevViews)
        }
        if ($prevViews -le 0) { return 0 }
        return ($curViews - $prevViews)
    }

    return $null
}

function Get-ChartMondayFromWeekId {
    param([string]$weekId)
    if (-not $weekId) { return $null }
    if ($weekId -match '^(\d{4})-W(\d{2})$') {
        $isoYear = [int]$Matches[1]
        $isoWeek = [int]$Matches[2]
        $jan4 = [datetime]::new($isoYear, 1, 4)
        $dow = [int]$jan4.DayOfWeek
        if ($dow -eq 0) { $dow = 7 }
        $week1Monday = $jan4.AddDays(1 - $dow)
        return $week1Monday.AddDays(7 * ($isoWeek - 1))
    }
    return $null
}

function Get-ViewsMapFromReleases {
    param([array]$snapshotReleases)
    $viewsMap = @{}
    foreach ($release in @($snapshotReleases)) {
        $viewsMap[$release.releaseId] = [int]($release.youtubeViews -as [int])
    }
    return $viewsMap
}

function Get-VideoIdsMapFromReleases {
    param([array]$snapshotReleases)
    $videoIdsMap = @{}
    foreach ($release in @($snapshotReleases)) {
        if ($release.youtubeVideoIds -and $release.youtubeVideoIds.Count -gt 0) {
            $videoIdsMap[$release.releaseId] = @($release.youtubeVideoIds)
        }
    }
    return $videoIdsMap
}

function Get-SnapshotViewsDeltaMap {
    param(
        [array]$snapshotReleases,
        [array]$baselineReleases,
        [string]$baselineWeekId
    )
    $snapshotDeltaMap = @{}
    if (-not $snapshotReleases) { return $snapshotDeltaMap }

    $baselineViewsMap = Get-ViewsMapFromReleases $baselineReleases
    $baselineVideoIdsMap = Get-VideoIdsMapFromReleases $baselineReleases
    $baselineMonday = Get-ChartMondayFromWeekId $baselineWeekId
    foreach ($release in @($snapshotReleases)) {
        $snapshotDeltaMap[$release.releaseId] = Get-ViewsDelta -release $release -previousViewsMap $baselineViewsMap -previousVideoIdsMap $baselineVideoIdsMap -previousChartMonday $baselineMonday
    }
    return $snapshotDeltaMap
}

function Merge-ChartSnapshotState {
    param(
        [array]$sourceReleases,
        [array]$snapshotReleases,
        [hashtable]$snapshotViewsDeltaMap
    )
    $snapshotMap = @{}
    foreach ($snapshot in @($snapshotReleases)) {
        $snapshotMap[$snapshot.releaseId] = $snapshot
    }

    return @($sourceReleases | ForEach-Object {
        $source = $_
        $snapshot = $snapshotMap[$source.releaseId]
        $merged = [ordered]@{}
        foreach ($property in $source.PSObject.Properties) {
            $merged[$property.Name] = $property.Value
        }

        if ($snapshot) {
            $merged['popularity'] = [int]($snapshot.popularity -as [int])
            $merged['youtubeViews'] = [int]($snapshot.youtubeViews -as [int])
            $merged['viewsDelta'] = if ($snapshotViewsDeltaMap.ContainsKey($source.releaseId)) { $snapshotViewsDeltaMap[$source.releaseId] } else { $null }
        } else {
            $merged['popularity'] = 0
            $merged['viewsDelta'] = $null
        }

        [PSCustomObject]$merged
    })
}

# Determine the Monday of the live chart-history baseline week
$prevChartMonday = $null
if ($deltaBaselineWeek) {
    $prevChartMonday = Get-ChartMondayFromWeekId $deltaBaselineWeek.weekId
    if ($prevChartMonday) {
        Write-Host "  > Live baseline Monday: $($prevChartMonday.ToString('yyyy-MM-dd'))" -ForegroundColor DarkGray
    }
}

foreach ($r in $mainReleasesDeduped) {
    $delta = Get-ViewsDelta -release $r -previousViewsMap $prevViewsMap -previousVideoIdsMap $prevVideoIdsMap -previousChartMonday $prevChartMonday -UseCurrentTrackVideoFilter
    $r | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $delta -Force
}
# Also attach viewsDelta to original $releases so it's included in chartData output
foreach ($r in $releases) {
    $delta = Get-ViewsDelta -release $r -previousViewsMap $prevViewsMap -previousVideoIdsMap $prevVideoIdsMap -previousChartMonday $prevChartMonday -UseCurrentTrackVideoFilter
    $r | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $delta -Force
}

$negativeDeltaCount = Set-NegativeViewsDeltaIssues -items $releases -baselineWeekId $(if ($deltaBaselineWeek) { $deltaBaselineWeek.weekId } else { $null })
if ($negativeDeltaCount -gt 0) {
    Write-Host "  > Excluding $negativeDeltaCount release(s) with negative live deltas from charts" -ForegroundColor Yellow
}

$chartEligibilityCache = @{}
$mainReleasesDeduped = @(Invoke-DeduplicateCollabs $releases | Where-Object { Test-ReleaseChartEligibility $_ })

$liveMainReleasesDeduped = $mainReleasesDeduped
$chartSourceReleases = $releases
$chartSourceDeduped = $mainReleasesDeduped
$chartDataOutputReleases = $releases

$livePositiveDeltaCount = @($mainReleasesDeduped | Where-Object { [int]($_.viewsDelta -as [int]) -gt 0 }).Count
if ($livePositiveDeltaCount -le 0 -and $displayFallbackWeek) {
    $fallbackBaselineReleases = if ($displayFallbackReferenceWeek) { $displayFallbackReferenceWeek.releases } else { @() }
    $fallbackBaselineWeekId = if ($displayFallbackReferenceWeek) { $displayFallbackReferenceWeek.weekId } else { $null }
    $fallbackDeltaMap = Get-SnapshotViewsDeltaMap -snapshotReleases $displayFallbackWeek.releases -baselineReleases $fallbackBaselineReleases -baselineWeekId $fallbackBaselineWeekId

    $chartSourceReleases = Merge-ChartSnapshotState -sourceReleases $releases -snapshotReleases $displayFallbackWeek.releases -snapshotViewsDeltaMap $fallbackDeltaMap
    $chartSourceDeduped = @(Invoke-DeduplicateCollabs $chartSourceReleases | Where-Object { Test-ReleaseChartEligibility $_ })
    $chartDataOutputReleases = $chartSourceReleases
    $usingFrozenChartState = $true
    $currentDisplayWeekId = $displayFallbackWeek.weekId
    $chevronCurrentReleases = @()
    $chevronPreviousReleases = if ($displayFallbackReferenceWeek) { $displayFallbackReferenceWeek.releases } else { @() }
    $chevronCurrentWeekId = $null
    $chevronPreviousWeekId = if ($displayFallbackReferenceWeek) { $displayFallbackReferenceWeek.weekId } else { $null }
    Write-Host "  > No positive live deltas yet — reusing $currentDisplayWeekId for current chart display" -ForegroundColor Cyan
} else {
    $chevronCurrentReleases = if ($deltaBaselineWeek) { $deltaBaselineWeek.releases } else { @() }
    $chevronPreviousReleases = if ($displayFallbackWeek) { $displayFallbackWeek.releases } else { @() }
    $chevronCurrentWeekId = if ($deltaBaselineWeek) { $deltaBaselineWeek.weekId } else { $null }
    $chevronPreviousWeekId = if ($displayFallbackWeek) { $displayFallbackWeek.weekId } else { $null }
    if ($livePositiveDeltaCount -gt 0) {
        Write-Host "  > Positive live deltas detected: $livePositiveDeltaCount" -ForegroundColor DarkGray
    }
}

if ($chevronCurrentWeekId) {
    Write-Host "  > Chevron current week: $chevronCurrentWeekId" -ForegroundColor DarkGray
}
if ($chevronPreviousWeekId) {
    Write-Host "  > Chevron previous week: $chevronPreviousWeekId" -ForegroundColor DarkGray
}

$mainReleasesDeduped = $chartSourceDeduped

# Pre-filter releases by genre once (avoids re-filtering inside every Build-ChartRanking call)
$mainByGenre = @{}
$liveByGenre = @{}
foreach ($genre in $genreFilters) {
    if ($genre -eq 'all') {
        $mainByGenre[$genre] = $mainReleasesDeduped
        $liveByGenre[$genre] = $liveMainReleasesDeduped
    } else {
        $mainByGenre[$genre] = @($mainReleasesDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
        $liveByGenre[$genre] = @($liveMainReleasesDeduped | Where-Object { Test-ArtistGenre $_.bandName $genre })
    }
}

# Pre-compute previous-week ranked maps for unlimited charts (only 'all' genre needed;
# genre subsets are reconstructed client-side from the all-chart data)
# Chevron maps: compare the two most recent chart-history snapshots for stable week-over-week indicators
$chevronPrevDeduped = @(Invoke-DeduplicateCollabs $chevronPreviousReleases | Where-Object { Test-ReleaseChartEligibility $_ })
$chevronCurDeduped = @(Invoke-DeduplicateCollabs $chevronCurrentReleases | Where-Object { Test-ReleaseChartEligibility $_ })
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
#  1b. PRE-COMPUTE HISTORICAL WEEKLY CHARTS (for chart-history-data.json)
# ============================================================================
# For each chart-history week: viewsDelta = weekN.views - weekN-1.views
# Build ranked charts with position changes, latest releases, and stats.

Write-Host "  > Pre-computing historical weekly charts..." -ForegroundColor Yellow

# ISO week date range string (Monday–Sunday)
function Get-WeekDateRange {
    param([string]$wkId)
    if ($wkId -match '^(\d{4})-W(\d{2})$') {
        $y = [int]$Matches[1]; $w = [int]$Matches[2]
        $jan4 = [datetime]::new($y, 1, 4)
        $dow = [int]$jan4.DayOfWeek; if ($dow -eq 0) { $dow = 7 }
        $week1Mon = $jan4.AddDays(1 - $dow)
        $mon = $week1Mon.AddDays(7 * ($w - 1))
        $sun = $mon.AddDays(6)
        $pd = { param($n) $n.ToString().PadLeft(2, '0') }
        if ($mon.Month -eq $sun.Month) {
            return "$(&$pd $mon.Day).$([char]0x2013)$(&$pd $sun.Day).$(&$pd $mon.Month).$($mon.Year)"
        }
        return "$(&$pd $mon.Day).$(&$pd $mon.Month). $([char]0x2013) $(&$pd $sun.Day).$(&$pd $sun.Month).$($sun.Year)"
    }
    return ''
}

$weeksOldestFirst = @($chartHistoryWeeks | Sort-Object { $_.weekId })
$weeklyChartsComputed = [ordered]@{}
$allWeekIds = [System.Collections.ArrayList]::new()
$cachedWeekDedup = @{}  # weekId -> deduped releases with viewsDelta

for ($wi = 0; $wi -lt $weeksOldestFirst.Count; $wi++) {
    $thisWeek = $weeksOldestFirst[$wi]
    $prevWeek = if ($wi -gt 0) { $weeksOldestFirst[$wi - 1] } else { $null }
    $wkId = $thisWeek.weekId
    [void]$allWeekIds.Add($wkId)

    # Get previous week's deduped+viewsDelta releases (cached from previous iteration)
    $prevDedWithDelta = if ($prevWeek) { $cachedWeekDedup[$prevWeek.weekId] } else { @() }

    # Build previous-week views map for delta calculation
    $pvm = @{}
    $pvidm = @{}
    $pcm = $null
    if ($prevDedWithDelta.Count -gt 0) {
        foreach ($r in $prevDedWithDelta) {
            $pvm[$r.releaseId] = [int]($r.youtubeViews -as [int])
            if ($r.youtubeVideoIds -and $r.youtubeVideoIds.Count -gt 0) { $pvidm[$r.releaseId] = @($r.youtubeVideoIds) }
        }
        if ($prevWeek.weekId -match '^(\d{4})-W(\d{2})$') {
            $iy = [int]$Matches[1]; $iw = [int]$Matches[2]
            $j4 = [datetime]::new($iy, 1, 4)
            $dw = [int]$j4.DayOfWeek; if ($dw -eq 0) { $dw = 7 }
            $w1m = $j4.AddDays(1 - $dw)
            $pcm = $w1m.AddDays(7 * ($iw - 1))
        }
    }

    # Deduplicate and attach viewsDelta for this week
    $thisDedup = @(Invoke-DeduplicateCollabs $thisWeek.releases | Where-Object { Test-ReleaseChartEligibility $_ })
    foreach ($r in $thisDedup) {
        $delta = Get-ViewsDelta -release $r -previousViewsMap $pvm -previousVideoIdsMap $pvidm -previousChartMonday $pcm
        $r | Add-Member -NotePropertyName viewsDelta -NotePropertyValue $delta -Force
    }
    $cachedWeekDedup[$wkId] = $thisDedup

    # Pre-filter by genre
    $wkByGenre = @{}
    $prevByGenreW = @{}
    foreach ($genre in $genreFilters) {
        if ($genre -eq 'all') {
            $wkByGenre[$genre] = $thisDedup
            $prevByGenreW[$genre] = $prevDedWithDelta
        } else {
            $wkByGenre[$genre] = @($thisDedup | Where-Object { Test-ArtistGenre $_.bandName $genre })
            $prevByGenreW[$genre] = @($prevDedWithDelta | Where-Object { Test-ArtistGenre $_.bandName $genre })
        }
    }

    # Build ranked charts for all genre/type combos
    $wkCharts = [ordered]@{}
    foreach ($genre in $genreFilters) {
        foreach ($type in $typeFilters) {
            $key = "${genre}_${type}"
            $ranked = Build-ChartRanking -releasesArr $thisWeek.releases -type $type -genre 'all' -count 20 -preDeduped $wkByGenre[$genre]

            # Position change: compare against previous week's chart
            $curSnapW = @{}
            if ($prevDedWithDelta.Count -gt 0) {
                $prevRank = Build-ChartRanking -releasesArr @() -type $type -genre 'all' -count 20 -preDeduped $prevByGenreW[$genre]
                for ($i = 0; $i -lt $prevRank.Count; $i++) {
                    $curSnapW[$prevRank[$i].releaseId] = @{
                        position = $i + 1
                        popularity = [int]($prevRank[$i].popularity -as [int])
                        youtubeViews = [int]($prevRank[$i].youtubeViews -as [int])
                    }
                }
            }
            $wkCharts[$key] = @(Enrich-ChartItems -ranked $ranked -prevMap @{} -curSnapshotMap $curSnapW)
        }
    }

    # Build latest releases per genre
    $wkLatest = [ordered]@{}
    foreach ($genre in $genreFilters) {
        $gf = $wkByGenre[$genre]
        $wkLatest[$genre] = @($gf | Sort-Object { $_.releaseDate } -Descending | Select-Object -First 20 | ForEach-Object {
            $ai = Get-ArtistInfo $_.bandName
            [PSCustomObject]@{
                releaseId            = $_.releaseId
                bandName             = $_.bandName
                artistId             = $_.artistId
                releaseTitle         = $_.releaseTitle
                releaseType          = $_.releaseType
                releaseDate          = $_.releaseDate
                effectiveReleaseDate = $_.effectiveReleaseDate
                releaseUrl           = $_.releaseUrl
                thumbnail            = $_.thumbnail
                totalTracks          = $_.totalTracks
                popularity           = [int]($_.popularity -as [int])
                followers            = [int]($_.followers -as [int])
                youtubeViews         = [int]($_.youtubeViews -as [int])
                viewsDelta           = $_.viewsDelta
                spotifyUrl           = $_.spotifyUrl
                confirmed            = if ($ai) { [bool]$ai.confirmed } else { $false }
            }
        })
    }

    $weeklyChartsComputed[$wkId] = [ordered]@{
        generatedAt    = $thisWeek.generatedAt
        totalReleases  = $thisWeek.totalReleases
        totalArtists   = $thisWeek.totalArtists
        verifiedVideos = $thisWeek.verifiedVideos
        dateRange      = Get-WeekDateRange $wkId
        charts         = $wkCharts
        latestReleases = $wkLatest
    }
}

Write-Host "  > Pre-computed charts for $($allWeekIds.Count) historical weeks" -ForegroundColor DarkGray

# Extract reel charts from the most recent historical week (for reels.html)
$reelChartsData = $null
if ($allWeekIds.Count -gt 0) {
    $latestWeekId = $allWeekIds[$allWeekIds.Count - 1]
    $latestWeekData = $weeklyChartsComputed[$latestWeekId]
    $reelChartsOutput = [ordered]@{}
    foreach ($key in $latestWeekData.charts.Keys | Sort-Object) {
        $reelChartsOutput[$key] = @($latestWeekData.charts[$key])
    }
    $reelChartsData = [PSCustomObject]@{
        weekId      = $latestWeekId
        generatedAt = $latestWeekData.generatedAt
        dateRange   = $latestWeekData.dateRange
        charts      = $reelChartsOutput
    }
    Write-Host "  > Reel charts: $latestWeekId (generated $($latestWeekData.generatedAt))" -ForegroundColor DarkGray
}

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
    $historyWeekDeduped[$w] = @(Invoke-DeduplicateCollabs $chartHistoryWeeks[$w].releases | Where-Object { Test-ReleaseChartEligibility $_ })
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

# Build first-seen baseline: for each release, record its youtubeViews in the earliest
# week where it has non-zero views. Releases often exist with 0 views before their
# YouTube video is confirmed; when confirmed, views jump to the video's full count.
# Subtracting the first non-zero snapshot ensures only genuine weekly growth is used.
$firstSeenViews = @{}  # releaseId -> youtubeViews in first week with views > 0
for ($w = $artistGraphWeekCount - 1; $w -ge 0; $w--) {
    foreach ($r in $chartHistoryWeeks[$w].releases) {
        $views = [int]($r.youtubeViews -as [int])
        if ($views -gt 0 -and -not $firstSeenViews.ContainsKey($r.releaseId)) {
            $firstSeenViews[$r.releaseId] = $views
        }
    }
}

for ($w = 0; $w -lt $artistGraphWeekCount; $w++) {
    $weekData = $chartHistoryWeeks[$w]
    $weekId = $weekData.weekId
    $weekReleases = @(Invoke-DeduplicateCollabs $weekData.releases | Where-Object { Test-ReleaseChartEligibility $_ })
    
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
            $artistWeekPop[$key] += [Math]::Max(0, [int]($r.youtubeViews -as [int]) - $firstSeenViews[$r.releaseId])
            
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

$deduped = $liveMainReleasesDeduped
$allTimeArtistsByGenre = @{}  # genre -> array of top 100 artists

foreach ($genre in $genreFilters) {
    $artistViewsMap = @{}  # artistKey(lower) -> { bandName, totalViews, totalDelta, followers, spotifyUrl, thumbnail }
    # Use pre-filtered genre data
    $genreDeduped = $liveByGenre[$genre]
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
    $genreFiltered = $liveByGenre[$genre]
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
$hotSongReferenceDate = (Get-Date).Date
$hotSongChartCutoff = $hotSongReferenceDate.AddDays(-(4 * 7)).ToString('yyyy-MM-dd')
$chartHotExclusionIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
if ($charts.ContainsKey('all_single')) {
    foreach ($entry in $charts['all_single']) {
        if ($entry.releaseId) {
            [void]$chartHotExclusionIds.Add([string]$entry.releaseId)
        }
    }
}
$hotSongCandidates = [System.Collections.ArrayList]::new()

for ($i = 0; $i -lt $currentRanked.Count; $i++) {
    $r = $currentRanked[$i]
    $viewsDelta = [int]($r.viewsDelta -as [int])
    if ($viewsDelta -le 0) { continue }

    $releaseDateStr = Get-ReleaseEffectiveDateString $r
    $isChartWindowSingle = $false
    if ($releaseDateStr -and $releaseDateStr -ge $hotSongChartCutoff) {
        $isChartWindowSingle = $true
    }
    if ($chartHotExclusionIds.Contains([string]$r.releaseId) -or $isChartWindowSingle) {
        continue
    }

    $artistInfo = Get-ArtistInfo $r.bandName
    $ageDays = Get-ReleaseAgeDays $r $hotSongReferenceDate
    $recencyMultiplier = Get-HotSongRecencyMultiplier $ageDays
    $hotScore = Get-HotSongScore $viewsDelta $ageDays
    $genreBuckets = Get-HotSongGenreBuckets $r.bandName

    [void]$hotSongCandidates.Add([PSCustomObject]@{
        releaseId          = $r.releaseId
        bandName           = $r.bandName
        releaseTitle       = $r.releaseTitle
        releaseUrl         = $r.releaseUrl
        thumbnail          = $r.thumbnail
        youtubeViews       = [int]($r.youtubeViews -as [int])
        viewsDelta         = $viewsDelta
        popularityChange   = $viewsDelta
        confirmed          = if ($artistInfo) { [bool]$artistInfo.confirmed } else { $false }
        releaseDate        = $r.releaseDate
        effectiveReleaseDate = $releaseDateStr
        ageDays            = $ageDays
        recencyMultiplier  = [math]::Round($recencyMultiplier, 2)
        hotScore           = [math]::Round($hotScore, 4)
        genreBuckets       = @($genreBuckets)
    })
}

$hotSongsAll = @($hotSongCandidates | Sort-Object @(
    @{ Expression = { [double]$_.hotScore }; Descending = $true },
    @{ Expression = { [int]($_.viewsDelta -as [int]) }; Descending = $true },
    @{ Expression = { [int]($_.youtubeViews -as [int]) }; Descending = $true },
    @{ Expression = { Get-ReleaseEffectiveDateString $_ }; Descending = $true },
    @{ Expression = { $_.bandName } }
))

$hotSongArtistCounts = @{}
$hotSongGenreCounts = @{}

$remainingHotSongs = [System.Collections.ArrayList]::new()
foreach ($candidate in $hotSongsAll) {
    [void]$remainingHotSongs.Add($candidate)
}

$hotSongs = [System.Collections.ArrayList]::new()
while ($hotSongs.Count -lt 100 -and $remainingHotSongs.Count -gt 0) {
    $bestIndex = -1
    $bestAdjustedScore = [double]::NegativeInfinity
    $bestHotScore = [double]::NegativeInfinity
    $bestViewsDelta = -1
    $bestYoutubeViews = -1
    $bestDateKey = ''
    $bestBandName = ''

    for ($i = 0; $i -lt $remainingHotSongs.Count; $i++) {
        $candidate = $remainingHotSongs[$i]
        $artistKey = $candidate.bandName.ToLower().Trim()
        $artistCount = if ($hotSongArtistCounts.ContainsKey($artistKey)) { [int]$hotSongArtistCounts[$artistKey] } else { 0 }
        if ($artistCount -ge 2) { continue }

        $selectionMeta = Get-HotSongSelectionMeta $candidate $hotSongGenreCounts
        $adjustedScore = [double]$selectionMeta.adjustedScore
        $candidateHotScore = [double]$candidate.hotScore
        $candidateViewsDelta = [int]($candidate.viewsDelta -as [int])
        $candidateYoutubeViews = [int]($candidate.youtubeViews -as [int])
        $candidateDateKey = [string](Get-ReleaseEffectiveDateString $candidate)
        $candidateBandName = [string]$candidate.bandName

        $isBetter = $false
        if ($adjustedScore -gt $bestAdjustedScore) {
            $isBetter = $true
        } elseif ($adjustedScore -eq $bestAdjustedScore) {
            if ($candidateHotScore -gt $bestHotScore) {
                $isBetter = $true
            } elseif ($candidateHotScore -eq $bestHotScore) {
                if ($candidateViewsDelta -gt $bestViewsDelta) {
                    $isBetter = $true
                } elseif ($candidateViewsDelta -eq $bestViewsDelta) {
                    if ($candidateYoutubeViews -gt $bestYoutubeViews) {
                        $isBetter = $true
                    } elseif ($candidateYoutubeViews -eq $bestYoutubeViews) {
                        if ($candidateDateKey -gt $bestDateKey) {
                            $isBetter = $true
                        } elseif ($candidateDateKey -eq $bestDateKey -and $candidateBandName -lt $bestBandName) {
                            $isBetter = $true
                        }
                    }
                }
            }
        }

        if ($isBetter) {
            $bestIndex = $i
            $bestAdjustedScore = $adjustedScore
            $bestHotScore = $candidateHotScore
            $bestViewsDelta = $candidateViewsDelta
            $bestYoutubeViews = $candidateYoutubeViews
            $bestDateKey = $candidateDateKey
            $bestBandName = $candidateBandName
        }
    }

    if ($bestIndex -lt 0) { break }

    $picked = $remainingHotSongs[$bestIndex]
    [void]$hotSongs.Add($picked)

    $artistKey = $picked.bandName.ToLower().Trim()
    if (-not $hotSongArtistCounts.ContainsKey($artistKey)) {
        $hotSongArtistCounts[$artistKey] = 0
    }
    $hotSongArtistCounts[$artistKey] = [int]$hotSongArtistCounts[$artistKey] + 1

    $pickedBuckets = @(Get-HotSongBalanceBuckets $picked.genreBuckets)
    if ($pickedBuckets.Count -eq 0) {
        $pickedBuckets = @('other')
    }
    foreach ($bucket in $pickedBuckets) {
        if (-not $hotSongGenreCounts.ContainsKey($bucket)) {
            $hotSongGenreCounts[$bucket] = 0
        }
        $hotSongGenreCounts[$bucket] = [int]$hotSongGenreCounts[$bucket] + 1
    }

    $remainingHotSongs.RemoveAt($bestIndex)
}

$hotSongGenreMultiplierMap = Get-HotSongGenreMultiplierMap @($hotSongs)
foreach ($picked in @($hotSongs)) {
    $balanceMeta = Get-HotSongBalanceMeta $picked $hotSongGenreMultiplierMap
    $picked | Add-Member -NotePropertyName genreBucket -NotePropertyValue $balanceMeta.genreBucket -Force
    $picked | Add-Member -NotePropertyName diversityPenaltyFactor -NotePropertyValue $balanceMeta.penaltyFactor -Force
    $picked | Add-Member -NotePropertyName adjustedHotScore -NotePropertyValue $balanceMeta.adjustedHotScore -Force
}

# Serialize hot songs in their final display order so the index page can page them
# directly from site-master without re-sorting in the browser.
$hotSongs = @($hotSongs | Sort-Object @(
    @{ Expression = { [double]($_.adjustedHotScore -as [double]) }; Descending = $true },
    @{ Expression = { [double]($_.hotScore -as [double]) }; Descending = $true },
    @{ Expression = { [int]($_.viewsDelta -as [int]) }; Descending = $true },
    @{ Expression = { [int]($_.youtubeViews -as [int]) }; Descending = $true },
    @{ Expression = { [string](Get-ReleaseEffectiveDateString $_) }; Descending = $true },
    @{ Expression = { [string]$_.bandName } }
))

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

$now = Get-Date

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

# Build and pre-compile artist name patterns for news (original exact-name behavior)
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

# Build and pre-compile artist name variants for interviews (Cyrillic + transliterated)
$cyrToLatPairs = @(
    @('А', 'A'), @('а', 'a'), @('Б', 'B'), @('б', 'b'), @('В', 'V'), @('в', 'v'), @('Г', 'G'), @('г', 'g'),
    @('Д', 'D'), @('д', 'd'), @('Ѓ', 'Gj'), @('ѓ', 'gj'), @('Е', 'E'), @('е', 'e'), @('Ж', 'Zh'), @('ж', 'zh'),
    @('З', 'Z'), @('з', 'z'), @('Ѕ', 'Dz'), @('ѕ', 'dz'), @('И', 'I'), @('и', 'i'), @('Ј', 'J'), @('ј', 'j'),
    @('К', 'K'), @('к', 'k'), @('Л', 'L'), @('л', 'l'), @('Љ', 'Lj'), @('љ', 'lj'), @('М', 'M'), @('м', 'm'),
    @('Н', 'N'), @('н', 'n'), @('Њ', 'Nj'), @('њ', 'nj'), @('О', 'O'), @('о', 'o'), @('П', 'P'), @('п', 'p'),
    @('Р', 'R'), @('р', 'r'), @('С', 'S'), @('с', 's'), @('Т', 'T'), @('т', 't'), @('Ќ', 'Kj'), @('ќ', 'kj'),
    @('У', 'U'), @('у', 'u'), @('Ф', 'F'), @('ф', 'f'), @('Х', 'H'), @('х', 'h'), @('Ц', 'C'), @('ц', 'c'),
    @('Ч', 'Ch'), @('ч', 'ch'), @('Џ', 'Dz'), @('џ', 'dz'), @('Ш', 'Sh'), @('ш', 'sh'),
    @('Ђ', 'Dj'), @('ђ', 'dj'), @('Ћ', 'C'), @('ћ', 'c'),
    @('Я', 'Ya'), @('я', 'ya'), @('Ю', 'Yu'), @('ю', 'yu'), @('Щ', 'Sht'), @('щ', 'sht'), @('Ъ', 'A'), @('ъ', 'a'),
    @('Ь', ''), @('ь', ''), @('Э', 'E'), @('э', 'e'), @('Ы', 'I'), @('ы', 'i'), @('Й', 'J'), @('й', 'j')
)

$cyrToLatMap = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::Ordinal)
foreach ($pair in $cyrToLatPairs) {
    $cyrToLatMap[$pair[0]] = $pair[1]
}

function Convert-CyrillicToLatin {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }

    $builder = New-Object System.Text.StringBuilder
    foreach ($char in $text.ToCharArray()) {
        $key = [string]$char
        if ($cyrToLatMap.ContainsKey($key)) {
            [void]$builder.Append($cyrToLatMap[$key])
        } else {
            [void]$builder.Append($key)
        }
    }
    return $builder.ToString()
}

function Convert-ToSimplifiedLatin {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }

    return ($text -replace 'dzh', 'z' -replace 'dz', 'z' -replace 'sh', 's' -replace 'ch', 'c' -replace 'zh', 'z' -replace 'lj', 'l' -replace 'nj', 'n' -replace 'gj', 'g' -replace 'kj', 'k' -replace 'dj', 'd' -replace 'sht', 'st')
}

function Get-ArtistMatchVariants {
    param($band)

    $variants = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in @($band.name, $band.spotifyName, (Convert-CyrillicToLatin $band.name), (Convert-ToSimplifiedLatin (Convert-CyrillicToLatin $band.name)), (Convert-ToSimplifiedLatin $band.spotifyName))) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $trimmed = $candidate.Trim()
            if ($trimmed.Length -gt 2) {
                [void]$variants.Add($trimmed)
            }
        }
    }
    return @($variants)
}

function Normalize-MatchKey {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    return ((($text.ToLower() -replace '[^\p{L}\p{N}]', ' ') -replace '\s+', ' ').Trim())
}

$variantToArtists = @{}
$tokenToVariants = @{}
foreach ($b in $bandsData) {
    if ($b.name) {
        $variants = @(Get-ArtistMatchVariants $b)
        if ($variants.Count -gt 0) {
            foreach ($variant in $variants) {
                $key = Normalize-MatchKey $variant
                if ([string]::IsNullOrWhiteSpace($key)) {
                    continue
                }

                if (-not $variantToArtists.ContainsKey($key)) {
                    $variantToArtists[$key] = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
                    $tokens = @($key -split ' ' | Where-Object { $_ })
                    if ($tokens.Count -gt 0) {
                        $anchorToken = @($tokens | Sort-Object Length -Descending | Select-Object -First 1)[0]
                        if (-not $tokenToVariants.ContainsKey($anchorToken)) {
                            $tokenToVariants[$anchorToken] = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
                        }
                        [void]$tokenToVariants[$anchorToken].Add($key)
                    }
                }

                [void]$variantToArtists[$key].Add($b.name)
            }
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

function Get-NewsMatchedArtists {
    param([string]$haystack)
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

function Get-NewsArtistMatches {
    param([string]$title, [string]$description)

    $titleMatches = Get-NewsMatchedArtists $title
    $descriptionMatches = [System.Collections.ArrayList]@()

    if (-not [string]::IsNullOrWhiteSpace($description)) {
        $seenTitleArtists = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($artistName in $titleMatches) {
            if (-not [string]::IsNullOrWhiteSpace($artistName)) {
                [void]$seenTitleArtists.Add($artistName)
            }
        }

        foreach ($artistName in (Get-NewsMatchedArtists $description)) {
            if ($seenTitleArtists.Contains($artistName)) {
                continue
            }

            if (-not $descriptionMatches.Contains($artistName)) {
                [void]$descriptionMatches.Add($artistName)
            }
        }
    }

    return [PSCustomObject]@{
        titleMatches       = $titleMatches
        descriptionMatches = $descriptionMatches
    }
}

function Get-InterviewMatchedArtists {
    param([string]$haystack)
    $matched = [System.Collections.ArrayList]@()

    if ($variantToArtists.Count -eq 0) {
        return ,$matched
    }

    $normalizedHaystack = Normalize-MatchKey $haystack
    if ([string]::IsNullOrWhiteSpace($normalizedHaystack)) {
        return ,$matched
    }

    $paddedHaystack = " $normalizedHaystack "
    $tokens = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($token in ($normalizedHaystack -split ' ')) {
        if (-not [string]::IsNullOrWhiteSpace($token)) {
            [void]$tokens.Add($token)
        }
    }

    $checkedVariants = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $seenArtists = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($token in $tokens) {
        if (-not $tokenToVariants.ContainsKey($token)) {
            continue
        }

        foreach ($variantKey in $tokenToVariants[$token]) {
            if (-not $checkedVariants.Add($variantKey)) {
                continue
            }

            if (-not $paddedHaystack.Contains(" $variantKey ")) {
                continue
            }

            foreach ($artistName in $variantToArtists[$variantKey]) {
                if ($seenArtists.Add($artistName)) {
                    [void]$matched.Add($artistName)
                }
            }
        }
    }

    return ,$matched
}

function Get-InterviewArtistMatches {
    param([string]$title, [string]$description)

    $titleMatches = Get-InterviewMatchedArtists $title
    $descriptionMatches = [System.Collections.ArrayList]@()

    if (-not [string]::IsNullOrWhiteSpace($description)) {
        $seenTitleArtists = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($artistName in $titleMatches) {
            if (-not [string]::IsNullOrWhiteSpace($artistName)) {
                [void]$seenTitleArtists.Add($artistName)
            }
        }

        foreach ($artistName in (Get-InterviewMatchedArtists $description)) {
            if ($seenTitleArtists.Contains($artistName)) {
                continue
            }

            if (-not $descriptionMatches.Contains($artistName)) {
                [void]$descriptionMatches.Add($artistName)
            }
        }
    }

    return [PSCustomObject]@{
        titleMatches       = $titleMatches
        descriptionMatches = $descriptionMatches
    }
}

function Get-MatchedNewsItems {
    param($items)

    $matchedItems = [System.Collections.ArrayList]::new()
    $mentionedItems = [System.Collections.ArrayList]::new()

    foreach ($item in $items) {
        if (Test-ArticleBlacklist $item.title $item.description) {
            continue
        }

        $artistMatches = Get-NewsArtistMatches $item.title $item.description
        $titleArtists = $artistMatches.titleMatches
        $descriptionArtists = $artistMatches.descriptionMatches

        if ($titleArtists.Count -gt 0) {
            [void]$matchedItems.Add([PSCustomObject]@{
                title          = $item.title
                link           = $item.link
                description    = $item.description
                date           = $item.date
                source         = $item.source
                siteUrl        = $item.siteUrl
                iconUrl        = $item.iconUrl
                thumbnail      = $item.thumbnail
                matchedArtists = $titleArtists
            })
        }

        if ($descriptionArtists.Count -gt 0) {
            [void]$mentionedItems.Add([PSCustomObject]@{
                title          = $item.title
                link           = $item.link
                description    = $item.description
                date           = $item.date
                source         = $item.source
                siteUrl        = $item.siteUrl
                iconUrl        = $item.iconUrl
                thumbnail      = $item.thumbnail
                matchedArtists = $descriptionArtists
            })
        }
    }

    return [PSCustomObject]@{
        matched   = @($matchedItems | Sort-Object { $_.date } -Descending)
        mentioned = @($mentionedItems | Sort-Object { $_.date } -Descending)
    }
}

function Get-MatchedInterviewItems {
    param($items)

    $matchedItems = [System.Collections.ArrayList]::new()
    $mentionedItems = [System.Collections.ArrayList]::new()

    foreach ($item in $items) {
        if (Test-ArticleBlacklist $item.title $item.description) {
            continue
        }

        $artistMatches = Get-InterviewArtistMatches $item.title $item.description
        $titleArtists = $artistMatches.titleMatches
        $descriptionArtists = $artistMatches.descriptionMatches

        if ($titleArtists.Count -gt 0) {
            [void]$matchedItems.Add([PSCustomObject]@{
                title          = $item.title
                link           = $item.link
                description    = $item.description
                date           = $item.date
                source         = $item.source
                siteUrl        = $item.siteUrl
                iconUrl        = $item.iconUrl
                thumbnail      = $item.thumbnail
                shortForm      = ($item.shortForm -eq $true)
                matchedArtists = $titleArtists
            })
        }

        if ($descriptionArtists.Count -gt 0) {
            [void]$mentionedItems.Add([PSCustomObject]@{
                title          = $item.title
                link           = $item.link
                description    = $item.description
                date           = $item.date
                source         = $item.source
                siteUrl        = $item.siteUrl
                iconUrl        = $item.iconUrl
                thumbnail      = $item.thumbnail
                shortForm      = ($item.shortForm -eq $true)
                matchedArtists = $descriptionArtists
            })
        }
    }

    return [PSCustomObject]@{
        matched   = @($matchedItems | Sort-Object { $_.date } -Descending)
        mentioned = @($mentionedItems | Sort-Object { $_.date } -Descending)
    }
}

# Process all articles: filter by blacklist, then match artists
$matchedNewsData = Get-MatchedNewsItems $allArticles
$matchedArticles = @($matchedNewsData.matched)
$mentionedArticles = @($matchedNewsData.mentioned)
$matchedInterviewData = Get-MatchedInterviewItems $allInterviews
$matchedInterviews = @($matchedInterviewData.matched)
$mentionedInterviews = @($matchedInterviewData.mentioned)

Write-Host "  > Filtered articles: $($matchedArticles.Count) matched artists" -ForegroundColor DarkGray
Write-Host "  > Article mentions: $($mentionedArticles.Count) matched artists" -ForegroundColor DarkGray
Write-Host "  > Filtered interviews: $($matchedInterviews.Count) matched artists" -ForegroundColor DarkGray
Write-Host "  > Description mentions: $($mentionedInterviews.Count) matched artists" -ForegroundColor DarkGray

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
    $weekReleases = @(Invoke-DeduplicateCollabs $weekData.releases | Where-Object { Test-ReleaseChartEligibility $_ })
    foreach ($r in $weekReleases) {
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
$strippedReleases = @($chartDataOutputReleases | ForEach-Object {
    $props = [ordered]@{}
    foreach ($p in $_.PSObject.Properties) {
        # Skip unused fields
        if ($p.Name.StartsWith('_') -or $p.Name -in @('topTrackName', 'topTrackId', 'topTrackUrl', 'spotifyPopularity', 'youtubeVideoIds')) { continue }
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
$advChartsPath = Join-Path $generatedDataRoot "advanced-charts.json"
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
$artistDataPath = Join-Path $generatedDataRoot "artist-data.json"
[System.IO.File]::WriteAllText($artistDataPath, $artistDataJson, $utf8NoBom)
Write-Host "  > Wrote artist-data.json ($([math]::Round((Get-Item $artistDataPath).Length / 1024, 1)) KB)" -ForegroundColor DarkGray

# chart-history-data.json — pre-computed charts per historical week (loaded by charts.html week navigator)
$chartHistoryDataValue = [PSCustomObject]@{
    weeks = @($allWeekIds)
    data = $weeklyChartsComputed
}
$chartHistoryDataJson = $chartHistoryDataValue | ConvertTo-Json -Depth 15 -Compress
$chartHistoryDataPath = Join-Path $generatedDataRoot "chart-history-data.json"
[System.IO.File]::WriteAllText($chartHistoryDataPath, $chartHistoryDataJson, $utf8NoBom)
Write-Host "  > Wrote chart-history-data.json ($([math]::Round((Get-Item $chartHistoryDataPath).Length / 1024, 1)) KB)" -ForegroundColor DarkGray

$siteMaster = [PSCustomObject]@{
    generatedAt = $chartJson.generatedAt
    
    # Chart data (stripped of unused fields, releases in columnar format)
    chartData = [PSCustomObject]@{
        generatedAt   = $chartJson.generatedAt
        totalReleases = $chartJson.totalReleases
        totalArtists  = $chartJson.totalArtists
        baselineWeekId = if ($deltaBaselineWeek) { $deltaBaselineWeek.weekId } else { $null }
        displayWeekId = $currentDisplayWeekId
        isFrozenFallback = $usingFrozenChartState
        releases      = $columnarReleases
    }
    
    # Pre-ranked charts: keys like "all_single", "alt_album", etc.
    charts = $chartsOutput
    
    # Reel charts: last week's chart from most recent chart-history (for reels.html)
    reelCharts = $reelChartsData
    
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
    
    # Release radar (latest 10)
    releaseRadar = $releaseRadar
    
    # Precomputed release stats (avoids loading releases.json on index page)
    releaseStats = $releaseStats
    
    # Filtered news articles (matched against artist names, blacklist applied)
    news = [PSCustomObject]@{
        lastUpdated    = $articlesJson.lastUpdated
        matched        = $matchedArticles
        mentioned      = $mentionedArticles
    }

    # Filtered interview videos (matched against artist names, blacklist applied)
    interviews = [PSCustomObject]@{
        lastUpdated    = if ($interviewsJson) { $interviewsJson.lastUpdated } else { $null }
        matched        = $matchedInterviews
        mentioned      = $mentionedInterviews
    }
    
    # Header collage thumbnails (top 20 singles thumbnails)
    headerThumbs = $headerThumbs
}

# Write to file
$outputPath = Join-Path $generatedDataRoot "site-master.json"
$json = $siteMaster | ConvertTo-Json -Depth 15 -Compress
[System.IO.File]::WriteAllText($outputPath, $json, $utf8NoBom)

$fileSize = [Math]::Round((Get-Item $outputPath).Length / 1KB, 1)
$elapsed = [Math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

Write-Host ""
Write-Host "  > site-master.json generated successfully!" -ForegroundColor Green
Write-Host "  > Size: ${fileSize} KB" -ForegroundColor DarkGray
Write-Host "  > Completed in ${elapsed}s" -ForegroundColor DarkGray
Write-Host ""
