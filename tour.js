// ==================== MULTI-PAGE SITE TOUR ====================
// Navigates between pages and highlights key features.
// First-time visitors on the index page get a prompt asking if they want a tour.
// Can be re-launched from Settings > "Тура на сајтот".
(function() {
    'use strict';

    // Helper: get translated text, fallback to key
    function _t(key) {
        return (typeof t === 'function') ? t(key) : key;
    }

    // Steps are defined with i18n keys — resolved at render time
    var STEP_DEFS = [
        // === INDEX (Дома — Dashboard) ===
        { page: '/', titleKey: 'tour.step0.title', textKey: 'tour.step0.text', el: null, pos: 'center' },
        { page: '/', titleKey: 'tour.step1.title', textKey: 'tour.step1.text', el: '.site-title', pos: 'bottom' },
        { page: '/', titleKey: 'tour.step2.title', textKey: 'tour.step2.text', el: null, pos: 'center' },
        { page: '/', titleKey: 'tour.step3.title', textKey: 'tour.step3.text', el: '.dashboard', pos: 'top' },
        { page: '/', titleKey: 'tour.step4.title', textKey: 'tour.step4.text', el: '.quick-actions', pos: 'top' },

        // === CHARTS (Топ Листа) ===
        { page: '/charts', titleKey: 'tour.step5.title', textKey: 'tour.step5.text', el: null, pos: 'center' },
        { page: '/charts', titleKey: 'tour.step6.title', textKey: 'tour.step6.text', el: '.chart-filter-bar', pos: 'bottom' },
        { page: '/charts', titleKey: 'tour.step7.title', textKey: 'tour.step7.text', el: '.chart-sections', pos: 'top' },

        // === LISTA (Мастер Листа) ===
        { page: '/lista', titleKey: 'tour.step8.title', textKey: 'tour.step8.text', el: null, pos: 'center' },
        { page: '/lista', titleKey: 'tour.step9.title', textKey: 'tour.step9.text', el: '.controls', pos: 'bottom' },
        { page: '/lista', titleKey: 'tour.step10.title', textKey: 'tour.step10.text', el: '#add-band-btn', pos: 'bottom' },

        // === NASTANI ===
        { page: '/nastani', titleKey: 'tour.step11.title', textKey: 'tour.step11.text', el: '.table-wrapper', pos: 'top' },

        // === VESTI ===
        { page: '/vesti', titleKey: 'tour.step12.title', textKey: 'tour.step12.text', el: '.news-container', pos: 'top' },

        // === KUSTOSI ===
        { page: '/kustosi', titleKey: 'tour.step13.title', textKey: 'tour.step13.text', el: '.curators-container', pos: 'top' },

        // === IZNENADI-ME ===
        { page: '/iznenadi-me', titleKey: 'tour.step14.title', textKey: 'tour.step14.text', el: '.surprise-container', pos: 'top' },
        { page: '/iznenadi-me', titleKey: 'tour.step15.title', textKey: 'tour.step15.text', el: null, pos: 'center' }
    ];

    // Resolve a step definition to its translated content
    function resolveStep(def) {
        return {
            page: def.page,
            title: _t(def.titleKey),
            text: _t(def.textKey),
            el: def.el,
            pos: def.pos
        };
    }

    var KEY_ACTIVE  = 'mmm-tour-active';
    var KEY_STEP    = 'mmm-tour-step';
    var KEY_DONE    = 'mmm-tour-completed';
    var KEY_ASKED   = 'mmm-tour-asked';

    var overlay = null;
    var active  = false;

    // ---- helpers ----

    function curPage() {
        var p = location.pathname;
        if (p === '/' || p === '' || p === '/index.html') return '/';
        return '/' + p.replace(/^\//, '').replace(/\.html$/, '');
    }

    function toUrl(tourPage) {
        var dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (tourPage === '/') return dev ? '/index.html' : '/';
        return dev ? tourPage + '.html' : tourPage;
    }

    function onPage(tourPage) {
        return curPage() === tourPage;
    }

    function isMobile() {
        return window.innerWidth <= 600;
    }

    function applyMobileHeaderTitle() {
        if (!isMobile()) return;

        var titleEl = document.querySelector('.logo-title-group .title-group h1');
        if (!titleEl) return;

        var pageTitleKeys = {
            '/': 'pages.home',
            '/lista': 'pages.masterList',
            '/charts': 'pages.charts',
            '/nastani': 'pages.events',
            '/vesti': 'pages.news',
            '/kustosi': 'pages.curators',
            '/iznenadi-me': 'pages.surprise',
            '/za': 'pages.about',
            '/uslovi': 'pages.terms',
            '/privatnost': 'pages.privacy',
            '/nastan': 'pages.event'
        };

        var key = pageTitleKeys[curPage()];
        if (key) {
            titleEl.textContent = _t(key);
        }
    }

    // ---- language selection prompt (shown in English for first-time visitors) ----

    function showLanguagePrompt(onComplete) {
        var existing = document.getElementById('tour-lang-select');
        if (existing) existing.remove();

        // Build language buttons from available translations
        var langs = (typeof getLanguages === 'function') ? getLanguages() : [];
        if (langs.length <= 1) { onComplete(); return; } // Skip if only one language

        var langBtnsHtml = '';
        for (var i = 0; i < langs.length; i++) {
            langBtnsHtml += '<button class="tour-lang-btn" data-lang="' + langs[i].code + '">' +
                '<span class="tour-lang-flag">' + langs[i].flag + '</span> ' + langs[i].name +
            '</button>';
        }

        var el = document.createElement('div');
        el.id = 'tour-lang-select';
        el.className = 'tour-overlay active';
        el.innerHTML =
            '<div class="tour-tooltip tour-center">' +
                '<div class="tour-tooltip-content">' +
                    '<h3 class="tour-title">Choose your language 🌍</h3>' +
                    '<p class="tour-description">Select the language you\'d like to use on this site. You can always change it later in ⚙ Settings.</p>' +
                    '<div class="tour-lang-grid">' + langBtnsHtml + '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(el);

        var btns = el.querySelectorAll('.tour-lang-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function() {
                var lang = this.getAttribute('data-lang');
                if (typeof setLanguage === 'function') setLanguage(lang);
                el.remove();
                onComplete();
            });
        }
    }

    // ---- welcome prompt ----

    function showWelcomePrompt() {
        var existing = document.getElementById('tour-welcome');
        if (existing) existing.remove();

        // If language has never been set (first-time user), show language prompt first
        var langSet = false;
        try { langSet = !!localStorage.getItem('mmm-language'); } catch(e) {}

        if (!langSet) {
            showLanguagePrompt(function() {
                showWelcomePromptInner();
            });
        } else {
            showWelcomePromptInner();
        }
    }

    function showWelcomePromptInner() {
        var existing = document.getElementById('tour-welcome');
        if (existing) existing.remove();

        var el = document.createElement('div');
        el.id = 'tour-welcome';
        el.className = 'tour-overlay active';
        el.innerHTML =
            '<div class="tour-tooltip tour-center">' +
                '<div class="tour-tooltip-content">' +
                    '<h3 class="tour-title">' + _t('tour.welcome.title') + '</h3>' +
                    '<p class="tour-description">' + _t('tour.welcome.text') + '</p>' +
                '</div>' +
                '<div class="tour-footer">' +
                    '<span></span>' +
                    '<div class="tour-buttons">' +
                        '<button class="tour-btn-skip tour-welcome-dismiss">' + _t('tour.welcome.dismiss') + '</button>' +
                        '<button class="tour-btn-next tour-welcome-start">' + _t('tour.welcome.start') + ' <i class="fas fa-arrow-right"></i></button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(el);

        el.querySelector('.tour-welcome-start').addEventListener('click', function() {
            el.remove();
            localStorage.setItem(KEY_ASKED, 'true');
            beginTour(0);
        });

        el.querySelector('.tour-welcome-dismiss').addEventListener('click', function() {
            el.remove();
            localStorage.setItem(KEY_ASKED, 'true');
        });

        // Click backdrop to dismiss
        el.addEventListener('click', function(e) {
            if (e.target === el) {
                el.remove();
                localStorage.setItem(KEY_ASKED, 'true');
            }
        });

        // Escape to dismiss
        function escHandler(e) {
            if (e.key === 'Escape') {
                el.remove();
                localStorage.setItem(KEY_ASKED, 'true');
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('keydown', escHandler);
    }

    // ---- overlay DOM ----

    function buildOverlay() {
        var old = document.getElementById('tour-overlay');
        if (old) old.remove();

        var el = document.createElement('div');
        el.id = 'tour-overlay';
        el.className = 'tour-overlay';
        el.innerHTML =
            '<div class="tour-highlight"></div>' +
            '<div class="tour-tooltip">' +
                '<div class="tour-tooltip-content">' +
                    '<h3 class="tour-title"></h3>' +
                    '<p class="tour-description"></p>' +
                '</div>' +
                '<div class="tour-footer">' +
                    '<span class="tour-progress"></span>' +
                    '<div class="tour-buttons">' +
                        '<button class="tour-btn-skip">' + _t('common.skip') + '</button>' +
                        '<button class="tour-btn-prev"><i class="fas fa-arrow-left"></i></button>' +
                        '<button class="tour-btn-next">' + _t('common.next') + ' <i class="fas fa-arrow-right"></i></button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(el);

        el.querySelector('.tour-btn-skip').addEventListener('click', endTour);
        el.querySelector('.tour-btn-prev').addEventListener('click', prevStep);
        el.querySelector('.tour-btn-next').addEventListener('click', nextStep);

        el.addEventListener('click', function(e) {
            if (e.target === el || e.target.classList.contains('tour-highlight')) endTour();
        });

        document.addEventListener('keydown', function handler(e) {
            if (!active) return;
            if (e.key === 'Escape') endTour();
            else if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
            else if (e.key === 'ArrowLeft') prevStep();
        });

        return el;
    }

    // ---- tour lifecycle ----

    function beginTour(stepIdx) {
        var idx = stepIdx || 0;

        // If starting from 0 and not on the index page, navigate there first
        if (idx === 0 && !onPage('/')) {
            sessionStorage.setItem(KEY_ACTIVE, 'true');
            sessionStorage.setItem(KEY_STEP, '0');
            location.href = toUrl('/');
            return;
        }

        active = true;
        sessionStorage.setItem(KEY_ACTIVE, 'true');
        sessionStorage.setItem(KEY_STEP, String(idx));

        overlay = buildOverlay();
        overlay.classList.add('active');
        if (!isMobile()) document.body.style.overflow = 'hidden';
        renderStep();
    }

    function endTour() {
        active = false;
        sessionStorage.removeItem(KEY_ACTIVE);
        sessionStorage.removeItem(KEY_STEP);
        localStorage.setItem(KEY_DONE, 'true');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function nextStep() {
        var idx = getIdx();
        if (idx >= STEP_DEFS.length - 1) { endTour(); return; }
        setIdx(idx + 1);
        renderStep();
    }

    function prevStep() {
        var idx = getIdx();
        if (idx <= 0) return;
        setIdx(idx - 1);
        renderStep();
    }

    function getIdx() {
        return parseInt(sessionStorage.getItem(KEY_STEP) || '0', 10);
    }

    function setIdx(n) {
        sessionStorage.setItem(KEY_STEP, String(n));
    }

    // ---- rendering ----

    function renderStep() {
        var idx  = getIdx();
        var def = STEP_DEFS[idx];
        if (!def) { endTour(); return; }
        var step = resolveStep(def);

        // Navigate if the step belongs to a different page
        if (!onPage(step.page)) {
            location.href = toUrl(step.page);
            return;
        }

        if (!overlay) {
            overlay = buildOverlay();
            overlay.classList.add('active');
            if (!isMobile()) document.body.style.overflow = 'hidden';
        }

        var highlight = overlay.querySelector('.tour-highlight');
        var tooltip   = overlay.querySelector('.tour-tooltip');

        // Content
        tooltip.querySelector('.tour-title').textContent = step.title;
        tooltip.querySelector('.tour-description').innerHTML = step.text;
        tooltip.querySelector('.tour-progress').textContent = (idx + 1) + ' / ' + STEP_DEFS.length;
        tooltip.querySelector('.tour-btn-prev').disabled = idx === 0;
        tooltip.querySelector('.tour-btn-next').innerHTML = idx === STEP_DEFS.length - 1
            ? _t('common.finish') + ' <i class="fas fa-check"></i>'
            : _t('common.next') + ' <i class="fas fa-arrow-right"></i>';

        // Reset positioning classes
        tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'tour-center');

        // Center steps (no target element)
        if (step.pos === 'center' || !step.el) {
            highlight.style.display = 'none';
            tooltip.classList.add('tour-center');
            tooltip.style.top = '';
            tooltip.style.left = '';
            return;
        }

        // Element-targeted step
        var target = document.querySelector(step.el);
        if (!target) {
            // Fallback to center if element not found yet
            highlight.style.display = 'none';
            tooltip.classList.add('tour-center');
            tooltip.style.top = '';
            tooltip.style.left = '';
            return;
        }

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(function() {
            var rect = target.getBoundingClientRect();
            var pad  = 4;
            var mob  = isMobile();

            // Highlight
            highlight.style.display  = 'block';
            highlight.style.position = mob ? 'fixed' : 'absolute';
            highlight.style.top    = (rect.top  - pad + (mob ? 0 : window.scrollY)) + 'px';
            highlight.style.left   = (rect.left - pad) + 'px';
            highlight.style.width  = (rect.width  + pad * 2) + 'px';
            highlight.style.height = (rect.height + pad * 2) + 'px';

            // Desktop tooltip positioning
            if (!mob) {
                var tr = tooltip.getBoundingClientRect();
                var top, left, arrow;

                if (step.pos === 'bottom') {
                    top = rect.bottom + 16; left = rect.left + rect.width / 2 - tr.width / 2; arrow = 'arrow-top';
                } else if (step.pos === 'top') {
                    top = rect.top - tr.height - 16; left = rect.left + rect.width / 2 - tr.width / 2; arrow = 'arrow-bottom';
                } else if (step.pos === 'left') {
                    top = rect.top + rect.height / 2 - tr.height / 2; left = rect.left - tr.width - 16; arrow = 'arrow-right';
                } else {
                    top = rect.top + rect.height / 2 - tr.height / 2; left = rect.right + 16; arrow = 'arrow-left';
                }

                // Clamp within viewport
                if (left < 10) left = 10;
                if (left + tr.width > window.innerWidth - 10) left = window.innerWidth - tr.width - 10;
                if (top < 10) top = 10;
                if (top + tr.height > window.innerHeight - 10) top = window.innerHeight - tr.height - 10;

                tooltip.style.top  = top  + 'px';
                tooltip.style.left = left + 'px';
                tooltip.classList.add(arrow);
            }
        }, 200);
    }

    // ---- initialisation ----

    function onReady() {
        applyMobileHeaderTitle();

        // 1. Resume an active tour (e.g. after page navigation)
        if (sessionStorage.getItem(KEY_ACTIVE) === 'true') {
            var resumeIdx = getIdx();
            // Delay to let page content render (charts, tables, etc.)
            setTimeout(function() { beginTour(resumeIdx); }, 800);
            return;
        }

        // 2. First-time visitors on the index page: ask if they want a tour
        var done  = localStorage.getItem(KEY_DONE) === 'true'
                 || localStorage.getItem('mmm-tour-viewed') === 'true';
        var asked = localStorage.getItem(KEY_ASKED) === 'true';
        if (!done && !asked && onPage('/')) {
            setTimeout(function() { showWelcomePrompt(); }, 1500);
        }
    }

    // Expose globally for the Settings panel button
    window.startGlobalTour = function() {
        // Reset state so the tour runs fresh
        sessionStorage.removeItem(KEY_STEP);
        localStorage.removeItem(KEY_DONE);
        beginTour(0);
    };

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        setTimeout(onReady, 0);
    }
})();
