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
    xhr.open('GET', '/header.html', false);
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

    // Set page title (and optional id)
    var h1 = header.querySelector('h1');
    if (h1) {
        h1.textContent = header.dataset.title || '';
        if (header.dataset.titleId) h1.id = header.dataset.titleId;
    }

    // Keep the generic share-link button immediately to the left of settings.
    // Any page-specific controls should appear before that pair.
    var btnContainer = header.querySelector('.header-buttons');
    var shareLinkBtn = header.querySelector('#header-share-link-btn');
    var settingsBtn = header.querySelector('#settings-btn');
    var insertionPoint = shareLinkBtn || settingsBtn;
    if (btnContainer && insertionPoint && fragment.childNodes.length > 0) {
        btnContainer.insertBefore(fragment, insertionPoint);
    }

    // Apply i18n translations to the freshly injected header
    if (typeof applyTranslations === 'function') applyTranslations();
})();
