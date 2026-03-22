/**
 * Generate Spotify Playlists from Master Lista chart data
 * 
 * Updates Spotify playlists based on chart data. Playlists are configured
 * in spotify-playlists.json — just paste Spotify playlist links/URLs.
 * 
 * Three playlist slots:
 *   - topSongsCurrent: highest popularity this week (singles)
 *   - topSongsAllTime: highest cumulative YouTube views (singles)
 *   - newSongs: most recent releases
 * 
 * Setup:
 *   1. Run: node scripts/spotify-auth.js   (one-time, saves refresh token)
 *   2. Paste playlist URLs into spotify-playlists.json
 *   3. Run: ./update-all.ps1 -Only playlists
 * 
 * Environment variables (set by update-all.ps1):
 *   - SPOTIFY_CLIENT_ID
 *   - SPOTIFY_CLIENT_SECRET
 *   - SPOTIFY_REFRESH_TOKEN
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
//  Spotify Auth (User token via refresh_token grant)
// ---------------------------------------------------------------------------

async function getUserToken(clientId, clientSecret, refreshToken) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get user token: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ---------------------------------------------------------------------------
//  Spotify API helpers
// ---------------------------------------------------------------------------

async function apiFetch(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.spotify.com/v1${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return apiFetch(endpoint, token, options);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }

  // 204 = no content (e.g. after PUT)
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Get all track URIs for a Spotify album (handles pagination for >50 tracks)
 */
async function getAlbumTrackUris(albumId, token) {
  let url = `/albums/${albumId}/tracks?limit=50`;
  const uris = [];

  while (url) {
    const data = await apiFetch(url, token);
    if (!data?.items) break;
    for (const track of data.items) {
      if (track.uri) uris.push(track.uri);
    }
    url = data.next || null;
  }

  return uris;
}

/**
 * Replace all tracks in a playlist (clears it, then adds new tracks)
 */
async function replacePlaylistTracks(playlistId, trackUris, token) {
  // Spotify allows up to 100 URIs per request
  // First call replaces (clears + adds first batch)
  const firstBatch = trackUris.slice(0, 100);
  await apiFetch(`/playlists/${playlistId}/tracks`, token, {
    method: 'PUT',
    body: JSON.stringify({ uris: firstBatch })
  });

  // Subsequent batches are appended
  for (let i = 100; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await apiFetch(`/playlists/${playlistId}/tracks`, token, {
      method: 'POST',
      body: JSON.stringify({ uris: batch })
    });
  }
}

/**
 * Extract playlist ID from a Spotify URL/URI, or return as-is if already an ID.
 * Accepts:
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc
 *   spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 *   37i9dQZF1DXcBWIGoYBM5M
 */
function extractPlaylistId(input) {
  if (!input || typeof input !== 'string') return null;
  input = input.trim();
  if (!input) return null;

  // spotify:playlist:ID
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];

  // open.spotify.com/playlist/ID
  const urlMatch = input.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // bare ID (22 alphanumeric chars)
  if (/^[a-zA-Z0-9]{22}$/.test(input)) return input;

  return null;
}

/**
 * Fetch playlist name from Spotify API
 */
async function getPlaylistName(playlistId, token) {
  try {
    const data = await apiFetch(`/playlists/${playlistId}?fields=name`, token);
    return data?.name || playlistId;
  } catch {
    return playlistId;
  }
}

// ---------------------------------------------------------------------------
//  Data loading
// ---------------------------------------------------------------------------

function loadJson(filename) {
  const p = path.join(ROOT, filename);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

// ---------------------------------------------------------------------------
//  Playlist builders
// ---------------------------------------------------------------------------

/**
 * Top Songs Current: singles sorted by this week's popularity (viewsDelta).
 * For albums, we pick the first track only.
 */
function getTopSongsCurrent(chartData, releases, maxTracks) {
  // Join chart metrics with release metadata
  const chartMap = {};
  for (const c of chartData.releases) {
    chartMap[c.releaseId] = c;
  }

  const candidates = releases.releases
    .filter(r => r.releaseType === 'single' && chartMap[r.releaseId])
    .map(r => ({ ...r, chart: chartMap[r.releaseId] }))
    .sort((a, b) => (b.chart.popularity || 0) - (a.chart.popularity || 0));

  return candidates.slice(0, maxTracks).map(r => r.releaseId);
}

/**
 * Top Songs All Time: singles sorted by cumulative YouTube views (proxy for all-time).
 */
function getTopSongsAllTime(chartData, releases, maxTracks) {
  const chartMap = {};
  for (const c of chartData.releases) {
    chartMap[c.releaseId] = c;
  }

  const candidates = releases.releases
    .filter(r => r.releaseType === 'single' && chartMap[r.releaseId])
    .map(r => ({ ...r, chart: chartMap[r.releaseId] }))
    .sort((a, b) => (b.chart.youtubeViews || 0) - (a.chart.youtubeViews || 0));

  return candidates.slice(0, maxTracks).map(r => r.releaseId);
}

/**
 * New Songs: most recent releases (any type), sorted by release date descending.
 */
function getNewSongs(releases, maxTracks, newReleaseDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - newReleaseDays);

  const candidates = releases.releases
    .filter(r => {
      const d = new Date(r.effectiveReleaseDate || r.releaseDate);
      return d >= cutoff;
    })
    .sort((a, b) => {
      const da = new Date(a.effectiveReleaseDate || a.releaseDate);
      const db = new Date(b.effectiveReleaseDate || b.releaseDate);
      return db - da;
    });

  return candidates.slice(0, maxTracks).map(r => r.releaseId);
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Spotify Playlist Generation ===');

  // --- Load config ---
  const config = loadJson('spotify-playlists.json');
  if (!config) {
    console.error('spotify-playlists.json not found');
    process.exit(1);
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    console.error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set');
    process.exit(1);
  }
  if (!refreshToken) {
    console.error('SPOTIFY_REFRESH_TOKEN must be set (requires user authorization with playlist-modify-public scope)');
    process.exit(1);
  }

  // --- Load data ---
  const chartData = loadJson('chart-data.json');
  const releases = loadJson('releases.json');
  if (!chartData || !releases) {
    console.error('chart-data.json and releases.json must exist');
    process.exit(1);
  }

  // --- Authenticate ---
  console.log('Authenticating with Spotify (user token)...');
  const token = await getUserToken(clientId, clientSecret, refreshToken);
  console.log('Authenticated.');

  const maxTracks = config.settings?.maxTracksPerPlaylist || 50;
  const newReleaseDays = config.settings?.newReleaseDays || 30;
  const playlists = config.playlists || {};

  // --- Parse playlist links/IDs ---
  const playlistDefs = [
    {
      key: 'topSongsCurrent',
      label: 'Top Songs Current',
      albumIdsFn: () => getTopSongsCurrent(chartData, releases, maxTracks)
    },
    {
      key: 'topSongsAllTime',
      label: 'Top Songs All Time',
      albumIdsFn: () => getTopSongsAllTime(chartData, releases, maxTracks)
    },
    {
      key: 'newSongs',
      label: 'New Releases',
      albumIdsFn: () => getNewSongs(releases, maxTracks, newReleaseDays)
    }
  ];

  // --- Update each playlist ---
  for (const def of playlistDefs) {
    const rawValue = playlists[def.key];
    const playlistId = extractPlaylistId(rawValue);
    if (!playlistId) {
      console.log(`Skipping "${def.label}" - no playlist link configured`);
      continue;
    }

    const playlistName = await getPlaylistName(playlistId, token);
    console.log(`\nUpdating "${def.label}" → ${playlistName} (${playlistId})...`);

    const albumIds = def.albumIdsFn();
    console.log(`  ${albumIds.length} releases selected`);

    // Resolve album IDs → track URIs
    const allTrackUris = [];
    for (const albumId of albumIds) {
      const uris = await getAlbumTrackUris(albumId, token);
      if (uris.length > 0) {
        // For singles: add all tracks; for albums: still add all tracks
        allTrackUris.push(...uris);
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`  ${allTrackUris.length} total tracks resolved`);

    if (allTrackUris.length === 0) {
      console.log(`  No tracks found, skipping playlist update`);
      continue;
    }

    await replacePlaylistTracks(playlistId, allTrackUris, token);
    console.log(`  Playlist updated successfully`);
  }

  console.log('\n=== Playlist generation complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
