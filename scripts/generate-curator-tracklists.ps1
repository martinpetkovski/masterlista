# generate-curator-tracklists.ps1
# Generates tracklist data from curator playlists via web scraping (no API keys needed)
# Supported: Spotify, Deezer, YouTube Music, Apple Music, Tidal, SoundCloud
#
# Usage:
#   ./scripts/generate-curator-tracklists.ps1
#
# Reads: curators.json
# Writes: curators-tracklists.json
# Note: All services use public embed/widget pages — zero API keys required

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$curatorsPath = Join-Path $projectRoot "curators.json"
$outputPath = Join-Path $projectRoot "curators-tracklists.json"

# ============================================================================
#  UTILITY
# ============================================================================

function Write-Step {
    param([string]$Message, [string]$Color = "Yellow")
    Write-Host "  > $Message" -ForegroundColor $Color
}

function Format-Duration {
    param([int]$Ms)
    $totalSeconds = [math]::Floor($Ms / 1000)
    $minutes = [math]::Floor($totalSeconds / 60)
    $seconds = $totalSeconds % 60
    return "${minutes}:$($seconds.ToString('00'))"
}

$script:defaultHeaders = @{
    "User-Agent"      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    "Accept"          = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    "Accept-Language" = "en-US,en;q=0.9"
}

function Invoke-WebRequestSafe {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [int]$Retries = 3,
        [int]$RetryDelaySec = 2,
        [switch]$SkipRateLimitWait
    )
    for ($i = 0; $i -lt $Retries; $i++) {
        try {
            $response = Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec 15
            return $response
        }
        catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 429) {
                $retryAfter = 5
                try { $retryAfter = [int]$_.Exception.Response.Headers["Retry-After"] } catch {}
                if ($SkipRateLimitWait) {
                    Write-Step "Rate limited (429), skipping immediately (no wait mode)" "DarkYellow"
                    return $null
                }
                Write-Step "Rate limited, waiting ${retryAfter}s..." "DarkYellow"
                Start-Sleep -Seconds $retryAfter
                continue
            }
            if ($i -lt $Retries - 1) {
                Write-Step "Request failed ($statusCode), retrying in ${RetryDelaySec}s..." "DarkYellow"
                Start-Sleep -Seconds $RetryDelaySec
                continue
            }
            throw
        }
    }
}

function Invoke-PageRequest {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [int]$Retries = 3,
        [int]$RetryDelaySec = 2
    )
    $mergedHeaders = $script:defaultHeaders.Clone()
    foreach ($k in $Headers.Keys) { $mergedHeaders[$k] = $Headers[$k] }
    for ($i = 0; $i -lt $Retries; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 20 -Headers $mergedHeaders
            return $resp.Content
        }
        catch {
            if ($i -lt $Retries - 1) {
                Start-Sleep -Seconds $RetryDelaySec
                continue
            }
            throw
        }
    }
}

function ConvertTo-JsonSafe {
    param([string]$JsonText)
    if (-not $JsonText) { return $null }
    try {
        return $JsonText | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-JsonObjectAfterMarker {
    param(
        [string]$Text,
        [string]$Marker
    )

    if (-not $Text -or -not $Marker) { return $null }

    $markerIndex = $Text.IndexOf($Marker)
    if ($markerIndex -lt 0) { return $null }

    $start = $Text.IndexOf('{', $markerIndex + $Marker.Length)
    if ($start -lt 0) { return $null }

    return Get-JsonObjectAtIndex -Text $Text -StartIndex $start
}

function Get-JsonObjectAtIndex {
    param(
        [string]$Text,
        [int]$StartIndex
    )

    if (-not $Text) { return $null }
    if ($StartIndex -lt 0 -or $StartIndex -ge $Text.Length) { return $null }

    $start = $StartIndex
    if ($start -lt 0) { return $null }

    $depth = 0
    $inString = $false
    $escaped = $false

    for ($i = $start; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]

        if ($inString) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($ch -eq '\') {
                $escaped = $true
                continue
            }
            if ($ch -eq '"') {
                $inString = $false
            }
            continue
        }

        if ($ch -eq '"') {
            $inString = $true
            continue
        }

        if ($ch -eq '{') {
            $depth++
            continue
        }

        if ($ch -eq '}') {
            $depth--
            if ($depth -eq 0) {
                return $Text.Substring($start, ($i - $start + 1))
            }
        }
    }

    return $null
}

function Get-YouTubeRenderersFromHtml {
    param([string]$Html)

    $renderers = @()
    $marker = '"playlistVideoRenderer":'
    $offset = 0

    while ($true) {
        $idx = $Html.IndexOf($marker, $offset, [System.StringComparison]::Ordinal)
        if ($idx -lt 0) { break }

        $objStart = $Html.IndexOf('{', $idx + $marker.Length)
        if ($objStart -lt 0) { break }

        $objJson = Get-JsonObjectAtIndex -Text $Html -StartIndex $objStart
        if ($objJson) {
            $obj = ConvertTo-JsonSafe -JsonText $objJson
            if ($obj) {
                $renderers += $obj
            }
            $offset = $objStart + $objJson.Length
        }
        else {
            $offset = $idx + $marker.Length
        }

        if ($renderers.Count -ge 500) { break }
    }

    return @($renderers)
}

function Find-PlaylistVideoRenderers {
    param($Node)

    $found = New-Object System.Collections.Generic.List[object]

    function Traverse {
        param($Current)

        if ($null -eq $Current) { return }

        if ($Current -is [System.Collections.IDictionary]) {
            if ($Current.Contains("playlistVideoRenderer")) {
                $found.Add($Current.playlistVideoRenderer)
            }
            foreach ($key in $Current.Keys) {
                Traverse -Current $Current[$key]
            }
            return
        }

        if ($Current -is [System.Management.Automation.PSObject]) {
            $videoProp = $Current.PSObject.Properties.Match("playlistVideoRenderer") | Select-Object -First 1
            if ($videoProp -and $videoProp.Value) {
                $found.Add($videoProp.Value)
            }
            foreach ($prop in $Current.PSObject.Properties) {
                Traverse -Current $prop.Value
            }
            return
        }

        if ($Current -is [System.Collections.IEnumerable] -and -not ($Current -is [string])) {
            foreach ($item in $Current) {
                Traverse -Current $item
            }
        }
    }

    Traverse -Current $Node
    return @($found)
}

# ============================================================================
#  SPOTIFY — scrape embed page for anonymous token, then fetch via v1 API
# ============================================================================

function Get-SpotifyPlaylistTracks {
    param([string]$PlaylistId)

    try {
        $embedHtml = Invoke-PageRequest -Uri "https://open.spotify.com/embed/playlist/$PlaylistId"
    }
    catch {
        Write-Step "Failed to fetch Spotify embed page: $($_.Exception.Message)" "Red"
        return $null
    }

    $accessToken = $null
    if ($embedHtml -match '"accessToken"\s*:\s*"([^"]+)"') {
        $accessToken = $Matches[1]
    }
    if (-not $accessToken) {
        Write-Step "Could not extract access token from Spotify embed" "Red"
        return $null
    }
    Write-Step "  Spotify embed token obtained" "Green"

    $headers = @{
        "Authorization" = "Bearer $accessToken"
        "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    try {
        $playlist = Invoke-WebRequestSafe -Uri "https://api.spotify.com/v1/playlists/$PlaylistId" -Headers $headers -SkipRateLimitWait
    }
    catch {
        Write-Step "Failed to fetch Spotify playlist data: $($_.Exception.Message)" "Red"
        return $null
    }
    if (-not $playlist) {
        Write-Step "Spotify playlist request was rate-limited; skipping without waiting" "DarkYellow"
        return $null
    }

    $playlistName = $playlist.name
    $playlistImage = if ($playlist.images -and $playlist.images.Count -gt 0) { $playlist.images[0].url } else { $null }
    $totalTracks = $playlist.tracks.total
    Write-Step "  Spotify playlist: $playlistName ($totalTracks tracks)"

    $tracks = @()

    foreach ($item in $playlist.tracks.items) {
        $track = $item.track
        if (-not $track -or -not $track.name) { continue }
        $artistNames = ($track.artists | ForEach-Object { $_.name }) -join ", "
        $albumName = if ($track.album) { $track.album.name } else { "" }
        $trackImage = if ($track.album -and $track.album.images -and $track.album.images.Count -gt 0) {
            ($track.album.images | Sort-Object { if ($_.width) { $_.width } else { 9999 } } | Select-Object -First 1).url
        } else { $null }
        $trackUrl = if ($track.external_urls -and $track.external_urls.spotify) { $track.external_urls.spotify } else { $null }
        $tracks += @{
            title = $track.name; artist = $artistNames; album = $albumName
            durationMs = $track.duration_ms; duration = Format-Duration $track.duration_ms
            previewUrl = $track.preview_url; trackUrl = $trackUrl; image = $trackImage; trackId = $track.id
        }
    }

    # Paginate remaining tracks
    $nextUrl = $playlist.tracks.next
    while ($nextUrl) {
        try { $page = Invoke-WebRequestSafe -Uri $nextUrl -Headers $headers -SkipRateLimitWait } catch { break }
        if (-not $page) {
            Write-Step "  Spotify pagination rate-limited; stopping further pages" "DarkYellow"
            break
        }
        foreach ($item in $page.items) {
            $track = $item.track
            if (-not $track -or -not $track.name) { continue }
            $artistNames = ($track.artists | ForEach-Object { $_.name }) -join ", "
            $albumName = if ($track.album) { $track.album.name } else { "" }
            $trackImage = if ($track.album -and $track.album.images -and $track.album.images.Count -gt 0) {
                ($track.album.images | Sort-Object { if ($_.width) { $_.width } else { 9999 } } | Select-Object -First 1).url
            } else { $null }
            $trackUrl = if ($track.external_urls -and $track.external_urls.spotify) { $track.external_urls.spotify } else { $null }
            $tracks += @{
                title = $track.name; artist = $artistNames; album = $albumName
                durationMs = $track.duration_ms; duration = Format-Duration $track.duration_ms
                previewUrl = $track.preview_url; trackUrl = $trackUrl; image = $trackImage; trackId = $track.id
            }
        }
        $nextUrl = $page.next
    }

    # Fill missing preview URLs via Deezer search (Spotify often returns null previews)
    $missingCount = ($tracks | Where-Object { -not $_.previewUrl }).Count
    if ($missingCount -gt 0) {
        Write-Step "  $missingCount tracks missing previews, searching Deezer..." "DarkYellow"
        $found = 0
        foreach ($t in $tracks) {
            if ($t.previewUrl) { continue }
            try {
                $q = "$($t.artist) $($t.title)" -replace '[^\w\s]', '' -replace '\s+', ' '
                $searchUrl = "https://api.deezer.com/search?q=" + [Uri]::EscapeDataString($q) + "&limit=3"
                $sr = Invoke-WebRequestSafe -Uri $searchUrl -Retries 2
                if ($sr.data -and $sr.data.Count -gt 0) {
                    $best = $sr.data[0]
                    if ($best.preview) {
                        $t.previewUrl = $best.preview
                        $found++
                    }
                }
                Start-Sleep -Milliseconds 250
            }
            catch { <# skip silently #> }
        }
        Write-Step "  Found Deezer previews for $found/$missingCount tracks" "Green"
    }

    return @{ url = "https://open.spotify.com/playlist/$PlaylistId"; service = "spotify"; name = $playlistName; image = $playlistImage; tracks = $tracks }
}

# ============================================================================
#  DEEZER — scrape widget page, fallback to public API (no key needed)
# ============================================================================

function Get-DeezerPlaylistTracks {
    param([string]$PlaylistId)

    # Deezer's public API is free and keyless — use it directly (it's not a rate-limited developer API)
    try {
        $playlist = Invoke-WebRequestSafe -Uri "https://api.deezer.com/playlist/$PlaylistId"
    }
    catch {
        Write-Step "Failed to fetch Deezer playlist: $($_.Exception.Message)" "Red"
        return $null
    }

    if ($playlist.error) {
        Write-Step "Deezer error: $($playlist.error.message)" "Red"
        return $null
    }

    $playlistName = $playlist.title
    $playlistImage = $playlist.picture_medium
    $totalTracks = $playlist.nb_tracks
    Write-Step "  Deezer playlist: $playlistName ($totalTracks tracks)"

    $tracks = @()
    $nextUrl = "https://api.deezer.com/playlist/$PlaylistId/tracks?limit=100"
    while ($nextUrl) {
        try { $page = Invoke-WebRequestSafe -Uri $nextUrl } catch { break }
        foreach ($t in $page.data) {
            if (-not $t -or -not $t.title) { continue }
            $tracks += @{
                title      = $t.title
                artist     = if ($t.artist) { $t.artist.name } else { "" }
                album      = if ($t.album) { $t.album.title } else { "" }
                durationMs = $t.duration * 1000
                duration   = Format-Duration ($t.duration * 1000)
                previewUrl = $t.preview
                trackUrl   = $t.link
                image      = if ($t.album -and $t.album.cover_small) { $t.album.cover_small } else { $null }
                trackId    = [string]$t.id
            }
        }
        $nextUrl = $page.next
    }

    return @{ url = "https://www.deezer.com/playlist/$PlaylistId"; service = "deezer"; name = $playlistName; image = $playlistImage; tracks = $tracks }
}

# ============================================================================
#  YOUTUBE / YOUTUBE MUSIC — scrape the playlist page
# ============================================================================

function Get-YouTubePlaylistTracks {
    param([string]$PlaylistId)

    try {
        $html = Invoke-PageRequest -Uri "https://www.youtube.com/playlist?list=$PlaylistId"
    }
    catch {
        Write-Step "Failed to fetch YouTube playlist page: $($_.Exception.Message)" "Red"
        return @{
            url = "https://music.youtube.com/playlist?list=$PlaylistId"; service = "youtube"
            name = "YouTube Playlist"; image = $null; tracks = @()
        }
    }

    # YouTube embeds playlist data in a ytInitialData JSON blob (assignment format varies)
    $ytData = $null
    $candidates = @(
        "var ytInitialData =",
        "window['ytInitialData'] =",
        'window["ytInitialData"] =',
        "ytInitialData ="
    )
    foreach ($marker in $candidates) {
        $jsonBlob = Get-JsonObjectAfterMarker -Text $html -Marker $marker
        $ytData = ConvertTo-JsonSafe -JsonText $jsonBlob
        if ($ytData) { break }
    }

    if (-not $ytData) {
        Write-Step "  Could not extract YouTube playlist data from page" "Red"
        return @{
            url = "https://music.youtube.com/playlist?list=$PlaylistId"; service = "youtube"
            name = "YouTube Playlist"; image = $null; tracks = @()
        }
    }

    $playlistName = "YouTube Playlist"
    $playlistImage = $null
    $tracks = @()

    try {
        # Get playlist title/image if available
        $header = $ytData.header
        if ($header.playlistHeaderRenderer) {
            if ($header.playlistHeaderRenderer.title.simpleText) {
                $playlistName = $header.playlistHeaderRenderer.title.simpleText
            }
            try {
                $playlistImage = ($header.playlistHeaderRenderer.playlistHeaderBanner.heroPlaylistThumbnailRenderer.thumbnail.thumbnails | Select-Object -Last 1).url
            } catch {}
        }
        if ($playlistName -eq "YouTube Playlist") {
            try {
                if ($ytData.metadata.playlistMetadataRenderer.title) {
                    $playlistName = $ytData.metadata.playlistMetadataRenderer.title
                }
            } catch {}
        }
        if (($playlistName -eq "YouTube Playlist") -and ($html -match '<meta\s+property="og:title"\s+content="([^"]+)"')) {
            $playlistName = [System.Web.HttpUtility]::HtmlDecode($Matches[1])
        }
        if (-not $playlistImage -and ($html -match '<meta\s+property="og:image"\s+content="([^"]+)"')) {
            $playlistImage = $Matches[1]
        }

        $videoRenderers = @()
        $structuredFailed = $false
        try {
            $videoRenderers = Find-PlaylistVideoRenderers -Node $ytData
        }
        catch {
            $structuredFailed = $true
            Write-Step "  YouTube structured traversal failed, using HTML fallback" "DarkYellow"
        }
        if ($structuredFailed -or -not $videoRenderers -or $videoRenderers.Count -eq 0) {
            $videoRenderers = Get-YouTubeRenderersFromHtml -Html $html
        }
        $seenTrackIds = @{}
        foreach ($v in $videoRenderers) {
            if (-not $v) { continue }

            $title = if ($v.title.runs) { ($v.title.runs | ForEach-Object { $_.text }) -join "" } else { $v.title.simpleText }
            $artist = if ($v.shortBylineText.runs) { ($v.shortBylineText.runs | ForEach-Object { $_.text }) -join "" } else { "" }
            $artist = $artist -replace " - Topic$", ""
            $lengthText = if ($v.lengthText.simpleText) { $v.lengthText.simpleText } else { "" }
            $videoId = $v.videoId
            $thumb = if ($v.thumbnail.thumbnails) { ($v.thumbnail.thumbnails | Select-Object -First 1).url } else { $null }

            # Parse duration "3:42" or "1:03:42" to ms
            $durationMs = 0
            if ($lengthText -match '^(\d+):(\d+):(\d+)$') {
                $durationMs = ([int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3]) * 1000
            } elseif ($lengthText -match '^(\d+):(\d+)$') {
                $durationMs = ([int]$Matches[1] * 60 + [int]$Matches[2]) * 1000
            }

            if (-not $title -or -not $videoId) { continue }
            if ($seenTrackIds.ContainsKey($videoId)) { continue }
            $seenTrackIds[$videoId] = $true

            $tracks += @{
                title = $title; artist = $artist; album = ""
                durationMs = $durationMs; duration = $lengthText
                previewUrl = $null
                trackUrl = "https://music.youtube.com/watch?v=$videoId"
                image = $thumb; trackId = $videoId
            }
        }

    }
    catch {
        Write-Step "  Error parsing YouTube data: $($_.Exception.Message)" "Red"
    }

    Write-Step "  YouTube playlist: $playlistName ($($tracks.Count) tracks)"

    return @{
        url = "https://music.youtube.com/playlist?list=$PlaylistId"; service = "youtube"
        name = $playlistName; image = $playlistImage; tracks = $tracks
    }
}

# ============================================================================
#  APPLE MUSIC — scrape the embed/page for JSON-LD
# ============================================================================

function Get-AppleMusicPlaylistTracks {
    param([string]$Country, [string]$PlaylistId)

    $pageUrl = "https://music.apple.com/$Country/playlist/$PlaylistId"
    try {
        $html = Invoke-PageRequest -Uri $pageUrl
    }
    catch {
        Write-Step "Failed to fetch Apple Music page: $($_.Exception.Message)" "Red"
        return @{
            url = $pageUrl; service = "apple"
            name = "Apple Music Playlist"; image = $null; tracks = @()
        }
    }

    $playlistName = "Apple Music Playlist"
    $playlistImage = $null
    $tracks = @()

    # Apple Music pages contain structured data in JSON-LD
    if ($html -match '<script[^>]+type="application/ld\+json"[^>]*>(.+?)</script>') {
        try {
            $ld = $Matches[1] | ConvertFrom-Json
            if ($ld.name) { $playlistName = $ld.name }
            if ($ld.image) { $playlistImage = $ld.image }
            if ($ld.track) {
                foreach ($t in $ld.track) {
                    $durationMs = 0
                    if ($t.duration -match 'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?') {
                        $h = if ($Matches[1]) { [int]$Matches[1] } else { 0 }
                        $m = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
                        $s = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
                        $durationMs = ($h * 3600 + $m * 60 + $s) * 1000
                    }
                    $tracks += @{
                        title = $t.name
                        artist = if ($t.byArtist -and $t.byArtist.name) { $t.byArtist.name } else { "" }
                        album = if ($t.inAlbum -and $t.inAlbum.name) { $t.inAlbum.name } else { "" }
                        durationMs = $durationMs; duration = Format-Duration $durationMs
                        previewUrl = if ($t.audio -and $t.audio.contentUrl) { $t.audio.contentUrl } else { $null }
                        trackUrl = $t.url; image = $null
                        trackId = if ($t.identifier) { $t.identifier } else { "" }
                    }
                }
            }
        }
        catch {
            Write-Step "  Failed to parse Apple Music JSON-LD" "DarkYellow"
        }
    }

    # Fallback: parse og:title for basic info
    if ($playlistName -eq "Apple Music Playlist" -and $html -match '<meta\s+property="og:title"\s+content="([^"]+)"') {
        $playlistName = [System.Web.HttpUtility]::HtmlDecode($Matches[1])
    }
    if (-not $playlistImage -and $html -match '<meta\s+property="og:image"\s+content="([^"]+)"') {
        $playlistImage = $Matches[1]
    }

    Write-Step "  Apple Music playlist: $playlistName ($($tracks.Count) tracks)"

    return @{
        url = $pageUrl; service = "apple"
        name = $playlistName; image = $playlistImage; tracks = $tracks
    }
}

# ============================================================================
#  TIDAL — scrape the embed page (__NEXT_DATA__)
# ============================================================================

function Get-TidalPlaylistTracks {
    param([string]$PlaylistId)

    try {
        $html = Invoke-PageRequest -Uri "https://embed.tidal.com/playlists/$PlaylistId"
    }
    catch {
        Write-Step "Failed to fetch Tidal embed: $($_.Exception.Message)" "Red"
        return @{
            url = "https://tidal.com/playlist/$PlaylistId"; service = "tidal"
            name = "Tidal Playlist"; image = $null; tracks = @()
        }
    }

    $playlistName = "Tidal Playlist"
    $playlistImage = $null
    $tracks = @()

    # Tidal embed pages have a __NEXT_DATA__ JSON blob
    if ($html -match '<script\s+id="__NEXT_DATA__"[^>]*>(.+?)</script>') {
        try {
            $nextData = $Matches[1] | ConvertFrom-Json
            $pageProps = $nextData.props.pageProps

            if ($pageProps.playlist) {
                $playlistName = $pageProps.playlist.title
                if ($pageProps.playlist.squareImage) {
                    $imgId = $pageProps.playlist.squareImage -replace '-', '/'
                    $playlistImage = "https://resources.tidal.com/images/$imgId/320x320.jpg"
                }
            }

            $items = $pageProps.items
            if ($items) {
                foreach ($item in $items) {
                    $t = $item.item
                    if (-not $t) { $t = $item }
                    if (-not $t.title) { continue }

                    $artistNames = if ($t.artists) { ($t.artists | ForEach-Object { $_.name }) -join ", " } else { "" }
                    $albumTitle = if ($t.album) { $t.album.title } else { "" }
                    $durationMs = if ($t.duration) { $t.duration * 1000 } else { 0 }
                    $albumCover = if ($t.album -and $t.album.cover) {
                        $coverId = $t.album.cover -replace '-', '/'
                        "https://resources.tidal.com/images/$coverId/80x80.jpg"
                    } else { $null }

                    $tracks += @{
                        title = $t.title; artist = $artistNames; album = $albumTitle
                        durationMs = $durationMs; duration = Format-Duration $durationMs
                        previewUrl = $null
                        trackUrl = "https://tidal.com/track/$($t.id)"
                        image = $albumCover; trackId = [string]$t.id
                    }
                }
            }
        }
        catch {
            Write-Step "  Failed to parse Tidal embed data: $($_.Exception.Message)" "DarkYellow"
        }
    }

    Write-Step "  Tidal playlist: $playlistName ($($tracks.Count) tracks)"

    return @{
        url = "https://tidal.com/playlist/$PlaylistId"; service = "tidal"
        name = $playlistName; image = $playlistImage; tracks = $tracks
    }
}

# ============================================================================
#  SOUNDCLOUD — scrape the playlist page for JSON-LD
# ============================================================================

function Get-SoundCloudPlaylistTracks {
    param([string]$PlaylistUrl)

    try {
        $html = Invoke-PageRequest -Uri $PlaylistUrl
    }
    catch {
        Write-Step "Failed to fetch SoundCloud page: $($_.Exception.Message)" "Red"
        return @{
            url = $PlaylistUrl; service = "soundcloud"
            name = "SoundCloud Playlist"; image = $null; tracks = @()
        }
    }

    $playlistName = "SoundCloud Playlist"
    $playlistImage = $null
    $tracks = @()

    # SoundCloud pages have JSON-LD with playlist info
    if ($html -match '<script[^>]+type="application/ld\+json"[^>]*>\s*(\[.+?\])\s*</script>') {
        try {
            $ldArray = $Matches[1] | ConvertFrom-Json
            $musicPlaylist = $ldArray | Where-Object { $_.'@type' -eq 'MusicPlaylist' } | Select-Object -First 1
            if (-not $musicPlaylist) { $musicPlaylist = $ldArray[0] }

            if ($musicPlaylist.name) { $playlistName = $musicPlaylist.name }
            if ($musicPlaylist.image) { $playlistImage = $musicPlaylist.image }

            if ($musicPlaylist.track) {
                foreach ($t in $musicPlaylist.track) {
                    $durationMs = 0
                    if ($t.duration -match 'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?') {
                        $h = if ($Matches[1]) { [int]$Matches[1] } else { 0 }
                        $m = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
                        $s = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
                        $durationMs = ($h * 3600 + $m * 60 + $s) * 1000
                    }

                    $tracks += @{
                        title = $t.name
                        artist = if ($t.byArtist -and $t.byArtist.name) { $t.byArtist.name } else { "" }
                        album = ""
                        durationMs = $durationMs; duration = Format-Duration $durationMs
                        previewUrl = $null
                        trackUrl = $t.url; image = $null
                        trackId = if ($t.url -match '/(\d+)$') { $Matches[1] } else { $t.url }
                    }
                }
            }
        }
        catch {
            Write-Step "  Failed to parse SoundCloud JSON-LD" "DarkYellow"
        }
    }

    # Fallback: parse og:title
    if ($playlistName -eq "SoundCloud Playlist" -and $html -match '<meta\s+property="og:title"\s+content="([^"]+)"') {
        $playlistName = [System.Web.HttpUtility]::HtmlDecode($Matches[1])
    }
    if (-not $playlistImage -and $html -match '<meta\s+property="og:image"\s+content="([^"]+)"') {
        $playlistImage = $Matches[1]
    }

    Write-Step "  SoundCloud playlist: $playlistName ($($tracks.Count) tracks)"

    return @{
        url = $PlaylistUrl; service = "soundcloud"
        name = $playlistName; image = $playlistImage; tracks = $tracks
    }
}

# ============================================================================
#  URL PARSER – detect service and extract IDs
# ============================================================================

function Parse-PlaylistUrl {
    param([string]$Url)

    $u = $Url.ToLower()

    # Spotify (match original URL to preserve case-sensitive ID)
    if ($Url -match "open\.spotify\.com/playlist/([a-zA-Z0-9]+)") {
        return @{ service = "spotify"; id = $Matches[1] }
    }

    # Deezer
    if ($u -match "deezer\.com/playlist/([0-9]+)") {
        return @{ service = "deezer"; id = $Matches[1] }
    }

    # YouTube Music
    if ($Url -match "music\.youtube\.com/playlist\?list=([a-zA-Z0-9_-]+)") {
        return @{ service = "youtube"; id = $Matches[1] }
    }

    # YouTube
    if ($Url -match "youtube\.com/playlist\?list=([a-zA-Z0-9_-]+)") {
        return @{ service = "youtube"; id = $Matches[1] }
    }

    # Apple Music (match original URL to preserve case)
    if ($Url -match "music\.apple\.com/([a-z]{2})/playlist/[^/]+/([a-z]{2}\.[a-zA-Z0-9.-]+)") {
        return @{ service = "apple"; country = $Matches[1]; id = $Matches[2] }
    }

    # Tidal
    if ($Url -match "tidal\.com/(?:browse/)?playlist/([a-zA-Z0-9-]+)") {
        return @{ service = "tidal"; id = $Matches[1] }
    }

    # SoundCloud
    if ($u -match "soundcloud\.com/") {
        return @{ service = "soundcloud"; url = $Url }
    }

    return $null
}

# ============================================================================
#  MAIN
# ============================================================================

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  CURATOR TRACKLIST GENERATOR (scraping mode)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Load curators.json
if (-not (Test-Path $curatorsPath)) {
    Write-Host "ERROR: curators.json not found at $curatorsPath" -ForegroundColor Red
    exit 1
}

$curatorsData = Get-Content $curatorsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$curators = $curatorsData.curators

$existingOutput = $null
if (Test-Path $outputPath) {
    try {
        $existingOutput = Get-Content $outputPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Write-Step "Existing curators-tracklists.json could not be parsed, proceeding without fallback" "DarkYellow"
    }
}

if (-not $curators -or $curators.Count -eq 0) {
    Write-Host "No curators found in curators.json" -ForegroundColor Yellow
    exit 0
}

Write-Step "Found $($curators.Count) curators" "Green"

# Build output
$output = @{
    generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    curators    = @{}
}

$totalPlaylists = 0
$successPlaylists = 0
$preservedPlaylists = 0

function Get-ExistingPlaylistForUrl {
    param(
        [object[]]$ExistingPlaylists,
        [string]$Url,
        [hashtable]$ParsedCurrent
    )

    if (-not $ExistingPlaylists -or $ExistingPlaylists.Count -eq 0) { return $null }

    $exact = $ExistingPlaylists | Where-Object { $_.url -eq $Url } | Select-Object -First 1
    if ($exact) { return $exact }

    if (-not $ParsedCurrent) { return $null }

    foreach ($pl in $ExistingPlaylists) {
        if (-not $pl.url) { continue }
        $parsedExisting = Parse-PlaylistUrl $pl.url
        if (-not $parsedExisting) { continue }
        if ($parsedExisting.service -ne $ParsedCurrent.service) { continue }

        if ($ParsedCurrent.id -and $parsedExisting.id -and $parsedExisting.id -eq $ParsedCurrent.id) {
            return $pl
        }
        if ($ParsedCurrent.url -and $parsedExisting.url -and $parsedExisting.url -eq $ParsedCurrent.url) {
            return $pl
        }
    }

    return $null
}

foreach ($curator in $curators) {
    $name = $curator.name
    Write-Host ""
    Write-Step "Processing: $name" "White"

    $existingCurator = $null
    $existingCuratorProperty = $null
    if ($existingOutput -and $existingOutput.curators) {
        $existingCuratorProperty = $existingOutput.curators.PSObject.Properties | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if ($existingCuratorProperty) {
            $existingCurator = $existingCuratorProperty.Value
        }
    }
    $existingCuratorPlaylists = @()
    if ($existingCurator -and $existingCurator.playlists) {
        $existingCuratorPlaylists = @($existingCurator.playlists)
    }

    $playlistUrls = @()
    if ($curator.playlists) {
        $playlistUrls = @($curator.playlists)
    }
    elseif ($curator.playlist) {
        $playlistUrls = @($curator.playlist)
    }

    if ($playlistUrls.Count -eq 0) {
        Write-Step "  No playlists found, skipping" "DarkGray"
        continue
    }

    $curatorPlaylists = @()

    foreach ($url in $playlistUrls) {
        $totalPlaylists++
        $parsed = Parse-PlaylistUrl $url

        if (-not $parsed) {
            Write-Step "  Unknown playlist service: $url" "DarkYellow"
            $curatorPlaylists += @{
                url = $url; service = "unknown"; name = "Playlist"; image = $null; tracks = @()
            }
            continue
        }

        Write-Step "  Fetching $($parsed.service) playlist: $($parsed.id)..." "Cyan"

        $result = $null
        try {
            switch ($parsed.service) {
                "spotify"    { $result = Get-SpotifyPlaylistTracks -PlaylistId $parsed.id }
                "deezer"     { $result = Get-DeezerPlaylistTracks -PlaylistId $parsed.id }
                "youtube"    { $result = Get-YouTubePlaylistTracks -PlaylistId $parsed.id }
                "apple"      { $result = Get-AppleMusicPlaylistTracks -Country $parsed.country -PlaylistId $parsed.id }
                "tidal"      { $result = Get-TidalPlaylistTracks -PlaylistId $parsed.id }
                "soundcloud" { $result = Get-SoundCloudPlaylistTracks -PlaylistUrl $parsed.url }
            }
        }
        catch {
            Write-Step "  Fetch error, skipping update for this playlist: $($_.Exception.Message)" "DarkYellow"
        }

        if ($result) {
            $result.url = $url
            $curatorPlaylists += $result
            $trackCount = $result.tracks.Count
            $successPlaylists++
            Write-Step "  Got $trackCount tracks" "Green"
        }
        else {
            $existingPlaylist = Get-ExistingPlaylistForUrl -ExistingPlaylists $existingCuratorPlaylists -Url $url -ParsedCurrent $parsed
            if ($existingPlaylist) {
                Write-Step "  Failed to fetch playlist, keeping previous successful data" "DarkYellow"
                $curatorPlaylists += $existingPlaylist
                $preservedPlaylists++
            }
            else {
                Write-Step "  Failed to fetch playlist, no previous data found - skipped" "DarkYellow"
            }
        }
    }

    $output.curators[$name] = @{
        playlists = $curatorPlaylists
    }
}

# Write output
Write-Host ""
Write-Step "Writing curators-tracklists.json..." "Cyan"

$jsonOutput = $output | ConvertTo-Json -Depth 10 -Compress:$false
[System.IO.File]::WriteAllText($outputPath, $jsonOutput, [System.Text.Encoding]::UTF8)

$fileSize = [math]::Round((Get-Item $outputPath).Length / 1024, 1)
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  DONE! $successPlaylists/$totalPlaylists playlists fetched successfully" -ForegroundColor Green
if ($preservedPlaylists -gt 0) {
    Write-Host "  Preserved from previous run: $preservedPlaylists" -ForegroundColor DarkYellow
}
Write-Host (("  Output: curators-tracklists.json ({0}KB)" -f $fileSize)) -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
