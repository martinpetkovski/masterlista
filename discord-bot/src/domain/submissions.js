'use strict';

const { generateDescription } = require('./draft-summary');

async function submitPendingDrafts(options) {
  const {
    draftStore,
    endpoint,
    userId,
    contributor,
    description
  } = options;

  const drafts = draftStore.getUserDrafts(userId);
  const files = draftStore.buildSubmissionFiles(userId);
  if (!files.length) {
    throw new Error('No pending drafts to submit.');
  }

  const effectiveDescription = String(description || '').trim() || generateDescription(drafts, 'Proposed changes from Discord bot');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contributor: contributor || '',
      description: effectiveDescription,
      files
    })
  });

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_) {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload && payload.error
      ? `${payload.error}${payload.detail ? `: ${payload.detail}` : ''}`
      : (rawText || `Worker error (${response.status})`);
    const error = new Error(`Worker error (${response.status}): ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  draftStore.clearAll(userId);
  return payload || {};
}

module.exports = {
  submitPendingDrafts
};