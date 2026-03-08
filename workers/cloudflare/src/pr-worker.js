// Simple in-memory rate limit map (per isolate, not globally consistent)
const rlMap = new Map();
let lastCleanup = Date.now();

function rateLimitCheck(ip, max, windowMs) {
  const now = Date.now();
  if (now - lastCleanup > windowMs * 10) {
    for (const [k, v] of rlMap.entries()) if (now - v.first > windowMs) rlMap.delete(k);
    lastCleanup = now;
  }
  const entry = rlMap.get(ip);
  if (!entry) {
    rlMap.set(ip, { count: 1, first: now });
    return { allowed: true, remaining: max - 1, reset: now + windowMs };
  }
  if (now - entry.first > windowMs) {
    rlMap.set(ip, { count: 1, first: now });
    return { allowed: true, remaining: max - 1, reset: now + windowMs };
  }
  entry.count += 1;
  if (entry.count > max) return { allowed: false, remaining: 0, reset: entry.first + windowMs };
  return { allowed: true, remaining: max - entry.count, reset: entry.first + windowMs };
}

export default {
  async fetch(request, env) {
    // Dynamic CORS: allow specific origins (incl. najjak.com) with sensible defaults
    const origin = request.headers.get('Origin') || '';
    const configured = (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const defaultAllowed = [
      'https://www.najjak.com',
      'https://martinpetkovski.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5500',
      'http://localhost'
    ];
    const allowedOrigins = configured.length ? configured : defaultAllowed;
    const allowThisOrigin = origin && allowedOrigins.includes(origin);
    const vary = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowThisOrigin ? origin : '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': vary,
    };

    // Debug endpoint to inspect auth variable presence (temporary)
    if (request.method === 'GET' && new URL(request.url).pathname === '/debug-auth') {
      const hasAppVars = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
      const installationLooksNumeric = /^(\d+)$/.test(env.GITHUB_INSTALLATION_ID || '');
      const appIdLooksNumeric = /^(\d+)$/.test(env.GITHUB_APP_ID || '');
      const keyPresent = !!env.GITHUB_APP_PRIVATE_KEY;
      const tokenPresent = !!env.GITHUB_TOKEN;
      return json({
        debug: true,
        hasAppVars,
        appId: env.GITHUB_APP_ID || null,
        appIdLooksNumeric,
        installationId: env.GITHUB_INSTALLATION_ID || null,
        installationLooksNumeric,
        privateKeyPresent: keyPresent,
        privateKeyLength: keyPresent ? env.GITHUB_APP_PRIVATE_KEY.length : 0,
        patPresent: tokenPresent,
        authModeWillUse: hasAppVars ? 'github_app' : (tokenPresent ? 'pat' : 'none')
      }, 200, corsHeaders);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ==================== RSS PROXY ENDPOINT ====================
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/rss-proxy') {
      const feedUrl = url.searchParams.get('url');
      if (!feedUrl) {
        return json({ error: 'Missing "url" query parameter' }, 400, corsHeaders);
      }
      // Allowlist: only proxy known RSS feed domains
      const allowedHosts = [
        'rss.app',
        'www.kulturabeta.com',
        'kulturabeta.com',
        'popup.mk',
        'www.popup.mk',
        'www.mktickets.mk',
        'mktickets.mk',
        'www.mono-ton.com',
        'mono-ton.com',
      ];
      let parsedFeed;
      try {
        parsedFeed = new URL(feedUrl);
      } catch {
        return json({ error: 'Invalid feed URL' }, 400, corsHeaders);
      }
      if (!allowedHosts.includes(parsedFeed.hostname)) {
        return json({ error: 'Feed host not allowed' }, 403, corsHeaders);
      }
      // Rate limit RSS proxy: 30 req/min per IP
      const proxyIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const proxyRl = rateLimitCheck('rss:' + proxyIp, 30, 60000);
      if (!proxyRl.allowed) {
        return json({ error: 'Rate limit exceeded' }, 429, corsHeaders);
      }
      try {
        const feedResp = await fetch(feedUrl, {
          headers: { 'User-Agent': 'TopListaMK-RSSProxy/1.0' },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        const body = await feedResp.text();
        return new Response(body, {
          status: feedResp.status,
          headers: {
            ...corsHeaders,
            'Content-Type': feedResp.headers.get('Content-Type') || 'application/xml',
            'Cache-Control': 'public, max-age=300',
          },
        });
      } catch (e) {
        return json({ error: 'Failed to fetch feed', detail: e.message }, 502, corsHeaders);
      }
    }

    // ==================== INSTAGRAM PROFILE PIC PROXY ====================
    if (request.method === 'GET' && url.pathname.startsWith('/ig-pic/')) {
      const username = url.pathname.replace('/ig-pic/', '').replace(/\//g, '');
      if (!username || !/^[a-zA-Z0-9_.]+$/.test(username)) {
        return json({ error: 'Invalid username' }, 400, corsHeaders);
      }
      const igIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const igRl = rateLimitCheck('ig:' + igIp, 30, 60000);
      if (!igRl.allowed) {
        return json({ error: 'Rate limit exceeded' }, 429, corsHeaders);
      }
      try {
        const igResp = await fetch(`https://www.instagram.com/${username}/`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          cf: { cacheTtl: 86400, cacheEverything: true },
        });
        if (!igResp.ok) {
          return json({ error: 'Instagram fetch failed' }, 502, corsHeaders);
        }
        const html = await igResp.text();
        const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
               || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
        if (!m || !m[1]) {
          return json({ error: 'No profile image found' }, 404, corsHeaders);
        }
        // Redirect to the actual image URL with long cache
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders,
            'Location': m[1],
            'Cache-Control': 'public, max-age=86400',
          },
        });
      } catch (e) {
        return json({ error: 'Failed to fetch IG profile', detail: e.message }, 502, corsHeaders);
      }
    }

    // Song.link API proxy to avoid CORS
    if (request.method === 'GET' && url.pathname === '/songlink-proxy') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return json({ error: 'Missing url parameter' }, 400, corsHeaders);
      }
      
      try {
        const songlinkUrl = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(targetUrl)}`;
        const resp = await fetch(songlinkUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ToplistaMK-Bot/1.0)',
          }
        });
        
        if (!resp.ok) {
          return json({ error: `Song.link API returned ${resp.status}` }, resp.status, corsHeaders);
        }
        
        const data = await resp.json();
        return new Response(JSON.stringify(data), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          },
        });
      } catch (e) {
        return json({ error: 'Failed to proxy Song.link request', detail: e.message }, 502, corsHeaders);
      }
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405, corsHeaders);
    }

    // Rate limiting
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const max = parseInt(env.RATE_LIMIT_MAX || '5', 10); // default 5 requests
    const windowSec = parseInt(env.RATE_LIMIT_WINDOW || '60', 10); // default 60s
    const windowMs = windowSec * 1000;
    const rl = rateLimitCheck(ip, max, windowMs);
    if (!rl.allowed) {
      const retryAfter = Math.max(0, Math.ceil((rl.reset - Date.now()) / 1000));
      const limitedHeaders = {
        ...corsHeaders,
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(max),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(Math.floor(rl.reset / 1000)),
      };
      return json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429, limitedHeaders);
    }

    try {
      const body = await request.json();
      const bandsJson = body?.bandsJson;
      const originalJson = body?.originalJson || null;
      const description = body?.description || 'Automated PR from MMM form';
      const contributor = body?.contributor || '';
      const targetPath = body?.path || 'bands.json';

      if (!bandsJson || typeof bandsJson !== 'string') {
        return json({ error: 'Invalid payload: bandsJson string required' }, 400, corsHeaders);
      }

      // Prefer GitHub App installation token if app variables are present; fallback to PAT
      let token = null;
      const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
      if (hasApp) {
        try {
          token = await getInstallationToken(env);
        } catch (e) {
          if (env.GITHUB_TOKEN) {
            token = env.GITHUB_TOKEN; // fallback to PAT if provided
          } else {
            return json({ error: 'GitHub App auth failed', detail: e.message }, 500, corsHeaders);
          }
        }
      } else if (env.GITHUB_TOKEN) {
        token = env.GITHUB_TOKEN;
      }
      const owner = env.GITHUB_OWNER || 'martinpetkovski';
      const repo = env.GITHUB_REPO || 'masterlista';
      const defaultBranch = env.GITHUB_DEFAULT_BRANCH || 'master';
      const requestedBase = body?.baseBranch || null;

      if (!token) {
        return json({ error: 'Missing GitHub credentials', hint: 'Set GitHub App vars (GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY) or a PAT in GITHUB_TOKEN.' }, 500, corsHeaders);
      }

      const gh = (url, init = {}) => fetch(`https://api.github.com${url}`, {
        ...init,
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'mmm-pr-worker',
          ...(init.headers || {}),
        },
      });

      // 1) Resolve base branch: use requested branch if it exists, otherwise default
      let baseBranch = defaultBranch;
      if (requestedBase && requestedBase !== defaultBranch) {
        const checkRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(requestedBase)}`);
        if (checkRef.ok) {
          baseBranch = requestedBase;
        }
      }

      const refRes = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
      if (!refRes.ok) {
        const text = await refRes.text();
        return json({ error: 'Failed to get base ref', detail: text }, 500, corsHeaders);
      }
      const refData = await refRes.json();
      const baseSha = refData.object.sha;

      // 2) Create a new branch
      const safeContributor = contributor ? slug(contributor) : 'anon';
      const ts = new Date();
      const branchName = `mmm/update-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}-${safeContributor}`;
      const createRefRes = await gh(`/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        }),
      });
      if (!createRefRes.ok) {
        const text = await createRefRes.text();
        return json({ error: 'Failed to create branch', detail: text }, 500, corsHeaders);
      }

      // 3) Get current file SHA and content (for update + merge)
      const contentsRes = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(targetPath)}?ref=${encodeURIComponent(baseBranch)}`);
      let currentSha = undefined;
      let currentContent = null;
      if (contentsRes.ok) {
        const contents = await contentsRes.json();
        currentSha = contents.sha;
        if (contents.content) {
          currentContent = b64decode(contents.content).replace(/^\uFEFF/, '');
        }
      } // If not ok, file might not exist; treat as create

      // 3b) Three-way merge if the user's baseline differs from current repo content
      let finalJson = bandsJson;
      let mergeNotes = [];
      if (originalJson && currentContent) {
        const normalizeJson = (s) => { try { return JSON.stringify(JSON.parse(s)); } catch { return s; } };
        if (normalizeJson(currentContent) !== normalizeJson(originalJson)) {
          // Repo changed since user's baseline — attempt auto-merge
          const mergeResult = threeWayMerge(targetPath, originalJson, currentContent, bandsJson);
          finalJson = mergeResult.merged;
          mergeNotes = mergeResult.notes;
        }
      }

      // 3c) Always preserve server-managed youtube fields from repo HEAD for releases.json.
      if (targetPath === 'releases.json' && currentContent) {
        try {
          const repoData = JSON.parse(currentContent);
          const userData = JSON.parse(finalJson);
          if (repoData.releases && userData.releases) {
            const repoYtMap = new Map();
            repoData.releases.forEach(r => {
              if (r.releaseId && (r.youtubeTracks || r.youtubeViews)) {
                repoYtMap.set(r.releaseId, { youtubeTracks: r.youtubeTracks, youtubeViews: r.youtubeViews });
              }
            });
            let patched = false;
            userData.releases.forEach(r => {
              if (!r.releaseId) return;
              const repo = repoYtMap.get(r.releaseId);
              if (repo) {
                if (JSON.stringify(r.youtubeTracks) !== JSON.stringify(repo.youtubeTracks)) patched = true;
                if (r.youtubeViews !== repo.youtubeViews) patched = true;
                r.youtubeTracks = repo.youtubeTracks;
                r.youtubeViews = repo.youtubeViews;
              }
            });
            if (patched) {
              finalJson = JSON.stringify(userData, null, 2);
            }
          }
        } catch (_) { /* if parsing fails, leave finalJson as-is */ }
      }

      // 3d) Always preserve server-managed image fields from repo HEAD for bands.json.
      // The three-way merge handles this when it runs, but when the merge is skipped
      // (baseline == current), we still need to overlay images from repo HEAD.
      if (targetPath === 'bands.json' && currentContent) {
        try {
          const repoData = JSON.parse(currentContent);
          const userData = JSON.parse(finalJson);
          if (repoData.muzickaMasterLista && userData.muzickaMasterLista) {
            const repoImageMap = new Map();
            repoData.muzickaMasterLista.forEach(b => {
              if (b.image || b.imageSource) repoImageMap.set(b.name, { image: b.image, imageSource: b.imageSource });
            });
            let patched = false;
            userData.muzickaMasterLista.forEach(b => {
              const repo = repoImageMap.get(b.name);
              if (repo) {
                if (b.image !== repo.image || b.imageSource !== repo.imageSource) patched = true;
                b.image = repo.image;
                b.imageSource = repo.imageSource;
              } else {
                // New artist or not in repo — strip any client-sent image fields
                if (b.image || b.imageSource) patched = true;
                delete b.image;
                delete b.imageSource;
              }
            });
            if (patched) {
              finalJson = JSON.stringify(userData, null, 2);
            }
          }
        } catch (_) { /* if parsing fails, leave finalJson as-is */ }
      }

      // 4) Create or update file on new branch
      const putRes = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(targetPath)}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `MMM: update ${targetPath} via form${contributor ? ` by ${contributor}` : ''}`,
          content: b64encode(finalJson),
          branch: branchName,
          sha: currentSha,
        }),
      });
      if (!putRes.ok) {
        const text = await putRes.text();
        return json({ error: 'Failed to commit file', detail: text }, 500, corsHeaders);
      }

      // 4b) Commit additional binary/text files (e.g. greeting audio)
      const additionalFiles = body?.additionalFiles || [];
      const failedFiles = [];
      for (const af of additionalFiles) {
        if (!af.path || !af.contentBase64) continue;
        // Encode each path segment individually to preserve slashes
        const safePath = af.path.split('/').map(encodeURIComponent).join('/');
        // Check if file already exists to get its SHA
        const afContentsRes = await gh(`/repos/${owner}/${repo}/contents/${safePath}?ref=${encodeURIComponent(branchName)}`);
        let afSha = undefined;
        if (afContentsRes.ok) {
          const afContents = await afContentsRes.json();
          afSha = afContents.sha;
        }
        const afPutRes = await gh(`/repos/${owner}/${repo}/contents/${safePath}`, {
          method: 'PUT',
          body: JSON.stringify({
            message: `MMM: add ${af.path}${contributor ? ` by ${contributor}` : ''}`,
            content: af.contentBase64,
            branch: branchName,
            sha: afSha,
          }),
        });
        if (!afPutRes.ok) {
          const text = await afPutRes.text();
          console.warn(`Failed to commit additional file ${af.path}: ${text}`);
          failedFiles.push({ path: af.path, error: text });
        }
      }

      // 5) Create PR
      const title = `MMM: Предлог промени${contributor ? ` од ${contributor}` : ''}`;
      const mergeNotice = mergeNotes.length
        ? `\n\n---\n🔀 **Авто-спојување:** Основата беше застарена, промените се споени автоматски.\n${mergeNotes.map(n => '• ' + n).join('\n')}\n`
        : '';
      const bodyText = `${description}\n\nАвтоматски генерирано од MMM формуларот.${mergeNotice}${contributor ? `\nПоднесено од: ${contributor}` : ''}`;
      const prRes = await gh(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          head: branchName,
          base: baseBranch,
          body: bodyText,
        }),
      });
      if (!prRes.ok) {
        const text = await prRes.text();
        return json({ error: 'Failed to create PR', detail: text }, 500, corsHeaders);
      }
      const pr = await prRes.json();

      return json({ ok: true, pr_url: pr.html_url, pr_number: pr.number, branch: branchName, failedFiles }, 200, corsHeaders);
    } catch (err) {
      return json({ error: 'Unhandled error', detail: err?.message || String(err) }, 500, corsHeaders);
    }
  },
};

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function pad(n) { return String(n).padStart(2, '0'); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32); }
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob((b64 || '').replace(/\n/g, '').replace(/\r/g, ''))));
}

// ---------------- Three-way Merge Helpers ----------------

/**
 * Perform a three-way merge: original (user's baseline) + current (repo HEAD) + modified (user's edits).
 * Returns { merged: string, notes: string[] }
 */
function threeWayMerge(filePath, originalJson, currentJson, modifiedJson) {
  try {
    const original = JSON.parse(originalJson);
    const current  = JSON.parse(currentJson);
    const modified = JSON.parse(modifiedJson);

    if (filePath === 'bands.json' && original.muzickaMasterLista && current.muzickaMasterLista) {
      return threeWayMergeBands(original, current, modified);
    }
    if (filePath === 'releases.json' && original.releases && current.releases) {
      return threeWayMergeReleases(original, current, modified);
    }
    if (filePath === 'events.json' && original.events && current.events) {
      return threeWayMergeEvents(original, current, modified);
    }
  } catch (_) { /* parse error — fall through */ }

  // Unknown file type or parse error — use user's version as-is
  return { merged: modifiedJson, notes: ['Непозната структура — користена верзијата на корисникот'] };
}

function threeWayMergeBands(original, current, modified) {
  const origList = original.muzickaMasterLista || [];
  const currList = current.muzickaMasterLista  || [];
  const modList  = modified.muzickaMasterLista || [];

  const toMap = (list) => { const m = new Map(); list.forEach(a => m.set(a.name, a)); return m; };
  const origMap = toMap(origList);
  const currMap = toMap(currList);
  const modMap  = toMap(modList);

  const merged = [];
  const notes = [];
  const seen = new Set();

  // Walk current (repo HEAD) list to preserve its ordering
  for (const artist of currList) {
    const name = artist.name;
    seen.add(name);
    const inOrig = origMap.has(name);
    const inMod  = modMap.has(name);

    if (inOrig && !inMod) {
      // User deleted this artist — honour the deletion
      notes.push(`Избришан: ${name}`);
      continue;
    }
    if (inOrig && inMod) {
      // Strip server-managed image fields before comparing so ps1-driven
      // image updates never cause false conflicts or change detection.
      const strip = (obj) => {
        const { image, imageSource, ...rest } = obj;
        return rest;
      };
      const oJson = JSON.stringify(strip(origMap.get(name)));
      const cJson = JSON.stringify(strip(artist));
      const mJson = JSON.stringify(strip(modMap.get(name)));
      if (mJson !== oJson && cJson === oJson) {
        // Only user changed → take user's version, keep HEAD images
        merged.push({ ...modMap.get(name), image: artist.image, imageSource: artist.imageSource });
        notes.push(`Изменет (корисник): ${name}`);
      } else if (mJson !== oJson && cJson !== oJson) {
        // Both changed non-image fields → take user's version, flag conflict, keep HEAD images
        merged.push({ ...modMap.get(name), image: artist.image, imageSource: artist.imageSource });
        notes.push(`⚠️ Конфликт (земена верзија на корисникот): ${name}`);
      } else {
        // User didn't change (or identical changes) → keep repo version
        merged.push(artist);
      }
    } else {
      // Not in original — added by repo after user's baseline
      merged.push(artist);
    }
  }

  // Append artists added by user (in modified but not in original and not already seen)
  for (const artist of modList) {
    if (!seen.has(artist.name) && !origMap.has(artist.name)) {
      // Strip any image fields the client may have sent
      const cleaned = { ...artist };
      delete cleaned.image; delete cleaned.imageSource;
      merged.push(cleaned);
      notes.push(`Додаден: ${artist.name}`);
      seen.add(artist.name);
    }
  }

  const result = { ...current, muzickaMasterLista: merged };
  return { merged: JSON.stringify(result, null, 2), notes };
}

function threeWayMergeReleases(original, current, modified) {
  const origList = original.releases || [];
  const currList = current.releases  || [];
  const modList  = modified.releases || [];

  const toMap = (list) => { const m = new Map(); list.forEach(r => { if (r.releaseId) m.set(r.releaseId, r); }); return m; };
  const origMap = toMap(origList);
  const currMap = toMap(currList);
  const modMap  = toMap(modList);

  // Server-managed fields that should always come from repo HEAD
  const serverFields = ['youtubeTracks', 'youtubeViews'];
  const stripServer = (obj) => {
    const copy = { ...obj };
    for (const f of serverFields) delete copy[f];
    return copy;
  };

  const merged = [];
  const notes = [];
  const seen = new Set();

  // Walk current (repo HEAD) list to preserve its ordering
  for (const release of currList) {
    const id = release.releaseId;
    if (!id) { merged.push(release); continue; }
    seen.add(id);
    const inOrig = origMap.has(id);
    const inMod  = modMap.has(id);

    if (inOrig && !inMod) {
      // User deleted this release — honour the deletion
      notes.push(`Избришано издание: ${release.bandName} - ${release.releaseTitle || id}`);
      continue;
    }
    if (inOrig && inMod) {
      const oJson = JSON.stringify(stripServer(origMap.get(id)));
      const cJson = JSON.stringify(stripServer(release));
      const mJson = JSON.stringify(stripServer(modMap.get(id)));
      if (mJson !== oJson && cJson === oJson) {
        // Only user changed non-server fields → take user's version, keep HEAD server fields
        const m = { ...modMap.get(id) };
        for (const f of serverFields) { if (release[f] !== undefined) m[f] = release[f]; }
        merged.push(m);
        notes.push(`Изменето издание (корисник): ${release.bandName} - ${release.releaseTitle || id}`);
      } else if (mJson !== oJson && cJson !== oJson) {
        // Both changed → take user's version for non-server fields, keep HEAD server fields
        const m = { ...modMap.get(id) };
        for (const f of serverFields) { if (release[f] !== undefined) m[f] = release[f]; }
        merged.push(m);
        notes.push(`⚠️ Конфликт издание (земена верзија на корисникот): ${release.bandName} - ${release.releaseTitle || id}`);
      } else {
        // User didn't change (or identical changes) → keep repo version
        merged.push(release);
      }
    } else {
      // Not in original — added by repo after user's baseline
      merged.push(release);
    }
  }

  // Append releases added by user (in modified but not in original and not already seen)
  for (const release of modList) {
    const id = release.releaseId;
    if (id && !seen.has(id) && !origMap.has(id)) {
      // New release from user — strip server fields the client may have sent
      const cleaned = { ...release };
      for (const f of serverFields) delete cleaned[f];
      merged.push(cleaned);
      notes.push(`Ново издание: ${release.bandName} - ${release.releaseTitle || id}`);
      seen.add(id);
    }
  }

  const result = { ...current, releases: merged };
  return { merged: JSON.stringify(result, null, 2), notes };
}

function threeWayMergeEvents(original, current, modified) {
  const origList = original.events || [];
  const currList = current.events  || [];
  const modList  = modified.events || [];

  const toMap = (list) => { const m = new Map(); list.forEach(e => m.set(e.id, e)); return m; };
  const origMap = toMap(origList);
  const currMap = toMap(currList);
  const modMap  = toMap(modList);

  const merged = [];
  const notes = [];
  const seen = new Set();

  for (const event of currList) {
    const id = event.id;
    seen.add(id);
    const inOrig = origMap.has(id);
    const inMod  = modMap.has(id);

    if (inOrig && !inMod) {
      notes.push(`Избришан настан: ${event.title || id}`);
      continue;
    }
    if (inOrig && inMod) {
      const oJson = JSON.stringify(origMap.get(id));
      const cJson = JSON.stringify(event);
      const mJson = JSON.stringify(modMap.get(id));
      if (mJson !== oJson && cJson === oJson) {
        merged.push(modMap.get(id));
        notes.push(`Изменет настан (корисник): ${event.title || id}`);
      } else if (mJson !== oJson && cJson !== oJson) {
        merged.push(modMap.get(id));
        notes.push(`⚠️ Конфликт настан (земена верзија на корисникот): ${event.title || id}`);
      } else {
        merged.push(event);
      }
    } else {
      merged.push(event);
    }
  }

  for (const event of modList) {
    if (!seen.has(event.id) && !origMap.has(event.id)) {
      merged.push(event);
      notes.push(`Нов настан: ${event.title || event.id}`);
      seen.add(event.id);
    }
  }

  const result = { ...current, events: merged };
  return { merged: JSON.stringify(result, null, 2), notes };
}

// ---------------- GitHub App Helpers ----------------
let installationTokenCache = null; // { token, expiresAt }

async function getInstallationToken(env) {
  const now = Date.now();
  if (installationTokenCache && installationTokenCache.expiresAt - 60_000 > now) {
    return installationTokenCache.token;
  }
  const jwt = await createGitHubAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const res = await fetch(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mmm-pr-worker'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Installation token request failed: ${text}`);
  }
  const data = await res.json();
  installationTokenCache = { token: data.token, expiresAt: Date.parse(data.expires_at) };
  return data.token;
}

async function createGitHubAppJwt(appId, pemKey) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: nowSec - 30, exp: nowSec + 540, iss: appId }; // 9 min exp
  const encode = (obj) => base64Url(JSON.stringify(obj));
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const key = await importFlexiblePrivateKey(pemKey);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64 = base64UrlFromArrayBuffer(sig);
  return `${unsigned}.${sigB64}`;
}

function base64Url(str) {
  let out = btoa(str).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  return out;
}

function base64UrlFromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

async function importFlexiblePrivateKey(pem) {
  // Normalize common dashboard artifacts: literal \n sequences, stray CRs/spaces
  const value = String(pem == null ? '' : pem).trim().replace(/\r/g, '').replace(/\\n/g, '\n');
  if (value.includes('BEGIN PRIVATE KEY')) {
    const cleaned = value
      .replace(/-----BEGIN PRIVATE KEY-----/,'')
      .replace(/-----END PRIVATE KEY-----/,'')
      .replace(/\n/g,'')
      .replace(/\s+/g,'');
    const binaryDer = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  if (value.includes('BEGIN RSA PRIVATE KEY')) {
    const cleaned = value
      .replace(/-----BEGIN RSA PRIVATE KEY-----/,'')
      .replace(/-----END RSA PRIVATE KEY-----/,'')
      .replace(/\n/g,'')
      .replace(/\s+/g,'');
    const pkcs1Der = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
    const pkcs8Der = wrapPkcs1ToPkcs8(pkcs1Der);
    return crypto.subtle.importKey('pkcs8', pkcs8Der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  const compact = value.replace(/\n/g,'').replace(/\s+/g,'');
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 0) {
    try {
      const rawDer = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
      // Try PKCS#8 import directly
      return await crypto.subtle.importKey('pkcs8', rawDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch (_) {
      // Try treating as PKCS#1 and wrap
      try {
        const pkcs1Der = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
        const pkcs8Der = wrapPkcs1ToPkcs8(pkcs1Der);
        return await crypto.subtle.importKey('pkcs8', pkcs8Der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      } catch (e2) {
        throw new Error('Unsupported key format after fallback attempts');
      }
    }
  }
  throw new Error('Unsupported key format: provide PEM with BEGIN PRIVATE KEY / BEGIN RSA PRIVATE KEY or raw base64 DER');
}

function wrapPkcs1ToPkcs8(pkcs1Der) {
  // Build: SEQUENCE { INTEGER 0; SEQUENCE { OID 1.2.840.113549.1.1.1; NULL }; OCTET STRING <pkcs1Der> }
  const oidRsa = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]; // 1.2.840.113549.1.1.1
  const nullBytes = [0x05, 0x00];
  const algIdSeq = encodeSequence([...oidRsa, ...nullBytes]);
  const version = [0x02, 0x01, 0x00];
  const pkcs1Octet = encodeOctetString(pkcs1Der);
  const all = [...version, ...algIdSeq, ...pkcs1Octet];
  return new Uint8Array(encodeSequence(all));
}

function encodeSequence(content) {
  const len = encodeLength(content.length);
  return [0x30, ...len, ...content];
}
function encodeOctetString(bytes) {
  const len = encodeLength(bytes.length);
  return [0x04, ...len, ...bytes];
}
function encodeLength(len) {
  if (len < 128) return [len];
  const hex = [];
  while (len > 0) { hex.unshift(len & 0xff); len >>= 8; }
  return [0x80 | hex.length, ...hex];
}
