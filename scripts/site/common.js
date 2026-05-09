/**
 * common.js — Shared utilities for toplista.mk
 *
 * Centralises functions that were previously duplicated across
 * index.html, toplista.html, charts.html, artist.html, kustos.html,
 * kustosi.html, nastani.html, nastan.html, vesti.html, iznenadi-me.html.
 *
 * Include this file BEFORE the page-specific <script> block:
 *   <script src="/scripts/site/common.js"></script>
 */

// ==================== HTML ESCAPING ====================
function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== DATA URL REMAPPING ====================
var MASTERLISTA_DATA_PATH_ALIASES = {
    '/bands.json': '/data/dynamic/editable/bands.json',
    '/events.json': '/data/dynamic/editable/events.json',
    '/releases.json': '/data/dynamic/editable/releases.json',
    '/genres.json': '/data/static/genres.json',
    '/chart-genres.json': '/data/static/chart-genres.json',
    '/loading-messages.json': '/data/static/loading-messages.json',
    '/curators.json': '/data/static/curators.json',
    '/rss-feeds.json': '/data/static/rss-feeds.json',
    '/spotify-playlists.json': '/data/static/spotify-playlists.json',
    '/articles.json': '/data/dynamic/generated/articles.json',
    '/articles-filtered.json': '/data/dynamic/generated/articles-filtered.json',
    '/interviews.json': '/data/dynamic/generated/interviews.json',
    '/interviews-filtered.json': '/data/dynamic/generated/interviews-filtered.json',
    '/radio-source.json': '/data/dynamic/generated/radio-source.json',
    '/chart-data.json': '/data/dynamic/generated/chart-data.json',
    '/chart-history-data.json': '/data/dynamic/generated/chart-history-data.json',
    '/site-master.json': '/data/dynamic/generated/site-master.json',
    '/advanced-charts.json': '/data/dynamic/generated/advanced-charts.json',
    '/artist-data.json': '/data/dynamic/generated/artist-data.json',
    '/curators-tracklists.json': '/data/dynamic/generated/curators-tracklists.json'
};

function resolveMasterlistaDataUrl(url) {
    if (!url || typeof url !== 'string') return url;

    var hashIndex = url.indexOf('#');
    var hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    var withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    var queryIndex = withoutHash.indexOf('?');
    var query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
    var barePath = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;

    if (barePath && barePath.indexOf('://') === -1 && barePath.charAt(0) !== '/') {
        if (MASTERLISTA_DATA_PATH_ALIASES['/' + barePath]) {
            return MASTERLISTA_DATA_PATH_ALIASES['/' + barePath] + query + hash;
        }
        if (barePath.indexOf('chart-history/') === 0) {
            return '/data/dynamic/generated/' + barePath + query + hash;
        }
        if (barePath.indexOf('lang/') === 0) {
            return '/data/static/' + barePath + query + hash;
        }
    }

    var parsed;
    try {
        parsed = new URL(url, window.location.href);
    } catch (e) {
        return url;
    }

    if (parsed.origin !== window.location.origin) return url;

    var mappedPath = MASTERLISTA_DATA_PATH_ALIASES[parsed.pathname];
    if (!mappedPath) {
        if (parsed.pathname.indexOf('/chart-history/') === 0) {
            mappedPath = '/data/dynamic/generated' + parsed.pathname;
        } else if (parsed.pathname.indexOf('/lang/') === 0) {
            mappedPath = '/data/static' + parsed.pathname;
        } else {
            return url;
        }
    }

    parsed.pathname = mappedPath;
    return parsed.toString();
}

window.resolveMasterlistaDataUrl = resolveMasterlistaDataUrl;

(function patchMasterlistaDataRequests() {
    if (window.__mmmDataUrlPatched) return;
    window.__mmmDataUrlPatched = true;

    function remapRequestInput(input) {
        if (typeof input === 'string') {
            return resolveMasterlistaDataUrl(input);
        }
        if (typeof Request !== 'undefined' && input instanceof Request) {
            var resolvedUrl = resolveMasterlistaDataUrl(input.url);
            if (resolvedUrl === input.url) return input;
            return new Request(resolvedUrl, input);
        }
        return input;
    }

    if (typeof window.fetch === 'function') {
        var nativeFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            return nativeFetch(remapRequestInput(input), init);
        };
    }

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype && !window.XMLHttpRequest.prototype.__mmmDataOpenPatched) {
        var nativeOpen = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function(method, url) {
            var args = Array.prototype.slice.call(arguments);
            if (typeof url === 'string') {
                args[1] = resolveMasterlistaDataUrl(url);
            }
            return nativeOpen.apply(this, args);
        };
        window.XMLHttpRequest.prototype.__mmmDataOpenPatched = true;
    }
})();

// ==================== THEME STATE (shared) ====================
var THEME_STORAGE_KEY = 'mmm-dark-mode';
var THEME_CHANGE_EVENT = 'mmm-theme-change';
var THEME_DARK_BACKGROUND = '#111318';

function isStoredDarkModeEnabled() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

function isDarkThemeActive() {
    return document.documentElement.classList.contains('dark-mode') ||
        !!(document.body && document.body.classList.contains('dark-mode'));
}

function syncThemeButtons(isDark) {
    var overlay = document.getElementById('settings-overlay');
    if (!overlay) return;
    overlay.querySelectorAll('.settings-theme-btn').forEach(function(btn) {
        btn.classList.toggle('active', (btn.dataset.theme === 'dark') === isDark);
    });
}

function applyThemeMode(isDark, options) {
    var opts = options || {};
    var root = document.documentElement;
    var body = document.body;
    var previousRootDark = root.classList.contains('dark-mode');
    var previousBodyDark = !!(body && body.classList.contains('dark-mode'));

    root.classList.toggle('dark-mode', isDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    root.style.backgroundColor = isDark ? THEME_DARK_BACKGROUND : '';
    if (isDark) {
        root.style.colorScheme = 'dark';
    } else {
        root.style.removeProperty('color-scheme');
    }

    if (body) {
        body.classList.toggle('dark-mode', isDark);
        body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    if (opts.persist !== false) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, String(isDark));
        } catch (e) {
            // Ignore storage failures and still apply the visible theme state.
        }
    }

    syncThemeButtons(isDark);

    if (opts.dispatchEvent !== false && (previousRootDark !== isDark || previousBodyDark !== isDark)) {
        window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
            detail: {
                dark: isDark,
                source: opts.source || 'programmatic'
            }
        }));
    }

    return isDark;
}

function syncStoredThemeMode() {
    return applyThemeMode(isStoredDarkModeEnabled(), {
        persist: false,
        source: 'boot'
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncStoredThemeMode);
} else {
    syncStoredThemeMode();
}

window.addEventListener('storage', function(e) {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyThemeMode(e.newValue === 'true', {
        persist: false,
        source: 'storage'
    });
});

// ==================== COMPACT COUNT FORMATTERS ====================
function getCompactCountParts(value) {
    if (value == null || value === '') return null;

    var num = Number(value);
    if (!isFinite(num)) return null;

    var abs = Math.abs(num);
    var unit = '';
    var scaled = abs;

    if (abs >= 1000000000) {
        scaled = abs / 1000000000;
        unit = 'B';
    } else if (abs >= 1000000) {
        scaled = abs / 1000000;
        unit = 'M';
    } else if (abs >= 1000) {
        scaled = abs / 1000;
        unit = 'K';
    }

    return {
        value: num,
        isNegative: num < 0,
        unit: unit,
        numberText: unit ? scaled.toFixed(1) : String(abs)
    };
}

var compactCountBadgeInstanceCounter = 0;

function getCompactCountBadgeTheme(unitLower) {
    var themes = {
        k: {
            letter: 'K',
            field: '#0A3D7E',
            clothTop: '#062A55',
            clothMid: '#0A3D7E',
            clothBottom: '#041A35',
            accentDark: '#0F4F9E',
            accentMid: '#2E79D0',
            accentLight: '#A8D3FF',
            metalLight: '#E4F2FF',
            metalMid: '#86B5E3',
            metalDark: '#3A679A',
            ribbonTop: '#F2F8FF',
            ribbonBottom: '#C9DEF4',
            letterX: '300',
            letterY: '415',
            shadowX: '309',
            shadowY: '427',
            letterSize: '224'
        },
        m: {
            letter: 'M',
            field: '#B62525',
            clothTop: '#7A1414',
            clothMid: '#B62525',
            clothBottom: '#390707',
            accentDark: '#982020',
            accentMid: '#E44F4F',
            accentLight: '#FFC7BF',
            metalLight: '#FFE8E2',
            metalMid: '#E79B96',
            metalDark: '#9E4C4C',
            ribbonTop: '#FFF3F0',
            ribbonBottom: '#F3CAC2',
            letterX: '300',
            letterY: '412',
            shadowX: '309',
            shadowY: '424',
            letterSize: '216'
        },
        b: {
            letter: 'B',
            field: '#B8860B',
            clothTop: '#6C4A00',
            clothMid: '#B8860B',
            clothBottom: '#442E00',
            accentDark: '#8D6500',
            accentMid: '#CFA22D',
            accentLight: '#FFE6A2',
            metalLight: '#FFF2C9',
            metalMid: '#E0C277',
            metalDark: '#9B7A2F',
            ribbonTop: '#FFF8E2',
            ribbonBottom: '#EFDEAE',
            letterX: '300',
            letterY: '415',
            shadowX: '309',
            shadowY: '427',
            letterSize: '224'
        }
    };

    return themes[unitLower] || themes.k;
}

function buildCompactCountBadgeCharge(unitLower, fills) {
    if (unitLower === 'm') {
        return [
            '<g transform="translate(0 8)">',
                '<path d="M206 528C238 502 362 502 394 528C365 547 235 547 206 528Z" fill="#0F0F0F" opacity="0.14"/>',
                '<path d="M214 410L386 410L352 362L248 362Z" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M230 399L370 399L347 372L253 372Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M226 437L374 437L358 506L242 506Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M246 447L354 447L343 497L257 497Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="248,438 263,438 255,506 240,506" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="352,438 337,438 345,506 360,506" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="291,456 309,456 306,480 294,480" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M245 388C258 378 282 378 295 388C300 393 300 401 295 406C282 416 258 416 245 406C240 401 240 393 245 388Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M286 379C299 370 325 370 338 379C343 384 343 392 338 397C325 406 299 406 286 397C281 392 281 384 286 379Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M327 388C340 378 364 378 377 388C382 393 382 401 377 406C364 416 340 416 327 406C322 401 322 393 327 388Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="265,381 277,364 290,381 277,394" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="306,373 319,357 331,373 319,386" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="347,381 359,365 372,381 359,394" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M236 383C248 374 262 368 278 365" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.14"/>',
                '<path d="M230 437C257 426 343 426 370 437" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.12"/>',
            '</g>'
        ].join('');
    }

    if (unitLower === 'b') {
        return [
            '<g transform="translate(0 6)">',
                '<path d="M218 525C252 503 348 503 382 525C355 542 245 542 218 525Z" fill="#0F0F0F" opacity="0.14"/>',
                '<path d="M228 507C243 496 275 496 290 507C296 512 296 520 290 525C275 536 243 536 228 525C222 520 222 512 228 507Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M285 500C301 489 333 489 349 500C355 505 355 513 349 518C333 529 301 529 285 518C279 513 279 505 285 500Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M338 507C351 497 379 497 392 507C397 511 397 518 392 522C379 532 351 532 338 522C333 518 333 511 338 507Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="264,499 276,483 288,499 276,511" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="323,493 336,476 349,493 336,505" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="366,500 378,484 390,500 378,512" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="308,386 338,333 390,321 372,362 406,378 360,394" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M338 385C352 369 377 364 395 373C404 378 406 390 400 401C391 415 373 423 351 422L340 434L343 410C333 401 331 392 338 385Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="367,365 379,347 382,368" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M352 422C365 427 381 427 395 418C387 432 374 440 357 440Z" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M222 500C190 489 173 456 182 425C192 388 227 367 268 370C310 373 338 395 345 426C351 453 338 480 313 492C286 505 252 500 236 478C225 463 227 445 241 433C255 421 276 422 289 435C269 433 254 440 247 451C240 462 246 476 266 487C293 501 324 491 340 470C356 450 356 418 338 397C317 372 278 364 241 377C208 389 188 418 190 451C192 482 211 508 240 521L229 537L275 532L265 507C248 505 233 501 222 500Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="300,482 320,494 307,505" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<polygon points="328,489 346,501 333,512" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
                '<path d="M220 397C237 383 258 376 280 377" fill="none" stroke="#0F0F0F" stroke-width="2.4" stroke-linecap="round" opacity="0.36"/>',
                '<path d="M216 430C239 415 267 410 294 413" fill="none" stroke="#0F0F0F" stroke-width="2.4" stroke-linecap="round" opacity="0.36"/>',
                '<path d="M214 493C236 507 256 514 280 518C307 523 330 520 346 508" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.12"/>',
            '</g>'
        ].join('');
    }

    return [
        '<g transform="translate(0 10)">',
            '<path d="M224 516C250 499 350 499 376 516C350 532 250 532 224 516Z" fill="#0F0F0F" opacity="0.14"/>',
            '<path d="M262 425C277 415 323 415 338 425C344 431 344 441 338 447C323 457 277 457 262 447C256 441 256 431 262 425Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M262 447C277 457 323 457 338 447L338 460C323 470 277 470 262 460Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M272 432C286 423 314 423 328 432" fill="none" stroke="#0F0F0F" stroke-width="2.2" stroke-linecap="round" opacity="0.34"/>',
            '<path d="M250 457C266 447 334 447 350 457C356 463 356 473 350 479C334 489 266 489 250 479C244 473 244 463 250 457Z" fill="' + fills.goldDiag + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M250 479C266 489 334 489 350 479L350 492C334 502 266 502 250 492Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M262 464C278 455 322 455 338 464" fill="none" stroke="#0F0F0F" stroke-width="2.2" stroke-linecap="round" opacity="0.34"/>',
            '<path d="M238 490C256 480 344 480 362 490C368 496 368 506 362 512C344 522 256 522 238 512C232 506 232 496 238 490Z" fill="' + fills.goldRadial + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M238 512C256 522 344 522 362 512L362 525C344 535 256 535 238 525Z" fill="' + fills.goldMain + '" stroke="#0F0F0F" stroke-width="4" stroke-linejoin="round"/>',
            '<path d="M252 497C273 487 327 487 348 497" fill="none" stroke="#0F0F0F" stroke-width="2.2" stroke-linecap="round" opacity="0.34"/>',
            '<path d="M248 423C259 413 272 407 287 404" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.12"/>',
        '</g>'
    ].join('');
}

function buildCompactUnitBadgeSvg(unit, exactValueText) {
    if (!unit) return '';

    var unitLower = unit.toLowerCase();
    var theme = getCompactCountBadgeTheme(unitLower);
    var badgeId = 'compact-letter-' + unitLower + '-' + (++compactCountBadgeInstanceCounter);
    var letterBodyId = badgeId + '-letter-body';
    var letterFaceId = badgeId + '-letter-face';
    var letterGlowId = badgeId + '-letter-glow';
    var letterSweepId = badgeId + '-letter-sweep';
    var letterRimId = badgeId + '-letter-rim';
    var letterEdgeSweepId = badgeId + '-letter-edge-sweep';
    var letterBody = 'url(#' + letterBodyId + ')';
    var letterFace = 'url(#' + letterFaceId + ')';
    var letterGlow = 'url(#' + letterGlowId + ')';
    var letterSweep = 'url(#' + letterSweepId + ')';
    var letterRim = 'url(#' + letterRimId + ')';
    var letterEdgeSweep = 'url(#' + letterEdgeSweepId + ')';
    var badgeFontFamily = "'Arial Black', 'Arial Narrow Bold', Montserrat, Arial, Helvetica, sans-serif";
    var letterStroke = '#0F0F0F';
    var letterTextAttrs = ' text-anchor="middle" font-family="' + badgeFontFamily + '" font-weight="900" letter-spacing="0"';
    var badgeLetterX = String(180 + (unitLower === 'k' ? -8 : unitLower === 'm' ? -2 : -1));
    var badgeLetterY = unitLower === 'm' ? '302' : '306';
    var badgeLetterSize = unitLower === 'm' ? '296' : '308';
    var letterShadowX = String(Number(badgeLetterX) + 10);
    var letterShadowY = String(Number(badgeLetterY) + 14);
    var letterDepthX = String(Number(badgeLetterX) + 5);
    var letterDepthY = String(Number(badgeLetterY) + 8);
    var letterFaceY = String(Number(badgeLetterY) - 6);
    var letterFaceSize = String(Number(badgeLetterSize) - 44);
    var letterHighlightX = String(Number(badgeLetterX) - 6);
    var letterHighlightY = String(Number(badgeLetterY) - 12);
    var letterHighlightSize = String(Number(badgeLetterSize) - 60);
    var badgeTitle = exactValueText ? escHtml(exactValueText) : '';
    var badgeTitleAttr = badgeTitle ? ' title="' + badgeTitle + '"' : '';

    return [
        '<svg class="compact-count-badge-svg compact-count-badge-svg--' + unitLower + '" viewBox="0 0 360 420" aria-hidden="true" focusable="false"' + badgeTitleAttr + ' text-rendering="geometricPrecision" style="min-width:0.84rem;min-height:0.96rem;">',
            (badgeTitle ? '<title>' + badgeTitle + '</title>' : ''),
            '<defs>',
                '<linearGradient id="' + letterBodyId + '" x1="0" y1="0" x2="0" y2="1">',
                    '<stop offset="0" stop-color="' + theme.clothTop + '"/>',
                    '<stop offset="0.28" stop-color="' + theme.accentMid + '"/>',
                    '<stop offset="0.58" stop-color="' + theme.field + '"/>',
                    '<stop offset="0.8" stop-color="' + theme.accentDark + '"/>',
                    '<stop offset="1" stop-color="' + theme.clothBottom + '"/>',
                '</linearGradient>',
                '<linearGradient id="' + letterFaceId + '" x1="0" y1="0" x2="1" y2="1">',
                    '<stop offset="0" stop-color="' + theme.accentLight + '"/>',
                    '<stop offset="0.35" stop-color="' + theme.field + '"/>',
                    '<stop offset="0.72" stop-color="' + theme.accentDark + '"/>',
                    '<stop offset="1" stop-color="' + theme.accentLight + '"/>',
                '</linearGradient>',
                '<radialGradient id="' + letterGlowId + '" cx="0.32" cy="0.16" r="0.9">',
                    '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.88"/>',
                    '<stop offset="0.38" stop-color="' + theme.accentLight + '" stop-opacity="0.45"/>',
                    '<stop offset="1" stop-color="' + theme.accentLight + '" stop-opacity="0"/>',
                '</radialGradient>',
                '<linearGradient id="' + letterRimId + '" x1="0" y1="0" x2="0" y2="1">',
                    '<stop offset="0" stop-color="' + theme.metalLight + '"/>',
                    '<stop offset="0.24" stop-color="' + theme.accentLight + '"/>',
                    '<stop offset="0.56" stop-color="' + theme.field + '"/>',
                    '<stop offset="0.82" stop-color="' + theme.accentDark + '"/>',
                    '<stop offset="1" stop-color="' + theme.clothBottom + '"/>',
                '</linearGradient>',
                '<linearGradient id="' + letterSweepId + '" gradientUnits="userSpaceOnUse" x1="-160" y1="40" x2="-10" y2="330">',
                    '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.92"/>',
                    '<stop offset="0.58" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<animate attributeName="x1" values="-160;520" dur="2.4s" repeatCount="indefinite"/>',
                    '<animate attributeName="x2" values="-10;670" dur="2.4s" repeatCount="indefinite"/>',
                '</linearGradient>',
                '<linearGradient id="' + letterEdgeSweepId + '" gradientUnits="userSpaceOnUse" x1="-120" y1="-20" x2="80" y2="150">',
                    '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="0.46" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="0.52" stop-color="#FFFFFF" stop-opacity="0.86"/>',
                    '<stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>',
                    '<animate attributeName="x1" values="-120;420" dur="2.8s" begin="-0.75s" repeatCount="indefinite"/>',
                    '<animate attributeName="x2" values="80;620" dur="2.8s" begin="-0.75s" repeatCount="indefinite"/>',
                '</linearGradient>',
            '</defs>',
            '<g>',
                '<text x="' + letterShadowX + '" y="' + letterShadowY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="#0F0F0F" opacity="0.22">' + escHtml(theme.letter) + '</text>',
                '<text x="' + letterDepthX + '" y="' + letterDepthY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="' + theme.clothBottom + '" opacity="0.88">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + badgeLetterY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="' + letterBody + '" stroke="' + letterStroke + '" stroke-width="14" stroke-linejoin="round" paint-order="stroke fill">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + letterFaceY + '"' + letterTextAttrs + ' font-size="' + letterFaceSize + '" fill="' + letterFace + '" opacity="0.8">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + letterFaceY + '"' + letterTextAttrs + ' font-size="' + letterFaceSize + '" fill="' + letterGlow + '" opacity="0.28">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + badgeLetterY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="none" stroke="' + letterRim + '" stroke-width="9" stroke-linejoin="round" opacity="0.84">' + escHtml(theme.letter) + '</text>',
                '<text x="' + letterHighlightX + '" y="' + letterHighlightY + '"' + letterTextAttrs + ' font-size="' + letterHighlightSize + '" fill="#FFFFFF" opacity="0.12">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + badgeLetterY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="' + letterSweep + '" opacity="0.78">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + badgeLetterY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="none" stroke="' + letterEdgeSweep + '" stroke-width="14" stroke-linejoin="round" opacity="0.58">' + escHtml(theme.letter) + '</text>',
                '<text x="' + badgeLetterX + '" y="' + badgeLetterY + '"' + letterTextAttrs + ' font-size="' + badgeLetterSize + '" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="96 240" stroke-dashoffset="180" opacity="0.08">' + escHtml(theme.letter) + '<animate attributeName="stroke-dashoffset" values="180;-150" dur="2.55s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.08;0.8;0.18;0.08" dur="2.55s" repeatCount="indefinite"/></text>',
            '</g>',
        '</svg>'
    ].join('');
}

function formatCompactCountPlain(value, options) {
    var parts = getCompactCountParts(value);
    if (!parts) return '';

    var prefix = '';
    if (parts.isNegative) prefix = '-';
    else if (options && options.showPlus && parts.value > 0) prefix = '+';

    return prefix + parts.numberText + parts.unit;
}

function formatCompactCountHtml(value, options) {
    var parts = getCompactCountParts(value);
    if (!parts) return '';
    var numericValue = Number(value) || 0;

    var prefixText = '';
    if (parts.isNegative) prefixText = '-';
    else if (options && options.showPlus && parts.value > 0) prefixText = '+';
    var exactValueText = prefixText + Math.abs(numericValue).toLocaleString();
    var displayPrefixHtml = '';

    if (prefixText) {
        if (prefixText === '+' && options && options.positivePrefixHtml) {
            displayPrefixHtml = options.positivePrefixHtml;
        } else {
            displayPrefixHtml = '<span class="compact-count-sign">' + escHtml(prefixText) + '</span>';
        }
    }

    if (!parts.unit) {
        return displayPrefixHtml + '<span class="compact-count-plain">' + escHtml(parts.numberText) + '</span>';
    }

    return '' +
        displayPrefixHtml +
        '<span class="compact-count compact-count--' + parts.unit.toLowerCase() + '" title="' + escHtml(exactValueText) + '">' +
            '<span class="compact-count-value">' + escHtml(parts.numberText) + '</span>' +
            buildCompactUnitBadgeSvg(parts.unit, exactValueText) +
        '</span>';
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

function hashStringSeed(value) {
    var text = String(value == null ? '' : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getSeededOrder(arr, seedKey) {
    var seed = hashStringSeed(seedKey);
    return arr.slice().map(function(item, index) {
        var value = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
        value ^= value << 13;
        value >>>= 0;
        value ^= value >>> 17;
        value >>>= 0;
        value ^= value << 5;
        value >>>= 0;
        return {
            item: item,
            index: index,
            weight: value
        };
    }).sort(function(a, b) {
        if (a.weight !== b.weight) return a.weight - b.weight;
        return a.index - b.index;
    }).map(function(entry) {
        return entry.item;
    });
}

function getDateKeyInTimeZone(timeZone) {
    try {
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        var values = {};
        parts.forEach(function(part) {
            values[part.type] = part.value;
        });
        if (values.year && values.month && values.day) {
            return values.year + '-' + values.month + '-' + values.day;
        }
    } catch (e) {
        // Fall back to local date if timezone formatting is unavailable.
    }
    return new Date().toISOString().slice(0, 10);
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
            if (!existing.chartIssueCode && r.chartIssueCode) {
                existing.chartIssueCode = r.chartIssueCode;
                existing.chartIssueLabel = r.chartIssueLabel;
                existing.chartIssueReason = r.chartIssueReason;
            }
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
var altGenres = ['Alternative'];
var nonAltGenres = rapGenres.concat(electronicGenres, popGenres);

function _rebuildGenreConfig() {
    nonAltGenres = rapGenres.concat(electronicGenres, popGenres);
    genreConfig = {
        'alt': { label: 'Alternative', tKey: 'charts.genreAlt', isExclusion: true, excludeGenres: nonAltGenres, includeGenres: altGenres },
        'rap': { label: 'Rap/Trap', tKey: 'charts.genreRap', genres: rapGenres },
        'electronic': { label: 'Electronic', tKey: 'charts.genreElectronic', genres: electronicGenres },
        'pop': { label: 'Pop', tKey: 'charts.genrePop', genres: popGenres }
    };
}

var genreConfig = {
    'alt': { label: 'Alternative', tKey: 'charts.genreAlt', isExclusion: true, excludeGenres: nonAltGenres, includeGenres: altGenres },
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
            if (data.alternative) altGenres = data.alternative;
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

function splitLabels(labelStr) {
    if (!labelStr || labelStr.toLowerCase() === 'недостигаат податоци') return [];
    return labelStr.split(/,\s*/).map(function(label) { return label.trim().toLowerCase(); }).filter(Boolean);
}

function artistHasLabel(artistName, labelName, bandsData) {
    if (!artistName || !labelName || !bandsData) return false;

    var targetLabel = String(labelName).trim().toLowerCase();
    var artistNames = artistName.split(',').map(function(name) { return name.trim(); }).filter(Boolean);
    if (artistNames.length === 0) artistNames = [artistName];

    for (var i = 0; i < artistNames.length; i++) {
        var info = getArtistInfoByName(artistNames[i], bandsData);
        if (!info) continue;
        if (splitLabels(info.label).indexOf(targetLabel) !== -1) return true;
    }

    return false;
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
        if (config.includeGenres) {
            var includeLower = config.includeGenres.map(function(g) { return g.toLowerCase(); });
            if (artistGenres.some(function(ag) {
                return includeLower.some(function(ig) { return ag === ig; });
            })) return true;
        }
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

    filtered = filtered.filter(function(r) {
        return !r.chartIssueCode && !artistHasLabel(r.bandName, 'AI', bands);
    });

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
 * Primary: null viewsDelta last, nonzero deltas before zero, then viewsDelta desc,
 * youtubeViews desc, name asc.
 */
function chartSort(a, b) {
    var aNull = (a.viewsDelta == null) ? 1 : 0;
    var bNull = (b.viewsDelta == null) ? 1 : 0;
    if (aNull !== bNull) return aNull - bNull;
    var aZero = (Number(a.viewsDelta || 0) === 0) ? 1 : 0;
    var bZero = (Number(b.viewsDelta || 0) === 0) ? 1 : 0;
    if (aZero !== bZero) return aZero - bZero;
    var deltaDiff = Number(b.viewsDelta || 0) - Number(a.viewsDelta || 0);
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
        var isDark = isDarkThemeActive();

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
                applyThemeMode(dark, {
                    source: 'settings'
                });
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
            syncThemeButtons(isDarkThemeActive());
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
            var header = trigger.closest('header');
            if (window.innerWidth <= 600 || (header && header.classList.contains('nav-collapsed'))) {
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
            if (data) {
                // If site-master is already cached, merge immediately
                if (_siteMasterCache) {
                    _siteMasterCache.artistPopularityGraphs = data.artistPopularityGraphs || {};
                    _siteMasterCache.releaseSparklines = data.releaseSparklines || {};
                    _siteMasterCache.artistActivity = data.artistActivity || {};
                    return _siteMasterCache;
                }
                // Otherwise wait for site-master to load, then merge
                return (_siteMasterPromise || loadSiteMaster()).then(function(sm) {
                    if (sm) {
                        sm.artistPopularityGraphs = data.artistPopularityGraphs || {};
                        sm.releaseSparklines = data.releaseSparklines || {};
                        sm.artistActivity = data.artistActivity || {};
                    }
                    return sm;
                });
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

// ==================== GITHUB AUTH (shared) ====================
window.MMMAuth = (function () {
    var SESSION_KEY = 'mmm_github_session';
    var USER_KEY = 'mmm_github_user';
    var PR_ENDPOINT_KEY = 'mmm_pr_endpoint';
    var DEFAULT_ENDPOINT = 'https://muzichka-master-lista.deeeeelay.workers.dev';
    var CHANGE_EVENT = 'mmm-auth-changed';
    var state = { sessionId: null, user: null, ready: false };
    var listeners = [];
    var languageBound = false;
    var authStatus = null;

    function text(key, fallback) {
        if (typeof t !== 'function') return fallback;
        var value = t(key);
        return value === key ? fallback : value;
    }

    function getEndpoint() {
        if (typeof window.MMM_PR_ENDPOINT === 'string' && window.MMM_PR_ENDPOINT.trim()) return window.MMM_PR_ENDPOINT.trim().replace(/\/+$/, '');
        try {
            var stored = localStorage.getItem(PR_ENDPOINT_KEY);
            if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '');
        } catch (_) {}
        return DEFAULT_ENDPOINT;
    }

    function notify(message, type) {
        type = type || 'info';
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
            return;
        }
        if (window.MMMDrafts && typeof window.MMMDrafts.notify === 'function') {
            window.MMMDrafts.notify(message, type);
            return;
        }
        var container = document.getElementById('mmm-notifications');
        if (!container && document.body) {
            container = document.createElement('div');
            container.id = 'mmm-notifications';
            container.className = 'notification-area';
            container.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:10001;max-width:340px;';
            document.body.appendChild(container);
        }
        if (!container) {
            alert(message);
            return;
        }
        var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
        var el = document.createElement('div');
        el.className = 'notification ' + type;
        el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + escHtml(message);
        container.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 300);
        }, 5000);
    }

    function authUnavailableMessage() {
        return text('auth.unavailable', 'GitHub login is not available yet. You can still submit changes without signing in.');
    }

    async function getAuthStatus(force) {
        if (authStatus && !force) return authStatus;
        try {
            var resp = await fetch(getEndpoint() + '/auth/status', { cache: 'no-store' });
            if (!resp.ok) throw new Error(authUnavailableMessage());
            authStatus = await resp.json();
            return authStatus;
        } catch (_) {
            throw new Error(authUnavailableMessage());
        }
    }

    function readStoredState() {
        try {
            state.sessionId = localStorage.getItem(SESSION_KEY) || null;
            var rawUser = localStorage.getItem(USER_KEY);
            state.user = rawUser ? JSON.parse(rawUser) : null;
        } catch (_) {
            state.sessionId = null;
            state.user = null;
        }
    }

    function writeStoredState() {
        try {
            if (state.sessionId) localStorage.setItem(SESSION_KEY, state.sessionId);
            else localStorage.removeItem(SESSION_KEY);
            if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
            else localStorage.removeItem(USER_KEY);
        } catch (_) {}
    }

    function cleanAuthParams() {
        try {
            var url = new URL(window.location.href);
            var changed = false;
            ['mmm_session', 'mmm_login', 'mmm_auth_error'].forEach(function (key) {
                if (url.searchParams.has(key)) {
                    url.searchParams.delete(key);
                    changed = true;
                }
            });
            if (changed && window.history && window.history.replaceState) {
                window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
            }
        } catch (_) {}
    }

    function readCallbackState() {
        try {
            var params = new URLSearchParams(window.location.search);
            var session = params.get('mmm_session');
            var error = params.get('mmm_auth_error');
            if (session) {
                state.sessionId = session;
                writeStoredState();
            }
            if (error) {
                console.warn('GitHub sign-in failed:', error);
            }
            if (session || error) cleanAuthParams();
        } catch (_) {}
    }

    function emit() {
        writeStoredState();
        renderHeader();
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getState() }));
        listeners.forEach(function (fn) {
            try { fn(getState()); } catch (_) {}
        });
    }

    function getState() {
        return { authenticated: !!(state.sessionId && state.user), sessionId: state.sessionId, user: state.user, ready: state.ready };
    }

    function getReturnUrl() {
        try {
            var url = new URL(window.location.href);
            ['mmm_session', 'mmm_login', 'mmm_auth_error'].forEach(function (key) { url.searchParams.delete(key); });
            return url.toString();
        } catch (_) {
            return window.location.href;
        }
    }

    async function refresh() {
        readCallbackState();
        readStoredState();
        if (!state.sessionId) {
            state.ready = true;
            emit();
            return getState();
        }
        try {
            var resp = await fetch(getEndpoint() + '/auth/session', {
                headers: { 'Authorization': 'Bearer ' + state.sessionId },
                cache: 'no-store'
            });
            if (!resp.ok) throw new Error('Session expired');
            var data = await resp.json();
            state.user = data.user || null;
        } catch (err) {
            state.sessionId = null;
            state.user = null;
        }
        state.ready = true;
        emit();
        return getState();
    }

    function isFileOrigin() {
        return window.location.protocol === 'file:';
    }

    function getLoginUrl() {
        if (window.location.protocol === 'file:') return 'login.html';
        var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        return isLocal ? '/login.html' : '/login';
    }

    function isLoginPage() {
        var path = window.location.pathname || '';
        return path === '/login' || /\/login\.html$/i.test(path);
    }

    async function login() {
        if (state.sessionId && state.user) return getState();
        if (isFileOrigin()) {
            return startDeviceFlow();
        }
        var status = await getAuthStatus(true);
        if (!status || !status.web) {
            throw new Error(authUnavailableMessage());
        }
        var url = getEndpoint() + '/auth/start?return_to=' + encodeURIComponent(getReturnUrl());
        window.location.href = url;
        return null;
    }

    async function requireSession() {
        if (state.sessionId && state.user) return getState();
        var refreshed = await refresh();
        if (refreshed.authenticated) return refreshed;
        return login();
    }

    async function logout() {
        var sessionId = state.sessionId;
        state.sessionId = null;
        state.user = null;
        emit();
        if (sessionId) {
            try {
                await fetch(getEndpoint() + '/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + sessionId }
                });
            } catch (_) {}
        }
    }

    function removeAuthMenu() {
        var existing = document.getElementById('mmm-auth-menu');
        if (existing) existing.remove();
    }

    function toggleAuthMenu(anchor) {
        removeAuthMenu();
        if (!state.user || !anchor) return;
        var menu = document.createElement('div');
        menu.id = 'mmm-auth-menu';
        menu.className = 'mmm-auth-menu';
        var name = state.user.name || state.user.login;
        menu.innerHTML =
            '<div class="mmm-auth-menu-user">' +
                (state.user.avatar_url ? '<img src="' + escHtml(state.user.avatar_url) + '" alt="">' : '<i class="fas fa-circle-user"></i>') +
                '<div><strong>' + escHtml(name) + '</strong><span>@' + escHtml(state.user.login) + '</span></div>' +
            '</div>' +
            '<a href="' + escHtml(state.user.html_url || ('https://github.com/' + state.user.login)) + '" target="_blank" rel="noopener">GitHub</a>' +
            '<button type="button" id="mmm-auth-logout">' + text('auth.signOut', 'Sign out') + '</button>';
        document.body.appendChild(menu);
        var rect = anchor.getBoundingClientRect();
        menu.style.top = Math.round(rect.bottom + 8) + 'px';
        menu.style.right = Math.max(8, Math.round(window.innerWidth - rect.right)) + 'px';
        document.getElementById('mmm-auth-logout').addEventListener('click', function () {
            removeAuthMenu();
            logout();
        });
        setTimeout(function () {
            document.addEventListener('click', function onDocClick(e) {
                if (!menu.contains(e.target) && e.target !== anchor) {
                    removeAuthMenu();
                    document.removeEventListener('click', onDocClick);
                }
            });
        }, 0);
    }

    function renderHeader() {
        var btn = document.getElementById('mmm-auth-btn');
        if (!btn) return;
        btn.classList.toggle('authenticated', !!state.user);
        if (state.user) {
            btn.title = text('auth.signedInAs', 'Signed in as') + ' @' + state.user.login;
            btn.setAttribute('aria-label', btn.title);
            btn.innerHTML = state.user.avatar_url
                ? '<img class="mmm-auth-avatar" src="' + escHtml(state.user.avatar_url) + '" alt="">'
                : '<i class="fas fa-circle-user"></i>';
        } else {
            btn.title = text('auth.login', 'Log in');
            btn.setAttribute('aria-label', btn.title);
            btn.innerHTML = '<i class="fas fa-right-to-bracket"></i>';
        }
        if (!btn.dataset.mmmAuthBound) {
            btn.dataset.mmmAuthBound = '1';
            btn.addEventListener('click', function () {
                if (state.user) toggleAuthMenu(btn);
                else if (isLoginPage()) {
                    login().catch(function (err) {
                        notify((err && err.message) || authUnavailableMessage(), 'warning');
                    });
                } else {
                    window.location.href = getLoginUrl();
                }
            });
        }
    }

    function closeDeviceDialog() {
        var overlay = document.getElementById('mmm-auth-device-overlay');
        if (overlay) overlay.remove();
    }

    function showDeviceDialog(data) {
        closeDeviceDialog();
        var overlay = document.createElement('div');
        overlay.id = 'mmm-auth-device-overlay';
        overlay.className = 'mmm-auth-device-overlay';
        overlay.innerHTML =
            '<div class="mmm-auth-device-dialog">' +
                '<h2><i class="fab fa-github"></i> ' + text('auth.deviceTitle', 'Sign in with GitHub') + '</h2>' +
                '<p>' + text('auth.deviceInstruction', 'Open GitHub and enter this code to continue.') + '</p>' +
                '<div class="mmm-auth-device-code">' + escHtml(data.user_code || '') + '</div>' +
                '<a class="btn-generic" href="' + escHtml(data.verification_uri || 'https://github.com/login/device') + '" target="_blank" rel="noopener">' + text('auth.deviceOpen', 'Open GitHub') + '</a>' +
                '<p class="mmm-auth-device-status" id="mmm-auth-device-status">' + text('auth.deviceWaiting', 'Waiting for authorization...') + '</p>' +
                '<button type="button" class="mmm-auth-device-cancel" id="mmm-auth-device-cancel">' + text('drafts.cancel', 'Cancel') + '</button>' +
            '</div>';
        document.body.appendChild(overlay);
        document.getElementById('mmm-auth-device-cancel').addEventListener('click', closeDeviceDialog);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDeviceDialog(); });
    }

    async function startDeviceFlow() {
        var status = await getAuthStatus(true);
        if (!status || !status.device) {
            throw new Error(authUnavailableMessage());
        }
        var startResp = await fetch(getEndpoint() + '/auth/device/start', { method: 'POST' });
        if (!startResp.ok) throw new Error(text('auth.loginFailed', 'GitHub sign-in failed.'));
        var data = await startResp.json();
        showDeviceDialog(data);
        var interval = Math.max(Number(data.interval || 5), 5);
        return new Promise(function (resolve, reject) {
            var expiresAt = Date.now() + Number(data.expires_in || 900) * 1000;
            async function poll() {
                if (Date.now() > expiresAt) {
                    closeDeviceDialog();
                    reject(new Error(text('auth.loginFailed', 'GitHub sign-in failed.')));
                    return;
                }
                try {
                    var resp = await fetch(getEndpoint() + '/auth/device/poll', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device_code: data.device_code })
                    });
                    if (resp.status === 202) {
                        var pending = await resp.json().catch(function () { return {}; });
                        if (pending.interval) interval = Math.max(Number(pending.interval), interval + 5);
                        setTimeout(poll, interval * 1000);
                        return;
                    }
                    if (!resp.ok) throw new Error(await resp.text());
                    var result = await resp.json();
                    state.sessionId = result.session;
                    state.user = result.user;
                    state.ready = true;
                    closeDeviceDialog();
                    emit();
                    resolve(getState());
                } catch (err) {
                    var status = document.getElementById('mmm-auth-device-status');
                    if (status) status.textContent = text('auth.loginFailed', 'GitHub sign-in failed.');
                    reject(err);
                }
            }
            setTimeout(poll, interval * 1000);
        });
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        return function () {
            listeners = listeners.filter(function (item) { return item !== fn; });
        };
    }

    function init() {
        readCallbackState();
        readStoredState();
        bindLanguageChange();
        renderHeader();
        refresh();
    }

    function bindLanguageChange() {
        if (languageBound || typeof onLanguageChange !== 'function') return;
        onLanguageChange(renderHeader);
        languageBound = true;
    }

    window.addEventListener('mmm-header-loaded', function () {
        bindLanguageChange();
        renderHeader();
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        getEndpoint: getEndpoint,
        getState: getState,
        getSessionId: function () { return state.sessionId; },
        getUser: function () { return state.user; },
        isAuthenticated: function () { return !!(state.sessionId && state.user); },
        refresh: refresh,
        login: login,
        getLoginUrl: getLoginUrl,
        getAuthStatus: getAuthStatus,
        logout: logout,
        requireSession: requireSession,
        onChange: onChange,
        eventName: CHANGE_EVENT
    };
})();

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
                '<img src="/images/logo.png" alt="' + siteTitle + '" class="site-mini-footer__logo" width="22" height="22">' +
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
        '/interviews':  { title: 'pageTitle.interviews', header: 'pages.interviews' },
        '/kustosi':     { title: 'pageTitle.curators',   header: 'pages.curators' },
        '/contributions': { title: 'pageTitle.contributions', header: 'pages.contributions' },
        '/login':       { title: 'pageTitle.login',      header: 'auth.loginTitle' },
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

// ==================== OVERFLOW MARQUEE (shared) ====================
var OVERFLOW_MARQUEE_AUTO_CLASS = 'js-overflow-marquee-auto';
var OVERFLOW_MARQUEE_SELECTOR = '.js-overflow-marquee, .' + OVERFLOW_MARQUEE_AUTO_CLASS;
var overflowMarqueeIgnoredTags = {
    area: true,
    audio: true,
    br: true,
    canvas: true,
    iframe: true,
    img: true,
    input: true,
    option: true,
    path: true,
    progress: true,
    script: true,
    select: true,
    source: true,
    style: true,
    svg: true,
    textarea: true,
    video: true
};
var overflowMarqueeObservedElements = typeof WeakSet === 'function' ? new WeakSet() : null;
var overflowMarqueeDesktopMediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 601px)')
    : null;
var overflowMarqueeResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(function(entries) {
        entries.forEach(function(entry) {
            updateOverflowMarquee(entry.target);
        });
    })
    : null;
var overflowMarqueeMutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type !== 'childList') return;

            for (var i = 0; i < mutation.addedNodes.length; i++) {
                var node = mutation.addedNodes[i];
                if (node && node.nodeType === 1) {
                    refreshOverflowMarquees(node);
                }
            }
        });
    })
    : null;

function isInIgnoredOverflowMarqueeSubtree(el) {
    return !!(el && el.nodeType === 1 && typeof el.closest === 'function' && el.closest('[data-marquee-ignore]'));
}

function ensureOverflowMarqueeStyles() {
    var styleId = 'overflow-marquee-style';
    if (document.getElementById(styleId)) return;

    var styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = [
        '.js-overflow-marquee,.js-overflow-marquee-auto{min-width:0;}',
        '.js-overflow-marquee .overflow-marquee__content,.js-overflow-marquee-auto .overflow-marquee__content{display:inline-block;vertical-align:top;width:max-content;min-width:100%;transform:translate3d(0,0,0);will-change:transform;white-space:inherit;animation:none;}',
        '.js-overflow-marquee.is-marquee-active,.js-overflow-marquee-auto.is-marquee-active{text-overflow:clip !important;}',
        '@keyframes overflow-marquee-slide{0%{transform:translate3d(0,0,0);}100%{transform:translate3d(var(--overflow-marquee-shift, 0px),0,0);}}',
        '@media (max-width: 600px){.js-overflow-marquee.is-marquee-active .overflow-marquee__content,.js-overflow-marquee-auto.is-marquee-active .overflow-marquee__content{animation:overflow-marquee-slide var(--overflow-marquee-duration, 3s) linear infinite alternate;}}',
        '@media (min-width: 601px){.js-overflow-marquee.is-marquee-active:hover .overflow-marquee__content,.js-overflow-marquee-auto.is-marquee-active:hover .overflow-marquee__content{animation:overflow-marquee-slide var(--overflow-marquee-duration, 3s) linear infinite alternate;}}'
    ].join('');
    document.head.appendChild(styleEl);
}

function canWrapOverflowMarqueeContent(el) {
    if (!el || !el.children || el.children.length === 0) return true;

    for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        if (!child || !child.tagName) continue;

        var childTag = child.tagName.toLowerCase();
        if (overflowMarqueeIgnoredTags[childTag]) return false;

        var childDisplay = getComputedStyle(child).display;
        if (childDisplay === 'block' ||
            childDisplay === 'flex' ||
            childDisplay === 'grid' ||
            childDisplay === 'flow-root' ||
            childDisplay === 'list-item' ||
            childDisplay === 'table' ||
            childDisplay.indexOf('table-') === 0) {
            return false;
        }
    }

    return true;
}

function hasOverflowMarqueeText(el) {
    return !!(el && el.textContent && el.textContent.replace(/\s+/g, '').length > 0);
}

function shouldAutoApplyOverflowMarquee(el) {
    if (!el || !el.classList || !el.tagName) return false;
    if (isInIgnoredOverflowMarqueeSubtree(el)) return false;
    if (el.classList.contains('overflow-marquee__content')) return false;
    if (el.classList.contains('js-overflow-marquee') || el.classList.contains(OVERFLOW_MARQUEE_AUTO_CLASS)) return true;
    if (el.hasAttribute('data-marquee-ignore')) return false;

    var tag = el.tagName.toLowerCase();
    if (overflowMarqueeIgnoredTags[tag]) return false;
    if (!hasOverflowMarqueeText(el)) return false;
    if (!canWrapOverflowMarqueeContent(el)) return false;

    var style = getComputedStyle(el);
    if (style.textOverflow !== 'ellipsis') return false;
    if ((style.whiteSpace || '').indexOf('nowrap') === -1) return false;

    var overflowX = style.overflowX || '';
    var overflow = style.overflow || '';
    if (overflowX !== 'hidden' && overflowX !== 'clip' && overflow !== 'hidden' && overflow !== 'clip') return false;

    return true;
}

function discoverOverflowMarqueeCandidates(root) {
    var scope = root && root.nodeType === 1 ? root : (document.body || document.documentElement);
    if (!scope) return;
    if (isInIgnoredOverflowMarqueeSubtree(scope)) return;

    if (shouldAutoApplyOverflowMarquee(scope) && !scope.classList.contains('js-overflow-marquee')) {
        scope.classList.add(OVERFLOW_MARQUEE_AUTO_CLASS);
    }

    if (typeof scope.querySelectorAll !== 'function') return;

    var nodes = scope.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!shouldAutoApplyOverflowMarquee(node) || node.classList.contains('js-overflow-marquee')) continue;
        node.classList.add(OVERFLOW_MARQUEE_AUTO_CLASS);
    }
}

function ensureOverflowMarqueeContent(el) {
    if (!el) return null;

    var existing = el.firstElementChild;
    if (existing && existing.classList && existing.classList.contains('overflow-marquee__content') && el.children.length === 1) {
        return existing;
    }

    if (!canWrapOverflowMarqueeContent(el)) return null;

    var content = document.createElement('span');
    content.className = 'overflow-marquee__content';
    while (el.firstChild) {
        content.appendChild(el.firstChild);
    }
    el.appendChild(content);
    return content;
}

function updateOverflowMarquee(el) {
    if (!el || !el.isConnected) return;

    ensureOverflowMarqueeStyles();
    var content = ensureOverflowMarqueeContent(el);
    if (!content) return;

    el.classList.remove('is-marquee-active');
    el.style.removeProperty('--overflow-marquee-shift');
    el.style.removeProperty('--overflow-marquee-duration');
    content.style.animation = 'none';
    content.style.transform = 'translate3d(0,0,0)';

    if (el.clientWidth <= 0) return;

    // Force the reset transform to apply before measuring rendered widths.
    void content.offsetWidth;

    var containerWidth = Math.ceil(el.getBoundingClientRect().width);
    var contentWidth = Math.ceil(Math.max(
        content.scrollWidth || 0,
        content.getBoundingClientRect().width
    ));
    var overflow = Math.ceil(contentWidth - containerWidth);
    if (overflow <= 2) {
        content.style.animation = '';
        return;
    }

    var duration = Math.max(2, Math.min(4.5, overflow / 36));
    el.style.setProperty('--overflow-marquee-shift', '-' + overflow + 'px');
    el.style.setProperty('--overflow-marquee-duration', duration.toFixed(2).replace(/\.00$/, '') + 's');
    el.classList.add('is-marquee-active');
    content.style.animation = '';
    content.style.transform = '';
}

function observeOverflowMarquee(el) {
    if (!el || !overflowMarqueeResizeObserver) return;
    if (overflowMarqueeObservedElements && overflowMarqueeObservedElements.has(el)) return;

    overflowMarqueeResizeObserver.observe(el);
    if (overflowMarqueeObservedElements) {
        overflowMarqueeObservedElements.add(el);
    }
}

function refreshOverflowMarquees(root) {
    ensureOverflowMarqueeStyles();
    if (root && root.nodeType === 1 && isInIgnoredOverflowMarqueeSubtree(root)) return;
    discoverOverflowMarqueeCandidates(root);

    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    var elements = [];

    if (root && root.nodeType === 1 && typeof root.matches === 'function' && root.matches(OVERFLOW_MARQUEE_SELECTOR)) {
        elements.push(root);
    }

    if (scope && typeof scope.querySelectorAll === 'function') {
        var found = scope.querySelectorAll(OVERFLOW_MARQUEE_SELECTOR);
        for (var i = 0; i < found.length; i++) {
            elements.push(found[i]);
        }
    }

    elements.forEach(function(el) {
        observeOverflowMarquee(el);
        updateOverflowMarquee(el);
    });
}

window.refreshOverflowMarquees = refreshOverflowMarquees;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        refreshOverflowMarquees();
        if (overflowMarqueeMutationObserver && document.body) {
            overflowMarqueeMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    });
} else {
    refreshOverflowMarquees();
    if (overflowMarqueeMutationObserver && document.body) {
        overflowMarqueeMutationObserver.observe(document.body, { childList: true, subtree: true });
    }
}

window.addEventListener('resize', function() {
    refreshOverflowMarquees();
});

if (overflowMarqueeDesktopMediaQuery) {
    if (typeof overflowMarqueeDesktopMediaQuery.addEventListener === 'function') {
        overflowMarqueeDesktopMediaQuery.addEventListener('change', function() {
            refreshOverflowMarquees();
        });
    } else if (typeof overflowMarqueeDesktopMediaQuery.addListener === 'function') {
        overflowMarqueeDesktopMediaQuery.addListener(function() {
            refreshOverflowMarquees();
        });
    }
}

if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(function() {
        refreshOverflowMarquees();
    });
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

function clearServiceChooserCloseState(overlay) {
    if (!overlay) return;

    if (overlay._serviceChooserCloseTimer) {
        clearTimeout(overlay._serviceChooserCloseTimer);
        overlay._serviceChooserCloseTimer = null;
    }

    if (overlay._serviceChooserCloseHandler && overlay._serviceChooserClosePanel) {
        overlay._serviceChooserClosePanel.removeEventListener('animationend', overlay._serviceChooserCloseHandler);
    }

    overlay._serviceChooserCloseHandler = null;
    overlay._serviceChooserClosePanel = null;
}

function finalizeServiceChooserClose(overlay) {
    if (!overlay) return;
    clearServiceChooserCloseState(overlay);
    overlay.classList.remove('visible', 'closing');
    document.body.style.overflow = '';
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
 * @param {string}   [youtubeUrl]       — Direct YouTube URL for the most-viewed video
 * @param {Array}    [allYtVideos]      — All YouTube video objects [{url, views}] for video picker
 * @param {Object}   [stats]            — Optional song stats { totalViews, viewsDelta }
 */
function showServiceChooserDialog(releaseUrl, title, artistName, thumbnail, accentColors, spotifyArtistName, verified, youtubeUrl, allYtVideos, stats) {
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

    function getHexLuminance(hex) {
        var normalized = normalizeHexColor(hex);
        if (!normalized) return null;

        var raw = normalized.slice(1);
        var red = parseInt(raw.slice(0, 2), 16);
        var green = parseInt(raw.slice(2, 4), 16);
        var blue = parseInt(raw.slice(4, 6), 16);

        return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    }

    function getAverageHexLuminance(colors) {
        var total = 0;
        var count = 0;

        for (var i = 0; i < colors.length; i++) {
            var luminance = getHexLuminance(colors[i]);
            if (luminance === null) continue;
            total += luminance;
            count += 1;
        }

        return count ? (total / count) : null;
    }

    function parseStatNumber(value) {
        if (value == null || value === '') return null;
        var num = Number(value);
        return isFinite(num) ? num : null;
    }

    function buildChooserStatHtml(iconClass, value, extraClass, formatterOptions, label) {
        var parsed = parseStatNumber(value);
        if (parsed === null) return '';

        var classes = 'service-chooser-stat';
        if (extraClass) classes += ' ' + extraClass;

        return '' +
            '<div class="' + classes + '">' +
                '<div class="service-chooser-stat-layout">' +
                    '<span class="service-chooser-stat-icon"><i class="' + iconClass + '"></i></span>' +
                    '<div class="service-chooser-stat-copy">' +
                        '<span class="service-chooser-stat-label">' + escHtml(label || '') + '</span>' +
                        '<span class="service-chooser-stat-value">' + formatCompactCountHtml(parsed, formatterOptions) + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    var SERVICE_CHOOSER_CERTIFICATION_LEVELS = [
        { tier: 'gold', minViews: 1000000, label: 'Gold', seal: 'G' },
        { tier: 'silver', minViews: 500000, label: 'Silver', seal: 'S' },
        { tier: 'bronze', minViews: 100000, label: 'Bronze', seal: 'B' }
    ];

    function getChooserCertification(viewCount) {
        var count = parseStatNumber(viewCount);
        if (count === null || count < 100000) return null;

        if (count >= 5000000) {
            return {
                tier: 'platinum',
                label: 'Platinum',
                seal: Math.max(1, Math.floor(count / 5000000)) > 1
                    ? 'P' + Math.max(1, Math.floor(count / 5000000))
                    : 'P',
                multiplier: Math.max(1, Math.floor(count / 5000000))
            };
        }

        for (var i = 0; i < SERVICE_CHOOSER_CERTIFICATION_LEVELS.length; i++) {
            var level = SERVICE_CHOOSER_CERTIFICATION_LEVELS[i];
            if (count >= level.minViews) {
                return {
                    tier: level.tier,
                    label: level.label,
                    seal: level.seal,
                    multiplier: 1
                };
            }
        }

        return null;
    }

    function getChooserCertificationLabel(certification) {
        if (!certification) return '';

        var localizedLabel = typeof t === 'function'
            ? t('certification.' + certification.tier, certification.label)
            : certification.label;

        if (certification.tier === 'platinum' && certification.multiplier > 1) {
            return localizedLabel + ' x' + certification.multiplier;
        }

        return localizedLabel;
    }

    function buildChooserCertificationTitle(itemTitle, certification, viewCount) {
        var displayTitle = itemTitle && typeof localizeText === 'function'
            ? localizeText(itemTitle)
            : (itemTitle || '');
        var template = typeof t === 'function'
            ? t('certification.tooltip', '{0} • {1} certification • {2} views')
            : '{0} • {1} certification • {2} views';

        return template
            .replace('{0}', displayTitle)
            .replace('{1}', getChooserCertificationLabel(certification))
            .replace('{2}', Number(viewCount || 0).toLocaleString());
    }

    function buildChooserCertificationHtml(viewCount, itemTitle) {
        var certification = getChooserCertification(viewCount);
        if (!certification) return '';

        var titleText = buildChooserCertificationTitle(itemTitle, certification, viewCount);
        var kicker = typeof t === 'function' ? t('certification.certified', 'Certified') : 'Certified';
        var localizedLabel = getChooserCertificationLabel(certification);

        return '' +
            '<span class="service-chooser-certification-badge service-chooser-certification--' + certification.tier + '" title="' + escHtml(titleText) + '" aria-label="' + escHtml(titleText) + '">' +
                '<span class="service-chooser-certification-seal" aria-hidden="true">' +
                    '<span class="service-chooser-certification-monogram">' + escHtml(certification.seal) + '</span>' +
                '</span>' +
                '<span class="service-chooser-certification-copy">' +
                    '<span class="service-chooser-certification-kicker">' + escHtml(kicker) + '</span>' +
                    '<span class="service-chooser-certification-label">' + escHtml(localizedLabel) + '</span>' +
                '</span>' +
            '</span>';
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
                    '<div class="service-chooser-certification-slot" id="service-chooser-certification"></div>' +
                '</div>' +
                '<div class="service-chooser-stats" id="service-chooser-stats"></div>' +
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

    clearServiceChooserCloseState(overlay);
    overlay.classList.remove('visible', 'closing');
    void overlay.offsetWidth;

    var headerEl  = document.getElementById('service-chooser-header');
    var chooserEl = overlay.querySelector('.service-chooser');
    var imgEl     = document.getElementById('service-chooser-img');
    var artistEl  = document.getElementById('service-chooser-artist');
    var songEl    = document.getElementById('service-chooser-song');
    var certEl    = document.getElementById('service-chooser-certification');
    var statsEl   = document.getElementById('service-chooser-stats');
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

    var totalViews = stats && stats.totalViews != null ? stats.totalViews : null;
    var viewsDelta = stats && stats.viewsDelta != null ? stats.viewsDelta : null;
    var chooserCertificationHtml = buildChooserCertificationHtml(totalViews, title);

    if (certEl) {
        certEl.innerHTML = chooserCertificationHtml;
        certEl.style.display = chooserCertificationHtml ? 'block' : 'none';
    }
    if (headerEl) {
        headerEl.classList.toggle('service-chooser-header--with-cert', !!chooserCertificationHtml);
    }

    var statsHtml = '';
    statsHtml += buildChooserStatHtml(
        'fas fa-eye',
        totalViews,
        'service-chooser-stat--views',
        null,
        typeof t === 'function' ? t('dashboard.views') : 'Views'
    );
    statsHtml += buildChooserStatHtml(
        viewsDelta >= 0 ? 'fas fa-arrow-trend-up' : 'fas fa-arrow-trend-down',
        viewsDelta,
        'service-chooser-stat--delta' + (viewsDelta > 0 ? ' positive' : viewsDelta < 0 ? ' negative' : ' neutral'),
        {
            showPlus: true,
            positivePrefixHtml: '<span class="service-chooser-stat-prefix-icon service-chooser-stat-prefix-icon--positive" aria-hidden="true">+</span>'
        },
        typeof t === 'function' ? t('service.thisWeek') : 'This week'
    );
    if (statsEl) {
        statsEl.innerHTML = statsHtml;
        statsEl.style.display = statsHtml ? 'grid' : 'none';
    }

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
        var accentLuminance = getAverageHexLuminance([c1, c2]);
        isDark = accentLuminance !== null ? accentLuminance <= 0.45 : false;
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
        var headerLum = getHexLuminance(c1);
        var headerIsLight = headerLum > 0.55;
        var headerTc = headerIsLight ? '#000' : '#fff';
        var headerTcSub = headerIsLight ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
        var headerSep = headerIsLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)';

        // Full-dialog gradient (matching artist page darkenHex/lightenHex approach)
        var chooserStops;
        if (isDark) {
            var g1 = shadeHexColor(c1, -82) || c1, g2 = shadeHexColor(c2, -86) || c2, g3 = shadeHexColor(c1, -92) || c1;
            chooserStops = [g1, g2, g3];
            chooserEl.style.background = 'linear-gradient(135deg, ' + g1 + ' 0%, ' + g2 + ' 50%, ' + g3 + ' 100%)';
        } else {
            var l1 = shadeHexColor(c1, 84) || c1, l2 = shadeHexColor(c2, 87) || c2, l3 = shadeHexColor(c1, 92) || c1;
            chooserStops = [l1, l2, l3];
            chooserEl.style.background = 'linear-gradient(135deg, ' + l1 + ' 0%, ' + l2 + ' 50%, ' + l3 + ' 100%)';
        }
        var chooserLum = getAverageHexLuminance(chooserStops);
        var chooserIsLight = chooserLum !== null ? chooserLum > 0.55 : !isDark;
        var chooserText = chooserIsLight ? '#1a1a2e' : '#ffffff';
        var chooserTextMuted = chooserIsLight ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.72)';
        var chooserCardBg = chooserIsLight ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)';
        var chooserCardBorder = chooserIsLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.10)';
        var chooserCardHoverBg = chooserIsLight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
        var hDark = shadeHexColor(c1, -15) || c1;
        headerEl.style.background = 'linear-gradient(135deg, ' + c1 + ' 0%, ' + hDark + ' 50%, ' + c1 + ' 100%)';
        chooserEl.style.color = chooserText;
        overlay.style.setProperty('--sc-chooser-text', chooserText);
        overlay.style.setProperty('--sc-chooser-text-muted', chooserTextMuted);
        overlay.style.setProperty('--sc-card-bg', chooserCardBg);
        overlay.style.setProperty('--sc-card-border', chooserCardBorder);
        overlay.style.setProperty('--sc-card-hover-bg', chooserCardHoverBg);
        overlay.style.setProperty('--sc-pref-color', c2);
        overlay.style.setProperty('--sc-link-sweep', chooserIsLight ? c1 + '22' : c1 + '30');
        overlay.style.setProperty('--sc-header-separator', headerSep);

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
        chooserEl.style.color = '';
        songEl.style.color = '';
        artistEl.style.color = '';
        overlay.style.removeProperty('--sc-chooser-text');
        overlay.style.removeProperty('--sc-chooser-text-muted');
        overlay.style.removeProperty('--sc-card-bg');
        overlay.style.removeProperty('--sc-card-border');
        overlay.style.removeProperty('--sc-card-hover-bg');
        overlay.style.removeProperty('--sc-pref-color');
        overlay.style.removeProperty('--sc-link-sweep');
        overlay.style.removeProperty('--sc-header-separator');
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
        var linkContent =
            '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="' + (isPreferred ? 'preferred' : '') + '">' +
                '<i class="' + svc.icon + '" style="color:' + svc.color + '"></i> ' + escHtml(svc.name) +
                (isPreferred ? ' <span class="pref-badge">★</span>' : '') +
            '</a>';
        linksHtml += linkContent;
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
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

/**
 * Close the service-chooser dialog.
 * @param {boolean} [animated=false] — play the reverse scale+blur animation
 */
function closeServiceChooserDialog(animated) {
    var ov = document.getElementById('service-chooser-overlay');
    if (!ov || (!ov.classList.contains('visible') && !ov.classList.contains('closing'))) return;

    clearServiceChooserCloseState(ov);

    if (animated) {
        ov.classList.add('closing');
        var sc = ov.querySelector('.service-chooser');
        if (!sc) {
            finalizeServiceChooserClose(ov);
            return;
        }

        var onEnd = function() {
            finalizeServiceChooserClose(ov);
        };

        ov._serviceChooserClosePanel = sc;
        ov._serviceChooserCloseHandler = onEnd;
        ov._serviceChooserCloseTimer = setTimeout(function() {
            finalizeServiceChooserClose(ov);
        }, 350);

        sc.addEventListener('animationend', onEnd, { once: true });
    } else {
        finalizeServiceChooserClose(ov);
    }
}
