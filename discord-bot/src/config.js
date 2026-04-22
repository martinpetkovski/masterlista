'use strict';

const path = require('path');
const dotenv = require('dotenv');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');

dotenv.config({ path: path.resolve(PACKAGE_ROOT, '.env') });

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveStorePath(rawPath) {
  if (!rawPath) {
    return path.resolve(PACKAGE_ROOT, 'data', 'drafts.json');
  }

  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(PACKAGE_ROOT, rawPath);
}

function resolveRepoRoot(rawPath) {
  if (!rawPath) {
    return DEFAULT_REPO_ROOT;
  }

  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(PACKAGE_ROOT, rawPath);
}

function loadConfig() {
  return {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    applicationId: process.env.DISCORD_APPLICATION_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    allowedRoleIds: parseCsv(process.env.DISCORD_ALLOWED_ROLE_IDS),
    prEndpoint: (process.env.MMM_PR_ENDPOINT || 'https://muzichka-master-lista.deeeeelay.workers.dev').trim(),
    draftStorePath: resolveStorePath(process.env.DISCORD_DRAFT_STORE_PATH),
    repoRoot: resolveRepoRoot(process.env.MASTERLISTA_REPO_ROOT)
  };
}

function getMissingRequiredConfig(config) {
  const missing = [];

  if (!config.botToken) missing.push('DISCORD_BOT_TOKEN');
  if (!config.applicationId) missing.push('DISCORD_APPLICATION_ID');

  return missing;
}

module.exports = {
  loadConfig,
  getMissingRequiredConfig
};