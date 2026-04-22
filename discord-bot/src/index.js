'use strict';

const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const { loadConfig, getMissingRequiredConfig } = require('./config');
const { registerInteractionHandlers } = require('./discord/handlers');
const { ModalContextStore } = require('./discord/modal-context-store');
const { DraftStore } = require('./store/draft-store');

async function main() {
  const config = loadConfig();
  const missing = getMissingRequiredConfig(config);

  if (missing.length) {
    console.error('Missing required Discord bot configuration:', missing.join(', '));
    process.exitCode = 1;
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });
  const draftStore = new DraftStore({ storePath: config.draftStorePath });
  const modalContextStore = new ModalContextStore({
    ttlMs: 15 * 60 * 1000,
    storePath: path.join(path.dirname(config.draftStorePath), 'modal-contexts.json')
  });

  registerInteractionHandlers(client, {
    allowedRoleIds: config.allowedRoleIds,
    draftStore,
    modalContextStore,
    prEndpoint: config.prEndpoint,
    repoRoot: config.repoRoot
  });

  client.once('ready', () => {
    console.log(`Discord bot ready as ${client.user.tag}`);
  });

  await client.login(config.botToken);
}

main().catch((error) => {
  console.error('Discord bot failed to start:', error);
  process.exitCode = 1;
});