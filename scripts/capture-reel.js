#!/usr/bin/env node
// scripts/capture-reel.js
//
// Captures the reels.html preview as a video using Puppeteer + ffmpeg.
// Uses virtual time control for frame-perfect 30fps output.
// The result is pixel-identical to the browser preview.
//
// Usage:
//   node scripts/capture-reel.js --mode mon
//   node scripts/capture-reel.js --mode tue          (alt chart)
//   node scripts/capture-reel.js --mode wed          (new releases)
//   node scripts/capture-reel.js --mode sat --artist "Name"  (specific artist)
//   node scripts/capture-reel.js --mode thu --song "releaseId"  (specific TBT song)
//   node scripts/capture-reel.js --chart-mode alt    (alias for --mode tue)
//   node scripts/capture-reel.js --chart-mode standard (alias for --mode mon)

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

// â”€â”€ Paths â”€â”€
const ROOT = path.resolve(__dirname, '..');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'tools', 'ffprobe.exe');
const YTDLP = path.join(ROOT, 'tools', 'yt-dlp.exe');
const OUTPUT_DIR = path.join(ROOT, 'chart-videos');
const TEMP_DIR = path.join(ROOT, 'chart-videos', '.temp-capture');
const VIDEO_DIR = path.join(ROOT, 'chart-videos', '.temp-videos');
const SFX_DIR = path.join(ROOT, 'sfx');

// â”€â”€ Config â”€â”€
const FPS = 60;
const VIEWPORT_W = 360;
const VIEWPORT_H = 640;
const DEVICE_SCALE = 3; // 360Ã—640 Ã— 3 = 1080Ã—1920

// â”€â”€ CLI â”€â”€
const argv = process.argv.slice(2);
let mode = null;
let forcedArtist = null;
let forcedSong = null;
let uploadOnly = false;
let uploadFile = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--mode' && argv[i + 1]) mode = argv[++i];
  if (argv[i] === '--artist' && argv[i + 1]) forcedArtist = argv[++i];
  if (argv[i] === '--song' && argv[i + 1]) forcedSong = argv[++i];
  if (argv[i] === '--upload') {
    uploadOnly = true;
    // Next arg is file path only if it doesn't start with --
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) uploadFile = argv[++i];
  }
  if (argv[i] === '--chart-mode' && argv[i + 1]) {
    const cm = argv[++i];
    mode = cm === 'alt' ? 'tue' : cm === 'standard' ? 'mon' : cm;
  }
}
if (!mode) {
  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  mode = dayKeys[(new Date().getDay() + 6) % 7];
}

const MODE_LABELS = {
  mon: 'Monday \u2013 \u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430',
  tue: 'Tuesday \u2013 \u0410\u043B\u0442 \u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430',
  wed: 'Wednesday \u2013 \u041D\u043E\u0432\u0438 \u0418\u0437\u0434\u0430\u043D\u0438\u0458\u0430',
  thu: 'Thursday \u2013 \u0422\u0411\u0422 \u0427\u0435\u0442\u0432\u0440\u0442\u043E\u043A',
  fri: 'Friday \u2013 \u041D\u0430\u0441\u0442\u0430\u043D\u0438 \u0412\u0438\u043A\u0435\u043D\u0434\u043E\u0432',
  sat: 'Saturday \u2013 \u0410\u0440\u0442\u0438\u0441\u0442 \u043D\u0430 \u041D\u0435\u0434\u0435\u043B\u0430\u0442\u0430',
  sun: 'Sunday \u2013 \u0421\u043A\u0440\u0438\u0435\u043D\u0438 \u0411\u043E\u0433\u0430\u0442\u0441\u0442\u0432\u0430',
};

// â”€â”€ Logging â”€â”€
const log = (m, c = '\x1b[0m') => console.log(`${c}  > ${m}\x1b[0m`);
const logS = t => console.log(`\n\x1b[36m${'='.repeat(70)}\n  ${t}\n${'='.repeat(70)}\x1b[0m\n`);
const logStep = m => log(m, '\x1b[33m');
const logOk = m => log(m, '\x1b[32m');
const logErr = m => log(m, '\x1b[31m');

// â”€â”€ Utilities â”€â”€
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function cleanDir(d) {
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
    }
  }
}

// â”€â”€ Get chorus/peak timestamp via YouTube heatmap â”€â”€
function getChorusTimestamp(videoId) {
  try {
    const json = execFileSync(YTDLP, [
      '--dump-json', '--skip-download', '--no-warnings', '--quiet',
      `https://www.youtube.com/watch?v=${videoId}`
    ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, windowsHide: true }).toString();
    const info = JSON.parse(json);
    const duration = info.duration || 180;

    if (info.heatmap && info.heatmap.length > 0) {
      const peak = info.heatmap.reduce((best, h) => h.value > best.value ? h : best);
      const chorusStart = Math.max(0, peak.start_time - 2);
      logStep(`  Heatmap peak at ${peak.start_time.toFixed(1)}s (intensity ${peak.value.toFixed(2)})`);
      return { start: Math.min(chorusStart, Math.max(0, duration - 25)), duration };
    }

    const fallback = Math.min(Math.floor(duration * 0.33), Math.max(0, duration - 25));
    logStep(`  No heatmap, using ${fallback}s (33% of ${duration}s)`);
    return { start: fallback, duration };
  } catch (e) {
    logStep(`  Info fetch failed, defaulting to 40s`);
    return { start: 40, duration: 180 };
  }
}

// â”€â”€ Download YouTube clip from specific timestamp â”€â”€
function downloadYoutubeClip(videoId, outputPath, startSec, clipLen) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const endSec = startSec + clipLen;
  const args = [
    '--no-playlist',
    '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '--download-sections', `*${startSec}-${endSec}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', path.dirname(FFMPEG),
    '-o', outputPath,
    '--no-warnings',
    '--quiet',
    url,
  ];
  try {
    execFileSync(YTDLP, args, { stdio: 'pipe', timeout: 300000, windowsHide: true });
    return fs.existsSync(outputPath);
  } catch (e) {
    logErr(`yt-dlp failed for ${videoId}: ${e.stderr?.toString().slice(-200) || e.message}`);
    return false;
  }
}

// â”€â”€ Extract video frames at capture fps â”€â”€
function extractVideoFrames(clipPath, videoId) {
  const framesDir = path.join(VIDEO_DIR, `${videoId}_frames`);
  ensureDir(framesDir);
  execFileSync(FFMPEG, [
    '-i', clipPath,
    '-vf', `fps=${FPS}`,
    '-q:v', '3',
    path.join(framesDir, 'f_%05d.jpg'),
  ], { stdio: 'pipe', timeout: 60000, windowsHide: true });
  const count = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).length;
  return { framesDir, frameCount: count };
}

// â”€â”€ Static HTTP server â”€â”€
function startServer() {
  return new Promise((resolve) => {
    const mimeTypes = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
      '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
      if (filePath.endsWith(path.sep)) filePath += 'index.html';
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// â”€â”€ Main â”€â”€
async function main() {
  console.log(`\n\x1b[35m${'='.repeat(70)}\n  REEL CAPTURE \u2014 ${MODE_LABELS[mode] || mode}\n  ${new Date().toISOString().slice(0, 19)}\n${'='.repeat(70)}\x1b[0m`);

  if (!fs.existsSync(FFMPEG)) { logErr(`ffmpeg not found: ${FFMPEG}`); process.exit(1); }
  ensureDir(OUTPUT_DIR);
  ensureDir(TEMP_DIR);
  cleanDir(TEMP_DIR);

  // â”€â”€ 1. Start local server â”€â”€
  logS('STARTING SERVER');
  const { server, port } = await startServer();
  logOk(`http://127.0.0.1:${port}`);

  // â”€â”€ 2. Launch browser â”€â”€
  logS('LAUNCHING BROWSER');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: DEVICE_SCALE });
  logOk(`Viewport: ${VIEWPORT_W}\u00D7${VIEWPORT_H} @ ${DEVICE_SCALE}x = ${VIEWPORT_W * DEVICE_SCALE}\u00D7${VIEWPORT_H * DEVICE_SCALE}`);

  // â”€â”€ 3. Load page (real time â€” data fetches, init, switchDay) â”€â”€
  logS('LOADING PAGE');
  const url = `http://127.0.0.1:${port}/reels.html?capture=${mode}${forcedArtist ? '&artist=' + encodeURIComponent(forcedArtist) : ''}${forcedSong ? '&song=' + encodeURIComponent(forcedSong) : ''}`;
  logStep(url);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => window.__captureReady, { timeout: 30000 });
  const totalDuration = await page.evaluate(() => window.__totalDuration);
  logOk(`Ready \u2014 ${totalDuration}s, ${Math.ceil(totalDuration * FPS)} frames to capture`);
  // â”€â”€ 3b. Download YouTube video clips (chorus detection + frame extraction) â”€â”€
  let audioClips = []; // { videoId, startSec, duration, filePath }
  const hasYtdlp = fs.existsSync(YTDLP);
  if (hasYtdlp) {
    logS('DOWNLOADING YOUTUBE CLIPS');
    if (fs.existsSync(VIDEO_DIR)) fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
    ensureDir(VIDEO_DIR);

    // Extract scene metadata (videoIds + timing)
    const sceneMeta = await page.evaluate(() => {
      const scenes = window.__currentScenes || [];
      let t = 0;
      return scenes.map(s => {
        const start = t;
        t += (s.duration || 4);
        return { type: s.type, videoId: s.videoId || null, startSec: start, duration: s.duration || 4 };
      });
    });

    const clipScenes = sceneMeta.filter(s => s.videoId);
    const sortedClips = clipScenes.slice().sort((a, b) => a.startSec - b.startSec);
    const videoIds = [...new Set(sortedClips.map(s => s.videoId))];
    logStep(`Found ${videoIds.length} video clips to download`);

    // Calculate how much audio each clip needs (its scene + surrounding LPF territory)
    const clipNeedSec = {};
    for (const vid of videoIds) clipNeedSec[vid] = 0;
    for (let i = 0; i < sortedClips.length; i++) {
      const c = sortedClips[i];
      const territoryStart = i === 0 ? 0 : c.startSec;
      const nextStart = i + 1 < sortedClips.length ? sortedClips[i + 1].startSec : totalDuration;
      clipNeedSec[c.videoId] = Math.max(clipNeedSec[c.videoId], nextStart - territoryStart);
    }

    // Compute frame offsets for audio/video sync (first clip starts at t=0 for intro LPF)
    const clipFrameOffset = {};
    for (let i = 0; i < sortedClips.length; i++) {
      const c = sortedClips[i];
      const terrStart = i === 0 ? 0 : c.startSec;
      clipFrameOffset[c.videoId] = Math.round((c.startSec - terrStart) * FPS);
    }

    // Download each clip from its chorus region + extract frames
    const videoFrameMap = {};
    const downloadedIds = new Set();
    for (const vid of videoIds) {
      logStep(`Fetching info for ${vid}...`);
      const { start: chorusStart } = getChorusTimestamp(vid);
      const clipLen = Math.ceil(Math.max(clipNeedSec[vid] || 10, 10) + 2);
      const outFile = path.join(VIDEO_DIR, `${vid}.mp4`);
      logStep(`Downloading ${vid} @ ${chorusStart}s (${clipLen}s)...`);
      const ok = downloadYoutubeClip(vid, outFile, chorusStart, clipLen);
      if (ok) {
        logStep(`Extracting frames for ${vid}...`);
        try {
          const { framesDir, frameCount } = extractVideoFrames(outFile, vid);
          const relFrames = path.relative(ROOT, framesDir).replace(/\\/g, '/');
          videoFrameMap[vid] = {
            baseUrl: `http://127.0.0.1:${port}/${relFrames}`,
            frameCount,
            offsetFrames: clipFrameOffset[vid] || 0,
          };
          downloadedIds.add(vid);
          logOk(`âœ“ ${vid} â€” ${frameCount} frames extracted`);
        } catch (e) {
          logErr(`Frame extraction failed for ${vid}: ${e.message}`);
        }
      } else {
        logErr(`âœ— ${vid} â€” will use thumbnail fallback`);
      }
    }

    // Build audioClips for later audio mixing
    audioClips = sortedClips
      .filter(s => downloadedIds.has(s.videoId))
      .map(s => ({
        videoId: s.videoId,
        startSec: s.startSec,
        duration: s.duration,
        filePath: path.join(VIDEO_DIR, `${s.videoId}.mp4`),
      }));

    // Inject the frame map into the page
    if (Object.keys(videoFrameMap).length > 0) {
      await page.evaluate((map) => { window.__videoFrameMap = map; }, videoFrameMap);
      logOk(`Injected ${Object.keys(videoFrameMap).length} video frame maps`);
    }
  } else {
    logStep('yt-dlp not found, using thumbnail fallback');
  }
  // â”€â”€ 4. Inject virtual time control & start playback â”€â”€
  logS('INJECTING TIME CONTROL');
  await page.evaluate(() => {
    // Save real setTimeout before override (needed for video seek safety)
    const _realSetTimeout = window.setTimeout;

    // Override Date.now
    const _epoch = Date.now();
    let _virtualTime = 0;
    Date.now = () => _epoch + _virtualTime;

    // Override requestAnimationFrame
    let _rafId = 0;
    const _rafQueue = [];
    window.requestAnimationFrame = (cb) => { _rafQueue.push(cb); return ++_rafId; };
    window.cancelAnimationFrame = () => {};

    // Override setTimeout / clearTimeout
    const _timers = [];
    let _tid = 0;
    window.setTimeout = (cb, delay, ...args) => {
      if (typeof cb !== 'function') return 0;
      _timers.push({ id: ++_tid, cb, fireAt: _virtualTime + (delay || 0), args });
      return _tid;
    };
    window.clearTimeout = (id) => {
      const i = _timers.findIndex(t => t.id === id);
      if (i >= 0) _timers.splice(i, 1);
    };

    // Track CSS animation birth times
    const _animBirths = new WeakMap();
    // Track frame-image appearance times
    const _imgBirths = new WeakMap();

    window.__advanceFrame = (timeMs) => {
      _virtualTime = timeMs;

      // Fire due timers (may create new timers, so loop)
      let safety = 2000;
      while (safety-- > 0) {
        const idx = _timers.findIndex(t => t.fireAt <= timeMs);
        if (idx < 0) break;
        const timer = _timers.splice(idx, 1)[0];
        timer.cb(...timer.args);
      }

      // Fire rAF callbacks (nested rAFs get picked up in subsequent rounds)
      for (let round = 0; round < 10 && _rafQueue.length > 0; round++) {
        const cbs = _rafQueue.splice(0);
        for (const cb of cbs) cb(timeMs);
      }

      // Pause & seek all CSS animations
      for (const anim of document.getAnimations()) {
        if (!_animBirths.has(anim)) {
          _animBirths.set(anim, timeMs);
        }
        if (anim.playState !== 'paused') anim.pause();
        const localTime = timeMs - _animBirths.get(anim);
        if (localTime >= 0) anim.currentTime = localTime;
      }

      // Update frame-sequence images (only in active scenes)
      const _imgLoadPromises = [];
      for (const img of document.querySelectorAll('img[data-video-id]')) {
        const scene = img.closest('.scene');
        if (!scene || !scene.classList.contains('active')) continue;
        if (!_imgBirths.has(img)) _imgBirths.set(img, timeMs);
        const localMs = timeMs - _imgBirths.get(img);
        const frameCount = parseInt(img.dataset.frameCount, 10);
        const offsetFrames = parseInt(img.dataset.frameOffset || '0', 10);
        const frameNum = Math.min(Math.floor(localMs / (1000 / 60)) + 1 + offsetFrames, frameCount);
        const paddedNum = String(frameNum).padStart(5, '0');
        const target = '/f_' + paddedNum + '.jpg';
        if (!img.src.endsWith(target)) {
          _imgLoadPromises.push(new Promise(res => {
            img.onload = res;
            _realSetTimeout(res, 100);
            img.src = img.dataset.frameBase + target;
          }));
        }
      }

      // Force layout
      document.body.offsetHeight;

      if (_imgLoadPromises.length > 0) return Promise.all(_imgLoadPromises);
    };

    // Start playback under time control
    startPlayback();
    window.__advanceFrame(0);
  });
  logOk('Playback started under virtual time control');

  // â”€â”€ 4b. Preload first video frames â”€â”€
  const frameImgCount = await page.evaluate(() => document.querySelectorAll('img[data-video-id]').length);
  if (frameImgCount > 0) {
    logStep(`Preloading ${frameImgCount} video frame image(s)...`);
    await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img[data-video-id]')];
      return Promise.all(imgs.map(img =>
        img.complete ? Promise.resolve() :
        new Promise(res => { img.onload = res; img.onerror = res; })
      ));
    });
    logOk('First frames loaded');
  }

  // â”€â”€ 5. Capture frames â”€â”€
  logS('CAPTURING FRAMES');
  const totalFrames = Math.ceil(totalDuration * FPS);
  const frameMs = 1000 / FPS;
  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const t = i * frameMs;
    await page.evaluate(t => window.__advanceFrame(t), t);
    const framePath = path.join(TEMP_DIR, `frame-${String(i).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: framePath, type: 'jpeg', quality: 95 });

    if ((i + 1) % 60 === 0 || i === totalFrames - 1) {
      const pct = ((i + 1) / totalFrames * 100).toFixed(1);
      const elapsed = ((Date.now() - captureStart) / 1000).toFixed(1);
      const eta = ((Date.now() - captureStart) / (i + 1) * (totalFrames - i - 1) / 1000).toFixed(0);
      logStep(`${i + 1}/${totalFrames} frames (${pct}%) \u2014 ${elapsed}s elapsed, ~${eta}s remaining`);
    }
  }

  const captureTime = ((Date.now() - captureStart) / 1000).toFixed(1);
  logOk(`Captured ${totalFrames} frames in ${captureTime}s`);

  // â”€â”€ 5b. Extract scene timeline for SFX (before browser close) â”€â”€
  const sceneTimeline = await page.evaluate(() => {
    const scenes = window.__currentScenes || [];
    let t = 0;
    return scenes.map(s => {
      const start = t;
      t += (s.duration || 4);
      return { type: s.type, startSec: start };
    });
  });

  // â”€â”€ 5c. Extract caption data from scenes â”€â”€
  const captionData = await page.evaluate(() => {
    const scenes = window.__currentScenes || [];
    return scenes.map(s => ({
      type: s.type,
      artist: s.artist || s.artistName || '',
      songTitle: s.songTitle || '',
      rank: s.rank || '',
      genre: s.genre || '',
      city: s.city || '',
      entries: (s.entries || []).slice(0, 10).map(e => ({ bandName: e.bandName, releaseTitle: e.releaseTitle })),
      releases: (s.releases || []).slice(0, 5).map(r => ({ bandName: r.bandName, releaseTitle: r.releaseTitle })),
      events: (s.events || []).slice(0, 5).map(e => ({ title: e.title, place: e.place })),
      songs: (s.songs || []).slice(0, 5).map(s => ({ title: s.title })),
      releaseDate: s.releaseDate || '',
      views: s.views || 0,
    }));
  });

  // â”€â”€ 6. Clean up browser & server â”€â”€
  await browser.close();
  server.close();

  // â”€â”€ 7. Encode video (silent) â”€â”€
  logS('ENCODING VIDEO');
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputName = `reel-${mode}-${timestamp}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  const ffArgs = [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(TEMP_DIR, 'frame-%05d.jpg'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'slow',
    '-r', String(FPS),
    '-movflags', '+faststart',
    outputPath,
  ];

  logStep(`${totalFrames} frames @ ${FPS}fps \u2192 ${outputName}`);

  try {
    execFileSync(FFMPEG, ffArgs, { stdio: 'pipe', timeout: 300000, windowsHide: true });
    const size = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
    logOk(`\u2713 ${outputPath} (${size} MB)`);
  } catch (e) {
    logErr(`ffmpeg error: ${e.stderr?.toString().slice(-500) || e.message}`);
    process.exit(1);
  }

  // â”€â”€ 8. Mix audio â€” continuous music with smooth LPF crossfades â”€â”€
  if (audioClips.length > 0) {
    logS('MIXING AUDIO');

    // Check which clips have audio streams
    const hasProbe = fs.existsSync(FFPROBE);
    const clipsWithAudio = audioClips.filter(c => {
      if (!fs.existsSync(c.filePath)) return false;
      if (!hasProbe) return true;
      try {
        const probe = execFileSync(FFPROBE, [
          '-v', 'error', '-select_streams', 'a',
          '-show_entries', 'stream=codec_type',
          '-of', 'csv=p=0', c.filePath
        ], { stdio: 'pipe', windowsHide: true }).toString().trim();
        return probe.includes('audio');
      } catch { return false; }
    });

    if (clipsWithAudio.length > 0) {
      logStep(`${clipsWithAudio.length} clip(s) with audio`);

      // For each clip, create a DRY (full-band) and WET (LPF+quiet) stream.
      // Volume envelopes smoothly crossfade between them around the scene edges.
      // amix stacks all streams â€” at territory boundaries, neighboring clips'
      // wet audio overlaps briefly, creating a natural song-to-song crossfade.
      const XFADE = 0.5; // seconds for LPF ramp
      const filterParts = [];
      const mixLabels = [];

      for (let i = 0; i < clipsWithAudio.length; i++) {
        const c = clipsWithAudio[i];
        const inputIdx = i + 1;

        // Territory: time window this clip's audio covers
        const terrStart = i === 0 ? 0 : c.startSec;
        const terrEnd = i === clipsWithAudio.length - 1
          ? totalDuration
          : clipsWithAudio[i + 1].startSec;
        const terrDur = terrEnd - terrStart;

        // Scene boundaries in LOCAL audio time (0 = clip audio start)
        const sLS = c.startSec - terrStart;
        const sLE = sLS + c.duration;

        // Ramp edges, clamped to territory
        const rIn = Math.max(0, sLS - XFADE).toFixed(3);
        const rOut = Math.min(terrDur, sLE + XFADE).toFixed(3);
        const xf = XFADE.toFixed(3);

        // Dry envelope: 0 outside scene, ramps to 1 inside
        const dryVol = `'max(0,min(1,min((t-${rIn})/${xf},(${rOut}-t)/${xf})))'`;
        // Wet envelope: 0.65 outside scene, ramps to 0 inside (loud enough to match dry)
        const wetVol = `'0.65*max(0,1-max(0,min(1,min((t-${rIn})/${xf},(${rOut}-t)/${xf}))))'`;

        const delayMs = Math.round(terrStart * 1000);
        const delayStr = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : '';
        const td = terrDur.toFixed(3);

        // Dry stream: full-band audio, loud during scene
        filterParts.push(
          `[${inputIdx}:a]atrim=0:${td},asetpts=PTS-STARTPTS,volume=${dryVol}:eval=frame${delayStr},apad[dry${i}]`
        );
        // Wet stream: LPF + quiet, fills non-scene time
        filterParts.push(
          `[${inputIdx}:a]atrim=0:${td},asetpts=PTS-STARTPTS,lowpass=f=400,volume=${wetVol}:eval=frame${delayStr},apad[wet${i}]`
        );
        mixLabels.push(`[dry${i}]`, `[wet${i}]`);
      }

      // â”€â”€ Build SFX events based on scene types â”€â”€
      const sfxFiles = {
        short: path.join(SFX_DIR, 'short.mp3'),
        med: path.join(SFX_DIR, 'med.mp3'),
        long: path.join(SFX_DIR, 'long.mp3'),
      };
      const sfxAvailable = Object.values(sfxFiles).every(f => fs.existsSync(f));
      const sfxEvents = []; // { file, timeSec }
      if (sfxAvailable) {
        for (const s of sceneTimeline) {
          if (s.type === 'intro' || s.type === 'outro') {
            sfxEvents.push({ file: sfxFiles.long, timeSec: s.startSec });
          } else if (s.type === 'clip' || s.type === 'event-clip') {
            sfxEvents.push({ file: sfxFiles.short, timeSec: s.startSec });
          } else {
            sfxEvents.push({ file: sfxFiles.med, timeSec: s.startSec });
          }
        }
        logStep(`${sfxEvents.length} SFX events mapped`);
      } else {
        logStep('SFX files not found in sfx/ â€” skipping');
      }

      // Mix all streams, trim to video duration, fade out at the end
      const fadeSt = Math.max(0, totalDuration - 2.5).toFixed(3);

      // Add SFX streams to the mix
      let sfxInputOffset = clipsWithAudio.length + 1; // input indices after video + audio clips
      const sfxInputArgs = [];
      for (let si = 0; si < sfxEvents.length; si++) {
        const sfx = sfxEvents[si];
        const idx = sfxInputOffset++;
        sfxInputArgs.push('-i', sfx.file);
        const delayMs = Math.round(sfx.timeSec * 1000);
        const delayStr = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : '';
        filterParts.push(
          `[${idx}:a]volume=0.8${delayStr},apad[sfx${si}]`
        );
        mixLabels.push(`[sfx${si}]`);
      }

      // Add outro bumper
      const outroBumperFile = path.join(SFX_DIR, 'outro_bumper.wav');
      if (fs.existsSync(outroBumperFile)) {
        const outroScene = sceneTimeline.find(s => s.type === 'outro');
        if (outroScene) {
          const bumperIdx = sfxInputOffset++;
          sfxInputArgs.push('-i', outroBumperFile);
          const bumperDelay = Math.round(outroScene.startSec * 1000);
          const bumperDelayStr = bumperDelay > 0 ? `,adelay=${bumperDelay}|${bumperDelay}` : '';
          filterParts.push(`[${bumperIdx}:a]volume=0.8${bumperDelayStr},apad[bumper]`);
          mixLabels.push('[bumper]');
          logStep('Outro bumper added');
        }
      }

      filterParts.push(
        `${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0,dynaudnorm=p=0.9:m=10:s=5,atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${fadeSt}:d=2.5[aout]`
      );

      const filterStr = filterParts.join('; ');
      logStep(`Audio filter: ${clipsWithAudio.length} clips Ã— 2 streams (dry+wet) + ${sfxEvents.length} SFX, ${mixLabels.length} inputs`);

      const tmpPath = outputPath.replace('.mp4', '-silent.mp4');
      fs.renameSync(outputPath, tmpPath);

      const ffAudioArgs = [
        '-y',
        '-i', tmpPath,
        ...clipsWithAudio.flatMap(c => ['-i', c.filePath]),
        ...sfxInputArgs,
        '-filter_complex', filterStr,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-shortest',
        outputPath,
      ];

      try {
        execFileSync(FFMPEG, ffAudioArgs, { stdio: 'pipe', timeout: 120000, windowsHide: true });
        fs.unlinkSync(tmpPath);
        const size = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
        logOk(`\u2713 Audio mixed: ${outputPath} (${size} MB)`);
      } catch (e) {
        logErr(`Audio mixing failed: ${e.stderr?.toString().slice(-300) || e.message}`);
        if (fs.existsSync(tmpPath)) {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          fs.renameSync(tmpPath, outputPath);
        }
        logStep('Keeping silent video');
      }
    }
  }

  // â”€â”€ 8b. SFX-only mixing (for modes without music) â”€â”€
  if (audioClips.length === 0) {
    const sfxFiles = {
      short: path.join(SFX_DIR, 'short.mp3'),
      med: path.join(SFX_DIR, 'med.mp3'),
      long: path.join(SFX_DIR, 'long.mp3'),
    };
    const sfxAvailable = Object.values(sfxFiles).every(f => fs.existsSync(f));
    if (sfxAvailable) {
      logS('MIXING SFX (no music)');
      const sfxEvents = [];
      for (const s of sceneTimeline) {
        if (s.type === 'intro' || s.type === 'outro') {
          sfxEvents.push({ file: sfxFiles.long, timeSec: s.startSec });
        } else if (s.type === 'clip' || s.type === 'event-clip') {
          sfxEvents.push({ file: sfxFiles.short, timeSec: s.startSec });
        } else {
          sfxEvents.push({ file: sfxFiles.med, timeSec: s.startSec });
        }
      }
      if (sfxEvents.length > 0) {
        const filterParts = [];
        const mixLabels = [];
        const sfxInputArgs = [];
        for (let si = 0; si < sfxEvents.length; si++) {
          const sfx = sfxEvents[si];
          const idx = si + 1; // input 0 is video
          sfxInputArgs.push('-i', sfx.file);
          const delayMs = Math.round(sfx.timeSec * 1000);
          const delayStr = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : '';
          filterParts.push(`[${idx}:a]volume=0.8${delayStr},apad[sfx${si}]`);
          mixLabels.push(`[sfx${si}]`);
        }

        // Add outro bumper
        const outroBumperFile = path.join(SFX_DIR, 'outro_bumper.wav');
        if (fs.existsSync(outroBumperFile)) {
          const outroScene = sceneTimeline.find(s => s.type === 'outro');
          if (outroScene) {
            const bumperIdx = sfxEvents.length + 1;
            sfxInputArgs.push('-i', outroBumperFile);
            const bumperDelay = Math.round(outroScene.startSec * 1000);
            const bumperDelayStr = bumperDelay > 0 ? `,adelay=${bumperDelay}|${bumperDelay}` : '';
            filterParts.push(`[${bumperIdx}:a]volume=0.8${bumperDelayStr},apad[bumper]`);
            mixLabels.push('[bumper]');
            logStep('Outro bumper added');
          }
        }

        const fadeSt = Math.max(0, totalDuration - 2.5).toFixed(3);
        filterParts.push(
          `${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0,dynaudnorm=p=0.9:m=10:s=5,atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${fadeSt}:d=2.5[aout]`
        );
        const filterStr = filterParts.join('; ');
        const tmpPath = outputPath.replace('.mp4', '-silent.mp4');
        fs.renameSync(outputPath, tmpPath);
        const ffAudioArgs = [
          '-y', '-i', tmpPath,
          ...sfxInputArgs,
          '-filter_complex', filterStr,
          '-map', '0:v', '-map', '[aout]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-shortest', outputPath,
        ];
        try {
          execFileSync(FFMPEG, ffAudioArgs, { stdio: 'pipe', timeout: 120000, windowsHide: true });
          fs.unlinkSync(tmpPath);
          logOk(`âœ“ SFX mixed: ${outputPath}`);
        } catch (e) {
          logErr(`SFX mixing failed: ${e.stderr?.toString().slice(-300) || e.message}`);
          if (fs.existsSync(tmpPath)) {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            fs.renameSync(tmpPath, outputPath);
          }
        }
      }
    }
  }

  // â”€â”€ 9. Clean up frames & video clips â”€â”€
  cleanDir(TEMP_DIR);
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  if (fs.existsSync(VIDEO_DIR)) {
    cleanDir(VIDEO_DIR);
    fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  }

  logS('DONE');
  logOk(`Output: ${outputPath}`);

  // â”€â”€ 10. Ask about Instagram upload â”€â”€
  await uploadToInstagram(outputPath, mode, captionData);
}

// â”€â”€ Instagram Reel upload helpers â”€â”€
function igApiPost(apiUrl, data) {
  return new Promise((resolve) => {
    const postData = Object.entries(data)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const u = new URL(apiUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

function igApiGet(apiUrl) {
  return new Promise((resolve) => {
    https.get(apiUrl, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a); }));
}

async function uploadToInstagram(videoPath, dayMode, captionData) {
  const credPath = path.join(ROOT, 'instagram-credentials.json');
  if (!fs.existsSync(credPath)) {
    logStep('instagram-credentials.json not found \u2014 skipping upload');
    return;
  }

  const caption = buildCaption(dayMode, captionData);
  logStep('Caption preview:');
  console.log('\x1b[2m' + caption + '\x1b[0m\n');

  const answer = await askQuestion('Upload to Instagram as Reel? (y/n): ');
  if (answer.trim().toLowerCase() !== 'y') {
    logStep('Skipping Instagram upload');
    return;
  }

  logS('UPLOADING TO INSTAGRAM');
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8').replace(/^\uFEFF/, ''));

  // Upload video to temporary public host
  logStep('Uploading video to temp host...');
  let publicUrl = null;
  try {
    const result = execFileSync('curl', [
      '-s', '-F', 'reqtype=fileupload', '-F', 'time=24h',
      '-F', `fileToUpload=@${videoPath}`,
      'https://litterbox.catbox.moe/resources/internals/api.php',
    ], { stdio: 'pipe', timeout: 300000, windowsHide: true }).toString().trim();
    if (result.startsWith('https://')) publicUrl = result;
  } catch { /* fallback below */ }

  if (!publicUrl) {
    logStep('Litterbox failed, trying catbox...');
    try {
      const result = execFileSync('curl', [
        '-s', '-F', 'reqtype=fileupload',
        '-F', `fileToUpload=@${videoPath}`,
        'https://catbox.moe/user/api.php',
      ], { stdio: 'pipe', timeout: 300000, windowsHide: true }).toString().trim();
      if (result.startsWith('https://')) publicUrl = result;
    } catch { /* give up */ }
  }

  if (!publicUrl) {
    logErr('Failed to upload video to public host');
    return;
  }
  logOk(`Public URL: ${publicUrl}`);

  // Create Instagram Reel container
  const apiBase = 'https://graph.instagram.com/v21.0';
  const igId = creds.igBusinessAccountId;
  const token = creds.accessToken;

  logStep('Creating Reel container...');
  const createResult = await igApiPost(`${apiBase}/${igId}/media`, {
    media_type: 'REELS',
    video_url: publicUrl,
    caption,
    thumb_offset: '1500',
    access_token: token,
  });

  if (!createResult || !createResult.id) {
    logErr(`Failed to create Reel container: ${JSON.stringify(createResult)}`);
    return;
  }
  const containerId = createResult.id;
  logStep(`Container ID: ${containerId}`);

  // Wait for media processing
  logStep('Waiting for processing...');
  let ready = false;
  for (let w = 0; w < 60; w++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await igApiGet(`${apiBase}/${containerId}?fields=status_code&access_token=${token}`);
    if (st && st.status_code === 'FINISHED') { logOk('Processing complete'); ready = true; break; }
    if (st && st.status_code === 'ERROR') { logErr('Media processing failed'); return; }
    logStep(`  Processing... (${(w + 1) * 5}s)`);
  }
  if (!ready) { logErr('Processing timed out after 5 minutes'); return; }

  // Publish
  logStep('Publishing Reel...');
  const pubResult = await igApiPost(`${apiBase}/${igId}/media_publish`, {
    creation_id: containerId,
    access_token: token,
  });

  if (pubResult && pubResult.id) {
    logOk(`\u2713 Reel published! Post ID: ${pubResult.id}`);
  } else {
    logErr(`Failed to publish: ${JSON.stringify(pubResult)}`);
  }
}

function buildCaption(dayMode, scenes) {
  // Load templates from instagram-desc.json
  const descPath = path.join(ROOT, 'instagram-desc.json');
  let desc;
  try {
    desc = JSON.parse(fs.readFileSync(descPath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch (e) {
    logErr(`Failed to read instagram-desc.json: ${e.message}`);
    return `toplista.mk #toplista #${dayMode}`;
  }
  const cfg = desc.modes[dayMode];
  if (!cfg) return `toplista.mk #toplista #${dayMode}`;

  const lines = [];
  const tags = [...(desc.globalTags || [])];

  switch (dayMode) {
    case 'mon':
    case 'tue': {
      const chartList = scenes?.find(s => s.type === 'chart-list');
      const clips = scenes?.filter(s => s.type === 'clip') || [];
      lines.push(cfg.title);
      lines.push('');
      const top = (chartList?.entries || []).slice(0, 10);
      if (top.length) {
        top.forEach((e, i) => lines.push((cfg.listTemplate || '{rank}. {artist} – {song}')
          .replace('{rank}', i + 1).replace('{artist}', e.bandName).replace('{song}', e.releaseTitle)));
        lines.push('');
      }
      if (cfg.footer) lines.push(cfg.footer);
      if (cfg.engagement) { lines.push(''); lines.push(cfg.engagement); }
      clips.forEach(c => { if (c.artist) tags.push(`#${c.artist.replace(/\s+/g, '')}`); });
      break;
    }
    case 'wed': {
      const radar = scenes?.find(s => s.type === 'release-radar');
      lines.push(cfg.title);
      lines.push('');
      const rels = radar?.releases || [];
      if (rels.length) {
        rels.forEach(r => lines.push((cfg.listTemplate || '{prefix} {artist} – {song}')
          .replace('{prefix}', cfg.listPrefix || '▶️').replace('{artist}', r.bandName).replace('{song}', r.releaseTitle)));
        lines.push('');
      }
      if (cfg.footer) lines.push(cfg.footer);
      if (cfg.engagement) { lines.push(''); lines.push(cfg.engagement); }
      rels.forEach(r => { if (r.bandName) tags.push(`#${r.bandName.replace(/\s+/g, '')}`); });
      break;
    }
    case 'thu': {
      const tb = scenes?.find(s => s.type === 'throwback');
      lines.push(cfg.title);
      lines.push('');
      if (tb) {
        if (cfg.songTemplate) lines.push(cfg.songTemplate.replace('{artist}', tb.artist || '').replace('{song}', tb.songTitle || ''));
        if (cfg.dateTemplate && tb.releaseDate) lines.push(cfg.dateTemplate.replace('{date}', tb.releaseDate));
        if (cfg.viewsTemplate && tb.views) lines.push(cfg.viewsTemplate.replace('{views}', Number(tb.views).toLocaleString()));
        lines.push('');
        if (cfg.engagement) lines.push(cfg.engagement);
      }
      if (tb?.artist) tags.push(`#${tb.artist.replace(/\s+/g, '')}`);
      break;
    }
    case 'fri': {
      const evScene = scenes?.find(s => s.type === 'events');
      lines.push(cfg.title);
      lines.push('');
      const evts = evScene?.events || [];
      if (evts.length) {
        evts.forEach(e => lines.push((cfg.listTemplate || '{prefix} {event} — {place}')
          .replace('{prefix}', cfg.listPrefix || '📍').replace('{event}', e.title || '').replace('{place}', e.place || '')));
        lines.push('');
      }
      if (cfg.footer) lines.push(cfg.footer);
      if (cfg.engagement) { lines.push(''); lines.push(cfg.engagement); }
      break;
    }
    case 'sat': {
      const spotlight = scenes?.find(s => s.type === 'artist-spotlight');
      const trackScene = scenes?.find(s => s.type === 'artist-tracks');
      const name = spotlight?.artistName || '';
      lines.push((cfg.title || '').replace('{artist}', name));
      lines.push('');
      if (cfg.genreTemplate && spotlight?.genre) lines.push(cfg.genreTemplate.replace('{genre}', spotlight.genre));
      if (cfg.cityTemplate && spotlight?.city) lines.push(cfg.cityTemplate.replace('{city}', spotlight.city));
      const songs = trackScene?.songs || [];
      if (songs.length && cfg.songsHeader) {
        lines.push('');
        lines.push(cfg.songsHeader);
        songs.forEach((s, i) => lines.push((cfg.songListTemplate || '{rank}. {song}')
          .replace('{rank}', i + 1).replace('{song}', s.title)));
      }
      lines.push('');
      if (cfg.footer) lines.push(cfg.footer);
      if (cfg.engagement) { lines.push(''); lines.push(cfg.engagement); }
      if (name) tags.push(`#${name.replace(/\s+/g, '')}`);
      if (spotlight?.genre) {
        spotlight.genre.split(/[,\/]/).forEach(g => {
          const t = g.trim().toLowerCase().replace(/\s+/g, '');
          if (t) tags.push(`#${t}`);
        });
      }
      break;
    }
    case 'sun': {
      const dc = scenes?.find(s => s.type === 'deeper-cut');
      lines.push(cfg.title);
      lines.push('');
      if (dc) {
        if (cfg.songTemplate) lines.push(cfg.songTemplate.replace('{artist}', dc.artist || '').replace('{song}', dc.songTitle || ''));
        if (cfg.dateTemplate && dc.releaseDate) lines.push(cfg.dateTemplate.replace('{date}', dc.releaseDate));
        if (cfg.viewsTemplate && dc.views) lines.push(cfg.viewsTemplate.replace('{views}', Number(dc.views).toLocaleString()));
        lines.push('');
        if (cfg.engagement) lines.push(cfg.engagement);
      }
      if (dc?.artist) tags.push(`#${dc.artist.replace(/\s+/g, '')}`);
      break;
    }
  }

  const allTags = [...new Set([...tags, ...(cfg.tags || [])])];
  lines.push('');
  lines.push(allTags.join(' '));
  return lines.join('\n');
}

if (uploadOnly) {
  // Upload-only mode: find latest video for this mode and upload
  let videoPath = uploadFile;
  if (!videoPath) {
    const candidates = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith(`reel-${mode}-`) && f.endsWith('.mp4'))
      .sort().reverse();
    if (candidates.length > 0) {
      videoPath = path.join(OUTPUT_DIR, candidates[0]);
      logOk(`Found: ${candidates[0]}`);
    }
  } else if (!path.isAbsolute(videoPath)) {
    videoPath = path.join(ROOT, videoPath);
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    logErr(`No video found for mode ${mode}. Provide a path: --upload <file>`);
    process.exit(1);
  }
  uploadToInstagram(videoPath, mode).catch(e => { logErr(e.message); process.exit(1); });
} else {
  main().catch(e => { logErr(e.message); console.error(e); process.exit(1); });
}
