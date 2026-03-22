/**
 * Spotify OAuth Helper — one-time setup to get a refresh token
 *
 * Run:   node scripts/spotify-auth.js
 *
 * 1. Prints a Spotify authorization URL — open it in your browser
 * 2. Log in and grant access
 * 3. Spotify redirects to https://toplista.mk/callback?code=...
 *    The page will 404, but that's fine — the code is in the address bar
 * 4. Paste the full URL back here
 * 5. The refresh token is saved into spotify-credentials.json
 *
 * Prerequisites:
 *   - spotify-credentials.json must already have clientId and clientSecret
 *   - In your Spotify Developer Dashboard, add https://toplista.mk/callback
 *     as a Redirect URI for your app
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CREDS_PATH = path.join(ROOT, 'spotify-credentials.json');
const REDIRECT_URI = 'https://toplista.mk/callback';
const SCOPES = 'playlist-modify-public playlist-modify-private';

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error('spotify-credentials.json not found. Create it with clientId and clientSecret first.');
    process.exit(1);
  }
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

function saveCreds(creds) {
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), 'utf8');
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function exchangeCode(code, clientId, clientSecret) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }).toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function main() {
  const creds = loadCreds();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('spotify-credentials.json must contain clientId and clientSecret');
    process.exit(1);
  }

  if (creds.refreshToken) {
    console.log('NOTE: A refresh token already exists. Running this will replace it.\n');
  }

  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI
  }).toString();

  console.log('=== Spotify Authorization ===\n');
  console.log('Opening browser...\n');
  openBrowser(authUrl);
  console.log('1. Log in to Spotify and click "Agree"');
  console.log('2. You\'ll be redirected to toplista.mk/callback — the page will 404');
  console.log('3. Copy the FULL URL from your browser\'s address bar');
  console.log('   (it looks like: https://toplista.mk/callback?code=AQD...)\n');

  const input = await prompt('Paste the URL here: ');

  let code;
  try {
    const url = new URL(input);
    code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      console.error('Authorization denied:', error);
      process.exit(1);
    }
  } catch {
    code = input;
  }

  if (!code) {
    console.error('Could not find authorization code in the URL you pasted.');
    process.exit(1);
  }

  console.log('\nExchanging code for refresh token...');
  const tokens = await exchangeCode(code, creds.clientId, creds.clientSecret);

  creds.refreshToken = tokens.refresh_token;
  saveCreds(creds);

  console.log('Refresh token saved to spotify-credentials.json');
  console.log('You can now run: ./update-all.ps1 -Only playlists');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
