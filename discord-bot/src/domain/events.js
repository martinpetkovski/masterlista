'use strict';

const {
  DEFAULT_EVENT_TICKET_LABEL,
  LOGICAL_FILE_PATHS
} = require('../constants');
const { buildPendingSummary } = require('./draft-summary');
const { getBandsList, getEventsList, loadBandsDocument, loadEventsDocument } = require('../repo-data');
const {
  detectArtistPlatform,
  deepClone,
  formatPlatformLabel,
  isClearToken,
  isValidHttpUrl
} = require('../utils/text');

function getWorkingEventsState(repoRoot, draftStore, userId) {
  const existingDraft = draftStore.getDraft(userId, LOGICAL_FILE_PATHS.EVENTS);
  const originalDocument = existingDraft && existingDraft.original
    ? existingDraft.original
    : loadEventsDocument(repoRoot);
  const workingDocument = existingDraft
    ? existingDraft.data
    : deepClone(originalDocument);

  return {
    originalDocument: deepClone(originalDocument),
    workingDocument: deepClone(workingDocument)
  };
}

function getEffectiveMasterArtists(repoRoot, draftStore, userId) {
  const bandsDraft = draftStore.getDraft(userId, LOGICAL_FILE_PATHS.BANDS);
  const bandsDocument = bandsDraft ? bandsDraft.data : loadBandsDocument(repoRoot);
  return getBandsList(bandsDocument);
}

function parseEventDate(value) {
  const trimmed = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return trimmed;
}

function isValidEventTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '').trim());
}

function formatEventLinksForInput(links) {
  return (Array.isArray(links) ? links : [])
    .map((entry) => entry && entry.url ? entry.url : '')
    .filter(Boolean)
    .join('\n');
}

function parseEventLinks(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return [];
  }

  if (isClearToken(raw)) {
    return [];
  }

  return raw
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let url = line;
      const separatorIndex = line.lastIndexOf('|');
      if (separatorIndex >= 0) {
        const candidateUrl = line.slice(separatorIndex + 1).trim();
        if (isValidHttpUrl(candidateUrl)) {
          url = candidateUrl;
        }
      }

      if (!isValidHttpUrl(url)) {
        throw new Error(`Invalid event link: ${url}`);
      }

      const platformId = detectArtistPlatform(url) || 'generic';
      return {
        label: formatPlatformLabel(platformId),
        url
      };
    });
}

function parseTicketLines(text) {
  const raw = String(text || '').trim();
  if (!raw || isClearToken(raw)) {
    return [];
  }

  return raw
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('|');
      if (separatorIndex >= 0) {
        const label = line.slice(0, separatorIndex).trim();
        const price = line.slice(separatorIndex + 1).trim();
        return {
          label: label || DEFAULT_EVENT_TICKET_LABEL,
          price
        };
      }

      return {
        label: DEFAULT_EVENT_TICKET_LABEL,
        price: line
      };
    });
}

function parseArtistsInput(text) {
  const raw = String(text || '').trim();
  if (!raw || isClearToken(raw)) {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function generateEventId(title, date) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return `evt-${String(date || '').replace(/-/g, '')}-${slug || 'event'}-${Math.random().toString(36).slice(2, 6)}`;
}

function findEvent(list, query) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return null;
  }

  const exactIdMatch = list.find((eventObject) => eventObject.id === trimmedQuery);
  if (exactIdMatch) {
    return {
      event: exactIdMatch,
      index: list.findIndex((candidate) => candidate === exactIdMatch)
    };
  }

  const normalizedQuery = trimmedQuery.toLowerCase();
  const exactTitleMatch = list.find((eventObject) => String(eventObject.title || '').toLowerCase() === normalizedQuery);
  if (exactTitleMatch) {
    return {
      event: exactTitleMatch,
      index: list.findIndex((candidate) => candidate === exactTitleMatch)
    };
  }

  const partialMatches = list.filter((eventObject) => String(eventObject.title || '').toLowerCase().includes(normalizedQuery));
  if (partialMatches.length === 1) {
    return {
      event: partialMatches[0],
      index: list.findIndex((candidate) => candidate === partialMatches[0])
    };
  }

  if (partialMatches.length > 1) {
    throw new Error(`Event query is ambiguous. Matches: ${partialMatches.slice(0, 5).map((eventObject) => eventObject.title).join(', ')}`);
  }

  return null;
}

function validateEvent(nextEvent, masterArtists) {
  if (!String(nextEvent.title || '').trim()) {
    throw new Error('Event name is required.');
  }

  const parsedDate = parseEventDate(nextEvent.date);
  if (!parsedDate) {
    throw new Error('Event date must be in YYYY-MM-DD format.');
  }
  nextEvent.date = parsedDate;

  if (!isValidEventTimeValue(nextEvent.time)) {
    throw new Error('Event time must be in HH:MM format.');
  }

  const invalidArtist = (nextEvent.artists || []).find((name) => !masterArtists.some((artist) => artist.name === name));
  if (invalidArtist) {
    throw new Error(`Artist is not in the master list: ${invalidArtist}`);
  }
}

function persistEventsDraft(draftStore, userId, updatedEvents, originalEvents) {
  const nextDocument = { events: updatedEvents };
  const originalDocument = { events: originalEvents };

  if (JSON.stringify(nextDocument) === JSON.stringify(originalDocument)) {
    draftStore.clear(userId, LOGICAL_FILE_PATHS.EVENTS);
    return null;
  }

  return draftStore.save(
    userId,
    LOGICAL_FILE_PATHS.EVENTS,
    nextDocument,
    originalDocument
  );
}

function createOrUpdateEventDraft(options) {
  const {
    repoRoot,
    draftStore,
    userId,
    existingEventQuery,
    modalValues,
    commandValues
  } = options;

  const { originalDocument, workingDocument } = getWorkingEventsState(repoRoot, draftStore, userId);
  const originalEvents = getEventsList(originalDocument);
  const workingEvents = getEventsList(workingDocument).slice();
  const resolved = existingEventQuery ? findEvent(workingEvents, existingEventQuery) : null;
  if (existingEventQuery && !resolved) {
    throw new Error(`Event not found: ${existingEventQuery}`);
  }

  const baseEvent = resolved ? deepClone(resolved.event) : {
    id: 'preview-event',
    title: '',
    date: '',
    time: '',
    place: '',
    artists: [],
    tickets: [],
    links: []
  };

  const nextEvent = {
    id: resolved ? resolved.event.id : 'preview-event',
    title: String(modalValues.title || '').trim(),
    date: String(modalValues.date || '').trim(),
    time: String(modalValues.time || '').trim(),
    place: String(modalValues.place || '').trim(),
    artists: commandValues.artists == null ? deepClone(baseEvent.artists || baseEvent.bands || []) : parseArtistsInput(commandValues.artists),
    tickets: commandValues.tickets == null ? deepClone(baseEvent.tickets || []) : parseTicketLines(commandValues.tickets),
    links: parseEventLinks(modalValues.linksText)
  };

  validateEvent(nextEvent, getEffectiveMasterArtists(repoRoot, draftStore, userId));

  let updatedEvents;
  if (resolved) {
    nextEvent.id = resolved.event.id;
    updatedEvents = workingEvents.map((eventObject) => (eventObject.id === resolved.event.id ? nextEvent : eventObject));
  } else {
    nextEvent.id = generateEventId(nextEvent.title, nextEvent.date);
    updatedEvents = workingEvents.concat(nextEvent);
  }

  updatedEvents.sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
  const savedDraft = persistEventsDraft(draftStore, userId, updatedEvents, originalEvents);

  const pendingSummary = buildPendingSummary(draftStore.getUserDrafts(userId));
  return {
    event: nextEvent,
    changeType: resolved ? 'updated' : 'added',
    pendingSummary,
    savedAt: savedDraft ? savedDraft.savedAt : null
  };
}

function deleteEventDraft(options) {
  const {
    repoRoot,
    draftStore,
    userId,
    eventQuery
  } = options;

  const { originalDocument, workingDocument } = getWorkingEventsState(repoRoot, draftStore, userId);
  const originalEvents = getEventsList(originalDocument);
  const workingEvents = getEventsList(workingDocument).slice();
  const resolved = findEvent(workingEvents, eventQuery);

  if (!resolved) {
    throw new Error(`Event not found: ${eventQuery}`);
  }

  const [removedEvent] = workingEvents.splice(resolved.index, 1);
  workingEvents.sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
  const savedDraft = persistEventsDraft(draftStore, userId, workingEvents, originalEvents);

  return {
    event: removedEvent,
    pendingSummary: buildPendingSummary(draftStore.getUserDrafts(userId)),
    savedAt: savedDraft ? savedDraft.savedAt : null
  };
}

module.exports = {
  createOrUpdateEventDraft,
  deleteEventDraft,
  findEvent,
  formatEventLinksForInput,
  getWorkingEventsState,
  parseArtistsInput,
  parseTicketLines
};