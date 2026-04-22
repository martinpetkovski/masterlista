'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

class ModalContextStore {
  constructor(options) {
    this.ttlMs = options && options.ttlMs ? options.ttlMs : 15 * 60 * 1000;
    this.storePath = options && options.storePath ? options.storePath : null;
    this.contexts = this._loadContexts();

    const cleanupTimer = setInterval(() => this.cleanupExpired(), Math.max(30000, Math.floor(this.ttlMs / 2)));
    if (typeof cleanupTimer.unref === 'function') {
      cleanupTimer.unref();
    }
  }

  _ensureStoreDirectory() {
    if (!this.storePath) {
      return;
    }

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
  }

  _loadContexts() {
    if (!this.storePath) {
      return new Map();
    }

    this._ensureStoreDirectory();

    if (!fs.existsSync(this.storePath)) {
      return new Map();
    }

    try {
      const raw = fs.readFileSync(this.storePath, 'utf8').trim();
      if (!raw) {
        return new Map();
      }

      const parsed = JSON.parse(raw);
      const storedContexts = parsed && typeof parsed === 'object' && parsed.contexts && typeof parsed.contexts === 'object'
        ? parsed.contexts
        : {};
      const contexts = new Map();
      const cutoff = Date.now() - this.ttlMs;

      for (const [token, context] of Object.entries(storedContexts)) {
        if (!context || typeof context !== 'object') {
          continue;
        }
        if (typeof context.createdAt !== 'number' || context.createdAt < cutoff) {
          continue;
        }

        contexts.set(token, context);
      }

      return contexts;
    } catch (_) {
      return new Map();
    }
  }

  _persistContexts() {
    if (!this.storePath) {
      return;
    }

    this._ensureStoreDirectory();

    const serialized = {
      version: 1,
      contexts: Object.fromEntries(this.contexts.entries())
    };
    const tempPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(serialized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.storePath);
  }

  create(kind, payload) {
    const token = randomUUID().replace(/-/g, '').slice(0, 16);
    this.contexts.set(token, {
      kind,
      payload,
      createdAt: Date.now()
    });
    this._persistContexts();
    return token;
  }

  consume(token) {
    const context = this.contexts.get(token) || null;
    if (context) {
      this.contexts.delete(token);
      this._persistContexts();
    }

    if (!context) {
      return null;
    }

    if (Date.now() - context.createdAt > this.ttlMs) {
      return null;
    }

    return context;
  }

  cleanupExpired() {
    const cutoff = Date.now() - this.ttlMs;
    let changed = false;
    for (const [token, context] of this.contexts.entries()) {
      if (context.createdAt < cutoff) {
        this.contexts.delete(token);
        changed = true;
      }
    }

    if (changed) {
      this._persistContexts();
    }
  }
}

module.exports = {
  ModalContextStore
};