'use strict';

const { LOGICAL_FILE_PATHS } = require('../constants');

function getEventLinks(eventObject) {
  if (eventObject && Array.isArray(eventObject.links)) return eventObject.links;
  if (eventObject && eventObject.link) return [{ label: '', url: eventObject.link }];
  return [];
}

function summarizeBandEntry(original, modified) {
  const originalList = (original && original.muzickaMasterLista) || [];
  const modifiedList = (modified && modified.muzickaMasterLista) || [];
  const originalMap = Object.fromEntries(originalList.map((artist) => [artist.name, artist]));
  const modifiedMap = Object.fromEntries(modifiedList.map((artist) => [artist.name, artist]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const artist of modifiedList) {
    const originalArtist = originalMap[artist.name];
    if (!originalArtist) {
      added.push(artist.name);
      continue;
    }

    const changedFields = [];
    if (artist.city !== originalArtist.city) changedFields.push('city');
    if (artist.genre !== originalArtist.genre) changedFields.push('genre');
    if (artist.soundsLike !== originalArtist.soundsLike) changedFields.push('sounds like');
    if (artist.contact !== originalArtist.contact) changedFields.push('contact');
    if (artist.label !== originalArtist.label) changedFields.push('label');
    if (artist.confirmed !== originalArtist.confirmed) changedFields.push('verified');
    if (JSON.stringify(artist.links) !== JSON.stringify(originalArtist.links)) changedFields.push('links');
    if (JSON.stringify(artist.accentColors) !== JSON.stringify(originalArtist.accentColors)) changedFields.push('colors');

    if (changedFields.length) {
      changed.push(`${artist.name} [${changedFields.join(', ')}]`);
    }
  }

  for (const artist of originalList) {
    if (!modifiedMap[artist.name]) {
      removed.push(artist.name);
    }
  }

  const lines = [];
  if (added.length) lines.push(`Added artists (${added.length}): ${added.join(', ')}`);
  if (removed.length) lines.push(`Removed artists (${removed.length}): ${removed.join(', ')}`);
  if (changed.length) lines.push(`Edited artists (${changed.length}): ${changed.join('; ')}`);

  return {
    changeCount: added.length + removed.length + changed.length,
    lines
  };
}

function summarizeEventEntry(original, modified) {
  const originalList = (original && original.events) || [];
  const modifiedList = (modified && modified.events) || [];
  const originalMap = Object.fromEntries(originalList.map((eventObject) => [eventObject.id, eventObject]));
  const modifiedMap = Object.fromEntries(modifiedList.map((eventObject) => [eventObject.id, eventObject]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const eventObject of modifiedList) {
    const originalEvent = originalMap[eventObject.id];
    if (!originalEvent) {
      added.push(`${eventObject.title} (${eventObject.date})`);
      continue;
    }

    const changedFields = [];
    if (eventObject.title !== originalEvent.title) changedFields.push('title');
    if (eventObject.date !== originalEvent.date) changedFields.push('date');
    if (eventObject.time !== originalEvent.time) changedFields.push('time');
    if (eventObject.place !== originalEvent.place) changedFields.push('place');
    if (JSON.stringify(getEventLinks(eventObject)) !== JSON.stringify(getEventLinks(originalEvent))) changedFields.push('links');
    if (JSON.stringify(eventObject.artists || eventObject.bands) !== JSON.stringify(originalEvent.artists || originalEvent.bands)) changedFields.push('artists');
    if (JSON.stringify(eventObject.tickets) !== JSON.stringify(originalEvent.tickets)) changedFields.push('tickets');

    if (changedFields.length) {
      changed.push(`${eventObject.title} [${changedFields.join(', ')}]`);
    }
  }

  for (const eventObject of originalList) {
    if (!modifiedMap[eventObject.id]) {
      removed.push(eventObject.title);
    }
  }

  const lines = [];
  if (added.length) lines.push(`New events (${added.length}): ${added.join(', ')}`);
  if (removed.length) lines.push(`Removed events (${removed.length}): ${removed.join(', ')}`);
  if (changed.length) lines.push(`Edited events (${changed.length}): ${changed.join('; ')}`);

  return {
    changeCount: added.length + removed.length + changed.length,
    lines
  };
}

function summarizeEntry(filePath, entry) {
  if (!entry) {
    return {
      changeCount: 0,
      lines: []
    };
  }

  if (!entry.original) {
    return {
      changeCount: 1,
      lines: [`${filePath}: changes pending`]
    };
  }

  if (filePath === LOGICAL_FILE_PATHS.BANDS) {
    return summarizeBandEntry(entry.original, entry.data);
  }

  if (filePath === LOGICAL_FILE_PATHS.EVENTS) {
    return summarizeEventEntry(entry.original, entry.data);
  }

  return {
    changeCount: 1,
    lines: [`${filePath}: changes pending`]
  };
}

function buildPendingSummary(drafts) {
  const details = [];
  let totalChanges = 0;

  for (const [filePath, entry] of Object.entries(drafts || {})) {
    const summary = summarizeEntry(filePath, entry);
    totalChanges += summary.changeCount;
    details.push({
      filePath,
      changeCount: summary.changeCount,
      lines: summary.lines
    });
  }

  return {
    totalChanges,
    details
  };
}

function generateDescription(drafts, heading) {
  const summary = buildPendingSummary(drafts);
  const lines = summary.details.flatMap((detail) => detail.lines);
  if (!lines.length) {
    return heading || '';
  }

  if (heading) {
    return `${heading}\n\n${lines.join('\n')}`;
  }

  return lines.join('\n');
}

module.exports = {
  buildPendingSummary,
  generateDescription
};