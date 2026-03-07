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

// --------------- OG Translations ---------------
const OG_LOCALES = {
  mk: 'mk_MK', sr: 'sr_RS', sq: 'sq_AL', bg: 'bg_BG',
  el: 'el_GR', fr: 'fr_FR', de: 'de_DE', en: 'en_GB',
};

const OG_TRANSLATIONS = {
  mk: {
    siteName: 'Топ Листа МК',
    defaultTitle: 'ТопЛиста.мк',
    defaultDesc: 'Македонска музичка топ листа — откријте ги најпопуларните македонски песни, артисти, нови изданија и настани.',
    artistDesc: '{name} — {genre}. Сите линкови и информации на едно место.',
    artistGenreFallback: 'Македонски артист',
    curatorTitle: '{name} — Кустос | ТопЛиста.мк',
    curatorDesc: 'Курирана плејлиста од {name}',
    chartsTitle: 'Македонска Музичка Топ Листа | ТопЛиста.мк',
    chartsDesc: 'Откријте ги најпопуларните македонски песни и албуми. Топ листа на сингли, албуми и нови изданија од македонската музичка сцена.',
    altTitle: 'Алтернативна Топ Листа | ТопЛиста.мк',
    altDesc: 'Топ листа на најпопуларни македонски алтернативни песни.',
    allTimeTitle: 'Топ Листа — Сите Времиња | ТопЛиста.мк',
    allTimeDesc: 'Најпопуларните македонски песни од сите времиња.',
  },
  en: {
    siteName: 'Top Lista MK',
    defaultTitle: 'TopLista.mk',
    defaultDesc: 'Macedonian music chart — discover the most popular Macedonian songs, artists, new releases and events.',
    artistDesc: '{name} — {genre}. All links and info in one place.',
    artistGenreFallback: 'Macedonian artist',
    curatorTitle: '{name} — Curator | TopLista.mk',
    curatorDesc: 'Curated playlist by {name}',
    chartsTitle: 'Macedonian Music Chart | TopLista.mk',
    chartsDesc: 'Discover the most popular Macedonian songs and albums. Chart of singles, albums and new releases from the Macedonian music scene.',
    altTitle: 'Alternative Chart | TopLista.mk',
    altDesc: 'Chart of the most popular Macedonian alternative songs.',
    allTimeTitle: 'Chart — All Time | TopLista.mk',
    allTimeDesc: 'The most popular Macedonian songs of all time.',
  },
  sr: {
    siteName: 'Топ Листа МК',
    defaultTitle: 'ТопЛиста.мк',
    defaultDesc: 'Македонска музичка топ листа — откријте најпопуларније македонске песме, извођаче, нова издања и догаћаје.',
    artistDesc: '{name} — {genre}. Сви линкови и информације на једном месту.',
    artistGenreFallback: 'Македонски извођач',
    curatorTitle: '{name} — Кустос | ТопЛиста.мк',
    curatorDesc: 'Курирана плејлиста од {name}',
    chartsTitle: 'Македонска Музичка Топ Листа | ТопЛиста.мк',
    chartsDesc: 'Откријте најпопуларније македонске песме и албуме. Топ листа синглова, албума и нових издања македонске музичке сцене.',
    altTitle: 'Алтернативна Топ Листа | ТопЛиста.мк',
    altDesc: 'Топ листа најпопуларнијих македонских алтернативних песама.',
    allTimeTitle: 'Топ Листа — Сва Времена | ТопЛиста.мк',
    allTimeDesc: 'Најпопуларније македонске песме свих времена.',
  },
  bg: {
    siteName: 'Топ Листа МК',
    defaultTitle: 'ТопЛиста.мк',
    defaultDesc: 'Македонска музикална топ листа — открийте най-популярните македонски песни, артисти, нови издания и събития.',
    artistDesc: '{name} — {genre}. Всички линкове и информация на едно място.',
    artistGenreFallback: 'Македонски артист',
    curatorTitle: '{name} — Кустос | ТопЛиста.мк',
    curatorDesc: 'Курирана плейлиста от {name}',
    chartsTitle: 'Македонска Музикална Топ Листа | ТопЛиста.мк',
    chartsDesc: 'Открийте най-популярните македонски песни и албуми. Топ листа на сингли, албуми и нови издания от македонската музикална сцена.',
    altTitle: 'Алтернативна Топ Листа | ТопЛиста.мк',
    altDesc: 'Топ листа на най-популярните македонски алтернативни песни.',
    allTimeTitle: 'Топ Листа — Всички Времена | ТопЛиста.мк',
    allTimeDesc: 'Най-популярните македонски песни от всички времена.',
  },
  sq: {
    siteName: 'Top Lista MK',
    defaultTitle: 'TopLista.mk',
    defaultDesc: 'Lista muzikore maqedonase — zbuloni këngët, artistët, botimet e reja dhe ngjarjet më të popullarizuara maqedonase.',
    artistDesc: '{name} — {genre}. Të gjitha lidhjet dhe informacionet në një vend.',
    artistGenreFallback: 'Artist maqedonas',
    curatorTitle: '{name} — Kurator | TopLista.mk',
    curatorDesc: 'Listë muzikore e kuruar nga {name}',
    chartsTitle: 'Lista Muzikore Maqedonase | TopLista.mk',
    chartsDesc: 'Zbuloni këngët dhe albumet më të popullarizuara maqedonase. Lista e singlave, albumeve dhe botimeve të reja nga skena muzikore maqedonase.',
    altTitle: 'Lista Alternative | TopLista.mk',
    altDesc: 'Lista e këngëve alternative maqedonase më të popullarizuara.',
    allTimeTitle: 'Lista — Të Gjitha Kohërat | TopLista.mk',
    allTimeDesc: 'Këngët maqedonase më të popullarizuara të të gjitha kohërave.',
  },
  el: {
    siteName: 'Τοπ Λίστα ΜΚ',
    defaultTitle: 'TopLista.mk',
    defaultDesc: 'Μακεδονικό μουσικό chart — ανακαλύψτε τα πιο δημοφιλή μακεδονικά τραγούδια, καλλιτέχνες, νέες κυκλοφορίες και εκδηλώσεις.',
    artistDesc: '{name} — {genre}. Όλοι οι σύνδεσμοι και πληροφορίες σε ένα μέρος.',
    artistGenreFallback: 'Μακεδόνας καλλιτέχνης',
    curatorTitle: '{name} — Επιμελητής | TopLista.mk',
    curatorDesc: 'Επιμελημένη λίστα αναπαραγωγής από {name}',
    chartsTitle: 'Μακεδονικό Μουσικό Chart | TopLista.mk',
    chartsDesc: 'Ανακαλύψτε τα πιο δημοφιλή μακεδονικά τραγούδια και άλμπουμ. Chart σινγκλ, άλμπουμ και νέων κυκλοφοριών από τη μακεδονική μουσική σκηνή.',
    altTitle: 'Εναλλακτικό Chart | TopLista.mk',
    altDesc: 'Chart των πιο δημοφιλών μακεδονικών εναλλακτικών τραγουδιών.',
    allTimeTitle: 'Chart — Όλων των Εποχών | TopLista.mk',
    allTimeDesc: 'Τα πιο δημοφιλή μακεδονικά τραγούδια όλων των εποχών.',
  },
  fr: {
    siteName: 'Top Lista MK',
    defaultTitle: 'TopLista.mk',
    defaultDesc: 'Classement musical macédonien — découvrez les chansons, artistes, nouvelles sorties et événements macédoniens les plus populaires.',
    artistDesc: '{name} — {genre}. Tous les liens et infos en un seul endroit.',
    artistGenreFallback: 'Artiste macédonien',
    curatorTitle: '{name} — Curateur | TopLista.mk',
    curatorDesc: 'Playlist composée par {name}',
    chartsTitle: 'Classement Musical Macédonien | TopLista.mk',
    chartsDesc: 'Découvrez les chansons et albums macédoniens les plus populaires. Classement des singles, albums et nouvelles sorties de la scène musicale macédonienne.',
    altTitle: 'Classement Alternatif | TopLista.mk',
    altDesc: 'Classement des chansons alternatives macédoniennes les plus populaires.',
    allTimeTitle: 'Classement — Tous les Temps | TopLista.mk',
    allTimeDesc: 'Les chansons macédoniennes les plus populaires de tous les temps.',
  },
  de: {
    siteName: 'Top Lista MK',
    defaultTitle: 'TopLista.mk',
    defaultDesc: 'Mazedonische Musik-Charts — entdecken Sie die beliebtesten mazedonischen Songs, Künstler, Neuerscheinungen und Veranstaltungen.',
    artistDesc: '{name} — {genre}. Alle Links und Infos an einem Ort.',
    artistGenreFallback: 'Mazedonischer Künstler',
    curatorTitle: '{name} — Kurator | TopLista.mk',
    curatorDesc: 'Kuratierte Playlist von {name}',
    chartsTitle: 'Mazedonische Musik-Charts | TopLista.mk',
    chartsDesc: 'Entdecken Sie die beliebtesten mazedonischen Songs und Alben. Charts der Singles, Alben und Neuerscheinungen der mazedonischen Musikszene.',
    altTitle: 'Alternative Charts | TopLista.mk',
    altDesc: 'Charts der beliebtesten mazedonischen Alternative-Songs.',
    allTimeTitle: 'Charts — Aller Zeiten | TopLista.mk',
    allTimeDesc: 'Die beliebtesten mazedonischen Songs aller Zeiten.',
  },
};

function getOgT(lang) {
  return OG_TRANSLATIONS[lang] || OG_TRANSLATIONS.mk;
}

function getOgLocale(lang) {
  return OG_LOCALES[lang] || OG_LOCALES.mk;
}

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
  const text = await resp.text();
  return JSON.parse(text.replace(/^\uFEFF/, ''));
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

function buildOgHtml({ title, description, image, url, type = 'website', lang = 'mk' }) {
  const locale = getOgLocale(lang);
  const t = getOgT(lang);
  const htmlLang = lang || 'mk';
  return `<!DOCTYPE html>
<html lang="${esc(htmlLang)}">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="${esc(type)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<meta property="og:locale" content="${esc(locale)}">
<meta property="og:site_name" content="${esc(t.siteName)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${esc(url)}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
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
async function handleArtist(searchParam, lang) {
  const data = await getBands();
  const artist = findArtist(data.muzickaMasterLista || [], searchParam);
  if (!artist) return null;

  const t = getOgT(lang);
  const genre = artist.genre || t.artistGenreFallback;
  const description = t.artistDesc.replace('{name}', artist.name).replace('{genre}', genre);

  return ogResponse({
    title: `${artist.name} | ${t.defaultTitle}`,
    description,
    image: artist.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/${encodeURIComponent(generateSlug(artist.name))}`,
    type: 'profile',
    lang,
  });
}

async function handleCurator(searchParam, lang) {
  const data = await getCurators();
  const curators = data.curators || [];
  const curator = curators.find(c => generateSlug(c.name) === searchParam)
    || curators.find(c => c.name === searchParam || c.name.toLowerCase() === searchParam.toLowerCase());
  if (!curator) return null;

  const t = getOgT(lang);

  return ogResponse({
    title: t.curatorTitle.replace('{name}', curator.name),
    description: t.curatorDesc.replace('{name}', curator.name),
    image: curator.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/kustos/${generateSlug(curator.name)}`,
    type: 'profile',
    lang,
  });
}

async function handleEvent(eventId, lang) {
  const data = await getEvents();
  const events = data.events || [];
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const t = getOgT(lang);
  const datePart = event.date ? ` (${event.date})` : '';
  const placePart = event.place ? ` — ${event.place}` : '';

  return ogResponse({
    title: `${event.title}${datePart} | ${t.defaultTitle}`,
    description: `${event.title}${placePart}${datePart}`,
    image: DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/nastan/${encodeURIComponent(event.id)}`,
    type: 'event',
    lang,
  });
}

// --------------- Main handler ---------------

function defaultOgFallback(lang) {
  const t = getOgT(lang);
  return ogResponse({
    title: t.defaultTitle,
    description: t.defaultDesc,
    image: DEFAULT_OG_IMAGE,
    url: SITE_URL,
    lang,
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
    const lang = url.searchParams.get('lang') || 'mk';

    try {
      // ==================== .html?param pages (redirect targets) ====================
      // Crawlers may follow the 404.html JS redirect → artist.html?a=slug etc.
      // Handle these BEFORE the static-path skip so crawlers still get proper OG tags.

      if (rawPath === '/artist.html' || rawPath === '/artist') {
        const artistParam = url.searchParams.get('a');
        if (artistParam) {
          const resp = await handleArtist(decodeURIComponent(artistParam), lang);
          if (resp) return resp;
        }
        return defaultOgFallback(lang);
      }

      if (rawPath === '/kustos.html') {
        const nameParam = url.searchParams.get('name');
        if (nameParam) {
          const resp = await handleCurator(decodeURIComponent(nameParam), lang);
          if (resp) return resp;
        }
        return defaultOgFallback(lang);
      }

      if (rawPath === '/nastan.html') {
        const idParam = url.searchParams.get('id');
        if (idParam) {
          const resp = await handleEvent(decodeURIComponent(idParam), lang);
          if (resp) return resp;
        }
        return defaultOgFallback(lang);
      }

      // ==================== Charts page ====================
      if (rawPath === '/charts' || rawPath === '/charts.html') {
        const t = getOgT(lang);
        return ogResponse({
          title: t.chartsTitle,
          description: t.chartsDesc,
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/charts`,
          lang,
        });
      }

      // ==================== Chart preset routes ====================
      if (rawPath === '/alternativna') {
        const t = getOgT(lang);
        return ogResponse({
          title: t.altTitle,
          description: t.altDesc,
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/alternativna`,
          lang,
        });
      }
      if (rawPath === '/site-vreminja') {
        const t = getOgT(lang);
        return ogResponse({
          title: t.allTimeTitle,
          description: t.allTimeDesc,
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/site-vreminja`,
          lang,
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
        if (!slug) return defaultOgFallback(lang);
        const resp = await handleCurator(slug, lang);
        return resp || defaultOgFallback(lang);
      }

      // ==================== EVENT: /nastan/{id} ====================
      if (path.startsWith('/nastan/')) {
        const eventId = path.substring('/nastan/'.length).replace(/\/$/, '');
        if (!eventId) return defaultOgFallback(lang);
        const resp = await handleEvent(eventId, lang);
        return resp || defaultOgFallback(lang);
      }

      // ==================== ARTIST: /{slug} ====================
      const slug = path.substring(1).replace(/\/$/, '');
      if (!slug || slug.includes('/')) return defaultOgFallback(lang);

      const resp = await handleArtist(slug, lang);
      return resp || defaultOgFallback(lang);
    } catch (err) {
      // On any error, return default OG so crawlers still get a preview
      console.error('OG worker error:', err);
      return defaultOgFallback(lang);
    }
  },
};
