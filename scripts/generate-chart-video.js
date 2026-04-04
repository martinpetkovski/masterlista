#!/usr/bin/env node
// scripts/generate-chart-video.js  (V3)
//
// Generates an Instagram Reel for the weekly chart with per-segment audio.
//
// Structure:
//   Intro → Glitch → Clip #3 → Glitch → Clip #2 → Glitch → Clip #1
//   → Glitch → Chart list → Glitch → Outro
//   Each segment carries its own audio (LPF for intro/chart/outro, full for clips).
//   Glitch VFX/SFX transitions between every segment.
//
// Usage:
//   node scripts/generate-chart-video.js
//   node scripts/generate-chart-video.js --chart-mode alt
//   node scripts/generate-chart-video.js --clip-duration 12//
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

const MAX_DUR        = 30;  // Instagram Reels hard limit
const INTRO_DUR      = 2.5;
const GLITCH_DUR     = 0.15;
const CLIP_DUR_DEF   = 6;
const CHART_LIST_DUR = 5;
const OUTRO_DUR      = 2.5;

const T = {
  bg: '0f1117', cardBg: '1a1b2e',
  textPri: 'f0f0f0', textSec: 'b0b8c8', textMuted: '6b7280',
  accent: '2563eb', green: '16a34a', purple: '7c3aed',
  gold: 'FFD700', silver: 'C0C0C0', bronze: 'CD7F32',
  white: 'ffffff', black: '111111',
};

const CYR_TOP     = '\u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430';
const CYR_ALT     = '\u0410\u043B\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u043D\u0430';
const CYR_TAGLINE = '\u0421\u041B\u0423\u0428\u0410\u0408 \u041C\u0410\u041A\u0415\u0414\u041E\u041D\u0421\u041A\u0410 \u041C\u0423\u0417\u0418\u041A\u0410!';
// "Топ Листа" — matching the website title
const CYR_TOPLISTA = '\u0422\u043E\u043F \u041B\u0438\u0441\u0442\u0430';

// ============================================================================
//  CLI
// ============================================================================

const argv = process.argv.slice(2);
let chartMode = 'standard', clipDuration = CLIP_DUR_DEF, specificWeek = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--chart-mode' && argv[i+1]) chartMode = argv[++i];
  if (argv[i] === '--clip-duration' && argv[i+1]) clipDuration = parseInt(argv[++i], 10);
  if (argv[i] === '--week' && argv[i+1]) specificWeek = argv[++i];
}
const isAlt = chartMode === 'alt';

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

function readJSON(p) { return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')); }

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

function rc(r) {
  if (r===1) return T.gold; if (r===2) return T.silver; if (r===3) return T.bronze;
  return T.textMuted;
}

// Ease-out: 0→1 starting at time s over d seconds
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

// ============================================================================
//  CHART DATA
// ============================================================================

const chartGenresData = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'chart-genres.json'), 'utf8'));
const rapGenres = chartGenresData.rap;
const electronicGenres = chartGenresData.electronic;
const popGenres = chartGenresData.pop;
const nonAlt = [...rapGenres,...electronicGenres,...popGenres].map(g=>g.toLowerCase());

function isArtistAlt(name, bands) {
  const b = bands.find(x=>x.name===name);
  if (!b||!b.genre||b.genre==='недостигаат податоци') return false;
  return !b.genre.split(',').map(g=>g.trim().toLowerCase()).some(g=>nonAlt.includes(g));
}

function mergeCollabs(rels) {
  const m = new Map();
  for (const r of rels) {
    const k = r.releaseId||r.topTrackId||`${r.releaseTitle}|${r.bandName}|${r.releaseDate}`;
    if (!k) continue;
    if (m.has(k)) {
      const e = m.get(k);
      if (!e.bandName.split(', ').includes(r.bandName)) e.bandName += `, ${r.bandName}`;
      if ((r.popularity||0)>(e.popularity||0)) e.popularity = r.popularity;
    } else m.set(k, {...r});
  }
  return [...m.values()];
}

function getSinglesChart(all, count, filter, bands) {
  let s = mergeCollabs(all).filter(r=>r.releaseType==='single');
  if (filter==='alt'&&bands) s = s.filter(r=>r.bandName.split(', ').some(a=>isArtistAlt(a,bands)));
  s.sort((a,b)=>(b.releaseDate||'').localeCompare(a.releaseDate||''));
  const cut = new Date(); cut.setDate(cut.getDate()-28);
  const cs = cut.toISOString().slice(0,10);
  const rec = s.filter(r=>r.releaseDate>=cs);
  const pool = [...rec];
  if (pool.length<count) pool.push(...s.filter(r=>r.releaseDate<cs).slice(0,count-pool.length));
  pool.sort((a,b)=>(b.popularity||0)-(a.popularity||0));
  return pool.slice(0,count);
}

function getWeekLabel() {
  const n=new Date(), j4=new Date(n.getFullYear(),0,4);
  const doy=Math.ceil((n-new Date(n.getFullYear(),0,1))/86400000);
  return `W${String(Math.ceil((doy+j4.getDay())/7)).padStart(2,'0')} ${n.getFullYear()}`;
}

function getDateRangeLabel() {
  const n=new Date(), d=(n.getDay()+6)%7;
  const s=new Date(n); s.setDate(s.getDate()-d);
  const e=new Date(s); e.setDate(e.getDate()+6);
  const mo=['Јануари','Февруари','Март','Април','Мај','Јуни','Јули','Август','Септември','Октомври','Ноември','Декември'];
  const f=x=>`${String(x.getDate()).padStart(2,'0')} ${mo[x.getMonth()]}`;
  return `${f(s)} - ${f(e)} ${e.getFullYear()}`;
}

// ============================================================================
//  YOUTUBE
// ============================================================================

function ytDownload(artist, title, out) {
  const q = `${artist} ${title} official`;
  logStep(`YT: "${q}"`);
  try {
    const r = spawnSync(YTDLP, [
      `ytsearch1:${q}`,
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

// ============================================================================
//  COLLAGE: blurred, darkened, fading to black downward
// ============================================================================

async function makeCollage(releases, outPath) {
  logStep('Creating cover collage...');
  const cols = 5, cell = Math.ceil(W/cols), rows = Math.ceil(H/cell), total = cols*rows;

  const thumbs = [];
  for (let i = 0; i < Math.min(releases.length, 20); i++) {
    const p = path.join(TEMP_DIR, `thumb-${i}.jpg`);
    if (releases[i].thumbnail) { try { await downloadFile(releases[i].thumbnail, p); } catch {} }
    thumbs.push(fs.existsSync(p) ? p : null);
  }
  const valid = thumbs.filter(Boolean);
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
    const x = (ci%cols)*cell, y = Math.floor(ci/cols)*cell;
    const out = ci===total-1 ? 'grid' : `g${ci}`;
    flt.push(`[${prev}][t${ti}]overlay=${x}:${y}[${out}]`);
    prev = out;
  }

  // Darken (full color, no blur, no gradient)
  flt.push('[grid]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.35:t=fill[final]');

  ff([...inp, '-filter_complex', flt.join(';'), '-map','[final]','-frames:v','1','-update','1','-y',outPath], 'collage');
  logOk(`Collage: ${valid.length} covers, ${cols}x${rows} grid, darkened`);
}

// ============================================================================
//  SEGMENT: INTRO  (collage bg, logo + title in the lower dark portion)
// ============================================================================

function makeIntro(collagePath, outputPath, audioSrcPath) {
  logStep('Generating intro...');
  const d = INTRO_DUR;
  const chartTitle = isAlt ? `${CYR_ALT} ${CYR_TOP}` : CYR_TOPLISTA;
  const subtitle = isAlt ? '' : CYR_TOP;
  const dateLabel = getDateRangeLabel();
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  const flt = [];
  let nextIdx = 1;

  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx = 2; }

  flt.push(staticBg('0:v'));

  // Split title into separate word lines
  const allWords = [chartTitle, subtitle].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
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

  const titleWordCount = chartTitle.split(/\\s+/).length;
  allWords.forEach((word, i) => {
    const y = startY + i * lineH;
    const st = 0.12 + i * 0.10;
    drawCmd += ',' + gTxt(esc(word), FF_TITLE, 100, '(w-text_w)/2', `${y}+60*(1-${ease(st, 0.18)})`, st, 0.18, `0x${T.white}`, 5);
  });

  if (dateLabel) {
    const dateSt = 0.15 + allWords.length * 0.10;
    drawCmd += `,drawtext=text='${esc(dateLabel)}':fontfile='${FF_BODY}':fontsize=40:fontcolor=0xbbbbbb:borderw=2:bordercolor=black:` +
      `x=(w-text_w)/2:y='${dateY}+40*(1-${ease(dateSt, 0.25)})':alpha='${ease(dateSt, 0.25)}'`;
  }

  drawCmd += `,${hudFrame()}[outv]`;
  flt.push(drawCmd);

  // Audio: LPF from song source, or silence
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

// ============================================================================
//  SEGMENT: GLITCH TRANSITION
//  Uses actual video frames from current + next clip, shuffled/shifted pixels
//  Audio: distorted glitch burst
// ============================================================================

function makeGlitch(prevYtPath, nextYtPath, rank, outputPath) {
  logStep(`Generating glitch #${rank}...`);
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
    ], `glitch #${rank}`);
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
    ], `glitch #${rank} (fallback)`);
  }
  logOk(`Glitch #${rank} done`);
}

// ============================================================================
//  SEGMENT: VIDEO CLIP (90%W x 60%H, FILL mode, collage bg, large text)
// ============================================================================

function makeClip(release, rank, ytPath, collagePath, outputPath) {
  logStep(`Clip #${rank}...`);
  const duration = dur(ytPath);
  if (duration <= 0) { logErr('Cannot read duration'); return false; }

  const ss = Math.max(0, Math.floor(duration * 0.3));
  const d = Math.min(clipDuration, duration - ss);
  const title = release.releaseTitle.length > 26 ? release.releaseTitle.slice(0,23)+'...' : release.releaseTitle;
  const artist = release.bandName.length > 30 ? release.bandName.slice(0,27)+'...' : release.bandName;
  const col = rc(rank);
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
    `drawbox=x=${rankBoxX}:y=${rankBoxY}:w=${rankBoxW}:h=${rankBoxH}:color=0x${col}:t=fill:enable='gte(t\\,0.08)',` +
    gTxt(esc(String(rank)), FF_HEAD, 72, `${rankBoxX}+(${rankBoxW}-text_w)/2`, `${rankBoxY}+(${rankBoxH}-text_h)/2`, 0.08, 0.3, `0x${T.black}`, 0) + ',' +
    `drawbox=x='${titleX}+(${W - titleX - 50})*(1-${ease(0.12,0.4)})':y=${rankBoxY}:w=${W - titleX - 50}:h=${rankBoxH}:color=black@0.80:t=fill,` +
    gTxt(esc(title), FF_HEAD, 58, `${titleX+16}`, `${rankBoxY+6}`, 0.15, 0.35, `0x${T.white}`, 2) + ',' +
    gTxt(esc(artist), FF_BODY, 42, `${titleX+16}`, `${rankBoxY+52}`, 0.22, 0.35, `0x${T.textSec}`, 2) +
    (hasLogo ? `[clipdraw]` : `,${hudFrame()}[outv]`)
  );

  if (hasLogo) {
    flt.push(...wmFilter(logoIdx, 'clipdraw', 'outv'));
  }

  // Real audio from the clip
  flt.push(`[0:a]volume=0.85,aresample=44100[outa]`);

  ff([...inp,'-filter_complex',flt.join(';\n'),
    '-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
  ], `clip #${rank}`);
  logOk(`Clip #${rank}: ${d}s from ${ss}s`);
  return d;
}

// ============================================================================
//  SEGMENT: CHART LIST (top 10, rank box + art + text, lighter overlay)
// ============================================================================

function makeChartList(chart10, collagePath, artThumbs, outputPath, audioSrcPath, posChanges) {
  logStep('Generating chart list...');
  const d = CHART_LIST_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  // Audio input: real song (LPF) or silence
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
  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx++; }
  const logoIdx = hasLogo ? 2 : -1;

  const artIdxMap = {};
  for (let i = 0; i < Math.min(chart10.length, 10); i++) {
    if (artThumbs[i] && fs.existsSync(artThumbs[i])) {
      inp.push('-i', artThumbs[i]);
      artIdxMap[i] = nextIdx++;
    }
  }

  const flt = [];

  flt.push(staticBg('0:v'));

  const artSize = 90, rankBoxS = 56;
  for (const [ci, fi] of Object.entries(artIdxMap)) {
    flt.push(`[${fi}:v]scale=${artSize}:${artSize}:force_original_aspect_ratio=increase,crop=${artSize}:${artSize},setsar=1[art${ci}]`);
  }

  const hdrY = 40, startY = 130, rowH = 148, stag = 0.18;
  const rowMargin = 40, rowW = W - rowMargin*2;
  const rankX = rowMargin + 14;
  const artX = rankX + rankBoxS + 12;
  const textX = artX + artSize + 14;
  const textAreaW = rowMargin + rowW - textX - 70;
  const hasArts = Object.keys(artIdxMap).length > 0;
  const preWm = hasLogo ? 'preWm' : 'preHud';
  const txtOutput = hasArts ? 'txout' : preWm;

  // Header with gTxt + accent underline bar
  const hdrText = isAlt ? CYR_ALT+' '+CYR_TOP : CYR_TOP;
  const hdrBarW = 300, hdrBarH = 4, hdrBarX = Math.round((W - hdrBarW) / 2);
  const hdrBarY = hdrY + 70;

  let txt =
    `[bg]` +
    gTxt(esc(hdrText), FF_HEAD, 66, `(w-text_w)/2`, `${hdrY}`, 0.1, 0.4, `0x${T.white}`, 3) + ',' +
    `drawbox=x=${hdrBarX}:y=${hdrBarY}:w=${hdrBarW}:h=${hdrBarH}:color=0x${T.accent}:t=fill:enable='gte(t\\,0.15)'`;

  for (let i = 0; i < Math.min(chart10.length, 10); i++) {
    const r = chart10[i], rk = i+1, col = rc(rk);
    const y = startY + i * rowH;
    const dl = 0.3 + i * stag;
    const e = ease(dl, 0.35);
    const song = r.releaseTitle.length>22 ? r.releaseTitle.slice(0,19)+'...' : r.releaseTitle;
    const art = r.bandName.length>26 ? r.bandName.slice(0,23)+'...' : r.bandName;

    // Row background
    txt += `,drawbox=x=${rowMargin}:y='${y}':w=${rowW}:h=${rowH-8}:color=black@0.80:t=fill:enable='gte(t\\,${dl})'`;
    // 5px accent stripe on left
    txt += `,drawbox=x=${rowMargin}:y='${y}':w=5:h=${rowH-8}:color=0x${col}:t=fill:enable='gte(t\\,${dl})'`;
    // Rank box
    const rbY = y + Math.round((rowH - 8 - rankBoxS) / 2);
    txt += `,drawbox=x=${rankX}:y='${rbY}':w=${rankBoxS}:h=${rankBoxS}:color=0x${col}:t=fill:enable='gte(t\\,${dl})'`;
    txt += `,drawtext=text='${esc(String(rk))}':fontfile='${FF_HEAD}':fontsize=46:fontcolor=0x${T.black}:x=${rankX}+(${rankBoxS}-text_w)/2:y='${rbY}+(${rankBoxS}-text_h)/2':alpha='${e}'`;
    // Song title (centered in text area, bigger)
    txt += `,drawtext=text='${esc(song)}':fontfile='${FF_HEAD}':fontsize=54:fontcolor=0x${T.white}:borderw=2:bordercolor=black:x='${textX}+(${textAreaW}-text_w)/2':y='${y+26}':alpha='${e}'`;
    // Artist (centered in text area, bigger)
    txt += `,drawtext=text='${esc(art)}':fontfile='${FF_BODY}':fontsize=42:fontcolor=0x${T.textSec}:x='${textX}+(${textAreaW}-text_w)/2':y='${y+78}':alpha='${e}'`;
    // Chevron indicator (right side of row)
    if (posChanges && posChanges[i]) {
      const pc = posChanges[i];
      const chX = rowMargin + rowW - 60;
      const chY = y + Math.round((rowH - 8) / 2) - 14;
      if (pc.type === 'up') {
        // Up triangle (drawbox stacked)
        txt += `,drawbox=x=${chX+8}:y=${chY}:w=8:h=7:color=0x16c953:t=fill:enable='gte(t\\,${dl})'`;
        txt += `,drawbox=x=${chX+4}:y=${chY+7}:w=16:h=7:color=0x16c953:t=fill:enable='gte(t\\,${dl})'`;
        txt += `,drawbox=x=${chX}:y=${chY+14}:w=24:h=7:color=0x16c953:t=fill:enable='gte(t\\,${dl})'`;
      } else if (pc.type === 'down') {
        // Down triangle (drawbox stacked)
        txt += `,drawbox=x=${chX}:y=${chY}:w=24:h=7:color=0xf03e3e:t=fill:enable='gte(t\\,${dl})'`;
        txt += `,drawbox=x=${chX+4}:y=${chY+7}:w=16:h=7:color=0xf03e3e:t=fill:enable='gte(t\\,${dl})'`;
        txt += `,drawbox=x=${chX+8}:y=${chY+14}:w=8:h=7:color=0xf03e3e:t=fill:enable='gte(t\\,${dl})'`;
      } else if (pc.type === 'new') {
        txt += `,drawtext=text='${esc('НОВО')}':fontfile='${FF_HEAD}':fontsize=20:fontcolor=0x${T.gold}:x=${chX - 10}:y='${chY + 4}':alpha='${e}'`;
      }
    }
  }

  txt += `[${txtOutput}]`;
  flt.push(txt);

  // Overlay art thumbnails
  if (hasArts) {
    let artBase = 'txout';
    const artEntries = Object.entries(artIdxMap);
    for (let ai = 0; ai < artEntries.length; ai++) {
      const [ci] = artEntries[ai];
      const idx = parseInt(ci);
      const y = startY + idx * rowH + Math.round((rowH - 8 - artSize) / 2);
      const dl = (0.3 + idx * stag).toFixed(2);
      const isLast = ai === artEntries.length - 1;
      const outLabel = isLast ? preWm : `ov${idx}`;
      flt.push(`[${artBase}][art${ci}]overlay=x=${artX}:y=${y}:enable='gte(t\\,${dl})':format=auto[${outLabel}]`);
      artBase = outLabel;
    }
  }

  // Watermark
  if (hasLogo) {
    flt.push(...wmFilter(logoIdx, preWm, 'outv'));
  } else {
    flt.push(`[preHud]${hudFrame()}[outv]`);
  }

  // Audio
  if (audioSrcPath && fs.existsSync(audioSrcPath)) {
    flt.push(`[${audioIdx}:a]lowpass=f=500,volume=0.7,aresample=44100[outa]`);
  } else {
    flt.push(`[${audioIdx}:a]aresample=44100[outa]`);
  }

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], 'chart list');
  logOk('Chart list done');
}

// ============================================================================
//  SEGMENT: OUTRO (logo + multi-line tagline + site)
// ============================================================================

function makeOutro(collagePath, outputPath, audioSrcPath) {
  logStep('Generating outro...');
  const d = OUTRO_DUR;
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  let nextIdx = 1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx = 2; }

  const flt = [];
  // Static collage + abstract bottom art
  flt.push(staticBg('0:v'));

  // Logo: large, centered
  const logoCenter = Math.round(H * 0.55);
  if (hasLogo) {
    const sz = 600, lx = (W-sz)/2, ly = logoCenter - Math.round(sz/2);
    flt.push(`[1:v]scale=${sz}:${sz},format=rgba[logo]`);
    flt.push(`[bg][logo]overlay=x=${lx}:y='${ly}+50*(1-${ease(0.3,0.35)})':format=auto[base]`);
  } else {
    flt.push('[bg]copy[base]');
  }

  // Tagline: each word on its own line (top area)
  const word1 = '\u0421\u041B\u0423\u0428\u0410\u0408';      // СЛУШАЈ
  const word2 = '\u041C\u0410\u041A\u0415\u0414\u041E\u041D\u0421\u041A\u0410'; // МАКЕДОНСКА
  const word3 = '\u041C\u0423\u0417\u0418\u041A\u0410!';      // МУЗИКА!

  const tagY1 = Math.round(H * 0.15);
  const tagY2 = tagY1 + 80;
  const tagY3 = tagY2 + 80;

  flt.push(
    `[base]` +
    // Softer white flash
    `fade=t=in:st=0:d=0.08:color=white@0.3,` +
    // Word 1: СЛУШАЈ (smaller tagline)
    gTxt(esc(word1), FF_TITLE, 40, `(w-text_w)/2`, `${tagY1}`, 0.1, 0.3, `0x${T.gold}`, 3) + ',' +
    // Word 2: МАКЕДОНСКА
    gTxt(esc(word2), FF_TITLE, 40, `(w-text_w)/2`, `${tagY2}`, 0.3, 0.3, `0x${T.gold}`, 3) + ',' +
    // Word 3: МУЗИКА!
    gTxt(esc(word3), FF_TITLE, 40, `(w-text_w)/2`, `${tagY3}`, 0.5, 0.3, `0x${T.gold}`, 3) + `,${hudFrame()}[outv]`
  );

  // Audio: LPF from song source with fadeout, or silence
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
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
  ], 'outro');
  logOk('Outro done');
}

// ============================================================================
//  NORMALIZE + CONCAT (video + audio)
// ============================================================================

function norm(inp, out) {
  ff(['-i',inp,
    '-c:v','libx264','-preset','fast','-crf','23',
    '-vf',`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x${T.bg},setsar=1,fps=${FPS}`,
    '-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-pix_fmt','yuv420p','-y',out], 'norm');
}

function concatSegments(paths, out) {
  logStep(`Concat ${paths.length} segments (video + audio)...`);
  const list = path.join(TEMP_DIR, 'concat.txt');
  fs.writeFileSync(list, paths.map(p=>`file '${p.replace(/\\/g,'/')}'`).join('\n'), 'utf8');
  ff(['-f','concat','-safe','0','-i',list,
    '-c:v','libx264','-preset','medium','-crf','22',
    '-c:a','aac','-b:a','192k','-ar','44100',
    '-pix_fmt','yuv420p','-movflags','+faststart','-y',out], 'concat');
  safeDelete(list);
}

// ============================================================================
//  FALLBACK: extended art (when no YT video)
// ============================================================================

function makeExtendedArt(release, rank, artPath, collagePath, outputPath) {
  const d = clipDuration;
  const col = rc(rank);
  const title = release.releaseTitle.length>30 ? release.releaseTitle.slice(0,27)+'...' : release.releaseTitle;
  const artist = release.bandName.length>34 ? release.bandName.slice(0,31)+'...' : release.bandName;
  const hasArt = artPath && fs.existsSync(artPath);
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  let ni = 1;
  if (hasArt) { inp.push('-loop','1','-i',artPath); ni=2; }
  let logoInputIdx = -1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); logoInputIdx = ni; ni++; }
  inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');

  const flt = [];
  flt.push(staticBg('0:v'));

  let base = 'bg';
  if (hasArt) {
    flt.push(`[1:v]scale=500:500,pad=512:512:6:6:color=0x${T.textMuted}40,format=rgba,setsar=1[art]`);
    flt.push(`[bg][art]overlay=x=${(W-512)/2}:y=${Math.round(H*0.22)}:format=auto[artbg]`);
    base = 'artbg';
  }

  const ry = hasArt ? Math.round(H*0.54) : Math.round(H*0.3);
  flt.push(
    `[${base}]` +
    gTxt(esc('#'+rank), FF_HEAD, 80, '(w-text_w)/2', `${ry}`, 0.08, 0.3, `0x${col}`, 3) + ',' +
    gTxt(esc(title), FF_HEAD, 48, '(w-text_w)/2', `${ry+100}`, 0.15, 0.35, `0x${T.white}`, 2) + ',' +
    gTxt(esc(artist), FF_BODY, 36, '(w-text_w)/2', `${ry+160}`, 0.22, 0.35, `0x${T.textSec}`, 2) +
    (hasLogo ? `[extdraw]` : `[outv]`)
  );
  if (hasLogo) {
    flt.push(...wmFilter(logoInputIdx, 'extdraw', 'outv'));
  }
  flt.push(`[${ni}:a]aresample=44100[outa]`);

  ff([...inp,'-filter_complex',flt.join(';\n'),'-map','[outv]','-map','[outa]',
    '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
    '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath], `ext art #${rank}`);
  return d;
}

// ============================================================================
//  MAIN
// ============================================================================

async function main() {
  console.log(`\n\x1b[35m${'='.repeat(70)}\n  CHART VIDEO GENERATOR V3\n  ${new Date().toISOString().slice(0,19)} | Mode: ${chartMode.toUpperCase()}\n${'='.repeat(70)}\x1b[0m`);

  for (const [n,p] of [['ffmpeg',FFMPEG],['yt-dlp',YTDLP]]) {
    if (!fs.existsSync(p)) { logErr(`${n} not found: ${p}`); process.exit(1); }
  }
  logOk(`Fonts: title=${path.basename(FONT_TITLE)}, heading=${path.basename(FONT_HEADING)}, body=${path.basename(FONT_BODY)}`);

  ensureDir(OUTPUT_DIR); ensureDir(TEMP_DIR);

  // --- Load data ---
  logS('LOADING DATA');
  const chartData = readJSON(path.join(ROOT,'chart-data.json'));
  const releasesData = readJSON(path.join(ROOT,'releases.json'));
  // Merge popularity from chart-data into releases catalog
  const popMap = new Map();
  for (const c of chartData.releases) popMap.set(c.releaseId, c);
  const releases = releasesData.releases.map(r => {
    const c = popMap.get(r.releaseId);
    return c ? { ...r, popularity: c.popularity||0, followers: c.followers||0 } : r;
  });
  let bandsData = [];
  const spMap = new Map();
  const bp = path.join(ROOT,'bands.json');
  if (fs.existsSync(bp)) {
    const bj = readJSON(bp);
    bandsData = bj.muzickaMasterLista || [];
    for (const b of bandsData) { if (b.spotifyName) spMap.set(b.name, b.spotifyName); }
    logOk(`${bandsData.length} bands`);
  }

  const top20 = getSinglesChart(releases, 20, isAlt?'alt':'all', bandsData);
  const top3 = top20.slice(0,3);
  if (top3.length<3) { logErr(`Need 3 singles, got ${top3.length}`); process.exit(1); }

  const weekLabel = specificWeek ? `${specificWeek} ${new Date().getFullYear()}` : getWeekLabel();
  logStep(`Chart: ${chartMode.toUpperCase()} | ${weekLabel}`);
  for (let i=0;i<top3.length;i++) {
    console.log(`  \x1b[33m#${i+1}\x1b[0m ${top3[i].bandName} \u2014 ${top3[i].releaseTitle}  \x1b[90m(pop:${top3[i].popularity})\x1b[0m`);
  }

  // --- Collage ---
  logS('COVER COLLAGE');
  const collagePath = path.join(TEMP_DIR, 'collage.png');
  await makeCollage(top20, collagePath);

  // --- Album art ---
  logS('ALBUM ART');
  const artPaths = [];
  for (let i=0;i<3;i++) {
    const p = path.join(TEMP_DIR, `art-${i+1}.jpg`);
    if (top3[i].thumbnail) { try { await downloadFile(top3[i].thumbnail, p); logOk(`art-${i+1}.jpg`); } catch(e) { logErr(e.message); } }
    artPaths.push(fs.existsSync(p)?p:null);
  }

  // --- YouTube (use spotifyName when available) ---
  logS('YOUTUBE VIDEOS');
  const ytPaths = [];
  for (let i=0;i<3;i++) {
    const r=top3[i];
    // Try each artist in the collab to find a spotifyName
    const artists = r.bandName.split(', ');
    let sn = r.bandName;
    for (const a of artists) {
      if (spMap.has(a)) { sn = artists.map(x => spMap.get(x) || x).join(', '); break; }
    }
    logDim(`Spotify name: ${sn}`);
    const p = path.join(TEMP_DIR, `yt-${i+1}.mp4`);
    if (ytDownload(sn, r.releaseTitle, p)) { ytPaths.push(p); }
    else { logStep(`Retry: ${r.bandName}`); ytPaths.push(ytDownload(r.bandName,r.releaseTitle,p)?p:null); }
  }

  // --- Generate video segments (with per-segment audio) ---
  logS('VIDEO SEGMENTS');
  const segments = [];

  // Audio sources by order: song A = ytPaths[2] (#3), B = ytPaths[1] (#2), C = ytPaths[0] (#1)

  // 1. Intro (audio: song #3 LPF)
  const introPath = path.join(TEMP_DIR, 'seg-intro.mp4');
  makeIntro(collagePath, introPath, ytPaths[2]);
  segments.push(introPath);

  // 2. Glitch → Clip for each song (ORDER: 3rd → 2nd → 1st place)
  const clipDurs = [];
  const order = [2, 1, 0]; // indices: #3, #2, #1
  for (let oi = 0; oi < 3; oi++) {
    const idx = order[oi];
    const rank = 3 - oi; // 3, 2, 1

    // Glitch transition (uses previous + current YT video frames)
    const glitchPath = path.join(TEMP_DIR, `seg-glitch-${rank}.mp4`);
    const prevIdx = oi > 0 ? order[oi-1] : -1;
    const prevYt = prevIdx >= 0 ? ytPaths[prevIdx] : null;
    makeGlitch(prevYt, ytPaths[idx], rank, glitchPath);
    segments.push(glitchPath);

    // Video clip (or fallback extended art)
    const clipPath = path.join(TEMP_DIR, `seg-clip-${rank}.mp4`);
    let cd;
    if (ytPaths[idx]) {
      cd = makeClip(top3[idx], rank, ytPaths[idx], collagePath, clipPath);
    } else {
      cd = makeExtendedArt(top3[idx], rank, artPaths[idx], collagePath, clipPath);
    }
    segments.push(clipPath);
    clipDurs.push(cd);
  }

  // Download art thumbnails for chart list (top 10)
  logS('CHART ART');
  const chartArtPaths = [];
  for (let i=0;i<Math.min(top20.length,10);i++) {
    const p = path.join(TEMP_DIR, `chart-art-${i}.jpg`);
    if (top20[i].thumbnail) { try { await downloadFile(top20[i].thumbnail, p); } catch {} }
    chartArtPaths.push(fs.existsSync(p)?p:null);
  }

  // Compute position changes from previous week
  let posChanges = null;
  try {
    const wm = weekLabel.match(/W(\d+)\s+(\d+)/);
    if (wm) {
      const wk = parseInt(wm[1]), yr = parseInt(wm[2]);
      let prevWk = wk - 1, prevYr = yr;
      if (prevWk < 1) { prevWk = 52; prevYr--; }
      const prevFile = path.join(ROOT, 'chart-history', `chart-${prevYr}-W${String(prevWk).padStart(2,'0')}.json`);
      if (fs.existsSync(prevFile)) {
        const prevData = readJSON(prevFile);
        const prevTop20 = getSinglesChart(prevData.releases, 20, isAlt?'alt':'all', bandsData);
        const prevPosMap = {};
        prevTop20.forEach((r, i) => prevPosMap[r.releaseId] = i + 1);
        posChanges = top20.slice(0,10).map((r, i) => {
          const curPos = i + 1;
          const prevPos = prevPosMap[r.releaseId];
          if (!prevPos) return { type: 'new' };
          const diff = prevPos - curPos;
          if (diff > 0) return { type: 'up', diff };
          if (diff < 0) return { type: 'down', diff: Math.abs(diff) };
          return { type: 'same' };
        });
        logOk(`Loaded prev week chart (W${String(prevWk).padStart(2,'0')} ${prevYr}), chevrons computed`);
      } else {
        logDim(`No previous week chart: ${prevFile}`);
      }
    }
  } catch(e) { logDim(`Chevron calc skipped: ${e.message}`); }

  // Chart list (audio: song #1 LPF)
  const chartPath = path.join(TEMP_DIR, 'seg-chart.mp4');
  makeChartList(top20.slice(0,10), collagePath, chartArtPaths, chartPath, ytPaths[0], posChanges);
  segments.push(chartPath);

  // Outro (audio: song #1 LPF + fadeout)
  const outroPath = path.join(TEMP_DIR, 'seg-outro.mp4');
  makeOutro(collagePath, outroPath, ytPaths[0]);
  segments.push(outroPath);

  // --- Normalize + concat ---
  logS('NORMALIZING');
  const normPaths = [];
  for (let i=0;i<segments.length;i++) {
    const np = path.join(TEMP_DIR, `norm-${String(i).padStart(2,'0')}.mp4`);
    logDim(`${i+1}/${segments.length}...`);
    norm(segments[i], np);
    normPaths.push(np);
  }

  logS('CONCAT');
  const chartLabel = isAlt ? 'alt' : 'standard';
  const weekFile = weekLabel.replace(/\s+/g,'-');
  const rawPath = path.join(TEMP_DIR, 'concat-raw.mp4');
  const finalPath = path.join(OUTPUT_DIR, `chart-video-${chartLabel}-${weekFile}.mp4`);
  concatSegments(normPaths, rawPath);

  // Enforce 30s cap
  const rawDur = dur(rawPath);
  if (rawDur > MAX_DUR) {
    logStep(`Trimming ${rawDur.toFixed(1)}s \u2192 ${MAX_DUR}s`);
    ff(['-i', rawPath, '-t', String(MAX_DUR), '-c', 'copy', '-y', finalPath], 'trim 30s');
  } else {
    fs.renameSync(rawPath, finalPath);
  }

  // --- Cleanup ---
  logStep('Cleaning...');
  try { for (const f of fs.readdirSync(TEMP_DIR)) safeDelete(path.join(TEMP_DIR,f)); fs.rmdirSync(TEMP_DIR); } catch {}

  // --- Summary ---
  const sz = fs.existsSync(finalPath) ? (fs.statSync(finalPath).size/(1024*1024)).toFixed(1) : '?';
  const d = dur(finalPath);
  logS('DONE');
  logOk(`Video: ${finalPath}`);
  logOk(`Size: ${sz} MB | Duration: ${d.toFixed(1)}s | ${W}x${H} @${FPS}fps`);
  logStep('Review, then post to Instagram as a Reel.');

  try { execSync(`start "" "${OUTPUT_DIR}"`, {windowsHide:true,shell:true}); } catch {}
}

main().catch(err => { console.error('\x1b[31mFatal:\x1b[0m', err.message); process.exit(1); });
