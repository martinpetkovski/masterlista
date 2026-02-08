/**
 * One-time script to patch artistImage in chart-data.json
 * 
 * 1. Finds artists with null artistImage and tries fallback services
 * 2. Adds stub entries for bands without any Spotify link (non-Spotify bands)
 *    so that artist.html can show their image from chart-data.json
 * 
 * Run: node scripts/patch-artist-images.js
 */

const fs = require('fs');
const path = require('path');

// ==================== Fetch helpers ====================

async function fetchWithRetry(url, options = {}, retries = 2, timeout = 8000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok && i < retries - 1) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return response;
    } catch (err) {
      if (i < retries - 1) continue;
      throw err;
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}

// ==================== Image fetchers ====================

async function fetchDeezerImage(deezerUrl) {
  try {
    const artistMatch = deezerUrl.match(/\/artist\/(\d+)/);
    const trackMatch = deezerUrl.match(/\/track\/(\d+)/);
    const albumMatch = deezerUrl.match(/\/album\/(\d+)/);
    let endpoint = null;
    if (artistMatch) endpoint = `https://api.deezer.com/artist/${artistMatch[1]}`;
    else if (trackMatch) endpoint = `https://api.deezer.com/track/${trackMatch[1]}`;
    else if (albumMatch) endpoint = `https://api.deezer.com/album/${albumMatch[1]}`;
    else return null;

    const resp = await fetchWithRetry(endpoint);
    if (!resp.ok) return null;
    const data = await resp.json();

    if (artistMatch) {
      return data.picture_xl || data.picture_big || data.picture_medium || null;
    }
    const artist = data.artist;
    return artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null;
  } catch (e) { return null; }
}

async function fetchITunesArtistImage(artistName) {
  try {
    const resp = await fetchWithRetry(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=1`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const artwork = data.results?.[0]?.artworkUrl100;
    if (!artwork) return null;
    return artwork.replace('100x100', '600x600');
  } catch (e) { return null; }
}

async function fetchYouTubeImage(youtubeUrl) {
  try {
    const resp = await fetchWithRetry(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (e) { return null; }
}

async function fetchSoundCloudImage(soundcloudUrl) {
  try {
    const resp = await fetchWithRetry(
      `https://soundcloud.com/oembed?url=${encodeURIComponent(soundcloudUrl)}&format=json`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (e) { return null; }
}

async function fetchBandcampImage(bandcampUrl) {
  try {
    const resp = await fetchWithRetry(bandcampUrl, {}, 2, 10000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    return ogMatch?.[1] || null;
  } catch (e) { return null; }
}

async function fetchFallbackArtistImage(band) {
  const links = band.links || {};

  // Try Deezer first (proper API, returns artist pictures)
  if (links.deezer) {
    const img = await fetchDeezerImage(links.deezer);
    if (img) return { source: 'Deezer', url: img };
  }

  // Try iTunes / Apple Music (search API by artist name)
  if (links.itunes || links.apple_music) {
    const img = await fetchITunesArtistImage(band.name);
    if (img) return { source: 'iTunes', url: img };
  }

  // Try YouTube (oembed for video thumbnail)
  if (links.youtube || links.youtube_music) {
    const url = links.youtube || links.youtube_music;
    const img = await fetchYouTubeImage(url);
    if (img) return { source: 'YouTube', url: img };
  }

  // Try Bandcamp (scrape og:image from page)
  if (links.bandcamp) {
    const img = await fetchBandcampImage(links.bandcamp);
    if (img) return { source: 'Bandcamp', url: img };
  }

  // Try SoundCloud oembed
  if (links.soundcloud) {
    const img = await fetchSoundCloudImage(links.soundcloud);
    if (img) return { source: 'SoundCloud', url: img };
  }

  // Last resort: try iTunes even without an Apple Music link
  if (!links.itunes && !links.apple_music) {
    const img = await fetchITunesArtistImage(band.name);
    if (img) return { source: 'iTunes (name search)', url: img };
  }

  return null;
}

// ==================== Main ====================

async function main() {
  const chartPath = path.join(__dirname, '..', 'chart-data.json');
  const bandsPath = path.join(__dirname, '..', 'bands.json');

  const chartData = JSON.parse(fs.readFileSync(chartPath, 'utf8'));
  const bandsRaw = fs.readFileSync(bandsPath, 'utf8').replace(/^\uFEFF/, '');
  const bandsData = JSON.parse(bandsRaw);
  const bands = bandsData.muzickaMasterLista || bandsData;

  // Build band lookup by name (lowercase)
  const bandsByName = new Map();
  for (const band of bands) {
    bandsByName.set(band.name.toLowerCase(), band);
  }

  // Find unique artists who need an image (null artistImage only)
  const seen = new Set();
  const artistsToFix = [];

  for (const release of chartData.releases) {
    if (seen.has(release.artistId)) continue;
    seen.add(release.artistId);

    if (!release.artistImage) {
      const band = bandsByName.get(release.bandName.toLowerCase());
      if (band) {
        artistsToFix.push({
          artistId: release.artistId,
          bandName: release.bandName,
          band
        });
      }
    }
  }

  console.log(`Found ${artistsToFix.length} artists with null artistImage`);
  console.log('');

  // Process in batches of 5
  const BATCH = 5;
  let fixed = 0;
  let failed = 0;
  const results = new Map();

  for (let i = 0; i < artistsToFix.length; i += BATCH) {
    const batch = artistsToFix.slice(i, i + BATCH);
    const pct = Math.round((i / artistsToFix.length) * 100);
    process.stdout.write(`\rProcessing ${i}/${artistsToFix.length} (${pct}%)...`);

    const batchResults = await Promise.all(
      batch.map(async ({ artistId, bandName, band }) => {
        const result = await fetchFallbackArtistImage(band);
        return { artistId, bandName, result };
      })
    );

    for (const { artistId, bandName, result } of batchResults) {
      if (result) {
        results.set(artistId, result.url);
        console.log(`\n  ✓ ${bandName} → ${result.source}`);
        fixed++;
      } else {
        console.log(`\n  ✗ ${bandName} → no image found`);
        failed++;
      }
    }

    // Small delay between batches
    if (i + BATCH < artistsToFix.length) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log('\n');
  console.log(`Results: ${fixed} fixed, ${failed} not found`);

  // Patch chart-data.json
  if (results.size > 0) {
    let patched = 0;
    for (const release of chartData.releases) {
      const newImage = results.get(release.artistId);
      if (newImage) {
        release.artistImage = newImage;
        patched++;
      }
    }
    console.log(`Patched ${patched} release entries across ${results.size} artists`);
  }

  // ==================== Non-Spotify Bands ====================
  // Add stub entries for bands that have no Spotify link but have other service links
  const existingArtistIds = new Set(chartData.releases.map(r => r.artistId));
  const bandsWithoutSpotify = bands.filter(b =>
    (!b.links?.spotify || b.links.spotify === '\u043d\u0435\u0434\u043e\u0441\u0442\u0438\u0433\u0430\u0430\u0442 \u043f\u043e\u0434\u0430\u0442\u043e\u0446\u0438') &&
    b.links && Object.keys(b.links).length > 0
  );

  // Filter to only those not already in chart-data
  const newNonSpotify = bandsWithoutSpotify.filter(b => {
    const pseudoId = 'no-spotify-' + b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return !existingArtistIds.has(pseudoId);
  });

  if (newNonSpotify.length > 0) {
    console.log(`\n${newNonSpotify.length} non-Spotify bands to add...`);
    let nsFixed = 0;
    for (let i = 0; i < newNonSpotify.length; i += BATCH) {
      const batch = newNonSpotify.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (band) => {
          const result = await fetchFallbackArtistImage(band);
          return { band, result };
        })
      );
      for (const { band, result: res } of batchResults) {
        const pseudoId = 'no-spotify-' + band.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const img = res?.url || null;
        chartData.releases.push({
          bandName: band.name,
          artistId: pseudoId,
          releaseId: null,
          releaseTitle: null,
          releaseType: null,
          releaseDate: null,
          releaseUrl: null,
          thumbnail: img,
          artistImage: img,
          totalTracks: 0,
          popularity: 0,
          topTrackName: null,
          topTrackId: null,
          topTrackUrl: null,
          followers: 0,
          spotifyUrl: null
        });
        if (img) {
          console.log(`  \u2713 ${band.name} \u2192 ${res.source}`);
          nsFixed++;
        } else {
          console.log(`  \u2717 ${band.name} \u2192 no image found`);
        }
      }
      if (i + BATCH < newNonSpotify.length) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    console.log(`Added ${newNonSpotify.length} non-Spotify bands (${nsFixed} with images)`);
  } else {
    console.log('\nNo new non-Spotify bands to add.');
  }

  // Update totals and write
  chartData.totalReleases = chartData.releases.length;
  const allArtistIds = new Set(chartData.releases.map(r => r.artistId));
  chartData.totalArtists = allArtistIds.size;
  chartData.generatedAt = new Date().toISOString();

  fs.writeFileSync(chartPath, JSON.stringify(chartData, null, 2));
  console.log(`\nChart data saved: ${chartData.totalArtists} artists, ${chartData.totalReleases} entries`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
