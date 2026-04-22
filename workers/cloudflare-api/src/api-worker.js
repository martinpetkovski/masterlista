// ==================== TopLista.mk Public API Worker ====================
// Cloudflare Worker that provides a REST API on top of the static JSON files.

const CACHE_TTL = 300; // 5 minutes

// ==================== CORS ====================
function buildCors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowThisOrigin = origin && configured.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowThisOrigin ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL}` },
  });
}

// ==================== RATE LIMITING ====================
const rlMap = new Map();
let lastCleanup = Date.now();

function rateLimit(ip, max, windowMs) {
  const now = Date.now();
  if (now - lastCleanup > windowMs * 10) {
    for (const [k, v] of rlMap.entries()) if (now - v.first > windowMs) rlMap.delete(k);
    lastCleanup = now;
  }
  const entry = rlMap.get(ip);
  if (!entry) { rlMap.set(ip, { count: 1, first: now }); return true; }
  if (now - entry.first > windowMs) { rlMap.set(ip, { count: 1, first: now }); return true; }
  entry.count += 1;
  return entry.count <= max;
}

// ==================== FETCH + CACHE JSON ====================
const jsonCache = new Map();

const DATA_FILE_MAP = new Map([
  ['bands.json', 'data/dynamic/editable/bands.json'],
  ['events.json', 'data/dynamic/editable/events.json'],
  ['releases.json', 'data/dynamic/editable/releases.json'],
  ['genres.json', 'data/static/genres.json'],
  ['chart-data.json', 'data/dynamic/generated/chart-data.json'],
  ['articles.json', 'data/dynamic/generated/articles.json'],
  ['articles-filtered.json', 'data/dynamic/generated/articles-filtered.json'],
  ['curators.json', 'data/static/curators.json'],
  ['chart-genres.json', 'data/static/chart-genres.json'],
]);

function resolveDataPath(file) {
  if (DATA_FILE_MAP.has(file)) return DATA_FILE_MAP.get(file);
  if (file.startsWith('chart-history/')) return `data/dynamic/generated/${file}`;
  if (file.startsWith('lang/')) return `data/static/${file}`;
  return file;
}

async function fetchJson(env, file) {
  const resolvedFile = resolveDataPath(file);
  const key = resolvedFile;
  const cached = jsonCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL * 1000) return cached.data;

  const origin = env.ORIGIN || 'https://toplista.mk';
  const resp = await fetch(`${origin}/${resolvedFile}`, {
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  jsonCache.set(key, { data, ts: Date.now() });
  return data;
}

// ==================== SLUG HELPER ====================
const cyrMap = {
  'А':'A','а':'a','Б':'B','б':'b','В':'V','в':'v','Г':'G','г':'g',
  'Д':'D','д':'d','Ѓ':'Gj','ѓ':'gj','Е':'E','е':'e','Ж':'Zh','ж':'zh',
  'З':'Z','з':'z','Ѕ':'Dz','ѕ':'dz','И':'I','и':'i','Ј':'J','ј':'j',
  'К':'K','к':'k','Л':'L','л':'l','Љ':'Lj','љ':'lj','М':'M','м':'m',
  'Н':'N','н':'n','Њ':'Nj','њ':'nj','О':'O','о':'o','П':'P','п':'p',
  'Р':'R','р':'r','С':'S','с':'s','Т':'T','т':'t','Ќ':'Kj','ќ':'kj',
  'У':'U','у':'u','Ф':'F','ф':'f','Х':'H','х':'h','Ц':'C','ц':'c',
  'Ч':'Ch','ч':'ch','Џ':'Dz','џ':'dz','Ш':'Sh','ш':'sh',
};

function toSlug(name) {
  return name.split('').map(c => cyrMap[c] || c).join('')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ==================== PAGINATION ====================
function paginate(arr, params) {
  const limit = Math.min(Math.max(parseInt(params.get('limit')) || 50, 1), 200);
  const offset = Math.max(parseInt(params.get('offset')) || 0, 0);
  return {
    total: arr.length,
    limit,
    offset,
    data: arr.slice(offset, offset + limit),
  };
}

// Case-insensitive includes for Cyrillic + Latin
function includes(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// ==================== ROUTE HANDLERS ====================

async function handleArtists(params, env) {
  const raw = await fetchJson(env, 'bands.json');
  if (!raw) return null;
  let artists = raw.muzickaMasterLista || [];

  const q = params.get('q');
  const city = params.get('city');
  const genre = params.get('genre');
  const confirmed = params.get('confirmed');

  if (q) artists = artists.filter(a =>
    includes(a.name, q) || includes(a.city, q) || includes(a.genre, q)
  );
  if (city) artists = artists.filter(a => includes(a.city, city));
  if (genre) artists = artists.filter(a => includes(a.genre, genre));
  if (confirmed === 'true') artists = artists.filter(a => a.confirmed);
  if (confirmed === 'false') artists = artists.filter(a => !a.confirmed);

  return paginate(artists, params);
}

async function handleArtistBySlug(slug, env) {
  const raw = await fetchJson(env, 'bands.json');
  if (!raw) return null;
  const artists = raw.muzickaMasterLista || [];
  const artist = artists.find(a => toSlug(a.name) === slug);
  return artist || null;
}

async function handleEvents(params, env) {
  const raw = await fetchJson(env, 'events.json');
  if (!raw) return null;
  let events = raw.events || [];

  const from = params.get('from');
  const to = params.get('to');
  const artist = params.get('artist');
  const upcoming = params.get('upcoming');

  if (from) events = events.filter(e => e.date >= from);
  if (to) events = events.filter(e => e.date <= to);
  if (artist) events = events.filter(e =>
    (e.artists || []).some(a => includes(a, artist))
  );
  if (upcoming === 'true') {
    const today = new Date().toISOString().slice(0, 10);
    events = events.filter(e => e.date >= today);
  }

  return paginate(events, params);
}

async function handleReleases(params, env) {
  const raw = await fetchJson(env, 'releases.json');
  if (!raw) return null;
  let releases = raw.releases || [];

  const artist = params.get('artist');
  const type = params.get('type');
  const from = params.get('from');
  const to = params.get('to');

  if (artist) releases = releases.filter(r =>
    includes(r.bandName, artist) || includes(r.spotifyName, artist)
  );
  if (type) releases = releases.filter(r => r.releaseType === type);
  if (from) releases = releases.filter(r => r.releaseDate >= from);
  if (to) releases = releases.filter(r => r.releaseDate <= to);

  return paginate(releases, params);
}

async function handleGenres(env) {
  const data = await fetchJson(env, 'genres.json');
  return data || [];
}

async function handleChart(env) {
  const data = await fetchJson(env, 'chart-data.json');
  return data || null;
}

async function handleChartHistory(week, env) {
  const data = await fetchJson(env, `chart-history/chart-${week}.json`);
  return data || null;
}

async function handleArticles(params, env) {
  const raw = await fetchJson(env, 'articles-filtered.json') || await fetchJson(env, 'articles.json');
  if (!raw) return null;
  let articles = raw.articles || raw.matched || [];

  const q = params.get('q');
  const source = params.get('source');
  const from = params.get('from');
  const to = params.get('to');

  if (q) articles = articles.filter(a =>
    includes(a.title, q) || includes(a.description, q)
  );
  if (source) articles = articles.filter(a => a.source === source);
  if (from) articles = articles.filter(a => a.date >= from);
  if (to) articles = articles.filter(a => a.date <= to);

  return paginate(articles, params);
}

async function handleCurators(env) {
  const raw = await fetchJson(env, 'curators.json');
  if (!raw) return null;
  return raw.curators || [];
}

async function handleChartGenres(env) {
  const data = await fetchJson(env, 'chart-genres.json');
  return data || null;
}

// ==================== MAIN ROUTER ====================
export default {
  async fetch(request, env) {
    const cors = buildCors(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    // Rate limit: 60 req/min per IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!rateLimit(ip, 60, 60000)) {
      return json({ error: 'Rate limit exceeded. Max 60 requests per minute.' }, 429, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const params = url.searchParams;

    try {
      // /api/v1/artists
      if (path === '/api/v1/artists') {
        const result = await handleArtists(params, env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/artists/:slug
      const artistMatch = path.match(/^\/api\/v1\/artists\/([a-z0-9-]+)$/);
      if (artistMatch) {
        const artist = await handleArtistBySlug(artistMatch[1], env);
        if (!artist) return json({ error: 'Artist not found' }, 404, cors);
        return json(artist, 200, cors);
      }

      // /api/v1/events
      if (path === '/api/v1/events') {
        const result = await handleEvents(params, env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/releases
      if (path === '/api/v1/releases') {
        const result = await handleReleases(params, env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/genres
      if (path === '/api/v1/genres') {
        const result = await handleGenres(env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/chart
      if (path === '/api/v1/chart') {
        const result = await handleChart(env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/chart/genres
      if (path === '/api/v1/chart/genres') {
        const result = await handleChartGenres(env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/chart/history/:week (e.g. 2026-W11)
      const historyMatch = path.match(/^\/api\/v1\/chart\/history\/(\d{4}-W\d{2})$/);
      if (historyMatch) {
        const result = await handleChartHistory(historyMatch[1], env);
        if (!result) return json({ error: 'Chart week not found' }, 404, cors);
        return json(result, 200, cors);
      }

      // /api/v1/articles
      if (path === '/api/v1/articles') {
        const result = await handleArticles(params, env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // /api/v1/curators
      if (path === '/api/v1/curators') {
        const result = await handleCurators(env);
        if (!result) return json({ error: 'Data unavailable' }, 502, cors);
        return json(result, 200, cors);
      }

      // Root: API info
      if (path === '/' || path === '/api' || path === '/api/v1') {
        return json({
          name: 'TopLista.mk API',
          version: 'v1',
          docs: 'https://toplista.mk/api',
          endpoints: [
            'GET /api/v1/artists',
            'GET /api/v1/artists/:slug',
            'GET /api/v1/events',
            'GET /api/v1/releases',
            'GET /api/v1/genres',
            'GET /api/v1/chart',
            'GET /api/v1/chart/genres',
            'GET /api/v1/chart/history/:week',
            'GET /api/v1/articles',
            'GET /api/v1/curators',
          ],
        }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'Internal error', detail: e.message }, 500, cors);
    }
  },
};
