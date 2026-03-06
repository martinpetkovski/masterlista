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

const INTRO_DUR      = 4;
const GLITCH_DUR     = 0.5;
const CLIP_DUR_DEF   = 10;
const CHART_LIST_DUR = 8;
const OUTRO_DUR      = 4;

const T = {
  bg: '0f1117', cardBg: '1a1b2e',
  textPri: 'f0f0f0', textSec: 'b0b8c8', textMuted: '6b7280',
  accent: '2563eb', green: '16a34a', purple: '7c3aed',
  gold: 'FFD700', silver: 'C0C0C0', bronze: 'CD7F32',
  white: 'ffffff', black: '111111',
};

const CYR_TOP     = '\u0422\u043E\u043F \u0421\u0438\u043D\u0433\u043B\u043E\u0432\u0438';
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
function ease(s, d) { return `(1-pow(max(0\\,1-min(1\\,(t-${s})/${d}))\\,2.5))`; }

// Static collage background (no zoompan)
function staticBg(inputLabel) {
  return `[${inputLabel}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[bg]`;
}

// ============================================================================
//  CHART DATA
// ============================================================================

const rapGenres = ['Рап','Трап','Хип Хоп','Бум Бап','Поп-Рап'];
const electronicGenres = ['Електронска','Техно','Хаус','Транс','Синтвејв','Синт-Поп','EDM','ДНБ','Драм','Амбиентална','Вејпорвејв','Драм ен Бас','Психоделичен Транс','Гоа','Глич','Чилаут','Електро-амбиентал','Трип Хоп','Псајбас','Псајдаб'];
const popGenres = ['Поп','Поп-Рок','Поп Рок','Данс Поп','Синт-Поп','К-Поп','Турбо-Фолк','R&B','Поп-Фолк',"Р'н'Б",'Шлагер','Соул'];
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
  flt.push('[grid]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill[final]');

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
  const dateLabel = getDateRangeLabel();
  const hasLogo = fs.existsSync(LOGO_PATH);

  const inp = ['-loop','1','-i',collagePath];
  const flt = [];
  let nextIdx = 1;

  if (hasLogo) { inp.push('-i', LOGO_PATH); nextIdx = 2; }

  flt.push(staticBg('0:v'));

  const titleY = Math.round(H * 0.68);
  const subTitleY = titleY + 100;
  const dateY = subTitleY + 50;

  // Logo (large) above title
  if (hasLogo) {
    const sz = 600, lx = (W-sz)/2, ly = titleY - sz - 30;
    flt.push(`[1:v]scale=${sz}:${sz},format=rgba[logo]`);
    flt.push(`[bg][logo]overlay=x=${lx}:y='${ly}-100*(1-${ease(0.05,0.3)})':format=auto[base]`);
  } else {
    flt.push('[bg]copy[base]');
  }

  flt.push(
    `[base]` +
    // White flash punch at start
    `fade=t=in:st=0:d=0.15:color=white,` +
    // Title SLAMS up
    `drawtext=text='${esc(chartTitle)}':fontfile='${FF_TITLE}':fontsize=88:fontcolor=0x${T.white}:` +
    `x=(w-text_w)/2:y='${titleY}+100*(1-${ease(0.25,0.3)})':alpha='${ease(0.25,0.3)}',` +
    // Subtitle snaps in
    `drawtext=text='${esc(isAlt ? '' : CYR_TOP)}':fontfile='${FF_HEAD}':fontsize=44:fontcolor=0xdddddd:` +
    `x=(w-text_w)/2:y='${subTitleY}+60*(1-${ease(0.45,0.25)})':alpha='${ease(0.45,0.25)}',` +
    // Date snaps in
    `drawtext=text='${esc(dateLabel)}':fontfile='${FF_BODY}':fontsize=38:fontcolor=0xbbbbbb:` +
    `x=(w-text_w)/2:y='${dateY}+50*(1-${ease(0.6,0.25)})':alpha='${ease(0.6,0.25)}',` +
    // Site punches up
    `drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=44:fontcolor=0x${T.white}:` +
    `x=(w-text_w)/2:y='${Math.round(H*0.92)}+60*(1-${ease(0.9,0.3)})':alpha='${ease(0.9,0.3)}'[outv]`
  );

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

  // If we have actual video files, extract a single frame from each and glitch them
  const hasPrev = prevYtPath && fs.existsSync(prevYtPath);
  const hasNext = nextYtPath && fs.existsSync(nextYtPath);

  if (hasPrev && hasNext) {
    // Extract frames from both videos, blend + glitch
    const prevDur = dur(prevYtPath), nextDur = dur(nextYtPath);
    const prevSS = Math.max(0, Math.floor(prevDur * 0.35));
    const nextSS = Math.max(0, Math.floor(nextDur * 0.3));

    ff([
      '-ss',String(prevSS),'-i',prevYtPath,'-t',String(d),
      '-ss',String(nextSS),'-i',nextYtPath,'-t',String(d),
      '-f','lavfi','-i',`anoisesrc=d=${d}:c=pink:r=44100:a=0.15`,
      '-filter_complex', [
        // Scale both to frame size
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[a]`,
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[b]`,
        // Blend prev and next with shuffled pixels + RGB shift
        `[a][b]blend=all_mode=difference,` +
        `shufflepixels=mode=block:width=80:height=40:seed=42,` +
        `rgbashift=rh=-18:rv=12:gh=10:gv=-8:bh=-5:bv=15:edge=wrap,` +
        `noise=alls=60:allf=t,hue=H=180*t/${d},` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.6:t=fill:enable='lt(t\\,0.06)',` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.8:t=fill:enable='gt(t\\,${d-0.08})',` +
        `fade=t=in:st=0:d=0.08,fade=t=out:st=${d-0.08}:d=0.08[outv]`,
        // Glitched audio: pink noise burst with flanger
        `[2:a]afade=t=in:st=0:d=0.05,afade=t=out:st=${d-0.1}:d=0.1,volume=0.6,aresample=44100[outa]`,
      ].join(';\n'),
      '-map','[outv]','-map','[outa]',
      '-c:v','libx264','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-ar','44100',
      '-pix_fmt','yuv420p','-t',String(d),'-y',outputPath,
    ], `glitch #${rank}`);
  } else {
    // Fallback: noise + RGB shift on black
    ff([
      '-f','lavfi','-i',`color=c=0x${T.bg}:s=${W}x${H}:d=${d}:r=${FPS}`,
      '-f','lavfi','-i',`anoisesrc=d=${d}:c=pink:r=44100:a=0.12`,
      '-filter_complex', [
        `[0:v]noise=alls=80:allf=t,` +
        `rgbashift=rh=-12:rv=8:gh=6:gv=-4:bh=-3:bv=10:edge=wrap,` +
        `hue=H=120*t/${d},` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.7:t=fill:enable='lt(t\\,0.08)',` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.9:t=fill:enable='gt(t\\,${d-0.1})',` +
        `fade=t=in:st=0:d=0.1,fade=t=out:st=${d-0.1}:d=0.1[outv]`,
        `[1:a]afade=t=in:st=0:d=0.05,afade=t=out:st=${d-0.1}:d=0.1,volume=0.5,aresample=44100[outa]`,
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

  // 90% width, 60% height for the video area
  const vidW = Math.round(W * 0.90); // 972
  const vidH = Math.round(H * 0.60); // 1152
  const vidX = Math.round((W - vidW) / 2);
  const vidY = Math.round(H * 0.18);
  const bp = 3;

  // Text area below video
  const textY = vidY + vidH + 30;
  const rankBoxW = 100, rankBoxH = 90;
  const rankBoxX = 50, rankBoxY = textY;
  const titleX = rankBoxX + rankBoxW + 16;

  const inp = ['-ss',String(ss),'-i',ytPath, '-loop','1','-i',collagePath];
  let logoIdx = -1;
  if (hasLogo) { inp.push('-i', LOGO_PATH); logoIdx = 2; }
  inp.push('-t',String(d));

  const flt = [
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[bg]`,
    `[0:v]scale=${vidW-bp*2}:${vidH-bp*2}:force_original_aspect_ratio=increase,` +
    `crop=${vidW-bp*2}:${vidH-bp*2},` +
    `pad=${vidW}:${vidH}:${bp}:${bp}:color=0x${T.white}30,setsar=1[vid]`,
    `[bg][vid]overlay=x=${vidX}:y=${vidY}:format=auto[comp]`,
  ];

  // Logo overlay (top-left watermark)
  let base = 'comp';
  if (hasLogo) {
    flt.push(`[${logoIdx}:v]scale=180:180,format=rgba[logo]`);
    flt.push(`[comp][logo]overlay=x=30:y=15:format=auto[comp2]`);
    base = 'comp2';
  }

  flt.push(
    `[${base}]` +
    // Rank box pops in (scale effect via delayed reveal)
    `drawbox=x=${rankBoxX}:y=${rankBoxY}:w=${rankBoxW}:h=${rankBoxH}:color=0x${col}:t=fill:enable='gte(t\\,0.1)',` +
    `drawtext=text='${esc(String(rank))}':fontfile='${FF_HEAD}':fontsize=64:fontcolor=0x${T.black}:` +
    `x=${rankBoxX}+(${rankBoxW}-text_w)/2:y='${rankBoxY}+(${rankBoxH}-text_h)/2+15*(1-${ease(0.1,0.4)})':alpha='${ease(0.1,0.4)}',` +
    // Title bg + text slides in from right
    `drawbox=x='${titleX}+(${W - titleX - 50})*(1-${ease(0.15,0.5)})':y=${rankBoxY}:w=${W - titleX - 50}:h=${rankBoxH}:color=black@0.75:t=fill,` +
    `drawtext=text='${esc(title)}':fontfile='${FF_HEAD}':fontsize=52:fontcolor=0x${T.white}:` +
    `x='${titleX+16}+60*(1-${ease(0.2,0.5)})':y=${rankBoxY+6}:alpha='${ease(0.2,0.5)}',` +
    `drawtext=text='${esc(artist)}':fontfile='${FF_BODY}':fontsize=38:fontcolor=0x${T.textSec}:` +
    `x='${titleX+16}+60*(1-${ease(0.3,0.5)})':y=${rankBoxY+52}:alpha='${ease(0.3,0.5)}',` +
    // Site
    `drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=44:fontcolor=0x${T.white}:x=(w-text_w)/2:y='${Math.round(H*0.93)}+20*(1-${ease(0.4,0.5)})':alpha='${ease(0.4,0.5)}'[outv]`
  );

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

  // Logo (larger)
  let base = 'bg';
  if (hasLogo) {
    flt.push(`[${logoIdx}:v]scale=160:160,format=rgba[logo]`);
    flt.push(`[bg][logo]overlay=x=30:y=15:format=auto[bglogo]`);
    base = 'bglogo';
  }

  const hdrY = 60, startY = 160, rowH = 155, stag = 0.18;
  const rowMargin = 40, rowW = W - rowMargin*2;
  const rankX = rowMargin + 14;
  const artX = rankX + rankBoxS + 10;
  const textX = artX + artSize + 14;
  const hasArts = Object.keys(artIdxMap).length > 0;
  const txtOutput = hasArts ? 'txout' : 'outv';

  let txt =
    `[${base}]` +
    // Header
    `drawtext=text='${esc(isAlt ? CYR_ALT+' '+CYR_TOP : CYR_TOP)}':fontfile='${FF_HEAD}':fontsize=58:fontcolor=0x${T.white}:` +
    `x=(w-text_w)/2:y='${hdrY}+20*(1-${ease(0.1,0.4)})':alpha='${ease(0.1,0.4)}'`;

  for (let i = 0; i < Math.min(chart10.length, 10); i++) {
    const r = chart10[i], rk = i+1, col = rc(rk);
    const y = startY + i * rowH;
    const dl = 0.3 + i * stag;
    const e = ease(dl, 0.35);
    const song = r.releaseTitle.length>20 ? r.releaseTitle.slice(0,17)+'...' : r.releaseTitle;
    const art = r.bandName.length>24 ? r.bandName.slice(0,21)+'...' : r.bandName;

    // Row background (dark, opaque)
    txt += `,drawbox=x=${rowMargin}:y='${y}':w=${rowW}:h=${rowH-8}:color=black@0.80:t=fill:enable='gte(t\\,${dl})'`;
    // Rank box
    const rbY = y + Math.round((rowH - 8 - rankBoxS) / 2);
    txt += `,drawbox=x=${rankX}:y='${rbY}':w=${rankBoxS}:h=${rankBoxS}:color=0x${col}:t=fill:enable='gte(t\\,${dl})'`;
    txt += `,drawtext=text='${esc(String(rk))}':fontfile='${FF_HEAD}':fontsize=36:fontcolor=0x${T.black}:x=${rankX}+(${rankBoxS}-text_w)/2:y='${rbY}+(${rankBoxS}-text_h)/2':alpha='${e}'`;
    // Song title
    txt += `,drawtext=text='${esc(song)}':fontfile='${FF_HEAD}':fontsize=42:fontcolor=0x${T.white}:x='${textX}+30*(1-${e})':y='${y+22}':alpha='${e}'`;
    // Artist
    txt += `,drawtext=text='${esc(art)}':fontfile='${FF_BODY}':fontsize=34:fontcolor=0x${T.textSec}:x='${textX}+30*(1-${e})':y='${y+68}':alpha='${e}'`;
    // Chevron indicator (right side of row)
    if (posChanges && posChanges[i]) {
      const pc = posChanges[i];
      const chX = rowMargin + rowW - 55;
      const chY = y + Math.round((rowH - 8) / 2) - 12;
      if (pc.type === 'up') {
        txt += `,drawtext=text='\\u25B2':fontfile='${FF_BODY}':fontsize=28:fontcolor=0x16c953:x=${chX}:y='${chY}':alpha='${e}'`;
      } else if (pc.type === 'down') {
        txt += `,drawtext=text='\\u25BC':fontfile='${FF_BODY}':fontsize=28:fontcolor=0xf03e3e:x=${chX}:y='${chY}':alpha='${e}'`;
      } else if (pc.type === 'new') {
        txt += `,drawtext=text='${esc('НОВО')}':fontfile='${FF_HEAD}':fontsize=18:fontcolor=0x${T.gold}:x=${chX - 10}:y='${chY + 4}':alpha='${e}'`;
      }
    }
  }

  // Site link
  txt += `,drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=44:fontcolor=0x${T.white}:x=(w-text_w)/2:y='${Math.round(H*0.93)}+20*(1-${ease(0.2,0.4)})':alpha='${ease(0.2,0.4)}'[${txtOutput}]`;
  flt.push(txt);

  // Overlay art thumbnails AFTER row backgrounds (true color, not darkened)
  if (hasArts) {
    let artBase = 'txout';
    const artEntries = Object.entries(artIdxMap);
    for (let ai = 0; ai < artEntries.length; ai++) {
      const [ci] = artEntries[ai];
      const idx = parseInt(ci);
      const y = startY + idx * rowH + Math.round((rowH - 8 - artSize) / 2);
      const dl = (0.3 + idx * stag).toFixed(2);
      const isLast = ai === artEntries.length - 1;
      const outLabel = isLast ? 'outv' : `ov${idx}`;
      flt.push(`[${artBase}][art${ci}]overlay=x=${artX}:y=${y}:enable='gte(t\\,${dl})':format=auto[${outLabel}]`);
      artBase = outLabel;
    }
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

  // Logo: large, centered above toplista.mk
  const siteY = Math.round(H * 0.88);
  if (hasLogo) {
    const sz = 500, lx = (W-sz)/2, ly = siteY - sz - 40;
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
  const tagY2 = tagY1 + 100;
  const tagY3 = tagY2 + 100;

  flt.push(
    `[base]` +
    // White flash punch
    `fade=t=in:st=0:d=0.12:color=white,` +
    // Word 1: СЛУШАЈ
    `drawtext=text='${esc(word1)}':fontfile='${FF_TITLE}':fontsize=64:fontcolor=0x${T.gold}:` +
    `x=(w-text_w)/2:y='${tagY1}+60*(1-${ease(0.1,0.3)})':alpha='${ease(0.1,0.3)}',` +
    // Word 2: МАКЕДОНСКА
    `drawtext=text='${esc(word2)}':fontfile='${FF_TITLE}':fontsize=64:fontcolor=0x${T.gold}:` +
    `x=(w-text_w)/2:y='${tagY2}+60*(1-${ease(0.3,0.3)})':alpha='${ease(0.3,0.3)}',` +
    // Word 3: МУЗИКА!
    `drawtext=text='${esc(word3)}':fontfile='${FF_TITLE}':fontsize=64:fontcolor=0x${T.gold}:` +
    `x=(w-text_w)/2:y='${tagY3}+60*(1-${ease(0.5,0.3)})':alpha='${ease(0.5,0.3)}',` +
    // Site URL
    `drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=50:fontcolor=0x${T.white}:` +
    `x=(w-text_w)/2:y='${siteY}+30*(1-${ease(0.8,0.3)})':alpha='${ease(0.8,0.3)}'[outv]`
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

  const inp = ['-loop','1','-i',collagePath];
  let ni = 1;
  if (hasArt) { inp.push('-loop','1','-i',artPath); ni=2; }
  inp.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');

  const flt = [];
  // Static collage + abstract bottom art
  flt.push(staticBg('0:v'));

  let base = 'bg';
  if (hasArt) {
    flt.push(`[1:v]scale=500:500,pad=512:512:6:6:color=0x${T.textMuted}40,format=rgba,setsar=1[art]`);
    flt.push(`[bg][art]overlay=x=${(W-512)/2}:y=${Math.round(H*0.25)}:format=auto[base]`);
    base = 'base';
  }

  const ry = hasArt ? Math.round(H*0.56) : Math.round(H*0.3);
  flt.push(
    `[${base}]` +
    `drawtext=text='${esc('#'+rank)}':fontfile='${FF_HEAD}':fontsize=80:fontcolor=0x${col}:x=(w-text_w)/2:y=${ry},` +
    `drawtext=text='${esc(title)}':fontfile='${FF_HEAD}':fontsize=48:fontcolor=0x${T.white}:x=(w-text_w)/2:y=${ry+100},` +
    `drawtext=text='${esc(artist)}':fontfile='${FF_BODY}':fontsize=36:fontcolor=0x${T.textSec}:x=(w-text_w)/2:y=${ry+160},` +
    `drawtext=text='toplista.mk':fontfile='${FF_HEAD}':fontsize=44:fontcolor=0x${T.white}:x=(w-text_w)/2:y=${Math.round(H*0.88)}[outv]`
  );
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
  const chartData = JSON.parse(fs.readFileSync(path.join(ROOT,'chart-data.json'),'utf8'));
  let bandsData = [];
  const spMap = new Map();
  const bp = path.join(ROOT,'bands.json');
  if (fs.existsSync(bp)) {
    const bj = JSON.parse(fs.readFileSync(bp,'utf8'));
    bandsData = bj.muzickaMasterLista || [];
    for (const b of bandsData) { if (b.spotifyName) spMap.set(b.name, b.spotifyName); }
    logOk(`${bandsData.length} bands`);
  }

  const top20 = getSinglesChart(chartData.releases, 20, isAlt?'alt':'all', bandsData);
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
        const prevData = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
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
  const finalPath = path.join(OUTPUT_DIR, `chart-video-${chartLabel}-${weekFile}.mp4`);
  concatSegments(normPaths, finalPath);

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
