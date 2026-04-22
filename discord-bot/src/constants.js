'use strict';

const LOGICAL_FILE_PATHS = {
  BANDS: 'bands.json',
  EVENTS: 'events.json',
  RELEASES: 'releases.json'
};

const REPO_PATH_MAP = {
  [LOGICAL_FILE_PATHS.BANDS]: 'data/dynamic/editable/bands.json',
  [LOGICAL_FILE_PATHS.EVENTS]: 'data/dynamic/editable/events.json',
  [LOGICAL_FILE_PATHS.RELEASES]: 'data/dynamic/editable/releases.json'
};

const FILE_BRANCH_MAP = {
  [LOGICAL_FILE_PATHS.RELEASES]: 'youtube-chart-tracking'
};

const DRAFT_PATH_ALIASES = Object.fromEntries(
  Object.entries(REPO_PATH_MAP).map(([logicalPath, repoPath]) => [repoPath, logicalPath])
);

const MISSING_DATA_TEXT = 'недостигаат податоци';
const DEFAULT_EVENT_TICKET_LABEL = 'Билет';
const CLEAR_TOKENS = new Set(['clear', 'none', '-']);

const ARTIST_MULTI_LINK_PLATFORMS = new Set(['review', 'interview', 'article', 'wikipedia', 'generic']);

const ARTIST_LINK_PATTERNS = [
  { id: 'spotify', pattern: /open\.spotify\.com|spotify\.com/i },
  { id: 'youtube_music', pattern: /music\.youtube\.com/i },
  { id: 'youtube', pattern: /youtube\.com|youtu\.be/i },
  { id: 'instagram', pattern: /instagram\.com/i },
  { id: 'facebook', pattern: /facebook\.com|fb\.com|fb\.me/i },
  { id: 'twitter', pattern: /twitter\.com|x\.com/i },
  { id: 'bandcamp', pattern: /bandcamp\.com/i },
  { id: 'soundcloud', pattern: /soundcloud\.com/i },
  { id: 'apple_music', pattern: /music\.apple\.com/i },
  { id: 'itunes', pattern: /itunes\.apple\.com/i },
  { id: 'deezer', pattern: /deezer\.com/i },
  { id: 'tidal', pattern: /tidal\.com/i },
  { id: 'amazon_music', pattern: /music\.amazon/i },
  { id: 'napster', pattern: /napster\.com/i },
  { id: 'audiomack', pattern: /audiomack\.com/i },
  { id: 'tiktok', pattern: /tiktok\.com/i },
  { id: 'linkedin', pattern: /linkedin\.com/i },
  { id: 'pinterest', pattern: /pinterest\.com/i },
  { id: 'twitch', pattern: /twitch\.tv/i },
  { id: 'vimeo', pattern: /vimeo\.com/i },
  { id: 'patreon', pattern: /patreon\.com/i },
  { id: 'discord', pattern: /discord\.gg|discord\.com/i },
  { id: 'wikipedia', pattern: /wikipedia\.org/i },
  { id: 'linktree', pattern: /linktr\.ee|linktree\.com/i }
];

function normalizeDraftPath(filePath) {
  const normalized = String(filePath || LOGICAL_FILE_PATHS.BANDS).replace(/\\/g, '/').replace(/^\/+/, '');
  return DRAFT_PATH_ALIASES[normalized] || normalized;
}

function resolveRepoPath(filePath) {
  const logicalPath = normalizeDraftPath(filePath);
  return REPO_PATH_MAP[logicalPath] || logicalPath;
}

module.exports = {
  ARTIST_LINK_PATTERNS,
  ARTIST_MULTI_LINK_PLATFORMS,
  CLEAR_TOKENS,
  DEFAULT_EVENT_TICKET_LABEL,
  FILE_BRANCH_MAP,
  LOGICAL_FILE_PATHS,
  MISSING_DATA_TEXT,
  REPO_PATH_MAP,
  normalizeDraftPath,
  resolveRepoPath
};