/**
 * Post-processing script to patch artist images in bands.json
 * 
 * 1. Backfills imageSource for bands that have an image but no source
 * 2. Finds bands without an image and tries fallback services
 *    (Deezer, YouTube, Bandcamp, SoundCloud, Last.fm, etc.)
 * 
 * For active Spotify artists, images are updated by generate-chart-data.js.
 * This script handles the remaining bands (inactive, non-Spotify, etc.).
 * 
 * Run: node scripts/patch-artist-images.js
 * Runs automatically after generate-chart-data.js in update-all.ps1
 */

const fs = require('fs');
const path = require('path');

// ==================== Source detection ====================

/**
 * Detect the image source from a URL (for backfilling artistImageSource).
 * Compares against the release thumbnail to detect 'release' fallback.
 */
function detectImageSource(imageUrl, thumbnail) {
  if (!imageUrl) return null;
  // Spotify artist images use a different path prefix than album art
  if (/i\.scdn\.co\/image\/ab6761/.test(imageUrl)) return 'spotify';
  // Spotify album/release images
  if (/i\.scdn\.co\/image\/ab67616d/.test(imageUrl)) return 'release';
  // External services (check URL patterns before release-thumbnail match)
  if (/deezer/.test(imageUrl)) return 'deezer';
  if (/ytimg|yt\d+\.ggpht|youtube/.test(imageUrl)) return 'youtube';
  if (/bcbits\.com|bandcamp/.test(imageUrl)) return 'bandcamp';
  if (/sndcdn\.com|soundcloud/.test(imageUrl)) return 'soundcloud';
  if (/lastfm|last\.fm/.test(imageUrl)) return 'lastfm';
  if (/mzstatic\.com|apple/.test(imageUrl)) return 'itunes';
  if (/cdninstagram|instagram/.test(imageUrl)) return 'instagram';
  if (/fbcdn|facebook/.test(imageUrl)) return 'facebook';
  // If the artistImage matches the release thumbnail exactly, it's a release fallback
  if (thumbnail && imageUrl === thumbnail) return 'release';
  return 'external';
}

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

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

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
    if (artistMatch) return data.picture_xl || data.picture_big || data.picture_medium || null;
    const artist = data.artist;
    return artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null;
  } catch (e) { return null; }
}

async function fetchDeezerSearchImage(artistName) {
  try {
    const resp = await fetchWithRetry(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=3`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.data?.length) return null;
    const nameLower = artistName.toLowerCase().trim();
    const match = data.data.find(a => a.name.toLowerCase().trim() === nameLower);
    if (!match) return null;
    return match.picture_xl || match.picture_big || match.picture_medium || null;
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
    const isChannel = /youtube\.com\/(@|channel\/|user\/|c\/)/.test(youtubeUrl)
                   || (/youtube\.com\//.test(youtubeUrl) && !/watch|shorts|playlist/.test(youtubeUrl));
    if (isChannel) {
      const resp = await fetchWithRetry(youtubeUrl, { headers: SCRAPE_HEADERS }, 2, 10000);
      if (!resp.ok) return null;
      const html = await resp.text();
      const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
             || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
      return m?.[1] || null;
    }
    const resp = await fetchWithRetry(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (e) { return null; }
}

async function fetchLastFmImage(lastfmUrl) {
  try {
    const resp = await fetchWithRetry(lastfmUrl, { headers: SCRAPE_HEADERS }, 2, 8000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (!m?.[1]) return null;
    if (m[1].includes('2a96cbd8b46e442fc41c2b86b821562f')) return null;
    return m[1];
  } catch (e) { return null; }
}

async function fetchOgImage(pageUrl) {
  try {
    const url = Array.isArray(pageUrl) ? pageUrl[0] : pageUrl;
    if (!url || typeof url !== 'string') return null;
    const resp = await fetchWithRetry(url, { headers: SCRAPE_HEADERS }, 2, 8000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    return m?.[1] || null;
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

async function fetchInstagramImage(instagramUrl) {
  try {
    const url = Array.isArray(instagramUrl) ? instagramUrl[0] : instagramUrl;
    if (!url || typeof url !== 'string') return null;
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, 2, 10000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    return m?.[1] || null;
  } catch (e) { return null; }
}

async function fetchBandcampImage(bandcampUrl) {
  try {
    const resp = await fetchWithRetry(bandcampUrl, { headers: SCRAPE_HEADERS }, 2, 10000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    return ogMatch?.[1] || null;
  } catch (e) { return null; }
}

async function fetchFallbackArtistImage(band) {
  const links = band.links || {};

  // Priority: YouTube channel/video → Instagram → Deezer → iTunes → Bandcamp → SoundCloud → Last.fm → Website → Facebook → Deezer search
  if (links.youtube || links.youtube_music) {
    const raw = links.youtube || links.youtube_music;
    const url = Array.isArray(raw) ? raw[0] : raw;
    const img = await fetchYouTubeImage(url);
    if (img) return { source: 'YouTube', url: img };
  }
  if (links.instagram) {
    const img = await fetchInstagramImage(links.instagram);
    if (img) return { source: 'Instagram', url: img };
  }
  if (links.deezer) {
    const img = await fetchDeezerImage(links.deezer);
    if (img) return { source: 'Deezer', url: img };
  }
  if (links.itunes || links.apple_music) {
    const img = await fetchITunesArtistImage(band.name);
    if (img) return { source: 'iTunes', url: img };
  }
  if (links.bandcamp) {
    const img = await fetchBandcampImage(links.bandcamp);
    if (img) return { source: 'Bandcamp', url: img };
  }
  if (links.soundcloud) {
    const img = await fetchSoundCloudImage(links.soundcloud);
    if (img) return { source: 'SoundCloud', url: img };
  }
  if (links.lastfm) {
    const img = await fetchLastFmImage(links.lastfm);
    if (img) return { source: 'Last.fm', url: img };
  }
  if (links.website) {
    const img = await fetchOgImage(links.website);
    if (img) return { source: 'Website', url: img };
  }
  if (links.facebook) {
    const img = await fetchOgImage(links.facebook);
    if (img) return { source: 'Facebook', url: img };
  }
  {
    const img = await fetchDeezerSearchImage(band.name);
    if (img) return { source: 'Deezer (name search)', url: img };
  }

  return null;
}

// ==================== Main ====================

async function main() {
  const bandsPath = path.join(__dirname, '..', 'bands.json');

  const bandsRaw = fs.readFileSync(bandsPath, 'utf8').replace(/^\uFEFF/, '');
  const bandsData = JSON.parse(bandsRaw);
  const bands = bandsData.muzickaMasterLista || bandsData;

  // ==================== Backfill imageSource ====================
  // For bands that have an image but no imageSource, detect the source from the URL
  let backfilled = 0;
  for (const band of bands) {
    if (band.image && !band.imageSource) {
      band.imageSource = detectImageSource(band.image, null);
      backfilled++;
    }
  }
  if (backfilled > 0) {
    console.log(`Backfilled imageSource for ${backfilled} bands`);
  }

  // ==================== Find bands without images ====================
  // Only process bands that don't yet have an image and have at least one link
  const bandsToFix = bands.filter(b =>
    !b.image &&
    b.links && Object.keys(b.links).some(k => k !== 'none' && b.links[k] && b.links[k] !== 'недостигаат податоци')
  );

  console.log(`Found ${bandsToFix.length} bands without an image`);
  if (bandsToFix.length === 0) {
    // Still save in case backfill changed something
    if (backfilled > 0) {
      fs.writeFileSync(bandsPath, JSON.stringify(bandsData, null, 2), 'utf8');
      console.log('Saved bands.json (backfill only)');
    }
    return;
  }

  console.log('');

  // Process in batches of 5
  const BATCH = 5;
  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < bandsToFix.length; i += BATCH) {
    const batch = bandsToFix.slice(i, i + BATCH);
    const pct = Math.round((i / bandsToFix.length) * 100);
    process.stdout.write(`\rProcessing ${i}/${bandsToFix.length} (${pct}%)...`);

    const batchResults = await Promise.all(
      batch.map(async (band) => {
        const result = await fetchFallbackArtistImage(band);
        return { band, result };
      })
    );

    for (const { band, result } of batchResults) {
      if (result) {
        band.image = result.url;
        band.imageSource = result.source.toLowerCase();
        console.log(`\n  ✓ ${band.name} → ${result.source}`);
        fixed++;
      } else {
        console.log(`\n  ✗ ${band.name} → no image found`);
        failed++;
      }
    }

    // Small delay between batches
    if (i + BATCH < bandsToFix.length) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log('\n');
  console.log(`Results: ${fixed} fixed, ${failed} not found`);

  // Save updated bands.json
  fs.writeFileSync(bandsPath, JSON.stringify(bandsData, null, 2), 'utf8');
  console.log(`Saved bands.json (${bands.length} bands, ${bands.filter(b => b.image).length} with images)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
