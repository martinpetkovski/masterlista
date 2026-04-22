/**
 * i18n.js — Localization module for toplista.mk
 *
 * Loads translations from /translations.json and provides:
 *   - t(key)            — get a translated string for the current language
 *   - setLanguage(lang) — switch language and re-apply translations
 *   - getLanguage()     — get the current language code
 *   - getLanguages()    — get available languages [{code, name, flag}]
 *   - applyTranslations() — re-scan DOM for data-i18n attributes and update text
 *   - onLanguageChange(fn) — register a callback for language changes
 *
 * Include AFTER common.js and BEFORE page-specific scripts:
 *   <script src="/scripts/site/i18n.js"></script>
 *
 * HTML usage:
 *   <span data-i18n="nav.home">Дома</span>
 *   <span data-i18n-html="tour.step0.text">...</span>   (for HTML content)
 *   <input data-i18n-placeholder="common.search" placeholder="Пребарај">
 *   <button data-i18n-title="common.close" title="Затвори">×</button>
 */
(function() {
    'use strict';

    var STORAGE_KEY = 'mmm-language';
    var DEFAULT_LANG = 'mk';
    var _translations = null;
    var _langMeta = null;
    var _currentLang = DEFAULT_LANG;
    var _listeners = [];
    var _ready = false;
    var _readyCallbacks = [];

    // Check for ?lang= URL parameter (overrides saved preference)
    try {
        var urlParams = new URLSearchParams(window.location.search);
        var urlLang = urlParams.get('lang');
        if (urlLang) {
            _currentLang = urlLang;
            localStorage.setItem(STORAGE_KEY, urlLang);
        } else {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) _currentLang = saved;
        }
    } catch (e) {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) _currentLang = saved;
        } catch (e2) {}
    }

    // ---- Public API ----

    /**
     * Get a translated string by key. Returns the key itself if not found.
     * Supports nested dot-notation keys like "nav.home".
     */
    window.t = function(key, lang) {
        var l = lang || _currentLang;
        if (!_translations || !_translations[l]) {
            // Fallback: try default language
            if (_translations && _translations[DEFAULT_LANG]) {
                return _translations[DEFAULT_LANG][key] || key;
            }
            return key;
        }
        var val = _translations[l][key];
        if (val !== undefined) return val;
        // Fallback to default language
        if (l !== DEFAULT_LANG && _translations[DEFAULT_LANG]) {
            val = _translations[DEFAULT_LANG][key];
            if (val !== undefined) return val;
        }
        return key;
    };

    window.getLanguage = function() {
        return _currentLang;
    };

    window.setLanguage = function(lang) {
        if (!_langMeta || !_langMeta[lang]) return;
        // Load language file if not yet loaded
        if (!_translations[lang]) {
            loadLanguageSync(lang);
            // Merge metadata
            if (_langMeta[lang]) {
                var meta = _langMeta[lang];
                if (!_translations[lang]) _translations[lang] = {};
                if (meta._name) _translations[lang]._name = meta._name;
                if (meta._flag) _translations[lang]._flag = meta._flag;
                if (meta._script) _translations[lang]._script = meta._script;
            }
        }
        if (!_translations[lang]) return;
        _currentLang = lang;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        document.documentElement.lang = lang;
        applyTranslations();
        for (var i = 0; i < _listeners.length; i++) {
            try { _listeners[i](lang); } catch (e) {}
        }
    };

    /**
     * Get the script type ('cyrillic' or 'latin') for the current language.
     */
    window.getLanguageScript = function() {
        if (!_translations || !_translations[_currentLang]) return 'cyrillic';
        return _translations[_currentLang]._script || 'cyrillic';
    };

    /**
     * Transliterate text based on the current language script.
     * Latin: uses spotifyName map or Cyrillic→Latin transliteration.
     * Greek: uses Cyrillic→Greek transliteration.
     * Cyrillic: returns text unchanged.
     */
    var _artistLatinMap = {}; // lowercase Cyrillic name → spotifyName

    window.registerArtistNames = function(bandsArray) {
        if (!Array.isArray(bandsArray)) return;
        _artistLatinMap = {};
        for (var i = 0; i < bandsArray.length; i++) {
            var b = bandsArray[i];
            if (b.name && b.spotifyName) {
                _artistLatinMap[b.name.toLowerCase()] = b.spotifyName;
            }
        }
    };

    window.localizeText = function(text) {
        if (!text || typeof text !== 'string') return text || '';
        var script = getLanguageScript();
        if (script === 'latin') {
            var lower = text.trim().toLowerCase();
            if (_artistLatinMap[lower]) return _artistLatinMap[lower];
            if (typeof transliterateCyrillicToLatin === 'function') return transliterateCyrillicToLatin(text);
            return text;
        }
        if (script === 'greek') {
            if (typeof transliterateCyrillicToGreek === 'function') return transliterateCyrillicToGreek(text);
            return text;
        }
        return text;
    };

    window.getLanguages = function() {
        if (!_langMeta) return [];
        var list = [];
        for (var code in _langMeta) {
            if (!_langMeta.hasOwnProperty(code)) continue;
            list.push({
                code: code,
                name: _langMeta[code]._name || code,
                flag: _langMeta[code]._flag || ''
            });
        }
        return list;
    };

    window.onLanguageChange = function(fn) {
        if (typeof fn === 'function') _listeners.push(fn);
    };

    window.onI18nReady = function(fn) {
        if (_ready) { fn(); return; }
        _readyCallbacks.push(fn);
    };

    /**
     * Scan the DOM for elements with data-i18n, data-i18n-html,
     * data-i18n-placeholder, data-i18n-title and apply translations.
     */
    window.applyTranslations = applyTranslations;
    function applyTranslations() {
        if (!_translations) return;

        // data-i18n — set textContent
        var els = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < els.length; i++) {
            var key = els[i].getAttribute('data-i18n');
            var val = t(key);
            if (val !== key) els[i].textContent = val;
        }

        // data-i18n-html — set innerHTML (for strings with <strong>, <br> etc.)
        var htmlEls = document.querySelectorAll('[data-i18n-html]');
        for (var j = 0; j < htmlEls.length; j++) {
            var hKey = htmlEls[j].getAttribute('data-i18n-html');
            var hVal = t(hKey);
            if (hVal !== hKey) htmlEls[j].innerHTML = hVal;
        }

        // data-i18n-placeholder — set placeholder attribute
        var phEls = document.querySelectorAll('[data-i18n-placeholder]');
        for (var k = 0; k < phEls.length; k++) {
            var pKey = phEls[k].getAttribute('data-i18n-placeholder');
            var pVal = t(pKey);
            if (pVal !== pKey) phEls[k].placeholder = pVal;
        }

        // data-i18n-title — set title attribute
        var tEls = document.querySelectorAll('[data-i18n-title]');
        for (var m = 0; m < tEls.length; m++) {
            var tKey = tEls[m].getAttribute('data-i18n-title');
            var tVal = t(tKey);
            if (tVal !== tKey) tEls[m].title = tVal;
        }
    }

    // ---- Load translations ----

    /** Synchronously load a single language file into _translations[lang]. */
    function loadLanguageSync(lang) {
        if (_translations[lang]) return true;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/data/static/lang/' + lang + '.json', false);
        try {
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _translations[lang] = JSON.parse(xhr.responseText);
                return true;
            }
        } catch (e) {}
        return false;
    }

    function loadTranslations() {
        _translations = {};

        // Load the language manifest (metadata for all languages)
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/data/static/lang/languages.json', false);
        try {
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                _langMeta = JSON.parse(xhr.responseText);
            }
        } catch (e) {}

        // Load current language
        if (!loadLanguageSync(_currentLang)) {
            _currentLang = DEFAULT_LANG;
            loadLanguageSync(DEFAULT_LANG);
        }

        // Also load default language for fallback
        if (_currentLang !== DEFAULT_LANG) {
            loadLanguageSync(DEFAULT_LANG);
        }

        // Merge metadata into loaded translations for script/name/flag lookups
        if (_langMeta) {
            for (var code in _langMeta) {
                if (!_langMeta.hasOwnProperty(code)) continue;
                if (!_translations[code]) _translations[code] = {};
                var meta = _langMeta[code];
                if (meta._name) _translations[code]._name = meta._name;
                if (meta._flag) _translations[code]._flag = meta._flag;
                if (meta._script) _translations[code]._script = meta._script;
            }
        }

        // Set html lang attribute
        document.documentElement.lang = _currentLang;

        _ready = true;
        for (var i = 0; i < _readyCallbacks.length; i++) {
            try { _readyCallbacks[i](); } catch (e) {}
        }
        _readyCallbacks = [];
    }

    // Load immediately (synchronous)
    loadTranslations();

    // Apply translations once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyTranslations);
    } else {
        applyTranslations();
    }
})();
