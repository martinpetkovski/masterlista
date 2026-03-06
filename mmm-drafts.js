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

    // ── Storage helpers ──────────────────────────────────────────

    function _readAll() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return {};
    }

    function _writeAll(obj) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        } catch (_) {}
    }

    /** Save a draft for a specific file path (e.g. 'events.json').
     *  @param {string} filePath - e.g. 'bands.json'
     *  @param {object} data - the modified data
     *  @param {object} [original] - the original (server) data for diff generation
     */
    function save(filePath, data, original) {
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
        var all = _readAll();
        var entry = all[filePath];
        return entry ? entry.data : null;
    }

    /** Clear a single draft. */
    function clear(filePath) {
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
                if (parsed && typeof parsed === 'object') return parsed;
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
        var all = _readAdditionalFiles();
        return all[draftPath] || [];
    }

    /**
     * Clear all additional files for a draft (or all).
     */
    function clearAdditionalFiles(draftPath) {
        if (draftPath) {
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
            if (!original) {
                // No original stored — just note which files changed
                var label = filePath === 'bands.json' ? 'Мастер Листа' : filePath === 'events.json' ? 'Настани' : filePath;
                lines.push('• ' + label + ': промени');
                return;
            }

            if (filePath === 'bands.json') {
                lines.push.apply(lines, _diffBands(original, data));
            } else if (filePath === 'events.json') {
                lines.push.apply(lines, _diffEvents(original, data));
            } else {
                lines.push('• ' + filePath + ': промени');
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
            var fields = [];
            if (b.city !== o.city) fields.push('град');
            if (b.genre !== o.genre) fields.push('жанр');
            if (b.soundsLike !== o.soundsLike) fields.push('звучи како');
            if (b.contact !== o.contact) fields.push('контакт');
            if (b.label !== o.label) fields.push('етикета');
            if (b.confirmed !== o.confirmed) fields.push('потврден');
            if (JSON.stringify(b.links) !== JSON.stringify(o.links)) fields.push('линкови');
            if (JSON.stringify(b.accentColors) !== JSON.stringify(o.accentColors)) fields.push('бои');
            if (fields.length) changed.push(b.name + ' [' + fields.join(', ') + ']');
        });
        origList.forEach(function (b) { if (!modMap[b.name]) removed.push(b.name); });

        var lines = [];
        if (added.length) lines.push('Додадени артисти (' + added.length + '): ' + added.join(', '));
        if (removed.length) lines.push('Избришани артисти (' + removed.length + '): ' + removed.join(', '));
        if (changed.length) lines.push('Изменети артисти (' + changed.length + '): ' + changed.join('; '));
        return lines;
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
            var fields = [];
            if (e.title !== o.title) fields.push('наслов');
            if (e.date !== o.date) fields.push('датум');
            if (e.time !== o.time) fields.push('време');
            if (e.place !== o.place) fields.push('место');
            if (e.link !== o.link) fields.push('линк');
            if (JSON.stringify(e.artists || e.bands) !== JSON.stringify(o.artists || o.bands)) fields.push('артисти');
            if (JSON.stringify(e.tickets) !== JSON.stringify(o.tickets)) fields.push('карти');
            if (fields.length) changed.push(e.title + ' [' + fields.join(', ') + ']');
        });
        origList.forEach(function (e) { if (!modMap[e.id]) removed.push(e.title); });

        var lines = [];
        if (added.length) lines.push('Нови настани (' + added.length + '): ' + added.join(', '));
        if (removed.length) lines.push('Избришани настани (' + removed.length + '): ' + removed.join(', '));
        if (changed.length) lines.push('Изменети настани (' + changed.length + '): ' + changed.join('; '));
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

    /**
     * Submit all pending drafts to the worker endpoint.
     * Each file becomes a separate POST.
     * Returns a promise that resolves with results array.
     */
    async function submitAll(contributor, description) {
        var endpoint = _resolveEndpoint();
        var all = _readAll();
        var files = Object.keys(all);
        if (!files.length) throw new Error('Нема промени за поднесување.');

        var results = [];
        for (var i = 0; i < files.length; i++) {
            var filePath = files[i];
            var draft = all[filePath];
            var json = JSON.stringify(draft.data, null, 2);
            var originalJson = draft.original ? JSON.stringify(draft.original, null, 2) : null;

            // Include any additional files (e.g. greeting audio)
            var extras = getAdditionalFiles(filePath);
            var bodyObj = {
                bandsJson: json,
                originalJson: originalJson,
                contributor: contributor || '',
                description: description || '',
                path: filePath
            };
            if (extras.length) {
                bodyObj.additionalFiles = extras.map(function (f) {
                    return { path: f.path, contentBase64: f.content };
                });
            }

            var resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyObj)
            });

            if (!resp.ok) {
                var text = await resp.text();
                throw new Error('Worker error (' + resp.status + ') for ' + filePath + ': ' + text);
            }

            var result = await resp.json();
            results.push({ file: filePath, result: result });
        }

        // Clear all drafts and additional files on success
        clearAll();
        return results;
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
                    '<span class="mmm-draft-bar-text">Имате незачувани промени</span>' +
                    '<span class="mmm-draft-badge" id="mmm-draft-badge">0</span>' +
                '</div>' +
                '<div class="mmm-draft-bar-actions">' +
                    '<button class="mmm-draft-btn discard" id="mmm-draft-discard" title="Отфрли ги сите промени">' +
                        '<i class="fas fa-trash"></i> Отфрли' +
                    '</button>' +
                    '<button class="mmm-draft-btn submit" id="mmm-draft-submit" title="Испрати ги промените">' +
                        '<i class="fas fa-paper-plane"></i> Испрати промени' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(_barEl);
        _badgeEl = document.getElementById('mmm-draft-badge');

        // Discard button
        document.getElementById('mmm-draft-discard').addEventListener('click', function () {
            _showConfirmDialog(
                'Отфрли промени',
                'Дали сте сигурни дека сакате да ги отфрлите сите незачувани промени?',
                function () {
                    clearAll();
                    // Let each page know drafts were discarded
                    window.dispatchEvent(new CustomEvent('mmm-drafts-discarded'));
                    _showNotification('Промените се отфрлени.', 'info');
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
            if (!original) {
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
                    if (b.city !== o.city || b.genre !== o.genre || b.soundsLike !== o.soundsLike ||
                        b.contact !== o.contact || b.label !== o.label || b.confirmed !== o.confirmed ||
                        JSON.stringify(b.links) !== JSON.stringify(o.links) ||
                        JSON.stringify(b.accentColors) !== JSON.stringify(o.accentColors)) {
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
                    if (e.title !== o.title || e.date !== o.date || e.time !== o.time ||
                        e.place !== o.place || e.link !== o.link ||
                        JSON.stringify(e.artists || e.bands) !== JSON.stringify(o.artists || o.bands) ||
                        JSON.stringify(e.tickets) !== JSON.stringify(o.tickets)) {
                        total++;
                    }
                });
                origEvts.forEach(function (e) { if (!modEvtMap[e.id]) total++; });
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
                    if (b.city !== o.city || b.genre !== o.genre || b.soundsLike !== o.soundsLike ||
                        b.contact !== o.contact || b.label !== o.label || b.confirmed !== o.confirmed ||
                        JSON.stringify(b.links) !== JSON.stringify(o.links) ||
                        JSON.stringify(b.accentColors) !== JSON.stringify(o.accentColors)) {
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
                    if (e.title !== o.title || e.date !== o.date || e.time !== o.time ||
                        e.place !== o.place || e.link !== o.link ||
                        JSON.stringify(e.artists || e.bands) !== JSON.stringify(o.artists || o.bands) ||
                        JSON.stringify(e.tickets) !== JSON.stringify(o.tickets)) {
                        items.push('<a href="' + link + '" style="color:inherit;text-decoration:underline">' + _esc(e.title) + '</a>');
                    }
                }
            });
            origEvts.forEach(function (e) {
                if (!modEvtMap[e.id]) items.push('<s style="opacity:.6">' + _esc(e.title) + '</s>');
            });
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
            _badgeEl.textContent = changeCount;

            // Build descriptive text with specific changed items
            var details = _getChangedItemNames();
            var textEl = _barEl.querySelector('.mmm-draft-bar-text');
            if (details.length > 0) {
                var maxShow = 3;
                var shown = details.slice(0, maxShow);
                var rest = details.length - maxShow;
                textEl.innerHTML = shown.join(', ') + (rest > 0 ? ' <span style="opacity:.7">+' + rest + ' уште</span>' : '');
            } else {
                var labels = files.map(function (f) {
                    if (f === 'bands.json') return 'Мастер Листа';
                    if (f === 'events.json') return 'Настани';
                    return f;
                });
                textEl.textContent = 'Незачувани промени: ' + labels.join(', ');
            }
        } else {
            _barEl.classList.remove('visible');
        }

        // Also update any legacy header button (lista.html's #submit-pr-btn)
        var legacyBtn = document.getElementById('submit-pr-btn');
        if (legacyBtn) {
            legacyBtn.disabled = !changeCount;
            legacyBtn.title = changeCount ? 'Испрати барање за промена' : 'Нема промени за поднесување';
            if (changeCount) legacyBtn.classList.add('has-changes');
            else legacyBtn.classList.remove('has-changes');
        }
    }

    // ── Submit Dialog ────────────────────────────────────────────

    function _showSubmitDialog() {
        var files = getPendingFiles();
        if (!files.length) {
            _showNotification('Нема промени за поднесување.', 'info');
            return;
        }

        var fileLabels = files.map(function (f) {
            if (f === 'bands.json') return '<li><i class="fas fa-list"></i> Мастер Листа</li>';
            if (f === 'events.json') return '<li><i class="fas fa-calendar-days"></i> Настани</li>';
            return '<li><i class="fas fa-file"></i> ' + f + '</li>';
        }).join('');

        var overlay = document.createElement('div');
        overlay.className = 'mmm-draft-overlay';
        overlay.innerHTML =
            '<div class="mmm-draft-dialog">' +
                '<h2><i class="fas fa-paper-plane"></i> Поднесување на промени</h2>' +
                '<p class="mmm-draft-dialog-info">Ќе бидат поднесени промени за:</p>' +
                '<ul class="mmm-draft-file-list">' + fileLabels + '</ul>' +
                '<form id="mmm-draft-submit-form">' +
                    '<div class="mmm-draft-field">' +
                        '<label for="mmm-draft-contributor">Ваши информации (опционално)</label>' +
                        '<input type="text" id="mmm-draft-contributor" placeholder="Име или е-пошта">' +
                    '</div>' +
                    '<div class="mmm-draft-field">' +
                        '<label for="mmm-draft-description">Опис на промените</label>' +
                        '<textarea id="mmm-draft-description" placeholder="Опишете ги промените..." rows="3" required></textarea>' +
                    '</div>' +
                    '<div class="mmm-draft-dialog-buttons">' +
                        '<button type="button" class="mmm-draft-btn discard" id="mmm-draft-dialog-cancel">Откажи</button>' +
                        '<button type="submit" class="mmm-draft-btn submit" id="mmm-draft-dialog-submit">' +
                            '<i class="fas fa-paper-plane"></i> Испрати' +
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

        // Submit
        document.getElementById('mmm-draft-submit-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var contributor = document.getElementById('mmm-draft-contributor').value.trim();
            var description = document.getElementById('mmm-draft-description').value.trim();
            if (!description) {
                _showNotification('Внесете опис на промените.', 'error');
                document.getElementById('mmm-draft-description').focus();
                return;
            }

            var submitBtn = document.getElementById('mmm-draft-dialog-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Испраќање...';

            try {
                var results = await submitAll(contributor, description);

                // Show success state in the dialog before closing
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Успешно!';
                submitBtn.classList.add('mmm-btn-success');

                setTimeout(function () {
                    overlay.remove();
                }, 1200);

                _showNotification('Успешно поднесено! Промените ќе бидат видливи откако ќе бидат одобрени.', 'success');
                window.dispatchEvent(new CustomEvent('mmm-drafts-submitted', { detail: results }));
            } catch (err) {
                console.error('Draft submit failed:', err);
                _showNotification('Грешка при поднесување: ' + (err.message || err), 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Испрати';
            }
        });

        // Auto-generate and pre-fill description
        setTimeout(function () {
            var descEl = document.getElementById('mmm-draft-description');
            var autoDesc = _generateDescription();
            if (autoDesc) {
                descEl.value = 'Предлог промени од MMM\n\n' + autoDesc + '\n';
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
                    '<button class="mmm-draft-btn discard" id="mmm-confirm-cancel">Откажи</button>' +
                    '<button class="mmm-draft-btn submit mmm-btn-danger" id="mmm-confirm-ok">Потврди</button>' +
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
        initUI: initUI,
        _refreshUI: _refreshUI,
        saveAdditionalFile: saveAdditionalFile,
        removeAdditionalFile: removeAdditionalFile,
        getAdditionalFiles: getAdditionalFiles,
        clearAdditionalFiles: clearAdditionalFiles
    };
})();
