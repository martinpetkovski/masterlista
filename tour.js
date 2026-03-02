// ==================== MULTI-PAGE SITE TOUR ====================
// Navigates between pages and highlights key features.
// First-time visitors on the index page get a prompt asking if they want a tour.
// Can be re-launched from Settings > "Тура на сајтот".
(function() {
    'use strict';

    var STEPS = [
        // === INDEX (Дома — Dashboard) ===
        { page: '/', title: 'Здраво! 👋', text: 'Добредојде на <strong>ТопЛиста.мк</strong>!<br><br>Ова е сајт за секој што сака македонска музика — тука ги следиме артистите, ги рангираме песните, собираме настани и вести, и уште многу работи.<br><br>Ајде да видиме што нуди сајтот. Турата трае околу 2 минути.', el: null, pos: 'center' },
        { page: '/', title: 'Навигација', text: 'Ова е <strong>навигацијата</strong>. Од тука стигнуваш до сè: топ листата, мастер листата, настаните, вестите и останатото.<br><br>На телефон, тапни на логото горе лево за да го отвориш менито — таму има и копче „Дома" за брз пристап до почетната.', el: '.site-title', pos: 'bottom' },
        { page: '/', title: 'Поставки ⚙', text: 'Во поставките можеш да промениш неколку работи:<br><br>• <strong>Тема</strong> — светла или темна, зависи како ти се допаѓа<br>• <strong>Стриминг сервис</strong> — избери го твојот (Spotify, YouTube, Apple Music…)<br><br>Кога ќе кликнеш на некоја песна на сајтот, таа ќе ти се отвори директно во сервисот што си го избрал.<br><br>⚙ Поставките ги наоѓаш во горната лента — заедно со логото, доволно е да скролнеш горе.', el: null, pos: 'center' },
        { page: '/', title: 'Почетна страница 🏠', text: 'Ова е <strong>контролната табла</strong> — преглед на сè што се случува на сајтот.<br><br>Тука ги гледаш најслушаните песни, новите изданија, претстојните настани, вести, препораки од кустоси, и уште многу — сè на едно место.', el: '.dashboard', pos: 'top' },
        { page: '/', title: 'Брзи акции ⚡', text: 'Овие копчиња се кратенки до најкорисните работи:<br><br>• <strong>Изненади ме</strong> — случаен артист<br>• <strong>Додај артист</strong> — предложи некој што го нема<br>• <strong>Додај настан</strong> — пријави концерт или фестивал<br>• <strong>Стани кустос</strong> — сподели ја твојата плејлиста<br><br>Доволно е еден клик.', el: '.quick-actions', pos: 'top' },

        // === CHARTS (Топ Листа) ===
        { page: '/charts', title: 'Топ Листа 📊', text: 'Ова е срцето на сајтот — <strong>Топ Листата</strong>.<br><br>Тука се рангирани најслушаните изданија (песни, албуми, EP-а) од македонски артисти. Рангирањето се базира на бројот на слушања на Spotify.<br><br>Податоците се освежуваат секој ден, а нова листа се пресметува секој понеделник. Секоја минатата листа се чува во архивата.', el: null, pos: 'center' },
        { page: '/charts', title: 'Филтри', text: 'Листата не е само една — има повеќе варијанти:<br><br>• <strong>Топ Листа</strong> — сите песни достапни на Spotify од артисти во Мастер Листата<br>• <strong>Алтернативна</strong> — сите песни кои не се поп<br>• <strong>Сите времиња</strong> — кумулативна листа на артисти по број на следачи<br><br>Филтрите можеш и да ги комбинираш за поспецифичен резултат.', el: '.chart-filter-bar', pos: 'bottom' },
        { page: '/charts', title: 'Секции', text: 'Листата е поделена на три секции:<br><br>• <strong>Сингли</strong> — поединечни песни<br>• <strong>Албуми</strong> — албуми и EP-а<br>• <strong>Нови изданија</strong> — песни објавени во последните 30 дена<br><br>Секоја секција може да се сподели посебно.', el: '.chart-sections', pos: 'top' },

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
        { page: '/iznenadi-me', title: 'Тоа беше сè! 🎸', text: 'Фала што ја помина турата! Ако ти се допаѓа идејата, еве неколку начини како можеш да придонесеш:<br><br>• <strong>Додај артист</strong> што го нема во Мастер Листата<br>• <strong>Додај настан</strong> за претстоен концерт<br>• <strong>Стани кустос</strong> и сподели ја твојата плејлиста<br>• <strong>Верифицирај го бендот</strong> ако си артист<br>• <strong>Јави се</strong> на <a href="https://discord.gg/DzBQASu7mU" target="_blank">Xotel Discord</a> за идеи, фидбек или само да поздравиш<br><br>Турата можеш да ја повториш кога сакаш — отвори \u2699 Поставки и кликни „Тура на сајтот".<br><br>Уживај! \uD83D\uDE4C', el: null, pos: 'center' }
    ];

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

        var pageTitles = {
            '/': '\u0414\u043e\u043c\u0430',
            '/lista': '\u041c\u0430\u0441\u0442\u0435\u0440 \u041b\u0438\u0441\u0442\u0430',
            '/charts': '\u0422\u043e\u043f \u041b\u0438\u0441\u0442\u0430',
            '/nastani': '\u041d\u0430\u0441\u0442\u0430\u043d\u0438',
            '/vesti': '\u0412\u0435\u0441\u0442\u0438',
            '/kustosi': '\u041a\u0443\u0441\u0442\u043e\u0441\u0438',
            '/iznenadi-me': '\u0418\u0437\u043d\u0435\u043d\u0430\u0434\u0438 \u043c\u0435',
            '/za': '\u0417\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0442',
            '/uslovi': '\u0423\u0441\u043b\u043e\u0432\u0438',
            '/privatnost': '\u041f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0441\u0442',
            '/nastan': '\u041d\u0430\u0441\u0442\u0430\u043d'
        };

        var shortTitle = pageTitles[curPage()];
        if (shortTitle) {
            titleEl.textContent = shortTitle;
        }
    }

    // ---- welcome prompt ----

    function showWelcomePrompt() {
        var existing = document.getElementById('tour-welcome');
        if (existing) existing.remove();

        var el = document.createElement('div');
        el.id = 'tour-welcome';
        el.className = 'tour-overlay active';
        el.innerHTML =
            '<div class="tour-tooltip tour-center">' +
                '<div class="tour-tooltip-content">' +
                    '<h3 class="tour-title">\u0417\u0434\u0440\u0430\u0432\u043e! \uD83D\uDC4B</h3>' +
                    '<p class="tour-description">\u0414\u043e\u0431\u0440\u0435\u0434\u043e\u0458\u0434\u0435 \u043d\u0430 <strong>\u0422\u043e\u043f\u041b\u0438\u0441\u0442\u0430.\u043c\u043a</strong>!<br><br>\u0421\u0430\u043a\u0430\u0448 \u043a\u0440\u0430\u0442\u043a\u0430 \u0442\u0443\u0440\u0430 \u043d\u0430 \u0441\u0430\u0458\u0442\u043e\u0442? \u0422\u0440\u0430\u0435 \u043e\u043a\u043e\u043b\u0443 2 \u043c\u0438\u043d\u0443\u0442\u0438 \u0438 \u045c\u0435 \u0442\u0438 \u043f\u043e\u043a\u0430\u0436\u0435 \u0448\u0442\u043e \u043d\u0443\u0434\u0438 \u0441\u0430\u0458\u0442\u043e\u0442 — \u0442\u043e\u043f \u043b\u0438\u0441\u0442\u0438, \u0430\u0440\u0442\u0438\u0441\u0442\u0438, \u043d\u0430\u0441\u0442\u0430\u043d\u0438 \u0438 \u043c\u043d\u043e\u0433\u0443 \u043f\u043e\u0432\u0435\u045c\u0435.<br><br>\u041c\u043e\u0436\u0435\u0448 \u0438 \u043f\u043e\u0434\u043e\u0446\u043d\u0430 \u0434\u0430 \u0458\u0430 \u043f\u043e\u0447\u043d\u0435\u0448 \u043e\u0434 \u2699 \u041f\u043e\u0441\u0442\u0430\u0432\u043a\u0438.</p>' +
                '</div>' +
                '<div class="tour-footer">' +
                    '<span></span>' +
                    '<div class="tour-buttons">' +
                        '<button class="tour-btn-skip tour-welcome-dismiss">\u041c\u043e\u0436\u0435\u0431\u0438 \u043f\u043e\u0434\u043e\u0446\u043d\u0430</button>' +
                        '<button class="tour-btn-next tour-welcome-start">\u0410\u0458\u0434\u0435! <i class="fas fa-arrow-right"></i></button>' +
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
