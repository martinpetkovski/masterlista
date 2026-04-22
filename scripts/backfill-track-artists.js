/**
 * Backfill trackArtists into releases.json
 * 
 * For collab releases (bandName contains ','), fetches per-track artist data
 * from Spotify's album API and stores it as trackArtists.
 * 
 * Run: node scripts/backfill-track-artists.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EDITABLE_DATA_DIR = path.join(ROOT, 'data', 'dynamic', 'editable');

async function getSpotifyToken(clientId, clientSecret) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error(`Spotify auth failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

async function getAlbumDetailsBatch(albumIds, token) {
  const results = {};
  const BATCH_SIZE = 20;
  for (let i = 0; i < albumIds.length; i += BATCH_SIZE) {
    const batch = albumIds.slice(i, i + BATCH_SIZE);
    const response = await fetch(
      `https://api.spotify.com/v1/albums?ids=${batch.join(',')}&market=MK`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (response.ok) {
      const data = await response.json();
      for (const album of (data.albums || [])) {
        if (album) results[album.id] = album;
      }
    } else {
      console.warn(`  Batch fetch failed: ${response.status}`);
    }
    if (i + BATCH_SIZE < albumIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return results;
}

async function main() {
  // Load credentials
  let clientId, clientSecret;
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'credentials', 'spotify-credentials.json'), 'utf8').replace(/^\uFEFF/, ''));
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
  } catch (e) {
    console.error('Could not load config/credentials/spotify-credentials.json');
    process.exit(1);
  }

  // Load releases.json
  const releasesPath = path.join(EDITABLE_DATA_DIR, 'releases.json');
  const releasesData = JSON.parse(fs.readFileSync(releasesPath, 'utf8').replace(/^\uFEFF/, ''));
  const releases = releasesData.releases;

  // Find collab releases missing trackArtists
  const collabs = releases.filter(r => r.bandName && r.bandName.includes(',') && !r.trackArtists);
  console.log(`Found ${collabs.length} collab releases without trackArtists`);
  if (collabs.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Get Spotify token
  console.log('Getting Spotify token...');
  const token = await getSpotifyToken(clientId, clientSecret);

  // Fetch album details in batches
  const albumIds = collabs.map(r => r.releaseId).filter(Boolean);
  console.log(`Fetching ${albumIds.length} album details from Spotify...`);
  const albumDetails = await getAlbumDetailsBatch(albumIds, token);

  // Patch trackArtists into releases
  let patched = 0;
  for (const release of collabs) {
    const album = albumDetails[release.releaseId];
    if (!album?.tracks?.items) continue;

    const trackArtists = album.tracks.items.map(t => (t.artists || []).map(a => a.name));
    if (trackArtists.some(artists => artists.length > 0)) {
      release.trackArtists = trackArtists;

      // Also update trackNames to match Spotify's canonical order
      const trackNames = album.tracks.items.map(t => t.name);
      if (trackNames.length > 0) release.trackNames = trackNames;

      patched++;
      const artistSummary = trackArtists.map((a, i) => `${trackNames[i]}: ${a.join(', ')}`).join('\n    ');
      console.log(`  ✓ ${release.bandName} — ${release.releaseTitle} (${trackArtists.length} tracks)\n    ${artistSummary}`);
    }
  }

  // Write back
  if (patched > 0) {
    fs.writeFileSync(releasesPath, JSON.stringify(releasesData, null, 2), 'utf8');
    console.log(`\nPatched ${patched}/${collabs.length} collab releases with trackArtists data.`);
  } else {
    console.log('No releases were patched (Spotify returned no track data).');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
