/**
 * progress-bar.js — Full-screen loading overlay for toplista.mk
 *
 * Hides the page body and shows a centred loading screen with a progress
 * bar and rotating funny messages.  On window.load the overlay fades out
 * and the real content is revealed.
 *
 * Only include this on pages whose own HTML / CSS / JS is heavy enough
 * to warrant a loading screen.  Pages that are thin shells with dynamic
 * JSON-fetched content should NOT include this script.
 *
 * Usage — add to <head> right after the dark-mode snippet:
 *   <script src="/progress-bar.js"></script>
 */
(function () {
    /* ── Inline fallback messages (used until JSON fetch completes) ── */
    var fallbackMessages = [
        'Вчитување...'
    ];

    var messages = fallbackMessages.slice();
    var usedIndices = [];

    /* ── Try to fetch the full message list ── */
    try {
        var xhr = new XMLHttpRequest();
        var messagesUrl = '/loading-messages.json?v=' + Date.now();
        xhr.open('GET', messagesUrl, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 && (xhr.status === 200 || xhr.status === 0)) {
                try {
                    var parsed = JSON.parse(xhr.responseText);
                    if (Array.isArray(parsed) && parsed.length) {
                        messages = parsed;
                        usedIndices = [];
                        if (msg && !done) {
                            msg.textContent = pickMessage();
                            msg.style.opacity = '1';
                        }
                    }
                } catch (e) { /* keep fallback */ }
            }
        };
        xhr.send();
    } catch (e) { /* keep fallback */ }

    /* ── Pick a random message without repeating until all are used ── */
    function pickMessage() {
        if (usedIndices.length >= messages.length) usedIndices = [];
        var idx;
        do { idx = Math.floor(Math.random() * messages.length); }
        while (usedIndices.indexOf(idx) !== -1);
        usedIndices.push(idx);
        return messages[idx];
    }

    /* ── Detect dark mode (matches the inline snippet in every <head>) ── */
    var isDark = document.documentElement.classList.contains('dark-mode');

    /* ── Inject CSS ── */
    var style = document.createElement('style');
    style.textContent = [
        /*
         * Don't use display:none — that prevents the browser from loading
         * images & other sub-resources.  Instead the fixed overlay covers
         * the page visually while everything loads behind it.
         * We just hide overflow so there's no flash of a scrollbar.
         */
        'body.mmm-loading { overflow: hidden !important; }',

        /* Full-screen overlay — solid bg, covers everything underneath */
        '#mmm-loader {',
        '  position: fixed; inset: 0; z-index: 999999;',
        '  display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center;',
        '  background: #f2f3f5;',
        '  font-family: "Inter", system-ui, sans-serif;',
        '  transition: opacity 0.45s ease;',
        '}',
        'html.dark-mode #mmm-loader { background: #111318; }',

        /* Logo pulse */
        '#mmm-loader-logo {',
        '  width: 64px; height: 64px; margin-bottom: 28px;',
        '  border-radius: 16px;',
        '  animation: mmm-logo-pulse 1.8s ease-in-out infinite;',
        '}',
        '@keyframes mmm-logo-pulse {',
        '  0%,100% { transform: scale(1); opacity: 0.85; }',
        '  50%     { transform: scale(1.07); opacity: 1; }',
        '}',

        /* Progress track */
        '#mmm-loader-track {',
        '  width: min(260px, 70vw); height: 4px;',
        '  border-radius: 4px; overflow: hidden;',
        '  background: rgba(0,0,0,0.06);',
        '}',
        'html.dark-mode #mmm-loader-track { background: rgba(255,255,255,0.06); }',

        /* Progress fill */
        '#mmm-loader-fill {',
        '  height: 100%; width: 0%; border-radius: 4px;',
        '  background: linear-gradient(90deg, #5a8ab5, #7c5cbf, #e05a8a);',
        '  background-size: 200% 100%;',
        '  animation: mmm-bar-shimmer 1.5s linear infinite;',
        '  transition: width 0.35s ease;',
        '}',
        '@keyframes mmm-bar-shimmer {',
        '  0%   { background-position: 200% 0; }',
        '  100% { background-position: -200% 0; }',
        '}',

        /* Message text */
        '#mmm-loader-msg {',
        '  margin-top: 16px; padding: 0 20px;',
        '  font-size: 13px; font-weight: 500;',
        '  color: #7c7f85; text-align: center;',
        '  transition: opacity 0.3s ease;',
        '  min-height: 1.4em;',
        '}',
        'html.dark-mode #mmm-loader-msg { color: #8c929a; }'
    ].join('\n');
    document.head.appendChild(style);

    /* ── Create loader DOM ── */
    var loader = document.createElement('div');
    loader.id = 'mmm-loader';

    var logo = document.createElement('img');
    logo.id = 'mmm-loader-logo';
    logo.src = '/logo.png';
    logo.alt = '';

    var track = document.createElement('div');
    track.id = 'mmm-loader-track';

    var fill = document.createElement('div');
    fill.id = 'mmm-loader-fill';

    var msg = document.createElement('div');
    msg.id = 'mmm-loader-msg';
    msg.textContent = pickMessage();

    track.appendChild(fill);
    loader.appendChild(logo);
    loader.appendChild(track);
    loader.appendChild(msg);

    /* ── Attach to DOM ── */
    function attach() {
        document.body.classList.add('mmm-loading');
        document.body.appendChild(loader);
    }
    if (document.body) {
        attach();
    } else {
        document.addEventListener('DOMContentLoaded', attach);
    }

    /* ── Progress simulation ── */
    var progress = 0;
    var done = false;

    function setProgress(pct) {
        progress = Math.min(pct, 100);
        fill.style.width = progress + '%';
    }

    /* Phase 1: Quick ramp to ~30% */
    var t1 = setInterval(function () {
        if (done || progress >= 30) { clearInterval(t1); return; }
        setProgress(progress + Math.random() * 8 + 2);
    }, 80);

    /* Phase 2: Slow crawl from 30→70% */
    var t2 = setInterval(function () {
        if (done) { clearInterval(t2); return; }
        if (progress >= 30 && progress < 70) {
            setProgress(progress + Math.random() * 2 + 0.5);
        }
    }, 300);

    /* Phase 3: Very slow crawl from 70→90% */
    var t3 = setInterval(function () {
        if (done) { clearInterval(t3); return; }
        if (progress >= 70 && progress < 90) {
            setProgress(progress + Math.random() * 0.5 + 0.1);
        }
    }, 500);

    /* Rotate funny messages every 2s */
    var t4 = setInterval(function () {
        if (done) { clearInterval(t4); return; }
        msg.style.opacity = '0';
        setTimeout(function () {
            msg.textContent = pickMessage();
            if (!done) msg.style.opacity = '1';
        }, 280);
    }, 2000);

    /* ── Finish: reveal page content ── */
    function finish() {
        if (done) return;
        done = true;
        clearInterval(t1);
        clearInterval(t2);
        clearInterval(t3);
        clearInterval(t4);

        /* Fill bar to 100% */
        setProgress(100);

        /* Short pause at 100%, then fade out overlay and reveal body */
        setTimeout(function () {
            loader.style.opacity = '0';
            setTimeout(function () {
                document.body.classList.remove('mmm-loading');
                if (loader.parentNode) loader.parentNode.removeChild(loader);
                if (style.parentNode) style.parentNode.removeChild(style);
            }, 450);
        }, 350);
    }

    /*
     * Expose a global function so the page can signal when it's truly ready
     * (e.g. after all fetch() calls and renders complete).
     *
     *   // in your page script, after all data is loaded & rendered:
     *   if (window.mmmFinishLoader) window.mmmFinishLoader();
     */
    window.mmmFinishLoader = finish;
})();
