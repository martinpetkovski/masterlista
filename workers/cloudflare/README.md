# MMM Cloudflare Worker

**PR Worker** (`pr-worker.js`) - Creates GitHub PRs from the Master List UI when users submit changes.

> **Note:** Spotify chart data is now generated via GitHub Actions instead of a Cloudflare Worker.
> See `.github/workflows/generate-chart-data.yml`

---

## Deploy PR Worker

```powershell
wrangler deploy --config wrangler.toml
```

## Setup

### Install wrangler

```powershell
npm i -g wrangler
```

### Set GitHub credentials

```powershell
wrangler secret put GITHUB_TOKEN
```

At minimum, `GITHUB_TOKEN` is required (PAT with `repo` scope). The others have defaults: owner `martinpetkovski`, repo `masterlista`, base branch `master`.

### (Optional) Switch to GitHub App authentication instead of PAT.

### GitHub App Auth
Instead of `GITHUB_TOKEN` you can set these secrets/vars:

Secrets:
- `GITHUB_APP_PRIVATE_KEY`  (PKCS#8 PEM: -----BEGIN PRIVATE KEY-----)

Vars (plain):
- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`

Private key format: You can paste either
- PKCS#8: `-----BEGIN PRIVATE KEY-----`
- PKCS#1 (RSA): `-----BEGIN RSA PRIVATE KEY-----`
The worker auto-converts PKCS#1 to PKCS#8 internally; conversion is optional.
If you prefer manual conversion:
```powershell
openssl pkcs8 -topk8 -inform PEM -outform PEM -in app-private-key.pem -nocrypt -out app-private-key-pkcs8.pem
```

Set secrets / vars:
```powershell
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_INSTALLATION_ID
```
If App variables are present worker automatically uses installation tokens.

### GitHub user login and fork submissions

The site can optionally submit changes through the logged-in visitor's GitHub account. Anonymous site submissions still use the legacy root `POST /` worker route, so GitHub login is an enhancement rather than a requirement.

Create a GitHub OAuth App with:

- Homepage URL: `https://toplista.mk`
- Authorization callback URL: `https://<worker-domain>/auth/callback`
- Device flow: enabled, so literal local `file://` usage can sign in without an HTTP callback

The `AUTH_STORE` KV namespace is bound in `wrangler.toml` and stores OAuth state, sessions, and the short-lived contributions cache.

Set OAuth secrets:

```powershell
wrangler secret put GITHUB_OAUTH_CLIENT_ID
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
```

The authenticated site flow uses these endpoints:

- `GET /auth/start?return_to=<url>` redirects to GitHub OAuth.
- `GET /auth/callback` exchanges the OAuth code and redirects back with an opaque session id.
- `POST /auth/device/start` and `POST /auth/device/poll` support file-based local usage.
- `GET /auth/session` validates the current session.
- `POST /auth/logout` deletes the session.
- `POST /submit/user` creates or reuses the signed-in user's fork, pushes a branch there, and opens an upstream PR.
- `GET /contributions` reads open and merged GitHub PRs. It returns `pendingRecords` for open PRs, the requested recent merged `records`, and a leaderboard. System contributors such as `martinpetkovski` are included in the records but excluded from the leaderboard.

The existing root `POST /` route remains available for anonymous site submissions and worker-owned submissions such as the Discord bot.

5) Publish

```powershell
wrangler deploy
```

## Configure frontend

In `masterlista/index.html`, the submit button accepts a `data-endpoint` attribute. You can also set it at runtime via localStorage or a global var:

- Add to HTML: `data-endpoint="https://<your-subdomain>.workers.dev"`
- Or in console: `localStorage.setItem('mmm_pr_endpoint','https://<your-subdomain>.workers.dev')`
- Or set `window.MMM_PR_ENDPOINT` before `script.js` runs.

## Example `wrangler.toml`

```toml
name = "mmm-pr-worker"
main = "src/pr-worker.js"
compatibility_date = "2023-10-02"

[vars]
# Optional defaults; can be set as "secret" via wrangler too
GITHUB_OWNER = "martinpetkovski"
GITHUB_REPO = "masterlista"
GITHUB_DEFAULT_BRANCH = "master"
```

## Request payload

```json
{
  "bandsJson": "...stringified JSON of bands.json...",
  "contributor": "optional name/email",
  "description": "short description",
  "path": "data/dynamic/editable/bands.json"
}
```

`path` may still be sent as the legacy short form (`bands.json`, `events.json`, `releases.json`), but the canonical repo paths now live under `data/dynamic/editable/`.

## Response
## Rate Limiting
Environment variables (optional):
- `RATE_LIMIT_MAX` (default 5)
- `RATE_LIMIT_WINDOW` seconds (default 60)

Returns 429 with `Retry-After` and `X-RateLimit-*` headers if exceeded.

## CORS
Currently permissive `*` for local testing. For production you can restrict:
```javascript
// Replace Access-Control-Allow-Origin: '*'
'Access-Control-Allow-Origin': 'https://martinpetkovski.github.io'
```

## GitHub App vs PAT
- PAT: simpler, fewer moving parts.
- App: granular permissions; rotate private key if compromised.

Troubleshooting:
- 401 Bad credentials with App: ensure PKCS#8 format and correct App/Installation IDs.
- Check installation ID via: `GET https://api.github.com/app/installations` using a JWT (Bearer <jwt>). Use one with repo access.


```json
{
  "ok": true,
  "pr_url": "https://github.com/<owner>/<repo>/pull/<number>",
  "pr_number": 123,
  "branch": "mmm/update-..."
}
```
