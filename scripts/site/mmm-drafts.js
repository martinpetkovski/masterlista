/**
 * MMM Unified Draft System
 * 
 * Provides a consistent localStorage-based draft layer for all editable 
 * data across the site (bands.json, events.json, etc.).
 * 
 * Usage:
 *   MMMDrafts.save('events.json', { events: [...] });
 *   MMMDrafts.load('events.json');  // → { events: [...] } or null
 *   MMMDrafts.clear('events.json');
 *   MMMDrafts.hasPending();         // → true/false
 *   MMMDrafts.initUI(endpoint);     // creates the floating submit bar
 */
window.MMMDrafts = (function () {
    'use strict';

    var STORAGE_KEY = 'mmm-pending-drafts';
    var PR_ENDPOINT_KEY = 'mmm_pr_endpoint';
    var DEFAULT_ENDPOINT = 'https://muzichka-master-lista.deeeeelay.workers.dev';

    // Per-file target branch overrides (defaults to worker's GITHUB_DEFAULT_BRANCH / 'master')
    var FILE_BRANCH_MAP = {
        'releases.json': 'youtube-chart-tracking'
    };
    var REPO_PATH_MAP = {
        'bands.json': 'data/dynamic/editable/bands.json',
        'events.json': 'data/dynamic/editable/events.json',
        'releases.json': 'data/dynamic/editable/releases.json'
    };
    var DRAFT_PATH_ALIASES = {
        'data/dynamic/editable/bands.json': 'bands.json',
        'data/dynamic/editable/events.json': 'events.json',
        'data/dynamic/editable/releases.json': 'releases.json'
    };

    function _normalizeDraftPath(filePath) {
        return DRAFT_PATH_ALIASES[filePath] || filePath;
    }

    function _resolveRepoPath(filePath) {
        var normalized = _normalizeDraftPath(filePath);
        return REPO_PATH_MAP[normalized] || normalized;
    }

    function _normalizeStoredDrafts(obj) {
        var normalized = {};
        Object.keys(obj || {}).forEach(function(key) {
            normalized[_normalizeDraftPath(key)] = obj[key];
        });
        return normalized;
    }

    // ── Storage helpers ──────────────────────────────────────────

    function _readAll() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return _normalizeStoredDrafts(parsed);
            }
        } catch (_) {}
        return {};
    }

    function _writeAll(obj) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        } catch (e) {
            console.warn('MMMDrafts: localStorage write failed', e);
        }
    }

    /** Save a draft for a specific file path (e.g. 'events.json').
     *  @param {string} filePath - e.g. 'bands.json'
     *  @param {object} data - the modified data
     *  @param {object} [original] - the original (server) data for diff generation
     */
    function save(filePath, data, original) {
        filePath = _normalizeDraftPath(filePath);
        var all = _readAll();
        var prevOriginal = all[filePath] ? all[filePath].original : undefined;
        all[filePath] = {
            data: data,
            savedAt: new Date().toISOString()
        };
        // Store original if provided; otherwise preserve any previously stored original
        if (original !== undefined) {
            all[filePath].original = original;
        } else if (prevOriginal !== undefined) {
            all[filePath].original = prevOriginal;
        }
        _writeAll(all);
        _refreshUI();
    }

    /** Load a draft. Returns the data object or null. */
    function load(filePath) {
        filePath = _normalizeDraftPath(filePath);
        var all = _readAll();
        var entry = all[filePath];
        return entry ? entry.data : null;
    }

    /** Clear a single draft. */
    function clear(filePath) {
        filePath = _normalizeDraftPath(filePath);
        var all = _readAll();
        delete all[filePath];
        _writeAll(all);
        _refreshUI();
    }

    /** Clear all drafts. */
    function clearAll() {
        localStorage.removeItem(STORAGE_KEY);
        clearAdditionalFiles();
        _refreshUI();
    }

    /** List of file paths with pending drafts. */
    function getPendingFiles() {
        return Object.keys(_readAll());
    }

    /** Whether any drafts are pending. */
    function hasPending() {
        return getPendingFiles().length > 0;
    }

    /** Get draft metadata (savedAt) for a file. */
    function getMeta(filePath) {
        filePath = _normalizeDraftPath(filePath);
        var all = _readAll();
        return all[filePath] || null;
    }

    // ── Additional files (e.g. greeting audio) ──────────────────
    var ADDITIONAL_FILES_KEY = 'mmm-pending-additional-files';

    function _readAdditionalFiles() {
        try {
            var raw = localStorage.getItem(ADDITIONAL_FILES_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return _normalizeStoredDrafts(parsed);
            }
        } catch (_) {}
        return {};
    }

    function _writeAdditionalFiles(obj) {
        try {
            localStorage.setItem(ADDITIONAL_FILES_KEY, JSON.stringify(obj));
        } catch (e) {
            console.warn('Failed to save additional files:', e);
        }
    }

    /**
     * Save an additional file to be submitted alongside a draft.
     * @param {string} draftPath - the draft file this is associated with (e.g. 'bands.json')
     * @param {string} filePath - target path in the repo (e.g. 'greetings/slug.webm')
     * @param {string} contentBase64 - base64-encoded file content
     */
    function saveAdditionalFile(draftPath, filePath, contentBase64) {
        draftPath = _normalizeDraftPath(draftPath);
        var all = _readAdditionalFiles();
        if (!all[draftPath]) all[draftPath] = [];
        // Replace if same path already pending
        all[draftPath] = all[draftPath].filter(function (f) { return f.path !== filePath; });
        all[draftPath].push({ path: filePath, content: contentBase64 });
        _writeAdditionalFiles(all);
    }

    /**
     * Remove a pending additional file.
     */
    function removeAdditionalFile(draftPath, filePath) {
        draftPath = _normalizeDraftPath(draftPath);
        var all = _readAdditionalFiles();
        if (!all[draftPath]) return;
        all[draftPath] = all[draftPath].filter(function (f) { return f.path !== filePath; });
        if (all[draftPath].length === 0) delete all[draftPath];
        _writeAdditionalFiles(all);
    }

    /**
     * Get all additional files for a draft.
     */
    function getAdditionalFiles(draftPath) {
        draftPath = _normalizeDraftPath(draftPath);
        var all = _readAdditionalFiles();
        return all[draftPath] || [];
    }

    /**
     * Clear all additional files for a draft (or all).
     */
    function clearAdditionalFiles(draftPath) {
        if (draftPath) {
            draftPath = _normalizeDraftPath(draftPath);
            var all = _readAdditionalFiles();
            delete all[draftPath];
            _writeAdditionalFiles(all);
        } else {
            localStorage.removeItem(ADDITIONAL_FILES_KEY);
        }
    }

    // ── Legacy migration ─────────────────────────────────────────
    // Migrate old 'mmm-pending-changes' (bands-only) into the new format
    function _migrateLegacy() {
        try {
            var legacy = localStorage.getItem('mmm-pending-changes');
            if (!legacy) return;
            var parsed = JSON.parse(legacy);
            if (parsed && parsed.bandsData && Array.isArray(parsed.bandsData)) {
                var all = _readAll();
                if (!all['bands.json']) {
                    all['bands.json'] = {
                        data: { muzickaMasterLista: parsed.bandsData.map(function (b) {
                            return {
                                name: b.name, city: b.city, genre: b.genre,
                                soundsLike: b.soundsLike, links: b.links,
                                contact: b.contact, label: b.label,
                                accentColors: b.accentColors || null,
                                confirmed: b.confirmed || false
                            };
                        }) },
                        savedAt: parsed.savedAt || new Date().toISOString()
                    };
                    _writeAll(all);
                }
                localStorage.removeItem('mmm-pending-changes');
            }
        } catch (_) {}
    }

    // ── Auto-generate change description ─────────────────────────

    function _generateDescription() {
        var all = _readAll();
        var files = Object.keys(all);
        var lines = [];

        files.forEach(function (filePath) {
            var entry = all[filePath];
            var data = entry.data;
            var original = entry.original;
            if (!original && !(data && data._isDiff)) {
                // No original stored — just note which files changed
                var label = filePath === 'bands.json' ? t('drafts.masterList') : filePath === 'events.json' ? t('drafts.events') : filePath;
                lines.push('• ' + label + ': ' + t('drafts.changes'));
                return;
            }

            if (filePath === 'bands.json') {
                lines.push.apply(lines, _diffBands(original, data));
            } else if (filePath === 'events.json') {
                lines.push.apply(lines, _diffEvents(original, data));
            } else if (filePath === 'releases.json') {
                lines.push.apply(lines, _diffReleases(original, data));
            } else {
                lines.push('• ' + filePath + ': ' + t('drafts.changes'));
            }
        });

        return lines.length ? lines.join('\n') : '';
    }

    function _diffBands(original, modified) {
        var origList = (original && original.muzickaMasterLista) || [];
        var modList = (modified && modified.muzickaMasterLista) || [];
        var origMap = {}; origList.forEach(function (b) { origMap[b.name] = b; });
        var modMap = {}; modList.forEach(function (b) { modMap[b.name] = b; });

        var added = [], removed = [], changed = [];

        modList.forEach(function (b) {
            if (!origMap[b.name]) { added.push(b.name); return; }
            var o = origMap[b.name];
            var fields = _getBandChangedFields(b, o);
            if (fields.length) changed.push(b.name + ' [' + fields.join(', ') + ']');
        });
        origList.forEach(function (b) { if (!modMap[b.name]) removed.push(b.name); });

        var lines = [];
        if (added.length) lines.push(t('drafts.addedArtists') + ' (' + added.length + '): ' + added.join(', '));
        if (removed.length) lines.push(t('drafts.removedArtists') + ' (' + removed.length + '): ' + removed.join(', '));
        if (changed.length) lines.push(t('drafts.editedArtists') + ' (' + changed.length + '): ' + changed.join('; '));
        return lines;
    }

    function _getEventLinks(eventObj) {
        if (eventObj && Array.isArray(eventObj.links)) return eventObj.links;
        if (eventObj && eventObj.link) return [{ label: '', url: eventObj.link }];
        return [];
    }

    var MISSING_TEXT_VALUE = 'недостигаат податоци';
    var CONTROLLED_ARTIST_LABELS = ['Ново Издание', '★', 'Ново'];

    function _stableSortValue(value) {
        if (Array.isArray(value)) return value.map(_stableSortValue);
        if (value && typeof value === 'object') {
            var sorted = {};
            Object.keys(value).sort().forEach(function(key) {
                sorted[key] = _stableSortValue(value[key]);
            });
            return sorted;
        }
        return value === undefined ? null : value;
    }

    function _stableStringify(value) {
        return JSON.stringify(_stableSortValue(value));
    }

    function _normalizeMissingText(value) {
        var text = String(value || '').trim();
        return text || MISSING_TEXT_VALUE;
    }

    function _normalizeOptionalText(value) {
        var text = String(value || '').trim();
        return (!text || text === MISSING_TEXT_VALUE) ? null : text;
    }

    function _normalizeArtistLabel(value) {
        var text = _normalizeOptionalText(value);
        if (!text) return null;
        var labels = text.split(',').map(function(label) { return label.trim(); }).filter(Boolean).filter(function(label) {
            return CONTROLLED_ARTIST_LABELS.indexOf(label) === -1;
        });
        return labels.length ? labels.join(', ') : null;
    }

    function _normalizeArtistLinks(links) {
        if (!links || typeof links !== 'object' || links.none === MISSING_TEXT_VALUE || !Object.keys(links).length) {
            return { none: MISSING_TEXT_VALUE };
        }
        var normalized = {};
        Object.keys(links).sort().forEach(function(platform) {
            var value = links[platform];
            if (Array.isArray(value)) {
                var urls = value.map(function(url) { return String(url || '').trim(); }).filter(function(url) { return url && url !== MISSING_TEXT_VALUE; });
                if (urls.length) normalized[platform] = urls;
            } else {
                var url = String(value || '').trim();
                if (url && url !== MISSING_TEXT_VALUE) normalized[platform] = url;
            }
        });
        return Object.keys(normalized).length ? normalized : { none: MISSING_TEXT_VALUE };
    }

    function _normalizeAccentColors(value) {
        if (!Array.isArray(value)) return null;
        var first = value[0] || null;
        var second = value[1] || null;
        return (first || second) ? [first, second] : null;
    }

    function _getBandChangedFields(b, o) {
        var fields = [];
        if (_normalizeMissingText(b.city) !== _normalizeMissingText(o.city)) fields.push(t('drafts.fieldCity'));
        if (_normalizeMissingText(b.genre) !== _normalizeMissingText(o.genre)) fields.push(t('drafts.fieldGenre'));
        if (_normalizeMissingText(b.soundsLike) !== _normalizeMissingText(o.soundsLike)) fields.push(t('drafts.fieldSoundsLike'));
        if (_normalizeMissingText(b.contact) !== _normalizeMissingText(o.contact)) fields.push(t('drafts.fieldContact'));
        if (_normalizeArtistLabel(b.label) !== _normalizeArtistLabel(o.label)) fields.push(t('drafts.fieldLabel'));
        if (!!b.confirmed !== !!o.confirmed) fields.push(t('drafts.fieldConfirmed'));
        if (_stableStringify(_normalizeArtistLinks(b.links)) !== _stableStringify(_normalizeArtistLinks(o.links))) fields.push(t('drafts.fieldLinks'));
        if (_stableStringify(_normalizeAccentColors(b.accentColors)) !== _stableStringify(_normalizeAccentColors(o.accentColors))) fields.push(t('drafts.fieldColors'));
        return fields;
    }

    function _normalizeEventArtists(eventObj) {
        return ((eventObj && (eventObj.artists || eventObj.bands)) || []).map(function(name) { return String(name || '').trim(); }).filter(Boolean);
    }

    function _normalizeEventTickets(eventObj) {
        return ((eventObj && eventObj.tickets) || []).map(function(ticket) {
            return { label: String((ticket && ticket.label) || '').trim(), price: String((ticket && ticket.price) || '').trim() };
        }).filter(function(ticket) { return ticket.label || ticket.price; });
    }

    function _normalizeEventLinks(eventObj) {
        return _getEventLinks(eventObj).map(function(link) {
            return { label: String((link && link.label) || '').trim(), url: String((link && link.url) || '').trim() };
        }).filter(function(link) { return link.url; });
    }

    function _getEventChangedFields(e, o) {
        var fields = [];
        if (String(e.title || '').trim() !== String(o.title || '').trim()) fields.push(t('drafts.fieldTitle'));
        if (String(e.date || '').trim() !== String(o.date || '').trim()) fields.push(t('drafts.fieldDate'));
        if (String(e.time || '').trim() !== String(o.time || '').trim()) fields.push(t('drafts.fieldTime'));
        if (String(e.place || '').trim() !== String(o.place || '').trim()) fields.push(t('drafts.fieldPlace'));
        if (_stableStringify(_normalizeEventLinks(e)) !== _stableStringify(_normalizeEventLinks(o))) fields.push(t('drafts.fieldLinks'));
        if (_stableStringify(_normalizeEventArtists(e)) !== _stableStringify(_normalizeEventArtists(o))) fields.push(t('drafts.fieldArtists'));
        if (_stableStringify(_normalizeEventTickets(e)) !== _stableStringify(_normalizeEventTickets(o))) fields.push(t('drafts.fieldTickets'));
        return fields;
    }

    function _diffEvents(original, modified) {
        var origList = (original && original.events) || [];
        var modList = (modified && modified.events) || [];
        var origMap = {}; origList.forEach(function (e) { origMap[e.id] = e; });
        var modMap = {}; modList.forEach(function (e) { modMap[e.id] = e; });

        var added = [], removed = [], changed = [];

        modList.forEach(function (e) {
            if (!origMap[e.id]) { added.push(e.title + ' (' + e.date + ')'); return; }
            var o = origMap[e.id];
            var fields = _getEventChangedFields(e, o);
            if (fields.length) changed.push(e.title + ' [' + fields.join(', ') + ']');
        });
        origList.forEach(function (e) { if (!modMap[e.id]) removed.push(e.title); });

        var lines = [];
        if (added.length) lines.push(t('drafts.newEvents') + ' (' + added.length + '): ' + added.join(', '));
        if (removed.length) lines.push(t('drafts.removedEvents') + ' (' + removed.length + '): ' + removed.join(', '));
        if (changed.length) lines.push(t('drafts.editedEvents') + ' (' + changed.length + '): ' + changed.join('; '));
        return lines;
    }

    function _diffReleasesPair(origRelease, modRelease) {
        var origYt = (origRelease && origRelease.youtubeTracks) || [];
        var modYt = (modRelease && modRelease.youtubeTracks) || [];
        var origVidMap = {}; origYt.forEach(function (t) { origVidMap[t.videoId] = t; });
        var modVidMap = {}; modYt.forEach(function (t) { modVidMap[t.videoId] = t; });
        var v = 0, a = 0, rem = 0, changes = [];
        modYt.forEach(function (t) {
            if (!origVidMap[t.videoId]) { a++; changes.push('+YT'); }
            else if (t.verified === 'verified' && origVidMap[t.videoId].verified !== 'verified') { v++; changes.push('✓'); }
        });
        origYt.forEach(function (t) {
            if (!modVidMap[t.videoId]) { rem++; changes.push('-YT'); }
        });
        // Detect metadata changes
        if (origRelease) {
            if (modRelease.bandName !== origRelease.bandName) changes.push('артист');
            if (modRelease.releaseTitle !== origRelease.releaseTitle) changes.push('наслов');
            if (modRelease.releaseType !== origRelease.releaseType) changes.push('тип');
            if (JSON.stringify(modRelease.trackNames || []) !== JSON.stringify(origRelease.trackNames || [])) changes.push('песни');
        }
        return { verified: v, added: a, removed: rem, changes: changes };
    }

    function _diffReleases(original, modified) {
        var changedReleases = [];
        var verified = 0, added = 0, removed = 0;

        if (modified && modified._isDiff) {
            // Compact diff format
            (modified.added || []).forEach(function (r) {
                added++;
                changedReleases.push(r.bandName + ' — ' + r.releaseTitle + ' [+ново]');
            });
            var changedIds = Object.keys(modified.changed || {});
            changedIds.forEach(function (rid) {
                var r = modified.changed[rid];
                var o = (modified.originals || {})[rid];
                var d = _diffReleasesPair(o, r);
                verified += d.verified; added += d.added; removed += d.removed;
                if (d.changes.length) {
                    changedReleases.push(r.bandName + ' — ' + r.releaseTitle + ' [' + d.changes.join(', ') + ']');
                }
            });
        } else {
            var origList = (original && original.releases) || [];
            var modList = (modified && modified.releases) || [];
            var origMap = {}; origList.forEach(function (r) { origMap[r.releaseId] = r; });

            modList.forEach(function (r) {
                var o = origMap[r.releaseId];
                if (!o) {
                    added++;
                    changedReleases.push(r.bandName + ' — ' + r.releaseTitle + ' [+ново]');
                    return;
                }
                var d = _diffReleasesPair(o, r);
                verified += d.verified; added += d.added; removed += d.removed;
                if (d.changes.length) {
                    changedReleases.push(r.bandName + ' — ' + r.releaseTitle + ' [' + d.changes.join(', ') + ']');
                }
            });
        }

        var lines = [];
        var summary = [];
        if (verified) summary.push(verified + ' верификувани');
        if (added) summary.push(added + ' додадени');
        if (removed) summary.push(removed + ' отстранети');
        if (summary.length) lines.push('YouTube линкови (' + summary.join(', ') + ')');
        if (changedReleases.length <= 5) {
            changedReleases.forEach(function (c) { lines.push('  • ' + c); });
        } else {
            changedReleases.slice(0, 3).forEach(function (c) { lines.push('  • ' + c); });
            lines.push('  ... и ' + (changedReleases.length - 3) + ' други');
        }
        return lines;
    }

    // ── Submission ───────────────────────────────────────────────

    function _resolveEndpoint() {
        if (typeof window.MMM_PR_ENDPOINT === 'string' && window.MMM_PR_ENDPOINT.trim()) return window.MMM_PR_ENDPOINT.trim();
        var btn = document.querySelector('[data-endpoint]');
        if (btn) {
            var attr = btn.getAttribute('data-endpoint');
            if (attr && attr.trim()) return attr.trim();
        }
        var stored = localStorage.getItem(PR_ENDPOINT_KEY);
        if (stored && stored.trim()) return stored.trim();
        return DEFAULT_ENDPOINT;
    }

    function _trimEndpoint(endpoint) {
        return String(endpoint || '').replace(/\/+$/, '');
    }

    function _authText(key, fallback) {
        if (typeof t !== 'function') return fallback;
        var value = t(key);
        return value === key ? fallback : value;
    }

    async function _getGitHubSession() {
        if (!window.MMMAuth || typeof window.MMMAuth.getState !== 'function') return null;
        var authState = window.MMMAuth.getState();
        if (authState && authState.authenticated && authState.sessionId) return authState;
        if (authState && authState.sessionId && typeof window.MMMAuth.refresh === 'function') {
            try {
                authState = await window.MMMAuth.refresh();
                if (authState && authState.authenticated && authState.sessionId) return authState;
            } catch (_) {}
        }
        return null;
    }

    /**
     * Submit all pending drafts to the worker endpoint.
     * All pending files are submitted in a single POST when they share a base branch.
     * Returns a promise that resolves with the worker response.
     */
    async function submitAll(contributor, description) {
        var authState = await _getGitHubSession();
        var endpoint = _trimEndpoint(_resolveEndpoint()) + (authState ? '/submit/user' : '');
        var all = _readAll();
        var files = Object.keys(all);
        if (!files.length) throw new Error(t('drafts.noChangesNotif'));

        var submissionFiles = [];
        for (var i = 0; i < files.length; i++) {
            var filePath = files[i];
            var draft = all[filePath];
            var draftData = draft.data;
            var draftOriginal = draft.original;

            // For releases.json compact diff, reconstruct the full file
            if (filePath === 'releases.json' && draftData && draftData._isDiff) {
                var resp0 = await fetch('/releases.json?_=' + Date.now());
                var base = await resp0.json();
                draftOriginal = JSON.parse(JSON.stringify(base));
                // Apply changes on top of the base
                for (var k = 0; k < base.releases.length; k++) {
                    var rid = base.releases[k].releaseId;
                    if (draftData.changed[rid]) {
                        base.releases[k] = draftData.changed[rid];
                    }
                }
                // Prepend new releases
                if (draftData.added && draftData.added.length) {
                    base.releases = draftData.added.concat(base.releases);
                    base.totalReleases = base.releases.length;
                }
                draftData = base;
            }

            var json = JSON.stringify(draftData, null, 2);
            var originalJson = draftOriginal ? JSON.stringify(draftOriginal, null, 2) : null;

            // Include any additional files (e.g. greeting audio)
            var extras = getAdditionalFiles(filePath);
            var fileRequest = {
                bandsJson: json,
                originalJson: originalJson,
                path: _resolveRepoPath(filePath)
            };
            if (FILE_BRANCH_MAP[filePath]) {
                fileRequest.baseBranch = FILE_BRANCH_MAP[filePath];
            }
            if (extras.length) {
                fileRequest.additionalFiles = extras.map(function (f) {
                    return { path: f.path, contentBase64: f.content };
                });
            }
            submissionFiles.push(fileRequest);
        }

        var requestedBases = Array.from(new Set(submissionFiles.map(function (file) {
            return file.baseBranch || null;
        }).filter(Boolean)));
        if (requestedBases.length > 1) {
            throw new Error('Pending changes target multiple base branches and cannot be submitted in one PR.');
        }

        var headers = { 'Content-Type': 'application/json' };
        if (authState) headers.Authorization = 'Bearer ' + authState.sessionId;

        var payload = {
            description: description || '',
            files: submissionFiles
        };
        if (!authState) payload.contributor = contributor || '';

        var resp = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            var text = await resp.text();
            throw new Error('Worker error (' + resp.status + '): ' + text);
        }

        var result = await resp.json();

        // Clear all drafts and additional files on success
        clearAll();
        return result;
    }

    // ── Floating Submit Bar UI ──────────────────────────────────

    var _barEl = null;
    var _badgeEl = null;

    function _createBar() {
        if (_barEl) return;

        _barEl = document.createElement('div');
        _barEl.id = 'mmm-draft-bar';
        _barEl.className = 'mmm-draft-bar';
        _barEl.innerHTML =
            '<div class="mmm-draft-bar-inner">' +
                '<div class="mmm-draft-bar-info">' +
                    '<i class="fas fa-pen-to-square"></i>' +
                    '<span class="mmm-draft-bar-text" data-i18n="drafts.unsavedChanges">' + t('drafts.unsavedChanges') + '</span>' +
                    '<span class="mmm-draft-badge" id="mmm-draft-badge">0</span>' +
                '</div>' +
                '<div class="mmm-draft-bar-actions">' +
                    '<button class="mmm-draft-btn discard" id="mmm-draft-discard" data-i18n-title="drafts.discardAllTitle" title="' + t('drafts.discardAllTitle') + '">' +
                        '<i class="fas fa-trash"></i> <span data-i18n="drafts.discard">' + t('drafts.discard') + '</span>' +
                    '</button>' +
                    '<button class="mmm-draft-btn submit" id="mmm-draft-submit" data-i18n-title="drafts.submitTitle" title="' + t('drafts.submitTitle') + '">' +
                        '<i class="fas fa-paper-plane"></i> <span data-i18n="drafts.submitChanges">' + t('drafts.submitChanges') + '</span>' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(_barEl);
        _badgeEl = document.getElementById('mmm-draft-badge');

        // Discard button
        document.getElementById('mmm-draft-discard').addEventListener('click', function () {
            _showConfirmDialog(
                t('drafts.discardChangesTitle'),
                t('drafts.discardConfirm'),
                function () {
                    clearAll();
                    // Let each page know drafts were discarded
                    window.dispatchEvent(new CustomEvent('mmm-drafts-discarded'));
                    _showNotification(t('drafts.discarded'), 'info');
                }
            );
        });

        // Submit button
        document.getElementById('mmm-draft-submit').addEventListener('click', function () {
            _showSubmitDialog();
        });
    }

    function _countIndividualChanges() {
        var all = _readAll();
        var files = Object.keys(all);
        var total = 0;

        files.forEach(function (filePath) {
            var entry = all[filePath];
            var data = entry.data;
            var original = entry.original;
            if (!original && !(data && data._isDiff)) {
                // No original stored — count as 1 change per file
                total += 1;
                return;
            }

            if (filePath === 'bands.json') {
                var origList = (original && original.muzickaMasterLista) || [];
                var modList = (data && data.muzickaMasterLista) || [];
                var origMap = {}; origList.forEach(function (b) { origMap[b.name] = b; });
                var modMap = {}; modList.forEach(function (b) { modMap[b.name] = b; });

                modList.forEach(function (b) {
                    if (!origMap[b.name]) { total++; return; }
                    var o = origMap[b.name];
                    if (_getBandChangedFields(b, o).length) {
                        total++;
                    }
                });
                origList.forEach(function (b) { if (!modMap[b.name]) total++; });
            } else if (filePath === 'events.json') {
                var origEvts = (original && original.events) || [];
                var modEvts = (data && data.events) || [];
                var origEvtMap = {}; origEvts.forEach(function (e) { origEvtMap[e.id] = e; });
                var modEvtMap = {}; modEvts.forEach(function (e) { modEvtMap[e.id] = e; });

                modEvts.forEach(function (e) {
                    if (!origEvtMap[e.id]) { total++; return; }
                    var o = origEvtMap[e.id];
                    if (_getEventChangedFields(e, o).length) {
                        total++;
                    }
                });
                origEvts.forEach(function (e) { if (!modEvtMap[e.id]) total++; });
            } else if (filePath === 'releases.json') {
                if (data && data._isDiff) {
                    // Compact diff format
                    total += (data.added ? data.added.length : 0) + Object.keys(data.changed || {}).length;
                } else {
                    var origRels = (original && original.releases) || [];
                    var modRels = (data && data.releases) || [];
                    var origRelMap = {}; origRels.forEach(function (r) { origRelMap[r.releaseId] = r; });

                    modRels.forEach(function (r) {
                        var o = origRelMap[r.releaseId];
                        if (!o) { total++; return; }
                        if (JSON.stringify(r) !== JSON.stringify(o)) {
                            total++;
                        }
                    });
                }
            } else {
                total += 1;
            }
        });

        return total;
    }

    /** Get list of HTML snippets describing changed items with links */
    function _getChangedItemNames() {
        var all = _readAll();
        var items = [];

        if (all['bands.json'] && all['bands.json'].original) {
            var origList = (all['bands.json'].original.muzickaMasterLista) || [];
            var modList = (all['bands.json'].data && all['bands.json'].data.muzickaMasterLista) || [];
            var origMap = {}; origList.forEach(function (b) { origMap[b.name] = b; });
            var modMap = {}; modList.forEach(function (b) { modMap[b.name] = b; });

            modList.forEach(function (b) {
                var link = '/artist.html?name=' + encodeURIComponent(b.name);
                if (!origMap[b.name]) {
                    items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">+ ' + _esc(b.name) + '</a>');
                } else {
                    var o = origMap[b.name];
                    if (_getBandChangedFields(b, o).length) {
                        items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">' + _esc(b.name) + '</a>');
                    }
                }
            });
            origList.forEach(function (b) {
                if (!modMap[b.name]) items.push('<s style="opacity:.6">' + _esc(b.name) + '</s>');
            });
        }

        if (all['events.json'] && all['events.json'].original) {
            var origEvts = (all['events.json'].original.events) || [];
            var modEvts = (all['events.json'].data && all['events.json'].data.events) || [];
            var origEvtMap = {}; origEvts.forEach(function (e) { origEvtMap[e.id] = e; });
            var modEvtMap = {}; modEvts.forEach(function (e) { modEvtMap[e.id] = e; });

            modEvts.forEach(function (e) {
                var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
                var link = isLocalhost ? '/nastan.html?id=' + encodeURIComponent(e.id) : '/nastan/' + encodeURIComponent(e.id);
                if (!origEvtMap[e.id]) {
                    items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">+ ' + _esc(e.title) + '</a>');
                } else {
                    var o = origEvtMap[e.id];
                    if (_getEventChangedFields(e, o).length) {
                        items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">' + _esc(e.title) + '</a>');
                    }
                }
            });
            origEvts.forEach(function (e) {
                if (!modEvtMap[e.id]) items.push('<s style="opacity:.6">' + _esc(e.title) + '</s>');
            });
        }

        if (all['releases.json']) {
            var relData = all['releases.json'].data;
            var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (relData && relData._isDiff) {
                // Compact diff format
                (relData.added || []).forEach(function (r) {
                    var link = isLocalhost ? '/artist.html?name=' + encodeURIComponent(r.bandName) : '/' + encodeURIComponent(r.bandName);
                    items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">+ ' + _esc(r.bandName) + ' – ' + _esc(r.releaseTitle) + '</a>');
                });
                var changedIds = Object.keys(relData.changed || {});
                changedIds.forEach(function (rid) {
                    var r = relData.changed[rid];
                    var link = isLocalhost ? '/artist.html?name=' + encodeURIComponent(r.bandName) : '/' + encodeURIComponent(r.bandName);
                    items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">' + _esc(r.bandName) + ' – ' + _esc(r.releaseTitle) + '</a>');
                });
            } else if (all['releases.json'].original) {
                var origRels = (all['releases.json'].original.releases) || [];
                var modRels = (relData && relData.releases) || [];
                var origRelMap = {}; origRels.forEach(function (r) { origRelMap[r.releaseId] = r; });

                modRels.forEach(function (r) {
                    var o = origRelMap[r.releaseId];
                    var link = isLocalhost ? '/artist.html?name=' + encodeURIComponent(r.bandName) : '/' + encodeURIComponent(r.bandName);
                    if (!o) {
                        items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">+ ' + _esc(r.bandName) + ' – ' + _esc(r.releaseTitle) + '</a>');
                        return;
                    }
                    if (JSON.stringify(r) !== JSON.stringify(o)) {
                        items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">' + _esc(r.bandName) + ' – ' + _esc(r.releaseTitle) + '</a>');
                    }
                });
            }
        }

        return items;
    }

    function _esc(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _refreshUI() {
        if (!_barEl) return;
        var files = getPendingFiles();
        var changeCount = _countIndividualChanges();
        if (changeCount > 0) {
            _barEl.classList.add('visible');
            document.body.style.paddingBottom = '4rem';
            _badgeEl.textContent = changeCount;

            // Build descriptive text with specific changed items
            var details = _getChangedItemNames();
            var textEl = _barEl.querySelector('.mmm-draft-bar-text');
            if (details.length > 0) {
                var maxShow = 3;
                var shown = details.slice(0, maxShow);
                var rest = details.length - maxShow;
                textEl.innerHTML = shown.join(', ') + (rest > 0 ? ' <span style="opacity:.7">+' + rest + ' ' + t('drafts.more') + '</span>' : '');
            } else {
                var labels = files.map(function (f) {
                    if (f === 'bands.json') return t('drafts.masterList');
                    if (f === 'events.json') return t('drafts.events');
                    if (f === 'releases.json') return 'Изданија';
                    return f;
                });
                textEl.textContent = t('drafts.unsavedLabel') + labels.join(', ');
            }
        } else {
            _barEl.classList.remove('visible');
            document.body.style.paddingBottom = '';
        }

        // Also update any legacy header button (lista.html's #submit-pr-btn)
        var legacyBtn = document.getElementById('submit-pr-btn');
        if (legacyBtn) {
            legacyBtn.disabled = !changeCount;
            legacyBtn.title = changeCount ? t('drafts.submitRequest') : t('drafts.noChanges');
            if (changeCount) legacyBtn.classList.add('has-changes');
            else legacyBtn.classList.remove('has-changes');
        }
    }

    // ── Submit Dialog ────────────────────────────────────────────

    function _showSubmitDialog() {
        var files = getPendingFiles();
        if (!files.length) {
            _showNotification(t('drafts.noChangesNotif'), 'info');
            return;
        }

        var authState = window.MMMAuth && typeof window.MMMAuth.getState === 'function' ? window.MMMAuth.getState() : null;
        var isSignedIn = !!(authState && authState.authenticated && authState.user);

        var fileLabels = files.map(function (f) {
            if (f === 'bands.json') return '<li><i class="fas fa-list"></i> ' + t('drafts.masterList') + '</li>';
            if (f === 'events.json') return '<li><i class="fas fa-calendar-days"></i> ' + t('drafts.events') + '</li>';
            if (f === 'releases.json') return '<li><i class="fas fa-music"></i> Изданија</li>';
            return '<li><i class="fas fa-file"></i> ' + f + '</li>';
        }).join('');

        var user = isSignedIn ? (authState.user || {}) : {};
        var userName = user.name || user.login || 'GitHub';
        var identityHtml = isSignedIn
            ? '<div class="mmm-draft-auth-user">' +
                (user.avatar_url ? '<img src="' + _esc(user.avatar_url) + '" alt="">' : '<i class="fab fa-github"></i>') +
                '<div><span>' + _authText('auth.signedInAs', 'Signed in as') + '</span><strong>' + _esc(userName) + (user.login ? ' (@' + _esc(user.login) + ')' : '') + '</strong></div>' +
            '</div>'
            : '<div class="mmm-draft-auth-user mmm-draft-auth-anon">' +
                '<i class="fab fa-github"></i>' +
                '<div><span>' + _authText('auth.optional', 'Optional') + '</span><strong>' + _authText('auth.submitAnonymous', 'Submit without signing in') + '</strong></div>' +
                '<button type="button" class="mmm-draft-auth-login" id="mmm-draft-login-btn">' + _authText('auth.signInGitHub', 'Sign in with GitHub') + '</button>' +
            '</div>';

        var contributorField = isSignedIn ? '' :
            '<div class="mmm-draft-field">' +
                '<label for="mmm-draft-contributor">' + t('drafts.contributorLabel') + '</label>' +
                '<input type="text" id="mmm-draft-contributor" placeholder="' + t('drafts.contributorPlaceholder') + '">' +
            '</div>';

        var overlay = document.createElement('div');
        overlay.className = 'mmm-draft-overlay';
        overlay.innerHTML =
            '<div class="mmm-draft-dialog">' +
                '<h2><i class="fas fa-paper-plane"></i> ' + t('drafts.submitDialogTitle') + '</h2>' +
                '<p class="mmm-draft-dialog-info">' + t('drafts.submitInfo') + '</p>' +
                '<ul class="mmm-draft-file-list">' + fileLabels + '</ul>' +
                identityHtml +
                '<form id="mmm-draft-submit-form">' +
                    contributorField +
                    '<div class="mmm-draft-field">' +
                        '<label for="mmm-draft-description">' + t('drafts.descLabel') + '</label>' +
                        '<textarea id="mmm-draft-description" placeholder="' + t('drafts.descPlaceholder') + '" rows="3" required></textarea>' +
                    '</div>' +
                    '<div class="mmm-draft-dialog-buttons">' +
                        '<button type="button" class="mmm-draft-btn discard" id="mmm-draft-dialog-cancel">' + t('drafts.cancel') + '</button>' +
                        '<button type="submit" class="mmm-draft-btn submit" id="mmm-draft-dialog-submit">' +
                            '<i class="fas fa-paper-plane"></i> ' + t('drafts.submit') +
                        '</button>' +
                    '</div>' +
                '</form>' +
            '</div>';

        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) { overlay.remove(); }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
        });

        // Cancel
        document.getElementById('mmm-draft-dialog-cancel').addEventListener('click', function () {
            overlay.remove();
        });

        var loginBtn = document.getElementById('mmm-draft-login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', function () {
                if (!window.MMMAuth || typeof window.MMMAuth.login !== 'function') {
                    _showNotification(_authText('auth.unavailable', 'GitHub login is not available yet. You can still submit changes without signing in.'), 'warning');
                    return;
                }
                loginBtn.disabled = true;
                window.MMMAuth.login().then(function (nextState) {
                    if (nextState && nextState.authenticated) {
                        overlay.remove();
                        _showSubmitDialog();
                    }
                }).catch(function (err) {
                    loginBtn.disabled = false;
                    _showNotification((err && err.message) || _authText('auth.loginFailed', 'GitHub sign-in failed.'), 'warning');
                });
            });
        }

        // Submit
        document.getElementById('mmm-draft-submit-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var contributorEl = document.getElementById('mmm-draft-contributor');
            var contributor = contributorEl ? contributorEl.value.trim() : '';
            var description = document.getElementById('mmm-draft-description').value.trim();
            if (!description) {
                _showNotification(t('drafts.descRequired'), 'error');
                document.getElementById('mmm-draft-description').focus();
                return;
            }

            var submitBtn = document.getElementById('mmm-draft-dialog-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + t('drafts.submitting');

            try {
                var results = await submitAll(contributor, description);

                // Show success state in the dialog before closing
                submitBtn.innerHTML = '<i class="fas fa-check"></i> ' + t('drafts.success');
                submitBtn.classList.add('mmm-btn-success');

                setTimeout(function () {
                    overlay.remove();
                }, 1200);

                _showNotification(t('drafts.submitSuccess'), 'success');
                window.dispatchEvent(new CustomEvent('mmm-drafts-submitted', { detail: results }));
            } catch (err) {
                console.error('Draft submit failed:', err);
                _showNotification(t('drafts.submitError') + (err.message || err), 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> ' + t('drafts.submit');
            }
        });

        // Auto-generate and pre-fill description
        setTimeout(function () {
            var descEl = document.getElementById('mmm-draft-description');
            var autoDesc = _generateDescription();
            if (autoDesc) {
                descEl.value = t('drafts.proposedChanges') + '\n\n' + autoDesc + '\n';
            }
            descEl.focus();
        }, 100);
    }

    // ── Confirm Dialog ───────────────────────────────────────────

    function _showConfirmDialog(title, message, onConfirm) {
        var overlay = document.createElement('div');
        overlay.className = 'mmm-draft-overlay';
        overlay.innerHTML =
            '<div class="mmm-draft-dialog mmm-draft-dialog-sm">' +
                '<h2>' + title + '</h2>' +
                '<p>' + message + '</p>' +
                '<div class="mmm-draft-dialog-buttons">' +
                    '<button class="mmm-draft-btn discard" id="mmm-confirm-cancel">' + t('drafts.cancel') + '</button>' +
                    '<button class="mmm-draft-btn submit mmm-btn-danger" id="mmm-confirm-ok">' + t('drafts.confirm') + '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        document.getElementById('mmm-confirm-cancel').addEventListener('click', function () { overlay.remove(); });
        document.getElementById('mmm-confirm-ok').addEventListener('click', function () {
            overlay.remove();
            if (onConfirm) onConfirm();
        });
    }

    // ── Notifications ────────────────────────────────────────────

    function _showNotification(msg, type) {
        type = type || 'info';

        // Try to use page-specific notification systems first
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type);
            return;
        }

        // Fallback: nastani-style notifications
        var container = document.getElementById('nastani-notifications');

        // Generic fallback: create our own container if none exists
        if (!container) {
            container = document.getElementById('mmm-notifications');
            if (!container) {
                container = document.createElement('div');
                container.id = 'mmm-notifications';
                container.className = 'notification-area';
                container.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:10001;max-width:340px;';
                document.body.appendChild(container);
            }
        }

        var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
        var el = document.createElement('div');
        el.className = 'notification ' + type;
        // match page notification styling
        if (container.id === 'nastani-notifications') {
            el.className = 'nastani-notification ' + type;
        }
        el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + msg;
        container.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 300);
        }, 4000);
    }

    // ── Init ─────────────────────────────────────────────────────

    /** Initialize the floating draft bar. Call once on page load. */
    function initUI() {
        _migrateLegacy();
        _createBar();
        _refreshUI();
    }

    // Auto-save drafts before page unload
    // (individual pages call save() on changes, this is a safety net)
    window.addEventListener('beforeunload', function () {
        // Nothing extra needed - each page calls save() in real-time
    });

    // Cross-tab / cross-page sync: when another tab writes to localStorage,
    // update the floating bar so changes made in the master list appear
    // on all other open pages without a manual refresh.
    window.addEventListener('storage', function (e) {
        if (e.key === STORAGE_KEY) {
            _refreshUI();
            // Let page-specific code react too (e.g. reload data)
            window.dispatchEvent(new CustomEvent('mmm-drafts-changed'));
        }
    });

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initUI(); });
    } else {
        // DOM already ready – defer to next tick to let page scripts load first
        setTimeout(initUI, 0);
    }

    // Public API
    return {
        save: save,
        load: load,
        clear: clear,
        clearAll: clearAll,
        getPendingFiles: getPendingFiles,
        hasPending: hasPending,
        getMeta: getMeta,
        submitAll: submitAll,
        notify: _showNotification,
        initUI: initUI,
        _refreshUI: _refreshUI,
        saveAdditionalFile: saveAdditionalFile,
        removeAdditionalFile: removeAdditionalFile,
        getAdditionalFiles: getAdditionalFiles,
        clearAdditionalFiles: clearAdditionalFiles
    };
})();
