'use strict';

const {
  ActionRowBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const { LOGICAL_FILE_PATHS, MISSING_DATA_TEXT } = require('../constants');
const {
  createOrUpdateArtistDraft,
  deleteArtistDraft,
  findArtist,
  formatArtistLinksForInput,
  getEffectiveBandsList,
  getWorkingBandsState
} = require('../domain/artists');
const { buildPendingSummary } = require('../domain/draft-summary');
const {
  createOrUpdateEventDraft,
  deleteEventDraft,
  findEvent,
  formatEventLinksForInput,
  getWorkingEventsState
} = require('../domain/events');
const {
  getAlternativeChart,
  getInterviews,
  getNewReleases,
  getNews,
  getRandomArtist,
  getRandomInterview,
  getRandomSong,
  getTopChart
} = require('../domain/discovery');
const { submitPendingDrafts } = require('../domain/submissions');
const { getBandsList, getEventsList } = require('../repo-data');
const { generateArtistSlug } = require('../utils/text');
const { ensureCanUseBot, memberHasAllowedRole } = require('./permissions');

const AUTOCOMPLETE_MAX_CHOICES = 25;
const AUTOCOMPLETE_CHOICE_NAME_MAX = 100;
const AUTOCOMPLETE_CHOICE_VALUE_MAX = 100;

function truncateForInput(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

function truncateForMessage(value, maxLength) {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function buildSafeMessage(lines) {
  return truncateForInput(lines.join('\n'), 1900);
}

function withOptionalValue(input, value, maxLength) {
  const normalized = truncateForInput(value, maxLength);
  if (normalized) {
    input.setValue(normalized);
  }
  return input;
}

function buildArtistCommandValues(interaction) {
  return {
    confirmed: interaction.options.getBoolean('verified') ?? interaction.options.getBoolean('confirmed'),
    accentOne: interaction.options.getString('accent_one'),
    accentTwo: interaction.options.getString('accent_two')
  };
}

function buildEventCommandValues(interaction) {
  return {
    artists: interaction.options.getString('artists'),
    tickets: interaction.options.getString('tickets')
  };
}

function getContributorLabel(interaction) {
  if (interaction.member && interaction.member.displayName) {
    return `${interaction.member.displayName} (@${interaction.user.username})`;
  }

  return interaction.user.globalName
    ? `${interaction.user.globalName} (@${interaction.user.username})`
    : interaction.user.username;
}

function buildDraftSummaryMessage(summary) {
  if (!summary.totalChanges) {
    return 'You have no pending drafts.';
  }

  const lines = [`Pending drafts: ${summary.totalChanges} change(s).`];
  for (const detail of summary.details) {
    const label = detail.filePath === LOGICAL_FILE_PATHS.BANDS
      ? 'Artists'
      : detail.filePath === LOGICAL_FILE_PATHS.EVENTS
        ? 'Events'
        : detail.filePath;
    lines.push(``);
    lines.push(`${label}: ${detail.changeCount} change(s)`);
    for (const line of detail.lines.slice(0, 6)) {
      lines.push(`- ${line}`);
    }
    if (detail.lines.length > 6) {
      lines.push(`- ... and ${detail.lines.length - 6} more`);
    }
  }

  return lines.join('\n');
}

function compareAutocompleteText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'en', { sensitivity: 'base' });
}

function buildAutocompleteChoices(items, query, toSearchText, toChoice) {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  return items
    .filter(Boolean)
    .filter((item) => {
      const text = String(toSearchText(item) || '').toLowerCase();
      return !normalizedQuery || text.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftText = String(toSearchText(left) || '').toLowerCase();
      const rightText = String(toSearchText(right) || '').toLowerCase();
      const leftStarts = normalizedQuery && leftText.startsWith(normalizedQuery);
      const rightStarts = normalizedQuery && rightText.startsWith(normalizedQuery);

      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }

      return compareAutocompleteText(toSearchText(left), toSearchText(right));
    })
    .map((item) => toChoice(item))
    .filter((choice) => choice && choice.name && choice.value)
    .slice(0, AUTOCOMPLETE_MAX_CHOICES);
}

function buildArtistLookupChoices(repoRoot, draftStore, userId, query) {
  return buildAutocompleteChoices(
    getEffectiveBandsList(repoRoot, draftStore, userId),
    query,
    (artist) => artist.name,
    (artist) => {
      const artistName = String(artist.name || '').trim();
      const value = artistName.length <= AUTOCOMPLETE_CHOICE_VALUE_MAX
        ? artistName
        : generateArtistSlug(artistName);

      return {
        name: truncateForInput(artistName, AUTOCOMPLETE_CHOICE_NAME_MAX),
        value
      };
    }
  );
}

function buildEventLookupChoices(repoRoot, draftStore, userId, query) {
  const state = getWorkingEventsState(repoRoot, draftStore, userId);

  return buildAutocompleteChoices(
    getEventsList(state.workingDocument),
    query,
    (eventObject) => `${eventObject.title || ''} ${eventObject.date || ''} ${eventObject.id || ''}`,
    (eventObject) => ({
      name: truncateForInput(
        eventObject.date
          ? `${eventObject.title} (${eventObject.date})`
          : eventObject.title,
        AUTOCOMPLETE_CHOICE_NAME_MAX
      ),
      value: truncateForInput(eventObject.id || eventObject.title, AUTOCOMPLETE_CHOICE_VALUE_MAX)
    })
  );
}

function buildArtistListChoices(repoRoot, draftStore, userId, rawValue) {
  const artistNames = getEffectiveBandsList(repoRoot, draftStore, userId)
    .map((artist) => String(artist.name || '').trim())
    .filter(Boolean)
    .sort(compareAutocompleteText);

  const segments = String(rawValue || '').split(',');
  const activeSegment = segments.pop() || '';
  const selected = segments.map((segment) => segment.trim()).filter(Boolean);
  const selectedSet = new Set(selected.map((value) => value.toLowerCase()));
  const prefix = selected.length ? `${selected.join(', ')}, ` : '';

  return artistNames
    .filter((name) => !selectedSet.has(name.toLowerCase()))
    .filter((name) => !activeSegment.trim() || name.toLowerCase().includes(activeSegment.trim().toLowerCase()))
    .map((name) => ({
      name: truncateForInput(name, AUTOCOMPLETE_CHOICE_NAME_MAX),
      value: `${prefix}${name}`
    }))
    .filter((choice) => choice.value.length <= AUTOCOMPLETE_CHOICE_VALUE_MAX)
    .slice(0, AUTOCOMPLETE_MAX_CHOICES);
}

function buildArtistModal(title, artist) {
  return new ModalBuilder()
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('artist-name')
          .setLabel('Artist name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120), artist && artist.name, 120)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('artist-city')
          .setLabel('City')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120), artist && artist.city !== 'недостигаат податоци' ? artist.city : '', 120)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('artist-genre')
          .setLabel('Genres')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(300), artist && artist.genre !== 'недостигаат податоци' ? artist.genre : '', 300)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('artist-contact')
          .setLabel('Contact')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120), artist && artist.contact !== MISSING_DATA_TEXT ? artist.contact : '', 120)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('artist-links')
          .setLabel('Links (one URL per line)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000), formatArtistLinksForInput(artist && artist.links), 4000)
      )
    );
}

function buildEventModal(title, eventObject) {
  return new ModalBuilder()
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('event-title')
          .setLabel('Event name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(160), eventObject && eventObject.title, 160)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('event-date')
          .setLabel('Date (YYYY-MM-DD)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setPlaceholder('2026-04-22'), eventObject && eventObject.date, 10)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('event-time')
          .setLabel('Time (HH:MM)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
          .setPlaceholder('20:00'), eventObject && eventObject.time, 5)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('event-place')
          .setLabel('Place')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(160), eventObject && eventObject.place, 160)
      ),
      new ActionRowBuilder().addComponents(
        withOptionalValue(new TextInputBuilder()
          .setCustomId('event-links')
          .setLabel('Links (one URL per line)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000), formatEventLinksForInput(eventObject && eventObject.links), 4000)
      )
    );
}

async function handleArtistCommand(interaction, deps) {
  const subcommand = interaction.options.getSubcommand();
  const { repoRoot, draftStore, modalContextStore } = deps;

  if (subcommand === 'delete') {
    const artistQuery = interaction.options.getString('artist', true);
    const result = deleteArtistDraft({
      repoRoot,
      draftStore,
      userId: interaction.user.id,
      artistQuery
    });

    await interaction.reply({
      content: `${result.artist.name} deleted from your drafts.\n\n${buildDraftSummaryMessage(result.pendingSummary)}`,
      ephemeral: true
    });
    return;
  }

  const state = getWorkingBandsState(repoRoot, draftStore, interaction.user.id);
  const workingBands = getBandsList(state.workingDocument);
  const existingArtistQuery = subcommand === 'edit' ? interaction.options.getString('artist', true) : null;
  const resolved = existingArtistQuery ? findArtist(workingBands, existingArtistQuery) : null;

  if (existingArtistQuery && !resolved) {
    await interaction.reply({ content: `Artist not found: ${existingArtistQuery}`, ephemeral: true });
    return;
  }

  const token = modalContextStore.create('artist', {
    userId: interaction.user.id,
    existingArtistQuery,
    commandValues: buildArtistCommandValues(interaction)
  });

  const modal = buildArtistModal(subcommand === 'edit' ? 'Edit Artist Draft' : 'New Artist Draft', resolved ? resolved.artist : null)
    .setCustomId(`artist:${token}`);

  await interaction.showModal(modal);
}

async function handleEventCommand(interaction, deps) {
  const subcommand = interaction.options.getSubcommand();
  const { repoRoot, draftStore, modalContextStore } = deps;

  if (subcommand === 'delete') {
    const eventQuery = interaction.options.getString('event', true);
    const result = deleteEventDraft({
      repoRoot,
      draftStore,
      userId: interaction.user.id,
      eventQuery
    });

    await interaction.reply({
      content: `${result.event.title} deleted from your drafts.\n\n${buildDraftSummaryMessage(result.pendingSummary)}`,
      ephemeral: true
    });
    return;
  }

  const state = getWorkingEventsState(repoRoot, draftStore, interaction.user.id);
  const workingEvents = getEventsList(state.workingDocument);
  const existingEventQuery = subcommand === 'edit' ? interaction.options.getString('event', true) : null;
  const resolved = existingEventQuery ? findEvent(workingEvents, existingEventQuery) : null;

  if (existingEventQuery && !resolved) {
    await interaction.reply({ content: `Event not found: ${existingEventQuery}`, ephemeral: true });
    return;
  }

  const token = modalContextStore.create('event', {
    userId: interaction.user.id,
    existingEventQuery,
    commandValues: buildEventCommandValues(interaction)
  });

  const modal = buildEventModal(subcommand === 'edit' ? 'Edit Event Draft' : 'New Event Draft', resolved ? resolved.event : null)
    .setCustomId(`event:${token}`);

  await interaction.showModal(modal);
}

async function handleDraftsCommand(interaction, deps) {
  const summary = buildPendingSummary(deps.draftStore.getUserDrafts(interaction.user.id));
  await interaction.reply({
    content: buildDraftSummaryMessage(summary),
    ephemeral: true
  });
}

async function handleSubmitCommand(interaction, deps) {
  const description = interaction.options.getString('description');
  const result = await submitPendingDrafts({
    draftStore: deps.draftStore,
    endpoint: deps.prEndpoint,
    userId: interaction.user.id,
    contributor: getContributorLabel(interaction),
    description
  });

  const lines = ['Drafts submitted successfully.'];
  if (result.pr_number) {
    lines.push(`PR #${result.pr_number}: ${result.pr_url}`);
  } else if (result.pr_url) {
    lines.push(`PR: ${result.pr_url}`);
  }

  if (Array.isArray(result.files) && result.files.length) {
    lines.push('');
    lines.push('Files:');
    for (const filePath of result.files) {
      lines.push(`- ${filePath}`);
    }
  }

  if (Array.isArray(result.skippedFiles) && result.skippedFiles.length) {
    lines.push('');
    lines.push('Skipped:');
    for (const file of result.skippedFiles) {
      lines.push(`- ${file.path}`);
    }
  }

  await interaction.reply({
    content: buildSafeMessage(lines),
    ephemeral: true
  });
}

async function handleHelpCommand(interaction) {
  const lines = [
    'toplista.mk bot quick guide',
    '',
    'If this is your first time, use these 3 steps:',
    '1. Add or edit artists/events with /artist and /event.',
    '2. Check your changes with /drafts.',
    '3. Send everything with /submit.',
    '',
    'Artist basics:',
    '- Use /artist add to add a new artist.',
    '- Use /artist edit to update an existing artist.',
    '- Use /artist delete to remove an artist from your pending changes.',
    '- Required fields: name, city, genre.',
    '',
    'Event basics:',
    '- Use /event add to add a new event.',
    '- Use /event edit to update an event.',
    '- Use /event delete to remove an event from your pending changes.',
    '- Required fields: event name, date (YYYY-MM-DD), time (HH:MM).',
    '',
    'Useful tips:',
    '- In links fields, add one URL per line.',
    '- Use clear in override fields to remove artists or tickets.',
    '- Autocomplete includes items from your pending draft changes.',
    '',
    'Discover mode:',
    '- Use /discover for random songs/artists, charts, releases, news, and interviews.',
    '',
    'About submit:',
    '- /submit [description] sends your current pending changes.',
    '- After successful submit, your pending draft list is cleared.'
  ];

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true
  });
}

function limitCount(rawCount, fallback) {
  const parsed = Number(rawCount);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(10, parsed));
}

function formatChartLine(entry, index) {
  const title = entry.releaseTitle || 'Unknown title';
  const artist = entry.bandName || 'Unknown artist';
  const url = entry.releaseUrl || null;
  return `${index + 1}. ${artist} - ${title}${url ? `\n${url}` : ''}`;
}

async function handleDiscoverCommand(interaction, deps) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'random_song') {
    const song = getRandomSong(deps.repoRoot);
    if (!song) {
      await interaction.reply({ content: 'No songs available right now.', ephemeral: true });
      return;
    }

    const lines = [
      'Random song pick',
      `${song.artist} - ${song.title}`
    ];
    if (song.releaseTitle && song.releaseTitle !== song.title) {
      lines.push(`Release: ${song.releaseTitle}`);
    }
    if (song.releaseDate) {
      lines.push(`Date: ${song.releaseDate}`);
    }
    if (song.url) {
      lines.push(song.url);
    }

    await interaction.reply({ content: buildSafeMessage(lines), ephemeral: true });
    return;
  }

  if (subcommand === 'random_artist') {
    const artist = getRandomArtist(deps.repoRoot);
    if (!artist) {
      await interaction.reply({ content: 'No artists available right now.', ephemeral: true });
      return;
    }

    const lines = [
      'Random artist pick',
      artist.name
    ];
    if (artist.city) lines.push(`City: ${artist.city}`);
    if (artist.genre) lines.push(`Genre: ${artist.genre}`);
    if (artist.link) lines.push(artist.link);

    await interaction.reply({ content: buildSafeMessage(lines), ephemeral: true });
    return;
  }

  if (subcommand === 'top_chart') {
    const count = limitCount(interaction.options.getInteger('count'), 5);
    const result = getTopChart(deps.repoRoot, count);
    if (!result.entries.length) {
      await interaction.reply({ content: 'Top chart is not available right now.', ephemeral: true });
      return;
    }

    const lines = [`Top chart${result.weekId ? ` (${result.weekId})` : ''}`];
    result.entries.forEach((entry, index) => lines.push(formatChartLine(entry, index)));
    await interaction.reply({ content: buildSafeMessage(lines.join('\n\n').split('\n')), ephemeral: true });
    return;
  }

  if (subcommand === 'alternative_chart') {
    const count = limitCount(interaction.options.getInteger('count'), 5);
    const result = getAlternativeChart(deps.repoRoot, count);
    if (!result.entries.length) {
      await interaction.reply({ content: 'Alternative chart is not available right now.', ephemeral: true });
      return;
    }

    const lines = [`Alternative chart${result.weekId ? ` (${result.weekId})` : ''}`];
    result.entries.forEach((entry, index) => lines.push(formatChartLine(entry, index)));
    await interaction.reply({ content: buildSafeMessage(lines.join('\n\n').split('\n')), ephemeral: true });
    return;
  }

  if (subcommand === 'new_releases') {
    const count = limitCount(interaction.options.getInteger('count'), 5);
    const releases = getNewReleases(deps.repoRoot, count);
    if (!releases.length) {
      await interaction.reply({ content: 'No recent releases available right now.', ephemeral: true });
      return;
    }

    const lines = ['New releases'];
    releases.forEach((release, index) => {
      const artist = truncateForMessage(release.bandName || 'Unknown artist', 80);
      const title = truncateForMessage(release.releaseTitle || 'Unknown title', 120);
      const date = release.effectiveReleaseDate || release.releaseDate || 'Unknown date';
      const url = release.releaseUrl || '';
      lines.push(`${index + 1}. ${artist} - ${title} (${date})${url ? `\n${url}` : ''}`);
    });

    await interaction.reply({ content: buildSafeMessage(lines.join('\n\n').split('\n')), ephemeral: true });
    return;
  }

  if (subcommand === 'news') {
    const count = limitCount(interaction.options.getInteger('count'), 5);
    const newsItems = getNews(deps.repoRoot, count);
    if (!newsItems.length) {
      await interaction.reply({ content: 'No news available right now.', ephemeral: true });
      return;
    }

    const lines = ['Latest music news'];
    newsItems.forEach((item, index) => {
      const date = item.date || 'Unknown date';
      const source = item.source || 'Unknown source';
      const title = truncateForMessage(item.title || 'Untitled', 140);
      const shortSource = truncateForMessage(source, 40);
      lines.push(`${index + 1}. ${title} (${date}, ${shortSource})\n${item.link || ''}`);
    });

    await interaction.reply({ content: buildSafeMessage(lines.join('\n\n').split('\n')), ephemeral: true });
    return;
  }

  if (subcommand === 'interviews') {
    const count = limitCount(interaction.options.getInteger('count'), 5);
    const items = getInterviews(deps.repoRoot, count);
    if (!items.length) {
      await interaction.reply({ content: 'No interviews available right now.', ephemeral: true });
      return;
    }

    const lines = ['Latest interviews'];
    items.forEach((item, index) => {
      const date = item.date || 'Unknown date';
      const source = item.source || 'Unknown source';
      const title = truncateForMessage(item.title || 'Untitled', 140);
      const shortSource = truncateForMessage(source, 40);
      lines.push(`${index + 1}. ${title} (${date}, ${shortSource})\n${item.link || ''}`);
    });

    await interaction.reply({ content: buildSafeMessage(lines.join('\n\n').split('\n')), ephemeral: true });
    return;
  }

  if (subcommand === 'random_interview') {
    const item = getRandomInterview(deps.repoRoot);
    if (!item) {
      await interaction.reply({ content: 'No interviews available right now.', ephemeral: true });
      return;
    }

    const lines = [
      'Random interview pick',
      truncateForMessage(item.title || 'Untitled', 160),
      `${item.date || 'Unknown date'}${item.source ? `, ${item.source}` : ''}`,
      item.link || ''
    ];

    await interaction.reply({ content: buildSafeMessage(lines), ephemeral: true });
    return;
  }

  await interaction.reply({ content: `Unsupported discover subcommand: ${subcommand}`, ephemeral: true });
}

function getModalValue(interaction, customId) {
  return interaction.fields.getTextInputValue(customId);
}

async function handleArtistModal(interaction, deps, token) {
  const context = deps.modalContextStore.consume(token);
  if (!context || context.kind !== 'artist' || context.payload.userId !== interaction.user.id) {
    await interaction.reply({ content: 'This artist modal expired. Re-run the command and try again.', ephemeral: true });
    return;
  }

  const result = createOrUpdateArtistDraft({
    repoRoot: deps.repoRoot,
    draftStore: deps.draftStore,
    userId: interaction.user.id,
    existingArtistQuery: context.payload.existingArtistQuery,
    commandValues: context.payload.commandValues,
    modalValues: {
      name: getModalValue(interaction, 'artist-name'),
      city: getModalValue(interaction, 'artist-city'),
      genre: getModalValue(interaction, 'artist-genre'),
      contact: getModalValue(interaction, 'artist-contact'),
      linksText: getModalValue(interaction, 'artist-links')
    }
  });

  await interaction.reply({
    content: `${result.artist.name} ${result.changeType === 'added' ? 'added' : 'updated'} in your drafts.\n\n${buildDraftSummaryMessage(result.pendingSummary)}`,
    ephemeral: true
  });
}

async function handleEventModal(interaction, deps, token) {
  const context = deps.modalContextStore.consume(token);
  if (!context || context.kind !== 'event' || context.payload.userId !== interaction.user.id) {
    await interaction.reply({ content: 'This event modal expired. Re-run the command and try again.', ephemeral: true });
    return;
  }

  const result = createOrUpdateEventDraft({
    repoRoot: deps.repoRoot,
    draftStore: deps.draftStore,
    userId: interaction.user.id,
    existingEventQuery: context.payload.existingEventQuery,
    commandValues: context.payload.commandValues,
    modalValues: {
      title: getModalValue(interaction, 'event-title'),
      date: getModalValue(interaction, 'event-date'),
      time: getModalValue(interaction, 'event-time'),
      place: getModalValue(interaction, 'event-place'),
      linksText: getModalValue(interaction, 'event-links')
    }
  });

  await interaction.reply({
    content: `${result.event.title} ${result.changeType === 'added' ? 'added' : 'updated'} in your drafts.\n\n${buildDraftSummaryMessage(result.pendingSummary)}`,
    ephemeral: true
  });
}

async function handleChatInputCommand(interaction, deps) {
  if (!await ensureCanUseBot(interaction, deps.allowedRoleIds)) {
    return;
  }

  const rawCommandName = String(interaction.commandName || '');
  const commandName = rawCommandName
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u00A0\u2000-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .toLowerCase();

  if (commandName === 'help' || commandName.startsWith('help')) {
    await handleHelpCommand(interaction);
    return;
  }

  if (commandName === 'discover' || commandName.startsWith('discover')) {
    await handleDiscoverCommand(interaction, deps);
    return;
  }

  switch (commandName) {
    case 'artist':
      await handleArtistCommand(interaction, deps);
      return;
    case 'event':
      await handleEventCommand(interaction, deps);
      return;
    case 'drafts':
      await handleDraftsCommand(interaction, deps);
      return;
    case 'submit':
      await handleSubmitCommand(interaction, deps);
      return;
    case 'discover':
      await handleDiscoverCommand(interaction, deps);
      return;
    default:
      await interaction.reply({ content: `Unsupported command: ${interaction.commandName}`, ephemeral: true });
  }
}

async function handleModalSubmit(interaction, deps) {
  if (!await ensureCanUseBot(interaction, deps.allowedRoleIds)) {
    return;
  }

  const [kind, token] = String(interaction.customId || '').split(':');
  if (!token) {
    await interaction.reply({ content: 'Unknown modal submission.', ephemeral: true });
    return;
  }

  if (kind === 'artist') {
    await handleArtistModal(interaction, deps, token);
    return;
  }

  if (kind === 'event') {
    await handleEventModal(interaction, deps, token);
    return;
  }

  await interaction.reply({ content: 'Unsupported modal submission.', ephemeral: true });
}

async function handleAutocomplete(interaction, deps) {
  if (!memberHasAllowedRole(interaction, deps.allowedRoleIds)) {
    await interaction.respond([]).catch(() => {});
    return;
  }

  const focused = interaction.options.getFocused(true);
  const subcommand = interaction.options.getSubcommand(false);
  let choices = [];

  if (interaction.commandName === 'artist' && focused.name === 'artist' && (subcommand === 'edit' || subcommand === 'delete')) {
    choices = buildArtistLookupChoices(deps.repoRoot, deps.draftStore, interaction.user.id, focused.value);
  } else if (interaction.commandName === 'event' && focused.name === 'event' && (subcommand === 'edit' || subcommand === 'delete')) {
    choices = buildEventLookupChoices(deps.repoRoot, deps.draftStore, interaction.user.id, focused.value);
  } else if (interaction.commandName === 'event' && focused.name === 'artists' && (subcommand === 'add' || subcommand === 'edit')) {
    choices = buildArtistListChoices(deps.repoRoot, deps.draftStore, interaction.user.id, focused.value);
  }

  await interaction.respond(choices).catch(() => {});
}

function registerInteractionHandlers(client, deps) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, deps);
        return;
      }

      if (interaction.isChatInputCommand()) {
        await handleChatInputCommand(interaction, deps);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction, deps);
      }
    } catch (error) {
      console.error('Discord interaction failed:', error);

      const message = error && error.message
        ? error.message
        : 'An unexpected error occurred while handling the command.';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  });
}

module.exports = {
  registerInteractionHandlers
};