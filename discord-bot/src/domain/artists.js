'use strict';

const {
  ARTIST_MULTI_LINK_PLATFORMS,
  LOGICAL_FILE_PATHS,
  MISSING_DATA_TEXT
} = require('../constants');
const { buildPendingSummary } = require('./draft-summary');
const { getBandsList, loadBandsDocument, loadGenres } = require('../repo-data');
const {
  deepClone,
  detectArtistPlatform,
  generateArtistSlug,
  isClearToken,
  isValidHttpUrl,
  normalizeComparableName,
  splitMultiValueText,
  transliterateCyrillicToLatin
} = require('../utils/text');

function buildEmptyArtistDraft() {
  return {
    name: '',
    city: MISSING_DATA_TEXT,
    genre: MISSING_DATA_TEXT,
    soundsLike: MISSING_DATA_TEXT,
    label: null,
    contact: MISSING_DATA_TEXT,
    accentColors: ['#e94560', '#ffa502'],
    confirmed: false,
    links: { none: MISSING_DATA_TEXT }
  };
}

function sortBands(list) {
  return list.sort((left, right) => transliterateCyrillicToLatin(left.name || '').localeCompare(transliterateCyrillicToLatin(right.name || ''), 'en'));
}

function getWorkingBandsState(repoRoot, draftStore, userId) {
  const existingDraft = draftStore.getDraft(userId, LOGICAL_FILE_PATHS.BANDS);
  const originalDocument = existingDraft && existingDraft.original
    ? existingDraft.original
    : loadBandsDocument(repoRoot);
  const workingDocument = existingDraft
    ? existingDraft.data
    : deepClone(originalDocument);

  return {
    originalDocument: deepClone(originalDocument),
    workingDocument: deepClone(workingDocument)
  };
}

function getEffectiveBandsList(repoRoot, draftStore, userId) {
  return getBandsList(getWorkingBandsState(repoRoot, draftStore, userId).workingDocument);
}

function findArtist(list, query) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return null;
  }

  const exact = list.find((artist) => artist.name === trimmedQuery);
  if (exact) {
    return {
      artist: exact,
      index: list.findIndex((candidate) => candidate === exact)
    };
  }

  const slug = generateArtistSlug(trimmedQuery);
  const slugMatch = list.find((artist) => generateArtistSlug(artist.name) === slug);
  if (slugMatch) {
    return {
      artist: slugMatch,
      index: list.findIndex((candidate) => candidate === slugMatch)
    };
  }

  const normalizedQuery = normalizeComparableName(trimmedQuery);
  const normalizedMatch = list.find((artist) => normalizeComparableName(artist.name) === normalizedQuery);
  if (normalizedMatch) {
    return {
      artist: normalizedMatch,
      index: list.findIndex((candidate) => candidate === normalizedMatch)
    };
  }

  return null;
}

function formatArtistLinksForInput(links) {
  if (!links || links.none === MISSING_DATA_TEXT) {
    return '';
  }

  const lines = [];
  for (const [platform, value] of Object.entries(links)) {
    if (Array.isArray(value)) {
      for (const url of value) {
        if (url && url !== MISSING_DATA_TEXT) {
          lines.push(url);
        }
      }
      continue;
    }

    if (value && value !== MISSING_DATA_TEXT) {
      lines.push(value);
    }
  }

  return lines.join('\n');
}

function parseArtistLinks(text) {
  const lines = splitMultiValueText(text);
  if (!lines.length) {
    return { none: MISSING_DATA_TEXT };
  }

  const links = {};
  const seenPlatforms = new Set();

  for (const line of lines) {
    let rawUrl = line;

    const explicitMatch = line.match(/^([a-z0-9_]+)\s*=\s*(https?:\/\/\S+)$/i);
    if (explicitMatch) {
      rawUrl = explicitMatch[2].trim();
    }

    if (!rawUrl) {
      continue;
    }

    if (!isValidHttpUrl(rawUrl)) {
      throw new Error(`Invalid artist link: ${rawUrl}`);
    }

    const platform = detectArtistPlatform(rawUrl) || 'generic';

    if (!ARTIST_MULTI_LINK_PLATFORMS.has(platform) && seenPlatforms.has(platform)) {
      throw new Error(`Duplicate artist link platform: ${platform}`);
    }

    if (ARTIST_MULTI_LINK_PLATFORMS.has(platform)) {
      if (!Array.isArray(links[platform])) {
        links[platform] = [];
      }
      links[platform].push(rawUrl);
    } else {
      links[platform] = rawUrl;
    }

    seenPlatforms.add(platform);
  }

  return Object.keys(links).length ? links : { none: MISSING_DATA_TEXT };
}

function normalizeMissingDataValue(value) {
  return String(value || '').trim() || MISSING_DATA_TEXT;
}

function resolveOptionalContact(rawValue, existingValue) {
  if (rawValue == null) {
    return existingValue || MISSING_DATA_TEXT;
  }

  if (isClearToken(rawValue)) {
    return MISSING_DATA_TEXT;
  }

  return String(rawValue).trim() || MISSING_DATA_TEXT;
}

function resolveOptionalLabel(rawValue, existingValue) {
  if (rawValue == null) {
    return existingValue === undefined ? null : existingValue;
  }

  if (isClearToken(rawValue)) {
    return null;
  }

  const normalized = String(rawValue).trim();
  return normalized || null;
}

function resolveAccentColors(existingAccentColors, accentOneRaw, accentTwoRaw, isNewArtist) {
  let accentOne = Array.isArray(existingAccentColors) ? existingAccentColors[0] || null : null;
  let accentTwo = Array.isArray(existingAccentColors) ? existingAccentColors[1] || null : null;

  if (isNewArtist && !accentOne && !accentTwo) {
    accentOne = '#e94560';
    accentTwo = '#ffa502';
  }

  if (accentOneRaw != null) {
    accentOne = isClearToken(accentOneRaw) ? null : String(accentOneRaw).trim();
  }

  if (accentTwoRaw != null) {
    accentTwo = isClearToken(accentTwoRaw) ? null : String(accentTwoRaw).trim();
  }

  for (const value of [accentOne, accentTwo]) {
    if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error(`Accent colors must be 6-digit hex values. Invalid value: ${value}`);
    }
  }

  return accentOne || accentTwo ? [accentOne || null, accentTwo || null] : null;
}

function validateArtist(nextArtist, workingBands, currentIndex, knownGenres) {
  const rawName = String(nextArtist.name || '').trim();
  if (rawName.length < 2) {
    throw new Error('Artist name must be at least 2 characters long.');
  }

  if (nextArtist.city === MISSING_DATA_TEXT) {
    throw new Error('Artist city is required.');
  }

  if (nextArtist.genre === MISSING_DATA_TEXT) {
    throw new Error('Artist genres are required.');
  }

  const normalizedName = normalizeComparableName(rawName);
  const duplicateIndex = workingBands.findIndex((artist, index) => {
    if (index === currentIndex) return false;
    return normalizeComparableName(artist.name) === normalizedName;
  });
  if (duplicateIndex >= 0) {
    throw new Error(`Duplicate artist name: ${rawName}`);
  }

  if (nextArtist.contact && nextArtist.contact !== MISSING_DATA_TEXT) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(nextArtist.contact)) {
      throw new Error('Artist contact must be a valid email address.');
    }
  }

  if (Array.isArray(knownGenres) && knownGenres.length) {
    const invalidGenres = String(nextArtist.genre || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => !knownGenres.some((genre) => genre.toLowerCase() === value.toLowerCase()));
    if (invalidGenres.length) {
      throw new Error(`Unknown genres: ${invalidGenres.join(', ')}`);
    }
  }
}

function persistBandsDraft(draftStore, userId, workingBands, originalBands) {
  const nextDocument = { muzickaMasterLista: workingBands };
  const originalDocument = { muzickaMasterLista: originalBands };

  if (JSON.stringify(nextDocument) === JSON.stringify(originalDocument)) {
    draftStore.clear(userId, LOGICAL_FILE_PATHS.BANDS);
    return null;
  }

  return draftStore.save(
    userId,
    LOGICAL_FILE_PATHS.BANDS,
    nextDocument,
    originalDocument
  );
}

function createOrUpdateArtistDraft(options) {
  const {
    repoRoot,
    draftStore,
    userId,
    existingArtistQuery,
    modalValues,
    commandValues
  } = options;

  const { originalDocument, workingDocument } = getWorkingBandsState(repoRoot, draftStore, userId);
  const originalBands = getBandsList(originalDocument);
  const workingBands = getBandsList(workingDocument).slice();
  const resolved = existingArtistQuery ? findArtist(workingBands, existingArtistQuery) : null;
  if (existingArtistQuery && !resolved) {
    throw new Error(`Artist not found: ${existingArtistQuery}`);
  }

  const currentIndex = resolved ? resolved.index : -1;
  const baseArtist = resolved ? deepClone(resolved.artist) : buildEmptyArtistDraft();

  const nextArtist = Object.assign(baseArtist, {
    name: String(modalValues.name || '').trim(),
    city: normalizeMissingDataValue(modalValues.city),
    genre: normalizeMissingDataValue(modalValues.genre),
    soundsLike: modalValues.soundsLike == null
      ? (baseArtist.soundsLike || MISSING_DATA_TEXT)
      : normalizeMissingDataValue(modalValues.soundsLike),
    label: resolveOptionalLabel(commandValues.label, baseArtist.label),
    contact: resolveOptionalContact(modalValues.contact, baseArtist.contact),
    accentColors: resolveAccentColors(baseArtist.accentColors, commandValues.accentOne, commandValues.accentTwo, !resolved),
    confirmed: commandValues.confirmed == null ? !!baseArtist.confirmed : !!commandValues.confirmed,
    links: parseArtistLinks(modalValues.linksText)
  });

  validateArtist(nextArtist, workingBands, currentIndex, loadGenres(repoRoot));

  if (currentIndex >= 0) {
    workingBands[currentIndex] = nextArtist;
  } else {
    workingBands.push(nextArtist);
  }

  sortBands(workingBands);
  const savedDraft = persistBandsDraft(draftStore, userId, workingBands, originalBands);

  const pendingSummary = buildPendingSummary(draftStore.getUserDrafts(userId));
  return {
    artist: nextArtist,
    changeType: currentIndex >= 0 ? 'updated' : 'added',
    pendingSummary,
    savedAt: savedDraft ? savedDraft.savedAt : null
  };
}

function deleteArtistDraft(options) {
  const {
    repoRoot,
    draftStore,
    userId,
    artistQuery
  } = options;

  const { originalDocument, workingDocument } = getWorkingBandsState(repoRoot, draftStore, userId);
  const originalBands = getBandsList(originalDocument);
  const workingBands = getBandsList(workingDocument).slice();
  const resolved = findArtist(workingBands, artistQuery);

  if (!resolved) {
    throw new Error(`Artist not found: ${artistQuery}`);
  }

  const [removedArtist] = workingBands.splice(resolved.index, 1);
  sortBands(workingBands);
  const savedDraft = persistBandsDraft(draftStore, userId, workingBands, originalBands);

  return {
    artist: removedArtist,
    pendingSummary: buildPendingSummary(draftStore.getUserDrafts(userId)),
    savedAt: savedDraft ? savedDraft.savedAt : null
  };
}

module.exports = {
  createOrUpdateArtistDraft,
  deleteArtistDraft,
  findArtist,
  formatArtistLinksForInput,
  getEffectiveBandsList,
  getWorkingBandsState
};