# OG Meta Tag Worker

Cloudflare Worker that fixes social media share previews for dynamic pages (artists, curators, events).

## Problem

The site uses GitHub Pages with client-side routing via `404.html`. When social media crawlers (Facebook, Twitter, Discord, Telegram, etc.) visit a clean URL like `/ArtistName` or `/kustos/CuratorName`, they see the generic `404.html` title "Пренасочување..." because they don't execute JavaScript.

## Solution

This worker sits in front of the GitHub Pages origin (as a Cloudflare Worker Route) and:

1. **Detects social media crawlers** by User-Agent
2. **For crawlers** — fetches `bands.json` / `curators.json` / `events.json` from the GitHub repo, looks up the entity, and returns a minimal HTML page with correct `og:title`, `og:description`, `og:image`, and Twitter Card meta tags
3. **For regular visitors** — passes the request straight through to the origin (zero impact on normal browsing)

### Supported URL patterns

| Pattern | Data source | Example |
|---|---|---|
| `/{artist-slug}` | `bands.json` | `/guruvoodoo` |
| `/kustos/{name}` | `curators.json` | `/kustos/Мартин%20Петковски` |
| `/nastan/{id}` | `events.json` | `/nastan/evt-20260206-re-start-festival-ден-1-6z31` |

## Deployment

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed (`npm i -g wrangler`)
- `toplista.mk` domain proxied through Cloudflare (orange cloud in DNS settings)

### Steps

1. **Find your Zone ID** in the Cloudflare dashboard → toplista.mk → Overview → right sidebar.

2. **Update `wrangler.toml`** — uncomment the `[env.production]` block and paste your Zone ID:

   ```toml
   [env.production]
   routes = [
     { pattern = "toplista.mk/*", zone_id = "abc123..." },
     { pattern = "www.toplista.mk/*", zone_id = "abc123..." }
   ]
   ```

3. **Deploy:**

   ```bash
   cd workers/cloudflare-og
   wrangler deploy --env production
   ```

4. **Test** by curling with a crawler User-Agent:

   ```bash
   curl -A "facebookexternalhit/1.1" https://toplista.mk/guruvoodoo
   ```

   You should see a minimal HTML page with proper `og:title`, `og:image`, etc., instead of "Пренасочување...".

### Local development

```bash
cd workers/cloudflare-og
wrangler dev
```

Then test with:

```bash
curl -A "Twitterbot/1.0" http://localhost:8787/guruvoodoo
```

## Caching

- JSON data is cached in-memory per Worker isolate for 5 minutes.
- Cloudflare edge cache (`cf.cacheTtl`) is also used for the upstream JSON fetches (5 min).
- Crawler responses are served with `Cache-Control: public, max-age=3600` (1 hour).

## Notes

- The transliteration logic (Cyrillic → Latin slug) is duplicated from `artist.html` to ensure consistent matching.
- If the entity isn't found, the worker falls through to the origin, so nothing breaks.
- The worker only intercepts GET requests from known crawlers; all other traffic is untouched.
