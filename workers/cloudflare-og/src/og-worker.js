/**
 * OG Meta Tag Worker for toplista.mk
 *
 * Intercepts requests from social media crawlers (Facebook, Twitter, Discord,
 * Telegram, etc.) and returns proper Open Graph meta tags for artist, curator,
 * and event pages. Regular visitors are passed through to the origin (GitHub Pages).
 *
 * Deploy as a Cloudflare Worker Route on toplista.mk/* and www.toplista.mk/*
 */

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/martinpetkovski/masterlista/master';
const SITE_URL = 'https://toplista.mk';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

// --------------- In-memory cache (per-isolate) ---------------
let bandsCache = null;
let bandsCacheTime = 0;
let curatorsCache = null;
let curatorsCacheTime = 0;
let eventsCache = null;
let eventsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --------------- Crawler detection ---------------
const CRAWLER_UA_PATTERNS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'slackbot',
  'vkshare',
  'pinterestbot',
  'viber',
  'embedly',
  'quora link preview',
  'shoyu',
  'outbrain',
  'redditbot',
  'rogerbot',
  'duckduckbot',
  'ia_archiver',
  'applebot',
  'seznambot',
  'skypeuripreview',
  'google-structured-data-testing-tool',
];

function isCrawler(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_UA_PATTERNS.some(p => ua.includes(p));
}

// --------------- Macedonian Cyrillic transliteration ---------------
// Must match the logic in artist.html exactly
const cyrillicToLatinMap = {
  'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
  'Д': 'D', 'д': 'd', 'Ѓ': 'Gj', 'ѓ': 'gj', 'Е': 'E', 'е': 'e', 'Ж': 'Zh', 'ж': 'zh',
  'З': 'Z', 'з': 'z', 'Ѕ': 'Dz', 'ѕ': 'dz', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
  'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'Lj', 'љ': 'lj', 'М': 'M', 'м': 'm',
  'Н': 'N', 'н': 'n', 'Њ': 'Nj', 'њ': 'nj', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
  'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'Kj', 'ќ': 'kj',
  'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
  'Ч': 'Ch', 'ч': 'ch', 'Џ': 'Dz', 'џ': 'dz', 'Ш': 'Sh', 'ш': 'sh',
};

function transliterate(text) {
  return text.split('').map(c => cyrillicToLatinMap[c] || c).join('');
}

function generateSlug(name) {
  return transliterate(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --------------- Known static paths (do not treat as artist slugs) ---------------
const STATIC_PATHS = new Set([
  '/', '/index.html', '/lista', '/lista.html',
  '/nastani', '/nastani.html', '/vesti', '/vesti.html',
  '/kustosi', '/kustosi.html', '/iznenadi-me', '/iznenadi-me.html',
  '/za', '/za.html', '/privatnost', '/privatnost.html',
  '/uslovi', '/uslovi.html', '/admin', '/admin.html',
  '/404.html',
  '/robots.txt', '/sitemap.xml', '/CNAME',
  '/desktop.css', '/mobile.css', '/script.js', '/spotify-api.js',
  '/bands.json', '/chart-data.json', '/curators-tracklists.json',
  '/curators.json', '/events.json', '/articles.json', '/rss-feeds.json',
  '/favicon.svg', '/og-image.svg', '/og-image.png', '/logo.png',
  '/apple-touch-icon.png', '/mmm-drafts.js', '/tour.js',
  '/napredno',
]);

const STATIC_DIR_PREFIXES = ['/chart-history/', '/scripts/', '/workers/', '/greetings/'];

// --------------- Data fetching with cache ---------------
async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'TopListaMK-OGWorker/1.0' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!resp.ok) throw new Error(`Fetch failed: ${url} (${resp.status})`);
  return resp.json();
}

async function getBands() {
  const now = Date.now();
  if (bandsCache && (now - bandsCacheTime) < CACHE_TTL) return bandsCache;
  bandsCache = await fetchJson(`${GITHUB_RAW_BASE}/bands.json`);
  bandsCacheTime = now;
  return bandsCache;
}

async function getCurators() {
  const now = Date.now();
  if (curatorsCache && (now - curatorsCacheTime) < CACHE_TTL) return curatorsCache;
  curatorsCache = await fetchJson(`${GITHUB_RAW_BASE}/curators.json`);
  curatorsCacheTime = now;
  return curatorsCache;
}

async function getEvents() {
  const now = Date.now();
  if (eventsCache && (now - eventsCacheTime) < CACHE_TTL) return eventsCache;
  eventsCache = await fetchJson(`${GITHUB_RAW_BASE}/events.json`);
  eventsCacheTime = now;
  return eventsCache;
}

// --------------- Artist lookup (mirrors artist.html logic) ---------------
function findArtist(bandsData, searchParam) {
  const decoded = decodeURIComponent(searchParam);
  // Exact name
  let a = bandsData.find(b => b.name === decoded);
  if (a) return a;
  // Slug match
  a = bandsData.find(b => generateSlug(b.name) === decoded);
  if (a) return a;
  // Case-insensitive name
  const lower = decoded.toLowerCase();
  a = bandsData.find(b => b.name.toLowerCase() === lower);
  if (a) return a;
  // Transliterated case-insensitive
  a = bandsData.find(b => transliterate(b.name).toLowerCase() === lower);
  if (a) return a;
  return null;
}

// --------------- HTML builder ---------------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildOgHtml({ title, description, image, url, type = 'website' }) {
  return `<!DOCTYPE html>
<html lang="mk">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="${esc(type)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="640">
<meta property="og:image:height" content="640">
<meta property="og:locale" content="mk_MK">
<meta property="og:site_name" content="Топ Листа МК">
<meta property="twitter:card" content="summary_large_image">
<meta property="twitter:url" content="${esc(url)}">
<meta property="twitter:title" content="${esc(title)}">
<meta property="twitter:description" content="${esc(description)}">
<meta property="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(url)}">
</head>
<body></body>
</html>`;
}

// --------------- Response helper ---------------
const OG_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

function ogResponse(opts) {
  return new Response(buildOgHtml(opts), { status: 200, headers: OG_HEADERS });
}

// --------------- Entity OG builders ---------------
async function handleArtist(searchParam) {
  const data = await getBands();
  const artist = findArtist(data.muzickaMasterLista || [], searchParam);
  if (!artist) return null;

  return ogResponse({
    title: `${artist.name} | ТопЛиста.мк`,
    description: `${artist.name} - ${artist.genre || 'Македонски артист'}. Сите линкови и информации на едно место.`,
    image: artist.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/${encodeURIComponent(generateSlug(artist.name))}`,
    type: 'profile',
  });
}

async function handleCurator(searchParam) {
  const data = await getCurators();
  const curators = data.curators || [];
  const curator = curators.find(c => generateSlug(c.name) === searchParam)
    || curators.find(c => c.name === searchParam || c.name.toLowerCase() === searchParam.toLowerCase());
  if (!curator) return null;

  return ogResponse({
    title: `${curator.name} — Кустос | ТопЛиста.мк`,
    description: `Курирана плејлиста од ${curator.name}`,
    image: curator.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/kustos/${generateSlug(curator.name)}`,
    type: 'profile',
  });
}

async function handleEvent(eventId) {
  const data = await getEvents();
  const events = data.events || [];
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const datePart = event.date ? ` (${event.date})` : '';
  const placePart = event.place ? ` — ${event.place}` : '';

  return ogResponse({
    title: `${event.title}${datePart} | ТопЛиста.мк`,
    description: `${event.title}${placePart}${datePart}`,
    image: DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/nastan/${encodeURIComponent(event.id)}`,
    type: 'event',
  });
}

// --------------- Main handler ---------------

function defaultOgFallback() {
  return ogResponse({
    title: 'ТопЛиста.мк',
    description: 'Македонска музичка топ листа — откријте ги најпопуларните македонски песни, артисти, нови изданија и настани.',
    image: DEFAULT_OG_IMAGE,
    url: SITE_URL,
  });
}

export default {
  async fetch(request) {
    const ua = request.headers.get('User-Agent') || '';

    // Only intercept crawlers
    if (!isCrawler(ua)) {
      return fetch(request);
    }

    const url = new URL(request.url);
    const rawPath = url.pathname;

    try {
      // ==================== .html?param pages (redirect targets) ====================
      // Crawlers may follow the 404.html JS redirect → artist.html?a=slug etc.
      // Handle these BEFORE the static-path skip so crawlers still get proper OG tags.

      if (rawPath === '/artist.html' || rawPath === '/artist') {
        const artistParam = url.searchParams.get('a');
        if (artistParam) {
          const resp = await handleArtist(decodeURIComponent(artistParam));
          if (resp) return resp;
        }
        return defaultOgFallback();
      }

      if (rawPath === '/kustos.html') {
        const nameParam = url.searchParams.get('name');
        if (nameParam) {
          const resp = await handleCurator(decodeURIComponent(nameParam));
          if (resp) return resp;
        }
        return defaultOgFallback();
      }

      if (rawPath === '/nastan.html') {
        const idParam = url.searchParams.get('id');
        if (idParam) {
          const resp = await handleEvent(decodeURIComponent(idParam));
          if (resp) return resp;
        }
        return defaultOgFallback();
      }

      // ==================== Charts page ====================
      if (rawPath === '/charts' || rawPath === '/charts.html') {
        return ogResponse({
          title: 'Македонска Музичка Топ Листа | ТопЛиста.мк',
          description: 'Откријте ги најпопуларните македонски песни и албуми. Топ листа на сингли, албуми и нови изданија од македонската музичка сцена.',
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/charts`,
        });
      }

      // ==================== Chart preset routes ====================
      if (rawPath === '/alternativna') {
        return ogResponse({
          title: 'Алтернативна Топ Листа | ТопЛиста.мк',
          description: 'Топ листа на најпопуларни македонски алтернативни песни.',
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/alternativna`,
        });
      }
      if (rawPath === '/site-vreminja') {
        return ogResponse({
          title: 'Топ Листа — Сите Времиња | ТопЛиста.мк',
          description: 'Најпопуларните македонски песни од сите времиња.',
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/site-vreminja`,
        });
      }

      // Skip static assets and known pages — let origin handle them
      if (STATIC_PATHS.has(rawPath)) return fetch(request);
      if (STATIC_DIR_PREFIXES.some(d => rawPath.startsWith(d))) return fetch(request);
      // Skip anything with a file extension (css, js, json, png, jpg, svg, etc.)
      if (/\.[a-zA-Z0-9]{2,5}$/.test(rawPath)) return fetch(request);

      const path = decodeURIComponent(rawPath);

      // ==================== CURATOR: /kustos/{slug} ====================
      if (path.startsWith('/kustos/')) {
        const slug = path.substring('/kustos/'.length).replace(/\/$/, '');
        if (!slug) return defaultOgFallback();
        const resp = await handleCurator(slug);
        return resp || defaultOgFallback();
      }

      // ==================== EVENT: /nastan/{id} ====================
      if (path.startsWith('/nastan/')) {
        const eventId = path.substring('/nastan/'.length).replace(/\/$/, '');
        if (!eventId) return defaultOgFallback();
        const resp = await handleEvent(eventId);
        return resp || defaultOgFallback();
      }

      // ==================== ARTIST: /{slug} ====================
      const slug = path.substring(1).replace(/\/$/, '');
      if (!slug || slug.includes('/')) return defaultOgFallback();

      const resp = await handleArtist(slug);
      return resp || defaultOgFallback();
    } catch (err) {
      // On any error, return default OG so crawlers still get a preview
      console.error('OG worker error:', err);
      return defaultOgFallback();
    }
  },
};
