/**
 * scrape-articles.js
 *
 * Scrapes websites listed in rss-feeds.json for articles that may NOT appear
 * in the RSS feed (limited items, delayed publishing, etc.).
 * Acts as a complement to the RSS-based article fetch in update-all.ps1.
 *
 * Strategies (tried in order per site):
 *   1. WordPress REST API  –  /wp-json/wp/v2/posts  (structured JSON)
 *   2. HTML scraping        –  homepage article links → per-page og: tags
 *
 * Output is merged into articles.json in the exact same format used by the
 * RSS fetcher so the front-end treats all articles identically.
 *
 * Usage:
 *   node scripts/scrape-articles.js              # scrape all sites
 *   node scripts/scrape-articles.js --dry-run     # preview without writing
 *   node scripts/scrape-articles.js --site popup.mk  # scrape one site only
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, '..');
const FEEDS_PATH = path.join(ROOT, 'data', 'static', 'rss-feeds.json');
const ARTICLES_PATH = path.join(ROOT, 'data', 'dynamic', 'generated', 'articles.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT = 15000;       // ms per request
const DELAY_BETWEEN_SITES = 500;     // ms between sites
const DELAY_BETWEEN_PAGES = 300;     // ms between per-article fetches
const WP_POSTS_PER_PAGE = 40;        // how many posts to pull from WP API
const MAX_ARTICLE_PAGES = 15;        // max individual article pages to fetch per site (HTML mode)

// Sites where we know the WP REST API is NOT available (Squarespace, Wix, etc.)
const NON_WP_SITES = new Set([
  'www.mono-ton.com',       // Squarespace
  'www.kulturabeta.com',    // Wix / custom
]);

// ═══════════════════════════════════════════════════════════════════════════
//  CLI ARGS
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SITE_FILTER = (() => {
  const idx = args.indexOf('--site');
  return idx !== -1 && args[idx + 1] ? args[idx + 1].toLowerCase() : null;
})();

// ═══════════════════════════════════════════════════════════════════════════
//  FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, opts = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
      redirect: 'follow',
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url) {
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchHTML(url) {
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: 'text/html' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Strip HTML tags and collapse whitespace */
function stripHTML(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#8217;/gi, '\u2019')
    .replace(/&#8216;/gi, '\u2018')
    .replace(/&#8220;/gi, '\u201C')
    .replace(/&#8221;/gi, '\u201D')
    .replace(/&#8211;/gi, '\u2013')
    .replace(/&#8212;/gi, '\u2014')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rdquo;/gi, '\u201C')
    .replace(/&ldquo;/gi, '\u201D')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncate to maxLen, appending "..." */
function truncate(str, maxLen = 300) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/** Extract hostname from URL */
function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 1: WORDPRESS REST API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Try to fetch articles via the WordPress REST API.
 * Returns null if the site doesn't expose the WP API.
 */
async function scrapeViaWpApi(feed) {
  const base = feed.siteUrl.replace(/\/+$/, '');
  const host = hostname(base);

  // Skip known non-WP sites
  if (NON_WP_SITES.has(host)) return null;

  const endpoint =
    `${base}/wp-json/wp/v2/posts?per_page=${WP_POSTS_PER_PAGE}&_embed=wp:featuredmedia&orderby=date&order=desc`;

  try {
    const posts = await fetchJSON(endpoint);
    if (!Array.isArray(posts)) return null;

    return posts.map((post) => {
      // Extract thumbnail from embedded featured media
      let thumbnail = null;
      try {
        const media = post._embedded?.['wp:featuredmedia']?.[0];
        if (media) {
          // Prefer medium_large or medium size, fall back to full
          thumbnail =
            media.media_details?.sizes?.medium_large?.source_url ||
            media.media_details?.sizes?.medium?.source_url ||
            media.source_url ||
            null;
        }
      } catch { /* no thumbnail */ }

      // Extract description from excerpt
      let description = stripHTML(post.excerpt?.rendered || '');
      description = truncate(description);

      const dateObj = post.date ? new Date(post.date) : null;
      const articleDay = dateObj
        ? dateObj.toISOString().split('T')[0]
        : null;

      return {
        title: stripHTML(post.title?.rendered || ''),
        link: post.link,
        description,
        date: articleDay,
        source: feed.name,
        siteUrl: feed.siteUrl,
        iconUrl: feed.iconUrl,
        thumbnail,
        fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      };
    });
  } catch {
    // WP API not available or error – fall through to HTML scraping
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY 2: HTML SCRAPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract article-like links from homepage HTML.
 * Heuristic: links whose href looks like an article URL (contains a slug path)
 * rather than a category, tag, or pagination page.
 */
function extractArticleLinks(html, baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const host = hostname(base);

  // Collect all <a href="..."> with text (potential article links)
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const links = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = stripHTML(match[2]).trim();

    // Make absolute
    if (href.startsWith('/')) {
      href = base + href;
    } else if (!href.startsWith('http')) {
      continue;
    }

    // Must belong to the same host
    if (hostname(href) !== host) continue;

    // Skip non-article URLs
    if (isNonArticleUrl(href, base)) continue;

    // Must have meaningful link text (likely a title)
    if (!text || text.length < 10) continue;

    // Deduplicate
    const normalized = href.replace(/\/+$/, '').replace(/#.*$/, '');
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    links.push({ url: href, possibleTitle: text });
  }

  return links;
}

/** Heuristic: return true for URLs that are NOT articles */
function isNonArticleUrl(url, base) {
  const path = url.replace(base, '');
  const lower = path.toLowerCase();

  // Pagination
  if (/\/page\/\d+/i.test(lower)) return true;

  // Categories, tags, author pages
  if (/^\/(category|tag|author|wp-content|wp-admin|wp-login|feed|comments|search|cart|checkout|shop|profil|kontakt|za-nas|about|impresum)\b/i.test(lower)) return true;

  // Common non-article paths
  if (/^\/(#|javascript:|mailto:|tel:)/i.test(lower)) return true;

  // Very short path = probably not an article
  const segments = lower.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segments.length === 0) return true;

  // Single-segment paths are usually listing/section pages, not articles
  // e.g. /album-reviews, /interviews, /events, /nastani, /artisti
  if (segments.length === 1 && !/\d/.test(segments[0])) return true;

  // Date archive pages like /2026/02/
  if (/^\/\d{4}\/\d{2}\/?$/.test(lower)) return true;

  return false;
}

/**
 * Fetch an individual article page to extract metadata from og: / meta tags.
 */
async function extractArticleMeta(url) {
  try {
    const html = await fetchHTML(url);
    return parseMetaTags(html, url);
  } catch {
    return null;
  }
}

/** Parse Open Graph and other meta tags from HTML */
function parseMetaTags(html, url) {
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].trim() : null;
  };

  let title =
    get(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
    get(/<title[^>]*>([^<]+)<\/title>/i) ||
    '';

  // Decode entities first, then strip site-name suffix (e.g. " — mono-ton")
  title = stripHTML(title);
  title = title.replace(/\s*[\u2014\u2013|]\s*[^|\u2014\u2013]+$/, '');

  const description = truncate(
    stripHTML(
      get(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
        get(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i) ||
        get(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
        get(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i) ||
        ''
    )
  );

  const thumbnail =
    get(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
    null;

  // Date: try article:published_time, then datePublished in JSON-LD, then <time datetime="">
  let dateStr =
    get(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i) ||
    get(/<meta\s+content=["']([^"']+)["']\s+property=["']article:published_time["']/i) ||
    get(/"datePublished"\s*:\s*"([^"]+)"/i) ||
    get(/<time[^>]+datetime=["']([^"']+)["']/i) ||
    null;

  let date = null;
  if (dateStr) {
    try {
      date = new Date(dateStr).toISOString().split('T')[0];
    } catch { /* unparseable */ }
  }

  return {
    title,
    description,
    thumbnail,
    date,
  };
}

/**
 * Scrape a site by fetching its homepage HTML, extracting article links,
 * then fetching individual article pages for metadata.
 */
async function scrapeViaHtml(feed, existingLinks) {
  const base = feed.siteUrl.replace(/\/+$/, '');

  let html;
  try {
    html = await fetchHTML(base);
  } catch (err) {
    console.error(`    ✗ Failed to fetch homepage: ${err.message}`);
    return [];
  }

  // Extract article links from the homepage
  let candidates = extractArticleLinks(html, base);

  // Filter out already-known links
  candidates = candidates.filter((c) => {
    const norm = c.url.replace(/\/+$/, '');
    return !existingLinks.has(norm) && !existingLinks.has(norm + '/');
  });

  if (candidates.length === 0) return [];

  // Limit to MAX_ARTICLE_PAGES to avoid hammering the site
  const toFetch = candidates.slice(0, MAX_ARTICLE_PAGES);

  const articles = [];
  for (const candidate of toFetch) {
    await sleep(DELAY_BETWEEN_PAGES);

    const meta = await extractArticleMeta(candidate.url);
    if (!meta) continue;

    const title = meta.title || candidate.possibleTitle;
    if (!title) continue;

    articles.push({
      title,
      link: candidate.url,
      description: meta.description || '',
      date: meta.date,
      source: feed.name,
      siteUrl: feed.siteUrl,
      iconUrl: feed.iconUrl,
      thumbnail: meta.thumbnail || null,
      fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
  }

  return articles;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  ARTICLE SCRAPER – complement to RSS feeds');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) console.log('  ⚑  DRY RUN – articles.json will NOT be modified\n');

  // ── Load feeds ──────────────────────────────────────────────────────────
  if (!fs.existsSync(FEEDS_PATH)) {
    console.error('rss-feeds.json not found');
    process.exit(1);
  }

  let feeds = JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf8'));
  if (SITE_FILTER) {
    feeds = feeds.filter(
      (f) =>
        f.name.toLowerCase().includes(SITE_FILTER) ||
        hostname(f.siteUrl).includes(SITE_FILTER)
    );
    if (feeds.length === 0) {
      console.error(`No feed matched filter "${SITE_FILTER}"`);
      process.exit(1);
    }
  }
  console.log(`  Sites to scrape: ${feeds.length}`);

  // ── Load existing articles for deduplication ────────────────────────────
  const existingLinks = new Set();
  let existingArticles = [];

  if (fs.existsSync(ARTICLES_PATH)) {
    try {
      let raw = fs.readFileSync(ARTICLES_PATH, 'utf8');
      // Strip BOM if present (PowerShell sometimes writes UTF-8 BOM or UTF-16)
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const data = JSON.parse(raw);
      existingArticles = data.articles || [];
      for (const a of existingArticles) {
        if (a.link) {
          existingLinks.add(a.link.replace(/\/+$/, ''));
          existingLinks.add(a.link);
        }
      }
      console.log(`  Existing articles: ${existingArticles.length}`);
    } catch (err) {
      console.warn(`  ⚠ Could not parse articles.json: ${err.message}`);
    }
  }

  console.log('');

  // ── Scrape each site ───────────────────────────────────────────────────
  const allNew = [];
  let siteErrors = 0;

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const pct = Math.round(((i + 1) / feeds.length) * 100);
    process.stdout.write(
      `  [${i + 1}/${feeds.length}] ${feed.name.padEnd(20)} `
    );

    try {
      // Strategy 1: WordPress REST API
      let articles = await scrapeViaWpApi(feed);

      let method;
      if (articles !== null) {
        method = 'WP-API';
      } else {
        // Strategy 2: HTML scraping
        articles = await scrapeViaHtml(feed, existingLinks);
        method = 'HTML';
      }

      // Deduplicate against existing links
      const newArticles = articles.filter((a) => {
        const norm = a.link.replace(/\/+$/, '');
        return !existingLinks.has(norm) && !existingLinks.has(norm + '/');
      });

      // Register new links to avoid duplicates across sites
      for (const a of newArticles) {
        existingLinks.add(a.link.replace(/\/+$/, ''));
        existingLinks.add(a.link);
      }

      allNew.push(...newArticles);

      if (newArticles.length > 0) {
        console.log(
          `${newArticles.length} new  (${method}, ${articles.length} total)`
        );
      } else {
        console.log(`no new articles  (${method})`);
      }
    } catch (err) {
      console.log(`✗ error: ${err.message}`);
      siteErrors++;
    }

    if (i < feeds.length - 1) await sleep(DELAY_BETWEEN_SITES);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  New articles found: ${allNew.length}`);
  if (siteErrors > 0) console.log(`  Sites with errors:  ${siteErrors}`);

  if (allNew.length === 0) {
    console.log('  Nothing to add.');
    console.log('');
    return;
  }

  if (DRY_RUN) {
    console.log('');
    console.log('  New articles (dry run):');
    for (const a of allNew) {
      console.log(`    • [${a.source}] ${a.title}`);
      console.log(`      ${a.link}`);
    }
    console.log('');
    return;
  }

  // ── Merge & save ────────────────────────────────────────────────────────
  const merged = [...allNew, ...existingArticles];
  merged.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  const output = {
    lastUpdated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    totalArticles: merged.length,
    articles: merged,
  };

  fs.writeFileSync(ARTICLES_PATH, JSON.stringify(output, null, 4), 'utf8');
  console.log(
    `  articles.json updated: ${merged.length} total articles (+${allNew.length} new)`
  );
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
