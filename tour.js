// ==================== MULTI-PAGE SITE TOUR ====================
// Automatically navigates between pages and highlights key features.
// Auto-starts for first-time visitors on the index page.
// Can be re-launched from Settings > "Тура на сајтот".
(function() {
    'use strict';

    var STEPS = [
        // === INDEX (Топ Листа) ===
        { page: '/', title: 'Здраво! 👋', text: 'Добредојде на <strong>ТопЛиста.мк</strong>!<br><br>Ова е сајт за секој што сака македонска музика — тука ги следиме артистите, ги рангираме песните, собираме настани и вести, и уште многу работи.<br><br>Ќе ти направам кратка тура за да видиш што нуди сајтот. Трае околу 2 минути.', el: null, pos: 'center' },
        { page: '/', title: 'Навигација', text: 'Ова е <strong>менито</strong>. На телефон, тапни на логото горе лево за да го отвориш.<br><br>Од тука стигнуваш до сè: топ листата, мастер листата, настаните, вестите и останатите делови на сајтот.', el: '.site-nav-trigger', pos: 'bottom' },
        { page: '/', title: 'Поставки ⚙', text: 'Во поставките можеш да промениш неколку работи:<br><br>• <strong>Тема</strong> — светла или темна, зависи како ти се допаѓа<br>• <strong>Стриминг сервис</strong> — избери го твојот (Spotify, YouTube, Apple Music…)<br><br>Кога ќе кликнеш на некоја песна на сајтот, таа ќе ти се отвори директно во сервисот што си го избрал.', el: '#settings-btn', pos: 'bottom' },
        { page: '/', title: 'Филтри', text: 'Топ листата не е само една — има повеќе варијанти:<br><br>• <strong>Оригинална</strong> — апсолутно сите песни достапни на Spotify од артисти од Мастер Листата<br>• <strong>Алтернативна</strong> — сите песни кои не се поп<br>• <strong>Сите времиња</strong> — кумулативна листа на сите артисти според бројот на следачи на Spotify<br><br>Филтрите можеш и да ги комбинираш меѓу себе за поспецифичен резултат.', el: '.chart-filter-bar', pos: 'bottom' },
        { page: '/', title: 'Топ Листа 📊', text: 'Ова е срцето на сајтот — <strong>Топ Листата</strong>.<br><br>Тука се рангирани најслушаните изданија (песни, албуми, EP-а) од македонски артисти. Рангирањето се базира на бројот на слушања на Spotify.<br><br>Податоците се освежуваат секој ден, а нова листа се пресметува секој понеделник. Секоја минатата листа се чува во архивата.', el: '.chart-sections', pos: 'top' },

        // === LISTA (Мастер Листа) ===
        { page: '/lista', title: 'Мастер Листа 📋', text: 'Ова е <strong>Мастер Листата</strong> — главната база на сајтот.<br><br>Тука се собрани сите македонски артисти и бендови, заедно со нивните жанрови, градови, линкови до профилите и друго. Практично, секоја друга функција на сајтот (топ листата, вестите, настаните) зависи од оваа листа.', el: null, pos: 'center' },
        { page: '/lista', title: 'Пребарај и филтрирај', text: 'Можеш да пребаруваш по <strong>име</strong>, <strong>жанр</strong>, <strong>град</strong> или да ги комбинираш филтрите за попрецизен резултат.<br><br>Слободно пишувај на кирилица или латиница — и двете работат. На пример, ако напишеш „rok" ќе ти ги покаже сите рок артисти.', el: '.controls', pos: 'bottom' },
        { page: '/lista', title: 'Додај артист ➕', text: 'Забележуваш дека недостасува некој артист или бенд? Можеш да го предложиш тука!<br><br>Кликни на копчето, пополни го формуларот со основните информации (име, жанр, линкови) и испрати го. По кратка проверка од наша страна, артистот ќе се појави на сајтот.', el: '#add-band-btn', pos: 'bottom' },

        // === NASTANI ===
        { page: '/nastani', title: 'Настани 📅', text: 'Тука ги собираме претстојните <strong>концерти, фестивали и музички настани</strong> низ Македонија.<br><br>Знаеш за настан што го нема тука? Кликни на „Додај настан" и пополни ги деталите. Штом ќе го провериме — ќе го додадеме. Секој може да придонесе!', el: '.table-wrapper', pos: 'top' },

        // === VESTI ===
        { page: '/vesti', title: 'Вести 📰', text: 'Тука се собрани <strong>вести и написи</strong> за македонската музичка сцена од разни онлајн медиуми.<br><br>Специјалноста е што вестите не се случајни — се прикажуваат само оние што спомнуваат артист кој веќе постои во Мастер Листата. Така добиваш само релевантни вести за домашни музичари.', el: '.news-container', pos: 'top' },

        // === KUSTOSI ===
        { page: '/kustosi', title: 'Кустоси 🎧', text: 'Кустосите се луѓе кои рачно составуваат <strong>плејлисти со било каква музика</strong> и ги споделуваат тука.<br><br>Секој кустос има свој вкус и стил. Ако и ти имаш плејлиста со музика што ја ажурираш — можеш да аплицираш да станеш кустос. Не мора да си артист, доволно е да си жесток музички критичар.', el: '.curators-container', pos: 'top' },

        // === IZNENADI-ME ===
        { page: '/iznenadi-me', title: 'Изненади ме 🎲', text: 'Не знаеш што да слушаш? Нема проблем.<br><br>Избери <strong>жанр</strong> и <strong>временски период</strong>, кликни на копчето и сајтот ќе ти избере случаен артист. Одличен начин да откриеш нешто ново, или да се потсетиш на нешто заборавено.', el: '.surprise-container', pos: 'top' },
        { page: '/iznenadi-me', title: 'Тоа беше сè! 🎸', text: 'Фала што ја помина турата! Ако ти се допаѓа идејата, еве неколку начини како можеш да придонесеш:<br><br>• <strong>Додај артист</strong> што го нема во Мастер Листата<br>• <strong>Додај настан</strong> за претстоен концерт<br>• <strong>Стани кустос</strong> и сподели ја твојата плејлиста<br>• <strong>Верифицирај го бендот</strong> ако си артист<br>• <strong>Јави се</strong> на <a href="https://discord.gg/fj6dJGhM" target="_blank">Xotel Discord</a> за идеи, фидбек или само да поздравиш<br><br>Турата можеш да ја повториш кога сакаш — отвори ⚙ Поставки и кликни „Тура на сајтот".<br><br>Уживај! 🙌', el: null, pos: 'center' }
    ];

    var KEY_ACTIVE = 'mmm-tour-active';
    var KEY_STEP   = 'mmm-tour-step';
    var KEY_DONE   = 'mmm-tour-completed';

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
                        '<button class="tour-btn-skip">\u041F\u0440\u0435\u0441\u043A\u043E\u043A\u043D\u0438</button>' +
                        '<button class="tour-btn-prev"><i class="fas fa-arrow-left"></i></button>' +
                        '<button class="tour-btn-next">\u0421\u043B\u0435\u0434\u043D\u043E <i class="fas fa-arrow-right"></i></button>' +
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
        if (idx >= STEPS.length - 1) { endTour(); return; }
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
        var step = STEPS[idx];
        if (!step) { endTour(); return; }

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
        tooltip.querySelector('.tour-progress').textContent = (idx + 1) + ' / ' + STEPS.length;
        tooltip.querySelector('.tour-btn-prev').disabled = idx === 0;
        tooltip.querySelector('.tour-btn-next').innerHTML = idx === STEPS.length - 1
            ? '\u0417\u0430\u0432\u0440\u0448\u0438 <i class="fas fa-check"></i>'
            : '\u0421\u043B\u0435\u0434\u043D\u043E <i class="fas fa-arrow-right"></i>';

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
        // 1. Resume an active tour (e.g. after page navigation)
        if (sessionStorage.getItem(KEY_ACTIVE) === 'true') {
            var resumeIdx = getIdx();
            // Delay to let page content render (charts, tables, etc.)
            setTimeout(function() { beginTour(resumeIdx); }, 800);
            return;
        }

        // 2. Auto-start for first-time visitors on the index page
        var done = localStorage.getItem(KEY_DONE) === 'true'
                || localStorage.getItem('mmm-tour-viewed') === 'true';
        if (!done && onPage('/')) {
            setTimeout(function() { beginTour(0); }, 1500);
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
