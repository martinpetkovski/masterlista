'use strict';

const fs = require('fs');
const path = require('path');

const {
  FILE_BRANCH_MAP,
  LOGICAL_FILE_PATHS,
  normalizeDraftPath,
  resolveRepoPath
} = require('../constants');
const { deepClone } = require('../utils/text');

class DraftStore {
  constructor(options) {
    this.storePath = options.storePath;
    this._ensureStoreDirectory();
  }

  _createEmptyStore() {
    return {
      version: 1,
      users: {}
    };
  }

  _ensureStoreDirectory() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
  }

  _readStore() {
    this._ensureStoreDirectory();

    if (!fs.existsSync(this.storePath)) {
      return this._createEmptyStore();
    }

    const raw = fs.readFileSync(this.storePath, 'utf8').trim();
    if (!raw) {
      return this._createEmptyStore();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return this._createEmptyStore();
    }

    return {
      version: parsed.version || 1,
      users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {}
    };
  }

  _writeStore(store) {
    this._ensureStoreDirectory();

    const tempPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.storePath);
  }

  _getUserBucket(store, userId, createIfMissing) {
    if (!userId) {
      throw new Error('A Discord user id is required for draft operations.');
    }

    if (!store.users[userId] && createIfMissing) {
      store.users[userId] = { drafts: {} };
    }

    return store.users[userId] || null;
  }

  getUserDrafts(userId) {
    const store = this._readStore();
    const userBucket = this._getUserBucket(store, userId, false);
    return deepClone(userBucket ? userBucket.drafts || {} : {});
  }

  getDraft(userId, filePath) {
    const drafts = this.getUserDrafts(userId);
    return drafts[normalizeDraftPath(filePath)] || null;
  }

  load(userId, filePath) {
    const draft = this.getDraft(userId, filePath);
    return draft ? draft.data : null;
  }

  getMeta(userId, filePath) {
    return this.getDraft(userId, filePath);
  }

  save(userId, filePath, data, original) {
    const logicalPath = normalizeDraftPath(filePath);
    const store = this._readStore();
    const userBucket = this._getUserBucket(store, userId, true);
    const previous = userBucket.drafts[logicalPath] || null;
    const nextDraft = {
      data: deepClone(data),
      savedAt: new Date().toISOString(),
      additionalFiles: Array.isArray(previous && previous.additionalFiles) ? previous.additionalFiles : []
    };

    if (original !== undefined) {
      nextDraft.original = deepClone(original);
    } else if (previous && previous.original !== undefined) {
      nextDraft.original = previous.original;
    }

    userBucket.drafts[logicalPath] = nextDraft;
    this._writeStore(store);

    return deepClone(nextDraft);
  }

  clear(userId, filePath) {
    const logicalPath = normalizeDraftPath(filePath);
    const store = this._readStore();
    const userBucket = this._getUserBucket(store, userId, false);
    if (!userBucket) {
      return;
    }

    delete userBucket.drafts[logicalPath];
    if (!Object.keys(userBucket.drafts).length) {
      delete store.users[userId];
    }

    this._writeStore(store);
  }

  clearAll(userId) {
    const store = this._readStore();
    if (store.users[userId]) {
      delete store.users[userId];
      this._writeStore(store);
    }
  }

  getPendingFiles(userId) {
    return Object.keys(this.getUserDrafts(userId));
  }

  hasPending(userId) {
    return this.getPendingFiles(userId).length > 0;
  }

  saveAdditionalFile(userId, draftPath, filePath, contentBase64) {
    const logicalPath = normalizeDraftPath(draftPath);
    const store = this._readStore();
    const userBucket = this._getUserBucket(store, userId, false);
    const draft = userBucket && userBucket.drafts[logicalPath];

    if (!draft) {
      throw new Error(`Cannot attach ${filePath} without a pending ${logicalPath} draft.`);
    }

    draft.additionalFiles = Array.isArray(draft.additionalFiles) ? draft.additionalFiles : [];
    draft.additionalFiles = draft.additionalFiles.filter((entry) => entry.path !== filePath);
    draft.additionalFiles.push({ path: filePath, content: contentBase64 });
    draft.savedAt = new Date().toISOString();

    this._writeStore(store);
  }

  getAdditionalFiles(userId, draftPath) {
    const draft = this.getDraft(userId, draftPath);
    return Array.isArray(draft && draft.additionalFiles) ? draft.additionalFiles : [];
  }

  clearAdditionalFiles(userId, draftPath) {
    const logicalPath = normalizeDraftPath(draftPath);
    const store = this._readStore();
    const userBucket = this._getUserBucket(store, userId, false);
    const draft = userBucket && userBucket.drafts[logicalPath];

    if (!draft) {
      return;
    }

    draft.additionalFiles = [];
    draft.savedAt = new Date().toISOString();
    this._writeStore(store);
  }

  buildSubmissionFiles(userId) {
    const drafts = this.getUserDrafts(userId);
    const files = [];

    for (const [logicalPath, draft] of Object.entries(drafts)) {
      if (!draft || typeof draft !== 'object' || typeof draft.data === 'undefined') {
        continue;
      }

      const fileRequest = {
        bandsJson: JSON.stringify(draft.data, null, 2),
        originalJson: draft.original ? JSON.stringify(draft.original, null, 2) : null,
        path: resolveRepoPath(logicalPath)
      };

      if (FILE_BRANCH_MAP[logicalPath]) {
        fileRequest.baseBranch = FILE_BRANCH_MAP[logicalPath];
      }

      const additionalFiles = Array.isArray(draft.additionalFiles) ? draft.additionalFiles : [];
      if (additionalFiles.length) {
        fileRequest.additionalFiles = additionalFiles.map((entry) => ({
          path: entry.path,
          contentBase64: entry.content
        }));
      }

      files.push(fileRequest);
    }

    const requestedBases = Array.from(new Set(files.map((file) => file.baseBranch || null).filter(Boolean)));
    if (requestedBases.length > 1) {
      throw new Error('Pending changes target multiple base branches and cannot be submitted in one PR.');
    }

    return files;
  }
}

module.exports = {
  DraftStore
};