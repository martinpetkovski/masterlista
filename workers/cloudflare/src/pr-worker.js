// Simple in-memory rate limit map (per isolate, not globally consistent)
const rlMap = new Map();
let lastCleanup = Date.now();

const AUTH_STATE_PREFIX = 'oauth-state:';
const AUTH_SESSION_PREFIX = 'auth-session:';
const CONTRIBUTIONS_CACHE_KEY = 'contributions:v2';
const CONTRIBUTION_METADATA_MARKER = 'MMM_CONTRIBUTION_METADATA';
const DEFAULT_AUTH_SESSION_TTL = 60 * 60 * 24 * 30;
const DEFAULT_CONTRIBUTIONS_CACHE_TTL = 300;

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
      'https://toplista.mk',
      'https://www.toplista.mk',
      'https://www.najjak.com',
      'https://martinpetkovski.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5500',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
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

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/auth/status') {
      return handleAuthStatus(env, corsHeaders);
    }

    if (request.method === 'GET' && url.pathname === '/auth/start') {
      return handleOAuthStart(request, env, corsHeaders);
    }

    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return handleOAuthCallback(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/auth/device/start') {
      return handleDeviceStart(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/auth/device/poll') {
      return handleDevicePoll(request, env, corsHeaders);
    }

    if (request.method === 'GET' && url.pathname === '/auth/session') {
      return handleSessionInfo(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/auth/logout') {
      return handleLogout(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/submit/user') {
      return handleAuthenticatedSubmission(request, env, corsHeaders);
    }

    if (request.method === 'GET' && url.pathname === '/contributions') {
      return handleContributions(request, env, corsHeaders);
    }

    // ==================== RSS PROXY ENDPOINT ====================
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
      const description = body?.description || 'Automated PR from MMM form';
      const contributor = body?.contributor || '';
      const files = normalizeRequestedFiles(body);

      if (!files.length) {
        return json({ error: 'Invalid payload: at least one file is required' }, 400, corsHeaders);
      }

      const invalidFile = files.find(file => !file.bandsJson || typeof file.bandsJson !== 'string');
      if (invalidFile) {
        return json({ error: `Invalid payload: bandsJson string required for ${invalidFile.path || 'bands.json'}` }, 400, corsHeaders);
      }

      const seenPaths = new Set();
      const duplicateFile = files.find(file => {
        const key = `${file.baseBranch || ''}:${file.path || 'bands.json'}`;
        if (seenPaths.has(key)) return true;
        seenPaths.add(key);
        return false;
      });
      if (duplicateFile) {
        return json({ error: 'Duplicate file in request', path: duplicateFile.path || 'bands.json' }, 400, corsHeaders);
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
      const requestedBases = Array.from(new Set(files.map(file => file.baseBranch || null).filter(Boolean)));

      if (requestedBases.length > 1) {
        return json({
          error: 'Cannot submit files targeting multiple base branches in one PR',
          detail: requestedBases.join(', ')
        }, 400, corsHeaders);
      }

      const requestedBase = requestedBases[0] || null;

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

      const preparedFiles = [];
      const skippedFiles = [];
      let mergeNotes = [];

      for (const file of files) {
        const prepared = await prepareFileUpdate({
          gh,
          owner,
          repo,
          baseBranch,
          file,
        });
        if (!prepared.hasChanges && !prepared.additionalFiles.length) {
          skippedFiles.push({ path: prepared.targetPath, code: 'NO_EFFECTIVE_CHANGES' });
          continue;
        }
        preparedFiles.push(prepared);
        mergeNotes = mergeNotes.concat(prepared.mergeNotes);
      }

      if (!preparedFiles.length) {
        return json({
          error: 'No effective changes to submit',
          code: 'NO_EFFECTIVE_CHANGES',
          skippedFiles,
        }, 409, corsHeaders);
      }

      // 2) Create a new branch
      const branchResult = await createUniqueBranch({
        gh,
        owner,
        repo,
        baseSha,
        contributor,
      });
      if (!branchResult.ok) {
        return json({ error: 'Failed to create branch', detail: branchResult.detail }, 500, corsHeaders);
      }
      const branchName = branchResult.branchName;

      const failedFiles = [];
      const submittedFiles = [];
      for (const prepared of preparedFiles) {
        const commitResult = await commitPreparedFile({
          gh,
          owner,
          repo,
          branchName,
          contributor,
          prepared,
        });
        if (!commitResult.ok) {
          return json({ error: 'Failed to commit file', detail: commitResult.error, path: commitResult.path }, 500, corsHeaders);
        }
        if (prepared.hasChanges) {
          submittedFiles.push(prepared.targetPath);
        }
        failedFiles.push(...commitResult.failedFiles);
      }

      // 5) Create PR
      const title = `MMM: Предлог промени${contributor ? ` од ${contributor}` : ''}`;
      const mergeNotice = mergeNotes.length
        ? `\n\n---\n🔀 **Авто-спојување:** Основата беше застарена, промените се споени автоматски.\n${mergeNotes.map(n => '• ' + n).join('\n')}\n`
        : '';
      const skippedNotice = skippedFiles.length
        ? `\n\n---\nℹ️ **Без нови промени за:**\n${skippedFiles.map(file => '• ' + file.path).join('\n')}\n`
        : '';
      const submittedNotice = submittedFiles.length
        ? `\n\nФајлови:\n${submittedFiles.map(file => '• ' + file).join('\n')}`
        : '';
      const bodyText = `${description}${submittedNotice}\n\nАвтоматски генерирано од MMM формуларот.${mergeNotice}${skippedNotice}${contributor ? `\nПоднесено од: ${contributor}` : ''}`;
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
      await invalidateContributionsCache(env);

      return json({ ok: true, pr_url: pr.html_url, pr_number: pr.number, branch: branchName, files: submittedFiles, skippedFiles, failedFiles }, 200, corsHeaders);
    } catch (err) {
      return json({ error: 'Unhandled error', detail: err?.message || String(err) }, 500, corsHeaders);
    }
  },
};

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function invalidateContributionsCache(env) {
  if (!env.AUTH_STORE) return;
  try {
    await env.AUTH_STORE.delete(CONTRIBUTIONS_CACHE_KEY);
  } catch (_) {}
}

function pad(n) { return String(n).padStart(2, '0'); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32); }
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob((b64 || '').replace(/\n/g, '').replace(/\r/g, ''))));
}

function normalizeComparableContent(content) {
  if (typeof content !== 'string') return '';
  try {
    return JSON.stringify(JSON.parse(content));
  } catch (_) {
    return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  }
}

function encodeRepoPath(filePath) {
  return String(filePath || '').split('/').map(encodeURIComponent).join('/');
}

function bearerToken(token) {
  return `Bearer ${token}`;
}

function githubRequest(token, userAgent = 'mmm-pr-worker') {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': userAgent,
  };
  if (token) headers.Authorization = bearerToken(token);

  return (url, init = {}) => fetch(`https://api.github.com${url}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });
}

function getWorkerBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getSessionTtl(env) {
  const value = parseInt(env.AUTH_SESSION_TTL_SECONDS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_AUTH_SESSION_TTL;
}

function getContributionsCacheTtl(env) {
  const value = parseInt(env.CONTRIBUTIONS_CACHE_TTL_SECONDS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CONTRIBUTIONS_CACHE_TTL;
}

function getAllowedReturnOrigins(env) {
  return (env.AUTH_RETURN_ORIGINS || env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isAllowedReturnTo(returnTo, env) {
  if (!returnTo || typeof returnTo !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(returnTo);
  } catch (_) {
    return false;
  }
  if (parsed.protocol === 'file:') return false;
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLoopbackHostname(parsed.hostname)) return true;
  const allowedOrigins = getAllowedReturnOrigins(env);
  if (!allowedOrigins.length) return true;
  return allowedOrigins.includes(parsed.origin);
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function appendParams(url, params) {
  const parsed = new URL(url);
  Object.keys(params).forEach(key => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') parsed.searchParams.set(key, String(value));
  });
  return parsed.toString();
}

function requireAuthConfig(env) {
  requireOAuthClientId(env);
  if (!env.GITHUB_OAUTH_CLIENT_SECRET) {
    throw new Error('Missing GITHUB_OAUTH_CLIENT_SECRET');
  }
}

function requireOAuthClientId(env) {
  if (!env.GITHUB_OAUTH_CLIENT_ID) {
    throw new Error('Missing GITHUB_OAUTH_CLIENT_ID');
  }
  if (!isPlausibleGitHubOAuthClientId(env.GITHUB_OAUTH_CLIENT_ID)) {
    throw new Error('GITHUB_OAUTH_CLIENT_ID appears to be configured with the wrong value');
  }
}

function isPlausibleGitHubOAuthClientId(clientId) {
  const value = String(clientId || '').trim();
  if (!value) return false;
  if (/^[a-f0-9]{40}$/i.test(value)) return false;
  return true;
}

function requireAuthStore(env) {
  if (!env.AUTH_STORE) {
    throw new Error('Missing AUTH_STORE KV binding');
  }
}

function getSessionIdFromRequest(request) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) return bearer[1].trim();
  const url = new URL(request.url);
  return url.searchParams.get('session') || url.searchParams.get('session_id') || '';
}

function publicUserFromSession(session) {
  if (!session || !session.user) return null;
  return {
    id: session.user.id,
    login: session.user.login,
    name: session.user.name || '',
    avatar_url: session.user.avatar_url || '',
    html_url: session.user.html_url || '',
  };
}

async function readSession(env, sessionId) {
  requireAuthStore(env);
  if (!sessionId) return null;
  const session = await env.AUTH_STORE.get(AUTH_SESSION_PREFIX + sessionId, { type: 'json' });
  if (!session || !session.accessToken || !session.user) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    await env.AUTH_STORE.delete(AUTH_SESSION_PREFIX + sessionId);
    return null;
  }
  return session;
}

async function writeSession(env, accessToken, user, method) {
  requireAuthStore(env);
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const ttl = getSessionTtl(env);
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const session = {
    accessToken,
    user: publicUserFromSession({ user }) || user,
    method: method || 'oauth',
    createdAt: now.toISOString(),
    expiresAt,
  };
  await env.AUTH_STORE.put(AUTH_SESSION_PREFIX + sessionId, JSON.stringify(session), { expirationTtl: ttl });
  return { sessionId, session };
}

async function exchangeOAuthCode(env, code, redirectUri) {
  requireAuthConfig(env);
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'mmm-pr-worker',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || 'OAuth token exchange failed');
  }
  return data.access_token;
}

async function fetchGitHubUser(accessToken) {
  const gh = githubRequest(accessToken, 'mmm-auth-worker');
  const userRes = await gh('/user');
  if (!userRes.ok) {
    throw new Error(`GitHub user request failed: ${await userRes.text()}`);
  }
  const user = await userRes.json();
  return {
    id: user.id,
    login: user.login,
    name: user.name || '',
    avatar_url: user.avatar_url || '',
    html_url: user.html_url || `https://github.com/${user.login}`,
  };
}

function getOAuthScope(env) {
  return env.GITHUB_OAUTH_SCOPE || 'public_repo read:user';
}

async function handleAuthStatus(env, corsHeaders) {
  const hasClientId = !!env.GITHUB_OAUTH_CLIENT_ID;
  const clientIdLooksValid = hasClientId && isPlausibleGitHubOAuthClientId(env.GITHUB_OAUTH_CLIENT_ID);
  const hasClientSecret = !!env.GITHUB_OAUTH_CLIENT_SECRET;
  const hasStore = !!env.AUTH_STORE;
  return json({
    ok: true,
    enabled: clientIdLooksValid && hasStore,
    web: clientIdLooksValid && hasClientSecret && hasStore,
    device: clientIdLooksValid && hasStore,
    clientIdLooksValid,
    missing: [
      hasClientId ? null : 'GITHUB_OAUTH_CLIENT_ID',
      hasClientId && !clientIdLooksValid ? 'GITHUB_OAUTH_CLIENT_ID_FORMAT' : null,
      hasClientSecret ? null : 'GITHUB_OAUTH_CLIENT_SECRET',
      hasStore ? null : 'AUTH_STORE',
    ].filter(Boolean),
  }, 200, { ...corsHeaders, 'Cache-Control': 'no-store' });
}

async function handleOAuthStart(request, env, corsHeaders) {
  try {
    requireAuthConfig(env);
    requireAuthStore(env);
    const url = new URL(request.url);
    const returnTo = url.searchParams.get('return_to') || url.searchParams.get('returnTo') || '';
    if (!isAllowedReturnTo(returnTo, env)) {
      return json({ error: 'Return URL is not allowed' }, 400, corsHeaders);
    }
    const state = crypto.randomUUID();
    const redirectUri = `${getWorkerBaseUrl(request)}/auth/callback`;
    await env.AUTH_STORE.put(AUTH_STATE_PREFIX + state, JSON.stringify({ returnTo, redirectUri, createdAt: new Date().toISOString() }), { expirationTtl: 600 });
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('scope', getOAuthScope(env));
    githubUrl.searchParams.set('state', state);
    githubUrl.searchParams.set('allow_signup', 'true');
    return new Response(null, { status: 302, headers: { ...corsHeaders, 'Location': githubUrl.toString(), 'Cache-Control': 'no-store' } });
  } catch (err) {
    const detail = err?.message || String(err);
    const status = /GITHUB_OAUTH_CLIENT_ID appears/.test(detail) ? 503 : 500;
    return json({ error: 'OAuth start failed', detail }, status, corsHeaders);
  }
}

async function handleOAuthCallback(request, env, corsHeaders) {
  try {
    requireAuthStore(env);
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const error = url.searchParams.get('error') || '';
    const stored = state ? await env.AUTH_STORE.get(AUTH_STATE_PREFIX + state, { type: 'json' }) : null;
    if (!stored || !stored.returnTo || !stored.redirectUri) {
      return json({ error: 'Invalid or expired OAuth state' }, 400, corsHeaders);
    }
    await env.AUTH_STORE.delete(AUTH_STATE_PREFIX + state);
    if (error) {
      return new Response(null, { status: 302, headers: { ...corsHeaders, 'Location': appendParams(stored.returnTo, { mmm_auth_error: error }), 'Cache-Control': 'no-store' } });
    }
    if (!code) {
      return new Response(null, { status: 302, headers: { ...corsHeaders, 'Location': appendParams(stored.returnTo, { mmm_auth_error: 'missing_code' }), 'Cache-Control': 'no-store' } });
    }
    const accessToken = await exchangeOAuthCode(env, code, stored.redirectUri);
    const user = await fetchGitHubUser(accessToken);
    const result = await writeSession(env, accessToken, user, 'oauth');
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        'Location': appendParams(stored.returnTo, { mmm_session: result.sessionId, mmm_login: user.login }),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return json({ error: 'OAuth callback failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

async function handleDeviceStart(request, env, corsHeaders) {
  try {
    requireOAuthClientId(env);
    requireAuthStore(env);
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'mmm-pr-worker',
      },
      body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, scope: getOAuthScope(env) }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return json({ error: data.error || 'Device flow failed', detail: data.error_description || '' }, 502, corsHeaders);
    }
    return json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    }, 200, corsHeaders);
  } catch (err) {
    return json({ error: 'Device flow failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

async function handleDevicePoll(request, env, corsHeaders) {
  try {
    requireOAuthClientId(env);
    requireAuthStore(env);
    const body = await request.json();
    const deviceCode = body?.device_code || body?.deviceCode || '';
    if (!deviceCode) return json({ error: 'Missing device_code' }, 400, corsHeaders);
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'mmm-pr-worker',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return json({ pending: true, error: data.error, interval: data.interval || null }, 202, corsHeaders);
    }
    if (!res.ok || data.error || !data.access_token) {
      return json({ error: data.error || 'Device token request failed', detail: data.error_description || '' }, 400, corsHeaders);
    }
    const user = await fetchGitHubUser(data.access_token);
    const result = await writeSession(env, data.access_token, user, 'device');
    return json({ ok: true, session: result.sessionId, user: publicUserFromSession(result.session) }, 200, corsHeaders);
  } catch (err) {
    return json({ error: 'Device poll failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

async function handleSessionInfo(request, env, corsHeaders) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const session = await readSession(env, sessionId);
    if (!session) return json({ authenticated: false }, 401, corsHeaders);
    return json({ authenticated: true, user: publicUserFromSession(session), expiresAt: session.expiresAt }, 200, corsHeaders);
  } catch (err) {
    return json({ error: 'Session lookup failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

async function handleLogout(request, env, corsHeaders) {
  try {
    requireAuthStore(env);
    const sessionId = getSessionIdFromRequest(request);
    if (sessionId) await env.AUTH_STORE.delete(AUTH_SESSION_PREFIX + sessionId);
    return json({ ok: true }, 200, corsHeaders);
  } catch (err) {
    return json({ error: 'Logout failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

function contributorLabelFromUser(user) {
  if (!user) return '';
  return user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
}

function validateSubmissionFiles(files) {
  if (!files.length) {
    return { ok: false, status: 400, error: 'Invalid payload: at least one file is required' };
  }
  const invalidFile = files.find(file => !file.bandsJson || typeof file.bandsJson !== 'string');
  if (invalidFile) {
    return { ok: false, status: 400, error: `Invalid payload: bandsJson string required for ${invalidFile.path || 'bands.json'}` };
  }
  const seenPaths = new Set();
  const duplicateFile = files.find(file => {
    const key = `${file.baseBranch || ''}:${file.path || 'bands.json'}`;
    if (seenPaths.has(key)) return true;
    seenPaths.add(key);
    return false;
  });
  if (duplicateFile) {
    return { ok: false, status: 400, error: 'Duplicate file in request', path: duplicateFile.path || 'bands.json' };
  }
  const requestedBases = Array.from(new Set(files.map(file => file.baseBranch || null).filter(Boolean)));
  if (requestedBases.length > 1) {
    return { ok: false, status: 400, error: 'Cannot submit files targeting multiple base branches in one PR', detail: requestedBases.join(', ') };
  }
  return { ok: true, requestedBase: requestedBases[0] || null };
}

async function resolveBaseBranch({ gh, owner, repo, defaultBranch, requestedBase }) {
  let baseBranch = defaultBranch;
  if (requestedBase && requestedBase !== defaultBranch) {
    const checkRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(requestedBase)}`);
    if (checkRef.ok) {
      baseBranch = requestedBase;
    }
  }
  const refRes = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  if (!refRes.ok) {
    return { ok: false, error: 'Failed to get base ref', detail: await refRes.text() };
  }
  const refData = await refRes.json();
  return { ok: true, baseBranch, baseSha: refData.object.sha };
}

async function prepareSubmissionFiles({ gh, owner, repo, baseBranch, files }) {
  const preparedFiles = [];
  const skippedFiles = [];
  let mergeNotes = [];
  for (const file of files) {
    const prepared = await prepareFileUpdate({ gh, owner, repo, baseBranch, file });
    if (!prepared.hasChanges && !prepared.additionalFiles.length) {
      skippedFiles.push({ path: prepared.targetPath, code: 'NO_EFFECTIVE_CHANGES' });
      continue;
    }
    preparedFiles.push(prepared);
    mergeNotes = mergeNotes.concat(prepared.mergeNotes);
  }
  return { preparedFiles, skippedFiles, mergeNotes };
}

function buildPrBody({ description, submittedFiles, mergeNotes, skippedFiles, contributor, metadata }) {
  const mergeNotice = mergeNotes.length
    ? `\n\n---\n🔀 **Авто-спојување:** Основата беше застарена, промените се споени автоматски.\n${mergeNotes.map(n => '• ' + n).join('\n')}\n`
    : '';
  const skippedNotice = skippedFiles.length
    ? `\n\n---\nℹ️ **Без нови промени за:**\n${skippedFiles.map(file => '• ' + file.path).join('\n')}\n`
    : '';
  const submittedNotice = submittedFiles.length
    ? `\n\nФајлови:\n${submittedFiles.map(file => '• ' + file).join('\n')}`
    : '';
  const contributorNotice = contributor ? `\nПоднесено од: ${contributor}` : '';
  const metadataNotice = metadata
    ? `\n\n<!-- ${CONTRIBUTION_METADATA_MARKER}\n${JSON.stringify(metadata, null, 2)}\n-->`
    : '';
  return `${description}${submittedNotice}\n\nАвтоматски генерирано од MMM формуларот.${mergeNotice}${skippedNotice}${contributorNotice}${metadataNotice}`;
}

async function ensureFork({ gh, owner, repo, userLogin }) {
  function isExpectedFork(fork) {
    return fork && fork.fork && fork.parent && fork.parent.full_name && fork.parent.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase();
  }

  const forkRes = await gh(`/repos/${userLogin}/${repo}`);
  if (forkRes.ok) {
    const fork = await forkRes.json();
    if (isExpectedFork(fork)) {
      return { ok: true, fork };
    }
    return { ok: false, error: `${userLogin}/${repo} already exists but is not a fork of ${owner}/${repo}.` };
  }

  const createRes = await gh(`/repos/${owner}/${repo}/forks`, { method: 'POST' });
  if (!createRes.ok && createRes.status !== 202) {
    return { ok: false, error: await createRes.text() };
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pollRes = await gh(`/repos/${userLogin}/${repo}`);
    if (pollRes.ok) {
      const fork = await pollRes.json();
      if (isExpectedFork(fork)) return { ok: true, fork };
      return { ok: false, error: `${userLogin}/${repo} exists but is not the expected fork.` };
    }
    await wait(1000 + attempt * 500);
  }
  return { ok: false, error: 'Fork was requested but was not available yet. Try submitting again in a moment.' };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildContributionMetadata({ user, baseBranch, submittedFiles, skippedFiles, failedFiles, prNumber, prUrl }) {
  return {
    schema: 1,
    source: 'site',
    createdAt: new Date().toISOString(),
    submitter: publicUserFromSession({ user }),
    baseBranch,
    files: submittedFiles,
    skippedFiles,
    failedFiles,
    contributionCount: 1,
    prNumber: prNumber || null,
    prUrl: prUrl || null,
  };
}

async function handleAuthenticatedSubmission(request, env, corsHeaders) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const max = parseInt(env.RATE_LIMIT_MAX || '5', 10);
  const windowSec = parseInt(env.RATE_LIMIT_WINDOW || '60', 10);
  const rl = rateLimitCheck('submit-user:' + ip, max, windowSec * 1000);
  if (!rl.allowed) {
    const retryAfter = Math.max(0, Math.ceil((rl.reset - Date.now()) / 1000));
    return json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429, { ...corsHeaders, 'Retry-After': String(retryAfter) });
  }

  try {
    const sessionId = getSessionIdFromRequest(request);
    const session = await readSession(env, sessionId);
    if (!session) {
      return json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401, corsHeaders);
    }

    const body = await request.json();
    const description = body?.description || 'Automated PR from MMM form';
    const files = normalizeRequestedFiles(body);
    const validation = validateSubmissionFiles(files);
    if (!validation.ok) return json(validation, validation.status || 400, corsHeaders);

    const owner = env.GITHUB_OWNER || 'martinpetkovski';
    const repo = env.GITHUB_REPO || 'masterlista';
    const defaultBranch = env.GITHUB_DEFAULT_BRANCH || 'master';
    const user = session.user;
    if (!user?.login) {
      return json({ error: 'Authenticated GitHub user is missing a login', code: 'INVALID_AUTH_USER' }, 401, corsHeaders);
    }
    const contributor = contributorLabelFromUser(user);
    const upstreamGh = githubRequest(session.accessToken, 'mmm-pr-worker-user');
    const userLogin = String(user.login || '');
    const submitsToUpstream = userLogin.toLowerCase() === String(owner).toLowerCase();
    const branchOwner = submitsToUpstream ? owner : userLogin;
    const branchRepoLabel = `${branchOwner}/${repo}`;
    const repoWriteToken = submitsToUpstream ? await getRepoWriteToken(env) : null;
    if (repoWriteToken && !repoWriteToken.ok) {
      return json({ error: repoWriteToken.error, detail: repoWriteToken.detail, hint: repoWriteToken.hint, code: 'REPO_WRITE_AUTH_REQUIRED' }, 500, corsHeaders);
    }
    const writeGh = submitsToUpstream ? githubRequest(repoWriteToken.token, 'mmm-pr-worker-repo') : upstreamGh;

    const base = await resolveBaseBranch({ gh: writeGh, owner, repo, defaultBranch, requestedBase: validation.requestedBase });
    if (!base.ok) return json({ error: base.error, detail: base.detail }, 500, corsHeaders);

    const prepared = await prepareSubmissionFiles({ gh: writeGh, owner, repo, baseBranch: base.baseBranch, files });
    if (!prepared.preparedFiles.length) {
      return json({ error: 'No effective changes to submit', code: 'NO_EFFECTIVE_CHANGES', skippedFiles: prepared.skippedFiles }, 409, corsHeaders);
    }

    if (!submitsToUpstream) {
      const forkResult = await ensureFork({ gh: upstreamGh, owner, repo, userLogin });
      if (!forkResult.ok) {
        return json({ error: 'Failed to create or resolve fork', detail: forkResult.error }, 500, corsHeaders);
      }
    }

    const branchResult = await createUniqueBranch({
      gh: writeGh,
      owner: branchOwner,
      repo,
      baseSha: base.baseSha,
      contributor: userLogin,
    });
    if (!branchResult.ok) {
      return json({ error: submitsToUpstream ? 'Failed to create branch' : 'Failed to create fork branch', detail: branchResult.detail }, 500, corsHeaders);
    }

    const branchName = branchResult.branchName;
    const failedFiles = [];
    const submittedFiles = [];
    for (const fileUpdate of prepared.preparedFiles) {
      const commitResult = await commitPreparedFile({
        gh: writeGh,
        owner: branchOwner,
        repo,
        branchName,
        contributor,
        prepared: fileUpdate,
      });
      if (!commitResult.ok) {
        return json({ error: submitsToUpstream ? 'Failed to commit file' : 'Failed to commit file to fork', detail: commitResult.error, path: commitResult.path }, 500, corsHeaders);
      }
      if (fileUpdate.hasChanges) submittedFiles.push(fileUpdate.targetPath);
      failedFiles.push(...commitResult.failedFiles);
    }

    const title = `MMM: Предлог промени од @${user.login}`;
    const metadata = buildContributionMetadata({ user, baseBranch: base.baseBranch, submittedFiles, skippedFiles: prepared.skippedFiles, failedFiles });
    const bodyText = buildPrBody({
      description,
      submittedFiles,
      mergeNotes: prepared.mergeNotes,
      skippedFiles: prepared.skippedFiles,
      contributor,
      metadata,
    });
    const prPayload = {
      title,
      head: submitsToUpstream ? branchName : `${userLogin}:${branchName}`,
      base: base.baseBranch,
      body: bodyText,
      maintainer_can_modify: !submitsToUpstream,
    };
    let prCreateMode = 'user';
    let prCreateWarning = null;
    let prRes = await upstreamGh(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify(prPayload),
    });
    if (!prRes.ok && submitsToUpstream) {
      prCreateWarning = await prRes.text();
      prCreateMode = repoWriteToken.mode;
      prRes = await writeGh(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify(prPayload),
      });
    }
    if (!prRes.ok) {
      return json({ error: 'Failed to create PR', detail: await prRes.text(), userDetail: prCreateWarning }, 500, corsHeaders);
    }
    const pr = await prRes.json();
    const finalMetadata = buildContributionMetadata({ user, baseBranch: base.baseBranch, submittedFiles, skippedFiles: prepared.skippedFiles, failedFiles, prNumber: pr.number, prUrl: pr.html_url });
    const finalBodyText = buildPrBody({
      description,
      submittedFiles,
      mergeNotes: prepared.mergeNotes,
      skippedFiles: prepared.skippedFiles,
      contributor,
      metadata: finalMetadata,
    });
    let bodyUpdateRes = await (prCreateMode === 'user' ? upstreamGh : writeGh)(`/repos/${owner}/${repo}/pulls/${pr.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: finalBodyText }),
    });
    let bodyUpdateWarning = bodyUpdateRes.ok ? null : await bodyUpdateRes.text();
    if (!bodyUpdateRes.ok && submitsToUpstream && prCreateMode === 'user') {
      const userUpdateWarning = bodyUpdateWarning;
      bodyUpdateRes = await writeGh(`/repos/${owner}/${repo}/pulls/${pr.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: finalBodyText }),
      });
      bodyUpdateWarning = bodyUpdateRes.ok ? null : await bodyUpdateRes.text() || userUpdateWarning;
    }
    await invalidateContributionsCache(env);

    return json({
      ok: true,
      pr_url: pr.html_url,
      pr_number: pr.number,
      branch: branchName,
      repository: branchRepoLabel,
      fork: submitsToUpstream ? null : branchRepoLabel,
      submissionMode: submitsToUpstream ? 'upstream' : 'fork',
      writeMode: submitsToUpstream ? repoWriteToken.mode : 'user',
      pullRequestMode: prCreateMode,
      pullRequestModeWarning: prCreateWarning,
      files: submittedFiles,
      skippedFiles: prepared.skippedFiles,
      failedFiles,
      metadataUpdated: bodyUpdateRes.ok,
      metadataUpdateWarning: bodyUpdateWarning,
      user: publicUserFromSession(session),
    }, 200, corsHeaders);
  } catch (err) {
    return json({ error: 'Authenticated submission failed', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

function extractContributionMetadata(body) {
  if (!body || typeof body !== 'string') return null;
  const re = new RegExp(`<!--\\s*${CONTRIBUTION_METADATA_MARKER}\\s*([\\s\\S]*?)\\s*-->`, 'm');
  const match = body.match(re);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && parsed.source === 'site' && parsed.submitter && parsed.submitter.login) return parsed;
  } catch (_) {
    return null;
  }
  return null;
}

function publicUserFromGitHubUser(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    login: user.login || '',
    name: user.name || '',
    avatar_url: user.avatar_url || '',
    html_url: user.html_url || (user.login ? `https://github.com/${user.login}` : ''),
  };
}

function getSystemContributorLogins(env, owner) {
  const configured = (env.SYSTEM_CONTRIBUTOR_LOGINS || '')
    .split(',')
    .map(login => login.trim().toLowerCase())
    .filter(Boolean);
  return new Set([owner, 'martinpetkovski', ...configured].map(login => String(login || '').toLowerCase()).filter(Boolean));
}

function isSystemContributor(login, systemLogins) {
  return !!login && systemLogins.has(String(login).toLowerCase());
}

function maskEmails(value) {
  return String(value || '').replace(/([A-Z0-9._%+-]{1,64})@([A-Z0-9.-]+\.[A-Z]{2,})/gi, (_, local, domain) => {
    return `${local.slice(0, Math.min(2, local.length))}***@${domain.slice(0, Math.min(2, domain.length))}***`;
  });
}

function sanitizeContributionUser(user) {
  if (!user) return null;
  return {
    ...user,
    name: maskEmails(user.name || ''),
  };
}

async function getReadToken(env) {
  const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
  if (hasApp) {
    try {
      return await getInstallationToken(env);
    } catch (_) {
      if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
      return null;
    }
  }
  return env.GITHUB_TOKEN || null;
}

async function getRepoWriteToken(env) {
  const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
  if (hasApp) {
    try {
      return { ok: true, token: await getInstallationToken(env), mode: 'github_app' };
    } catch (err) {
      if (env.GITHUB_TOKEN) return { ok: true, token: env.GITHUB_TOKEN, mode: 'pat' };
      return { ok: false, error: 'GitHub App auth failed', detail: err?.message || String(err) };
    }
  }
  if (env.GITHUB_TOKEN) return { ok: true, token: env.GITHUB_TOKEN, mode: 'pat' };
  return { ok: false, error: 'Missing GitHub credentials', hint: 'Set GitHub App vars (GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY) or a PAT in GITHUB_TOKEN.' };
}

function buildContributionRecordFromPr(pr, { systemLogins, status }) {
  const metadata = extractContributionMetadata(pr.body || '');
  const submitter = sanitizeContributionUser(metadata?.submitter || publicUserFromGitHubUser(pr.user));
  if (!submitter || !submitter.login) return null;
  const system = isSystemContributor(submitter.login, systemLogins);
  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    title: maskEmails(pr.title || ''),
    mergedAt: pr.merged_at || '',
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    contributionCount: status === 'pending' ? 0 : (Number(metadata?.contributionCount || 1) || 1),
    submitter,
    system,
    status,
    source: metadata ? 'site' : 'github',
    files: Array.isArray(metadata?.files) ? metadata.files : [],
    baseBranch: metadata?.baseBranch || pr.base?.ref || '',
  };
}

async function fetchPullRequestRecords({ gh, owner, repo, state, status, systemLogins, maxPages }) {
  const records = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await gh(`/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!res.ok) {
      throw new Error(`GitHub PR list failed: ${await res.text()}`);
    }
    const prs = await res.json();
    if (!Array.isArray(prs) || !prs.length) break;
    for (const pr of prs) {
      if (state === 'closed' && !pr.merged_at) continue;
      const record = buildContributionRecordFromPr(pr, { systemLogins, status });
      if (record) records.push(record);
    }
    if (prs.length < 100) break;
  }
  return records;
}

async function fetchMergedContributionRecords(env) {
  const token = await getReadToken(env);
  const owner = env.GITHUB_OWNER || 'martinpetkovski';
  const repo = env.GITHUB_REPO || 'masterlista';
  const gh = githubRequest(token, 'mmm-contributions-worker');
  const systemLogins = getSystemContributorLogins(env, owner);
  const maxPages = Math.max(1, Math.min(parseInt(env.CONTRIBUTIONS_MAX_PAGES || '5', 10) || 5, 20));
  const pendingRecords = await fetchPullRequestRecords({ gh, owner, repo, state: 'open', status: 'pending', systemLogins, maxPages: 1 });
  const records = await fetchPullRequestRecords({ gh, owner, repo, state: 'closed', status: 'merged', systemLogins, maxPages });

  records.sort((a, b) => String(b.mergedAt || '').localeCompare(String(a.mergedAt || '')));
  pendingRecords.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const byUser = new Map();
  for (const record of records) {
    const login = record.system ? 'system' : record.submitter.login;
    const existing = byUser.get(login) || {
      login,
      id: record.system ? null : record.submitter.id,
      name: record.system ? 'System' : (record.submitter.name || ''),
      avatar_url: record.system ? '' : (record.submitter.avatar_url || ''),
      html_url: record.system ? '' : (record.submitter.html_url || `https://github.com/${login}`),
      contributions: 0,
      lastContributionAt: null,
      system: record.system,
    };
    existing.contributions += record.contributionCount;
    if (!existing.lastContributionAt || String(record.mergedAt || '') > String(existing.lastContributionAt || '')) {
      existing.lastContributionAt = record.mergedAt;
    }
    byUser.set(login, existing);
  }
  let rank = 1;
  const leaderboard = Array.from(byUser.values())
    .sort((a, b) => (b.contributions - a.contributions) || String(a.login).localeCompare(String(b.login)))
    .map((entry) => ({ ...entry, rank: entry.system ? null : rank++ }));

  return {
    generatedAt: new Date().toISOString(),
    totalContributions: records.reduce((sum, record) => sum + record.contributionCount, 0),
    leaderboardContributions: records.filter(record => !record.system).reduce((sum, record) => sum + record.contributionCount, 0),
    systemContributions: records.filter(record => record.system).reduce((sum, record) => sum + record.contributionCount, 0),
    totalContributors: leaderboard.filter(entry => !entry.system).length,
    leaderboard,
    records,
    pendingRecords,
    totalPendingRecords: pendingRecords.length,
  };
}

async function handleContributions(request, env, corsHeaders) {
  try {
    const ttl = getContributionsCacheTtl(env);
    let aggregate = null;
    if (env.AUTH_STORE) {
      const cached = await env.AUTH_STORE.get(CONTRIBUTIONS_CACHE_KEY, { type: 'json' });
      if (cached && cached.generatedAt && Date.now() - Date.parse(cached.generatedAt) < ttl * 1000) {
        aggregate = cached;
      }
    }
    if (!aggregate) {
      aggregate = await fetchMergedContributionRecords(env);
      if (env.AUTH_STORE) {
        await env.AUTH_STORE.put(CONTRIBUTIONS_CACHE_KEY, JSON.stringify(aggregate), { expirationTtl: ttl });
      }
    }

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 200);
    const pendingLimit = Math.min(Math.max(parseInt(url.searchParams.get('pending_limit') || '100', 10) || 100, 0), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    return json({
      generatedAt: aggregate.generatedAt,
      totalContributions: aggregate.totalContributions,
      leaderboardContributions: aggregate.leaderboardContributions,
      systemContributions: aggregate.systemContributions,
      totalContributors: aggregate.totalContributors,
      leaderboard: aggregate.leaderboard,
      records: aggregate.records.slice(offset, offset + limit),
      pendingRecords: aggregate.pendingRecords.slice(0, pendingLimit),
      totalRecords: aggregate.records.length,
      totalPendingRecords: aggregate.totalPendingRecords,
      limit,
      pendingLimit,
      offset,
    }, 200, { ...corsHeaders, 'Cache-Control': `public, max-age=${ttl}` });
  } catch (err) {
    return json({ error: 'Failed to load contributions', detail: err?.message || String(err) }, 500, corsHeaders);
  }
}

const EDITABLE_FILE_PATHS = {
  'bands.json': 'data/dynamic/editable/bands.json',
  'events.json': 'data/dynamic/editable/events.json',
  'releases.json': 'data/dynamic/editable/releases.json',
};

function normalizeRepoPath(filePath) {
  const normalized = String(filePath || 'bands.json').replace(/\\/g, '/').replace(/^\/+/, '');
  if (EDITABLE_FILE_PATHS[normalized]) return EDITABLE_FILE_PATHS[normalized];
  return normalized || EDITABLE_FILE_PATHS['bands.json'];
}

function getLogicalFilePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (normalized === EDITABLE_FILE_PATHS['bands.json']) return 'bands.json';
  if (normalized === EDITABLE_FILE_PATHS['events.json']) return 'events.json';
  if (normalized === EDITABLE_FILE_PATHS['releases.json']) return 'releases.json';
  return normalized;
}

function normalizeRequestedFiles(body) {
  if (Array.isArray(body?.files) && body.files.length) {
    return body.files.map(file => ({
      path: normalizeRepoPath(file?.path || 'bands.json'),
      bandsJson: file?.bandsJson,
      originalJson: file?.originalJson || null,
      additionalFiles: Array.isArray(file?.additionalFiles) ? file.additionalFiles : [],
      baseBranch: file?.baseBranch || null,
    }));
  }
  return [{
    path: normalizeRepoPath(body?.path || 'bands.json'),
    bandsJson: body?.bandsJson,
    originalJson: body?.originalJson || null,
    additionalFiles: Array.isArray(body?.additionalFiles) ? body.additionalFiles : [],
    baseBranch: body?.baseBranch || null,
  }];
}

async function prepareFileUpdate({ gh, owner, repo, baseBranch, file }) {
  const targetPath = normalizeRepoPath(file.path || 'bands.json');
  const logicalPath = getLogicalFilePath(targetPath);
  const originalJson = file.originalJson || null;
  const additionalFiles = Array.isArray(file.additionalFiles) ? file.additionalFiles : [];

  const contentsRes = await gh(`/repos/${owner}/${repo}/contents/${encodeRepoPath(targetPath)}?ref=${encodeURIComponent(baseBranch)}`);
  let currentSha = undefined;
  let currentContent = null;
  if (contentsRes.ok) {
    const contents = await contentsRes.json();
    currentSha = contents.sha;
    if (contents.content) {
      currentContent = b64decode(contents.content).replace(/^\uFEFF/, '');
    }
  }

  let finalJson = file.bandsJson;
  let mergeNotes = [];
  if (originalJson && currentContent) {
    if (normalizeComparableContent(currentContent) !== normalizeComparableContent(originalJson)) {
      const mergeResult = threeWayMerge(logicalPath, originalJson, currentContent, file.bandsJson);
      finalJson = mergeResult.merged;
      mergeNotes = mergeResult.notes;
    }
  }

  if (logicalPath === 'releases.json' && currentContent) {
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

  if (logicalPath === 'bands.json' && currentContent) {
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

  const hasChanges = !currentContent || normalizeComparableContent(finalJson) !== normalizeComparableContent(currentContent);

  return {
    targetPath,
    currentSha,
    finalJson,
    mergeNotes,
    additionalFiles,
    hasChanges,
  };
}

async function commitPreparedFile({ gh, owner, repo, branchName, contributor, prepared }) {
  if (prepared.hasChanges) {
    const putRes = await gh(`/repos/${owner}/${repo}/contents/${encodeRepoPath(prepared.targetPath)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `MMM: update ${prepared.targetPath} via form${contributor ? ` by ${contributor}` : ''}`,
        content: b64encode(prepared.finalJson),
        branch: branchName,
        sha: prepared.currentSha,
      }),
    });
    if (!putRes.ok) {
      return {
        ok: false,
        error: await putRes.text(),
        path: prepared.targetPath,
      };
    }
  }

  const failedFiles = [];
  for (const af of prepared.additionalFiles) {
    if (!af.path || !af.contentBase64) continue;
    const safePath = encodeRepoPath(af.path);
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

  return { ok: true, failedFiles };
}

async function createUniqueBranch({ gh, owner, repo, baseSha, contributor }) {
  const branchStem = buildBranchStem(contributor);
  let lastError = 'Failed to create branch';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const branchName = `${branchStem}-${randomBranchSuffix()}`;
    const createRefRes = await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    if (createRefRes.ok) {
      return { ok: true, branchName };
    }

    const text = await createRefRes.text();
    lastError = text;

    if (createRefRes.status !== 422 || !/Reference already exists/i.test(text)) {
      return { ok: false, detail: text };
    }
  }

  return { ok: false, detail: lastError };
}

function buildBranchStem(contributor) {
  const safeContributor = contributor ? slug(contributor) : 'anon';
  const ts = new Date();
  return `mmm/update-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}${pad3(ts.getMilliseconds())}-${safeContributor}`;
}

function randomBranchSuffix() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
    .slice(0, 8);
}

function pad3(n) {
  return String(n).padStart(3, '0');
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
        // Only user changed → take user's version, preserve repo-only fields, keep HEAD images
        merged.push({ ...artist, ...modMap.get(name), image: artist.image, imageSource: artist.imageSource });
        notes.push(`Изменет (корисник): ${name}`);
      } else if (mJson !== oJson && cJson !== oJson) {
        // Both changed non-image fields → take user's version, preserve repo-only fields, keep HEAD images
        merged.push({ ...artist, ...modMap.get(name), image: artist.image, imageSource: artist.imageSource });
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
        merged.push({ ...event, ...modMap.get(id) });
        notes.push(`Изменет настан (корисник): ${event.title || id}`);
      } else if (mJson !== oJson && cJson !== oJson) {
        merged.push({ ...event, ...modMap.get(id) });
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
