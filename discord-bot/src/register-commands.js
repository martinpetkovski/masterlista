'use strict';

const { REST, Routes } = require('discord.js');

const { loadConfig, getMissingRequiredConfig } = require('./config');
const { buildCommandDefinitions } = require('./discord/command-definitions');

async function main() {
  const config = loadConfig();
  const missing = getMissingRequiredConfig(config);

  if (missing.length) {
    console.error('Missing required Discord bot configuration:', missing.join(', '));
    process.exitCode = 1;
    return;
  }

  const commands = buildCommandDefinitions().map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.botToken);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: commands });
    await rest.put(Routes.applicationCommands(config.applicationId), { body: [] });
    console.log(`Registered ${commands.length} Discord command(s) for guild ${config.guildId} and cleared stale global commands.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.applicationId), { body: commands });
  console.log(`Registered ${commands.length} global Discord command(s).`);
}

main().catch((error) => {
  console.error('Command registration failed:', error);
  process.exitCode = 1;
});