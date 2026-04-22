#!/usr/bin/env node
// scripts/generate-og-image.js
//
// Generates the social media preview image (og-image.png) at 1200×627.
// Left 1/3: large logo. Right 2/3: "ТОП ЛИСТА" + toplista.mk
// Background: cinematic gradient inspired by verified artist pages.
//
// Usage:  node scripts/generate-og-image.js
// Requires: tools/ffmpeg.exe, tools/fonts/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FFMPEG = path.join(ROOT, 'tools', 'ffmpeg.exe');
const LOGO = path.join(ROOT, 'images', 'logo.png');
const OUTPUT = path.join(ROOT, 'images', 'og-image.png');

const FONT_DIR = path.join(ROOT, 'tools', 'fonts');
const FONT_TITLE = path.join(FONT_DIR, 'DelaGothicOne-Regular.ttf');
const FONT_LINK  = path.join(FONT_DIR, 'Montserrat-Variable.ttf');

// Windows ffmpeg path escaping (forward slashes, escape colons)
function ffp(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:'); }

// --- Layout (1200 × 627) ---
const W = 1200, H = 627;
const LEFT_W = 420;                     // ~1/3 for logo

// Logo: large, vertically centered in the left 1/3
const LOGO_SIZE = 340;
const LOGO_X = Math.round((LEFT_W - LOGO_SIZE) / 2);  // 40
const LOGO_Y = Math.round((H - LOGO_SIZE) / 2);       // 144

// Title: "ТОП ЛИСТА" centered in the right 2/3
const TITLE_TEXT = '\u0422\u041E\u041F \u041B\u0418\u0421\u0422\u0410';
const TITLE_SIZE = 88;

// URL: "toplista.mk" below title — larger, Montserrat bold
const URL_TEXT = 'toplista.mk';
const URL_SIZE = 30;

// Colors
const TEXT_W  = 'f0f0f0';
const TEXT_URL = '6b7280';
const ACCENT  = '4a7fa5';
const TOP_BAR = 4;

// Background: black → dark gray diagonal, very subdued
// #0d0d0f → #1a1a1e
const G = { r0: 13, g0: 13, b0: 15, r1: 26, g1: 26, b1: 30 };

// --- Build filter chain ---
const filters = [
  // Background: diagonal gradient via geq (black/gray)
  `[0:v]geq=` +
    `r='${G.r0}+(${G.r1}-${G.r0})*(X+Y)/(W+H)':` +
    `g='${G.g0}+(${G.g1}-${G.g0})*(X+Y)/(W+H)':` +
    `b='${G.b0}+(${G.b1}-${G.b0})*(X+Y)/(W+H)'` +
    `[grad]`,

  // Subtle accent glow: very faint blue behind logo, tiny warm accent top-right
  `color=c=black:s=${W}x${H},` +
    `geq=` +
    `r='clip(18*exp(-((X-200)*(X-200)/(300*300.0)+(Y-${H}/2)*(Y-${H}/2)/(350*350.0)))+8*exp(-((X-1050)*(X-1050)/(400*400.0)+(Y-100)*(Y-100)/(300*300.0))),0,255)':` +
    `g='clip(22*exp(-((X-200)*(X-200)/(300*300.0)+(Y-${H}/2)*(Y-${H}/2)/(350*350.0)))+6*exp(-((X-1050)*(X-1050)/(400*400.0)+(Y-100)*(Y-100)/(300*300.0))),0,255)':` +
    `b='clip(40*exp(-((X-200)*(X-200)/(300*300.0)+(Y-${H}/2)*(Y-${H}/2)/(350*350.0)))+4*exp(-((X-1050)*(X-1050)/(400*400.0)+(Y-100)*(Y-100)/(300*300.0))),0,255)'` +
    `[glow]`,

  // Blend gradient + glow
  `[grad][glow]blend=all_mode=addition:all_opacity=1[bg]`,

  // Scale logo
  `[1:v]scale=${LOGO_SIZE}:${LOGO_SIZE}:flags=lanczos[logo]`,

  // Overlay logo onto bg
  `[bg][logo]overlay=${LOGO_X}:${LOGO_Y}[base]`,

  // Top accent bar + text
  `[base]` +
  // Top accent bar
  `drawbox=x=0:y=0:w=iw:h=${TOP_BAR}:color=0x${ACCENT}:t=fill,` +
  // Subtle vertical separator line
  `drawbox=x=${LEFT_W}:y=${Math.round(H * 0.18)}:w=1:h=${Math.round(H * 0.64)}:color=0xffffff10:t=fill,` +
  // Title: ТОП ЛИСТА
  `drawtext=fontfile='${ffp(FONT_TITLE)}':text='${TITLE_TEXT}':fontsize=${TITLE_SIZE}:fontcolor=0x${TEXT_W}:x=${LEFT_W}+(${W}-${LEFT_W}-text_w)/2:y=(${H}-text_h)/2-32,` +
  // URL: toplista.mk (Montserrat bold)
  `drawtext=fontfile='${ffp(FONT_LINK)}':text='${URL_TEXT}':fontsize=${URL_SIZE}:fontcolor=0x${TEXT_URL}:x=${LEFT_W}+(${W}-${LEFT_W}-text_w)/2:y=(${H}-text_h)/2+62`
];

const filterComplex = filters.join('; ');

const cmd = [
  `"${FFMPEG}"`,
  '-y',
  `-f lavfi -i "color=c=black:s=${W}x${H}:d=1"`,
  `-i "${LOGO}"`,
  `-filter_complex "${filterComplex}"`,
  '-frames:v 1 -update 1',
  `"${OUTPUT}"`
].join(' ');

console.log('Generating OG image...');
console.log(`  Size: ${W}x${H}`);
console.log(`  Output: ${OUTPUT}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  const size = fs.statSync(OUTPUT).size;
  console.log(`\nDone! ${OUTPUT} (${(size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error('Failed to generate OG image:', e.message);
  process.exit(1);
}
