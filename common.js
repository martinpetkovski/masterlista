/**
 * common.js — Shared utilities for toplista.mk
 *
 * Centralises functions that were previously duplicated across
 * index.html, toplista.html, charts.html, artist.html, kustos.html,
 * kustosi.html, nastani.html, nastan.html, vesti.html, iznenadi-me.html.
 *
 * Include this file BEFORE the page-specific <script> block:
 *   <script src="/common.js"></script>
 */

// ==================== HTML ESCAPING ====================
function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== CYRILLIC TRANSLITERATION ====================
var cyrillicToLatinMap = {
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
    'Д': 'D', 'д': 'd', 'Ѓ': 'Gj', 'ѓ': 'gj', 'Е': 'E', 'е': 'e', 'Ж': 'Zh', 'ж': 'zh',
    'З': 'Z', 'з': 'z', 'Ѕ': 'Dz', 'ѕ': 'dz', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
    'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'Lj', 'љ': 'lj', 'М': 'M', 'м': 'm',
    'Н': 'N', 'н': 'n', 'Њ': 'Nj', 'њ': 'nj', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
    'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'Kj', 'ќ': 'kj',
    'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
    'Ч': 'Ch', 'ч': 'ch', 'Џ': 'Dz', 'џ': 'dz', 'Ш': 'Sh', 'ш': 'sh'
};

function transliterateCyrillicToLatin(text) {
    return text.split('').map(function(c) { return cyrillicToLatinMap[c] || c; }).join('');
}

// ==================== CYRILLIC → GREEK TRANSLITERATION ====================
var cyrillicToGreekMap = {
    'А': 'Α', 'а': 'α', 'Б': 'Μπ', 'б': 'μπ', 'В': 'Β', 'в': 'β', 'Г': 'Γ', 'г': 'γ',
    'Д': 'Ντ', 'д': 'ντ', 'Ѓ': 'Γκ', 'ѓ': 'γκ', 'Е': 'Ε', 'е': 'ε', 'Ж': 'Ζ', 'ж': 'ζ',
    'З': 'Ζ', 'з': 'ζ', 'Ѕ': 'Ντζ', 'ѕ': 'ντζ', 'И': 'Ι', 'и': 'ι', 'Ј': 'Γι', 'ј': 'γι',
    'К': 'Κ', 'к': 'κ', 'Л': 'Λ', 'л': 'λ', 'Љ': 'Λι', 'љ': 'λι', 'М': 'Μ', 'м': 'μ',
    'Н': 'Ν', 'н': 'ν', 'Њ': 'Νι', 'њ': 'νι', 'О': 'Ο', 'о': 'ο', 'П': 'Π', 'π': 'π',
    'Р': 'Ρ', 'р': 'ρ', 'С': 'Σ', 'с': 'σ', 'Т': 'Τ', 'т': 'τ', 'Ќ': 'Κι', 'ќ': 'κι',
    'У': 'Ου', 'у': 'ου', 'Ф': 'Φ', 'ф': 'φ', 'Х': 'Χ', 'х': 'χ', 'Ц': 'Τσ', 'ц': 'τσ',
    'Ч': 'Τσ', 'ч': 'τσ', 'Џ': 'Τζ', 'џ': 'τζ', 'Ш': 'Σ', 'ш': 'σ'
};

function transliterateCyrillicToGreek(text) {
    return text.split('').map(function(c) { return cyrillicToGreekMap[c] || c; }).join('');
}

// ==================== SLUG GENERATION ====================
function generateArtistSlug(name) {
    return transliterateCyrillicToLatin(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ==================== ARTIST PAGE URL ====================

// Shared fallback image for artists without a valid photo.
// Inline SVG data-URI: a dark rounded square with a '?' mark.
var ARTIST_FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23374151'/%3E%3Ctext x='40' y='54' text-anchor='middle' font-family='Inter,system-ui,sans-serif' font-size='36' font-weight='700' fill='%239ca3af'%3E%3F%3C/text%3E%3C/svg%3E";

function getArtistPageUrl(artistName) {
    var slug = encodeURIComponent(generateArtistSlug(artistName));
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'artist.html?a=' + slug;
    }
    return '/' + slug;
}

// ==================== FISHER-YATES SHUFFLE ====================
function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

// ==================== COLLAB DEDUPLICATION ====================
function deduplicateCollabs(releases) {
    var map = new Map();
    releases.forEach(function(r) {
        var existing = map.get(r.releaseId);
        if (existing) {
            var names = existing.bandName.split(', ');
            if (names.indexOf(r.bandName) === -1) existing.bandName = names.concat(r.bandName).join(', ');
            existing.popularity = Math.max(existing.popularity || 0, r.popularity || 0);
            existing.followers = Math.max(existing.followers || 0, r.followers || 0);
            existing.youtubeViews = Math.max(existing.youtubeViews || 0, r.youtubeViews || 0);
            existing.viewsDelta = Math.max(existing.viewsDelta || 0, r.viewsDelta || 0);
            existing.isCollab = true;
        } else {
            map.set(r.releaseId, Object.assign({}, r));
        }
    });
    return Array.from(map.values());
}

// ==================== GENRE CONFIGURATION (authoritative, loaded from chart-genres.json) ====================
// Defaults (overridden by loadChartGenres)
var rapGenres = ['Rap', 'Trap', 'Hip Hop', 'Boom Bap', 'Pop Rap'];
var electronicGenres = ['Electronic', 'Techno', 'House', 'Trance', 'Synthwave', 'Synth-Pop', 'EDM', 'DnB', 'Drum and Bass', 'Ambient', 'Vaporwave', 'Psychedelic Trance', 'Goa Trance', 'Glitch', 'Chillout', 'Electro-Ambient', 'Trip Hop', 'Psybass', 'Psydub'];
var popGenres = ['Pop', 'Pop Rock', 'Dance Pop', 'Synth-Pop', 'K-Pop', 'Turbo Folk', 'R&B', 'Pop Folk', 'Schlager', 'Soul', 'Electropop', 'Dance'];
var nonAltGenres = rapGenres.concat(electronicGenres, popGenres);

function _rebuildGenreConfig() {
    nonAltGenres = rapGenres.concat(electronicGenres, popGenres);
    genreConfig = {
        'alt': { label: 'Alternative', tKey: 'charts.genreAlt', isExclusion: true, excludeGenres: nonAltGenres },
        'rap': { label: 'Rap/Trap', tKey: 'charts.genreRap', genres: rapGenres },
        'electronic': { label: 'Electronic', tKey: 'charts.genreElectronic', genres: electronicGenres },
        'pop': { label: 'Pop', tKey: 'charts.genrePop', genres: popGenres }
    };
}

var genreConfig = {
    'alt': { label: 'Alternative', tKey: 'charts.genreAlt', isExclusion: true, excludeGenres: nonAltGenres },
    'rap': { label: 'Rap/Trap', tKey: 'charts.genreRap', genres: rapGenres },
    'electronic': { label: 'Electronic', tKey: 'charts.genreElectronic', genres: electronicGenres },
    'pop': { label: 'Pop', tKey: 'charts.genrePop', genres: popGenres }
};

/**
 * Load genre categories from chart-genres.json and rebuild genreConfig.
 * Call this early in page init. Returns a promise.
 */
function loadChartGenres() {
    return fetch('chart-genres.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.rap) rapGenres = data.rap;
            if (data.electronic) electronicGenres = data.electronic;
            if (data.pop) popGenres = data.pop;
            _rebuildGenreConfig();
        })
        .catch(function(e) {
            console.warn('Could not load chart-genres.json, using defaults:', e);
        });
}

/**
 * Translate a genre name using the i18n system.
 * Falls back to the English genre name if no translation is found.
 */
function localizeGenre(genre) {
    if (!genre) return '';
    if (typeof t === 'function') {
        var translated = t('genre.' + genre);
        if (translated !== 'genre.' + genre) return translated;
    }
    return genre;
}

/**
 * Translate a full comma-separated genre string.
 */
function localizeGenreString(genreStr) {
    if (!genreStr || genreStr === 'недостигаат податоци') return genreStr;
    return genreStr.split(',').map(function(g) { return localizeGenre(g.trim()); }).join(', ');
}

// ==================== GENRE MATCHING ====================

/**
 * Look up artist info from a bands array by name.
 * @param {string} artistName
 * @param {Array} bandsData
 * @returns {Object|null}
 */
function getArtistInfoByName(artistName, bandsData) {
    if (!bandsData) return null;
    var normalised = artistName.toLowerCase().trim();
    for (var i = 0; i < bandsData.length; i++) {
        if (bandsData[i].name.toLowerCase().trim() === normalised) return bandsData[i];
    }
    // Try first artist in collab (e.g. "Artist1, Artist2")
    var firstArtist = artistName.split(',')[0].trim().toLowerCase();
    if (firstArtist !== normalised) {
        for (var j = 0; j < bandsData.length; j++) {
            if (bandsData[j].name.toLowerCase().trim() === firstArtist) return bandsData[j];
        }
    }
    return null;
}

/**
 * Split a genre string like "Рок, Метал" into lowercase trimmed array.
 */
function splitGenres(genreStr) {
    if (!genreStr || genreStr.toLowerCase() === 'недостигаат податоци') return [];
    return genreStr.split(/,\s*/).map(function(g) { return g.trim().toLowerCase(); }).filter(Boolean);
}

/**
 * Check if an artist matches a genre filter.
 * Works with both index.html (bandsData param) and toplista.html (uses getArtistInfo).
 * @param {string} artistName
 * @param {string} genreFilter — 'all', 'alt', 'rap', 'electronic', 'pop'
 * @param {Array} bandsData — the bands array to search in
 */
function artistMatchesGenre(artistName, genreFilter, bandsData) {
    if (genreFilter === 'all') return true;

    var config = genreConfig[genreFilter];
    if (!config) return true;

    var info = getArtistInfoByName(artistName, bandsData);
    if (!info || !info.genre) return false;

    var artistGenres = splitGenres(info.genre);
    if (artistGenres.length === 0) return false;

    if (config.isExclusion) {
        var excludeLower = config.excludeGenres.map(function(g) { return g.toLowerCase(); });
        return !artistGenres.some(function(ag) {
            return excludeLower.some(function(eg) { return ag === eg; });
        });
    }

    var configGenresLower = config.genres.map(function(g) { return g.toLowerCase(); });
    return artistGenres.some(function(ag) {
        return configGenresLower.some(function(cg) { return ag === cg; });
    });
}

// ==================== CHART RANKING ====================

/**
 * Build a ranked chart from releases — the single authoritative algorithm
 * used by both the homepage mini-charts and the full chart page.
 *
 * @param {Array} releases — raw releases (will be deduped internally)
 * @param {Object} opts
 * @param {string}  opts.type       — 'single' | 'album' (release type filter)
 * @param {string}  opts.genre      — genre filter key (e.g. 'all', 'alt')
 * @param {string}  [opts.city]     — city filter key (optional, default 'all')
 * @param {Array}   opts.bandsData  — bands array for genre/city matching
 * @param {number}  [opts.count]    — how many items to return (default 20; 0 = all)
 * @param {Function} [opts.cityMatcher] — DEPRECATED. Built-in city matching is used.
 * @returns {Array} ranked releases sorted by popularity (deterministic)
 */
function buildChartRanking(releases, opts) {
    var type = opts.type || 'single';
    var genre = opts.genre || 'all';
    var bands = opts.bandsData || [];
    var count = opts.count !== undefined ? opts.count : 20;
    var city = opts.city || 'all';

    var deduped = deduplicateCollabs(releases);

    // Filter by release type
    var typeFilter = type === 'album'
        ? function(r) { return r.releaseType === 'album' || r.releaseType === 'compilation'; }
        : function(r) { return r.releaseType === 'single'; };

    var filtered = deduped.filter(typeFilter);

    // Apply genre filter
    filtered = filtered.filter(function(r) {
        return artistMatchesGenre(r.bandName, genre, bands);
    });

    // Apply city filter
    if (city !== 'all') {
        // Legacy callback support
        if (opts.cityMatcher) {
            filtered = filtered.filter(function(r) {
                return opts.cityMatcher(r.bandName, city);
            });
        } else {
            filtered = filtered.filter(function(r) {
                return artistMatchesCity(r.bandName, city, bands);
            });
        }
    }

    // When count is 0, skip cutoff/backfill — return ALL sorted releases
    if (count === 0) {
        filtered.sort(chartSort);
        return filtered;
    }

    // Cutoff — 4 weeks for singles, 8 weeks for albums
    var cutoffWeeks = type === 'album' ? 8 : 4;
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cutoffWeeks * 7);
    var cutoff = cutoffDate.toISOString().slice(0, 10);

    // 1. Start with recent releases, enforce 2-per-artist (keep most popular)
    var recent = filtered.filter(function(r) { return (r.effectiveReleaseDate || r.releaseDate) >= cutoff; });
    var pool = trimPerArtist(recent);

    // 2. Backfill with most recent older releases, one at a time,
    //    re-enforcing 2-per-artist after each addition
    var older = filtered
        .filter(function(r) { return (r.effectiveReleaseDate || r.releaseDate) < cutoff; })
        .sort(function(a, b) { return new Date(b.effectiveReleaseDate || b.releaseDate) - new Date(a.effectiveReleaseDate || a.releaseDate); });

    var oi = 0;
    while (pool.length < count && oi < older.length) {
        pool.push(older[oi++]);
        pool = trimPerArtist(pool);
    }

    // Final sort by popularity for display order
    pool.sort(chartSort);
    return pool.slice(0, count);
}

/** Keep at most 2 releases per artist, preferring the most popular ones. */
function trimPerArtist(releases) {
    var byArtist = {};
    releases.forEach(function(r) {
        var key = (r.bandName || '').toLowerCase().trim();
        if (!byArtist[key]) byArtist[key] = [];
        byArtist[key].push(r);
    });
    var keepIds = {};
    Object.keys(byArtist).forEach(function(key) {
        byArtist[key].sort(chartSort);
        byArtist[key].slice(0, 2).forEach(function(r) {
            keepIds[r.releaseId] = true;
        });
    });
    return releases.filter(function(r) { return keepIds[r.releaseId]; });
}

/**
 * Deterministic sort comparator for chart ranking.
 * Primary: null viewsDelta last, then viewsDelta desc, youtubeViews desc, name asc.
 */
function chartSort(a, b) {
    var aNull = (a.viewsDelta == null) ? 1 : 0;
    var bNull = (b.viewsDelta == null) ? 1 : 0;
    if (aNull !== bNull) return aNull - bNull;
    var deltaDiff = (b.viewsDelta || 0) - (a.viewsDelta || 0);
    if (deltaDiff !== 0) return deltaDiff;
    var viewsDiff = (b.youtubeViews || 0) - (a.youtubeViews || 0);
    if (viewsDiff !== 0) return viewsDiff;
    return (a.bandName || '').localeCompare(b.bandName || '');
}

/**
 * Check if an artist matches a city filter.
 * @param {string} artistName
 * @param {string} cityFilter — 'all', 'skopje', 'bitola', etc.
 * @param {Array} bandsData — the bands array to search in
 * @returns {boolean}
 */
function artistMatchesCity(artistName, cityFilter, bandsData) {
    if (cityFilter === 'all') return true;
    var cityLabels = { 'skopje': 'скопје', 'bitola': 'битола' };
    var target = cityLabels[cityFilter];
    if (!target) return true;
    var info = getArtistInfoByName(artistName, bandsData);
    if (!info || !info.city) return false;
    return info.city.toLowerCase().indexOf(target) !== -1;
}

// ==================== MACEDONIAN MONTHS ====================
var mkMonths = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];

/**
 * Format an ISO date string (YYYY-MM-DD) as "D мон YYYY".
 * Uses i18n month names when available.
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = (typeof t === 'function') ? t('months.short') : mkMonths;
    if (!Array.isArray(months)) months = mkMonths;
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

// ==================== SETTINGS MENU (shared) ====================

/**
 * Initialises the settings overlay (theme, streaming service, tour).
 * Must be called after the DOM is ready.
 * @param {Object} [extraServiceDefs] — optional page-specific service definitions
 *        to use in the settings dropdown. Falls back to built-in defaults.
 */
function initSettingsMenu(extraServiceDefs) {
    var settingsBtn = document.getElementById('settings-btn');
    if (!settingsBtn) return;

    var svcDefs = extraServiceDefs || {
        spotify: { name: 'Spotify', icon: 'fab fa-spotify' },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube' },
        youtubeMusic: { name: 'YouTube Music', icon: 'fab fa-youtube' },
        appleMusic: { name: 'Apple Music', icon: 'fab fa-apple' },
        deezer: { name: 'Deezer', icon: 'fas fa-headphones' },
        tidal: { name: 'Tidal', icon: 'fas fa-water' },
        amazonMusic: { name: 'Amazon Music', icon: 'fab fa-amazon' },
        soundcloud: { name: 'SoundCloud', icon: 'fab fa-soundcloud' },
        bandcamp: { name: 'Bandcamp', icon: 'fab fa-bandcamp' }
    };

    var overlay = document.getElementById('settings-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'settings-overlay';
        overlay.className = 'settings-overlay';

        var currentService = localStorage.getItem('mmm-preferred-service');
        var isDark = document.documentElement.classList.contains('dark-mode');

        var optionsHtml = '<option value=""' + (!currentService ? ' selected' : '') + '>' + (typeof t === 'function' ? t('settings.alwaysAsk') : 'Секогаш прашувај') + '</option>';
        for (var id in svcDefs) {
            if (!svcDefs.hasOwnProperty(id)) continue;
            optionsHtml += '<option value="' + id + '"' + (id === currentService ? ' selected' : '') + '>' + svcDefs[id].name + '</option>';
        }

        // Build language selector options
        var langOptionsHtml = '';
        var curLang = (typeof getLanguage === 'function') ? getLanguage() : 'mk';
        var langs = (typeof getLanguages === 'function') ? getLanguages() : [];
        for (var li = 0; li < langs.length; li++) {
            langOptionsHtml += '<option value="' + langs[li].code + '"' + (langs[li].code === curLang ? ' selected' : '') + '>' + langs[li].flag + ' ' + langs[li].name + '</option>';
        }

        var _t = typeof t === 'function' ? t : function(k) { return k; };

        overlay.innerHTML =
            '<div class="settings-panel">' +
                '<h3><i class="fas fa-gear"></i> ' + _t('settings.title') + '</h3>' +
                '<div class="settings-section">' +
                    '<div class="settings-section-title">' + _t('settings.language') + '</div>' +
                    '<select class="settings-lang-select">' + langOptionsHtml + '</select>' +
                '</div>' +
                '<div class="settings-section">' +
                    '<div class="settings-section-title">' + _t('settings.theme') + '</div>' +
                    '<div class="settings-theme-toggle">' +
                        '<button class="settings-theme-btn' + (!isDark ? ' active' : '') + '" data-theme="light"><i class="fas fa-sun"></i> ' + _t('settings.themeLight') + '</button>' +
                        '<button class="settings-theme-btn' + (isDark ? ' active' : '') + '" data-theme="dark"><i class="fas fa-moon"></i> ' + _t('settings.themeDark') + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="settings-section">' +
                    '<div class="settings-section-title">' + _t('settings.streamingService') + '</div>' +
                    '<select class="settings-service-select">' + optionsHtml + '</select>' +
                '</div>' +
                '<div class="settings-section settings-tour-section">' +
                    '<button class="settings-tour-btn" id="settings-start-tour"><i class="fas fa-route"></i> ' + _t('settings.siteTour') + '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        function closeSettingsAnimated(ov) {
            var panel = ov.querySelector('.settings-panel');
            if (panel) {
                ov.classList.add('closing');
                panel.addEventListener('animationend', function handler() {
                    panel.removeEventListener('animationend', handler);
                    ov.classList.remove('visible', 'closing');
                }, { once: true });
            } else {
                ov.classList.remove('visible');
            }
        }

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeSettingsAnimated(overlay);
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var ov = document.getElementById('settings-overlay');
                if (ov) closeSettingsAnimated(ov);
            }
        });

        overlay.querySelectorAll('.settings-theme-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var dark = btn.dataset.theme === 'dark';
                document.body.classList.toggle('dark-mode', dark);
                document.documentElement.classList.toggle('dark-mode', dark);
                document.documentElement.style.backgroundColor = dark ? '#111318' : '';
                localStorage.setItem('mmm-dark-mode', dark);
                overlay.querySelectorAll('.settings-theme-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
            });
        });

        var svcSelect = overlay.querySelector('.settings-service-select');
        if (svcSelect) {
            svcSelect.addEventListener('change', function() {
                var v = svcSelect.value;
                if (v) localStorage.setItem('mmm-preferred-service', v);
                else localStorage.removeItem('mmm-preferred-service');
            });
        }

        var langSelect = overlay.querySelector('.settings-lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', function() {
                if (typeof setLanguage === 'function') {
                    setLanguage(langSelect.value);
                    // Reload to fully refresh all translated content
                    window.location.reload();
                }
            });
        }

        var tourBtnEl = overlay.querySelector('#settings-start-tour');
        if (tourBtnEl) {
            tourBtnEl.addEventListener('click', function() {
                closeSettingsAnimated(overlay);
                if (typeof window.startGlobalTour === 'function') window.startGlobalTour();
            });
        }
    }

    // Guard against duplicate click listeners on repeated initSettingsMenu calls
    if (!settingsBtn.hasAttribute('data-settings-init')) {
        settingsBtn.setAttribute('data-settings-init', '1');
        settingsBtn.addEventListener('click', function() {
            var ov = document.getElementById('settings-overlay');
            if (!ov) return;
            var isDarkNow = document.documentElement.classList.contains('dark-mode');
            ov.querySelectorAll('.settings-theme-btn').forEach(function(btn) {
                btn.classList.toggle('active', (btn.dataset.theme === 'dark') === isDarkNow);
            });
            var svcSel = ov.querySelector('.settings-service-select');
            if (svcSel) svcSel.value = localStorage.getItem('mmm-preferred-service') || '';
            ov.classList.add('visible');
        });
    }
}

// ==================== NAV MENU (shared) ====================

/**
 * Initialises the mobile hamburger nav menu toggle.
 * Must be called after the DOM is ready.
 */
function initNavMenu() {
    var trigger = document.querySelector('.site-nav-trigger');
    var menuEl = document.getElementById('site-nav-menu');
    if (trigger && menuEl) {
        trigger.addEventListener('click', function(e) {
            if (window.innerWidth <= 600) {
                e.preventDefault();
                e.stopPropagation();
                menuEl.classList.toggle('open');
            }
        });
        document.addEventListener('click', function(e) {
            if (!menuEl.contains(e.target) && !trigger.contains(e.target)) {
                menuEl.classList.remove('open');
            }
        });
    }
}

// ==================== SHARE LINK BUTTON (shared) ====================

/**
 * Initialises the share-link button in the header.
 * Shows a popup letting the user pick a language for the shared URL.
 */
function initShareLinkButton() {
    var btn = document.getElementById('header-share-link-btn');
    if (!btn) return;

    btn.addEventListener('click', function() {
        // If popup already exists, close it
        var existing = document.getElementById('share-overlay');
        if (existing) {
            closeShareAnimated(existing);
            return;
        }

        var langs = (typeof getLanguages === 'function') ? getLanguages() : [];
        var _t = typeof t === 'function' ? t : function(k) { return k; };

        var overlay = document.createElement('div');
        overlay.id = 'share-overlay';
        overlay.className = 'settings-overlay';

        var panel = document.createElement('div');
        panel.className = 'settings-panel share-panel';

        var title = document.createElement('h3');
        title.innerHTML = '<i class="fas fa-link"></i> ' + _t('share.pickLanguage');
        panel.appendChild(title);

        var grid = document.createElement('div');
        grid.className = 'share-lang-grid';

        for (var i = 0; i < langs.length; i++) {
            (function(lang) {
                var langBtn = document.createElement('button');
                langBtn.className = 'share-lang-btn';
                langBtn.innerHTML = '<span class="share-lang-flag">' + lang.flag + '</span><span class="share-lang-name">' + lang.name + '</span>';
                langBtn.addEventListener('click', function() {
                    var url = new URL(window.location.href);
                    url.searchParams.set('lang', lang.code);
                    var shareUrl = url.toString();
                    copyAndConfirm(shareUrl, title, overlay, _t);
                });
                grid.appendChild(langBtn);
            })(langs[i]);
        }
        panel.appendChild(grid);

        // "No language" option
        var plainBtn = document.createElement('button');
        plainBtn.className = 'share-no-lang-btn';
        plainBtn.textContent = _t('share.noLangParam');
        plainBtn.addEventListener('click', function() {
            var url = new URL(window.location.href);
            url.searchParams.delete('lang');
            var shareUrl = url.toString();
            copyAndConfirm(shareUrl, title, overlay, _t);
        });
        panel.appendChild(plainBtn);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // Trigger open animation
        requestAnimationFrame(function() { overlay.classList.add('visible'); });

        // Close on backdrop click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeShareAnimated(overlay);
        });
        // Close on Escape
        function onEsc(e) {
            if (e.key === 'Escape') {
                closeShareAnimated(overlay);
                document.removeEventListener('keydown', onEsc);
            }
        }
        document.addEventListener('keydown', onEsc);
    });

    function copyAndConfirm(url, titleEl, overlay, _t) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function() {
                titleEl.innerHTML = '<i class="fas fa-check"></i> ' + _t('share.copied');
                setTimeout(function() { closeShareAnimated(overlay); }, 1000);
            }, function() {
                prompt(_t('share.copyManually'), url);
                closeShareAnimated(overlay);
            });
        } else {
            prompt(_t('share.copyManually'), url);
            closeShareAnimated(overlay);
        }
    }

    function closeShareAnimated(ov) {
        var panel = ov.querySelector('.settings-panel');
        if (panel) {
            ov.classList.add('closing');
            panel.addEventListener('animationend', function handler() {
                panel.removeEventListener('animationend', handler);
                ov.remove();
            }, { once: true });
        } else {
            ov.remove();
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShareLinkButton);
} else {
    initShareLinkButton();
}

// ==================== LINK ICONS ====================
var linkIcons = {
    spotify: 'fab fa-spotify',
    youtube: 'fab fa-youtube',
    youtube_music: 'fab fa-youtube',
    instagram: 'fab fa-instagram',
    bandcamp: 'fab fa-bandcamp',
    soundcloud: 'fab fa-soundcloud',
    linktree: 'fas fa-link',
    tidal: 'fas fa-water',
    deezer: 'fas fa-headphones',
    itunes: 'fab fa-apple',
    amazon_music: 'fab fa-amazon'
};

// ==================== ISO WEEK ====================

/**
 * Get ISO week number and year for a given date.
 * @param {Date} date
 * @returns {{year: number, week: number}}
 */
function getISOWeek(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    var yearStart = new Date(d.getFullYear(), 0, 1);
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getFullYear(), week: weekNum };
}

// ==================== SITE MASTER LOADER ====================

/**
 * Cached site-master.json data. Loaded once, shared across all pages.
 * Contains all pre-calculated chart rankings, news, events, etc.
 */
var _siteMasterCache = null;
var _siteMasterPromise = null;

/**
 * Hydrate columnar format { _cols, _rows } back to array of objects.
 */
function _hydrateColumnar(data) {
    if (!data || !data._cols || !data._rows) return data;
    var cols = data._cols;
    var rows = data._rows;
    var result = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) {
        var obj = {};
        var row = rows[i];
        for (var j = 0; j < cols.length; j++) {
            if (j < row.length && row[j] != null) obj[cols[j]] = row[j];
        }
        result[i] = obj;
    }
    return result;
}

/**
 * Post-process site-master.json: hydrate columnar data, reconstruct
 * YouTube URLs, restore omitted defaults.
 */
function _hydrateSiteMaster(data) {
    if (!data) return data;

    // Hydrate chartData.releases from columnar format
    if (data.chartData && data.chartData.releases && data.chartData.releases._cols) {
        data.chartData.releases = _hydrateColumnar(data.chartData.releases);
        // Reconstruct YouTube URLs (stripped to save space; derivable from videoId)
        for (var i = 0; i < data.chartData.releases.length; i++) {
            var r = data.chartData.releases[i];
            if (r.youtubeTracks) {
                for (var j = 0; j < r.youtubeTracks.length; j++) {
                    var t = r.youtubeTracks[j];
                    if (!t.url && t.videoId) {
                        t.url = 'https://www.youtube.com/watch?v=' + t.videoId;
                    }
                }
            }
        }
    }

    // Hydrate advancedCharts from columnar format (if still embedded — legacy compat)
    if (data.advancedCharts) {
        for (var key in data.advancedCharts) {
            if (data.advancedCharts[key] && data.advancedCharts[key]._cols) {
                data.advancedCharts[key] = _hydrateColumnar(data.advancedCharts[key]);
            }
        }
    }

    return data;
}

/**
 * Load site-master.json (cached — only one fetch per page).
 * Returns a Promise that resolves to the parsed JSON object.
 */
function loadSiteMaster() {
    if (_siteMasterCache) return Promise.resolve(_siteMasterCache);
    if (_siteMasterPromise) return _siteMasterPromise;
    _siteMasterPromise = fetch('/site-master.json?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            _siteMasterCache = _hydrateSiteMaster(data);
            return _siteMasterCache;
        })
        .catch(function() { return null; });
    return _siteMasterPromise;
}

/**
 * Get the cached site-master data (null if not yet loaded).
 */
function getSiteMaster() {
    return _siteMasterCache;
}

/**
 * Lazy-load advanced-charts.json (only needed by charts.html).
 * Hydrates columnar data and attaches to the cached site-master object.
 * Returns a Promise resolving to the advancedCharts object.
 */
var _advChartsPromise = null;
function loadAdvancedCharts() {
    if (_siteMasterCache && _siteMasterCache.advancedCharts) {
        return Promise.resolve(_siteMasterCache.advancedCharts);
    }
    if (_advChartsPromise) return _advChartsPromise;
    _advChartsPromise = fetch('/advanced-charts.json?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (data) {
                for (var key in data) {
                    if (data[key] && data[key]._cols) {
                        data[key] = _hydrateColumnar(data[key]);
                    }
                }
                if (_siteMasterCache) _siteMasterCache.advancedCharts = data;
            }
            return data;
        })
        .catch(function() { return null; });
    return _advChartsPromise;
}

/**
 * Lazy-load artist-data.json (only needed by artist.html).
 * Merges releaseSparklines, artistPopularityGraphs, artistActivity
 * into the cached site-master object.
 * Returns a Promise resolving to the artist data object.
 */
var _artistDataPromise = null;
function loadArtistData() {
    if (_siteMasterCache && _siteMasterCache.releaseSparklines) {
        return Promise.resolve(_siteMasterCache);
    }
    if (_artistDataPromise) return _artistDataPromise;
    _artistDataPromise = fetch('/artist-data.json?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (data && _siteMasterCache) {
                _siteMasterCache.artistPopularityGraphs = data.artistPopularityGraphs || {};
                _siteMasterCache.releaseSparklines = data.releaseSparklines || {};
                _siteMasterCache.artistActivity = data.artistActivity || {};
            }
            return _siteMasterCache;
        })
        .catch(function() { return null; });
    return _artistDataPromise;
}

// ==================== HEADER COLLAGE ====================
/**
 * Adds a scattered album art collage behind the shared header/navbar.
 * Call this once from any page after DOMContentLoaded (or immediately if DOM ready).
 * Uses pre-computed headerThumbs from site-master.json.
 */
function initHeaderCollage() {
    var headerEl = document.querySelector('header');
    if (!headerEl) return;

    var isVerifiedArtistHeader = function() {
        return !!(document.body && document.body.classList.contains('artist-page') && document.body.classList.contains('verified-accent'));
    };

    var removeCollageIfVerified = function() {
        if (!isVerifiedArtistHeader()) return false;
        var existingCollage = headerEl.querySelector('.header-collage');
        if (existingCollage) existingCollage.remove();
        return true;
    };

    if (removeCollageIfVerified()) return;

    if (document.body && document.body.classList.contains('artist-page')) {
        var bodyClassObserver = new MutationObserver(function() {
            if (removeCollageIfVerified()) {
                bodyClassObserver.disconnect();
            }
        });
        bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    loadSiteMaster().then(function(master) {
        if (!master || !master.headerThumbs || master.headerThumbs.length === 0) return;

        var thumbs = master.headerThumbs;
        var maxUnique = thumbs.length;

        var collage = document.createElement('div');
        collage.className = 'header-collage';

        if (removeCollageIfVerified()) return;

        var headerHeight = Math.max(headerEl.clientHeight || 0, 48);
        var rows = 2;
        var tileSize = headerHeight / rows;
        var columnsNeeded = Math.ceil((window.innerWidth || headerEl.clientWidth || 1200) / tileSize) + 8;
        var totalImages = Math.max(columnsNeeded * rows, 60);
        for (var i = 0; i < totalImages; i++) {
            var img = document.createElement('img');
            img.src = thumbs[i % maxUnique];
            img.alt = '';
            img.loading = 'lazy';
            collage.appendChild(img);
        }

        headerEl.insertBefore(collage, headerEl.firstChild);
    });
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeaderCollage);
} else {
    initHeaderCollage();
}

// ==================== MINI FOOTER (shared) ====================
function initGlobalMiniFooter() {
    if (!document.body) return;
    var currentPath = window.location.pathname || '/';
    if (!/(^\/$|\/index\.html$)/.test(currentPath)) return;
    if (document.querySelector('.site-mini-footer')) return;

    var styleId = 'site-mini-footer-style';
    if (!document.getElementById(styleId)) {
        var styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent =
            '.site-mini-footer{ text-align:center; margin-top:1rem; }' +
            '.site-mini-footer__logo-link{ display:inline-flex; margin-bottom:0.42rem; }' +
            '.site-mini-footer__logo{ width:22px; height:22px; vertical-align:middle; }' +
            '.site-mini-footer__text{ font-size:0.68rem; line-height:1.45; color:var(--text-muted, #6b7280); }' +
            '.site-mini-footer__license{ display:inline-flex; margin:0 0.25rem; vertical-align:middle; }' +
            '.site-mini-footer__license img{ width:88px; height:31px; vertical-align:middle; border:0; }' +
            '.site-mini-footer__text a{ color:var(--text-muted, #6b7280); text-decoration:none; }' +
            '.site-mini-footer__text a:hover{ color:var(--accent-orange, #f59e0b); text-decoration:none; }' +
            '.site-mini-footer--standalone{ width:min(100%,680px); margin:1rem auto 0; padding:0.75rem 1rem 1rem; border-top:1px solid var(--border-color, rgba(0,0,0,0.08)); }' +
            'body.dark-mode .site-mini-footer--standalone, html.dark-mode .site-mini-footer--standalone{ border-top-color:rgba(255,255,255,0.08); }' +
            'body.dark-mode .site-mini-footer__text a, html.dark-mode .site-mini-footer__text a{ color:var(--text-muted, #9ca3af); }';
        document.head.appendChild(styleEl);
    }

    var repoUrl = 'https://github.com/martinpetkovski/masterlista/';
    var xotelUrl = 'https://discord.gg/DzBQASu7mU';

    var miniFooter = document.createElement('div');
    miniFooter.className = 'site-mini-footer';

    function renderMiniFooterContent() {
        var devBy = (typeof t === 'function') ? t('footer.developedBy') : 'Развиено од';
        var supBy = (typeof t === 'function') ? t('footer.supportedBy') : 'Потпомогнато од заедницата на';
        var authorName = (typeof localizeText === 'function') ? localizeText('Мартин') : 'Мартин';
        var siteTitle = (typeof t === 'function') ? t('common.siteTitle') : 'Топ Листа';
        miniFooter.innerHTML =
            '<a class="site-mini-footer__logo-link" href="/" aria-label="' + siteTitle + '">' +
                '<img src="/logo.png" alt="' + siteTitle + '" class="site-mini-footer__logo" width="22" height="22">' +
            '</a>' +
            '<div class="site-mini-footer__text">' +
                devBy + ' <a href="' + repoUrl + '" target="_blank" rel="noopener noreferrer">' + authorName + '</a> ' +
                '2025-2026. ' + supBy + ' <a href="' + xotelUrl + '" target="_blank" rel="noopener noreferrer">Xotel</a>' +
                '<br><br><a rel="license" class="site-mini-footer__license" href="https://creativecommons.org/licenses/by/4.0/">' +
                    '<img alt="Creative Commons License" src="https://i.creativecommons.org/l/by/4.0/88x31.png" />' +
                '</a>' +
            '</div>';
    }
    renderMiniFooterContent();
    if (typeof onLanguageChange === 'function') onLanguageChange(renderMiniFooterContent);

    miniFooter.classList.add('site-mini-footer--standalone');
    document.body.appendChild(miniFooter);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalMiniFooter);
} else {
    initGlobalMiniFooter();
}

// ==================== PAGE TITLE TRANSLATION ====================
function initPageTitleTranslation() {
    var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    var config = {
        '/':            { title: 'pageTitle.home',       header: 'pages.home' },
        '/index':       { title: 'pageTitle.home',       header: 'pages.home' },
        '/charts':      { title: 'pageTitle.charts',     header: 'pageTitle.chartsHeader' },
        '/lista':       { title: 'pageTitle.masterList', header: 'pages.masterList' },
        '/nastani':     { title: 'pageTitle.events',     header: 'pages.events' },
        '/vesti':       { title: 'pageTitle.news',       header: 'pages.news' },
        '/kustosi':     { title: 'pageTitle.curators',   header: 'pages.curators' },
        '/iznenadi-me': { title: 'pageTitle.surprise',   header: 'pages.surprise' },
        '/privatnost':  { title: 'pageTitle.privacy',    header: 'pageTitle.privacyHeader' },
        '/uslovi':      { title: 'pageTitle.terms',      header: 'pageTitle.termsHeader' },
        '/artist':      { title: 'pageTitle.artist',     header: 'pages.artist' },
        '/nastan':      { title: 'pageTitle.event',      header: 'pages.event' },
        '/kustos':      { title: 'pageTitle.curator',    header: 'pages.curator' }
    };
    var entry = config[path];
    if (!entry) return;

    function updateTitle() {
        document.title = t(entry.title);
        var header = document.getElementById('site-header');
        if (header) header.setAttribute('data-title', t(entry.header));
        var h1 = header && header.querySelector('h1');
        if (h1) h1.textContent = t(entry.header);
    }
    updateTitle();
    if (typeof onLanguageChange === 'function') onLanguageChange(updateTitle);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageTitleTranslation);
} else {
    initPageTitleTranslation();
}

// ==================== SERVICE CHOOSER (shared) ====================

/**
 * Canonical streaming-service definitions used across the entire site.
 * Pages should reference this instead of maintaining their own copies.
 */
var serviceDefinitions = {
    spotify:      { name: 'Spotify',       icon: 'fab fa-spotify',      color: '#1DB954' },
    youtube:      { name: 'YouTube',       icon: 'fab fa-youtube',      color: '#FF0000' },
    youtubeMusic: { name: 'YouTube Music', icon: 'fab fa-youtube',      color: '#FF0000' },
    appleMusic:   { name: 'Apple Music',   icon: 'fab fa-itunes-note',  color: '#fc3c44' },
    deezer:       { name: 'Deezer',        icon: 'fab fa-deezer',       color: '#FEAA2D' },
    tidal:        { name: 'Tidal',         icon: 'fas fa-water',        color: '#00FFFF' },
    amazonMusic:  { name: 'Amazon Music',  icon: 'fab fa-amazon',       color: '#FF9900' },
    soundcloud:   { name: 'SoundCloud',    icon: 'fab fa-soundcloud',   color: '#ff7700' },
    bandcamp:     { name: 'Bandcamp',      icon: 'fab fa-bandcamp',     color: '#1da0c3' }
};

function getPreferredService() {
    return localStorage.getItem('mmm-preferred-service') || null;
}

function setPreferredService(serviceId) {
    if (serviceId) {
        localStorage.setItem('mmm-preferred-service', serviceId);
    } else {
        localStorage.removeItem('mmm-preferred-service');
    }
}

function buildServiceSearchUrl(serviceId, artist, title) {
    var query = (artist + ' ' + title).trim();
    var encoded = encodeURIComponent(query);
    var plusEncoded = query.replace(/\s+/g, '+');
    var searchUrls = {
        youtube:      'https://www.youtube.com/results?search_query=' + plusEncoded,
        youtubeMusic: 'https://music.youtube.com/search?q=' + encoded,
        appleMusic:   'https://music.apple.com/search?term=' + encoded,
        deezer:       'https://www.deezer.com/search/' + encoded,
        tidal:        'https://listen.tidal.com/search?q=' + encoded,
        amazonMusic:  'https://music.amazon.com/search/' + encoded,
        soundcloud:   'https://soundcloud.com/search?q=' + encoded,
        bandcamp:     'https://bandcamp.com/search?q=' + encoded
    };
    return searchUrls[serviceId] || null;
}

var _masterArtistNameSet = null;
var _masterArtistNameSetPromise = null;

function normalizeArtistLookupName(name) {
    return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Pre-populate the artist name set from an already-loaded bands array so
 *  the service chooser never needs a redundant fetch. */
function primeMasterArtistNameSet(bandsArray) {
    if (_masterArtistNameSet) return;
    if (!Array.isArray(bandsArray) || bandsArray.length === 0) return;
    var lookupSet = new Set();
    bandsArray.forEach(function(item) {
        if (item && item.name) lookupSet.add(normalizeArtistLookupName(item.name));
    });
    _masterArtistNameSet = lookupSet;
    _masterArtistNameSetPromise = Promise.resolve(lookupSet);
}

function loadMasterArtistNameSet() {
    if (_masterArtistNameSet) return Promise.resolve(_masterArtistNameSet);
    if (_masterArtistNameSetPromise) return _masterArtistNameSetPromise;

    _masterArtistNameSetPromise = fetch('/bands.json')
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            var list = data && data.muzickaMasterLista ? data.muzickaMasterLista : [];
            var lookupSet = new Set();

            list.forEach(function(item) {
                if (item && item.name) {
                    lookupSet.add(normalizeArtistLookupName(item.name));
                }
            });

            _masterArtistNameSet = lookupSet;
            return lookupSet;
        })
        .catch(function() { return null; });

    return _masterArtistNameSetPromise;
}

/**
 * Show the unified service-chooser dialog.
 *
 * @param {string}   releaseUrl         — Direct link (usually Spotify)
 * @param {string}   [title]            — Song / release title
 * @param {string}   [artistName]       — Artist display name (Cyrillic / local)
 * @param {string}   [thumbnail]        — Thumbnail image URL
 * @param {string[]} [accentColors]     — Accent colours from the artist profile
 * @param {string}   [spotifyArtistName]— Spotify (Latin) artist name for search queries
 * @param {boolean}  [verified]         — Whether the artist is verified (enables colourful popup)
 */
function showServiceChooserDialog(releaseUrl, title, artistName, thumbnail, accentColors, spotifyArtistName, verified, youtubeUrl) {
    if (!releaseUrl) return;

    // The name used in service search queries (prefer Spotify/Latin name)
    var searchArtistName = spotifyArtistName || artistName || '';

    function normalizeHexColor(hex) {
        if (typeof hex !== 'string') return null;
        var cleaned = hex.trim();
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned)) return null;
        if (cleaned.length === 4) {
            cleaned = '#' + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2] + cleaned[3] + cleaned[3];
        }
        return cleaned;
    }

    function shadeHexColor(hex, percent) {
        var normalized = normalizeHexColor(hex);
        if (!normalized) return null;

        var raw = normalized.slice(1);
        var red = parseInt(raw.slice(0, 2), 16);
        var green = parseInt(raw.slice(2, 4), 16);
        var blue = parseInt(raw.slice(4, 6), 16);

        var target = percent >= 0 ? 255 : 0;
        var factor = Math.abs(percent) / 100;

        var nextRed = Math.round(red + (target - red) * factor);
        var nextGreen = Math.round(green + (target - green) * factor);
        var nextBlue = Math.round(blue + (target - blue) * factor);

        return '#' + [nextRed, nextGreen, nextBlue].map(function(v) {
            return v.toString(16).padStart(2, '0');
        }).join('');
    }

    var overlay = document.getElementById('service-chooser-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'service-chooser-overlay';
        overlay.className = 'service-chooser-overlay';
        overlay.innerHTML =
            '<div class="service-chooser">' +
                '<div class="sc-vfx-bg" id="sc-vfx-bg"></div>' +
                '<div class="service-chooser-header" id="service-chooser-header">' +
                    '<button type="button" class="service-chooser-close" id="service-chooser-close" aria-label="Затвори">×</button>' +
                    '<img class="service-chooser-img" id="service-chooser-img">' +
                    '<div class="service-chooser-header-text">' +
                        '<div class="service-chooser-artist" id="service-chooser-artist"></div>' +
                        '<div class="service-chooser-song" id="service-chooser-song"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="service-chooser-links" id="service-chooser-links"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeServiceChooserDialog(true);
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeServiceChooserDialog(true);
        });
        var closeBtn = overlay.querySelector('#service-chooser-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                closeServiceChooserDialog(true);
            });
        }
    }

    var headerEl  = document.getElementById('service-chooser-header');
    var chooserEl = overlay.querySelector('.service-chooser');
    var imgEl     = document.getElementById('service-chooser-img');
    var artistEl  = document.getElementById('service-chooser-artist');
    var songEl    = document.getElementById('service-chooser-song');
    var linksEl   = document.getElementById('service-chooser-links');
    var vfxBgEl   = document.getElementById('sc-vfx-bg');

    // Colourful header only for verified artists
    var useColor = !!verified;
    var primaryAccent = useColor && accentColors && accentColors.length > 0 ? normalizeHexColor(accentColors[0]) : null;
    var secondaryAccent = useColor && accentColors && accentColors.length > 1 ? normalizeHexColor(accentColors[1]) : null;

    // Header gradient is applied after dark/light theme detection below

    // Thumbnail
    if (thumbnail) {
        imgEl.src = thumbnail;
        imgEl.style.display = '';
    } else {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
    }

    // Build artist name HTML with separate links for multiple artists
    var artistNames = (artistName || '').split(',').map(function(n) { return n.trim(); }).filter(Boolean);
    var artistHtml = '';
    artistNames.forEach(function(name, idx) {
        if (idx > 0) artistHtml += '<span class="sc-artist-sep">, </span>';
        artistHtml += '<a class="sc-artist-name sc-artist-link" data-artist-name="' + escHtml(name) + '">' + escHtml(localizeText(name)) + '</a>';
    });
    artistHtml += '<span class="sc-verified-badge" id="sc-verified-badge" title="' + escHtml(t('service.verifiedBadge')) + '" aria-label="' + escHtml(t('service.verifiedBadge')) + '"><i class="fas fa-check-circle"></i></span>';
    artistEl.innerHTML = artistHtml;

    var verifiedBadge = document.getElementById('sc-verified-badge');
    if (verifiedBadge) verifiedBadge.style.display = verified ? 'inline-flex' : 'none';
    songEl.textContent = title ? localizeText(title) : t('service.openIn');

    // Resolve artist page links for each artist name
    var lookupArtists = artistNames.slice();
    if (lookupArtists.length > 0) {
        loadMasterArtistNameSet().then(function(artistSet) {
            if (!artistSet) return;
            var nameLinks = artistEl.querySelectorAll('.sc-artist-name');
            nameLinks.forEach(function(linkEl) {
                var aName = linkEl.getAttribute('data-artist-name');
                if (aName && artistSet.has(normalizeArtistLookupName(aName))) {
                    linkEl.setAttribute('href', getArtistPageUrl(aName));
                }
            });
        });
    }

    // Determine dark mode: accent-luminance for verified (matching artist page), page-theme fallback
    var c1 = primaryAccent;
    var c2 = secondaryAccent || primaryAccent;
    var isDark;
    if (primaryAccent) {
        var _r1 = parseInt(c1.slice(1,3),16), _g1 = parseInt(c1.slice(3,5),16), _b1 = parseInt(c1.slice(5,7),16);
        var _r2 = parseInt(c2.slice(1,3),16), _g2 = parseInt(c2.slice(3,5),16), _b2 = parseInt(c2.slice(5,7),16);
        isDark = ((0.299*(_r1+_r2)/2 + 0.587*(_g1+_g2)/2 + 0.114*(_b1+_b2)/2) / 255) <= 0.45;
    } else {
        isDark = document.body.classList.contains('dark-mode') ||
                 document.documentElement.classList.contains('dark-mode') ||
                 document.body.classList.contains('vfx-dark');
    }
    overlay.classList.toggle('sc-dark', isDark);

    // Apply accent-themed full-dialog background (matching artist page cinematic styling)
    if (primaryAccent) {
        overlay.classList.add('sc-accent');
        overlay.classList.toggle('sc-accent-dark', isDark);
        overlay.classList.toggle('sc-accent-light', !isDark);

        // Header background = c1, text color based on c1 luminance (matching artist page exactly)
        var hR = parseInt(c1.slice(1,3),16), hG = parseInt(c1.slice(3,5),16), hB = parseInt(c1.slice(5,7),16);
        var headerLum = (0.299 * hR + 0.587 * hG + 0.114 * hB) / 255;
        var headerIsLight = headerLum > 0.55;
        var headerTc = headerIsLight ? '#000' : '#fff';
        var headerTcSub = headerIsLight ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';

        // Full-dialog gradient (matching artist page darkenHex/lightenHex approach)
        if (isDark) {
            var g1 = shadeHexColor(c1, -82) || c1, g2 = shadeHexColor(c2, -86) || c2, g3 = shadeHexColor(c1, -92) || c1;
            chooserEl.style.background = 'linear-gradient(135deg, ' + g1 + ' 0%, ' + g2 + ' 50%, ' + g3 + ' 100%)';
        } else {
            var l1 = shadeHexColor(c1, 84) || c1, l2 = shadeHexColor(c2, 87) || c2, l3 = shadeHexColor(c1, 92) || c1;
            chooserEl.style.background = 'linear-gradient(135deg, ' + l1 + ' 0%, ' + l2 + ' 50%, ' + l3 + ' 100%)';
        }
        headerEl.style.background = c1;

        // Header text color
        songEl.style.color = headerTc;
        artistEl.style.color = headerTcSub;
        var closeBtnEl = overlay.querySelector('.service-chooser-close');
        if (closeBtnEl) closeBtnEl.style.color = headerTc;

        // Border: subtle accent glow
        chooserEl.style.border = '1px solid ' + c2 + '50';

        // VFX effects across full dialog (artist-page style)
        var seed = (c1+c2).split('').reduce(function(a,ch){return a+ch.charCodeAt(0);},0);
        function scSeededRand(i) { var x = Math.sin(seed+i*127.1)*43758.5453; return x-Math.floor(x); }

        var vfxHtml = '';
        vfxHtml += '<div class="sc-vfx-layer sc-vfx-grid" style="background-image:linear-gradient(' + c2 + '18 1px, transparent 1px), linear-gradient(90deg, ' + c2 + '18 1px, transparent 1px);background-size:30px 30px;opacity:0.4;"></div>';
        var radBg = isDark
            ? 'radial-gradient(ellipse at 20% 30%, ' + c1 + '30 0%, transparent 60%), radial-gradient(ellipse at 80% 60%, ' + c2 + '25 0%, transparent 55%)'
            : 'radial-gradient(ellipse at 20% 30%, ' + c1 + '20 0%, transparent 60%), radial-gradient(ellipse at 80% 60%, ' + c2 + '18 0%, transparent 55%)';
        vfxHtml += '<div class="sc-vfx-layer" style="background:' + radBg + ';"></div>';
        var shapeTypes = ['circle', 'diamond', 'rect'];
        for (var si = 0; si < 6; si++) {
            var sType = shapeTypes[Math.floor(scSeededRand(si*31) * shapeTypes.length)];
            var sSize = 10 + scSeededRand(si*41) * 30;
            var sColor = si % 2 === 0 ? c1 : c2;
            vfxHtml += '<div class="sc-vfx-shape sc-vfx-shape--' + sType + '" style="width:' + sSize + 'px;height:' + sSize + 'px;left:' + (scSeededRand(si*53)*100) + '%;top:' + (scSeededRand(si*67)*80) + '%;border-color:' + sColor + ';animation-duration:' + (6+scSeededRand(si*71)*8) + 's;animation-delay:' + (scSeededRand(si*79)*3) + 's;"></div>';
        }
        vfxHtml += '<div class="sc-vfx-layer sc-vfx-grain"></div>';
        vfxHtml += '<div class="sc-vfx-sweep" style="background:linear-gradient(90deg, transparent, ' + c1 + '30, transparent);"></div>';
        vfxBgEl.innerHTML = vfxHtml;
        vfxBgEl.style.display = '';
    } else {
        overlay.classList.remove('sc-accent', 'sc-accent-dark', 'sc-accent-light');
        headerEl.style.background = '';
        chooserEl.style.background = '';
        chooserEl.style.border = '';
        vfxBgEl.innerHTML = '';
        vfxBgEl.style.display = 'none';
        songEl.style.color = '';
        artistEl.style.color = '';
        var closeBtnReset = overlay.querySelector('.service-chooser-close');
        if (closeBtnReset) closeBtnReset.style.color = '';
    }

    // Build service links
    var pref = getPreferredService();
    var linksHtml = '';
    for (var key in serviceDefinitions) {
        if (!serviceDefinitions.hasOwnProperty(key)) continue;
        var svc = serviceDefinitions[key];
        var isPreferred = key === pref;
        var url;
        if (key === 'spotify' && releaseUrl) {
            url = releaseUrl;
        } else if (key === 'youtube' && youtubeUrl) {
            url = youtubeUrl;
        } else {
            url = buildServiceSearchUrl(key, searchArtistName, title || '');
        }
        if (!url) continue;
        linksHtml +=
            '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="' + (isPreferred ? 'preferred' : '') + '">' +
                '<i class="' + svc.icon + '" style="color:' + svc.color + '"></i> ' + escHtml(svc.name) +
                (isPreferred ? ' <span class="pref-badge">★</span>' : '') +
            '</a>';
    }
    linksEl.innerHTML = linksHtml;

    // Apply accent hover borders to links (uniform c2 accent border)
    if (primaryAccent) {
        var scLinks = linksEl.querySelectorAll('a');
        for (var li = 0; li < scLinks.length; li++) {
            scLinks[li].style.setProperty('--link-accent', c2);
        }
    }

    // Ensure clean state then show
    overlay.classList.remove('closing');
    overlay.classList.add('visible');
}

/**
 * Close the service-chooser dialog.
 * @param {boolean} [animated=false] — play the reverse scale+blur animation
 */
function closeServiceChooserDialog(animated) {
    var ov = document.getElementById('service-chooser-overlay');
    if (!ov || !ov.classList.contains('visible')) return;

    if (animated) {
        ov.classList.add('closing');
        var sc = ov.querySelector('.service-chooser');
        var onEnd = function() {
            sc.removeEventListener('animationend', onEnd);
            ov.classList.remove('visible', 'closing');
        };
        sc.addEventListener('animationend', onEnd);
    } else {
        ov.classList.remove('visible');
    }
}
