'use strict';

const { SlashCommandBuilder } = require('discord.js');

function addArtistOverrideOptions(subcommand) {
  return subcommand
    .addBooleanOption((option) => option.setName('verified').setDescription('Verified artist flag'))
    .addStringOption((option) => option.setName('accent_one').setDescription('Primary accent hex color, for example #e94560').setMaxLength(7))
    .addStringOption((option) => option.setName('accent_two').setDescription('Secondary accent hex color, for example #ffa502').setMaxLength(7));
}

function addArtistLookupOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('artist')
    .setDescription('Artist name')
    .setRequired(true)
    .setMaxLength(120)
    .setAutocomplete(true));
}

function addEventLookupOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('event')
    .setDescription('Event name')
    .setRequired(true)
    .setMaxLength(160)
    .setAutocomplete(true));
}

function buildCommandDefinitions() {
  const artistCommand = new SlashCommandBuilder()
    .setName('artist')
    .setDescription('Create, edit, or delete pending artist drafts')
    .addSubcommand((subcommand) => addArtistOverrideOptions(
      subcommand
        .setName('add')
        .setDescription('Open a modal for a new artist draft')
    ))
    .addSubcommand((subcommand) => addArtistOverrideOptions(
      addArtistLookupOption(subcommand
        .setName('edit')
        .setDescription('Open a modal for an existing artist draft'))
    ))
    .addSubcommand((subcommand) => addArtistLookupOption(
      subcommand
        .setName('delete')
        .setDescription('Delete an artist from your pending drafts')
    ));

  const eventCommand = new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create, edit, or delete pending event drafts')
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Open a modal for a new event draft')
      .addStringOption((option) => option
        .setName('artists')
        .setDescription('Optional comma-separated artists for the event')
        .setMaxLength(1000)
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName('tickets')
        .setDescription('Optional ticket lines: label|price, one per line or ; separated')
        .setMaxLength(1000)))
    .addSubcommand((subcommand) => addEventLookupOption(subcommand
      .setName('edit')
      .setDescription('Open a modal for an existing event draft'))
      .addStringOption((option) => option
        .setName('artists')
        .setDescription('Optional artists override; use clear to remove all artists')
        .setMaxLength(1000)
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName('tickets')
        .setDescription('Optional ticket override; use clear to remove all tickets')
        .setMaxLength(1000)))
    .addSubcommand((subcommand) => addEventLookupOption(subcommand
      .setName('delete')
      .setDescription('Delete an event from your pending drafts')));

  const draftsCommand = new SlashCommandBuilder()
    .setName('drafts')
    .setDescription('Show your pending MMM drafts');

  const submitCommand = new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit your pending MMM drafts to the PR worker')
    .addStringOption((option) => option
      .setName('description')
      .setDescription('Optional PR description; defaults to an auto-generated summary')
      .setMaxLength(2000));

  return [artistCommand, eventCommand, draftsCommand, submitCommand];
}

module.exports = {
  buildCommandDefinitions
};