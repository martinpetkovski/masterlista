document.addEventListener('DOMContentLoaded', () => {
    // Silence console output in production; enable with ?debug=1
    try {
        const debugEnabled = /(?:^|[?&])debug=1(?:&|$)/.test(location.search);
        if (!debugEnabled && typeof window !== 'undefined' && window.console) {
            ['log','debug','info','warn','error'].forEach(m => { try { window.console[m] = function(){} } catch(_){} });
        }
    } catch (_) {}

    let bandsData = [];
    let originalBandsData = [];
    let hasUnsavedChanges = false;
    let isEditMode = false;
    let cachedAutoLabels = null; // Store auto_labels.json data globally
    let cachedChartData = null; // Store chart-data.json for releases data
    let artistThumbnailCache = {}; // Cache artist name -> thumbnail URL
    let latestReleaseDateByArtist = {}; // Cache artist name -> latest release date string
    let cachedRssArticles = null; // Cache RSS feed articles for media column
    let rssFeedsConfig = null; // RSS feeds configuration
    // Optional: set window.MMM_PR_ENDPOINT globally to override the button data-endpoint/localStorage
    
    /**
     * Calculate activity status based on chart data release dates.
     * active  - published work in the past 2 years
     * inactive - no published work in the past 3 years
     * maybe   - published work in the 2-3 years range
     * unknown - no data available
     */
    function getActivityStatus(bandName) {
        if (!bandName) return 'Непознато';
        const normalizedName = bandName.toLowerCase().trim();
        const dateStr = latestReleaseDateByArtist[normalizedName];
        if (!dateStr) return 'Непознато';
        
        const now = new Date();
        const parts = dateStr.split('-');
        const releaseDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const diffMs = now - releaseDate;
        const diffYears = diffMs / (365.25 * 24 * 60 * 60 * 1000);
        
        if (diffYears <= 2) return 'Активен';
        if (diffYears <= 3) return 'Можеби';
        return 'Неактивен';
    }
    
    /**
     * Build the latest release date lookup from chart data.
     * Should be called after cachedChartData is loaded.
     */
    function buildReleaseDateLookup() {
        latestReleaseDateByArtist = {};
        if (!cachedChartData?.releases) return;
        
        cachedChartData.releases.forEach(release => {
            if (!release.bandName || !release.releaseDate) return;
            const key = release.bandName.toLowerCase().trim();
            if (!latestReleaseDateByArtist[key] || release.releaseDate > latestReleaseDateByArtist[key]) {
                latestReleaseDateByArtist[key] = release.releaseDate;
            }
        });
    }
    
    // Compute whether white or black text has better contrast on a hex color
    function getContrastTextColor(hex) {
        if (!hex || hex.length < 7) return '#fff';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        // Relative luminance (sRGB)
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.55 ? '#000' : '#fff';
    }
    
    // Get artist profile image from chart-data.json (prefers Spotify artist image over release thumbnail)
    function getArtistThumbnail(artistName) {
        if (!artistName) return null;
        
        // Check cache first
        if (artistThumbnailCache[artistName] !== undefined) {
            return artistThumbnailCache[artistName];
        }
        
        if (!cachedChartData?.releases) {
            artistThumbnailCache[artistName] = null;
            return null;
        }
        
        // Find the most recent release for this artist (case-insensitive match)
        const normalizedName = artistName.toLowerCase().trim();
        const release = cachedChartData.releases.find(r => 
            r.bandName && r.bandName.toLowerCase().trim() === normalizedName
        );
        
        // Prefer artist profile image, fall back to release thumbnail
        const thumbnail = release?.artistImage || release?.thumbnail || null;
        artistThumbnailCache[artistName] = thumbnail;
        return thumbnail;
    }
    
    // Extract two dominant colors from an image URL, returns promise of [hex1, hex2] or null
    const imageColorCache = {};
    function extractTwoColorsFromImage(imageUrl) {
        if (imageColorCache[imageUrl] !== undefined) return Promise.resolve(imageColorCache[imageUrl]);
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const size = 40;
                    canvas.width = size;
                    canvas.height = size;
                    ctx.drawImage(img, 0, 0, size, size);
                    const data = ctx.getImageData(0, 0, size, size).data;
                    const buckets = {};
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i], g = data[i+1], b = data[i+2];
                        const brightness = (r + g + b) / 3;
                        if (brightness < 30 || brightness > 225) continue;
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        if (max === 0 || (max - min) / max < 0.12) continue;
                        const qr = Math.round(r / 32) * 32, qg = Math.round(g / 32) * 32, qb = Math.round(b / 32) * 32;
                        const key = `${qr},${qg},${qb}`;
                        if (!buckets[key]) buckets[key] = { r: qr, g: qg, b: qb, count: 0 };
                        buckets[key].count++;
                    }
                    const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
                    if (sorted.length >= 1) {
                        const toHex = c => '#' + [c.r, c.g, c.b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
                        const c1 = toHex(sorted[0]);
                        const c2 = sorted.length >= 2 ? toHex(sorted[1]) : c1;
                        imageColorCache[imageUrl] = [c1, c2];
                        resolve([c1, c2]);
                    } else {
                        imageColorCache[imageUrl] = null;
                        resolve(null);
                    }
                } catch (e) {
                    imageColorCache[imageUrl] = null;
                    resolve(null);
                }
            };
            img.onerror = () => { imageColorCache[imageUrl] = null; resolve(null); };
            img.src = imageUrl;
        });
    }
    
    // ==================== PERSISTENT STORAGE ====================
    const STORAGE_KEY = 'mmm-pending-changes'; // legacy key (migrated by mmm-drafts.js)
    
    // Load any pending changes from localStorage (uses unified draft system if available)
    function loadPendingChanges() {
        // Try unified draft system first
        if (window.MMMDrafts) {
            const draft = window.MMMDrafts.load('bands.json');
            if (draft && draft.muzickaMasterLista && Array.isArray(draft.muzickaMasterLista)) {
                console.log('Found pending changes via MMMDrafts');
                return { bandsData: draft.muzickaMasterLista, savedAt: (window.MMMDrafts.getMeta('bands.json') || {}).savedAt };
            }
        }
        // Fallback: legacy format
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                if (data && data.bandsData && Array.isArray(data.bandsData)) {
                    console.log('Found pending changes in localStorage (legacy)');
                    return data;
                }
            }
        } catch (err) {
            console.warn('Failed to load pending changes:', err);
        }
        return null;
    }
    
    // Save pending changes to localStorage (uses unified draft system)
    function savePendingChanges() {
        if (!hasUnsavedChanges) {
            // Clear draft if no changes
            if (window.MMMDrafts) {
                window.MMMDrafts.clear('bands.json');
            }
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        try {
            const exportData = {
                muzickaMasterLista: bandsData.map(band => ({
                    name: band.name, city: band.city, genre: band.genre,
                    soundsLike: band.soundsLike, links: band.links,
                    contact: band.contact, label: band.label,
                    accentColors: band.accentColors || null,
                    confirmed: band.confirmed || false
                }))
            };
            if (window.MMMDrafts) {
                const originalExport = {
                    muzickaMasterLista: originalBandsData.map(band => ({
                        name: band.name, city: band.city, genre: band.genre,
                        soundsLike: band.soundsLike, links: band.links,
                        contact: band.contact, label: band.label,
                        accentColors: band.accentColors || null,
                        confirmed: band.confirmed || false
                    }))
                };
                window.MMMDrafts.save('bands.json', exportData, originalExport);
            } else {
                // Fallback to legacy format
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    bandsData: bandsData,
                    savedAt: new Date().toISOString()
                }));
            }
            console.log('Saved pending changes');
        } catch (err) {
            console.warn('Failed to save pending changes:', err);
        }
    }
    
    // Save pending changes to localStorage before leaving (no prompt – data is persisted)
    window.addEventListener('beforeunload', () => {
        if (hasUnsavedChanges) {
            savePendingChanges();
        }
    });
    
    // Auto-save changes periodically
    setInterval(() => {
        if (hasUnsavedChanges) {
            savePendingChanges();
        }
    }, 30000); // Save every 30 seconds
    
    // Listen for draft discard from the floating bar
    window.addEventListener('mmm-drafts-discarded', () => {
        bandsData = JSON.parse(JSON.stringify(originalBandsData));
        hasUnsavedChanges = false;
        localStorage.removeItem(STORAGE_KEY);
        updateSubmitButtonState();
        invalidateBandCache();
        renderBands(bandsData);
    });
    
    // Listen for successful draft submission
    window.addEventListener('mmm-drafts-submitted', () => {
        originalBandsData = JSON.parse(JSON.stringify(bandsData));
        hasUnsavedChanges = false;
        localStorage.removeItem(STORAGE_KEY);
        updateSubmitButtonState();
    });
    
    // ==================== SETTINGS MENU ====================
    function initSettingsMenu() {
        const settingsBtn = document.getElementById('settings-btn');
        if (!settingsBtn) return;

        const svcDefs = {
            spotify: { name: 'Spotify', icon: 'fab fa-spotify', color: '#1DB954' },
            youtube: { name: 'YouTube', icon: 'fab fa-youtube', color: '#FF0000' },
            youtubeMusic: { name: 'YouTube Music', icon: 'fab fa-youtube', color: '#FF0000' },
            appleMusic: { name: 'Apple Music', icon: 'fab fa-apple', color: '#fc3c44' },
            deezer: { name: 'Deezer', icon: 'fas fa-headphones', color: '#A238FF' },
            tidal: { name: 'Tidal', icon: 'fas fa-water', color: '#000000' },
            amazonMusic: { name: 'Amazon Music', icon: 'fab fa-amazon', color: '#FF9900' },
            soundcloud: { name: 'SoundCloud', icon: 'fab fa-soundcloud', color: '#ff7700' },
            bandcamp: { name: 'Bandcamp', icon: 'fab fa-bandcamp', color: '#1da0c3' }
        };

        let overlay = document.getElementById('settings-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'settings-overlay';
            overlay.className = 'settings-overlay';

            const currentService = localStorage.getItem('mmm-preferred-service');
            const isDark = document.documentElement.classList.contains('dark-mode');

            overlay.innerHTML = `
                <div class="settings-panel">
                    <h3><i class="fas fa-gear"></i> Поставки</h3>
                    <div class="settings-section">
                        <div class="settings-section-title">Тема</div>
                        <div class="settings-theme-toggle">
                            <button class="settings-theme-btn ${!isDark ? 'active' : ''}" data-theme="light">
                                <i class="fas fa-sun"></i> Светла
                            </button>
                            <button class="settings-theme-btn ${isDark ? 'active' : ''}" data-theme="dark">
                                <i class="fas fa-moon"></i> Темна
                            </button>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-section-title">Стриминг сервис</div>
                        <div class="settings-service-options">
                            <button class="settings-service-btn no-pref ${!currentService ? 'active' : ''}" data-service="">
                                <i class="fas fa-question"></i> Секогаш прашувај
                            </button>
                            ${Object.entries(svcDefs).map(([id, svc]) => `
                                <button class="settings-service-btn ${id === currentService ? 'active' : ''}" data-service="${id}" style="--svc-color: ${svc.color}">
                                    <i class="${svc.icon}"></i> ${svc.name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="settings-section settings-tour-section">
                        <button class="settings-tour-btn" id="settings-start-tour">
                            <i class="fas fa-route"></i> Тура на сајтот
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('visible');
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const ov = document.getElementById('settings-overlay');
                    if (ov) ov.classList.remove('visible');
                }
            });

            // Theme toggle
            overlay.querySelectorAll('.settings-theme-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dark = btn.dataset.theme === 'dark';
                    document.body.classList.toggle('dark-mode', dark);
                    document.documentElement.classList.toggle('dark-mode', dark);
                    document.documentElement.style.backgroundColor = dark ? '#111318' : '';
                    localStorage.setItem('mmm-dark-mode', dark);
                    overlay.querySelectorAll('.settings-theme-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });

            // Service selection
            overlay.querySelectorAll('.settings-service-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const serviceId = btn.dataset.service;
                    if (serviceId) {
                        localStorage.setItem('mmm-preferred-service', serviceId);
                    } else {
                        localStorage.removeItem('mmm-preferred-service');
                    }
                    overlay.querySelectorAll('.settings-service-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Update any visible service preference indicators
                    document.querySelectorAll('.service-pref-current').forEach(el => {
                        if (serviceId && svcDefs[serviceId]) {
                            el.innerHTML = `<i class="${svcDefs[serviceId].icon}"></i>`;
                            el.title = svcDefs[serviceId].name;
                        }
                    });
                });
            });

            // Tour button
            const tourBtn = overlay.querySelector('#settings-start-tour');
            if (tourBtn) {
                tourBtn.addEventListener('click', () => {
                    overlay.classList.remove('visible');
                    if (typeof window.startGlobalTour === 'function') {
                        window.startGlobalTour();
                    }
                });
            }
        }

        // Open settings
        settingsBtn.addEventListener('click', () => {
            // Refresh active states
            const isDark = document.documentElement.classList.contains('dark-mode');
            overlay.querySelectorAll('.settings-theme-btn').forEach(btn => {
                btn.classList.toggle('active', (btn.dataset.theme === 'dark') === isDark);
            });
            const currentSvc = localStorage.getItem('mmm-preferred-service');
            overlay.querySelectorAll('.settings-service-btn').forEach(btn => {
                const svcId = btn.dataset.service;
                btn.classList.toggle('active', svcId === (currentSvc || ''));
            });
            overlay.classList.add('visible');
        });
    }

    // Initialize settings menu
    initSettingsMenu();

    // ==================== NAV MENU ====================
    function initNavMenu() {
        const trigger = document.querySelector('.site-nav-trigger');
        const menu = document.getElementById('site-nav-menu');
        if (!trigger || !menu) return;
        trigger.addEventListener('click', (e) => {
            // Only toggle dropdown on mobile (<=600px); on desktop nav is always visible
            if (window.innerWidth <= 600) {
                e.preventDefault();
                e.stopPropagation();
                menu.classList.toggle('open');
            }
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                menu.classList.remove('open');
            }
        });
    }
    initNavMenu();

    console.log('Script loaded, initializing...');

    const cyrillicToLatinMap = {
        'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
        'Д': 'D', 'д': 'd', 'Ѓ': 'Gj', 'ѓ': 'gj', 'Е': 'E', 'е': 'e', 'Ж': 'Zh', 'ж': 'zh',
        'З': 'Z', 'з': 'z', 'Ѕ': 'Dz', 'ѕ': 'dz', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
        'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'Lj', 'љ': 'lj', 'М': 'M', 'м': 'm',
        'Н': 'N', 'н': 'n', 'Њ': 'Nj', 'њ': 'nj', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
        'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'Kj', 'ќ': 'kj',
        'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
        'Ч': 'Ch', 'ч': 'ch', 'Џ': 'Dz', 'џ': 'dz', 'Ш': 'Sh', 'ш': 'sh'
    };

    const cyrillicToLatinShorthandMap = {
        'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
        'Д': 'D', 'д': 'd', 'Ѓ': 'G', 'ѓ': 'g', 'Е': 'E', 'е': 'e', 'Ж': 'Z', 'ж': 'z',
        'З': 'Z', 'з': 'z', 'Ѕ': 'D', 'ѕ': 'd', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
        'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'L', 'љ': 'l', 'М': 'M', 'м': 'm',
        'Н': 'N', 'н': 'n', 'Њ': 'N', 'њ': 'n', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
        'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'K', 'ќ': 'k',
        'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
        'Ч': 'C', 'ч': 'c', 'Џ': 'D', 'џ': 'd', 'Ш': 'S', 'ш': 's'
    };

    function transliterateCyrillicToLatin(text) {
        return text.split('')
            .map(char => cyrillicToLatinMap[char] || char)
            .join('');
    }

    // Generate URL-safe slug from artist name
    function generateArtistSlug(name) {
        return transliterateCyrillicToLatin(name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Get artist page URL
    function getArtistPageUrl(artistName) {
        const slug = encodeURIComponent(generateArtistSlug(artistName));
        // Use query params on localhost (no 404.html routing), clean URLs in production
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return `artist.html?a=${slug}`;
        }
        return `/${slug}`;
    }

    // ==================== ARTICLE LOADING & MATCHING ====================
    
    /**
     * Load articles from the pre-built articles.json archive.
     * Results are cached in cachedRssArticles.
     */
    async function loadRssFeeds() {
        if (cachedRssArticles !== null) return cachedRssArticles;
        try {
            const resp = await fetch('articles.json');
            if (!resp.ok) throw new Error(`Failed to load articles.json: ${resp.status}`);
            const archive = await resp.json();
            const allArticles = (archive.articles || []).map(a => ({
                title: a.title || '',
                link: a.link || '',
                description: a.description || '',
                content: '',
                pubDate: a.date ? new Date(a.date) : new Date(0),
                source: a.source || '',
                sourceIcon: a.iconUrl || '',
                siteUrl: a.siteUrl || ''
            }));
            allArticles.sort((a, b) => b.pubDate - a.pubDate);
            cachedRssArticles = allArticles;
            invalidateArticleMatchCache();
            return allArticles;
        } catch (err) {
            console.warn('Failed to load articles:', err);
            cachedRssArticles = [];
            invalidateArticleMatchCache();
            return [];
        }
    }
    
    /**
     * Find RSS articles matching a band name.
     * Checks both the original name and its Latin transliteration
     * against article titles and content (case-insensitive).
     * Returns matches sorted by date (latest first).
     */
    // Cache for findMatchingArticles results (cleared when RSS data changes)
    let articleMatchCache = new Map();
    function invalidateArticleMatchCache() { articleMatchCache = new Map(); }

    function findMatchingArticles(bandName) {
        if (!cachedRssArticles || cachedRssArticles.length === 0) return [];
        if (!bandName) return [];
        if (articleMatchCache.has(bandName)) return articleMatchCache.get(bandName);
        
        // Capitalize helper: first letter uppercase unless starts with digit
        function capitalize(s) {
            if (!s || /^\d/.test(s)) return s;
            return s.charAt(0).toUpperCase() + s.slice(1);
        }
        
        // Build search terms with proper casing (first letter uppercase).
        // Matching is case-sensitive and requires exact word boundaries to avoid
        // false positives like "визија" matching common text or "Јулијан" matching "Јулија".
        const searchTerms = new Set();
        const name = bandName.trim();
        if (name.length >= 3) searchTerms.add(capitalize(name));
        
        const latinName = transliterateCyrillicToLatin(bandName).trim();
        if (latinName.length >= 3 && latinName !== name) searchTerms.add(capitalize(latinName));
        
        // Also try shorthand transliteration (e.g. Ш→S instead of Sh)
        const latinShort = transliterateCyrillicToLatinShorthand(bandName).trim();
        if (latinShort.length >= 3 && latinShort !== name && latinShort !== latinName) searchTerms.add(capitalize(latinShort));
        
        if (searchTerms.size === 0) return [];
        
        // Word boundaries: start/end of string, whitespace, or common punctuation.
        // Case-sensitive matching with exact word boundaries.
        const B = '[\\s,;:.!?\\-–—\\/\\(\\)\\[\\]"\'\\|«»„"\\u2018\\u2019\\u201c\\u201d]';
        const termRegexes = [...searchTerms].map(term => {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('(?:^|' + B + ')' + escaped + '(?:$|' + B + ')');
        });
        
        const results = cachedRssArticles.filter(article => {
            const searchIn = article.title + ' ' + article.description + ' ' + article.content;
            
            for (const regex of termRegexes) {
                if (regex.test(searchIn)) return true;
            }
            return false;
        });
        articleMatchCache.set(bandName, results);
        return results;
    }
    
    // Start loading RSS feeds early (non-blocking)
    const rssLoadPromise = loadRssFeeds();

    // Start loading events early (non-blocking)
    let cachedEvents = null;
    async function loadEvents() {
        if (cachedEvents !== null) return cachedEvents;
        try {
            const resp = await fetch('events.json');
            if (!resp.ok) throw new Error(`Failed to load events.json: ${resp.status}`);
            const data = await resp.json();
            cachedEvents = (data.events || []).map(e => ({
                id: e.id,
                title: e.title || '',
                date: e.date || '',
                time: e.time || '',
                place: e.place || '',
                artists: e.artists || [],
                link: e.link || ''
            }));
            return cachedEvents;
        } catch (err) {
            console.warn('Failed to load events:', err);
            cachedEvents = [];
            return [];
        }
    }
    const eventsLoadPromise = loadEvents();

    function findMatchingEvents(bandName) {
        if (!cachedEvents || !bandName) return [];
        const lower = bandName.toLowerCase();
        return cachedEvents.filter(e =>
            e.artists.some(a => a.toLowerCase() === lower)
        );
    }

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function computeChangesSummary(orig, curr) {
        const byName = (arr) => {
            const map = new Map();
            arr.forEach(b => map.set(b.name, b));
            return map;
        };
        const o = byName(orig);
        const c = byName(curr);
        const added = [];
        const removed = [];
        const modified = [];
        c.forEach((band, name) => {
            if (!o.has(name)) {
                added.push(name);
            } else {
                const prev = o.get(name);
                const fields = ['city','genre','soundsLike','label','contact','confirmed'];
                const linkChanged = JSON.stringify(prev.links) !== JSON.stringify(band.links);
                const accentChanged = JSON.stringify(prev.accentColors) !== JSON.stringify(band.accentColors);
                const fieldChanges = [];
                fields.forEach(f => { if (prev[f] !== band[f]) fieldChanges.push({ field: f, from: prev[f], to: band[f] }); });
                if (linkChanged) fieldChanges.push({ field: 'links', from: prev.links, to: band.links });
                if (accentChanged) fieldChanges.push({ field: 'accentColors', from: prev.accentColors, to: band.accentColors });
                if (fieldChanges.length > 0) modified.push({ name, changes: fieldChanges });
            }
        });
        o.forEach((band, name) => { if (!c.has(name)) removed.push(name); });
        return { added, removed, modified };
    }

    function summarizeChangesText(diff) {
        const lines = [];
        if (diff.added.length) lines.push(`Додадени (${diff.added.length}): ${diff.added.join(', ')}`);
        if (diff.removed.length) lines.push(`Избришани (${diff.removed.length}): ${diff.removed.join(', ')}`);
        if (diff.modified.length) {
            const mods = diff.modified.map(m => `${m.name} [${m.changes.map(ch => ch.field).join(', ')}]`);
            lines.push(`Изменети (${diff.modified.length}): ${mods.join('; ')}`);
        }
        return lines.join('\n');
    }

    function updateSubmitButtonState() {
        const btn = document.getElementById('submit-pr-btn');
        if (!btn) return;
        btn.disabled = !hasUnsavedChanges;
        btn.title = hasUnsavedChanges ? 'Испрати барање за промена' : 'Нема промени за поднесување';
        
        // Add/remove glow animation class based on changes
        if (hasUnsavedChanges) {
            btn.classList.add('has-changes');
        } else {
            btn.classList.remove('has-changes');
        }
    }
    function transliterateCyrillicToLatinShorthand(text) {
        return text.split('')
            .map(char => cyrillicToLatinShorthandMap[char] || char)
            .join('');
    }

    function convertSpotifyUrlToAppUri(webUrl) {
        const match = webUrl.match(/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
        if (match && match[1]) {
            return `spotify:artist:${match[1]}`;
        }
        return webUrl;
    }

    // Custom dialog and notification functions
    function showCustomDialog(title, message, inputPlaceholder = '', defaultValue = '', isPRForm = false) {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-dialog-modal');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const inputContainer = document.getElementById('dialog-input-container');
            const prFormContainer = document.getElementById('pr-form-container');
            const inputEl = document.getElementById('dialog-input');
            const cancelBtn = document.getElementById('dialog-cancel-btn');
            const confirmBtn = document.getElementById('dialog-confirm-btn');
            const submitBtn = document.getElementById('dialog-submit-btn');

            titleEl.textContent = title;
            messageEl.innerHTML = message;

            if (isPRForm) {
                // Show PR form
                messageEl.style.display = 'none';
                inputContainer.style.display = 'none';
                prFormContainer.style.display = 'block';
                confirmBtn.style.display = 'none';
                submitBtn.style.display = 'inline-block';

                // Focus on contributor field
                const contributorInput = document.getElementById('pr-contributor');
                contributorInput.focus();

            } else {
                // Show simple dialog
                messageEl.style.display = 'block';
                prFormContainer.style.display = 'none';
                confirmBtn.style.display = 'inline-block';
                submitBtn.style.display = 'none';

                if (inputPlaceholder) {
                    inputContainer.style.display = 'block';
                    inputEl.placeholder = inputPlaceholder;
                    inputEl.value = defaultValue;
                    inputEl.focus();
                } else {
                    inputContainer.style.display = 'none';
                }
            }

            modal.style.display = 'block';

            const closeModal = () => {
                modal.style.display = 'none';
                // Clean up event listeners
                cancelBtn.removeEventListener('click', cancelHandler);
                confirmBtn.removeEventListener('click', confirmHandler);
                submitBtn.removeEventListener('click', submitHandler);
                modal.removeEventListener('click', outsideClickHandler);
                if (inputEl) inputEl.removeEventListener('keydown', enterHandler);
            };

            const cancelHandler = (e) => {
                e.stopPropagation();
                closeModal();
                resolve(null);
            };

            const confirmHandler = (e) => {
                e.stopPropagation();
                const value = inputPlaceholder ? inputEl.value : true;
                closeModal();
                resolve(value);
            };

            const submitHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Validate form
                const contributorInput = document.getElementById('pr-contributor');
                const descriptionInput = document.getElementById('pr-description');

                if (!descriptionInput.value.trim()) {
                    showNotification('Внесете опис на промените.', 'error');
                    descriptionInput.focus();
                    return;
                }

                const formData = {
                    contributor: contributorInput.value.trim(),
                    description: descriptionInput.value.trim()
                };

                closeModal();
                resolve(formData);
            };

            const outsideClickHandler = (e) => {
                if (e.target === modal) {
                    closeModal();
                    resolve(null);
                }
            };

            const enterHandler = (e) => {
                if (e.key === 'Enter') {
                    confirmHandler(e);
                }
            };

            cancelBtn.addEventListener('click', cancelHandler);
            confirmBtn.addEventListener('click', confirmHandler);
            submitBtn.addEventListener('click', submitHandler);
            modal.addEventListener('click', outsideClickHandler);

            if (!isPRForm && inputPlaceholder) {
                inputEl.addEventListener('keydown', enterHandler);
            }
        });
    }

    function showNotification(message, type = 'info', duration = 5000) {
        const notificationArea = document.getElementById('notification-area');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        notificationArea.appendChild(notification);

        // Auto remove after duration
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);

        // Click to dismiss
        notification.onclick = () => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        };
    }

    // Cool-toned city color palettes for light and dark modes
    const cityPaletteLight = [
        '#2a769e',  // strong blue
        '#2c8c82',  // peacock teal
        '#3e8c65',  // jungle green
        '#3b6ba5',  // royal blue tint
        '#4b6f96',  // steel blue
        '#2e80a0',  // ocean blue
        '#267d8f',  // deep cyan
        '#4a6fa5',  // cool blue
        '#358579',  // sea green
        '#566e9e',  // medium slate
        '#3a808c',  // teal blue
        '#468058',  // forest green
    ];
    const cityPaletteDark = [
        '#6ec6e8',  // bright sky
        '#7bb0df',  // soft blue
        '#65dcb2',  // bright mint
        '#8ab0de',  // periwinkle
        '#6edbb3',  // seafoam
        '#78aadb',  // cornflower
        '#5fcbc2',  // bright teal
        '#9cacd8',  // lavender blue
        '#68d4b8',  // turquoise
        '#7bb5e8',  // light blue
        '#82c9d6',  // ice blue
        '#8ed6a8',  // pale green
    ];

    function generateCityColor(city) {
        const asciiSum = city.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const isDark = document.documentElement.classList.contains('dark-mode');
        const palette = isDark ? cityPaletteDark : cityPaletteLight;
        return palette[asciiSum % palette.length];
    }

    function getCityTagStyle(city) {
        const hex = generateCityColor(city);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const isDark = document.documentElement.classList.contains('dark-mode');
        if (isDark) {
            // Dark mode: use bright palette color directly for text
            return `background: rgba(${r},${g},${b},0.15); color: rgb(${r},${g},${b}); border-color: rgba(${r},${g},${b},0.3)`;
        } else {
            // Light mode: use saturated palette color directly for text
            return `background: rgba(${r},${g},${b},0.1); color: rgb(${r},${g},${b}); border-color: rgba(${r},${g},${b},0.25)`;
        }
    }

    // Initialize scroll shadows for scrollable containers
    function initScrollShadows() {
        // Table wrapper (vertical scroll)
        const tableWrapper = document.querySelector('.table-wrapper');
        const scrollContainer = document.querySelector('.table-scroll-container');

        if (tableWrapper && scrollContainer) {
            // Create shadow overlay elements
            // IMPORTANT: Shadows appended to wrapper (fixed), listener attached to container (scrolling)
            const shadowTop = document.createElement('div');
            shadowTop.className = 'scroll-shadow-top';
            const shadowBottom = document.createElement('div');
            shadowBottom.className = 'scroll-shadow-bottom';
            tableWrapper.appendChild(shadowTop);
            tableWrapper.appendChild(shadowBottom);
            
            const updateTableShadows = () => {
                const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
                shadowTop.classList.toggle('visible', scrollTop > 5);
                shadowBottom.classList.toggle('visible', scrollTop < scrollHeight - clientHeight - 5);
            };
            scrollContainer.addEventListener('scroll', updateTableShadows);
            // Initial check and recheck after content loads
            updateTableShadows();
            setTimeout(updateTableShadows, 500);
        }

        // New release artists container (horizontal scroll via grid)
        const releaseContainer = document.getElementById('new-release-artists');
        if (releaseContainer) {
            // We need to observe when the grid is added and attach scroll listener
            const observer = new MutationObserver(() => {
                const releaseGrid = releaseContainer.querySelector('.new-release-grid');
                if (releaseGrid && !releaseGrid.dataset.shadowsInit) {
                    releaseGrid.dataset.shadowsInit = 'true';
                    
                    // Create shadow overlay elements for horizontal scroll
                    let shadowLeft = releaseContainer.querySelector('.scroll-shadow-left');
                    let shadowRight = releaseContainer.querySelector('.scroll-shadow-right');
                    if (!shadowLeft) {
                        shadowLeft = document.createElement('div');
                        shadowLeft.className = 'scroll-shadow-left';
                        releaseContainer.appendChild(shadowLeft);
                    }
                    if (!shadowRight) {
                        shadowRight = document.createElement('div');
                        shadowRight.className = 'scroll-shadow-right';
                        releaseContainer.appendChild(shadowRight);
                    }
                    
                    const updateReleaseShadows = () => {
                        const { scrollLeft, scrollWidth, clientWidth } = releaseGrid;
                        shadowLeft.classList.toggle('visible', scrollLeft > 5);
                        shadowRight.classList.toggle('visible', scrollLeft < scrollWidth - clientWidth - 5);
                    };
                    releaseGrid.addEventListener('scroll', updateReleaseShadows);
                    // Initial check
                    setTimeout(updateReleaseShadows, 100);
                }
            });
            observer.observe(releaseContainer, { childList: true, subtree: true });
        }
    }

    // Enable horizontal drag-to-scroll and wheel-to-scroll on .cell-scroll elements
    function initCellScrollDrag() {
        // Update fade mask based on scroll position
        function updateFadeMask(el) {
            if (el.scrollWidth <= el.clientWidth) {
                el.style.webkitMaskImage = 'none';
                el.style.maskImage = 'none';
                return;
            }
            const atStart = el.scrollLeft < 2;
            const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
            if (atStart && !atEnd) {
                el.style.webkitMaskImage = 'linear-gradient(to right, black calc(100% - 18px), transparent 100%)';
                el.style.maskImage = 'linear-gradient(to right, black calc(100% - 18px), transparent 100%)';
            } else if (!atStart && atEnd) {
                el.style.webkitMaskImage = 'linear-gradient(to left, black calc(100% - 18px), transparent 100%)';
                el.style.maskImage = 'linear-gradient(to left, black calc(100% - 18px), transparent 100%)';
            } else if (!atStart && !atEnd) {
                el.style.webkitMaskImage = 'linear-gradient(to right, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)';
                el.style.maskImage = 'linear-gradient(to right, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)';
            } else {
                el.style.webkitMaskImage = 'none';
                el.style.maskImage = 'none';
            }
        }

        // Attach scroll listener to dynamically update masks
        document.addEventListener('scroll', (e) => {
            const scrollEl = e.target.closest ? e.target.closest('.cell-scroll') : null;
            if (scrollEl) updateFadeMask(scrollEl);
        }, true);

        document.addEventListener('mousedown', (e) => {
            const scrollEl = e.target.closest('.cell-scroll');
            if (!scrollEl || scrollEl.scrollWidth <= scrollEl.clientWidth) return;
            scrollEl.style.cursor = 'grabbing';
            const startX = e.pageX;
            const startScrollLeft = scrollEl.scrollLeft;
            const onMove = (ev) => {
                ev.preventDefault();
                scrollEl.scrollLeft = startScrollLeft - (ev.pageX - startX);
                updateFadeMask(scrollEl);
            };
            const onUp = () => {
                scrollEl.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // Wheel-to-scroll: convert vertical wheel into horizontal scroll on .cell-scroll
        document.addEventListener('wheel', (e) => {
            const scrollEl = e.target.closest('.cell-scroll');
            if (!scrollEl || scrollEl.scrollWidth <= scrollEl.clientWidth) return;
            e.preventDefault();
            scrollEl.scrollLeft += e.deltaY;
            updateFadeMask(scrollEl);
        }, { passive: false });
    }
    initCellScrollDrag();

    function validateEmail(email) {
        if (!email) return true;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    function validateName(name) {
        return name && name.trim().length >= 2;
    }

    function validateLinks(linksContainer) {
        const linkSelects = linksContainer.querySelectorAll('select');
        const linkInputs = linksContainer.querySelectorAll('input[type="url"]');
        const platforms = new Set();
        // Media platforms that can have multiple entries (reviews, interviews, etc.)
        const allowDuplicates = ['review', 'interview', 'article', 'wikipedia', 'generic'];
        for (let i = 0; i < linkSelects.length; i++) {
            const platform = linkSelects[i].value;
            const url = linkInputs[i].value.trim();
            if (platform !== 'none' && url) {
                // Only check for duplicates if platform doesn't allow them
                if (!allowDuplicates.includes(platform) && platforms.has(platform)) {
                    return { valid: false, message: `Дупликат платформа: ${platform}` };
                }
                platforms.add(platform);
            }
        }
        return { valid: true };
    }

    function getPreferredLink(band) {
        const linkPriority = ['youtube', 'spotify'];
        for (const platform of linkPriority) {
            if (band.links[platform] && band.links[platform] !== 'недостигаат податоци') {
                return { platform, url: platform === 'spotify' ? convertSpotifyUrlToAppUri(band.links[platform]) : band.links[platform] };
            }
        }
        const firstPlatform = Object.keys(band.links).find(p => p !== 'none' && band.links[p] !== 'недостигаат податоци');
        if (firstPlatform) {
            return { platform: firstPlatform, url: band.links[firstPlatform] };
        }
        return { platform: 'none', url: null };
    }

    /**
     * Load Spotify releases from static chart-data.json file
     * (Generated daily by GitHub Action)
     */
    async function loadChartDataReleases(rawBands, processedBands) {
        try {
            console.log('Loading releases from chart-data.json...');
            
            const response = await fetch('chart-data.json');
            if (!response.ok) {
                throw new Error(`Failed to load chart-data.json: ${response.status}`);
            }
            
            const chartData = await response.json();
            const releases = chartData.releases || [];
            
            if (releases.length === 0) {
                console.log('No releases found in chart-data.json');
                return;
            }
            
            // Find most viewed release
            let mostViewed = null;
            
            // Process each release - only keep the most recent release per artist
            releases.forEach(release => {
                const bandName = release.bandName;
                
                // Update mostViewed (now based on popularity)
                if (!mostViewed || (release.popularity || 0) > (mostViewed.popularity || 0)) {
                    mostViewed = release;
                }
                
                // Update cachedAutoLabels - only if this release is newer than existing
                if (!cachedAutoLabels.bands[bandName]) {
                    cachedAutoLabels.bands[bandName] = {};
                }
                
                const existingDate = cachedAutoLabels.bands[bandName]?.spotify?.latestVideoPublishedAt;
                const newDate = release.releaseDate;
                
                // Only update if no existing data or this release is newer
                if (!existingDate || newDate > existingDate) {
                    cachedAutoLabels.bands[bandName].spotify = {
                        url: release.releaseUrl,
                        artistId: release.releaseId,
                        isGeneralChannel: false,
                        popular: (release.popularity || 0) >= 30 || release.followers >= 10000,
                        maxViewCount: release.popularity || release.followers,
                        newRelease: true,
                        latestVideoId: release.releaseId,
                        latestVideoUrl: release.releaseUrl,
                        latestVideoPublishedAt: release.releaseDate,
                        latestVideoViewCount: release.popularity || 0,
                        latestVideoTitle: release.releaseTitle,
                        latestVideoThumbnail: release.thumbnail,
                        releaseType: release.releaseType
                    };
                }
                
                // Note: We no longer automatically add 'Ново Издание' label to band data
                // The new release section handles display based on cachedAutoLabels
            });
            
            // Update source and most viewed
            cachedAutoLabels.source = 'spotify';
            if (mostViewed) {
                cachedAutoLabels.mostViewedNewRelease = {
                    bandName: mostViewed.bandName,
                    videoId: mostViewed.releaseId,
                    videoUrl: mostViewed.releaseUrl,
                    videoTitle: mostViewed.releaseTitle,
                    viewCount: mostViewed.popularity || 0,
                    publishedAt: mostViewed.releaseDate,
                    thumbnailUrl: mostViewed.thumbnail
                };
            }
            
            console.log(`Loaded ${releases.length} releases from chart-data.json`);
        } catch (err) {
            console.warn('Failed to load chart-data.json:', err);
            // Fall back to Spotify API if available
            if (typeof spotifyApi !== 'undefined') {
                console.log('Falling back to Spotify API...');
                fetchSpotifyReleasesInBackground(rawBands, processedBands);
            }
        }
    }

    /**
     * Fetch Spotify releases in background and update UI progressively
     */
    async function fetchSpotifyReleasesInBackground(rawBands, processedBands) {
        try {
            console.log('Background: Fetching Spotify releases...');
            
            const newReleases = [];
            let mostViewed = null;
            
            // Progress callback - updates UI as releases are found
            const onProgress = ({ release, bandName, progress, isNew }) => {
                if (isNew) {
                    newReleases.push(release);
                    
                    // Update mostViewed
                    if (!mostViewed || release.artistFollowers > mostViewed.artistFollowers) {
                        mostViewed = release;
                    }
                    
                    // Update cachedAutoLabels
                    if (!cachedAutoLabels.bands[bandName]) {
                        cachedAutoLabels.bands[bandName] = {};
                    }
                    cachedAutoLabels.bands[bandName].spotify = {
                        url: release.artistUrl,
                        artistId: release.artistId,
                        isGeneralChannel: false,
                        popular: release.artistPopularity >= 50 || release.artistFollowers >= 10000,
                        maxViewCount: release.artistFollowers,
                        newRelease: release.isNewRelease,
                        latestVideoId: release.releaseId,
                        latestVideoUrl: release.releaseUrl,
                        latestVideoPublishedAt: release.releaseDate,
                        latestVideoViewCount: release.artistFollowers,
                        latestVideoTitle: release.releaseTitle,
                        latestVideoThumbnail: release.thumbnail,
                        releaseType: release.releaseType,
                        totalTracks: release.totalTracks,
                        daysSinceRelease: release.daysSinceRelease
                    };
                    
                    // Note: We no longer automatically add 'Ново Издание' label to band data
                    // The new release section handles display based on cachedAutoLabels

                    // Re-render new releases section with updated data
                    cachedAutoLabels.source = 'spotify';
                    if (mostViewed) {
                        cachedAutoLabels.mostViewedNewRelease = {
                            bandName: mostViewed.bandName,
                            videoId: mostViewed.releaseId,
                            videoUrl: mostViewed.releaseUrl,
                            videoTitle: mostViewed.releaseTitle,
                            viewCount: mostViewed.artistFollowers,
                            publishedAt: mostViewed.releaseDate,
                            thumbnailUrl: mostViewed.thumbnail
                        };
                    }
                }
            };
            
            await spotifyApi.fetchAllNewReleases(rawBands, onProgress);
            
            console.log(`Background: Spotify fetch complete. Found ${newReleases.length} new releases.`);
        } catch (err) {
            console.warn('Background Spotify fetch error:', err);
        }
    }
    
    // Handle preview button clicks - opens on preferred service
    async function handlePreviewClick(btn) {
        const albumId = btn.dataset.albumId;
        const releaseCard = btn.closest('.new-release-card');
        const releaseUrl = releaseCard?.querySelector('.release-thumbnail-link')?.href;
        
        if (releaseUrl) {
            openOnPreferredService(releaseUrl);
        }
    }

    async function loadBandsData() {
        const loadingBar = document.getElementById('loading-bar');
        const controls = document.querySelector('.controls');
        const searchInput = document.getElementById('search-name');
        try {
            console.log('Loading bands data...');
            loadingBar.classList.add('active');
            // Disable controls while loading (keep visible)
            searchInput.disabled = true;
            searchInput.placeholder = 'Се вчитува...';
            controls.querySelectorAll('select, button').forEach(el => el.disabled = true);
            
            // Check for pending changes in localStorage
            const pendingChanges = loadPendingChanges();

            // Load chart data first for artist images
            try {
                const chartResponse = await fetch('chart-data.json');
                cachedChartData = await chartResponse.json();
                buildReleaseDateLookup();
                console.log('Loaded chart-data.json with', cachedChartData.releases?.length || 0, 'releases');
            } catch (chartError) {
                console.warn('Could not load chart-data.json:', chartError);
                cachedChartData = { releases: [] };
            }

            const response = await fetch('bands.json');
            const data = await response.json();
            
            // Initialize without Spotify data - load immediately
            cachedAutoLabels = { bands: {}, source: 'none' };
            
            // Helper to remove "Ново Издание" from manual labels (only use Spotify data)
            const CONTROLLED_LABELS = ['Ново Издание', '★', 'Ново'];
            
            function mergeComputedLabels(existingLabel, computedLabels) {
                const existing = (!existingLabel || existingLabel === 'недостигаат податоци')
                    ? []
                    : String(existingLabel).split(',').map(l => l.trim()).filter(Boolean);
                const merged = [...existing];
                computedLabels.forEach(l => { if (!merged.includes(l)) merged.push(l); });
                return merged.length ? merged.join(', ') : null;
            }

            function removeComputedLabels(existingLabel, labelsToRemove) {
                const existing = (!existingLabel || existingLabel === 'недостигаат податоци')
                    ? []
                    : String(existingLabel).split(',').map(l => l.trim()).filter(Boolean);
                const filtered = existing.filter(l => !labelsToRemove.includes(l));
                return filtered.length ? filtered.join(', ') : null;
            }
            
            // Check if we should restore pending changes
            if (pendingChanges && pendingChanges.bandsData) {
                const savedAt = new Date(pendingChanges.savedAt);
                const timeAgo = Math.round((Date.now() - savedAt.getTime()) / 60000); // minutes
                
                // Show notification about pending changes with discard option
                setTimeout(() => {
                    const notificationArea = document.getElementById('notification-area');
                    const notification = document.createElement('div');
                    notification.className = 'notification info';
                    notification.style.display = 'flex';
                    notification.style.alignItems = 'center';
                    notification.style.gap = '10px';
                    notification.style.cursor = 'default';
                    
                    const msgSpan = document.createElement('span');
                    msgSpan.textContent = `Вратени се зачувани промени од пред ${timeAgo} мин.`;
                    notification.appendChild(msgSpan);
                    
                    const discardBtn = document.createElement('button');
                    discardBtn.textContent = 'Отфрли';
                    discardBtn.style.cssText = 'background:#e74c3c;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85em;white-space:nowrap;';
                    discardBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        // Discard saved changes: revert to original server data
                        bandsData = JSON.parse(JSON.stringify(originalBandsData));
                        hasUnsavedChanges = false;
                        localStorage.removeItem(STORAGE_KEY);
                        updateSubmitButtonState();
                        invalidateBandCache();
                        renderBands(bandsData);
                        // Remove notification
                        if (notification.parentNode) notification.parentNode.removeChild(notification);
                        showNotification('Зачуваните промени се отфрлени.', 'info', 3000);
                    });
                    notification.appendChild(discardBtn);
                    
                    notificationArea.appendChild(notification);
                    
                    // Auto-dismiss after 15 seconds
                    setTimeout(() => {
                        notification.classList.add('fade-out');
                        setTimeout(() => {
                            if (notification.parentNode) notification.parentNode.removeChild(notification);
                        }, 300);
                    }, 15000);
                }, 500);
                
                // Use the saved data
                bandsData = pendingChanges.bandsData;
                invalidateBandCache(); // Clear cache since data changed
                hasUnsavedChanges = true;
                
                // Still load original data for comparison
                const originalFromServer = data.muzickaMasterLista.map((band) => {
                    let label = band.label || null;
                    label = removeComputedLabels(label, CONTROLLED_LABELS);
                    return {
                        name: band.name || 'недостигаат податоци',
                        city: band.city || 'недостигаат податоци',
                        genre: band.genre || 'недостигаат податоци',
                        soundsLike: band.soundsLike || 'недостигаат податоци',
                        links: Object.keys(band.links).length ? band.links : { none: 'недостигаат податоци' },
                        contact: band.contact || 'недостигаат податоци',
                        label,
                        accentColors: band.accentColors || null,
                        confirmed: band.confirmed || false
                    };
                });
                originalBandsData = JSON.parse(JSON.stringify(originalFromServer));
            } else {
                // Normal load - no pending changes
                bandsData = data.muzickaMasterLista.map((band) => {
                    // Remove manual "Ново Издание" tags - only Spotify data will add them
                    let label = band.label || null;
                    label = removeComputedLabels(label, CONTROLLED_LABELS);
                    
                    return {
                        name: band.name || 'недостигаат податоци',
                        city: band.city || 'недостигаат податоци',
                        genre: band.genre || 'недостигаат податоци',
                        soundsLike: band.soundsLike || 'недостигаат податоци',
                        links: Object.keys(band.links).length ? band.links : { none: 'недостигаат податоци' },
                        contact: band.contact || 'недостигаат податоци',
                        label,
                        accentColors: band.accentColors || null,
                        confirmed: band.confirmed || false
                    };
                });
                originalBandsData = JSON.parse(JSON.stringify(bandsData));
            }
            bandsData.sort((a, b) => {
                const nameA = transliterateCyrillicToLatin(a.name);
                const nameB = transliterateCyrillicToLatin(b.name);
                return nameA.localeCompare(nameB, 'en');
            });
            const totalBandsEl = document.getElementById('total-bands');
            if (totalBandsEl) totalBandsEl.textContent = bandsData.length;
            
            console.log(`Loaded ${bandsData.length} bands`);
            
            // Render the table first (highest priority)
            // Ensure RSS feeds and events are loaded before rendering
            try {
                await rssLoadPromise;
                console.log(`RSS feeds loaded: ${(cachedRssArticles || []).length} articles`);
            } catch (rssErr) {
                console.warn('RSS feeds not available:', rssErr);
            }
            try {
                await eventsLoadPromise;
                console.log(`Events loaded: ${(cachedEvents || []).length} events`);
            } catch (evtErr) {
                console.warn('Events not available:', evtErr);
            }
            
            renderBands(bandsData, { progressive: true });
            
            // Initialize filters and UI — each wrapped individually so one failure doesn't block the rest
            try { populateFilters(bandsData); } catch (e) { console.warn('populateFilters error:', e); }
            try { initializeFilters(); } catch (e) { console.warn('initializeFilters error:', e); }
            try { initializeModal(); } catch (e) { console.warn('initializeModal error:', e); }
            try { initializeSpotifyEmbedModal(); } catch (e) { console.warn('initializeSpotifyEmbedModal error:', e); }
            try { initializeCopyData(); } catch (e) { console.warn('initializeCopyData error:', e); }
            try { initializeSubmitPR(); } catch (e) { console.warn('initializeSubmitPR error:', e); }
            try { updateSubmitButtonState(); } catch (e) { console.warn('updateSubmitButtonState error:', e); }
            try { initScrollShadows(); } catch (e) { console.warn('initScrollShadows error:', e); }
            try { handleEditUrlParam(); } catch (e) { console.warn('handleEditUrlParam error:', e); }
            
            // Fetch last modified date from GitHub API (non-blocking)
            try {
                const response = await fetch('https://api.github.com/repos/martinpetkovski/masterlista/commits?path=bands.json&per_page=1');
                if (response.ok) {
                    const commits = await response.json();
                    if (commits.length > 0) {
                        const lastModified = new Date(commits[0].commit.committer.date);
                        const ageMs = Date.now() - lastModified.getTime();
                        const hours = Math.floor(ageMs / (60 * 60 * 1000));
                        const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
                        let ageStr;
                        if (hours >= 24) { ageStr = `пред ${Math.floor(hours/24)}д`; }
                        else if (hours > 0) { ageStr = `пред ${hours}ч`; }
                        else { ageStr = `пред ${minutes}мин`; }
                        const el = document.getElementById('last-modified');
                        if (el) el.textContent = ageStr;
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch last modified date from GitHub:', error);
            }
            
            // Load Spotify data from static JSON (generated by GitHub Action)
            loadChartDataReleases(data.muzickaMasterLista, bandsData);
        } catch (error) {
            console.error('Error loading bands:', error);
            // Only show error if no data was rendered at all
            if (bandsData.length === 0) {
                // Cancel any in-progress progressive render
                if (renderAbortController) {
                    renderAbortController.abort();
                    renderAbortController = null;
                }
                const tbody = document.getElementById('band-table-body');
                if (tbody && tbody.children.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8">Извинете, нешто тргна наопаку.</td></tr>';
                }
            }
        } finally {
            loadingBar.classList.remove('active');
            // Re-enable controls
            searchInput.disabled = false;
            searchInput.placeholder = 'Пребарај по име...';
            controls.querySelectorAll('select, button').forEach(el => el.disabled = false);
        }
    }

    const socialPlatforms = [
        { id: 'facebook', name: 'Facebook', icon: 'fa-brands fa-facebook' },
        { id: 'instagram', name: 'Instagram', icon: 'fa-brands fa-instagram' },
        { id: 'twitter', name: 'Twitter', icon: 'fa-brands fa-twitter' },
        { id: 'youtube', name: 'YouTube', icon: 'fa-brands fa-youtube' },
        { id: 'youtube_music', name: 'YouTube Music', icon: 'fa-brands fa-youtube' },
        { id: 'spotify', name: 'Spotify', icon: 'fa-brands fa-spotify' },
        { id: 'bandcamp', name: 'Bandcamp', icon: 'fa-brands fa-bandcamp' },
        { id: 'soundcloud', name: 'SoundCloud', icon: 'fa-brands fa-soundcloud' },
        { id: 'itunes', name: 'Apple Music', icon: 'fa-brands fa-itunes-note' },
        { id: 'apple_music', name: 'Apple Music', icon: 'fa-brands fa-itunes-note' },
        { id: 'deezer', name: 'Deezer', icon: 'fa-brands fa-deezer' },
        { id: 'tidal', name: 'Tidal', icon: 'fa-solid fa-water' },
        { id: 'amazon_music', name: 'Amazon Music', icon: 'fa-brands fa-amazon' },
        { id: 'napster', name: 'Napster', icon: 'fa-brands fa-napster' },
        { id: 'audiomack', name: 'Audiomack', icon: 'fa-solid fa-headphones' },
        { id: 'wikipedia', name: 'Wikipedia', icon: 'fa-brands fa-wikipedia-w' },
        { id: 'tiktok', name: 'TikTok', icon: 'fa-brands fa-tiktok' },
        { id: 'linkedin', name: 'LinkedIn', icon: 'fa-brands fa-linkedin' },
        { id: 'pinterest', name: 'Pinterest', icon: 'fa-brands fa-pinterest' },
        { id: 'twitch', name: 'Twitch', icon: 'fa-brands fa-twitch' },
        { id: 'vimeo', name: 'Vimeo', icon: 'fa-brands fa-vimeo' },
        { id: 'patreon', name: 'Patreon', icon: 'fa-brands fa-patreon' },
        { id: 'discord', name: 'Discord', icon: 'fa-brands fa-discord' },
        { id: 'interview', name: 'Интервју', icon: 'fa-solid fa-microphone' },
        { id: 'review', name: 'Рецензија', icon: 'fa-solid fa-star' },
        { id: 'article', name: 'Натпис', icon: 'fa-solid fa-newspaper' },
        { id: 'website', name: 'Website', icon: 'fa-solid fa-globe' },
        { id: 'linktree', name: 'Linktree', icon: 'fa-solid fa-tree' },
        { id: 'generic', name: 'Друг линк', icon: 'fa-solid fa-link' }
    ];

    // Auto-detect platform from URL domain/path
    const platformUrlPatterns = [
        { id: 'spotify',       pattern: /open\.spotify\.com|spotify\.com/i },
        { id: 'youtube_music', pattern: /music\.youtube\.com/i },
        { id: 'youtube',       pattern: /youtube\.com|youtu\.be/i },
        { id: 'instagram',     pattern: /instagram\.com/i },
        { id: 'facebook',      pattern: /facebook\.com|fb\.com|fb\.me/i },
        { id: 'twitter',       pattern: /twitter\.com|x\.com/i },
        { id: 'bandcamp',      pattern: /bandcamp\.com/i },
        { id: 'soundcloud',    pattern: /soundcloud\.com/i },
        { id: 'apple_music',   pattern: /music\.apple\.com/i },
        { id: 'itunes',        pattern: /itunes\.apple\.com/i },
        { id: 'deezer',        pattern: /deezer\.com/i },
        { id: 'tidal',         pattern: /tidal\.com/i },
        { id: 'amazon_music',  pattern: /music\.amazon/i },
        { id: 'napster',       pattern: /napster\.com/i },
        { id: 'audiomack',     pattern: /audiomack\.com/i },
        { id: 'tiktok',        pattern: /tiktok\.com/i },
        { id: 'linkedin',      pattern: /linkedin\.com/i },
        { id: 'pinterest',     pattern: /pinterest\.com/i },
        { id: 'twitch',        pattern: /twitch\.tv/i },
        { id: 'vimeo',         pattern: /vimeo\.com/i },
        { id: 'patreon',       pattern: /patreon\.com/i },
        { id: 'discord',       pattern: /discord\.gg|discord\.com/i },
        { id: 'wikipedia',     pattern: /wikipedia\.org/i },
        { id: 'linktree',      pattern: /linktr\.ee|linktree\.com/i },
    ];

    function detectPlatformFromUrl(url) {
        if (!url) return null;
        for (const { id, pattern } of platformUrlPatterns) {
            if (pattern.test(url)) return id;
        }
        return null;
    }

    function initializeFilters() {
        console.log('Initializing filters');
        $('#filter-city').select2({
            placeholder: 'Сите градови',
            allowClear: true,
            width: '100%'
        }).val('').trigger('change');
        $('#filter-genre').select2({
            placeholder: 'Сите жанрови',
            allowClear: true,
            width: '100%'
        }).val('').trigger('change');
        $('#filter-sounds-like').select2({
            placeholder: 'Звучи како било кој',
            allowClear: true,
            width: '100%'
        }).val('').trigger('change');
        $('#filter-status').select2({
            placeholder: 'Сите статуси',
            allowClear: true,
            width: '100%'
        }).val('').trigger('change');
        $('#filter-label').select2({
            placeholder: 'Сите ознаки',
            allowClear: true,
            width: '100%'
        }).val('').trigger('change');
        // Use debounced filter for search input (better performance)
        document.getElementById('search-name').addEventListener('input', filterBandsDebounced);
        // Use regular filter for dropdowns (immediate feedback)
        $('#filter-city').on('change', filterBands);
        $('#filter-genre').on('change', filterBands);
        $('#filter-sounds-like').on('change', filterBands);
        $('#filter-status').on('change', filterBands);
        $('#filter-label').on('change', filterBands);
        document.getElementById('clear-filters').addEventListener('click', () => {
            console.log('Clear filters clicked');
            document.getElementById('search-name').value = '';
            const mobileInput = document.getElementById('mobile-search-input');
            if (mobileInput) mobileInput.value = '';
            const clearBtn = document.getElementById('mobile-search-clear');
            if (clearBtn) clearBtn.classList.remove('visible');
            $('#filter-city').val('').trigger('change');
            $('#filter-genre').val('').trigger('change');
            $('#filter-sounds-like').val('').trigger('change');
            $('#filter-status').val('').trigger('change');
            $('#filter-label').val('').trigger('change');
            filterBands();
        });
        document.getElementById('toggle-filters').addEventListener('click', () => {
            console.log('Toggle filters clicked');
            const controls = document.querySelector('.controls');
            controls.classList.toggle('active');
            const isActive = controls.classList.contains('active');
            document.getElementById('toggle-filters').innerHTML = `<i class="fas ${isActive ? 'fa-times' : 'fa-filter'}"></i>`;
        });
        // Mobile unified search bar
        const mobileSearchInput = document.getElementById('mobile-search-input');
        const mobileSearchClear = document.getElementById('mobile-search-clear');
        if (mobileSearchInput) {
            let mobileSearchTimer = null;
            mobileSearchInput.addEventListener('input', () => {
                const val = mobileSearchInput.value;
                // Sync to desktop search-name
                document.getElementById('search-name').value = val;
                // Show/hide clear button
                if (mobileSearchClear) {
                    mobileSearchClear.classList.toggle('visible', val.length > 0);
                }
                // Debounced filter (capped for speed)
                if (mobileSearchTimer) clearTimeout(mobileSearchTimer);
                mobileSearchTimer = setTimeout(filterBandsFromSearch, SEARCH_DEBOUNCE_MS);
            });
            if (mobileSearchClear) {
                mobileSearchClear.addEventListener('click', () => {
                    mobileSearchInput.value = '';
                    document.getElementById('search-name').value = '';
                    mobileSearchClear.classList.remove('visible');
                    filterBands();
                });
            }
        }
    }

    // Autocomplete data cache
    let autocompleteData = {
        cities: [],
        genres: [],
        soundsLike: [],
        labels: []
    };

    // Build autocomplete data from bands
    function buildAutocompleteData() {
        const cityCounts = {};
        const genreCounts = {};
        const soundsLikeCounts = {};
        const labelCounts = {};

        bandsData.forEach(band => {
            if (band.city && band.city !== 'недостигаат податоци') {
                band.city.split(',').map(c => c.trim()).filter(Boolean).forEach(city => {
                    cityCounts[city] = (cityCounts[city] || 0) + 1;
                });
            }
            if (band.genre && band.genre !== 'недостигаат податоци') {
                band.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(genre => {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                });
            }
            if (band.soundsLike && band.soundsLike !== 'недостигаат податоци') {
                band.soundsLike.split(',').map(s => s.trim()).filter(Boolean).forEach(sound => {
                    soundsLikeCounts[sound] = (soundsLikeCounts[sound] || 0) + 1;
                });
            }
            if (band.label && band.label !== 'недостигаат податоци') {
                band.label.split(',').map(l => l.trim()).filter(Boolean).forEach(label => {
                    labelCounts[label] = (labelCounts[label] || 0) + 1;
                });
            }
        });

        // Sort by count descending, then alphabetically
        const sortByCountThenAlpha = (counts) => {
            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1] || transliterateCyrillicToLatin(a[0]).localeCompare(transliterateCyrillicToLatin(b[0]), 'en'))
                .map(([name, count]) => ({ name, count }));
        };

        autocompleteData.cities = sortByCountThenAlpha(cityCounts);
        autocompleteData.genres = sortByCountThenAlpha(genreCounts);
        autocompleteData.soundsLike = sortByCountThenAlpha(soundsLikeCounts);
        autocompleteData.labels = sortByCountThenAlpha(labelCounts);
    }

    // Initialize autocomplete for form fields
    function initializeAutocomplete() {
        buildAutocompleteData();

        const fields = [
            { inputId: 'band-city', dropdownId: 'band-city-autocomplete', data: () => autocompleteData.cities },
            { inputId: 'band-genre', dropdownId: 'band-genre-autocomplete', data: () => autocompleteData.genres },
            { inputId: 'band-sounds-like', dropdownId: 'band-sounds-like-autocomplete', data: () => autocompleteData.soundsLike },
            { inputId: 'band-label', dropdownId: 'band-label-autocomplete', data: () => autocompleteData.labels }
        ];

        fields.forEach(({ inputId, dropdownId, data }) => {
            const input = document.getElementById(inputId);
            const dropdown = document.getElementById(dropdownId);
            if (!input || !dropdown) return;

            let selectedIndex = -1;

            // Get the current partial term being typed (after last comma)
            const getCurrentTerm = () => {
                const value = input.value;
                const lastCommaIndex = value.lastIndexOf(',');
                return lastCommaIndex >= 0 ? value.substring(lastCommaIndex + 1).trim() : value.trim();
            };

            // Get already selected items
            const getSelectedItems = () => {
                const value = input.value;
                const lastCommaIndex = value.lastIndexOf(',');
                if (lastCommaIndex < 0) return [];
                return value.substring(0, lastCommaIndex).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            };

            // Filter and render suggestions
            const showSuggestions = () => {
                const term = getCurrentTerm().toLowerCase();
                const selectedItems = getSelectedItems();
                const allData = data();

                // Filter: match term and exclude already selected
                const filtered = allData.filter(item => {
                    const nameLower = item.name.toLowerCase();
                    const matchesTerm = term === '' || nameLower.includes(term);
                    const notAlreadySelected = !selectedItems.includes(nameLower);
                    return matchesTerm && notAlreadySelected;
                }).slice(0, 15); // Limit to 15 suggestions

                if (filtered.length === 0) {
                    dropdown.classList.remove('active');
                    dropdown.innerHTML = '';
                    return;
                }

                dropdown.innerHTML = filtered.map((item, idx) => 
                    `<div class="autocomplete-item${idx === selectedIndex ? ' selected' : ''}" data-value="${item.name}">${item.name}<span class="count">(${item.count})</span></div>`
                ).join('');

                dropdown.classList.add('active');
                selectedIndex = -1;
            };

            // Select an item
            const selectItem = (value) => {
                const currentValue = input.value;
                const lastCommaIndex = currentValue.lastIndexOf(',');
                const prefix = lastCommaIndex >= 0 ? currentValue.substring(0, lastCommaIndex + 1) + ' ' : '';
                input.value = prefix + value;
                dropdown.classList.remove('active');
                dropdown.innerHTML = '';
                input.focus();
                // Trigger tag update
                const event = new Event('input', { bubbles: true });
                input.dispatchEvent(event);
            };

            // Input event
            input.addEventListener('input', () => {
                showSuggestions();
            });

            // Focus event
            input.addEventListener('focus', () => {
                showSuggestions();
            });

            // Blur event (delayed to allow click)
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    dropdown.classList.remove('active');
                }, 200);
            });

            // Keyboard navigation
            input.addEventListener('keydown', (e) => {
                const items = dropdown.querySelectorAll('.autocomplete-item');
                if (!items.length) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    items.forEach((item, idx) => item.classList.toggle('selected', idx === selectedIndex));
                    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    items.forEach((item, idx) => item.classList.toggle('selected', idx === selectedIndex));
                    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'Enter' && selectedIndex >= 0) {
                    e.preventDefault();
                    const selectedItem = items[selectedIndex];
                    if (selectedItem) {
                        selectItem(selectedItem.dataset.value);
                    }
                } else if (e.key === 'Escape') {
                    dropdown.classList.remove('active');
                }
            });

            // Click on suggestion
            dropdown.addEventListener('click', (e) => {
                const item = e.target.closest('.autocomplete-item');
                if (item) {
                    selectItem(item.dataset.value);
                }
            });
        });
    }

    function initializeModal() {
        console.log('Initializing modal');
        const modal = document.getElementById('band-modal');
        const closeModal = document.querySelector('.modal-close');
        const form = document.getElementById('band-form');
        const addLinkBtn = document.getElementById('add-link-btn');
        const linksContainer = document.getElementById('links-container');

        if (!modal || !closeModal || !form || !addLinkBtn || !linksContainer) {
            console.error('Modal elements not found:', { modal, closeModal, form, addLinkBtn, linksContainer });
            showNotification('Грешка: елементите на модалот не се пронајдени.', 'error');
            return;
        }

        document.getElementById('add-band-btn').addEventListener('click', () => {
            console.log('Add band button clicked');
            openModal('add');
        });

        closeModal.addEventListener('click', () => {
            console.log('Close modal clicked');
            modal.style.display = 'none';
            clearErrors();
            clearTags();
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log('Clicked outside modal');
                modal.style.display = 'none';
                clearErrors();
                clearTags();
            }
        });

        addLinkBtn.addEventListener('click', () => {
            console.log('Add link button clicked');
            addLinkInput();
        });

        // Initialize autocomplete for multi-value fields
        initializeAutocomplete();

        ['band-city', 'band-genre', 'band-sounds-like', 'band-label'].forEach(id => {
            const input = document.getElementById(id);
            input.addEventListener('input', () => updateTags(id));
        });

        function showError(input, message) {
            const formGroup = input.closest('.form-group');
            let error = formGroup.querySelector('.error-message');
            if (!error) {
                error = document.createElement('div');
                error.className = 'error-message';
                error.style.color = '#d32f2f';
                error.style.fontSize = '0.8rem';
                error.style.marginTop = '0.2rem';
                formGroup.appendChild(error);
            }
            error.textContent = message;
        }

        function clearErrors() {
            document.querySelectorAll('.error-message').forEach(error => error.remove());
        }

        function clearTags() {
            ['band-city-tags', 'band-genre-tags', 'band-sounds-like-tags', 'band-label-tags'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '';
            });
        }

        function updateTags(inputId) {
            const input = document.getElementById(inputId);
            const tagContainer = document.getElementById(`${inputId}-tags`);
            if (!tagContainer) return;
            const value = input.value.trim();
            tagContainer.innerHTML = '';
            if (value && value !== 'недостигаат податоци') {
                const items = value.split(',').map(item => item.trim()).filter(item => item);
                const tagClass = inputId === 'band-city' ? 'city-tag' :
                                 inputId === 'band-genre' ? 'genre-tag' : 
                                 inputId === 'band-label' ? 'label-tag' : 'sounds-like-tag';
                items.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = `tag-item ${tagClass}`;
                    tag.textContent = item;
                    tagContainer.appendChild(tag);
                });
            }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Form submitted');
            clearErrors();

            const name = document.getElementById('band-name').value.trim();
            const contact = document.getElementById('band-contact').value.trim();
            let hasError = false;

            if (!validateName(name)) {
                showError(document.getElementById('band-name'), 'Името мора да има барем 2 карактери.');
                hasError = true;
            }

            const nameLatin = transliterateCyrillicToLatin(name).toLowerCase();
            const editIndex = form.dataset.editIndex;
            const isDuplicate = bandsData.some((band, index) => {
                const bandNameLatin = transliterateCyrillicToLatin(band.name).toLowerCase();
                return bandNameLatin === nameLatin && (editIndex === undefined || parseInt(editIndex) !== index);
            });
            if (isDuplicate) {
                showError(document.getElementById('band-name'), 'Бенд со ова име веќе постои.');
                hasError = true;
            }

            if (contact && !validateEmail(contact)) {
                showError(document.getElementById('band-contact'), 'Внесете валидна е-пошта или оставете празно.');
                hasError = true;
            }

            const linkValidation = validateLinks(linksContainer);
            if (!linkValidation.valid) {
                const formGroup = linksContainer.closest('.form-group');
                let error = formGroup.querySelector('.error-message');
                if (!error) {
                    error = document.createElement('div');
                    error.className = 'error-message';
                    error.style.color = '#d32f2f';
                    error.style.fontSize = '0.8rem';
                    error.style.marginTop = '0.2rem';
                    formGroup.appendChild(error);
                }
                error.textContent = linkValidation.message;
                hasError = true;
            }

            if (hasError) {
                console.log('Form validation failed');
                return;
            }

            const band = {
                name,
                city: document.getElementById('band-city').value.trim() || 'недостигаат податоци',
                genre: document.getElementById('band-genre').value.trim() || 'недостигаат податоци',
                soundsLike: document.getElementById('band-sounds-like').value.trim() || 'недостигаат податоци',
                label: document.getElementById('band-label').value.trim() || null,
                contact: contact || 'недостигаат податоци',
                accentColors: (() => {
                    const c1 = document.getElementById('band-accent-color-1').value.trim();
                    const c2 = document.getElementById('band-accent-color-2').value.trim();
                    return (c1 || c2) ? [c1 || null, c2 || null] : null;
                })(),
                confirmed: document.getElementById('band-confirmed')?.checked || false,
                links: {}
            };
            const linkSelects = linksContainer.querySelectorAll('select');
            const linkInputs = linksContainer.querySelectorAll('input[type="url"]');
            // Platforms that can have multiple entries
            const multiLinkPlatforms = ['review', 'interview', 'article', 'wikipedia', 'generic'];
            for (let i = 0; i < linkSelects.length; i++) {
                const platform = linkSelects[i].value;
                const url = linkInputs[i].value.trim();
                if (url && platform !== 'none') {
                    if (multiLinkPlatforms.includes(platform)) {
                        // Store as array for platforms that allow multiple
                        if (!band.links[platform]) {
                            band.links[platform] = [];
                        }
                        band.links[platform].push(url);
                    } else {
                        band.links[platform] = url;
                    }
                }
            }
            if (Object.keys(band.links).length === 0) {
                band.links = { none: 'недостигаат податоци' };
            }
            if (editIndex !== undefined && editIndex !== '') {
                console.log(`Updating band at index ${editIndex}`);
                bandsData[parseInt(editIndex)] = band;
            } else {
                console.log('Adding new band');
                bandsData.push(band);
            }
            bandsData.sort((a, b) => {
                const nameA = transliterateCyrillicToLatin(a.name);
                const nameB = transliterateCyrillicToLatin(b.name);
                return nameA.localeCompare(nameB, 'en');
            });
            invalidateBandCache(); // Clear cache since data changed
            const tb1 = document.getElementById('total-bands');
            if (tb1) tb1.textContent = bandsData.length;
            populateFilters(bandsData);
            filterBands();
            modal.style.display = 'none';
            form.reset();
            linksContainer.innerHTML = '';
            clearTags();
            clearErrors();
            hasUnsavedChanges = true;
            updateSubmitButtonState();
            savePendingChanges(); // Save to localStorage
            console.log('Form submission successful');
        });

        function addLinkInput(platform = 'none', url = '') {
            console.log('Adding link input:', { platform, url });
            const linkGroup = document.createElement('div');
            linkGroup.className = 'link-group';
            
            // Auto-detect platform from URL if not explicitly set
            if (platform === 'none' && url) {
                const detected = detectPlatformFromUrl(url);
                if (detected) platform = detected;
            }
            
            // Create wrapper for select/label with icon
            const selectWrapper = document.createElement('div');
            selectWrapper.className = 'platform-select-wrapper';
            
            // Create icon element (shown next to dropdown/label)
            const iconEl = document.createElement('i');
            const currentPlatform = socialPlatforms.find(p => p.id === platform);
            iconEl.className = (currentPlatform?.icon || 'fa-solid fa-link') + ' platform-icon';
            
            // Plain text label for recognized / empty state
            const label = document.createElement('span');
            label.className = 'platform-label';
            label.textContent = currentPlatform ? currentPlatform.name : 'Платформа';
            
            // Dropdown for manual selection (hidden by default)
            const select = document.createElement('select');
            select.className = 'platform-select';
            select.style.display = 'none';
            select.innerHTML = '<option value="none">Избери платформа</option>' +
                socialPlatforms.map(p => `<option value="${p.id}" ${p.id === platform ? 'selected' : ''}>${p.name}</option>`).join('');
            
            selectWrapper.appendChild(iconEl);
            selectWrapper.appendChild(label);
            selectWrapper.appendChild(select);
            
            const input = document.createElement('input');
            input.type = 'url';
            input.placeholder = 'Внеси URL (платформата се препознава автоматски)';
            input.value = url;
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
            removeBtn.addEventListener('click', () => {
                console.log('Remove link input clicked');
                linkGroup.remove();
            });
            linkGroup.appendChild(selectWrapper);
            linkGroup.appendChild(input);
            linkGroup.appendChild(removeBtn);
            linksContainer.appendChild(linkGroup);
            
            // Switch between label (read-only) and dropdown (manual)
            function showLabel(platformId) {
                const p = socialPlatforms.find(pp => pp.id === platformId);
                label.textContent = p ? p.name : 'Платформа';
                label.style.display = '';
                select.style.display = 'none';
                selectWrapper.classList.remove('manual-mode');
                iconEl.className = (p?.icon || 'fa-solid fa-link') + ' platform-icon';
            }
            
            function showDropdown() {
                label.style.display = 'none';
                select.style.display = '';
                selectWrapper.classList.add('manual-mode');
            }
            
            // Update icon when manual selection changes
            select.addEventListener('change', function() {
                const selectedPlatform = socialPlatforms.find(p => p.id === this.value);
                iconEl.className = (selectedPlatform?.icon || 'fa-solid fa-link') + ' platform-icon';
            });
            
            // Auto-detect platform when URL is typed or pasted
            function autoDetectFromInput() {
                const val = input.value.trim();
                const detected = detectPlatformFromUrl(val);
                if (detected) {
                    select.value = detected;
                    showLabel(detected);
                } else if (val) {
                    // Unrecognized URL — show dropdown for manual selection
                    showDropdown();
                } else {
                    // Empty input — show placeholder label
                    select.value = 'none';
                    showLabel(null);
                }
            }
            input.addEventListener('input', autoDetectFromInput);
            input.addEventListener('paste', () => {
                // Use setTimeout so the pasted value is available
                setTimeout(autoDetectFromInput, 0);
            });
        }
        
        // Format function for Select2 dropdown options (with icons)
        function formatPlatformOption(option) {
            if (!option.id) return option.text;
            const icon = $(option.element).data('icon') || 'fa-solid fa-link';
            return $(`<span><i class="${icon}" style="width: 20px; margin-right: 8px;"></i>${option.text}</span>`);
        }
        
        // Format function for Select2 selected item
        function formatPlatformSelection(option) {
            if (!option.id) return option.text;
            const icon = $(option.element).data('icon') || 'fa-solid fa-link';
            return $(`<span><i class="${icon}" style="width: 20px; margin-right: 8px;"></i>${option.text}</span>`);
        }

        function openModal(mode, band = null, index = null) {
            console.log(`Opening modal in ${mode} mode`, { band, index });
            const title = document.getElementById('modal-title');
            linksContainer.innerHTML = '';
            form.reset();
            clearErrors();
            clearTags();
            if (mode === 'add') {
                title.textContent = 'Додај артист';
                delete form.dataset.editIndex;
                addLinkInput();
                const deleteBtn = document.getElementById('delete-band-btn');
                if (deleteBtn) deleteBtn.style.display = 'none';
            } else {
                title.textContent = 'Уреди артист';
                console.log('Pre-filling form with band data:', band);
                if (!band) {
                    console.error('No band data provided for edit mode');
                    showNotification('Грешка: нема податоци за артистот за уредување.', 'error');
                    return;
                }
                document.getElementById('band-name').value = band.name !== 'недостигаат податоци' ? band.name : '';
                document.getElementById('band-city').value = band.city !== 'недостигаат податоци' ? band.city : '';
                document.getElementById('band-genre').value = band.genre !== 'недостигаат податоци' ? band.genre : '';
                document.getElementById('band-sounds-like').value = band.soundsLike !== 'недостигаат податоци' ? band.soundsLike : '';
                document.getElementById('band-label').value = band.label !== 'недостигаат податоци' ? band.label : '';
                document.getElementById('band-contact').value = band.contact !== 'недостигаат податоци' ? band.contact : '';
                document.getElementById('band-accent-color-1').value = (band.accentColors && band.accentColors[0]) || '';
                document.getElementById('band-accent-color-2').value = (band.accentColors && band.accentColors[1]) || '';
                // Update color picker previews and native pickers
                const picker1 = document.getElementById('accent-picker-1');
                const picker2 = document.getElementById('accent-picker-2');
                if (band.accentColors && (band.accentColors[0] || band.accentColors[1])) {
                    if (picker1) picker1.value = band.accentColors[0] || band.accentColors[1];
                    if (picker2) picker2.value = band.accentColors[1] || band.accentColors[0];
                } else {
                    // No explicit colors — try to suggest from thumbnail
                    const thumb = getArtistThumbnail(band.name);
                    if (thumb) {
                        extractTwoColorsFromImage(thumb).then(colors => {
                            if (colors) {
                                document.getElementById('band-accent-color-1').value = colors[0];
                                document.getElementById('band-accent-color-2').value = colors[1];
                                if (picker1) picker1.value = colors[0];
                                if (picker2) picker2.value = colors[1];
                            }
                        });
                    } else {
                        if (picker1) picker1.value = '#e94560';
                        if (picker2) picker2.value = '#ffa502';
                    }
                }
                const confirmedEl = document.getElementById('band-confirmed');
                if (confirmedEl) confirmedEl.checked = band.confirmed || false;
                if (band.links && band.links.none !== 'недостигаат податоци') {
                    Object.entries(band.links).forEach(([platform, urlOrUrls]) => {
                        // Handle both single URLs (string) and multiple URLs (array)
                        if (Array.isArray(urlOrUrls)) {
                            urlOrUrls.forEach(url => addLinkInput(platform, url));
                        } else {
                            addLinkInput(platform, urlOrUrls);
                        }
                    });
                } else {
                    addLinkInput();
                }
                form.dataset.editIndex = index;
                ['band-city', 'band-genre', 'band-sounds-like', 'band-label'].forEach(id => updateTags(id));
                // Show delete button in edit mode
                const deleteBtn = document.getElementById('delete-band-btn');
                if (deleteBtn) {
                    deleteBtn.style.display = '';
                    deleteBtn.onclick = async () => {
                        const confirmed = await showCustomDialog(
                            'Потврда за бришење',
                            `Дали сте сигурни дека сакате да го избришете артистот <strong>${band.name}</strong>?`
                        );
                        if (confirmed) {
                            modal.style.display = 'none';
                            console.log(`Deleting band at index ${index}`);
                            bandsData.splice(index, 1);
                            invalidateBandCache();
                            const tb2 = document.getElementById('total-bands');
                            if (tb2) tb2.textContent = bandsData.length;
                            populateFilters(bandsData);
                            filterBands();
                            hasUnsavedChanges = true;
                            updateSubmitButtonState();
                            savePendingChanges();
                        }
                    };
                }
            }
            modal.style.display = 'block';
            console.log('Modal opened successfully');
        }

        async function deleteBand(index) {
            console.log(`Delete band requested for index ${index}`);
            const bandName = bandsData[index] ? bandsData[index].name : 'овој артист';
            const confirmed = await showCustomDialog(
                'Потврда за бришење',
                `Дали сте сигурни дека сакате да го избришете артистот <strong>${bandName}</strong>?`
            );
            if (confirmed) {
                console.log(`Deleting band at index ${index}`);
                bandsData.splice(index, 1);
                invalidateBandCache(); // Clear cache since data changed
                const tb2 = document.getElementById('total-bands');
                if (tb2) tb2.textContent = bandsData.length;
                populateFilters(bandsData);
                filterBands();
                hasUnsavedChanges = true;
                updateSubmitButtonState();
                savePendingChanges(); // Save to localStorage
            }
        }

        window.openModal = openModal;
        window.deleteBand = deleteBand;

        console.log('Modal initialization complete, window.openModal defined:', typeof window.openModal);
    }

    function initializeCopyData() {
        console.log('Initializing copy data');
        const copyButton = document.getElementById('copy-data-btn');
        if (!copyButton) {
            console.error('Copy data button not found in DOM');
            showNotification('Грешка: копчето за копирање податоци не е пронајдено.', 'error');
            return;
        }
        copyButton.addEventListener('click', async () => {
            console.log('Copy data button clicked');
            const accepted = await showCustomDialog(
                'Лиценца за податоци',
                'Податоците се достапни под <strong>CC BY 4.0</strong> (Creative Commons Attribution) лиценца. Со копирање се согласувате дека ќе го наведете изворот при користење на податоците.'
            );
            if (!accepted) return;
            try {
                const exportData = {
                    muzickaMasterLista: bandsData.map(band => ({
                        name: band.name,
                        city: band.city,
                        genre: band.genre,
                        soundsLike: band.soundsLike,
                        links: band.links,
                        contact: band.contact,
                        label: band.label,
                        accentColors: band.accentColors || null,
                        confirmed: band.confirmed || false
                    }))
                };
                const json = JSON.stringify(exportData, null, 2);
                navigator.clipboard.writeText(json).then(() => {
                    console.log('Data copied to clipboard successfully');
                    showNotification('Податоците се копирани во клипборд.', 'success');
                }).catch(err => {
                    console.error('Error copying data to clipboard:', err);
                    showNotification('Грешка при копирање на податоците во клипборд. Проверете ја конзолата за детали.', 'error');
                });
            } catch (error) {
                console.error('Error preparing data for copy:', error);
                showNotification('Грешка при подготовка на податоците за копирање. Проверете ја конзолата за детали.', 'error');
            }
        });
    }

    function initializeSubmitPR() {
        const submitBtn = document.getElementById('submit-pr-btn');
        if (!submitBtn) return;

        // Make sure current changes are saved to the draft system before showing the dialog
        submitBtn.addEventListener('click', () => {
            if (!hasUnsavedChanges) {
                showNotification('Нема промени за поднесување.', 'info');
                return;
            }
            // Ensure latest data is saved to drafts
            savePendingChanges();
            // Trigger the unified submit dialog from mmm-drafts.js
            if (window.MMMDrafts && document.getElementById('mmm-draft-submit')) {
                document.getElementById('mmm-draft-submit').click();
            }
        });
    }

    function initializeMasterEdit() {
        console.log('Initializing master edit button');
        const masterEditBtn = document.getElementById('master-edit-btn');
        if (!masterEditBtn) {
            console.error('Master edit button not found in DOM');
            showNotification('Грешка: копчето за уредување не е пронајдено.', 'error');
            return;
        }
        masterEditBtn.addEventListener('click', () => {
            console.log('Master edit button clicked');
            isEditMode = !isEditMode;
            document.body.classList.toggle('edit-mode', isEditMode);
            masterEditBtn.innerHTML = isEditMode ?
                '<i class="fas fa-times"></i>' :
                '<i class="fas fa-edit"></i>';
            masterEditBtn.title = isEditMode ? 'Исклучи уредување' : 'Уреди';
            console.log('Edit mode:', isEditMode);
            renderBands(bandsData);
        });
    }

    // ==================== OPTIMIZED FILTER SYSTEM ====================
    
    // Cache for pre-computed band data to avoid repeated string operations
    let bandDataCache = null;
    
    // Pre-built name→index map to avoid O(n) findIndex per row
    let bandIndexMap = null;
    function buildBandIndexMap() {
        if (bandIndexMap && bandIndexMap.size === bandsData.length) return bandIndexMap;
        bandIndexMap = new Map();
        for (let i = 0; i < bandsData.length; i++) {
            const b = bandsData[i];
            bandIndexMap.set(b.name + '|' + b.city + '|' + b.genre, i);
        }
        return bandIndexMap;
    }
    
    // Debounce timer for search input
    let searchDebounceTimer = null;
    const SEARCH_DEBOUNCE_MS = 120;
    
    // Max rows to render during active search (for responsiveness)
    const SEARCH_RENDER_CAP = 80;
    
    // Build optimized cache for band data
    function buildBandDataCache() {
        if (bandDataCache && bandDataCache.length === bandsData.length) return bandDataCache;
        
        bandDataCache = bandsData.map(band => {
            const nameLower = band.name.toLowerCase();
            const nameLatinFull = transliterateCyrillicToLatin(band.name).toLowerCase();
            const nameLatinShort = transliterateCyrillicToLatinShorthand(band.name).toLowerCase();
            const cities = band.city !== 'недостигаат податоци' 
                ? band.city.split(',').map(c => c.trim()).filter(Boolean)
                : [];
            const genres = band.genre !== 'недостигаат податоци'
                ? band.genre.split(',').map(g => g.trim()).filter(Boolean)
                : [];
            const soundsLike = band.soundsLike !== 'недостигаат податоци'
                ? band.soundsLike.split(',').map(s => s.trim()).filter(Boolean)
                : [];
            const labels = (band.label && band.label !== 'недостигаат податоци' && band.label !== null)
                ? String(band.label).split(',').map(l => l.trim()).filter(Boolean)
                : [];
            
            return {
                band,
                nameLower,
                nameLatinFull,
                nameLatinShort,
                cities: new Set(cities),
                citiesArray: cities,
                genres: new Set(genres),
                genresArray: genres,
                soundsLike: new Set(soundsLike),
                soundsLikeArray: soundsLike,
                labels: new Set(labels),
                labelsArray: labels,
                status: getActivityStatus(band.name),
                // Unified search string for mobile: name + city + genre + label + soundsLike
                searchAll: [nameLower, nameLatinFull, nameLatinShort, ...cities.map(c => c.toLowerCase()), ...genres.map(g => g.toLowerCase()), ...soundsLike.map(s => s.toLowerCase()), ...labels.map(l => l.toLowerCase())].join(' ')
            };
        });
        
        return bandDataCache;
    }
    
    // Invalidate cache when bands data changes
    function invalidateBandCache() {
        bandDataCache = null;
        bandIndexMap = null;
    }
    
    // Flag to prevent recursive filtering during option updates
    let isUpdatingFilters = false;
    
    // Get current filter values
    function getCurrentFilters() {
        return {
            searchName: document.getElementById('search-name').value.toLowerCase(),
            city: $('#filter-city').val() || '',
            genre: $('#filter-genre').val() || '',
            soundsLike: $('#filter-sounds-like').val() || '',
            status: $('#filter-status').val() || '',
            label: $('#filter-label').val() || ''
        };
    }
    
    /**
     * Single-pass approach: compute available filter options for all dropdowns
     * by checking, for each cached band, which filters it WOULD pass if a
     * specific filter were excluded. Instead of 5 separate full-array passes,
     * we do ONE pass and accumulate counts per filter group.
     */
    function computeAllFilterOptionCounts(filters, searchName, searchNameLatinFull, searchNameLatinShort) {
        const cache = buildBandDataCache();
        const hasCity = !!filters.city;
        const hasGenre = !!filters.genre;
        const hasSoundsLike = !!filters.soundsLike;
        const hasStatus = !!filters.status;
        const hasLabel = !!filters.label;

        const cityCounts = {};
        const genreCounts = {};
        const soundsLikeCounts = {};
        const statusCounts = {};
        const labelCounts = {};

        for (let i = 0, len = cache.length; i < len; i++) {
            const cached = cache[i];

            // Name filter always applies
            if (searchName) {
                if (!(
                    cached.nameLower.includes(searchName) ||
                    cached.nameLatinFull.includes(searchNameLatinFull) ||
                    cached.nameLatinShort.includes(searchNameLatinShort) ||
                    cached.nameLatinFull.includes(searchNameLatinShort) ||
                    cached.nameLatinShort.includes(searchNameLatinFull)
                )) continue;
            }

            // Pre-compute which dropdown filters this item passes
            const passCity = !hasCity || cached.cities.has(filters.city);
            const passGenre = !hasGenre || cached.genres.has(filters.genre);
            const passSoundsLike = !hasSoundsLike || cached.soundsLike.has(filters.soundsLike);
            const passStatus = !hasStatus || cached.status === filters.status;
            const passLabel = !hasLabel || cached.labels.has(filters.label);

            // For each filter, count options from items that pass ALL OTHER filters
            if (passGenre && passSoundsLike && passStatus && passLabel) {
                for (let j = 0; j < cached.citiesArray.length; j++) {
                    const v = cached.citiesArray[j];
                    cityCounts[v] = (cityCounts[v] || 0) + 1;
                }
            }
            if (passCity && passSoundsLike && passStatus && passLabel) {
                for (let j = 0; j < cached.genresArray.length; j++) {
                    const v = cached.genresArray[j];
                    genreCounts[v] = (genreCounts[v] || 0) + 1;
                }
            }
            if (passCity && passGenre && passStatus && passLabel) {
                for (let j = 0; j < cached.soundsLikeArray.length; j++) {
                    const v = cached.soundsLikeArray[j];
                    soundsLikeCounts[v] = (soundsLikeCounts[v] || 0) + 1;
                }
            }
            if (passCity && passGenre && passSoundsLike && passLabel) {
                const v = cached.status;
                statusCounts[v] = (statusCounts[v] || 0) + 1;
            }
            if (passCity && passGenre && passSoundsLike && passStatus) {
                for (let j = 0; j < cached.labelsArray.length; j++) {
                    const v = cached.labelsArray[j];
                    labelCounts[v] = (labelCounts[v] || 0) + 1;
                }
            }
        }

        return { cityCounts, genreCounts, soundsLikeCounts, statusCounts, labelCounts };
    }
    
    // Update a single select element from pre-computed counts
    function updateFilterSelect(selectElement, counts, currentValue) {
        const sortedValues = Object.keys(counts).sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en')
        );
        
        // Quick diff: compare serialized options to avoid unnecessary DOM writes
        const newSig = sortedValues.map(v => v + '(' + counts[v] + ')').join('|');
        if (selectElement._optionSig === newSig) return;
        selectElement._optionSig = newSig;
        
        selectElement.innerHTML = '<option value=""></option>' +
            sortedValues.map(v => `<option value="${v}">${v} (${counts[v]})</option>`).join('');
        
        if (currentValue && counts[currentValue]) {
            selectElement.value = currentValue;
        }
    }
    
    // Update all filter dropdowns in a single pass
    function updateAllFilterOptions(filters, searchName, searchNameLatinFull, searchNameLatinShort) {
        if (!filters) filters = getCurrentFilters();
        if (searchName === undefined) {
            searchName = filters.searchName;
            searchNameLatinFull = searchName ? transliterateCyrillicToLatin(searchName).toLowerCase() : '';
            searchNameLatinShort = searchName ? transliterateCyrillicToLatinShorthand(searchName).toLowerCase() : '';
        }
        
        const allCounts = computeAllFilterOptionCounts(filters, searchName, searchNameLatinFull, searchNameLatinShort);
        
        updateFilterSelect(document.getElementById('filter-city'), allCounts.cityCounts, filters.city);
        updateFilterSelect(document.getElementById('filter-genre'), allCounts.genreCounts, filters.genre);
        updateFilterSelect(document.getElementById('filter-sounds-like'), allCounts.soundsLikeCounts, filters.soundsLike);
        updateFilterSelect(document.getElementById('filter-status'), allCounts.statusCounts, filters.status);
        updateFilterSelect(document.getElementById('filter-label'), allCounts.labelCounts, filters.label);
    }
    
    // Initial population of filters (full data, no filtering)
    function populateFilters(data) {
        console.log('Populating filters');
        // Ensure cache is built
        buildBandDataCache();
        
        const citySelect = document.getElementById('filter-city');
        const genreSelect = document.getElementById('filter-genre');
        const soundsLikeSelect = document.getElementById('filter-sounds-like');
        const statusSelect = document.getElementById('filter-status');
        const labelSelect = document.getElementById('filter-label');
        
        // City
        const cityCounts = {};
        const citySet = new Set();
        data.forEach(band => {
            if (band.city !== 'недостигаат податоци') {
                band.city.split(',').map(c => c.trim()).filter(Boolean).forEach(city => {
                    cityCounts[city] = (cityCounts[city] || 0) + 1;
                    citySet.add(city);
                });
            }
        });
        const cities = [...citySet].sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en'));
        citySelect.innerHTML = '<option value=""></option>' +
            cities.map(city => `<option value="${city}">${city} (${cityCounts[city] || 0})</option>`).join('');
        
        // Genre
        const genreCounts = {};
        const genreSet = new Set();
        data.forEach(band => {
            if (band.genre !== 'недостигаат податоци') {
                band.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(genre => {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                    genreSet.add(genre);
                });
            }
        });
        const genres = [...genreSet].sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en'));
        genreSelect.innerHTML = '<option value=""></option>' +
            genres.map(genre => `<option value="${genre}">${genre} (${genreCounts[genre] || 0})</option>`).join('');
        
        // Sounds Like
        const soundsLikeCounts = {};
        const soundsLikeSet = new Set();
        data.forEach(band => {
            if (band.soundsLike !== 'недостигаат податоци') {
                band.soundsLike.split(',').map(s => s.trim()).filter(Boolean).forEach(sound => {
                    soundsLikeCounts[sound] = (soundsLikeCounts[sound] || 0) + 1;
                    soundsLikeSet.add(sound);
                });
            }
        });
        const soundsLike = [...soundsLikeSet].sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en'));
        soundsLikeSelect.innerHTML = '<option value=""></option>' +
            soundsLike.map(sound => `<option value="${sound}">${sound} (${soundsLikeCounts[sound] || 0})</option>`).join('');
        
        // Status (computed from chart data)
        const statusCounts = {};
        data.forEach(band => {
            const status = getActivityStatus(band.name);
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        const statuses = Object.keys(statusCounts).sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en'));
        statusSelect.innerHTML = '<option value=""></option>' +
            statuses.map(status => `<option value="${status}">${status} (${statusCounts[status] || 0})</option>`).join('');
        
        // Label
        const labelCounts = {};
        const labelSet = new Set();
        data.forEach(band => {
            if (band.label && band.label !== 'недостигаат податоци' && band.label !== null) {
                String(band.label).split(',').map(l => l.trim()).filter(Boolean).forEach(l => {
                    labelCounts[l] = (labelCounts[l] || 0) + 1;
                    labelSet.add(l);
                });
            }
        });
        const labels = [...labelSet].sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en'));
        labelSelect.innerHTML = '<option value=""></option>' +
            labels.map(label => `<option value="${label}">${label} (${labelCounts[label] || 0})</option>`).join('');
    }

    /**
     * Core filtering logic shared by search and dropdown paths.
     * @param {boolean} updateDropdowns - Whether to recalculate dropdown option counts
     * @param {boolean} capResults - Whether to cap rendered results for responsiveness
     */
    function filterBandsCore(updateDropdowns, capResults) {
        if (isUpdatingFilters) return;
        
        const cache = buildBandDataCache();
        const filters = getCurrentFilters();
        
        const searchName = filters.searchName;
        const searchNameLatinFull = searchName ? transliterateCyrillicToLatin(searchName).toLowerCase() : '';
        const searchNameLatinShort = searchName ? transliterateCyrillicToLatinShorthand(searchName).toLowerCase() : '';
        
        // Detect if mobile search bar is being used (unified search across all fields)
        const mobileInput = document.getElementById('mobile-search-input');
        const isMobileUnifiedSearch = mobileInput && mobileInput.value.length > 0 && window.innerWidth <= 600;
        
        const hasCity = !!filters.city;
        const hasGenre = !!filters.genre;
        const hasSoundsLike = !!filters.soundsLike;
        const hasStatus = !!filters.status;
        const hasLabel = !!filters.label;
        
        const filteredBands = [];
        for (let i = 0, len = cache.length; i < len; i++) {
            const cached = cache[i];
            
            // Name filter — on mobile, search across all fields (name, genre, city, etc.)
            if (searchName) {
                if (isMobileUnifiedSearch) {
                    // Unified mobile search: match any field
                    if (!(
                        cached.searchAll.includes(searchName) ||
                        cached.searchAll.includes(searchNameLatinFull) ||
                        cached.searchAll.includes(searchNameLatinShort)
                    )) continue;
                } else {
                    // Desktop: only match name
                    if (!(
                        cached.nameLower.includes(searchName) ||
                        cached.nameLatinFull.includes(searchNameLatinFull) ||
                        cached.nameLatinShort.includes(searchNameLatinShort) ||
                        cached.nameLatinFull.includes(searchNameLatinShort) ||
                        cached.nameLatinShort.includes(searchNameLatinFull)
                    )) continue;
                }
            }
            
            if (hasCity && !cached.cities.has(filters.city)) continue;
            if (hasGenre && !cached.genres.has(filters.genre)) continue;
            if (hasSoundsLike && !cached.soundsLike.has(filters.soundsLike)) continue;
            if (hasStatus && cached.status !== filters.status) continue;
            if (hasLabel && !cached.labels.has(filters.label)) continue;
            
            filteredBands.push(cached.band);
        }
        
        // Only update dropdown option counts when a dropdown changed (expensive)
        if (updateDropdowns) {
            isUpdatingFilters = true;
            try {
                updateAllFilterOptions(filters, searchName, searchNameLatinFull, searchNameLatinShort);
            } finally {
                isUpdatingFilters = false;
            }
        }
        
        // When search is active, cap rendered results for snappy typing
        const cap = (capResults && searchName) ? SEARCH_RENDER_CAP : 0;
        renderBands(filteredBands, { cap });
    }
    
    /** Called when a dropdown filter changes — update options + render */
    function filterBands() {
        filterBandsCore(true);
    }
    
    /** Called on search text input — skip dropdown option updates for speed, cap results */
    function filterBandsFromSearch() {
        filterBandsCore(false, true);
    }
    
    // Debounced filter for search input
    function filterBandsDebounced() {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(filterBandsFromSearch, SEARCH_DEBOUNCE_MS);
    }

    let renderAbortController = null; // To cancel progressive renders when a new render starts

    function renderBands(bands, { progressive = false, chunkSize = 20, cap = 0 } = {}) {
        console.log(`Rendering ${bands.length} bands${progressive ? ' (progressive)' : ''}${cap ? ' (capped at ' + cap + ')' : ''}`);
        const bandTableBody = document.getElementById('band-table-body');
        bandTableBody.innerHTML = '';
        
        // Build index map for fast lookups
        buildBandIndexMap();
        
        // Cancel any in-progress progressive render
        if (renderAbortController) {
            renderAbortController.abort();
            renderAbortController = null;
        }
        
        // Apply cap (for search responsiveness)
        const totalCount = bands.length;
        const renderBands_ = (cap > 0 && bands.length > cap) ? bands.slice(0, cap) : bands;
        const wasCapped = cap > 0 && totalCount > cap;
        
        if (!progressive || renderBands_.length <= chunkSize) {
            // Render all at once using DocumentFragment (used by filtering, small datasets)
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < renderBands_.length; i++) {
                renderSingleBandRow(renderBands_[i], fragment);
            }
            bandTableBody.appendChild(fragment);
            
            // If capped, show indicator and schedule full render
            if (wasCapped) {
                const infoRow = document.createElement('tr');
                infoRow.className = 'search-cap-row';
                infoRow.innerHTML = `<td colspan="8" style="text-align:center;padding:12px;color:var(--text-secondary);font-size:0.82rem;">Прикажани ${cap} од ${totalCount} резултати. <a href="#" style="color:var(--accent-blue);cursor:pointer;">Прикажи ги сите</a></td>`;
                infoRow.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    renderBands(bands); // re-render without cap
                });
                bandTableBody.appendChild(infoRow);
            }
            return;
        }
        
        // Progressive rendering: yield between chunks so the browser can paint
        renderAbortController = new AbortController();
        const signal = renderAbortController.signal;
        let offset = 0;
        
        function renderChunk() {
            if (signal.aborted) return;
            const end = Math.min(offset + chunkSize, renderBands_.length);
            const fragment = document.createDocumentFragment();
            for (let i = offset; i < end; i++) {
                renderSingleBandRow(renderBands_[i], fragment);
            }
            bandTableBody.appendChild(fragment);
            offset = end;
            if (offset < renderBands_.length) {
                requestAnimationFrame(renderChunk);
            } else {
                renderAbortController = null;
            }
        }
        renderChunk();
    }
    
    function renderSingleBandRow(band, bandTableBody) {
            const key = band.name + '|' + band.city + '|' + band.genre;
            const originalIndex = bandIndexMap ? (bandIndexMap.get(key) ?? -1) : bandsData.findIndex(b => b.name === band.name && b.city === band.city && b.genre === band.genre);
            const bandRow = document.createElement('tr');
            // Only show accent colors for confirmed artists
            if (band.confirmed && band.accentColors && (band.accentColors[0] || band.accentColors[1])) {
                bandRow.classList.add('has-accent');
                const c1 = band.accentColors[0] || band.accentColors[1];
                const c2 = band.accentColors[1] || band.accentColors[0];
                bandRow.style.setProperty('--accent-1', c1);
                bandRow.style.setProperty('--accent-2', c2);
                // Compute adaptive text color based on accent-1 luminance
                const textColor = getContrastTextColor(c1);
                bandRow.style.setProperty('--accent-text', textColor);
            }
            const linkPopularityOrder = [
                'spotify', 'youtube', 'youtube_music', 'apple_music', 'itunes', 'amazon_music',
                'deezer', 'tidal', 'soundcloud', 'bandcamp', 'napster', 'audiomack',
                'tiktok', 'instagram', 'facebook', 'twitter',
                'website', 'linktree', 'linkedin', 'discord', 'twitch', 'patreon',
                'pinterest', 'vimeo', 'wikipedia', 'generic',
                'review', 'interview', 'article'
            ];
            const reviewPlatforms = ['review', 'interview', 'article'];
            const linkIcons = {
                facebook: 'fa-brands fa-facebook',
                instagram: 'fa-brands fa-instagram',
                twitter: 'fa-brands fa-twitter',
                youtube: 'fa-brands fa-youtube',
                youtube_music: 'fa-brands fa-youtube',
                spotify: 'fa-brands fa-spotify',
                bandcamp: 'fa-brands fa-bandcamp',
                soundcloud: 'fa-brands fa-soundcloud',
                itunes: 'fa-brands fa-itunes-note',
                apple_music: 'fa-brands fa-itunes-note',
                deezer: 'fa-brands fa-deezer',
                tidal: 'fa-solid fa-water',
                amazon_music: 'fa-brands fa-amazon',
                napster: 'fa-brands fa-napster',
                audiomack: 'fa-solid fa-headphones',
                wikipedia: 'fa-brands fa-wikipedia-w',
                tiktok: 'fa-brands fa-tiktok',
                linkedin: 'fa-brands fa-linkedin',
                pinterest: 'fa-brands fa-pinterest',
                twitch: 'fa-brands fa-twitch',
                vimeo: 'fa-brands fa-vimeo',
                patreon: 'fa-brands fa-patreon',
                discord: 'fa-brands fa-discord',
                interview: 'fa-solid fa-microphone',
                review: 'fa-solid fa-star',
                article: 'fa-solid fa-newspaper',
                website: 'fa-solid fa-globe',
                linktree: 'fa-solid fa-tree',
                generic: 'fa-solid fa-link'
            };
            let linksHtml = '';
            let reviewsHtml = '';
            let playBtnHtml = '';
            const hasSpotifyLink = band.links?.spotify && band.links.spotify !== 'недостигаат податоци';
            if (band.links.none === 'недостигаат податоци' && band.contact === 'недостигаат податоци') {
                linksHtml = '<span class="missing-data"><i class="fas fa-question-circle"></i></span>';
                // Even with no links, check for RSS matches
                const matchedArticles = findMatchingArticles(band.name);
                if (matchedArticles.length > 0) {
                    reviewsHtml = matchedArticles
                        .map(article => {
                            const escapedTitle = article.title.replace(/"/g, '&quot;');
                            return `<a href="${article.link}" target="_blank" title="${escapedTitle}"><img src="${article.sourceIcon}" alt="${article.source}" class="media-news-icon"></a>`;
                        })
                        .join('');
                } else {
                    reviewsHtml = '';
                }
            } else {
                const sortedPlatforms = Object.keys(band.links).sort((a, b) => {
                    const indexA = linkPopularityOrder.indexOf(a);
                    const indexB = linkPopularityOrder.indexOf(b);
                    return indexA - indexB;
                });
                // Separate regular links from review links
                const regularLinks = sortedPlatforms.filter(p => !reviewPlatforms.includes(p));
                const reviewLinks = sortedPlatforms.filter(p => reviewPlatforms.includes(p));
                
                linksHtml = '';
                if (band.contact !== 'недостигаат податоци') {
                    linksHtml += `<a href="mailto:${band.contact}" class="contact-link"><i class="fa-solid fa-envelope"></i></a>`;
                }
                linksHtml += regularLinks
                    .flatMap(platform => {
                        const urlOrUrls = band.links[platform];
                        const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
                        return urls.map(url => {
                            if (platform === 'spotify') {
                                url = convertSpotifyUrlToAppUri(url);
                            }
                            const iconClass = linkIcons[platform] || 'fa-solid fa-link';
                            return `<a href="${url}" target="_blank"><i class="${iconClass}"></i></a>`;
                        });
                    })
                    .join('');
                
                // Build reviews/media HTML from manual links
                let manualReviewsHtml = '';
                if (reviewLinks.length > 0) {
                    manualReviewsHtml = reviewLinks
                        .flatMap(platform => {
                            const urlOrUrls = band.links[platform];
                            const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
                            return urls.map(url => {
                                const iconClass = linkIcons[platform] || 'fa-solid fa-link';
                                return `<a href="${url}" target="_blank"><i class="${iconClass}"></i></a>`;
                            });
                        })
                        .join('');
                }
                
                // Add RSS-matched articles to media column
                const matchedArticles = findMatchingArticles(band.name);
                let rssHtml = '';
                if (matchedArticles.length > 0) {
                    rssHtml = matchedArticles
                        .map(article => {
                            const escapedTitle = article.title.replace(/"/g, '&quot;');
                            return `<a href="${article.link}" target="_blank" title="${escapedTitle}"><img src="${article.sourceIcon}" alt="${article.source}" class="media-news-icon"></a>`;
                        })
                        .join('');
                }
                
                reviewsHtml = rssHtml + manualReviewsHtml;
            }
            let cityHtml = band.city === 'недостигаат податоци'
                ? '<span class="missing-data"><i class="fas fa-question-circle"></i></span>'
                : band.city.split(',').map(c => c.trim()).map(c => `<span class="city-item" data-filter="city" data-value="${c}" style="${getCityTagStyle(c)}"><i class="fas fa-map-marker-alt"></i>${c}</span>`).join('');
            let genreHtml = band.genre === 'недостигаат податоци'
                ? '<span class="missing-data"><i class="fas fa-question-circle"></i></span>'
                : band.genre.split(',').map(g => g.trim()).map(g => `<span class="genre-item" data-filter="genre" data-value="${g}"><i class="fas fa-tag"></i>${g}</span>`).join('');
            let soundsLikeHtml = band.soundsLike === 'недостигаат податоци'
                ? '<span class="missing-data"><i class="fas fa-question-circle"></i></span>'
                : band.soundsLike.split(',').map(s => s.trim()).map(s => `<span class="sounds-like-item" data-filter="sounds-like" data-value="${s}"><i class="fas fa-headphones"></i>${s}</span>`).join('');
            
            // Get artist thumbnail from chart data
            const artistThumbnail = getArtistThumbnail(band.name);
            const thumbnailHtml = artistThumbnail 
                ? `<img src="${artistThumbnail}" alt="" class="artist-thumb" loading="lazy" decoding="async">` 
                : '<span class="artist-thumb artist-thumb-placeholder"></span>';
            
            // Artist name links to artist page
            const artistPageUrl = getArtistPageUrl(band.name);
            let nameHtml = `${thumbnailHtml}<a href="${artistPageUrl}" class="artist-name-link" title="Отвори профил на артистот">${band.name}</a>`;
            if (band.confirmed) {
                nameHtml += '<span class="verified-badge" title="Потврдено од артистот"><i class="fas fa-check-circle"></i></span>';
            }
            if (band.label && band.label !== 'недостигаат податоци') {
                const labels = String(band.label).split(',').map(l => l.trim()).filter(Boolean);
                const labelSpans = labels.map(l => {
                    const isSingleChar = l.length === 1;
                    return `<span class="band-label ${isSingleChar ? 'single-char' : ''}" data-filter="label" data-value="${l}">${l}</span>`;
                }).join(' ');
                nameHtml += ` ${labelSpans}`;
            }
            const activityStatus = getActivityStatus(band.name);
            const statusClass = activityStatus === 'Непознато' ? 'missing-data' : '';
            
            // Build events column
            const matchedEvents = findMatchingEvents(band.name);
            let eventsHtml = '';
            if (matchedEvents.length > 0) {
                const today = new Date().toISOString().slice(0, 10);
                const sorted = [...matchedEvents].sort((a, b) => a.date.localeCompare(b.date));
                eventsHtml = sorted.map(evt => {
                    const d = evt.date ? new Date(evt.date + 'T00:00:00') : null;
                    const dateStr = d ? d.toLocaleDateString('mk-MK', { day: 'numeric', month: 'short' }) : '';
                    const isPast = evt.date < today;
                    const escapedTitle = (evt.title + (dateStr ? ` (${dateStr})` : '') + (evt.place ? ` — ${evt.place}` : '')).replace(/"/g, '&quot;');
                    const href = evt.link || `/nastan/${evt.id}`;
                    return `<a href="${href}" target="_blank" title="${escapedTitle}" class="event-icon-link${isPast ? ' past-event-icon' : ''}"><i class="fas fa-calendar-day"></i></a>`;
                }).join('');
            }
            
            // On mobile, merge media links into the links column
            const isMobile = window.innerWidth <= 600;
            const combinedLinksHtml = isMobile && (reviewsHtml || eventsHtml) ? linksHtml + reviewsHtml + eventsHtml : linksHtml;
            
            bandRow.innerHTML = `
                <td data-label="Име" class="name">${nameHtml}</td>
                <td data-label="Град"><div class="cell-scroll">${cityHtml}</div></td>
                <td data-label="Жанр"><div class="cell-scroll">${genreHtml}</div></td>
                <td data-label="Звучи како"><div class="cell-scroll">${soundsLikeHtml}</div></td>
                <td data-label="Линкови" class="links"><div class="cell-scroll">${combinedLinksHtml}</div></td>
                <td data-label="Медиуми" class="links reviews"><div class="cell-scroll">${reviewsHtml}</div></td>
                <td data-label="Настани" class="links events"><div class="cell-scroll">${eventsHtml}</div></td>
                <td data-label="Статус" data-status="${activityStatus}" class="${statusClass}">
                    <span class="status-content" data-status-text="${activityStatus}">${activityStatus}</span>
                </td>
                <td data-label="Акции" class="action-buttons edit-hidden">
                    <button class="action-btn edit-btn" data-index="${originalIndex}"><i class="fas fa-edit"></i></button>
                </td>
            `;
            const statusSpan = bandRow.querySelector('.status-content');
            statusSpan.addEventListener('mouseover', (e) => {
                const tooltip = document.createElement('div');
                tooltip.className = 'status-tooltip';
                tooltip.textContent = activityStatus;
                document.body.appendChild(tooltip);
                const offsetX = 10;
                const offsetY = 10;
                tooltip.style.left = `${e.pageX + offsetX}px`;
                tooltip.style.top = `${e.pageY + offsetY}px`;
                statusSpan._tooltip = tooltip;
            });
            statusSpan.addEventListener('mousemove', (e) => {
                const tooltip = statusSpan._tooltip;
                if (tooltip) {
                    const offsetX = 10;
                    const offsetY = 10;
                    tooltip.style.left = `${e.pageX + offsetX}px`;
                    tooltip.style.top = `${e.pageY + offsetY}px`;
                }
            });
            statusSpan.addEventListener('mouseout', () => {
                const tooltip = statusSpan._tooltip;
                if (tooltip) {
                    tooltip.remove();
                    statusSpan._tooltip = null;
                }
            });
            bandRow.querySelectorAll('.city-item, .genre-item, .sounds-like-item, .band-label').forEach(item => {
                item.addEventListener('click', () => {
                    console.log('Filter item clicked:', item.getAttribute('data-filter'), item.getAttribute('data-value'));
                    const filterType = item.getAttribute('data-filter');
                    const filterValue = item.getAttribute('data-value');
                    if (filterType === 'city') {
                        $('#filter-city').val(filterValue).trigger('change');
                    } else if (filterType === 'genre') {
                        $('#filter-genre').val(filterValue).trigger('change');
                    } else if (filterType === 'sounds-like') {
                        $('#filter-sounds-like').val(filterValue).trigger('change');
                    } else if (filterType === 'label') {
                        $('#filter-label').val(filterValue).trigger('change');
                    }
                    document.querySelector('.controls').style.display = 'flex';
                });
            });
            const editBtn = bandRow.querySelector('.edit-btn');
            editBtn.addEventListener('click', () => {
                const idx = parseInt(editBtn.dataset.index);
                console.log(`Edit button clicked for band at original index ${idx}`);
                if (typeof window.openModal === 'function') {
                    window.openModal('edit', bandsData[idx], idx);
                } else {
                    console.error('window.openModal is not defined');
                    showNotification('Грешка: функцијата за уредување не е достапна.', 'error');
                }
            });
            
            bandTableBody.appendChild(bandRow);

            // Initialize fade masks for scrollable cells
            bandRow.querySelectorAll('.cell-scroll').forEach(el => {
                if (el.scrollWidth > el.clientWidth) {
                    el.style.webkitMaskImage = 'linear-gradient(to right, black calc(100% - 18px), transparent 100%)';
                    el.style.maskImage = 'linear-gradient(to right, black calc(100% - 18px), transparent 100%)';
                } else {
                    el.style.webkitMaskImage = 'none';
                    el.style.maskImage = 'none';
                }
            });
    }
    
    // ==================== SERVICE PREFERENCE & OPEN ON SERVICE ====================
    // Service definitions for the "open on" feature
    const serviceDefinitions = {
        spotify: { name: 'Spotify', icon: 'fab fa-spotify', color: '#1DB954' },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube', color: '#FF0000' },
        youtubeMusic: { name: 'YouTube Music', icon: 'fab fa-youtube', color: '#FF0000' },
        appleMusic: { name: 'Apple Music', icon: 'fab fa-apple', color: '#fc3c44' },
        deezer: { name: 'Deezer', icon: 'fab fa-deezer', color: '#FEAA2D' },
        tidal: { name: 'Tidal', icon: 'fas fa-water', color: '#00FFFF' },
        amazonMusic: { name: 'Amazon Music', icon: 'fab fa-amazon', color: '#FF9900' },
        soundcloud: { name: 'SoundCloud', icon: 'fab fa-soundcloud', color: '#ff7700' },
        bandcamp: { name: 'Bandcamp', icon: 'fab fa-bandcamp', color: '#1da0c3' }
    };

    // Songlink API cache
    const songlinkCache = {};

    function getPreferredService() {
        return localStorage.getItem('mmm-preferred-service') || null;
    }

    function setPreferredService(serviceId) {
        localStorage.setItem('mmm-preferred-service', serviceId);
        // Update any visible service preference indicators
        document.querySelectorAll('.service-pref-current').forEach(el => {
            const svc = serviceDefinitions[serviceId];
            if (svc) {
                el.innerHTML = `<i class="${svc.icon}"></i>`;
                el.title = svc.name;
            }
        });
    }

    async function fetchSonglinkUrls(sourceUrl) {
        if (songlinkCache[sourceUrl]) return songlinkCache[sourceUrl];
        try {
            const resp = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(sourceUrl)}`);
            if (!resp.ok) return null;
            const data = await resp.json();
            const links = {};
            if (data.linksByPlatform) {
                for (const [platform, linkData] of Object.entries(data.linksByPlatform)) {
                    if (serviceDefinitions[platform] && linkData.url) {
                        links[platform] = linkData.url;
                    }
                }
            }
            songlinkCache[sourceUrl] = links;
            return links;
        } catch (err) {
            console.warn('Songlink API error:', err);
            return null;
        }
    }

    // Open a song/release URL on the user's preferred streaming service
    async function openOnPreferredService(releaseUrl, title) {
        if (!releaseUrl) return;

        const preferred = getPreferredService();

        // If the URL already belongs to the preferred service, open directly
        if (preferred && urlMatchesService(releaseUrl, preferred)) {
            window.open(releaseUrl, '_blank');
            return;
        }

        // Show a quick loading toast
        showServiceToast(preferred ? 'Се бара на ' + (serviceDefinitions[preferred]?.name || preferred) + '...' : 'Се бараат линкови…', 'loading');

        const links = await fetchSonglinkUrls(releaseUrl);
        hideServiceToast();
        if (!links || Object.keys(links).length === 0) {
            if (!preferred) {
                // "Always ask" mode - show chooser with original URL
                const fallbackLinks = {};
                for (const [id] of Object.entries(serviceDefinitions)) {
                    if (urlMatchesService(releaseUrl, id)) {
                        fallbackLinks[id] = releaseUrl;
                        break;
                    }
                }
                showServiceChooserDialog(fallbackLinks, releaseUrl, title);
            } else {
                window.open(releaseUrl, '_blank');
            }
            return;
        }
        if (preferred && links[preferred]) {
            window.open(links[preferred], '_blank');
        } else {
            showServiceChooserDialog(links, releaseUrl, title);
        }
    }

    function urlMatchesService(url, serviceId) {
        const patterns = {
            spotify: /open\.spotify\.com/i,
            youtube: /youtube\.com|youtu\.be/i,
            youtubeMusic: /music\.youtube\.com/i,
            appleMusic: /music\.apple\.com/i,
            deezer: /deezer\.com/i,
            tidal: /tidal\.com/i,
            amazonMusic: /music\.amazon/i,
            soundcloud: /soundcloud\.com/i,
            bandcamp: /bandcamp\.com/i
        };
        return patterns[serviceId]?.test(url);
    }

    // Small toast notification for loading state
    function showServiceToast(message, type) {
        let toast = document.getElementById('service-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'service-toast';
            toast.className = 'service-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = type === 'loading'
            ? `<i class="fas fa-spinner fa-spin"></i> ${message}`
            : message;
        toast.classList.add('visible');
    }

    function hideServiceToast() {
        const toast = document.getElementById('service-toast');
        if (toast) toast.classList.remove('visible');
    }

    // Service chooser dialog (fallback when preferred service unavailable)
    function showServiceChooserDialog(links, fallbackUrl, title) {
        let overlay = document.getElementById('service-chooser-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'service-chooser-overlay';
            overlay.className = 'service-chooser-overlay';
            overlay.innerHTML = `
                <div class="service-chooser">
                    <h3 id="service-chooser-title"></h3>
                    <div class="service-chooser-links" id="service-chooser-links"></div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('visible');
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') overlay.classList.remove('visible');
            });
        }
        
        const titleEl = document.getElementById('service-chooser-title');
        const linksEl = document.getElementById('service-chooser-links');
        titleEl.textContent = title || 'Отвори во...';

        // Always include original URL
        if (fallbackUrl && !Object.values(links).includes(fallbackUrl)) {
            // Determine which service the fallback URL belongs to
            for (const [id, svc] of Object.entries(serviceDefinitions)) {
                if (urlMatchesService(fallbackUrl, id) && !links[id]) {
                    links[id] = fallbackUrl;
                    break;
                }
            }
        }
        
        const html = Object.entries(links)
            .filter(([id]) => serviceDefinitions[id])
            .map(([id, url]) => {
                const svc = serviceDefinitions[id];
                const isPreferred = id === getPreferredService();
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${isPreferred ? 'preferred' : ''}">
                    <i class="${svc.icon}"></i> ${svc.name}
                    ${isPreferred ? '<span class="pref-badge">★</span>' : ''}
                </a>`;
            }).join('');

        linksEl.innerHTML = html || `<a href="${fallbackUrl}" target="_blank" rel="noopener noreferrer"><i class="fab fa-spotify"></i> Spotify</a>`;
        overlay.classList.add('visible');
    }

    // Service preference picker UI
    function showServicePreferencePicker() {
        const ov = document.getElementById('settings-overlay');
        if (ov) ov.classList.add('visible');
    }

    // Backward compatibility wrappers
    function showSpotifyEmbed(spotifyId, type = 'artist') {
        const url = `https://open.spotify.com/${type}/${spotifyId}`;
        openOnPreferredService(url);
    }
    
    function closeSpotifyEmbed() {
        // No-op: no player to close
    }

    function showMusicPlayer(spotifyId, type = 'artist', title = '', artist = '', thumbnail = '') {
        const url = `https://open.spotify.com/${type}/${spotifyId}`;
        openOnPreferredService(url, title || artist);
    }

    function closeMusicPlayer() {
        // No-op: no player to close
    }

    // ==================== TOUR FUNCTIONALITY ====================
    const isMobile = () => window.innerWidth <= 600;

    // Desktop tour steps
    const desktopTourSteps = [
        {
            element: null,
            title: 'Здраво! 👋',
            description: 'Ова е <strong>Македонска Музичка Мастер Листа</strong> - место каде ги собираме сите домашни артисти на едно место. Проектот е отворен, секој може да помогне.<br><br>Ајде да ти покажам како работи ова.',
            position: 'center'
        },
        {
            element: '.site-nav-trigger',
            title: 'Мени ☰',
            description: 'Кликни на <strong>логото</strong> за да отвориш мени. Таму ги имаш Топ Листа, Мастер Листа, Вести и Помош. Секоја страница има своја тура - кликни на <i class="fas fa-globe"></i> копчето за да ја видиш.',
            position: 'bottom'
        },
        {
            element: '#search-name',
            title: 'Пребарување',
            description: 'Тука пишуваш име и веднаш ти се појавуваат резултати. Работи и на кирилица и на латиница, така да не мора да се мачиш.',
            position: 'bottom'
        },
        {
            element: '.controls',
            title: 'Филтри',
            description: 'Ако сакаш да видиш само бендови од Скопје, или само рок, или само активни - тука ги имаш сите филтри. Комбинирај ги како сакаш.',
            position: 'bottom'
        },
        {
            element: 'table thead',
            title: 'Листа на артисти',
            description: 'Еве ги сите артисти. Секој ред има име, град, жанр, и линкови до профилите. Колоните со повеќе содржина може да ги лизгаш хоризонтално со повлекување или со тркалцето на глувчето.',
            position: 'bottom'
        },
        {
            element: '.link-icon',
            title: 'Отвори на сервис',
            description: 'Кликни на иконата и директно те носи на профилот - Spotify, YouTube, Instagram, што има. Кликни на <i class="fas fa-headphones" style="color: var(--accent-orange);"></i> за да го избереш твојот омилен сервис за слушање.',
            position: 'bottom'
        },
        {
            element: '.status-indicator',
            title: 'Статус',
            description: 'Боичките значат:<br><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#40c057;margin-right:4px;"></span> активен (свири, снима)<br><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#b85450;margin-right:4px;"></span> неактивен (не свири повеќе)<br><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5b8fb9;margin-right:4px;"></span> можеби (не сме сигурни)<br><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#868e96;margin-right:4px;"></span> непознато',
            position: 'left'
        },
        {
            element: '#add-band-btn',
            title: 'Додај артист',
            description: 'Знаеш за бенд што го нема тука? Кликни овде и додај го. Ќе се отвори формулар каде внесуваш име, град, жанр, линкови...',
            position: 'bottom'
        },
        {
            element: '#band-modal .modal-content',
            title: 'Формулар за артист',
            description: 'Тука ги внесуваш податоците. Не мора сè да биде пополнето - ако не знаеш нешто, остави го празно. Подоцна некој друг може да додаде.',
            position: 'right',
            beforeShow: () => {
                document.getElementById('band-modal').style.display = 'block';
            },
            afterHide: () => {
                document.getElementById('band-modal').style.display = 'none';
            }
        },
        {
            element: '#copy-data-btn',
            title: 'Копирај податоци',
            description: 'Ова ти го копира целиот JSON со сите артисти. Корисно ако сакаш да направиш бекап или да ги користиш податоците за нешто друго.',
            position: 'bottom',
            beforeShow: () => {
                document.getElementById('band-modal').style.display = 'none';
            }
        },
        {
            element: '#submit-pr-btn',
            title: 'Побарај промена',
            description: 'Кога ќе завршиш со промени, кликни тука. Ќе се отвори прозорец каде опишуваш што си сменил, и потоа се праќа на преглед.',
            position: 'bottom'
        },
        {
            element: '#pr-form-container',
            title: 'Испрати на преглед',
            description: 'Тука опишуваш што направи - додаде нов бенд, поправи грешка, итн. Може и контакт да оставиш ако сакаш. Промената оди на GitHub и некој ја прегледува.',
            position: 'bottom',
            beforeShow: () => {
                document.getElementById('custom-dialog-modal').style.display = 'block';
                document.getElementById('pr-form-container').style.display = 'block';
                document.getElementById('dialog-message').style.display = 'none';
            },
            afterHide: () => {
                document.getElementById('custom-dialog-modal').style.display = 'none';
                document.getElementById('pr-form-container').style.display = 'none';
            }
        },
        {
            element: null,
            title: 'Тоа е сè!',
            description: 'Ако сакаш да помогнеш:<br><br>• Додај артист што го нема<br>• Поправи ако нешто не е точно<br>• Јави се на <a href="https://discord.gg/DzBQASu7mU" target="_blank">Xotel Discord</a> ако имаш прашања<br><br>Фала што помагаш! 🎸',
            position: 'center'
        }
    ];

    // Mobile-specific tour steps
    const mobileTourSteps = [
        {
            element: null,
            title: 'Здраво! 👋',
            description: 'Ова е <strong>Македонска Музичка Мастер Листа</strong> - место каде ги собираме сите домашни артисти на едно место.<br><br>Ајде да ти покажам како работи.',
            position: 'center'
        },
        {
            element: '.site-nav-trigger',
            title: 'Мени ☰',
            description: 'Кликни на <strong>логото</strong> за мени. Таму ги имаш Топ Листа, Мастер Листа, Вести и Помош.',
            position: 'bottom'
        },
        {
            element: '#toggle-filters',
            title: 'Филтри',
            description: 'Кликни тука за да ги отвориш филтрите. Може да пребаруваш по име, да филтрираш по град, жанр, статус...',
            position: 'bottom'
        },
        {
            element: '#band-table-body tr:first-child',
            title: 'Листа на артисти',
            description: 'Секој ред покажува име и линкови до профили. Кликни на името за детали за артистот.',
            position: 'bottom'
        },
        {
            element: '#search-name',
            title: 'Пребарување',
            description: 'Пишувај име и веднаш се појавуваат резултати. Работи и на кирилица и на латиница.',
            position: 'bottom',
            beforeShow: () => {
                const controls = document.querySelector('.controls');
                if (controls) controls.classList.add('active');
            },
            afterHide: () => {
                const controls = document.querySelector('.controls');
                if (controls) controls.classList.remove('active');
            }
        },
        {
            element: '#add-band-btn',
            title: 'Додај артист',
            description: 'Знаеш за бенд што го нема? Кликни овде за да го додадеш. Внеси име, град, жанр, линкови - не мора сè да е пополнето.',
            position: 'bottom'
        },
        {
            element: '#submit-pr-btn',
            title: 'Испрати промени',
            description: 'Кога ќе додадеш или промениш нешто, кликни тука за да ги испратиш промените на преглед.',
            position: 'bottom'
        },
        {
            element: null,
            title: 'Тоа е сè! 🎸',
            description: 'Ако сакаш да помогнеш:<br><br>• Додај артист што го нема<br>• Поправи ако нешто не е точно<br>• Јави се на <a href="https://discord.gg/DzBQASu7mU" target="_blank">Xotel Discord</a> ако имаш прашања<br><br>Фала што помагаш!',
            position: 'center'
        }
    ];

    let currentTourStep = 0;
    let tourActive = false;
    const TOUR_VIEWED_KEY = 'mmm-tour-viewed';

    // ==================== GLOBAL SITE TOUR ====================
    (function() {
        const gTourSteps = [
            { element: null, title: 'Здраво! 👋', description: 'Ова е <strong>Македонска Музичка Мастер Листа</strong> - сè за македонската музика на едно место.<br><br>Ајде брзо да ти покажам што има.', position: 'center' },
            { element: '.site-nav-trigger', title: 'Навигација', description: 'Кликни на <strong>логото</strong> за мени. Таму ги имаш сите страници: Топ Листа, Мастер Листа, Настани, Вести, Кустоси...', position: 'bottom' },
            { element: '#settings-btn', title: 'Поставки ⚙', description: 'Тука ги менуваш <strong>темата</strong> (светла/темна) и го избираш <strong>стриминг сервисот</strong> (Spotify, YouTube, Deezer...). Кога ќе кликнеш на песна, директно се отвора таму.', position: 'bottom' },
            { element: null, title: 'Топ Листа 📊', description: 'Листа на <strong>најпопуларни изданија</strong> од македонски артисти, рангирани по Spotify популарност. Се ажурира автоматски секој ден. <a href="/">Отвори →</a>', position: 'center' },
            { element: null, title: 'Мастер Листа 📋', description: 'Комплетна база на <strong>сите македонски артисти</strong> со линкови, жанрови, градови и медиуми. Секој може да додаде нов артист. <a href="/lista">Отвори →</a>', position: 'center' },
            { element: null, title: 'Настани 📅', description: 'Претстојни <strong>концерти и настани</strong> со датуми, локации и карти. <a href="/nastani">Отвори →</a>', position: 'center' },
            { element: null, title: 'Вести 📰', description: 'Најнови <strong>вести и написи</strong> за македонската музичка сцена од разни извори. <a href="/vesti">Отвори →</a>', position: 'center' },
            { element: null, title: 'Кустоси 🎧', description: 'Музички <strong>кустоси</strong> со нивните плејлисти и тракслисти. Може и ти да станеш кустос! <a href="/kustosi">Отвори →</a>', position: 'center' },
            { element: null, title: 'Тоа е сè! 🎸', description: 'Ако сакаш да помогнеш:<br><br>• Додај артист во Мастер Листата<br>• Додај настан<br>• Јави се на <a href="https://discord.gg/DzBQASu7mU" target="_blank">Xotel Discord</a><br><br>Фала! 🙌', position: 'center' }
        ];
        let gStep = 0, gActive = false, gOverlay = null;
        function gCreateOverlay() {
            if (document.getElementById('tour-overlay')) return document.getElementById('tour-overlay');
            const el = document.createElement('div'); el.id = 'tour-overlay'; el.className = 'tour-overlay';
            el.innerHTML = '<div class="tour-highlight"></div><div class="tour-tooltip"><div class="tour-tooltip-content"><h3 class="tour-title"></h3><p class="tour-description"></p></div><div class="tour-footer"><span class="tour-progress"></span><div class="tour-buttons"><button class="tour-btn-skip">Прескокни</button><button class="tour-btn-prev"><i class="fas fa-arrow-left"></i></button><button class="tour-btn-next">Следно <i class="fas fa-arrow-right"></i></button></div></div></div>';
            document.body.appendChild(el);
            el.querySelector('.tour-btn-skip').addEventListener('click', gEndTour);
            el.querySelector('.tour-btn-prev').addEventListener('click', function() { if (gStep > 0) { gStep--; gShowStep(); } });
            el.querySelector('.tour-btn-next').addEventListener('click', function() { if (gStep < gTourSteps.length - 1) { gStep++; gShowStep(); } else { gEndTour(); } });
            el.addEventListener('click', function(e) { if (e.target === el || e.target.classList.contains('tour-highlight')) gEndTour(); });
            document.addEventListener('keydown', function(e) { if (!gActive) return; if (e.key === 'Escape') gEndTour(); if (e.key === 'ArrowRight' || e.key === 'Enter') { if (gStep < gTourSteps.length - 1) { gStep++; gShowStep(); } else gEndTour(); } if (e.key === 'ArrowLeft' && gStep > 0) { gStep--; gShowStep(); } });
            return el;
        }
        function gStartTour() { gOverlay = gCreateOverlay(); gActive = true; gStep = 0; gOverlay.classList.add('active'); if (window.innerWidth > 600) document.body.style.overflow = 'hidden'; gShowStep(); }
        function gEndTour() { gActive = false; if (gOverlay) gOverlay.classList.remove('active'); document.body.style.overflow = ''; }
        function gShowStep() {
            var step = gTourSteps[gStep]; if (!step || !gOverlay) return;
            var highlight = gOverlay.querySelector('.tour-highlight'), tooltip = gOverlay.querySelector('.tour-tooltip');
            tooltip.querySelector('.tour-title').textContent = step.title;
            tooltip.querySelector('.tour-description').innerHTML = step.description;
            tooltip.querySelector('.tour-progress').textContent = (gStep + 1) + ' / ' + gTourSteps.length;
            tooltip.querySelector('.tour-btn-prev').disabled = gStep === 0;
            tooltip.querySelector('.tour-btn-next').innerHTML = gStep === gTourSteps.length - 1 ? 'Заврши <i class="fas fa-check"></i>' : 'Следно <i class="fas fa-arrow-right"></i>';
            tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'tour-center');
            if (step.position === 'center' || !step.element) {
                highlight.style.display = 'none'; tooltip.classList.add('tour-center'); tooltip.style.top = ''; tooltip.style.left = '';
            } else {
                var targetEl = document.querySelector(step.element);
                if (!targetEl) { highlight.style.display = 'none'; tooltip.classList.add('tour-center'); tooltip.style.top = ''; tooltip.style.left = ''; return; }
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function() {
                    var rect = targetEl.getBoundingClientRect(), p = 4;
                    highlight.style.display = 'block'; highlight.style.position = window.innerWidth <= 600 ? 'fixed' : 'absolute';
                    highlight.style.top = (rect.top - p + (window.innerWidth > 600 ? window.scrollY : 0)) + 'px';
                    highlight.style.left = (rect.left - p) + 'px'; highlight.style.width = (rect.width + p * 2) + 'px'; highlight.style.height = (rect.height + p * 2) + 'px';
                    if (window.innerWidth > 600) {
                        var tr = tooltip.getBoundingClientRect(); var top = rect.bottom + 16, left = rect.left + rect.width / 2 - tr.width / 2;
                        if (left < 10) left = 10; if (left + tr.width > window.innerWidth - 10) left = window.innerWidth - tr.width - 10;
                        if (top + tr.height > window.innerHeight - 10) top = rect.top - tr.height - 16;
                        tooltip.style.top = top + 'px'; tooltip.style.left = left + 'px'; tooltip.classList.add('arrow-top');
                    }
                }, 150);
            }
        }
        // window.startGlobalTour moved to tour.js
    })();

    function initTour() {
        const overlay = document.getElementById('tour-overlay');
        if (!overlay) return;
        const highlight = overlay.querySelector('.tour-highlight');
        const tooltip = overlay.querySelector('.tour-tooltip');
        const titleEl = tooltip.querySelector('.tour-title');
        const descEl = tooltip.querySelector('.tour-description');
        const progressEl = tooltip.querySelector('.tour-progress');
        const prevBtn = tooltip.querySelector('.tour-btn-prev');
        const nextBtn = tooltip.querySelector('.tour-btn-next');
        const skipBtn = tooltip.querySelector('.tour-btn-skip');

        prevBtn.addEventListener('click', prevStep);
        nextBtn.addEventListener('click', nextStep);
        skipBtn.addEventListener('click', endTour);

        // Close on overlay click (outside tooltip)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('tour-highlight')) {
                endTour();
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!tourActive) return;
            if (e.key === 'Escape') endTour();
            if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
            if (e.key === 'ArrowLeft') prevStep();
        });
        
        // Auto-start tour for new users (only on master list page)
        const isListPage = window.location.pathname.endsWith('lista.html') || window.location.pathname === '/lista' || window.location.pathname === '/' || window.location.pathname.endsWith('/');
        const hasViewedTour = localStorage.getItem(TOUR_VIEWED_KEY) === 'true';
        
        // Show a logo pulse hint on mobile for first-time users
        if (isMobile() && !hasViewedTour) {
            const logoTrigger = document.querySelector('.site-nav-trigger');
            if (logoTrigger) {
                logoTrigger.classList.add('nav-hint-pulse');
                logoTrigger.addEventListener('animationend', () => {
                    logoTrigger.classList.remove('nav-hint-pulse');
                }, { once: true });
            }
        }
        
        // Check if this is the list page (not chart page)
        if (isListPage && !document.body.classList.contains('chart-page') && !hasViewedTour) {
            // Delay tour start to let page fully load
            setTimeout(() => {
                startTour();
            }, 1500);
        }
    }

    function startTour() {
        tourActive = true;
        currentTourStep = 0;
        document.getElementById('tour-overlay').classList.add('active');
        // On mobile, allow scrolling so elements can be scrolled into view
        if (!isMobile()) {
            document.body.style.overflow = 'hidden';
        }
        showTourStep(currentTourStep);
    }

    function endTour() {
        // Call afterHide on current step if exists
        const steps = getActiveTourSteps();
        const currentStep = steps[currentTourStep];
        if (currentStep && currentStep.afterHide) {
            currentStep.afterHide();
        }
        tourActive = false;
        document.getElementById('tour-overlay').classList.remove('active');
        document.body.style.overflow = '';
        
        // Mark tour as viewed so it doesn't auto-start again
        localStorage.setItem(TOUR_VIEWED_KEY, 'true');
    }

    function prevStep() {
        if (currentTourStep > 0) {
            // Call afterHide on current step
            const steps = getActiveTourSteps();
            const currentStep = steps[currentTourStep];
            if (currentStep && currentStep.afterHide) {
                currentStep.afterHide();
            }
            currentTourStep--;
            showTourStep(currentTourStep);
        }
    }

    function nextStep() {
        const steps = getActiveTourSteps();
        if (currentTourStep < steps.length - 1) {
            // Call afterHide on current step
            const currentStep = steps[currentTourStep];
            if (currentStep && currentStep.afterHide) {
                currentStep.afterHide();
            }
            currentTourStep++;
            showTourStep(currentTourStep);
        } else {
            endTour();
        }
    }

    function getActiveTourSteps() {
        return isMobile() ? mobileTourSteps : desktopTourSteps;
    }

    function showTourStep(stepIndex) {
        const steps = getActiveTourSteps();
        const step = steps[stepIndex];
        if (!step) return;
        const overlay = document.getElementById('tour-overlay');
        const highlight = overlay.querySelector('.tour-highlight');
        const tooltip = overlay.querySelector('.tour-tooltip');
        const titleEl = tooltip.querySelector('.tour-title');
        const descEl = tooltip.querySelector('.tour-description');
        const progressEl = tooltip.querySelector('.tour-progress');
        const prevBtn = tooltip.querySelector('.tour-btn-prev');
        const nextBtn = tooltip.querySelector('.tour-btn-next');

        // Call beforeShow if exists
        if (step.beforeShow) {
            step.beforeShow();
        }

        // Update content
        titleEl.textContent = step.title;
        descEl.innerHTML = step.description;
        progressEl.textContent = `${stepIndex + 1} / ${steps.length}`;

        // Update buttons
        prevBtn.disabled = stepIndex === 0;
        nextBtn.innerHTML = stepIndex === steps.length - 1 
            ? 'Заврши <i class="fas fa-check"></i>' 
            : 'Следно <i class="fas fa-arrow-right"></i>';

        // Remove old arrow classes
        tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'tour-center');

        // On mobile, use bottom-sheet tooltip but still highlight elements
        if (isMobile()) {
            tooltip.style.top = '';
            tooltip.style.left = '';
            tooltip.style.right = '';
            tooltip.style.bottom = '';

            if (step.position === 'center' || !step.element) {
                highlight.style.display = 'none';
                tooltip.classList.add('tour-center');
            } else {
                tooltip.classList.remove('tour-center');
                const targetEl = document.querySelector(step.element);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Position highlight after scroll settles
                    setTimeout(() => {
                        positionHighlightMobile(targetEl, highlight);
                    }, 350);
                } else {
                    highlight.style.display = 'none';
                }
            }
            return;
        }

        if (step.position === 'center' || !step.element) {
            // Centered step (welcome/outro)
            highlight.style.display = 'none';
            tooltip.classList.add('tour-center');
            tooltip.style.top = '';
            tooltip.style.left = '';
            tooltip.style.right = '';
            tooltip.style.bottom = '';
        } else {
            // Element-targeted step
            const targetEl = document.querySelector(step.element);
            if (!targetEl) {
                // Skip to next if element not found
                if (stepIndex < steps.length - 1) {
                    currentTourStep++;
                    showTourStep(currentTourStep);
                }
                return;
            }

            // Scroll element into view if needed
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Small delay for scroll to complete
            setTimeout(() => {
                positionHighlight(targetEl, highlight);
                positionTooltip(targetEl, tooltip, step.position);
            }, 100);
        }
    }

    function positionHighlightMobile(element, highlight) {
        const rect = element.getBoundingClientRect();
        const padding = 4;
        highlight.style.display = 'block';
        highlight.style.position = 'fixed';
        highlight.style.top = (rect.top - padding) + 'px';
        highlight.style.left = (rect.left - padding) + 'px';
        highlight.style.width = (rect.width + padding * 2) + 'px';
        highlight.style.height = (rect.height + padding * 2) + 'px';
    }

    function positionHighlight(element, highlight) {
        const rect = element.getBoundingClientRect();
        const padding = 4;
        
        highlight.style.display = 'block';
        highlight.style.position = 'absolute';
        highlight.style.top = (rect.top - padding + window.scrollY) + 'px';
        highlight.style.left = (rect.left - padding + window.scrollX) + 'px';
        highlight.style.width = (rect.width + padding * 2) + 'px';
        highlight.style.height = (rect.height + padding * 2) + 'px';
    }

    function positionTooltip(element, tooltip, position) {
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const gap = 16;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Check if mobile (tooltip is fixed at bottom on mobile via CSS)
        if (viewportWidth <= 600) {
            tooltip.classList.add('arrow-top');
            return;
        }

        let top, left;
        let arrowClass = '';

        switch (position) {
            case 'bottom':
                top = rect.bottom + gap;
                left = rect.left + rect.width / 2 - tooltipRect.width / 2;
                arrowClass = 'arrow-top';
                break;
            case 'top':
                top = rect.top - tooltipRect.height - gap;
                left = rect.left + rect.width / 2 - tooltipRect.width / 2;
                arrowClass = 'arrow-bottom';
                break;
            case 'left':
                top = rect.top + rect.height / 2 - tooltipRect.height / 2;
                left = rect.left - tooltipRect.width - gap;
                arrowClass = 'arrow-right';
                break;
            case 'right':
                top = rect.top + rect.height / 2 - tooltipRect.height / 2;
                left = rect.right + gap;
                arrowClass = 'arrow-left';
                break;
        }

        // Keep tooltip within viewport
        if (left < 10) left = 10;
        if (left + tooltipRect.width > viewportWidth - 10) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        if (top < 10) top = 10;
        if (top + tooltipRect.height > viewportHeight - 10) {
            top = viewportHeight - tooltipRect.height - 10;
        }

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        tooltip.classList.add(arrowClass);
    }

    // Tour initialization moved to tour.js
    
    // Handle ?edit= URL parameter to open edit modal for specific artist
    function handleEditUrlParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const editSlug = urlParams.get('edit');
        
        if (!editSlug) return;
        
        // Find artist by slug (matching the slug generation logic from artist.html)
        const cyrillicToLatinMap = {
            'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
            'Д': 'D', 'д': 'd', 'Ѓ': 'Gj', 'ѓ': 'gj', 'Е': 'E', 'е': 'e', 'Ж': 'Zh', 'ж': 'zh',
            'З': 'Z', 'з': 'z', 'Ѕ': 'Dz', 'ѕ': 'dz', 'И': 'I', 'и': 'i', 'Ј': 'J', 'ј': 'j',
            'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'Љ': 'Lj', 'љ': 'lj', 'М': 'M', 'м': 'm',
            'Н': 'N', 'н': 'n', 'Њ': 'Nj', 'њ': 'nj', 'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p',
            'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'Ќ': 'Kj', 'ќ': 'kj',
            'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'H', 'х': 'h', 'Ц': 'C', 'ц': 'c',
            'Ч': 'Ch', 'ч': 'ch', 'Џ': 'Dzh', 'џ': 'dzh', 'Ш': 'Sh', 'ш': 'sh'
        };
        
        function generateArtistSlug(name) {
            let result = '';
            for (const char of name) {
                result += cyrillicToLatinMap[char] || char;
            }
            return result.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
        
        // Find the artist index
        const index = bandsData.findIndex(band => {
            const bandSlug = generateArtistSlug(band.name);
            return bandSlug === editSlug;
        });
        
        if (index !== -1) {
            // Small delay to ensure modal is initialized
            setTimeout(() => {
                if (typeof window.openModal === 'function') {
                    window.openModal('edit', bandsData[index], index);
                    // Clear the URL parameter without reloading
                    const newUrl = window.location.pathname + window.location.hash;
                    window.history.replaceState({}, '', newUrl);
                } else {
                    console.error('openModal not available');
                }
            }, 100);
        } else {
            console.warn('Artist not found for slug:', editSlug);
        }
    }

    loadBandsData();
});