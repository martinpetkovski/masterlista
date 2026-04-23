'use strict';

function memberHasAllowedRole(interaction, allowedRoleIds) {
  if (!allowedRoleIds || !allowedRoleIds.length) {
    return true;
  }

  if (!interaction.inGuild()) {
    return false;
  }

  const roleCache = interaction.member && interaction.member.roles && interaction.member.roles.cache;
  if (roleCache && typeof roleCache.has === 'function') {
    return allowedRoleIds.some((roleId) => roleCache.has(roleId));
  }

  const roleIds = interaction.member && interaction.member.roles;
  if (Array.isArray(roleIds)) {
    return allowedRoleIds.some((roleId) => roleIds.includes(roleId));
  }

  return false;
}

async function ensureCanUseBot(interaction, allowedRoleIds) {
  if (memberHasAllowedRole(interaction, allowedRoleIds)) {
    return true;
  }

  const message = allowedRoleIds && allowedRoleIds.length
    ? 'You do not have permission to use the toplista.mk bot commands.'
    : 'This command is not available here.';

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: message, ephemeral: true });
  }

  return false;
}

module.exports = {
  ensureCanUseBot,
  memberHasAllowedRole
};