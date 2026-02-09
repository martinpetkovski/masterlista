/**
 * Generate Spotify Chart Data
 * 
 * This script fetches all Spotify data for Macedonian artists and generates
 * a chart-data.json file for use by the MMM chart and releases pages.
 * 
 * Run locally: node generate-chart-data.js
 * Environment variables:
 *   - SPOTIFY_CLIENT_ID
 *   - SPOTIFY_CLIENT_SECRET
 *   - DISCORD_WEBHOOK_URL (optional) - Posts new releases to Discord
 */

const fs = require('fs');
const path = require('path');

// Spotify API helpers
async function getSpotifyToken(clientId, clientSecret) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  
  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status} ${await response.text()}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

function extractArtistId(spotifyUrl) {
  if (!spotifyUrl) return null;
  const match = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function fetchWithRetry(url, options, retries = 3, timeout = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, { 
        ...options, 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '3', 10);
        console.log(`Rate limited, waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      
      if (!response.ok && i < retries - 1) {
        console.log(`Request failed (${response.status}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      return response;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`Request timed out, retrying (${i + 1}/${retries})...`);
        if (i < retries - 1) continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}

// ==================== Discord Webhook Helpers ====================

/**
 * Load the current chart data to compare against new releases
 */
function loadExistingChartData() {
  try {
    const chartPath = path.join(__dirname, '..', 'chart-data.json');
    if (fs.existsSync(chartPath)) {
      const data = JSON.parse(fs.readFileSync(chartPath, 'utf8'));
      return data;
    }
  } catch (e) {
    console.log('Could not load existing chart data:', e.message);
  }
  return null;
}

/**
 * Find new releases by comparing against existing chart data
 */
function findNewReleases(newReleases, existingChartData) {
  if (!existingChartData?.releases) {
    console.log('No existing chart data found, skipping new release detection');
    return [];
  }

  const existingIds = new Set(existingChartData.releases.map(r => r.releaseId));
  const newOnes = newReleases.filter(r => !existingIds.has(r.releaseId));
  
  return newOnes;
}

/**
 * Send a Discord webhook notification for new releases
 */
async function sendDiscordNotification(releases, webhookUrl) {
  if (!webhookUrl || !releases.length) return;

  console.log(`Sending Discord notification for ${releases.length} new release(s)...`);

  // Group releases to avoid hitting Discord rate limits (max 10 embeds per message)
  const MAX_EMBEDS = 10;
  const batches = [];
  for (let i = 0; i < releases.length; i += MAX_EMBEDS) {
    batches.push(releases.slice(i, i + MAX_EMBEDS));
  }

  for (const batch of batches) {
    const embeds = batch.map(release => {
      // Format release type
      const typeLabels = {
        'album': '💿 Албум',
        'single': '🎵 Сингл',
        'ep': '📀 EP',
        'compilation': '📚 Компилација'
      };
      const typeLabel = typeLabels[release.releaseType] || release.releaseType;

      return {
        title: release.releaseTitle,
        url: release.releaseUrl,
        description: `**${release.bandName}**\n${typeLabel}`,
        color: 0x1DB954, // Spotify green
        thumbnail: release.thumbnail ? { url: release.thumbnail } : undefined,
        fields: [
          {
            name: 'Датум',
            value: release.releaseDate,
            inline: true
          },
          {
            name: 'Песни',
            value: String(release.totalTracks || 1),
            inline: true
          }
        ],
        footer: {
          text: 'Мастер Листа • Нова Музика'
        },
        timestamp: new Date().toISOString()
      };
    });

    const payload = {
      username: 'Мастер Листа',
      avatar_url: 'https://martinpetkovski.github.io/masterlista/favicon.ico',
      content: releases.length === 1 
        ? '🎉 **Ново издание на Мастер Листа!**'
        : `🎉 **${releases.length} нови изданија на Мастер Листа!**`,
      embeds: embeds
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error(`Discord webhook failed: ${response.status} ${await response.text()}`);
      } else {
        console.log(`Discord notification sent for ${batch.length} release(s)`);
      }

      // Rate limit: wait between batches
      if (batches.length > 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error('Discord webhook error:', err.message);
    }
  }
}

// ==================== Fallback Artist Image Fetchers ====================

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

/**
 * Try to fetch an artist image from alternative services.
 * Priority order (after Spotify artist image and latest release thumbnail
 * which are handled in the main flow):
 *   1. YouTube channel image
 *   2. YouTube video thumbnail
 *   3. Instagram profile image
 *   4. Deezer artist image (via link)
 *   5. iTunes / Apple Music
 *   6. Bandcamp
 *   7. SoundCloud
 *   8. Last.fm
 *   9. Website og:image
 *  10. Facebook og:image
 *  11. Deezer name search (exact match only)
 */
async function fetchFallbackArtistImage(band) {
  const links = band.links || {};

  // 1-2. YouTube — channel page scraping for channel URLs, oembed for video URLs
  if (links.youtube || links.youtube_music) {
    const url = links.youtube || links.youtube_music;
    const img = await fetchYouTubeImage(url);
    if (img) return img;
  }

  // 3. Instagram profile image
  if (links.instagram) {
    const img = await fetchInstagramImage(links.instagram);
    if (img) return img;
  }

  // 4. Deezer link (proper API, returns artist pictures)
  if (links.deezer) {
    const img = await fetchDeezerImage(links.deezer);
    if (img) return img;
  }

  // 5. iTunes / Apple Music (search API by artist name)
  if (links.itunes || links.apple_music) {
    const img = await fetchITunesArtistImage(band.name);
    if (img) return img;
  }

  // 6. Bandcamp (scrape og:image from page)
  if (links.bandcamp) {
    const img = await fetchBandcampImage(links.bandcamp);
    if (img) return img;
  }

  // 7. SoundCloud (oembed)
  if (links.soundcloud) {
    const img = await fetchSoundCloudImage(links.soundcloud);
    if (img) return img;
  }

  // 8. Last.fm (scrape og:image from artist page)
  if (links.lastfm) {
    const img = await fetchLastFmImage(links.lastfm);
    if (img) return img;
  }

  // 9. Website (scrape og:image)
  if (links.website) {
    const img = await fetchOgImage(links.website);
    if (img) return img;
  }

  // 10. Facebook (scrape og:image)
  if (links.facebook) {
    const img = await fetchOgImage(links.facebook);
    if (img) return img;
  }

  // 11. Last resort: Deezer name search (exact match only)
  {
    const img = await fetchDeezerSearchImage(band.name);
    if (img) return img;
  }

  return null;
}

/**
 * Fetch Instagram profile image by scraping og:image from the profile page.
 * Uses Googlebot UA since Instagram serves og:image to search engine crawlers.
 */
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
  } catch (e) {
    return null;
  }
}

/**
 * Fetch artist image from Deezer's public API using a direct link.
 * Supports track, album, and artist URL formats.
 */
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

    const resp = await fetchWithRetry(endpoint, {}, 2, 5000);
    if (!resp.ok) return null;

    const data = await resp.json();
    if (artistMatch) {
      return data.picture_xl || data.picture_big || data.picture_medium || null;
    }
    const artist = data.artist;
    return artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch artist image via Deezer Search API by artist name.
 * Only returns a result if the name is a close match to avoid false positives.
 */
async function fetchDeezerSearchImage(artistName) {
  try {
    const resp = await fetchWithRetry(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=3`,
      {}, 2, 5000
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.data?.length) return null;

    // Find a close name match to avoid false positives
    const nameLower = artistName.toLowerCase().trim();
    const match = data.data.find(a => a.name.toLowerCase().trim() === nameLower);
    if (!match) return null;

    const pic = match.picture_xl || match.picture_big || match.picture_medium;
    return pic || null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch artist image via iTunes Search API (free, no auth required).
 * Searches by artist name and returns upscaled artwork.
 */
async function fetchITunesArtistImage(artistName) {
  try {
    const resp = await fetchWithRetry(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=1`,
      {}, 2, 5000
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    const artwork = data.results?.[0]?.artworkUrl100;
    if (!artwork) return null;
    return artwork.replace('100x100', '600x600');
  } catch (e) {
    return null;
  }
}

/**
 * Fetch image from YouTube. For channel/handle/user URLs, scrapes og:image from the page.
 * For video URLs, uses oembed. Channel og:image gives the channel avatar.
 */
async function fetchYouTubeImage(youtubeUrl) {
  try {
    // Detect if this is a channel-type URL (not a video/watch URL)
    const isChannel = /youtube\.com\/(@|channel\/|user\/|c\/)/.test(youtubeUrl)
                   || (/youtube\.com\//.test(youtubeUrl) && !/watch|shorts|playlist/.test(youtubeUrl));

    if (isChannel) {
      // Scrape og:image from the channel page (returns channel avatar)
      const resp = await fetchWithRetry(youtubeUrl, { headers: SCRAPE_HEADERS }, 2, 10000);
      if (!resp.ok) return null;
      const html = await resp.text();
      const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
             || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
      if (m?.[1]) return m[1];
      return null;
    }

    // For video URLs, use oembed
    const resp = await fetchWithRetry(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`,
      {}, 2, 5000
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch artist image from Last.fm by scraping the og:image meta tag.
 */
async function fetchLastFmImage(lastfmUrl) {
  try {
    const resp = await fetchWithRetry(lastfmUrl, { headers: SCRAPE_HEADERS }, 2, 8000);
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (!m?.[1]) return null;
    // Last.fm sometimes returns a default/placeholder star image — skip those
    if (m[1].includes('2a96cbd8b46e442fc41c2b86b821562f')) return null;
    return m[1];
  } catch (e) {
    return null;
  }
}

/**
 * Fetch og:image from any generic URL (website, facebook, etc).
 */
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
  } catch (e) {
    return null;
  }
}

/**
 * Fetch image from a Bandcamp page by scraping the og:image meta tag.
 */
async function fetchBandcampImage(bandcampUrl) {
  try {
    const resp = await fetchWithRetry(bandcampUrl, { headers: SCRAPE_HEADERS }, 2, 8000);
    if (!resp.ok) return null;

    const html = await resp.text();
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogMatch?.[1]) return ogMatch[1];

    const ogMatch2 = html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (ogMatch2?.[1]) return ogMatch2[1];

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch thumbnail from SoundCloud via oembed.
 */
async function fetchSoundCloudImage(soundcloudUrl) {
  try {
    const resp = await fetchWithRetry(
      `https://soundcloud.com/oembed?url=${encodeURIComponent(soundcloudUrl)}&format=json`,
      {}, 2, 5000
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (e) {
    return null;
  }
}

async function getArtistsBatch(artistIds, token) {
  const results = {};
  const BATCH_SIZE = 50;
  
  for (let i = 0; i < artistIds.length; i += BATCH_SIZE) {
    const batch = artistIds.slice(i, i + BATCH_SIZE);
    console.log(`Fetching artist batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(artistIds.length/BATCH_SIZE)}`);
    
    const response = await fetchWithRetry(
      `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      for (const artist of (data.artists || [])) {
        if (artist) {
          results[artist.id] = artist;
        }
      }
    }
    
    // Small delay between batches
    if (i + BATCH_SIZE < artistIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return results;
}

async function getArtistAlbums(artistId, token, limit = 10) {
  const response = await fetchWithRetry(
    `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&market=MK&limit=${limit}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.items || [];
}

// Fetch full album objects in batch (up to 20) to get album.popularity
async function getAlbumDetailsBatch(albumIds, token) {
  const results = {};
  const BATCH_SIZE = 20; // Spotify allows up to 20 per request

  for (let i = 0; i < albumIds.length; i += BATCH_SIZE) {
    const batch = albumIds.slice(i, i + BATCH_SIZE);
    const response = await fetchWithRetry(
      `https://api.spotify.com/v1/albums?ids=${batch.join(',')}&market=MK`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (response.ok) {
      const data = await response.json();
      for (const album of (data.albums || [])) {
        if (album) {
          results[album.id] = album;
        }
      }
    }

    if (i + BATCH_SIZE < albumIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

async function getAlbumTracks(albumId, token) {
  const response = await fetchWithRetry(
    `https://api.spotify.com/v1/albums/${albumId}/tracks?market=MK&limit=50`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.items || [];
}

async function getTracksBatch(trackIds, token) {
  const results = {};
  const BATCH_SIZE = 50;
  
  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const batch = trackIds.slice(i, i + BATCH_SIZE);
    
    const response = await fetchWithRetry(
      `https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      for (const track of (data.tracks || [])) {
        if (track) {
          results[track.id] = track;
        }
      }
    }
    
    // Small delay between batches
    if (i + BATCH_SIZE < trackIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return results;
}

async function main() {
  console.log('Starting chart data generation...');
  
  // Load existing chart data to detect new releases
  const existingChartData = loadExistingChartData();
  console.log(existingChartData 
    ? `Loaded existing chart with ${existingChartData.releases?.length || 0} releases`
    : 'No existing chart data found');
  
  // Get Discord webhook URL (optional)
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhookUrl) {
    console.log('Discord webhook configured');
  }
  
  // Get credentials from environment or local file
  let clientId = process.env.SPOTIFY_CLIENT_ID;
  let clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  
  // Try to load from local credentials file if not in env
  if (!clientId || !clientSecret) {
    try {
      const credPath = path.join(__dirname, '..', 'spotify-credentials.json');
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
    } catch (e) {
      console.error('No Spotify credentials found. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars.');
      process.exit(1);
    }
  }
  
  // Get Spotify token
  console.log('Getting Spotify token...');
  const spotifyToken = await getSpotifyToken(clientId, clientSecret);
  console.log('Got Spotify token');
  
  // Load bands.json (strip BOM if present)
  const bandsPath = path.join(__dirname, '..', 'bands.json');
  const bandsRaw = fs.readFileSync(bandsPath, 'utf8').replace(/^\uFEFF/, '');
  const bandsData = JSON.parse(bandsRaw);
  const bands = bandsData.muzickaMasterLista || bandsData;
  console.log(`Loaded ${bands.length} bands`);
  
  // Filter bands with Spotify links
  const bandsWithSpotify = bands.filter(b => 
    b.links?.spotify && b.links.spotify !== 'недостигаат податоци'
  );
  console.log(`${bandsWithSpotify.length} bands have Spotify links`);
  
  // Build artist map
  const artistMap = new Map();
  for (const band of bandsWithSpotify) {
    const artistId = extractArtistId(band.links.spotify);
    if (artistId) {
      artistMap.set(artistId, band);
    }
  }
  
  const artistIds = Array.from(artistMap.keys());
  console.log(`Processing ${artistIds.length} unique artists`);
  
  // Fetch all artist info in batches
  const artistsInfo = await getArtistsBatch(artistIds, spotifyToken);
  console.log(`Got info for ${Object.keys(artistsInfo).length} artists`);
  
  // Fetch fallback images for artists without any Spotify artist profile image.
  // These will be used if Spotify has no artist image AND no release thumbnail.
  const fallbackImages = new Map();
  const artistsWithoutImages = artistIds.filter(id => !artistsInfo[id]?.images?.[0]?.url);
  if (artistsWithoutImages.length > 0) {
    console.log(`${artistsWithoutImages.length} artists have no Spotify artist image, trying fallback services...`);
    const FALLBACK_BATCH = 5;
    for (let i = 0; i < artistsWithoutImages.length; i += FALLBACK_BATCH) {
      const batch = artistsWithoutImages.slice(i, i + FALLBACK_BATCH);
      const results = await Promise.all(
        batch.map(async (artistId) => {
          const band = artistMap.get(artistId);
          const img = await fetchFallbackArtistImage(band);
          return { artistId, img, name: band.name };
        })
      );
      for (const { artistId, img, name } of results) {
        if (img) {
          fallbackImages.set(artistId, img);
          console.log(`  ✓ Fallback image for ${name}`);
        }
      }
      if (i + FALLBACK_BATCH < artistsWithoutImages.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    console.log(`Got ${fallbackImages.size} fallback images out of ${artistsWithoutImages.length} needed`);
  }
  
  // Fetch albums and their track popularity with rate limiting
  const releases = [];
  const BATCH_SIZE = 10; // Process 10 artists at a time (reduced for more API calls)
  const BATCH_DELAY = 400; // 400ms between batches
  const albumsStartTime = Date.now();
  
  for (let i = 0; i < artistIds.length; i += BATCH_SIZE) {
    const batch = artistIds.slice(i, i + BATCH_SIZE);
    const pct = Math.round((i / artistIds.length) * 100);
    const elapsedSec = ((Date.now() - albumsStartTime) / 1000).toFixed(1);
    console.log(`Processing albums batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(artistIds.length/BATCH_SIZE)} (${pct}%) [${elapsedSec}s]`);
    
    const batchResults = await Promise.all(
      batch.map(async (artistId) => {
        try {
          const band = artistMap.get(artistId);
          const artistInfo = artistsInfo[artistId];
          
          const albums = await getArtistAlbums(artistId, spotifyToken, 10);
          if (!albums?.length) return null;
          
          // Fetch full album details to get album-level popularity
          const albumIds = albums.map(a => a.id).filter(Boolean);
          console.log(`  Fetching album details for ${band.name} (${albumIds.length} albums)`);
          const fullAlbumDetails = await getAlbumDetailsBatch(albumIds, spotifyToken);
          
          // For each album, get tracks to find max track popularity
          const albumsWithPopularity = await Promise.all(
            albums.map(async (album) => {
              try {
                const fullAlbum = fullAlbumDetails[album.id];
                const albumPopularity = fullAlbum?.popularity || 0;
                
                const tracks = await getAlbumTracks(album.id, spotifyToken);
                // Get full track info to get popularity
                const trackIds = tracks.map(t => t.id).filter(Boolean);
                let maxTrackPopularity = 0;
                let topTrackName = null;
                let topTrackId = null;
                
                if (trackIds.length > 0) {
                  const tracksInfo = await getTracksBatch(trackIds, spotifyToken);
                  for (const track of Object.values(tracksInfo)) {
                    if (track.popularity > maxTrackPopularity) {
                      maxTrackPopularity = track.popularity;
                      topTrackName = track.name;
                      topTrackId = track.id;
                    }
                  }
                }
                
                return {
                  bandName: band.name,
                  artistId,
                  releaseId: album.id,
                  releaseTitle: album.name,
                  releaseType: album.album_type,
                  releaseDate: album.release_date,
                  releaseUrl: album.external_urls?.spotify,
                  thumbnail: album.images?.[0]?.url || album.images?.[1]?.url,
                  // Priority: Spotify artist image → fallback service image → latest release thumbnail
                  artistImage: artistInfo?.images?.[0]?.url || fallbackImages.get(artistId) || album.images?.[0]?.url || null,
                  totalTracks: album.total_tracks,
                  popularity: albumPopularity, // Spotify album popularity (0-100)
                  topTrackName,
                  topTrackId,
                  topTrackPopularity: maxTrackPopularity, // Max track popularity on this album (0-100)
                  topTrackUrl: topTrackId ? `https://open.spotify.com/track/${topTrackId}` : null,
                  followers: artistInfo?.followers?.total || 0,
                  spotifyUrl: band.links.spotify
                };
              } catch (err) {
                // Fallback to artist popularity if fetch fails
                return {
                  bandName: band.name,
                  artistId,
                  releaseId: album.id,
                  releaseTitle: album.name,
                  releaseType: album.album_type,
                  releaseDate: album.release_date,
                  releaseUrl: album.external_urls?.spotify,
                  thumbnail: album.images?.[0]?.url || album.images?.[1]?.url,
                  // Priority: Spotify artist image → fallback service image → latest release thumbnail
                  artistImage: artistInfo?.images?.[0]?.url || fallbackImages.get(artistId) || album.images?.[0]?.url || null,
                  totalTracks: album.total_tracks,
                  popularity: artistInfo?.popularity || 0,
                  topTrackPopularity: 0,
                  followers: artistInfo?.followers?.total || 0,
                  spotifyUrl: band.links.spotify
                };
              }
            })
          );
          
          return albumsWithPopularity;
        } catch (err) {
          console.warn(`Error for ${artistMap.get(artistId)?.name}: ${err.message}`);
          return null;
        }
      })
    );
    
    for (const result of batchResults) {
      if (result) releases.push(...result);
    }
    
    if (i + BATCH_SIZE < artistIds.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }
  
  console.log(`Collected ${releases.length} releases`);
  
  // Generate chart data
  const now = new Date();
  const chartData = {
    generatedAt: now.toISOString(),
    totalReleases: releases.length,
    totalArtists: artistIds.length,
    releases: releases.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
  };
  
  const outputPath = path.join(__dirname, '..', 'chart-data.json');
  const historyDir = path.join(__dirname, '..', 'chart-history');
  
  // Save weekly historical snapshot
  saveWeeklySnapshot(chartData, historyDir, now);
  
  // ==================== Non-Spotify Bands ====================
  // Process bands that have NO Spotify link but have other service links.
  // Create a stub release entry so that artist.html can still show an image.
  const bandsWithoutSpotify = bands.filter(b =>
    (!b.links?.spotify || b.links.spotify === 'недостигаат податоци') &&
    b.links && Object.keys(b.links).length > 0
  );
  if (bandsWithoutSpotify.length > 0) {
    console.log(`${bandsWithoutSpotify.length} bands have no Spotify link, fetching images from other services...`);
    const NON_SPOTIFY_BATCH = 5;
    for (let i = 0; i < bandsWithoutSpotify.length; i += NON_SPOTIFY_BATCH) {
      const batch = bandsWithoutSpotify.slice(i, i + NON_SPOTIFY_BATCH);
      const pct = Math.round((i / bandsWithoutSpotify.length) * 100);
      console.log(`Non-Spotify batch ${Math.floor(i/NON_SPOTIFY_BATCH)+1}/${Math.ceil(bandsWithoutSpotify.length/NON_SPOTIFY_BATCH)} (${pct}%)`);
      const batchResults = await Promise.all(
        batch.map(async (band) => {
          const img = await fetchFallbackArtistImage(band);
          return { band, img };
        })
      );
      for (const { band, img } of batchResults) {
        // Use a stable pseudo-ID derived from the band name
        const pseudoId = 'no-spotify-' + band.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        // Check if this band already has a stub entry from a previous run
        const existing = chartData.releases.find(r => r.artistId === pseudoId);
        if (existing) {
          if (img && !existing.artistImage) existing.artistImage = img;
          continue;
        }
        chartData.releases.push({
          bandName: band.name,
          artistId: pseudoId,
          releaseId: null,
          releaseTitle: null,
          releaseType: null,
          releaseDate: null,
          releaseUrl: null,
          thumbnail: img || null,
          artistImage: img || null,
          totalTracks: 0,
          popularity: 0,
          topTrackName: null,
          topTrackId: null,
          topTrackUrl: null,
          followers: 0,
          spotifyUrl: null
        });
        if (img) console.log(`  ✓ ${band.name}`);
      }
      if (i + NON_SPOTIFY_BATCH < bandsWithoutSpotify.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    // Update totals
    chartData.totalReleases = chartData.releases.length;
    const allArtistIds = new Set(chartData.releases.map(r => r.artistId));
    chartData.totalArtists = allArtistIds.size;
    console.log(`Chart now includes ${chartData.totalArtists} artists (${chartData.totalReleases} entries)`);
  }

  // Write current chart data
  fs.writeFileSync(outputPath, JSON.stringify(chartData, null, 2));
  console.log(`Chart data written to ${outputPath}`);
  console.log(`Total releases: ${chartData.totalReleases}`);
  console.log(`Total artists: ${chartData.totalArtists}`);
  
  // Send Discord notifications for new releases
  if (discordWebhookUrl) {
    const newReleases = findNewReleases(chartData.releases, existingChartData);
    if (newReleases.length > 0) {
      console.log(`Found ${newReleases.length} new release(s) to announce`);
      await sendDiscordNotification(newReleases, discordWebhookUrl);
    } else {
      console.log('No new releases to announce');
    }
  }
}

/**
 * Save a weekly snapshot of chart data to the history folder.
 * Only saves one snapshot per week (first generation of the week).
 * Format: chart-YYYY-WXX.json (e.g., chart-2026-W03.json)
 */
function saveWeeklySnapshot(chartData, historyDir, now) {
  // Ensure history directory exists
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
    console.log(`Created history directory: ${historyDir}`);
  }
  
  // Get ISO week number for current date
  const weekInfo = getISOWeek(now);
  const weekFileName = `chart-${weekInfo.year}-W${String(weekInfo.week).padStart(2, '0')}.json`;
  const weekFilePath = path.join(historyDir, weekFileName);
  
  // Only save if this week's file doesn't exist yet (first generation of the week)
  if (!fs.existsSync(weekFilePath)) {
    fs.writeFileSync(weekFilePath, JSON.stringify(chartData, null, 2));
    console.log(`Saved weekly snapshot: ${weekFileName}`);
  } else {
    console.log(`Weekly snapshot already exists: ${weekFileName}`);
  }
}

/**
 * Get the ISO week number and year for a given date.
 * ISO weeks start on Monday, and week 1 is the week containing January 4th.
 */
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  
  // Set to nearest Thursday (current date + 4 - current day number, with Sunday = 7)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  
  // Get first day of year
  const yearStart = new Date(d.getFullYear(), 0, 1);
  
  // Calculate week number: Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  
  return {
    year: d.getFullYear(),
    week: weekNum
  };
}

/**
 * Get the Monday 00:00:00 of the week containing the given date.
 */
function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Sunday is 0, Monday is 1, etc. We want Monday = 0
  const diff = day === 0 ? -6 : 1 - day; // If Sunday, go back 6 days; otherwise go back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
