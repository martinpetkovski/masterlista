/**
 * Generate Spotify Playlists from Master Lista chart data
 *
 * Uses the same data & sorting logic as the site (site-master.json).
 * Playlists are configured in spotify-playlists.json.
 *
 * Six playlist slots:
 *   - topSongsCurrent:        singles sorted by viewsDelta (weekly chart)
 *   - topSongsAllTime:        singles sorted by youtubeViews (cumulative)
 *   - newSongs:               latest releases by date
 *   - topAlternativeCurrent:  alt-genre singles by viewsDelta
 *   - topAlternativeAllTime:  alt-genre singles by youtubeViews
 *   - newAlternativeSongs:    alt-genre latest releases by date
 *
 * Setup:
 *   1. Run: node scripts/spotify-auth.js   (one-time, saves refresh token)
 *   2. Paste playlist URLs into spotify-playlists.json
 *   3. Run: ./update-all.ps1 -Only playlists
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

  if (res.status === 204) return null;
  return res.json();
}

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
 * Clear playlist completely, then add new tracks in batches.
 */
async function replacePlaylistTracks(playlistId, trackUris, token) {
  // Always clear first
  await apiFetch(`/playlists/${playlistId}/tracks`, token, {
    method: 'PUT',
    body: JSON.stringify({ uris: [] })
  });

  // Add in batches of 100
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await apiFetch(`/playlists/${playlistId}/tracks`, token, {
      method: 'POST',
      body: JSON.stringify({ uris: batch })
    });
  }
}

function extractPlaylistId(input) {
  if (!input || typeof input !== 'string') return null;
  input = input.trim();
  if (!input) return null;

  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];

  const urlMatch = input.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  if (/^[a-zA-Z0-9]{22}$/.test(input)) return input;
  return null;
}

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

/**
 * Unpack site-master.json's columnar chartData.releases into objects.
 */
function unpackReleases(siteMaster) {
  const cd = siteMaster.chartData?.releases;
  if (!cd?._cols || !cd?._rows) return [];
  const cols = cd._cols;
  return cd._rows.map(row => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
    return obj;
  });
}

// ---------------------------------------------------------------------------
//  Genre classification (mirrors generate-site-master.ps1 logic)
// ---------------------------------------------------------------------------

function buildGenreClassifier() {
  const chartGenres = loadJson('chart-genres.json') || {};
  const nonAltSet = new Set();
  for (const cat of ['rap', 'electronic', 'pop']) {
    for (const g of (chartGenres[cat] || [])) nonAltSet.add(g.toLowerCase());
  }

  // Build artist → isAlt lookup from bands.json
  const bandsData = loadJson('bands.json');
  const artistAlt = {};  // artistName(lower) → boolean
  if (bandsData) {
    const bandsList = Object.values(bandsData)[0] || {};
    for (const b of Object.values(bandsList)) {
      if (!b.name) continue;
      const key = b.name.toLowerCase().trim();
      const genreStr = b.genre || '';
      if (!genreStr || genreStr.toLowerCase() === 'недостигаат податоци') {
        artistAlt[key] = false;  // no genre = not alternative
        continue;
      }
      const genres = genreStr.split(',').map(g => g.trim().toLowerCase()).filter(Boolean);
      // Alt if artist has genres AND none match nonAlt
      artistAlt[key] = genres.length > 0 && !genres.some(g => nonAltSet.has(g));
    }
  }

  return function isAlternative(bandName) {
    if (!bandName) return false;
    const key = bandName.toLowerCase().trim();
    if (key in artistAlt) return artistAlt[key];
    // For collabs, check first artist
    const first = key.split(',')[0].trim();
    if (first in artistAlt) return artistAlt[first];
    return false;
  };
}

// ---------------------------------------------------------------------------
//  Playlist builders — same sorting as the site
// ---------------------------------------------------------------------------

/**
 * Pick up to maxTracks from a pre-sorted candidates list,
 * allowing at most maxPerArtist entries per artist.
 */
function pickWithArtistCap(candidates, maxTracks, maxPerArtist) {
  const artistCount = {};
  const result = [];
  for (const r of candidates) {
    if (result.length >= maxTracks) break;
    const key = r.artistId || r.bandName;
    const count = artistCount[key] || 0;
    if (count >= maxPerArtist) continue;
    artistCount[key] = count + 1;
    result.push(r.releaseId);
  }
  return result;
}

/**
 * Chart sort: null-viewsDelta last, then viewsDelta desc, youtubeViews desc, name asc.
 * Matches Sort-ChartRanking in generate-site-master.ps1.
 */
function chartSort(a, b) {
  const aNullVD = (a.viewsDelta == null) ? 1 : 0;
  const bNullVD = (b.viewsDelta == null) ? 1 : 0;
  if (aNullVD !== bNullVD) return aNullVD - bNullVD;
  const vdDiff = (b.viewsDelta || 0) - (a.viewsDelta || 0);
  if (vdDiff !== 0) return vdDiff;
  const ytDiff = (b.youtubeViews || 0) - (a.youtubeViews || 0);
  if (ytDiff !== 0) return ytDiff;
  return (a.bandName || '').localeCompare(b.bandName || '');
}

/**
 * Current chart: uses pre-computed chart from site-master.json (exact site order),
 * then extends with additional recent releases if needed.
 */
function getTopCurrent(siteMaster, releases, chartKey, maxTracks, maxPerArtist, genreFilter) {
  // Start with pre-computed chart (exact same order as the site)
  const preComputed = siteMaster.charts?.[chartKey] || [];
  const usedIds = new Set(preComputed.map(r => r.releaseId));
  const result = preComputed.map(r => r.releaseId);

  if (result.length >= maxTracks) {
    return pickWithArtistCap(preComputed, maxTracks, maxPerArtist);
  }

  // Extend: add remaining recent singles not already in the chart, sorted by viewsDelta
  const cutoffWeeks = 4;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cutoffWeeks * 7);

  const extras = releases
    .filter(r => r.releaseType === 'single'
      && !usedIds.has(r.releaseId)
      && new Date(r.effectiveReleaseDate || r.releaseDate) >= cutoff)
    .filter(r => !genreFilter || genreFilter(r.bandName))
    .sort(chartSort);

  // Combine pre-computed + extras as candidate objects for artist-cap
  const allCandidates = [
    ...preComputed,
    ...extras
  ];
  return pickWithArtistCap(allCandidates, maxTracks, maxPerArtist);
}

/**
 * All-time chart: singles sorted by total youtubeViews desc.
 */
function getTopAllTime(releases, maxTracks, maxPerArtist, genreFilter) {
  const candidates = releases
    .filter(r => r.releaseType === 'single' && (r.youtubeViews || 0) > 0)
    .filter(r => !genreFilter || genreFilter(r.bandName))
    .sort((a, b) => (b.youtubeViews || 0) - (a.youtubeViews || 0));
  return pickWithArtistCap(candidates, maxTracks, maxPerArtist);
}

/**
 * New releases: sorted by release date descending.
 */
function getNewReleases(releases, maxTracks, newReleaseDays, maxPerArtist, genreFilter) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - newReleaseDays);

  const candidates = releases
    .filter(r => {
      const d = new Date(r.effectiveReleaseDate || r.releaseDate);
      return d >= cutoff;
    })
    .filter(r => !genreFilter || genreFilter(r.bandName))
    .sort((a, b) => {
      const da = new Date(a.effectiveReleaseDate || a.releaseDate);
      const db = new Date(b.effectiveReleaseDate || b.releaseDate);
      return db - da;
    });

  return pickWithArtistCap(candidates, maxTracks, maxPerArtist);
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
    console.error('SPOTIFY_REFRESH_TOKEN must be set');
    process.exit(1);
  }

  // --- Load site-master.json (has viewsDelta, same data as the site) ---
  const siteMaster = loadJson('site-master.json');
  if (!siteMaster) {
    console.error('site-master.json not found — run sitemaster step first');
    process.exit(1);
  }
  const releases = unpackReleases(siteMaster);
  console.log(`Loaded ${releases.length} releases from site-master.json`);

  // --- Build genre classifier (same logic as generate-site-master.ps1) ---
  const isAlternative = buildGenreClassifier();

  // --- Authenticate ---
  console.log('Authenticating with Spotify (user token)...');
  const token = await getUserToken(clientId, clientSecret, refreshToken);
  console.log('Authenticated.');

  const maxTracks = config.settings?.maxTracksPerPlaylist || 50;
  const maxPerArtist = config.settings?.maxPerArtist || 2;
  const newReleaseDays = config.settings?.newReleaseDays || 30;
  const playlists = config.playlists || {};

  // --- Playlist definitions ---
  const playlistDefs = [
    {
      key: 'topSongsCurrent',
      label: 'Top Songs Current',
      getIds: () => getTopCurrent(siteMaster, releases, 'all_single', maxTracks, maxPerArtist, null)
    },
    {
      key: 'topSongsAllTime',
      label: 'Top Songs All Time',
      getIds: () => getTopAllTime(releases, maxTracks, maxPerArtist, null)
    },
    {
      key: 'newSongs',
      label: 'New Releases',
      getIds: () => getNewReleases(releases, maxTracks, newReleaseDays, maxPerArtist, null)
    },
    {
      key: 'topAlternativeCurrent',
      label: 'Top Alternative Current',
      getIds: () => getTopCurrent(siteMaster, releases, 'alt_single', maxTracks, maxPerArtist, isAlternative)
    },
    {
      key: 'topAlternativeAllTime',
      label: 'Top Alternative All Time',
      getIds: () => getTopAllTime(releases, maxTracks, maxPerArtist, isAlternative)
    },
    {
      key: 'newAlternativeSongs',
      label: 'New Alternative Releases',
      getIds: () => getNewReleases(releases, maxTracks, newReleaseDays, maxPerArtist, isAlternative)
    }
  ];

  // --- Update each playlist ---
  for (const def of playlistDefs) {
    const rawValue = playlists[def.key];
    const playlistId = extractPlaylistId(rawValue);
    if (!playlistId) {
      console.log(`Skipping "${def.label}" — no playlist link configured`);
      continue;
    }

    const playlistName = await getPlaylistName(playlistId, token);
    console.log(`\nUpdating "${def.label}" → ${playlistName} (${playlistId})...`);

    const albumIds = def.getIds();
    console.log(`  ${albumIds.length} releases selected`);

    // Resolve album IDs → track URIs
    const allTrackUris = [];
    for (const albumId of albumIds) {
      const uris = await getAlbumTrackUris(albumId, token);
      if (uris.length > 0) allTrackUris.push(...uris);
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
