'use strict';

const { ARTIST_LINK_PATTERNS, CLEAR_TOKENS } = require('../constants');

const CYRILLIC_TO_LATIN_MAP = {
  'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
  'Д': 'D', 'д': 'd', 'Ѓ': 'Gj', 'ѓ': 'gj', 'Е': 'E', 'е': 'e', 'Ж': 'Zh', 'ж': 'zh',
  'З': 'Z', 'з': 'z', 'Ѕ': 'Dz', 'ѕ': 'dz', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
  'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'Lj', 'љ': 'lj', 'М': 'M', 'м': 'm',
  'Н': 'N', 'н': 'n', 'Њ': 'Nj', 'њ': 'nj', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
  'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'Kj', 'ќ': 'kj',
  'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
  'Ч': 'Ch', 'ч': 'ch', 'Џ': 'Dz', 'џ': 'dz', 'Ш': 'Sh', 'ш': 'sh'
};

const PLATFORM_LABELS = {
  amazon_music: 'Amazon Music',
  apple_music: 'Apple Music',
  bandcamp: 'Bandcamp',
  deezer: 'Deezer',
  discord: 'Discord',
  facebook: 'Facebook',
  generic: 'Link',
  instagram: 'Instagram',
  itunes: 'iTunes',
  linktree: 'Linktree',
  linkedin: 'LinkedIn',
  napster: 'Napster',
  pinterest: 'Pinterest',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  twitter: 'X',
  vimeo: 'Vimeo',
  wikipedia: 'Wikipedia',
  youtube: 'YouTube',
  youtube_music: 'YouTube Music'
};

function transliterateCyrillicToLatin(text) {
  return String(text || '')
    .split('')
    .map((character) => CYRILLIC_TO_LATIN_MAP[character] || character)
    .join('');
}

function normalizeComparableName(text) {
  return transliterateCyrillicToLatin(text).toLowerCase().trim();
}

function generateArtistSlug(name) {
  return transliterateCyrillicToLatin(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function splitMultiValueText(text) {
  return String(text || '')
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/i.test(parsed.protocol);
  } catch (_) {
    return false;
  }
}

function isClearToken(value) {
  return typeof value === 'string' && CLEAR_TOKENS.has(value.trim().toLowerCase());
}

function detectArtistPlatform(url) {
  for (const entry of ARTIST_LINK_PATTERNS) {
    if (entry.pattern.test(url)) {
      return entry.id;
    }
  }

  return null;
}

function formatPlatformLabel(platformId) {
  const normalized = String(platformId || 'generic').trim().toLowerCase();
  if (PLATFORM_LABELS[normalized]) {
    return PLATFORM_LABELS[normalized];
  }

  return normalized
    .split('_')
    .map((segment) => segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : '')
    .join(' ')
    .trim() || PLATFORM_LABELS.generic;
}

module.exports = {
  deepClone,
  detectArtistPlatform,
  formatPlatformLabel,
  generateArtistSlug,
  isClearToken,
  isValidHttpUrl,
  normalizeComparableName,
  splitMultiValueText,
  transliterateCyrillicToLatin
};