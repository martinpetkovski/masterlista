var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-v0UeH2/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/og-worker.js
var GITHUB_RAW_BASE = "https://raw.githubusercontent.com/martinpetkovski/masterlista/master";
var SITE_URL = "https://toplista.mk";
var DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;
var bandsCache = null;
var bandsCacheTime = 0;
var curatorsCache = null;
var curatorsCacheTime = 0;
var eventsCache = null;
var eventsCacheTime = 0;
var CACHE_TTL = 5 * 60 * 1e3;
var CRAWLER_UA_PATTERNS = [
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "slackbot",
  "vkshare",
  "pinterestbot",
  "viber",
  "embedly",
  "quora link preview",
  "shoyu",
  "outbrain",
  "redditbot",
  "rogerbot",
  "duckduckbot",
  "ia_archiver",
  "applebot",
  "seznambot",
  "skypeuripreview",
  "google-structured-data-testing-tool"
];
function isCrawler(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_UA_PATTERNS.some((p) => ua.includes(p));
}
__name(isCrawler, "isCrawler");
var cyrillicToLatinMap = {
  "\u0410": "A",
  "\u0430": "a",
  "\u0411": "B",
  "\u0431": "b",
  "\u0412": "V",
  "\u0432": "v",
  "\u0413": "G",
  "\u0433": "g",
  "\u0414": "D",
  "\u0434": "d",
  "\u0403": "Gj",
  "\u0453": "gj",
  "\u0415": "E",
  "\u0435": "e",
  "\u0416": "Zh",
  "\u0436": "zh",
  "\u0417": "Z",
  "\u0437": "z",
  "\u0405": "Dz",
  "\u0455": "dz",
  "\u0418": "I",
  "\u0438": "i",
  "\u0408": "J",
  "\u0458": "j",
  "\u041A": "K",
  "\u043A": "k",
  "\u041B": "L",
  "\u043B": "l",
  "\u0409": "Lj",
  "\u0459": "lj",
  "\u041C": "M",
  "\u043C": "m",
  "\u041D": "N",
  "\u043D": "n",
  "\u040A": "Nj",
  "\u045A": "nj",
  "\u041E": "O",
  "\u043E": "o",
  "\u041F": "P",
  "\u043F": "p",
  "\u0420": "R",
  "\u0440": "r",
  "\u0421": "S",
  "\u0441": "s",
  "\u0422": "T",
  "\u0442": "t",
  "\u040C": "Kj",
  "\u045C": "kj",
  "\u0423": "U",
  "\u0443": "u",
  "\u0424": "F",
  "\u0444": "f",
  "\u0425": "H",
  "\u0445": "h",
  "\u0426": "C",
  "\u0446": "c",
  "\u0427": "Ch",
  "\u0447": "ch",
  "\u040F": "Dz",
  "\u045F": "dz",
  "\u0428": "Sh",
  "\u0448": "sh"
};
function transliterate(text) {
  return text.split("").map((c) => cyrillicToLatinMap[c] || c).join("");
}
__name(transliterate, "transliterate");
function generateSlug(name) {
  return transliterate(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(generateSlug, "generateSlug");
var STATIC_PATHS = /* @__PURE__ */ new Set([
  "/",
  "/index.html",
  "/lista",
  "/lista.html",
  "/nastani",
  "/nastani.html",
  "/vesti",
  "/vesti.html",
  "/kustosi",
  "/kustosi.html",
  "/iznenadi-me",
  "/iznenadi-me.html",
  "/za",
  "/za.html",
  "/privatnost",
  "/privatnost.html",
  "/uslovi",
  "/uslovi.html",
  "/admin",
  "/admin.html",
  "/404.html",
  "/robots.txt",
  "/sitemap.xml",
  "/CNAME",
  "/desktop.css",
  "/mobile.css",
  "/script.js",
  "/spotify-api.js",
  "/bands.json",
  "/chart-data.json",
  "/curators-tracklists.json",
  "/curators.json",
  "/events.json",
  "/articles.json",
  "/rss-feeds.json",
  "/favicon.svg",
  "/og-image.svg",
  "/og-image.png",
  "/logo.png",
  "/apple-touch-icon.png",
  "/mmm-drafts.js",
  "/tour.js",
  "/napredno"
]);
var STATIC_DIR_PREFIXES = ["/chart-history/", "/scripts/", "/workers/", "/greetings/"];
async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "TopListaMK-OGWorker/1.0" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!resp.ok) throw new Error(`Fetch failed: ${url} (${resp.status})`);
  const text = await resp.text();
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}
__name(fetchJson, "fetchJson");
async function getBands() {
  const now = Date.now();
  if (bandsCache && now - bandsCacheTime < CACHE_TTL) return bandsCache;
  bandsCache = await fetchJson(`${GITHUB_RAW_BASE}/bands.json`);
  bandsCacheTime = now;
  return bandsCache;
}
__name(getBands, "getBands");
async function getCurators() {
  const now = Date.now();
  if (curatorsCache && now - curatorsCacheTime < CACHE_TTL) return curatorsCache;
  curatorsCache = await fetchJson(`${GITHUB_RAW_BASE}/curators.json`);
  curatorsCacheTime = now;
  return curatorsCache;
}
__name(getCurators, "getCurators");
async function getEvents() {
  const now = Date.now();
  if (eventsCache && now - eventsCacheTime < CACHE_TTL) return eventsCache;
  eventsCache = await fetchJson(`${GITHUB_RAW_BASE}/events.json`);
  eventsCacheTime = now;
  return eventsCache;
}
__name(getEvents, "getEvents");
function findArtist(bandsData, searchParam) {
  const decoded = decodeURIComponent(searchParam);
  let a = bandsData.find((b) => b.name === decoded);
  if (a) return a;
  a = bandsData.find((b) => generateSlug(b.name) === decoded);
  if (a) return a;
  const lower = decoded.toLowerCase();
  a = bandsData.find((b) => b.name.toLowerCase() === lower);
  if (a) return a;
  a = bandsData.find((b) => transliterate(b.name).toLowerCase() === lower);
  if (a) return a;
  return null;
}
__name(findArtist, "findArtist");
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(esc, "esc");
function buildOgHtml({ title, description, image, url, type = "website" }) {
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
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<meta property="og:locale" content="mk_MK">
<meta property="og:site_name" content="\u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430 \u041C\u041A">
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
__name(buildOgHtml, "buildOgHtml");
var OG_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" };
function ogResponse(opts) {
  return new Response(buildOgHtml(opts), { status: 200, headers: OG_HEADERS });
}
__name(ogResponse, "ogResponse");
async function handleArtist(searchParam) {
  const data = await getBands();
  const artist = findArtist(data.muzickaMasterLista || [], searchParam);
  if (!artist) return null;
  return ogResponse({
    title: `${artist.name} | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A`,
    description: `${artist.name} - ${artist.genre || "\u041C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438 \u0430\u0440\u0442\u0438\u0441\u0442"}. \u0421\u0438\u0442\u0435 \u043B\u0438\u043D\u043A\u043E\u0432\u0438 \u0438 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438 \u043D\u0430 \u0435\u0434\u043D\u043E \u043C\u0435\u0441\u0442\u043E.`,
    image: artist.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/${encodeURIComponent(generateSlug(artist.name))}`,
    type: "profile"
  });
}
__name(handleArtist, "handleArtist");
async function handleCurator(searchParam) {
  const data = await getCurators();
  const curators = data.curators || [];
  const curator = curators.find((c) => generateSlug(c.name) === searchParam) || curators.find((c) => c.name === searchParam || c.name.toLowerCase() === searchParam.toLowerCase());
  if (!curator) return null;
  return ogResponse({
    title: `${curator.name} \u2014 \u041A\u0443\u0441\u0442\u043E\u0441 | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A`,
    description: `\u041A\u0443\u0440\u0438\u0440\u0430\u043D\u0430 \u043F\u043B\u0435\u0458\u043B\u0438\u0441\u0442\u0430 \u043E\u0434 ${curator.name}`,
    image: curator.image || DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/kustos/${generateSlug(curator.name)}`,
    type: "profile"
  });
}
__name(handleCurator, "handleCurator");
async function handleEvent(eventId) {
  const data = await getEvents();
  const events = data.events || [];
  const event = events.find((e) => e.id === eventId);
  if (!event) return null;
  const datePart = event.date ? ` (${event.date})` : "";
  const placePart = event.place ? ` \u2014 ${event.place}` : "";
  return ogResponse({
    title: `${event.title}${datePart} | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A`,
    description: `${event.title}${placePart}${datePart}`,
    image: DEFAULT_OG_IMAGE,
    url: `${SITE_URL}/nastan/${encodeURIComponent(event.id)}`,
    type: "event"
  });
}
__name(handleEvent, "handleEvent");
function defaultOgFallback() {
  return ogResponse({
    title: "\u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A",
    description: "\u041C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0430 \u043C\u0443\u0437\u0438\u0447\u043A\u0430 \u0442\u043E\u043F \u043B\u0438\u0441\u0442\u0430 \u2014 \u043E\u0442\u043A\u0440\u0438\u0458\u0442\u0435 \u0433\u0438 \u043D\u0430\u0458\u043F\u043E\u043F\u0443\u043B\u0430\u0440\u043D\u0438\u0442\u0435 \u043C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438 \u043F\u0435\u0441\u043D\u0438, \u0430\u0440\u0442\u0438\u0441\u0442\u0438, \u043D\u043E\u0432\u0438 \u0438\u0437\u0434\u0430\u043D\u0438\u0458\u0430 \u0438 \u043D\u0430\u0441\u0442\u0430\u043D\u0438.",
    image: DEFAULT_OG_IMAGE,
    url: SITE_URL
  });
}
__name(defaultOgFallback, "defaultOgFallback");
var og_worker_default = {
  async fetch(request) {
    const ua = request.headers.get("User-Agent") || "";
    if (!isCrawler(ua)) {
      return fetch(request);
    }
    const url = new URL(request.url);
    const rawPath = url.pathname;
    try {
      if (rawPath === "/artist.html" || rawPath === "/artist") {
        const artistParam = url.searchParams.get("a");
        if (artistParam) {
          const resp2 = await handleArtist(decodeURIComponent(artistParam));
          if (resp2) return resp2;
        }
        return defaultOgFallback();
      }
      if (rawPath === "/kustos.html") {
        const nameParam = url.searchParams.get("name");
        if (nameParam) {
          const resp2 = await handleCurator(decodeURIComponent(nameParam));
          if (resp2) return resp2;
        }
        return defaultOgFallback();
      }
      if (rawPath === "/nastan.html") {
        const idParam = url.searchParams.get("id");
        if (idParam) {
          const resp2 = await handleEvent(decodeURIComponent(idParam));
          if (resp2) return resp2;
        }
        return defaultOgFallback();
      }
      if (rawPath === "/charts" || rawPath === "/charts.html") {
        return ogResponse({
          title: "\u041C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0430 \u041C\u0443\u0437\u0438\u0447\u043A\u0430 \u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430 | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A",
          description: "\u041E\u0442\u043A\u0440\u0438\u0458\u0442\u0435 \u0433\u0438 \u043D\u0430\u0458\u043F\u043E\u043F\u0443\u043B\u0430\u0440\u043D\u0438\u0442\u0435 \u043C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438 \u043F\u0435\u0441\u043D\u0438 \u0438 \u0430\u043B\u0431\u0443\u043C\u0438. \u0422\u043E\u043F \u043B\u0438\u0441\u0442\u0430 \u043D\u0430 \u0441\u0438\u043D\u0433\u043B\u0438, \u0430\u043B\u0431\u0443\u043C\u0438 \u0438 \u043D\u043E\u0432\u0438 \u0438\u0437\u0434\u0430\u043D\u0438\u0458\u0430 \u043E\u0434 \u043C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0430\u0442\u0430 \u043C\u0443\u0437\u0438\u0447\u043A\u0430 \u0441\u0446\u0435\u043D\u0430.",
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/charts`
        });
      }
      if (rawPath === "/alternativna") {
        return ogResponse({
          title: "\u0410\u043B\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u043D\u0430 \u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430 | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A",
          description: "\u0422\u043E\u043F \u043B\u0438\u0441\u0442\u0430 \u043D\u0430 \u043D\u0430\u0458\u043F\u043E\u043F\u0443\u043B\u0430\u0440\u043D\u0438 \u043C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438 \u0430\u043B\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u043D\u0438 \u043F\u0435\u0441\u043D\u0438.",
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/alternativna`
        });
      }
      if (rawPath === "/site-vreminja") {
        return ogResponse({
          title: "\u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430 \u2014 \u0421\u0438\u0442\u0435 \u0412\u0440\u0435\u043C\u0438\u045A\u0430 | \u0422\u043E\u043F\u041B\u0438\u0441\u0442\u0430.\u043C\u043A",
          description: "\u041D\u0430\u0458\u043F\u043E\u043F\u0443\u043B\u0430\u0440\u043D\u0438\u0442\u0435 \u043C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438 \u043F\u0435\u0441\u043D\u0438 \u043E\u0434 \u0441\u0438\u0442\u0435 \u0432\u0440\u0435\u043C\u0438\u045A\u0430.",
          image: DEFAULT_OG_IMAGE,
          url: `${SITE_URL}/site-vreminja`
        });
      }
      if (STATIC_PATHS.has(rawPath)) return fetch(request);
      if (STATIC_DIR_PREFIXES.some((d) => rawPath.startsWith(d))) return fetch(request);
      if (/\.[a-zA-Z0-9]{2,5}$/.test(rawPath)) return fetch(request);
      const path = decodeURIComponent(rawPath);
      if (path.startsWith("/kustos/")) {
        const slug2 = path.substring("/kustos/".length).replace(/\/$/, "");
        if (!slug2) return defaultOgFallback();
        const resp2 = await handleCurator(slug2);
        return resp2 || defaultOgFallback();
      }
      if (path.startsWith("/nastan/")) {
        const eventId = path.substring("/nastan/".length).replace(/\/$/, "");
        if (!eventId) return defaultOgFallback();
        const resp2 = await handleEvent(eventId);
        return resp2 || defaultOgFallback();
      }
      const slug = path.substring(1).replace(/\/$/, "");
      if (!slug || slug.includes("/")) return defaultOgFallback();
      const resp = await handleArtist(slug);
      return resp || defaultOgFallback();
    } catch (err) {
      console.error("OG worker error:", err);
      return defaultOgFallback();
    }
  }
};

// ../../../../Users/deeee/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../Users/deeee/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-v0UeH2/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = og_worker_default;

// ../../../../Users/deeee/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-v0UeH2/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=og-worker.js.map
