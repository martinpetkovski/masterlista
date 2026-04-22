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
    content: lines.join('\n'),
    ephemeral: true
  });
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

  switch (interaction.commandName) {
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