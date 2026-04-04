#!/usr/bin/env node
// scripts/generate-reel-video.js
//
// Generates Instagram Reels for non-chart content types:
//   - release-radar:  Weekly new releases showcase
//   - throwback:      Throwback Thursday (classic song)
//   - events:         Weekend events preview with artist clips
//   - artist:         Artist of the Week spotlight
//   - deeper-cut:     Hidden gem by a popular artist
//
// Usage:
//   node scripts/generate-reel-video.js --mode throwback --video-id "xyz" --artist "Name" --title "Song" --date "2026-04-03"
//   node scripts/generate-reel-video.js --mode release-radar --date "2026-04-01"
//   node scripts/generate-reel-video.js --mode events --date "2026-04-03"
//   node scripts/generate-reel-video.js --mode artist --artist "Name" --date "2026-04-04"
//   node scripts/generate-reel-video.js --mode deeper-cut --video-id "xyz" --artist "Name" --title "Song" --date "2026-04-06"
//
// Requirements: tools/ffmpeg.exe, tools/yt-dlp.exe, tools/fonts/

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const https = require('https');
const http = require('http');

// ============================================================================
//  PATHS & FONTS
// ============================================================================

const ROOT = path.resolve(__dirname, '..');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'tools', 'ffprobe.exe');
const YTDLP = path.join(ROOT, 'tools', 'yt-dlp.exe');
const OUTPUT_DIR = path.join(ROOT, 'chart-videos');
const TEMP_DIR = path.join(ROOT, 'chart-videos', '.temp');
const LOGO_PATH = path.join(ROOT, 'logo.png');

const FONT_DIR = path.join(ROOT, 'tools', 'fonts');
const findFont = (name, fallback) =>
  fs.existsSync(path.join(FONT_DIR, name)) ? path.join(FONT_DIR, name) : fallback;

const FONT_TITLE   = findFont('DelaGothicOne-Regular.ttf', 'C:/Windows/Fonts/segoeuib.ttf');
const FONT_HEADING = findFont('Montserrat-Variable.ttf', 'C:/Windows/Fonts/segoeuib.ttf');
const FONT_BODY    = findFont('Inter-Variable.ttf', 'C:/Windows/Fonts/segoeui.ttf');

function ffp(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:'); }
const FF_TITLE = ffp(FONT_TITLE);
const FF_HEAD  = ffp(FONT_HEADING);
const FF_BODY  = ffp(FONT_BODY);

// ============================================================================
//  CONFIG
// ============================================================================

const W = 1080, H = 1920, FPS = 30;

const MAX_DUR      = 30;  // Instagram Reels hard limit
const INTRO_DUR    = 2.5;
const GLITCH_DUR   = 0.15;
const CLIP_DUR     = 6;
const LIST_DUR     = 5;
const SHOWCASE_DUR = 5;
const OUTRO_DUR    = 2.5;

const T = {
  bg: '0f1117', cardBg: '1a1b2e',
  textPri: 'f0f0f0', textSec: 'b0b8c8', textMuted: '6b7280',
  accent: '2563eb', green: '16a34a', purple: '7c3aed',
  pink: 'ec4899', red: 'ef4444',
  gold: 'FFD700', silver: 'C0C0C0', bronze: 'CD7F32',
  white: 'ffffff', black: '111111',
};

// ============================================================================
//  CLI
// ============================================================================

const argv = process.argv.slice(2);
let mode = '', videoId = '', artistName = '', songTitle = '', dateStr = '';
let releaseDate = '', thumbnailUrl = '';

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--mode' && argv[i+1]) mode = argv[++i];
  if (argv[i] === '--video-id' && argv[i+1]) videoId = argv[++i];
  if (argv[i] === '--artist' && argv[i+1]) artistName = argv[++i];
  if (argv[i] === '--title' && argv[i+1]) songTitle = argv[++i];
  if (argv[i] === '--date' && argv[i+1]) dateStr = argv[++i];
  if (argv[i] === '--release-date' && argv[i+1]) releaseDate = argv[++i];
  if (argv[i] === '--thumbnail' && argv[i+1]) thumbnailUrl = argv[++i];
}

if (!mode) { console.error('Missing --mode'); process.exit(1); }
if (!dateStr) dateStr = new Date().toISOString().slice(0, 10);

// ============================================================================
//  LOGGING
// ============================================================================

const log  = (m, c='\x1b[0m') => console.log(`${c}  > ${m}\x1b[0m`);
const logS = t => console.log(`\n\x1b[36m${'='.repeat(70)}\n  ${t}\n${'='.repeat(70)}\x1b[0m\n`);
const logStep = m => log(m, '\x1b[33m');
const logOk   = m => log(m, '\x1b[32m');
const logErr  = m => log(m, '\x1b[31m');
const logDim  = m => log(m, '\x1b[90m');

// ============================================================================
//  HELPERS
// ============================================================================

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function safeDelete(f) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    const g = url.startsWith('https') ? https : http;
    g.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { f.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(f);
      f.on('finish', () => { f.close(); resolve(); });
    }).on('error', e => { f.close(); reject(e); })
      .setTimeout(30000, function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function ff(a, label='') {
  if (label) logDim(`ffmpeg: ${label}`);
  const r = spawnSync(FFMPEG, a, { stdio:['pipe','pipe','pipe'], timeout:600000, windowsHide:true });
  if (r.status !== 0) {
    const e = r.stderr ? r.stderr.toString().slice(-2000) : '';
    throw new Error(`ffmpeg failed (${label}): ${e}`);
  }
  return r;
}

function probe(a) {
  const r = spawnSync(FFPROBE, a, { stdio:['pipe','pipe','pipe'], timeout:30000, windowsHide:true });
  return r.status === 0 ? r.stdout.toString().trim() : null;
}

function dur(f) {
  const o = probe(['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',f]);
  return o ? parseFloat(o) : 0;
}

function esc(text) {
  return text.replace(/\\/g,'\\\\\\\\').replace(/'/g,'\u2019').replace(/:/g,'\\:')
    .replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/;/g,'\\;').replace(/%/g,'%%');
}

function fmtViews(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function ease(s, d) { return `max(0\\,(1-pow(max(0\\,1-min(1\\,(t-${s})/${d}))\\,2.5)))`; }

function staticBg(inputLabel) {
  // Scale 8% larger, drift-crop with time-varying offset for ambient motion
  const sW = Math.round(W * 1.08), sH = Math.round(H * 1.08);
  const ox = Math.round((sW - W) / 2), oy = Math.round((sH - H) / 2);
  const dx = Math.round((sW - W) / 4), dy = Math.round((sH - H) / 4);
  return `[${inputLabel}]scale=${sW}:${sH}:force_original_aspect_ratio=increase,` +
    `fps=${FPS},crop=${W}:${H}:'${ox}+${dx}*sin(t*0.5)':'${oy}+${dy}*cos(t*0.3)',` +
    `setsar=1,gblur=sigma=22[bg]`;
}

// Aggressive glitch text: RGB-split that converges as text locks in
function gTxt(text, font, size, xExpr, yExpr, startT, animDur, color, bw) {
  if (color === undefined) color = `0x${T.white}`;
  if (bw === undefined) bw = 3;
  const e = ease(startT, animDur);
  const sp = 22;
  const ga = `gte(t\\,${startT})*(1-${e})*0.8`;
  return (
    `drawtext=text='${text}':fontfile='${font}':fontsize=${size}:fontcolor=0xff2020:` +
    `x='(${xExpr})+${sp}*(1-${e})':y='(${yExpr})':alpha='${ga}',` +
    `drawtext=text='${text}':fontfile='${font}':fontsize=${size}:fontcolor=0x20ffff:` +
    `x='(${xExpr})-${sp}*(1-${e})':y='(${yExpr})':alpha='${ga}',` +
    `drawtext=text='${text}':fontfile='${font}':fontsize=${size}:fontcolor=${color}:borderw=${bw}:bordercolor=black:` +
    `x='(${xExpr})':y='(${yExpr})':alpha='${e}'`
  );
}

// Small watermark: logo + toplista.mk — centered, raised for IG safe area
function wmFilter(logoIdx, prevLabel, outLabel) {
  if (!outLabel) outLabel = 'outv';
  const wmSz = 40, wmY = H - wmSz - 280;
  const wmX = `(${W}-${wmSz})/2+60`;
  const txtY = wmY + Math.round((wmSz - 22) / 2);
  return [
    `[${logoIdx}:v]scale=${wmSz}:${wmSz},format=rgba,colorchannelmixer=aa=0.5[wm]`,
    `[${prevLabel}]drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=22:fontcolor=0x${T.white}@0.45:borderw=1:bordercolor=black@0.3:x='(${W}-text_w)/2+24':y=${txtY}[txtdone]`,
    `[txtdone][wm]overlay=x='${wmX}':y=${wmY}:format=auto[wmcomp]`,
    `[wmcomp]${hudFrame()}[${outLabel}]`
  ];
}

// HUD overlay: subtle edge borders (Macedonian flag red/yellow)
function hudFrame() {
  const bw = 3;
  return (
    `drawbox=x=0:y=0:w=${W}:h=${bw}:color=0xCE1126@0.2:t=fill,` +
    `drawbox=x=0:y=${H-bw}:w=${W}:h=${bw}:color=0xFFE600@0.35:t=fill,` +
    `drawbox=x=0:y=0:w=${bw}:h=${H}:color=0xCE1126@0.2:t=fill,` +
    `drawbox=x=${W-bw}:y=0:w=${bw}:h=${H}:color=0xFFE600@0.2:t=fill`
  );
}

function ytDownload(query, out) {
  logStep(`YT: "${query}"`);
  try {
    const r = spawnSync(YTDLP, [
      `ytsearch1:${query}`,
      '--format','bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format','mp4','--no-playlist','--no-warnings',
      '--socket-timeout','30','--retries','3',
      '--output',out,'--ffmpeg-location',path.dirname(FFMPEG),
      '--no-simulate','--print','title','--print','id','--print','duration',
    ], { stdio:['pipe','pipe','pipe'], timeout:180000, windowsHide:true });
    if (r.status!==0) { logErr(`yt-dlp: ${(r.stderr||'').toString().slice(-300)}`); return false; }
    const l = r.stdout.toString().trim().split('\n').filter(x=>x.trim());
    if (l.length>=2) logOk(`Found: ${l[0]} (${l[1]})`);
    return fs.existsSync(out);
  } catch(e) { logErr(`YT err: ${e.message}`); return false; }
}

function ytDownloadById(id, out) {
  logStep(`YT download: ${id}`);
  try {
    const r = spawnSync(YTDLP, [
      `https://www.youtube.com/watch?v=${id}`,
      '--format','bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format','mp4','--no-playlist','--no-warnings',
      '--socket-timeout','30','--retries','3',
      '--output',out,'--ffmpeg-location',path.dirname(FFMPEG),
    ], { stdio:['pipe','pipe','pipe'], timeout:180000, windowsHide:true });
    if (r.status!==0) { logErr(`yt-dlp: ${(r.stderr||'').toString().slice(-300)}`); return false; }
    return fs.existsSync(out);
  } catch(e) { logErr(`YT err: ${e.message}`); return false; }
}

// ============================================================================
//  DATE HELPERS
// ============================================================================

function getDateRange() {
  const n = new Date();
  const d = (n.getDay() + 6) % 7;
  const s = new Date(n); s.setDate(s.getDate() - d);
  const e = new Date(s); e.setDate(e.getDate() + 6);
  const mo = ['Јануари','Февруари','Март','Април','Мај','Јуни','Јули','Август','Септември','Октомври','Ноември','Декември'];
  const f = x => `${String(x.getDate()).padStart(2,'0')} ${mo[x.getMonth()]}`;
  return `${f(s)} - ${f(e)} ${e.getFullYear()}`;
}

function formatDateMK(ds) {
  const d = new Date(ds);
  const mo = ['Јануари','Февруари','Март','Април','Мај','Јуни','Јули','Август','Септември','Октомври','Ноември','Декември'];
  return `${d.getDate()} ${mo[d.getMonth()]} ${d.getFullYear()}`;
}

// ============================================================================
//  COLLAGE
// ============================================================================

async function makeCollage(thumbUrls, outPath) {
  logStep('Creating cover collage...');
  const cols = 5, cell = Math.ceil(W / cols), rows = Math.ceil(H / cell), total = cols * rows;

  const paths = [];
  for (let i = 0; i < Math.min(thumbUrls.length, 20); i++) {
    const p = path.join(TEMP_DIR, `thumb-${i}.jpg`);
    if (thumbUrls[i]) { try { await downloadFile(thumbUrls[i], p); } catch {} }
    paths.push(fs.existsSync(p) ? p : null);
  }
  const valid = paths.filter(Boolean);
  if (!valid.length) {
    ff(['-f','lavfi','-i',`color=c=0x${T.bg}:s=${W}x${H}:d=1:r=1`,'-frames:v','1','-update','1','-y',outPath], 'collage fallback');
    return;
  }

  const inp = ['-f','lavfi','-i',`color=c=0x${T.bg}:s=${W}x${H}:d=1:r=1`];
  const flt = [];
  for (let i = 0; i < valid.length; i++) {
    inp.push('-i', valid[i]);
    flt.push(`[${i+1}:v]scale=${cell}:${cell}:force_original_aspect_ratio=increase,crop=${cell}:${cell},setsar=1[t${i}]`);
  }
  let prev = '0:v';
  for (let ci = 0; ci < total; ci++) {
    const ti = ci % valid.length;
    const x = (ci % cols) * cell, y = Math.floor(ci / cols) * cell;
    const out = ci === total - 1 ? 'grid' : `g${ci}`;
    flt.push(`[${prev}][t${ti}]overlay=${x}:${y}[${out}]`);
    prev = out;
  }
  flt.push('[grid]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.35:t=fill[final]');
  ff([...inp, '-filter_complex', flt.join(';'), '-map','[final]','-frames:v','1','-update','1','-y',outPath], 'collage');
  logOk(`Collage: ${valid.length} covers`);
}

// ============================================================================
//  SEGMENTS
// ============================================================================

function makeIntro(collagePath, outputPath, audioSrcPath, title, subtitle, dateLabel) {
  logStep('Generating intro...');
  const d = INTRO_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);
  const inp = ['-loop','1','-i',collagePath];
  const flt = [];
  let nextIdx = 1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx = 2; }

  flt.push(staticBg('0:v'));

  // Split title + subtitle into separate lines
  const allWords = [title, subtitle].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
  const lineH = 100;
  const totalH = allWords.length * lineH;
  const startY = Math.round((H * 0.25) - totalH / 2 + lineH / 2);
  const dateY = startY + allWords.length * lineH + 20;

  // Large logo centered in lower area
  if (hasLogo) {
    const sz = 400, lx = (W-sz)/2, ly = Math.round(H * 0.55);
    flt.push(`[1:v]scale=${sz}:${sz},format=rgba[logo]`);
    flt.push(`[bg][logo]overlay=x=${lx}:y='${ly}+60*(1-${ease(0.35,0.35)})':format=auto[base]`);
  } else {
    flt.push('[bg]copy[base]');
  }

  let drawCmd =
    `[base]` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t\\,0.04)',` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=fill:enable='between(t\\,0.04\\,0.08)',` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t\\,0.08\\,0.11)',` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.7:t=fill:enable='between(t\\,0.11\\,0.14)'`;

  // Each word on its own line at same size with staggered glitch text
  allWords.forEach((word, i) => {
    const y = startY + i * lineH;
    const st = 0.12 + i * 0.10;
    drawCmd += ',' + gTxt(esc(word), FF_TITLE, 100, '(w-text_w)/2', `${y}+60*(1-${ease(st, 0.18)})`, st, 0.18, `0x${T.white}`, 5);
  });

  // Date
  if (dateLabel) {
    const dateSt = 0.15 + allWords.length * 0.10;
    drawCmd += `,drawtext=text='${esc(dateLabel)}':fontfile='${FF_BODY}':fontsize=40:fontcolor=0xbbbbbb:borderw=2:bordercolor=black:` +
      `x=(w-text_w)/2:y='${dateY}+40*(1-${ease(dateSt, 0.25)})':alpha='${ease(dateSt, 0.25)}'`;
  }

  drawCmd += `,${hudFrame()}[outv]`;
  flt.push(drawCmd);

  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    const srcDur = dur(audioSrcPath);
    const ss = Math.max(0, Math.floor(srcDur * 0.3));
    inp.push('-ss', String(ss), '-i', audioSrcPath);
    flt.push(`[${nextIdx}:a]lowpass=f=500,volume=0.7,afade=t=in:st=0:d=1.5,aresample=44100[outa]`);
  } else {
    inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');
    flt.push(`[${nextIdx}:a]aresample=44100[outa]`);
  }

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], 'intro');
  logOk('Intro done');
}

function makeGlitch(prevYtPath, nextYtPath, outputPath) {
  logStep('Generating glitch...');
  const d = GLITCH_DUR;
  const hasPrev = prevYtPath && fs.existsSync(prevYtPath);
  const hasNext = nextYtPath && fs.existsSync(nextYtPath);

  if (hasPrev && hasNext) {
    const prevDur = dur(prevYtPath), nextDur = dur(nextYtPath);
    const prevSS = Math.max(0, Math.floor(prevDur * 0.35));
    const nextSS = Math.max(0, Math.floor(nextDur * 0.3));
    ff([
      '-ss',String(prevSS),'-i',prevYtPath,'-t',String(d),
      '-ss',String(nextSS),'-i',nextYtPath,'-t',String(d),
      '-f','lavfi','-i',`anoisesrc=d=${d}:c=pink:r=44100:a=0.08`,
      '-filter_complex', [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[a]`,
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[b]`,
        `[a][b]blend=all_mode=softlight,` +
        `gblur=sigma=8,` +
        `rgbashift=rh=-8:rv=5:gh=4:gv=-3:bh=-2:bv=6:edge=wrap,` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.3:t=fill:enable='lt(t\\,0.04)',` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.5:t=fill:enable='gt(t\\,${d-0.05})',` +
        `fade=t=in:st=0:d=0.06,fade=t=out:st=${d-0.06}:d=0.06[outv]`,
        `[2:a]afade=t=in:st=0:d=0.03,afade=t=out:st=${d-0.05}:d=0.05,volume=0.35,aresample=44100[outa]`,
      ].join(';\n'),
      '-map','[outv]','-map','[outa]',
      '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
      '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
    ], 'glitch');
  } else {
    ff([
      '-f','lavfi','-i',`color=c=0x${T.bg}:s=${W}x${H}:d=${d}:r=${FPS}`,
      '-f','lavfi','-i',`anoisesrc=d=${d}:c=pink:r=44100:a=0.06`,
      '-filter_complex', [
        `[0:v]gblur=sigma=6,` +
        `rgbashift=rh=-6:rv=3:gh=3:gv=-2:bh=-1:bv=4:edge=wrap,` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.3:t=fill:enable='lt(t\\,0.04)',` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.6:t=fill:enable='gt(t\\,${d-0.05})',` +
        `fade=t=in:st=0:d=0.06,fade=t=out:st=${d-0.06}:d=0.06[outv]`,
        `[1:a]afade=t=in:st=0:d=0.03,afade=t=out:st=${d-0.05}:d=0.05,volume=0.3,aresample=44100[outa]`,
      ].join(';\n'),
      '-map','[outv]','-map','[outa]',
      '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
      '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
    ], 'glitch (fallback)');
  }
  logOk('Glitch done');
}

function makeClip(collagePath, ytPath, rank, title, artist, outputPath) {
  logStep(`Clip: ${artist} - ${title}...`);
  const duration = dur(ytPath);
  if (duration <= 0) { logErr('Cannot read duration'); return 0; }

  const ss = Math.max(0, Math.floor(duration * 0.3));
  const d = Math.min(CLIP_DUR, duration - ss);
  const songT = title.length > 26 ? title.slice(0,23)+'...' : title;
  const artistT = artist.length > 30 ? artist.slice(0,27)+'...' : artist;
  const hasLogo = fs.existsSync(LOGO_PATH);

  const vidW = Math.round(W * 0.88), vidH = Math.round(H * 0.55);
  const vidX = Math.round((W - vidW) / 2);
  const vidY = Math.round((H - vidH) / 2);
  const bp = 3;
  const textY = vidY + vidH + 30;
  const rankBoxW = 100, rankBoxH = 90;
  const rankBoxX = Math.round((W - (rankBoxW + 16 + W * 0.60)) / 2);
  const rankBoxY = textY;
  const titleX = rankBoxX + rankBoxW + 16;

  const rankColor = typeof rank === 'number' && rank <= 3
    ? (rank === 1 ? T.gold : rank === 2 ? T.silver : T.bronze) : T.accent;
  const rankLabel = typeof rank === 'number' ? String(rank) : rank;

  const inp = ['-ss',String(ss),'-i',ytPath, '-loop','1','-i',collagePath];
  let logoIdx = -1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); logoIdx = 2; }
  inp.push('-t',String(d));

  const flt = [
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,gblur=sigma=22,fps=${FPS}[bg]`,
    `[0:v]scale=${vidW-bp*2}:${vidH-bp*2}:force_original_aspect_ratio=increase,` +
    `crop=${vidW-bp*2}:${vidH-bp*2},` +
    `pad=${vidW}:${vidH}:${bp}:${bp}:color=0x${T.white}30,setsar=1[vid]`,
    `[bg][vid]overlay=x=${vidX}:y=${vidY}:format=auto[comp]`,
  ];

  flt.push(
    `[comp]` +
    `drawbox=x=${rankBoxX}:y=${rankBoxY}:w=${rankBoxW}:h=${rankBoxH}:color=0x${rankColor}:t=fill:enable='gte(t\\,0.08)',` +
    gTxt(esc(rankLabel), FF_HEAD, 64, `${rankBoxX}+(${rankBoxW}-text_w)/2`, `${rankBoxY}+(${rankBoxH}-text_h)/2`, 0.08, 0.3, `0x${T.black}`, 0) + ',' +
    `drawbox=x='${titleX}+(${W - titleX - 50})*(1-${ease(0.12,0.4)})':y=${rankBoxY}:w=${W - titleX - 50}:h=${rankBoxH}:color=black@0.80:t=fill,` +
    gTxt(esc(songT), FF_HEAD, 58, `${titleX+16}`, `${rankBoxY+6}`, 0.15, 0.35, `0x${T.white}`, 2) + ',' +
    gTxt(esc(artistT), FF_BODY, 42, `${titleX+16}`, `${rankBoxY+52}`, 0.22, 0.35, `0x${T.textSec}`, 2) +
    (hasLogo ? `[clipdraw]` : `,${hudFrame()}[outv]`)
  );

  if (hasLogo) {
    flt.push(...wmFilter(logoIdx, 'clipdraw', 'outv'));
  }

  flt.push(`[0:a]volume=0.85,aresample=44100[outa]`);

  ff([...inp,'-filter_complex',flt.join(';\n'),
    '-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
  ], `clip`);
  logOk(`Clip: ${d}s from ${ss}s`);
  return d;
}

function makeShowcase(collagePath, artPath, title, artist, badge, badgeColor, extraLines, outputPath, audioSrcPath) {
  logStep(`Showcase: ${artist} - ${title}...`);
  const d = SHOWCASE_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);
  const hasArt = artPath && fs.existsSync(artPath);

  const inp = ['-loop','1','-i',collagePath];
  let ni = 1;
  if (hasArt) { inp.push('-loop','1','-i',artPath); ni = 2; }
  let logoInputIdx = -1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); logoInputIdx = ni; ni++; }

  const flt = [];
  flt.push(staticBg('0:v'));

  let base = 'bg';
  if (hasArt) {
    flt.push(`[1:v]scale=500:500,pad=516:516:8:8:color=0x${T.white}30,format=rgba,setsar=1[art]`);
    flt.push(`[bg][art]overlay=x=${(W-516)/2}:y='${Math.round(H*0.20)}+30*(1-${ease(0.25,0.35)})':format=auto[artbg]`);
    base = 'artbg';
  }

  const songT = title.length > 28 ? title.slice(0,25)+'...' : title;
  const artistT = artist.length > 32 ? artist.slice(0,29)+'...' : artist;
  const textY = hasArt ? Math.round(H * 0.54) : Math.round(H * 0.30);

  let drawCmds =
    `[${base}]` +
    `drawbox=x=${(W-400)/2}:y=${textY - 60}:w=400:h=50:color=0x${badgeColor}:t=fill:enable='gte(t\\,0.15)',` +
    gTxt(esc(badge), FF_HEAD, 32, '(w-text_w)/2', `${textY - 55}+25*(1-${ease(0.15,0.25)})`, 0.15, 0.25, `0x${T.white}`, 1) + ',' +
    gTxt(esc(songT), FF_TITLE, 64, '(w-text_w)/2', `${textY + 10}+35*(1-${ease(0.35,0.25)})`, 0.35, 0.25, `0x${T.white}`, 4) + ',' +
    gTxt(esc(artistT), FF_HEAD, 46, '(w-text_w)/2', `${textY + 80}+25*(1-${ease(0.50,0.25)})`, 0.50, 0.25, `0x${T.textSec}`, 2);

  (extraLines || []).forEach((line, i) => {
    drawCmds += `,drawtext=text='${esc(line)}':fontfile='${FF_BODY}':fontsize=30:fontcolor=0x${T.textMuted}:borderw=1:bordercolor=black:` +
      `x=(w-text_w)/2:y='${textY + 130 + i * 40}+20*(1-${ease(0.60 + i*0.08,0.25)})':alpha='${ease(0.60 + i*0.08,0.25)}'`;
  });

  if (hasLogo) {
    drawCmds += `[sctxt]`;
    flt.push(drawCmds);
    flt.push(...wmFilter(logoInputIdx, 'sctxt', 'outv'));
  } else {
    drawCmds += `,${hudFrame()}[outv]`;
    flt.push(drawCmds);
  }

  // Audio
  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    const srcDur = dur(audioSrcPath);
    const ss = Math.max(0, Math.floor(srcDur * 0.3));
    inp.push('-ss', String(ss), '-i', audioSrcPath);
    flt.push(`[${ni}:a]lowpass=f=500,volume=0.6,afade=t=in:st=0:d=1,aresample=44100[outa]`);
  } else {
    inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');
    flt.push(`[${ni}:a]aresample=44100[outa]`);
  }

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], 'showcase');
  logOk('Showcase done');
}

function makeListOverlay(collagePath, entries, headerText, outputPath, audioSrcPath) {
  logStep(`List: ${headerText}...`);
  const d = LIST_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  let audioIdx;
  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    const srcDur = dur(audioSrcPath);
    const ss = Math.max(0, Math.floor(srcDur * 0.3));
    inp.push('-ss', String(ss), '-i', audioSrcPath);
    audioIdx = 1;
  } else {
    inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');
    audioIdx = 1;
  }

  let nextIdx = 2;
  let logoIdx = -1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); logoIdx = nextIdx++; }

  const flt = [];
  flt.push(staticBg('0:v'));

  const hdrY = 45, startY = 140, rowH = 148, stag = 0.15;
  const rowMargin = 40, rowW = W - rowMargin * 2;
  const accentW = 5;
  const rankBoxSz = 46;
  const rankX = rowMargin + accentW + 14;
  const textX = rankX + rankBoxSz + 16;
  const maxEntries = Math.min(entries.length, 10);

  let txt =
    `[bg]` +
    gTxt(esc(headerText), FF_HEAD, 66, '(w-text_w)/2', `${hdrY}+15*(1-${ease(0.08,0.3)})`, 0.08, 0.3, `0x${T.white}`, 3) + ',' +
    `drawbox=x=${(W-300)/2}:y=${hdrY + 72}:w=300:h=4:color=0x${T.accent}:t=fill:enable='gte(t\\,0.15)'`;

  for (let i = 0; i < maxEntries; i++) {
    const entry = entries[i];
    const y = startY + i * rowH;
    const dl = 0.25 + i * stag;
    const e = ease(dl, 0.3);
    const line1 = (entry.line1 || '').length > 28 ? (entry.line1 || '').slice(0,25) + '...' : (entry.line1 || '');
    const line2 = (entry.line2 || '').length > 40 ? (entry.line2 || '').slice(0,37) + '...' : (entry.line2 || '');
    const rc = i < 3 ? (i === 0 ? T.gold : i === 1 ? T.silver : T.bronze) : T.accent;
    const rbY = y + Math.round((rowH - 8 - rankBoxSz) / 2);

    txt += `,drawbox=x=${rowMargin}:y='${y}':w=${rowW}:h=${rowH-8}:color=black@0.80:t=fill:enable='gte(t\\,${dl})'`;
    txt += `,drawbox=x=${rowMargin}:y='${y}':w=${accentW}:h=${rowH-8}:color=0x${rc}:t=fill:enable='gte(t\\,${dl})'`;
    txt += `,drawbox=x=${rankX}:y='${rbY}':w=${rankBoxSz}:h=${rankBoxSz}:color=0x${rc}:t=fill:enable='gte(t\\,${dl})'`;
    txt += `,drawtext=text='${esc(String(i+1))}':fontfile='${FF_HEAD}':fontsize=30:fontcolor=0x${T.black}:x=${rankX}+(${rankBoxSz}-text_w)/2:y='${rbY}+(${rankBoxSz}-text_h)/2':alpha='${e}'`;
    txt += `,drawtext=text='${esc(line1)}':fontfile='${FF_HEAD}':fontsize=48:fontcolor=0x${T.white}:borderw=2:bordercolor=black:x='${textX}':y='${y+28}':alpha='${e}'`;
    txt += `,drawtext=text='${esc(line2)}':fontfile='${FF_BODY}':fontsize=36:fontcolor=0x${T.textSec}:x='${textX}':y='${y+78}':alpha='${e}'`;
  }

  if (hasLogo) {
    txt += `[listtxt]`;
    flt.push(txt);
    flt.push(...wmFilter(logoIdx, 'listtxt', 'outv'));
  } else {
    txt += `,${hudFrame()}[outv]`;
    flt.push(txt);
  }

  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    flt.push(`[${audioIdx}:a]lowpass=f=500,volume=0.7,aresample=44100[outa]`);
  } else {
    flt.push(`[${audioIdx}:a]aresample=44100[outa]`);
  }

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], 'list');
  logOk('List done');
}

function makeOutro(collagePath, outputPath, audioSrcPath) {
  logStep('Generating outro...');
  const d = OUTRO_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  let nextIdx = 1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx = 2; }

  const flt = [];
  flt.push(staticBg('0:v'));

  const logoCenter = Math.round(H * 0.55);
  if (hasLogo) {
    const sz = 600, lx = (W-sz)/2, ly = logoCenter - Math.round(sz/2);
    flt.push(`[1:v]scale=${sz}:${sz},format=rgba[logo]`);
    flt.push(`[bg][logo]overlay=x=${lx}:y='${ly}+40*(1-${ease(0.25,0.3)})':format=auto[base]`);
  } else {
    flt.push('[bg]copy[base]');
  }

  const tagY1 = Math.round(H * 0.15);
  flt.push(
    `[base]` +
    `fade=t=in:st=0:d=0.10:color=white,` +
    gTxt(esc('\u0421\u041B\u0423\u0428\u0410\u0408'), FF_TITLE, 40, '(w-text_w)/2', `${tagY1}+50*(1-${ease(0.08,0.25)})`, 0.08, 0.25, `0x${T.gold}`, 3) + ',\n' +
    gTxt(esc('\u041C\u0410\u041A\u0415\u0414\u041E\u041D\u0421\u041A\u0410'), FF_TITLE, 40, '(w-text_w)/2', `${tagY1+80}+50*(1-${ease(0.25,0.25)})`, 0.25, 0.25, `0x${T.gold}`, 3) + ',\n' +
    gTxt(esc('\u041C\u0423\u0417\u0418\u041A\u0410!'), FF_TITLE, 40, '(w-text_w)/2', `${tagY1+160}+50*(1-${ease(0.42,0.25)})`, 0.42, 0.25, `0x${T.gold}`, 3) + `,${hudFrame()}[outv]`
  );

  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    const srcDur = dur(audioSrcPath);
    const ss = Math.max(0, Math.floor(srcDur * 0.3));
    inp.push('-ss', String(ss), '-i', audioSrcPath);
    flt.push(`[${nextIdx}:a]lowpass=f=500,volume=0.7,afade=t=out:st=${d-1.5}:d=1.5,aresample=44100[outa]`);
  } else {
    inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');
    flt.push(`[${nextIdx}:a]aresample=44100[outa]`);
  }

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], 'outro');
  logOk('Outro done');
}

// ============================================================================
//  NORMALIZE + CONCAT
// ============================================================================

function norm(inp, out) {
  ff(['-i',inp,
    '-c:v','libx264','-preset','fast','-crf','23',
    '-vf',`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x${T.bg},setsar=1,fps=${FPS}`,
    '-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-pix_fmt','yuv420p','-y',out], 'norm');
}

function concatSegments(paths, out) {
  logStep(`Concat ${paths.length} segments...`);
  const list = path.join(TEMP_DIR, 'concat.txt');
  fs.writeFileSync(list, paths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  ff(['-f','concat','-safe','0','-i',list,
    '-c:v','libx264','-preset','medium','-crf','22',
    '-c:a','aac','-b:a','192k','-ar','44100',
    '-pix_fmt','yuv420p','-movflags','+faststart','-y',out], 'concat');
  safeDelete(list);
}

// ============================================================================
//  MODE: THROWBACK / DEEPER-CUT
// ============================================================================

async function modeThrowbackOrDeeperCut() {
  const isDeeper = mode === 'deeper-cut';
  const label = isDeeper ? 'СКРИЕНИ БОГАТСТВА' : 'TBT: ЧЕТВРТОК ВО МИНАТОТО';
  const badge = isDeeper ? 'СКРИЕНИ БОГАТСТВА' : 'TBT: ЧЕТВРТОК ВО МИНАТОТО';
  const badgeColor = isDeeper ? T.pink : T.purple;

  logS(label);

  // Download thumbnail
  const artPath = path.join(TEMP_DIR, 'art.jpg');
  if (thumbnailUrl) { try { await downloadFile(thumbnailUrl, artPath); } catch {} }

  // Build collage from general releases
  const releases = readJSON(path.join(ROOT, 'releases.json'));
  const thumbs = releases.releases.slice(0, 30).map(r => r.thumbnail).filter(Boolean);
  const collagePath = path.join(TEMP_DIR, 'collage.png');
  await makeCollage(thumbs, collagePath);

  // Download video
  const ytPath = path.join(TEMP_DIR, 'main.mp4');
  let hasVideo = false;
  if (videoId) {
    hasVideo = ytDownloadById(videoId, ytPath);
  }
  if (!hasVideo) {
    hasVideo = ytDownload(`${artistName} ${songTitle} official`, ytPath);
  }

  const segments = [];

  // Intro
  const introP = path.join(TEMP_DIR, 'seg-intro.mp4');
  const introTitle = isDeeper ? 'Deeper Cut' : 'Throwback';
  const introSub = isDeeper ? 'Скриено Богатство' : 'Thursday';
  makeIntro(collagePath, introP, hasVideo ? ytPath : null, introTitle, introSub, releaseDate ? formatDateMK(releaseDate) : '');
  segments.push(introP);

  // Always show showcase card with date + views first
  const g1 = path.join(TEMP_DIR, 'seg-g1.mp4');
  makeGlitch(null, hasVideo ? ytPath : null, g1);
  segments.push(g1);

  const scP = path.join(TEMP_DIR, 'seg-showcase.mp4');
  const extraLines = [];
  if (releaseDate) extraLines.push(formatDateMK(releaseDate));
  // Load releases to get view data
  const relData = readJSON(path.join(ROOT, 'releases.json'));
  const matchedRel = relData.releases.find(r =>
    (r.bandName === artistName || r.bandName.includes(artistName)) &&
    (r.releaseTitle === songTitle || r.releaseTitle.includes(songTitle))
  );
  const songViews = matchedRel ? (matchedRel.youtubeViews || 0) : 0;
  if (songViews > 0) extraLines.push(`${fmtViews(songViews)} \u043F\u0440\u0435\u0433\u043B\u0435\u0434\u0438`);
  if (isDeeper) {
    const artistRels = relData.releases.filter(r => r.bandName === artistName);
    const totalViews = artistRels.reduce((s, r) => s + (r.youtubeViews || 0), 0);
    if (totalViews > 0) extraLines.push(`\u0412\u043A\u0443\u043F\u043D\u043E \u043F\u0440\u0435\u0433\u043B\u0435\u0434\u0438 \u043D\u0430 ${artistName}: ${fmtViews(totalViews)}`);
  }
  makeShowcase(collagePath, fs.existsSync(artPath) ? artPath : null, songTitle, artistName, badge, badgeColor, extraLines, scP, hasVideo ? ytPath : null);
  segments.push(scP);

  // Also show video clip if available
  if (hasVideo) {
    const g2 = path.join(TEMP_DIR, 'seg-g2.mp4');
    makeGlitch(null, ytPath, g2);
    segments.push(g2);

    const clipP = path.join(TEMP_DIR, 'seg-clip.mp4');
    makeClip(collagePath, ytPath, isDeeper ? 'DC' : 'TBT', songTitle, artistName, clipP);
    segments.push(clipP);
  }

  // Glitch + Outro
  const g3 = path.join(TEMP_DIR, 'seg-g3.mp4');
  makeGlitch(hasVideo ? ytPath : null, null, g3);
  segments.push(g3);

  const outroP = path.join(TEMP_DIR, 'seg-outro.mp4');
  makeOutro(collagePath, outroP, hasVideo ? ytPath : null);
  segments.push(outroP);

  return segments;
}

// ============================================================================
//  MODE: RELEASE RADAR
// ============================================================================

async function modeReleaseRadar() {
  logS('RELEASE RADAR');

  const releases = readJSON(path.join(ROOT, 'releases.json'));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutStr = cutoff.toISOString().slice(0, 10);

  // Merge collabs
  const relMap = new Map();
  for (const r of releases.releases) {
    const k = r.releaseId;
    if (relMap.has(k)) {
      const e = relMap.get(k);
      if (!e.bandName.includes(r.bandName)) e.bandName += `, ${r.bandName}`;
    } else relMap.set(k, {...r});
  }

  const recent = [...relMap.values()]
    .filter(r => r.releaseDate >= cutStr)
    .sort((a, b) => (b.youtubeViews || 0) - (a.youtubeViews || 0))
    .slice(0, 10);

  logOk(`Found ${recent.length} releases from past week (top 10)`);

  const thumbs = recent.map(r => r.thumbnail).filter(Boolean);
  const collagePath = path.join(TEMP_DIR, 'collage.png');
  await makeCollage(thumbs.length >= 5 ? thumbs : releases.releases.slice(0,30).map(r=>r.thumbnail).filter(Boolean), collagePath);

  // Download top 3 videos
  const clips = [];
  for (let i = 0; i < Math.min(3, recent.length); i++) {
    const r = recent[i];
    const vid = r.youtubeTracks?.[0]?.videoId || '';
    const ytP = path.join(TEMP_DIR, `release-${i}.mp4`);
    let ok = false;
    if (vid) ok = ytDownloadById(vid, ytP);
    if (!ok) ok = ytDownload(`${r.bandName} ${r.releaseTitle} official`, ytP);
    clips.push(ok ? ytP : null);
  }

  const segments = [];

  // Intro
  const introP = path.join(TEMP_DIR, 'seg-intro.mp4');
  makeIntro(collagePath, introP, clips[0], '\u041D\u043E\u0432\u0438', '\u0418\u0437\u0434\u0430\u043D\u0438\u0458\u0430', getDateRange());
  segments.push(introP);

  // Top 3 clips
  for (let i = 0; i < clips.length; i++) {
    if (clips[i]) {
      const g = path.join(TEMP_DIR, `seg-g-${i}.mp4`);
      makeGlitch(i > 0 ? clips[i-1] : null, clips[i], g);
      segments.push(g);

      const cp = path.join(TEMP_DIR, `seg-clip-${i}.mp4`);
      makeClip(collagePath, clips[i], i+1, recent[i].releaseTitle, recent[i].bandName, cp);
      segments.push(cp);
    }
  }

  // List overlay
  const gList = path.join(TEMP_DIR, 'seg-g-list.mp4');
  makeGlitch(clips[clips.length-1], null, gList);
  segments.push(gList);

  const listP = path.join(TEMP_DIR, 'seg-list.mp4');
  const dayNamesMK = ['\u041D\u0435\u0434\u0435\u043B\u0430','\u041F\u043E\u043D\u0435\u0434\u0435\u043B\u043D\u0438\u043A','\u0412\u0442\u043E\u0440\u043D\u0438\u043A','\u0421\u0440\u0435\u0434\u0430','\u0427\u0435\u0442\u0432\u0440\u0442\u043E\u043A','\u041F\u0435\u0442\u043E\u043A','\u0421\u0430\u0431\u043E\u0442\u0430'];
  const listEntries = recent.slice(0, 10).map(r => {
    const rd = r.releaseDate ? new Date(r.releaseDate) : null;
    const dayName = rd ? dayNamesMK[rd.getDay()] : '';
    const dateStr = rd ? `${rd.getDate()}.${rd.getMonth()+1}` : '';
    const typeLabel = (r.releaseType || 'single') === 'album' ? '\u0410\u043B\u0431\u0443\u043C' : '\u0421\u0438\u043D\u0433\u043B';
    return {
      line1: r.releaseTitle,
      line2: `${r.bandName} \u00B7 ${typeLabel} \u00B7 ${dayName} ${dateStr}`,
    };
  });
  makeListOverlay(collagePath, listEntries, '\u041D\u043E\u0432\u0438 \u0418\u0437\u0434\u0430\u043D\u0438\u0458\u0430', listP, clips[0]);
  segments.push(listP);

  // Outro
  const gOut = path.join(TEMP_DIR, 'seg-g-out.mp4');
  makeGlitch(null, null, gOut);
  segments.push(gOut);

  const outroP = path.join(TEMP_DIR, 'seg-outro.mp4');
  makeOutro(collagePath, outroP, clips[0]);
  segments.push(outroP);

  return segments;
}

// ============================================================================
//  MODE: EVENTS
// ============================================================================

async function modeEvents() {
  logS('WEEKEND EVENTS');

  const eventsData = readJSON(path.join(ROOT, 'events.json'));
  const releases = readJSON(path.join(ROOT, 'releases.json'));
  const events = eventsData.events || eventsData;

  // Find this weekend events
  const now = new Date();
  const dow = now.getDay();
  const fri = new Date(now);
  fri.setDate(now.getDate() + ((5 - dow + 7) % 7));
  const sun = new Date(fri);
  sun.setDate(fri.getDate() + 2);
  const friStr = fri.toISOString().slice(0, 10);
  const sunStr = sun.toISOString().slice(0, 10);

  const weekendEvents = events.filter(e => e.date >= friStr && e.date <= sunStr);
  logOk(`Found ${weekendEvents.length} weekend events`);

  // Collage
  const thumbs = releases.releases.slice(0, 30).map(r => r.thumbnail).filter(Boolean);
  const collagePath = path.join(TEMP_DIR, 'collage.png');
  await makeCollage(thumbs, collagePath);

  // Find clips for performing artists
  const artistClips = [];
  for (const ev of weekendEvents) {
    for (const name of (ev.artists || [])) {
      if (artistClips.length >= 3) break;
      const rel = releases.releases.find(r =>
        r.bandName === name && r.youtubeTracks && r.youtubeTracks.length > 0
      );
      if (rel) {
        const vid = rel.youtubeTracks[0].videoId;
        const ytP = path.join(TEMP_DIR, `event-clip-${artistClips.length}.mp4`);
        let ok = ytDownloadById(vid, ytP);
        if (!ok) ok = ytDownload(`${name} ${rel.releaseTitle}`, ytP);
        if (ok) artistClips.push({ path: ytP, release: rel, event: ev });
      }
    }
  }

  const segments = [];

  // Intro
  const introP = path.join(TEMP_DIR, 'seg-intro.mp4');
  makeIntro(collagePath, introP, artistClips[0]?.path || null, '\u041D\u0430\u0441\u0442\u0430\u043D\u0438', '\u0412\u0438\u043A\u0435\u043D\u0434\u043E\u0432', getDateRange());
  segments.push(introP);

  // Events list
  const gE = path.join(TEMP_DIR, 'seg-g-events.mp4');
  makeGlitch(null, artistClips[0]?.path || null, gE);
  segments.push(gE);

  const evListP = path.join(TEMP_DIR, 'seg-events.mp4');
  const evEntries = weekendEvents.map(e => ({
    line1: e.title,
    line2: `${e.place} \u00B7 ${e.date} ${e.time || ''}`,
  }));
  makeListOverlay(collagePath, evEntries, '\u041D\u0430\u0441\u0442\u0430\u043D\u0438 \u0412\u0438\u043A\u0435\u043D\u0434\u043E\u0432', evListP, artistClips[0]?.path || null);
  segments.push(evListP);

  // Artist clips
  for (let i = 0; i < artistClips.length; i++) {
    const ac = artistClips[i];
    const g = path.join(TEMP_DIR, `seg-g-ac${i}.mp4`);
    makeGlitch(i > 0 ? artistClips[i-1].path : null, ac.path, g);
    segments.push(g);

    const cp = path.join(TEMP_DIR, `seg-ac-${i}.mp4`);
    makeClip(collagePath, ac.path, i+1, ac.release.releaseTitle, `${ac.release.bandName} \u00B7 ${ac.event.title}`, cp);
    segments.push(cp);
  }

  // Outro
  const gOut = path.join(TEMP_DIR, 'seg-g-out.mp4');
  makeGlitch(artistClips.length ? artistClips[artistClips.length-1].path : null, null, gOut);
  segments.push(gOut);

  const outroP = path.join(TEMP_DIR, 'seg-outro.mp4');
  makeOutro(collagePath, outroP, artistClips[0]?.path || null);
  segments.push(outroP);

  return segments;
}

// ============================================================================
//  MODE: ARTIST OF THE WEEK
// ============================================================================

async function modeArtist() {
  logS('ARTIST OF THE WEEK');

  const releases = readJSON(path.join(ROOT, 'releases.json'));
  const bandsData = readJSON(path.join(ROOT, 'bands.json'));
  const bands = bandsData.muzickaMasterLista || [];

  const band = bands.find(b => b.name === artistName || b.spotifyName === artistName);
  if (!band) { logErr(`Artist not found: ${artistName}`); process.exit(1); }

  const artistReleases = releases.releases
    .filter(r => r.bandName === artistName)
    .sort((a, b) => (b.youtubeViews || 0) - (a.youtubeViews || 0));

  logOk(`${artistName}: ${artistReleases.length} releases`);

  // Download artist image
  const artPath = path.join(TEMP_DIR, 'artist.jpg');
  if (band.image) { try { await downloadFile(band.image, artPath); } catch {} }

  // Collage
  const thumbs = artistReleases.map(r => r.thumbnail).filter(Boolean);
  const allThumbs = thumbs.length >= 5 ? thumbs : releases.releases.slice(0, 30).map(r => r.thumbnail).filter(Boolean);
  const collagePath = path.join(TEMP_DIR, 'collage.png');
  await makeCollage(allThumbs, collagePath);

  // Download top track video
  const topTrack = artistReleases.find(r => r.youtubeTracks && r.youtubeTracks.length > 0);
  const ytPath = path.join(TEMP_DIR, 'artist-clip.mp4');
  let hasVideo = false;
  if (videoId) {
    hasVideo = ytDownloadById(videoId, ytPath);
  } else if (topTrack) {
    hasVideo = ytDownloadById(topTrack.youtubeTracks[0].videoId, ytPath);
  }
  if (!hasVideo && topTrack) {
    hasVideo = ytDownload(`${artistName} ${topTrack.releaseTitle} official`, ytPath);
  }

  const segments = [];

  // Intro
  const introP = path.join(TEMP_DIR, 'seg-intro.mp4');
  makeIntro(collagePath, introP, hasVideo ? ytPath : null, '\u0410\u0440\u0442\u0438\u0441\u0442', '\u043D\u0430 \u041D\u0435\u0434\u0435\u043B\u0430\u0442\u0430', getDateRange());
  segments.push(introP);

  // Glitch
  const g1 = path.join(TEMP_DIR, 'seg-g1.mp4');
  makeGlitch(null, hasVideo ? ytPath : null, g1);
  segments.push(g1);

  // Artist showcase
  const scP = path.join(TEMP_DIR, 'seg-showcase.mp4');
  const genre = band.genre && band.genre !== '\u043D\u0435\u0434\u043E\u0441\u0442\u0438\u0433\u0430\u0430\u0442 \u043F\u043E\u0434\u0430\u0442\u043E\u0446\u0438' ? band.genre : '';
  const city = band.city && band.city !== '\u043D\u0435\u0434\u043E\u0441\u0442\u0438\u0433\u0430\u0430\u0442 \u043F\u043E\u0434\u0430\u0442\u043E\u0446\u0438' ? band.city : '';
  const extraLines = [];
  if (genre) extraLines.push(genre);
  if (city) extraLines.push(city);
  extraLines.push(`${artistReleases.length} \u0438\u0437\u0434\u0430\u043D\u0438\u0458\u0430`);
  makeShowcase(collagePath, fs.existsSync(artPath) ? artPath : null, artistName, '', '\u0410\u0420\u0422\u0418\u0421\u0422 \u041D\u0410 \u041D\u0415\u0414\u0415\u041B\u0410\u0422\u0410', T.accent, extraLines, scP, hasVideo ? ytPath : null);
  segments.push(scP);

  // Video clip
  if (hasVideo) {
    const g2 = path.join(TEMP_DIR, 'seg-g2.mp4');
    makeGlitch(null, ytPath, g2);
    segments.push(g2);

    const clipP = path.join(TEMP_DIR, 'seg-clip.mp4');
    const trackTitle = topTrack ? topTrack.releaseTitle : songTitle || artistName;
    makeClip(collagePath, ytPath, 1, trackTitle, artistName, clipP);
    segments.push(clipP);
  }

  // Discography list
  const gList = path.join(TEMP_DIR, 'seg-g-list.mp4');
  makeGlitch(hasVideo ? ytPath : null, null, gList);
  segments.push(gList);

  const listP = path.join(TEMP_DIR, 'seg-list.mp4');
  const listEntries = artistReleases.slice(0, 5).map(r => ({
    line1: r.releaseTitle,
    line2: `${r.releaseType || 'single'} \u00B7 ${fmtViews(r.youtubeViews || 0)} \u043F\u0440\u0435\u0433\u043B\u0435\u0434\u0438`,
  }));
  makeListOverlay(collagePath, listEntries, artistName, listP, hasVideo ? ytPath : null);
  segments.push(listP);

  // Outro
  const gOut = path.join(TEMP_DIR, 'seg-g-out.mp4');
  makeGlitch(null, null, gOut);
  segments.push(gOut);

  const outroP = path.join(TEMP_DIR, 'seg-outro.mp4');
  makeOutro(collagePath, outroP, hasVideo ? ytPath : null);
  segments.push(outroP);

  return segments;
}

// ============================================================================
//  MAIN
// ============================================================================

async function main() {
  console.log(`\n\x1b[35m${'='.repeat(70)}\n  REEL GENERATOR | Mode: ${mode.toUpperCase()} | ${dateStr}\n${'='.repeat(70)}\x1b[0m`);

  for (const [n, p] of [['ffmpeg', FFMPEG], ['yt-dlp', YTDLP]]) {
    if (!fs.existsSync(p)) { logErr(`${n} not found: ${p}`); process.exit(1); }
  }
  logOk(`Fonts: title=${path.basename(FONT_TITLE)}, heading=${path.basename(FONT_HEADING)}, body=${path.basename(FONT_BODY)}`);

  ensureDir(OUTPUT_DIR);
  ensureDir(TEMP_DIR);

  let segments;

  switch (mode) {
    case 'throwback':
    case 'deeper-cut':
      segments = await modeThrowbackOrDeeperCut();
      break;
    case 'release-radar':
      segments = await modeReleaseRadar();
      break;
    case 'events':
      segments = await modeEvents();
      break;
    case 'artist':
      segments = await modeArtist();
      break;
    default:
      logErr(`Unknown mode: ${mode}. Use: throwback, deeper-cut, release-radar, events, artist`);
      process.exit(1);
  }

  if (!segments || !segments.length) {
    logErr('No segments generated');
    process.exit(1);
  }

  // Normalize all segments
  logS('NORMALIZING');
  const normPaths = [];
  for (let i = 0; i < segments.length; i++) {
    const np = path.join(TEMP_DIR, `norm-${String(i).padStart(2, '0')}.mp4`);
    logDim(`${i + 1}/${segments.length}...`);
    norm(segments[i], np);
    normPaths.push(np);
  }

  // Concat
  logS('CONCAT');
  const rawPath = path.join(TEMP_DIR, 'concat-raw.mp4');
  const finalPath = path.join(OUTPUT_DIR, `${mode}-${dateStr}.mp4`);
  concatSegments(normPaths, rawPath);

  // Enforce 30s cap
  const rawDur = dur(rawPath);
  if (rawDur > MAX_DUR) {
    logStep(`Trimming ${rawDur.toFixed(1)}s → ${MAX_DUR}s`);
    ff(['-i', rawPath, '-t', String(MAX_DUR), '-c', 'copy', '-y', finalPath], 'trim 30s');
  } else {
    fs.renameSync(rawPath, finalPath);
  }

  // Cleanup
  logStep('Cleaning...');
  try {
    for (const f of fs.readdirSync(TEMP_DIR)) safeDelete(path.join(TEMP_DIR, f));
    fs.rmdirSync(TEMP_DIR);
  } catch {}

  // Summary
  const sz = fs.existsSync(finalPath) ? (fs.statSync(finalPath).size / (1024 * 1024)).toFixed(1) : '?';
  const d = dur(finalPath);
  logS('DONE');
  logOk(`Video: ${finalPath}`);
  logOk(`Size: ${sz} MB | Duration: ${d.toFixed(1)}s | ${W}x${H} @${FPS}fps`);

  try { execSync(`start "" "${OUTPUT_DIR}"`, { windowsHide: true, shell: true }); } catch {}
}

main().catch(err => { console.error('\x1b[31mFatal:\x1b[0m', err.message); process.exit(1); });
