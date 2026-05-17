/* Shared header loader — fetches /header.html and injects it into <header id="site-header">. */
(function () {
    var header = document.getElementById('site-header');
    if (!header) return;

    // Save page-specific children (buttons, info spans, etc.)
    var fragment = document.createDocumentFragment();
    while (header.firstChild) {
        fragment.appendChild(header.firstChild);
    }

    // Load header template (synchronous so DOM is ready for later scripts)
    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.protocol === 'file:' ? 'header.html' : '/header.html', false);
    xhr.send();
    if (xhr.status === 200 || xhr.status === 0) {
        header.innerHTML = xhr.responseText;
    }

    // Set active nav link
    var activeNav = header.dataset.active;
    if (activeNav) {
        var links = header.querySelectorAll('.site-nav-menu a');
        for (var i = 0; i < links.length; i++) {
            if (links[i].getAttribute('href') === activeNav) {
                links[i].classList.add('active');
                break;
            }
        }
    }

    // Basic local static servers often do not provide GitHub Pages' 404 fallback.
    // Use direct .html files in that environment while keeping clean URLs in production.
    var isLocal = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) {
        var cleanPages = {
            '/charts': 'charts.html',
            '/lista': 'lista.html',
            '/releases': 'releases.html',
            '/nastani': 'nastani.html',
            '/vesti': 'vesti.html',
            '/interviews': 'interviews.html',
            '/radio': 'radio.html',
            '/kustosi': 'kustosi.html',
            '/contributions': 'contributions.html',
            '/profile': 'profile.html',
            '/login': 'login.html',
            '/iznenadi-me': 'iznenadi-me.html',
            '/api': 'api.html',
            '/za': 'za.html',
            '/privatnost': 'privatnost.html',
            '/uslovi': 'uslovi.html'
        };
        var localLinks = header.querySelectorAll('a[href]');
        for (var j = 0; j < localLinks.length; j++) {
            var href = localLinks[j].getAttribute('href');
            if (href === '/') {
                localLinks[j].setAttribute('href', location.protocol === 'file:' ? 'index.html' : '/index.html');
            } else if (cleanPages[href]) {
                localLinks[j].setAttribute('href', location.protocol === 'file:' ? cleanPages[href] : '/' + cleanPages[href]);
            }
        }
    }

    // Set page title (and optional id)
    var h1 = header.querySelector('h1');
    if (h1) {
        h1.textContent = header.dataset.title || '';
        if (header.dataset.titleId) h1.id = header.dataset.titleId;
    }

    // Keep page-specific controls before the shared action cluster.
    // The auth/profile control stays as the furthest-right header action.
    var btnContainer = header.querySelector('.header-buttons');
    var shareLinkBtn = header.querySelector('#header-share-link-btn');
    var settingsBtn = header.querySelector('#settings-btn');
    var insertionPoint = shareLinkBtn || settingsBtn;
    if (btnContainer && insertionPoint && fragment.childNodes.length > 0) {
        btnContainer.insertBefore(fragment, insertionPoint);
    }

    // Apply i18n translations to the freshly injected header
    if (typeof applyTranslations === 'function') applyTranslations();

    window.dispatchEvent(new CustomEvent('mmm-header-loaded', { detail: { header: header } }));

    // Auto-collapse nav to mobile dropdown when buttons don't fit
    var navMenu = document.getElementById('site-nav-menu');
    if (navMenu) {
        function checkNavOverflow() {
            // Temporarily remove collapsed class to measure natural width
            header.classList.remove('nav-collapsed');
            // Force a layout so measurements are fresh
            void header.offsetWidth;
            // Check if the nav links overflow the header or run into page actions.
            var contentEl = header.querySelector('.header-content');
            var buttonsEl = header.querySelector('.header-buttons');
            var headerRect = header.getBoundingClientRect();
            var navRect = navMenu.getBoundingClientRect();
            var buttonsRect = buttonsEl ? buttonsEl.getBoundingClientRect() : null;
            var contentOverflow = contentEl && contentEl.scrollWidth > contentEl.clientWidth + 2;
            var navHeaderOverflow = navRect.width > 0 && navRect.right > headerRect.right - 2;
            var navActionOverlap = buttonsRect && navRect.width > 0 && navRect.right > buttonsRect.left - 2;
            if (contentOverflow || navHeaderOverflow || navActionOverlap) {
                header.classList.add('nav-collapsed');
            }
        }
        // Run after layout settles
        checkNavOverflow();
        setTimeout(checkNavOverflow, 100);
        window.addEventListener('load', checkNavOverflow);
        window.addEventListener('resize', checkNavOverflow);
        // Re-check when fonts finish loading (widths may change)
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(checkNavOverflow);
        }
    }
})();
