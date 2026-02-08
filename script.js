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
    const STORAGE_KEY = 'mmm-pending-changes';
    
    // Load any pending changes from localStorage
    function loadPendingChanges() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                if (data && data.bandsData && Array.isArray(data.bandsData)) {
                    console.log('Found pending changes in localStorage');
                    return data;
                }
            }
        } catch (err) {
            console.warn('Failed to load pending changes:', err);
        }
        return null;
    }
    
    // Save pending changes to localStorage
    function savePendingChanges() {
        if (!hasUnsavedChanges) {
            // Clear storage if no changes
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        try {
            const data = {
                bandsData: bandsData,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('Saved pending changes to localStorage');
        } catch (err) {
            console.warn('Failed to save pending changes:', err);
        }
    }
    
    // Prompt before leaving if there are unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges) {
            // Save to localStorage before potentially leaving
            savePendingChanges();
            // Show browser's default confirmation dialog
            e.preventDefault();
            e.returnValue = 'Имате незачувани промени. Промените се сочувани локално, но не се поднесени. Сигурно сакате да излезете?';
            return e.returnValue;
        }
    });
    
    // Auto-save changes periodically
    setInterval(() => {
        if (hasUnsavedChanges) {
            savePendingChanges();
        }
    }, 30000); // Save every 30 seconds
    
    // ==================== DARK MODE ====================
    function initDarkMode() {
        const toggle = document.getElementById('dark-mode-toggle');
        if (!toggle) return;
        
        // Check localStorage for saved preference
        const savedMode = localStorage.getItem('mmm-dark-mode');
        if (savedMode === 'true') {
            document.body.classList.add('dark-mode');
            toggle.innerHTML = '<i class="fas fa-sun"></i>';
        }
        
        toggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('mmm-dark-mode', isDark);
            toggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }
    
    // Initialize dark mode early
    initDarkMode();

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
            return allArticles;
        } catch (err) {
            console.warn('Failed to load articles:', err);
            cachedRssArticles = [];
            return [];
        }
    }
    
    /**
     * Find RSS articles matching a band name.
     * Checks both the original name and its Latin transliteration
     * against article titles and content (case-insensitive).
     * Returns matches sorted by date (latest first).
     */
    function findMatchingArticles(bandName) {
        if (!cachedRssArticles || cachedRssArticles.length === 0) return [];
        if (!bandName) return [];
        
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
        
        if (searchTerms.size === 0) return [];
        
        // Word boundaries: start/end of string, whitespace, or common punctuation.
        // Case-sensitive matching with exact word boundaries.
        const B = '[\\s,;:.!?\\-–—\\/\\(\\)\\[\\]"\'\\|«»„"\\u2018\\u2019\\u201c\\u201d]';
        const termRegexes = [...searchTerms].map(term => {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('(?:^|' + B + ')' + escaped + '(?:$|' + B + ')');
        });
        
        return cachedRssArticles.filter(article => {
            const searchIn = article.title + ' ' + article.description + ' ' + article.content;
            
            for (const regex of termRegexes) {
                if (regex.test(searchIn)) return true;
            }
            return false;
        });
    }
    
    // Start loading RSS feeds early (non-blocking)
    const rssLoadPromise = loadRssFeeds();

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
            messageEl.textContent = message;

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

    function generateCityColor(city) {
        const asciiSum = city.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        // Saturated, clearly distinct colors for each city
        const colorPalette = [
            '#0e8a7d',  // teal
            '#7c3aed',  // vivid purple
            '#16803c',  // forest green
            '#b45309',  // amber
            '#2563eb',  // bright blue
            '#be185d',  // deep pink
            '#0d9488',  // cyan-teal
            '#7e22ce',  // grape purple  
            '#4d7c0f',  // lime green
            '#c2410c',  // burnt orange
            '#0369a1',  // ocean blue
            '#9f1239',  // crimson
        ];
        const paletteIndex = asciiSum % colorPalette.length;
        return colorPalette[paletteIndex];
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
                        latestVideoUrl: release.topTrackUrl || release.releaseUrl,
                        latestVideoPublishedAt: release.releaseDate,
                        latestVideoViewCount: release.popularity || 0, // Use track popularity
                        latestVideoTitle: release.releaseTitle,
                        latestVideoThumbnail: release.thumbnail,
                        releaseType: release.releaseType,
                        topTrackName: release.topTrackName
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
                    videoUrl: mostViewed.topTrackUrl || mostViewed.releaseUrl,
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
    
    // Handle preview button clicks - shows Spotify embed player
    async function handlePreviewClick(btn) {
        const albumId = btn.dataset.albumId;
        const releaseCard = btn.closest('.new-release-card');
        const releaseUrl = releaseCard?.querySelector('.release-thumbnail-link')?.href;
        
        // Extract Spotify ID and type from URL
        let spotifyId = albumId;
        let spotifyType = 'artist'; // default
        
        if (releaseUrl && releaseUrl.includes('spotify.com')) {
            // Parse the URL to get type and ID
            // Format: https://open.spotify.com/artist/XXXX or /album/XXXX or /track/XXXX
            const match = releaseUrl.match(/spotify\.com\/(artist|album|track)\/([a-zA-Z0-9]+)/);
            if (match) {
                spotifyType = match[1];
                spotifyId = match[2];
            }
        }
        
        showSpotifyEmbed(spotifyId, spotifyType);
    }
    
    // Show Spotify embed player in modal
    function showSpotifyEmbed(spotifyId, type = 'artist') {
        const modal = document.getElementById('spotify-embed-modal');
        const container = document.getElementById('spotify-embed-container');
        
        if (!modal || !container) return;
        
        // Clean up previous Spotify embed controller
        if (spotifyEmbedController) {
            spotifyEmbedController.destroy();
            spotifyEmbedController = null;
        }
        
        // Try Spotify IFrame API for autoplay
        if (spotifyIframeAPI) {
            container.innerHTML = '';
            const target = document.createElement('div');
            container.appendChild(target);
            spotifyIframeAPI.createController(target, {
                uri: `spotify:${type}:${spotifyId}`,
                autoplay: true
            }, (controller) => {
                spotifyEmbedController = controller;
            });
        } else {
            // Fallback to regular iframe
            const embedUrl = `https://open.spotify.com/embed/${type}/${spotifyId}?utm_source=generator&theme=0`;
            container.innerHTML = `
                <iframe 
                    src="${embedUrl}" 
                    width="100%" 
                    height="${type === 'track' ? '152' : '352'}" 
                    frameBorder="0" 
                    allowfullscreen="" 
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                    loading="lazy"
                ></iframe>
            `;
        }
        
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeSpotifyEmbed();
            }
        };
        
        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeSpotifyEmbed();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    // Close Spotify embed modal
    function closeSpotifyEmbed() {
        const modal = document.getElementById('spotify-embed-modal');
        const container = document.getElementById('spotify-embed-container');
        
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
        if (container) {
            container.innerHTML = ''; // Clear iframe to stop playback
        }
    }
    
    // Initialize Spotify embed modal close button
    function initializeSpotifyEmbedModal() {
        const closeBtn = document.querySelector('.spotify-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeSpotifyEmbed);
        }
    }

    async function loadBandsData() {
        const loadingBar = document.getElementById('loading-bar');
        const controls = document.querySelector('.controls');
        try {
            console.log('Loading bands data...');
            loadingBar.classList.add('active');
            controls.style.display = 'none';
            
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
                
                // Show notification about pending changes
                setTimeout(() => {
                    showNotification(
                        `Пронајдени се незачувани промени од пред ${timeAgo} минути. Промените се вратени.`,
                        'info',
                        8000
                    );
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
            // Ensure RSS feeds are loaded before rendering (for МЕДИУМИ column)
            try {
                await rssLoadPromise;
                console.log(`RSS feeds loaded: ${(cachedRssArticles || []).length} articles`);
            } catch (rssErr) {
                console.warn('RSS feeds not available:', rssErr);
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
            controls.style.display = '';
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
                input.value = prefix + value + ', ';
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
            
            // Create wrapper for select with icon
            const selectWrapper = document.createElement('div');
            selectWrapper.className = 'platform-select-wrapper';
            
            // Create icon element (shown next to dropdown)
            const iconEl = document.createElement('i');
            const currentPlatform = socialPlatforms.find(p => p.id === platform);
            iconEl.className = (currentPlatform?.icon || 'fa-solid fa-link') + ' platform-icon';
            
            const select = document.createElement('select');
            select.className = 'platform-select';
            select.innerHTML = '<option value="none">Избери платформа</option>' +
                socialPlatforms.map(p => `<option value="${p.id}" ${p.id === platform ? 'selected' : ''}>${p.name}</option>`).join('');
            
            selectWrapper.appendChild(iconEl);
            selectWrapper.appendChild(select);
            
            const input = document.createElement('input');
            input.type = 'url';
            input.placeholder = 'Внеси URL';
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
            
            // Update standalone icon when selection changes
            select.addEventListener('change', function() {
                const selectedPlatform = socialPlatforms.find(p => p.id === this.value);
                iconEl.className = (selectedPlatform?.icon || 'fa-solid fa-link') + ' platform-icon';
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
            }
            modal.style.display = 'block';
            console.log('Modal opened successfully');
        }

        async function deleteBand(index) {
            console.log(`Delete band requested for index ${index}`);
            const confirmed = await showCustomDialog(
                'Потврда за бришење',
                'Дали сте сигурни дека сакате да го избришете овој бенд?'
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
        copyButton.addEventListener('click', () => {
            console.log('Copy data button clicked');
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
        // Minimal init (debug logs removed for production cleanliness)
        const submitBtn = document.getElementById('submit-pr-btn');
        if (!submitBtn) {
            return;
        }

        const resolveEndpoint = () => {
            if (typeof window.MMM_PR_ENDPOINT === 'string' && window.MMM_PR_ENDPOINT.trim()) return window.MMM_PR_ENDPOINT.trim();
            const attr = submitBtn.getAttribute('data-endpoint');
            if (attr && attr.trim()) return attr.trim();
            const stored = localStorage.getItem('mmm_pr_endpoint');
            if (stored && stored.trim()) return stored.trim();
            return '';
        };

        // Inject status container after button (now used for notifications instead)
        let statusEl = document.getElementById('pr-submit-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'pr-submit-status';
            statusEl.style.display = 'none'; // Hide the old status element
            submitBtn.insertAdjacentElement('afterend', statusEl);
        }

        submitBtn.addEventListener('click', async () => {
            try {
                    // Edit mode no longer required; allow submission anytime
                if (!hasUnsavedChanges) {
                    showNotification('Нема промени за поднесување.', 'info');
                    return;
                }

                let endpoint = resolveEndpoint();
                if (!endpoint) {
                    endpoint = await showCustomDialog(
                        'Worker Endpoint',
                        'Внесете URL на worker endpoint за PR (ќе се зачува локално):',
                        'https://example.com/worker'
                    );
                    if (!endpoint) return;
                    localStorage.setItem('mmm_pr_endpoint', endpoint);
                }

                // Compute and prefill summary of changes
                const diff = computeChangesSummary(originalBandsData, bandsData);
                const diffText = summarizeChangesText(diff) || 'Без промени';

                const prFormPromise = showCustomDialog(
                    'Поднесување на промени',
                    'Пополнете ги информациите за поднесување на вашите промени:',
                    '',
                    '',
                    true
                );
                // Prefill the PR description with a summary of changes
                setTimeout(() => {
                    const desc = document.getElementById('pr-description');
                    if (desc) {
                        const header = 'Предлог промени од MMM формуларот\n\n';
                        desc.value = `${header}${diffText}\n`;
                    }
                }, 0);

                const formData = await prFormPromise;
                if (!formData) return; // User canceled

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

                submitBtn.disabled = true;
                const originalHtml = submitBtn.innerHTML;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Испраќање...';
                showNotification('Испраќање...', 'info');

                const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bandsJson: json,
                        contributor: formData.contributor,
                        description: formData.description,
                        path: 'bands.json'
                    })
                });

                if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(`Worker error (${resp.status}): ${text}`);
                }

                const result = await resp.json();
                const prUrl = result.pr_url || result.html_url || '';
                if (prUrl) {
                    showNotification('Успешно поднесено! Отворен е PR.', 'success');
                    window.open(prUrl, '_blank');
                } else {
                    showNotification('Успешно поднесено!', 'success');
                }

            } catch (err) {
                console.error('Submit PR failed:', err);
                showNotification('Грешка при поднесување: ' + (err?.message || err), 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Побарај промена';
                // Reset change tracking after successful submission
                try {
                    originalBandsData = JSON.parse(JSON.stringify(bandsData));
                    hasUnsavedChanges = false;
                    updateSubmitButtonState();
                    // Clear pending changes from localStorage after successful submission
                    localStorage.removeItem(STORAGE_KEY);
                } catch (_) {}
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
    
    // Debounce timer for search input
    let searchDebounceTimer = null;
    const SEARCH_DEBOUNCE_MS = 150;
    
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
                status: getActivityStatus(band.name)
            };
        });
        
        return bandDataCache;
    }
    
    // Invalidate cache when bands data changes
    function invalidateBandCache() {
        bandDataCache = null;
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
    
    // Filter bands with a specific filter excluded (for updating that filter's options)
    function getFilteredBandsExcluding(excludeFilter) {
        const cache = buildBandDataCache();
        const filters = getCurrentFilters();
        
        const searchName = filters.searchName;
        const searchNameLatinFull = searchName ? transliterateCyrillicToLatin(searchName).toLowerCase() : '';
        const searchNameLatinShort = searchName ? transliterateCyrillicToLatinShorthand(searchName).toLowerCase() : '';
        
        return cache.filter(cached => {
            // Name filter (never excluded)
            if (searchName) {
                const matchesName = (
                    cached.nameLower.includes(searchName) ||
                    cached.nameLatinFull.includes(searchNameLatinFull) ||
                    cached.nameLatinShort.includes(searchNameLatinShort) ||
                    cached.nameLatinFull.includes(searchNameLatinShort) ||
                    cached.nameLatinShort.includes(searchNameLatinFull)
                );
                if (!matchesName) return false;
            }
            
            // City filter
            if (excludeFilter !== 'city' && filters.city) {
                if (!cached.cities.has(filters.city)) return false;
            }
            
            // Genre filter
            if (excludeFilter !== 'genre' && filters.genre) {
                if (!cached.genres.has(filters.genre)) return false;
            }
            
            // Sounds like filter
            if (excludeFilter !== 'soundsLike' && filters.soundsLike) {
                if (!cached.soundsLike.has(filters.soundsLike)) return false;
            }
            
            // Status filter
            if (excludeFilter !== 'status' && filters.status) {
                if (cached.status !== filters.status) return false;
            }
            
            // Label filter
            if (excludeFilter !== 'label' && filters.label) {
                if (!cached.labels.has(filters.label)) return false;
            }
            
            return true;
        });
    }
    
    // Update a single filter's options based on available data
    function updateFilterOptions(filterId, selectElement, getValuesFromCached, currentValue) {
        const filteredData = getFilteredBandsExcluding(filterId);
        const counts = {};
        
        filteredData.forEach(cached => {
            const values = getValuesFromCached(cached);
            values.forEach(val => {
                counts[val] = (counts[val] || 0) + 1;
            });
        });
        
        // Sort by transliterated name
        const sortedValues = Object.keys(counts).sort((a, b) => 
            transliterateCyrillicToLatin(a).localeCompare(transliterateCyrillicToLatin(b), 'en')
        );
        
        // Build new options array
        const newOptions = sortedValues.map(val => ({
            value: val,
            text: `${val} (${counts[val]})`
        }));
        
        // Check if we need to update (compare values only)
        const currentOptionValues = Array.from(selectElement.options)
            .slice(1) // Skip empty option
            .map(o => o.value)
            .join('|');
        const newOptionValues = sortedValues.join('|');
        
        // Also check if counts changed
        const currentOptionTexts = Array.from(selectElement.options)
            .slice(1)
            .map(o => o.text)
            .join('|');
        const newOptionTexts = newOptions.map(o => o.text).join('|');
        
        if (currentOptionValues !== newOptionValues || currentOptionTexts !== newOptionTexts) {
            // Build new HTML
            const newHtml = '<option value=""></option>' +
                newOptions.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
            
            selectElement.innerHTML = newHtml;
            
            // Restore value if it still exists in options
            if (currentValue && counts[currentValue]) {
                selectElement.value = currentValue;
            }
        }
    }
    
    // Update all filter dropdowns based on current selection
    function updateAllFilterOptions() {
        const filters = getCurrentFilters();
        
        updateFilterOptions('city', document.getElementById('filter-city'), 
            cached => cached.citiesArray, filters.city);
        updateFilterOptions('genre', document.getElementById('filter-genre'),
            cached => cached.genresArray, filters.genre);
        updateFilterOptions('soundsLike', document.getElementById('filter-sounds-like'),
            cached => cached.soundsLikeArray, filters.soundsLike);
        updateFilterOptions('status', document.getElementById('filter-status'),
            cached => [cached.status], filters.status);
        updateFilterOptions('label', document.getElementById('filter-label'),
            cached => cached.labelsArray, filters.label);
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

    function filterBands() {
        // Prevent recursive filtering during option updates
        if (isUpdatingFilters) return;
        
        console.log('Filtering bands');
        const cache = buildBandDataCache();
        const filters = getCurrentFilters();
        
        const searchName = filters.searchName;
        const searchNameLatinFull = searchName ? transliterateCyrillicToLatin(searchName).toLowerCase() : '';
        const searchNameLatinShort = searchName ? transliterateCyrillicToLatinShorthand(searchName).toLowerCase() : '';
        
        const filteredBands = cache.filter(cached => {
            // Name filter
            if (searchName) {
                const matchesName = (
                    cached.nameLower.includes(searchName) ||
                    cached.nameLatinFull.includes(searchNameLatinFull) ||
                    cached.nameLatinShort.includes(searchNameLatinShort) ||
                    cached.nameLatinFull.includes(searchNameLatinShort) ||
                    cached.nameLatinShort.includes(searchNameLatinFull)
                );
                if (!matchesName) return false;
            }
            
            // City filter
            if (filters.city && !cached.cities.has(filters.city)) return false;
            
            // Genre filter
            if (filters.genre && !cached.genres.has(filters.genre)) return false;
            
            // Sounds like filter
            if (filters.soundsLike && !cached.soundsLike.has(filters.soundsLike)) return false;
            
            // Status filter
            if (filters.status && cached.status !== filters.status) return false;
            
            // Label filter
            if (filters.label && !cached.labels.has(filters.label)) return false;
            
            return true;
        }).map(cached => cached.band);
        
        // Update filter dropdowns to show only available options (with guard flag)
        isUpdatingFilters = true;
        try {
            updateAllFilterOptions();
        } finally {
            isUpdatingFilters = false;
        }
        
        renderBands(filteredBands);
    }
    
    // Debounced filter for search input
    function filterBandsDebounced() {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(filterBands, SEARCH_DEBOUNCE_MS);
    }

    let renderAbortController = null; // To cancel progressive renders when a new render starts

    function renderBands(bands, { progressive = false, chunkSize = 20 } = {}) {
        console.log(`Rendering ${bands.length} bands${progressive ? ' (progressive)' : ''}`);
        const bandTableBody = document.getElementById('band-table-body');
        bandTableBody.innerHTML = '';
        
        // Cancel any in-progress progressive render
        if (renderAbortController) {
            renderAbortController.abort();
            renderAbortController = null;
        }
        
        if (!progressive || bands.length <= chunkSize) {
            // Render all at once (used by filtering, small datasets)
            bands.forEach((band, displayIndex) => {
                renderSingleBandRow(band, bandTableBody);
            });
            return;
        }
        
        // Progressive rendering: yield between chunks so the browser can paint
        renderAbortController = new AbortController();
        const signal = renderAbortController.signal;
        let offset = 0;
        
        function renderChunk() {
            if (signal.aborted) return;
            const end = Math.min(offset + chunkSize, bands.length);
            for (let i = offset; i < end; i++) {
                renderSingleBandRow(bands[i], bandTableBody);
            }
            offset = end;
            if (offset < bands.length) {
                requestAnimationFrame(renderChunk);
            } else {
                renderAbortController = null;
            }
        }
        renderChunk();
    }
    
    function renderSingleBandRow(band, bandTableBody) {
            const originalIndex = bandsData.findIndex(b => b.name === band.name && b.city === band.city && b.genre === band.genre);
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
                
                linksHtml = regularLinks
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
                if (band.contact !== 'недостигаат податоци') {
                    linksHtml += `<a href="mailto:${band.contact}" class="contact-link"><i class="fa-solid fa-envelope"></i></a>`;
                }
                
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
                : band.city.split(',').map(c => c.trim()).map(c => `<span class="city-item" data-filter="city" data-value="${c}" style="background: ${generateCityColor(c)}">${c}</span>`).join('');
            let genreHtml = band.genre === 'недостигаат податоци'
                ? '<span class="missing-data"><i class="fas fa-question-circle"></i></span>'
                : band.genre.split(',').map(g => g.trim()).map(g => `<span class="genre-item" data-filter="genre" data-value="${g}">${g}</span>`).join('');
            let soundsLikeHtml = band.soundsLike === 'недостигаат податоци'
                ? '<span class="missing-data"><i class="fas fa-question-circle"></i></span>'
                : band.soundsLike.split(',').map(s => s.trim()).map(s => `<span class="sounds-like-item" data-filter="sounds-like" data-value="${s}">${s}</span>`).join('');
            
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
            
            // On mobile, merge media links into the links column
            const isMobile = window.innerWidth <= 600;
            const combinedLinksHtml = isMobile && reviewsHtml ? linksHtml + reviewsHtml : linksHtml;
            
            bandRow.innerHTML = `
                <td data-label="Име" class="name">${nameHtml}</td>
                <td data-label="Град"><div class="cell-scroll">${cityHtml}</div></td>
                <td data-label="Жанр"><div class="cell-scroll">${genreHtml}</div></td>
                <td data-label="Звучи како"><div class="cell-scroll">${soundsLikeHtml}</div></td>
                <td data-label="Линкови" class="links"><div class="cell-scroll">${combinedLinksHtml}</div></td>
                <td data-label="Медиуми" class="links reviews"><div class="cell-scroll">${reviewsHtml}</div></td>
                <td data-label="Статус" data-status="${activityStatus}" class="${statusClass}">
                    <span class="status-content" data-status-text="${activityStatus}">${activityStatus}</span>
                </td>
                <td data-label="Акции" class="action-buttons edit-hidden">
                    <button class="action-btn edit-btn" data-index="${originalIndex}"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete-btn" onclick="window.deleteBand(${originalIndex})"><i class="fas fa-trash"></i></button>
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
    
    // ==================== INLINE MUSIC PLAYER ====================
    // Service definitions with icons and embed support
    const serviceDefinitions = {
        spotify: { name: 'Spotify', icon: 'fab fa-spotify', hasEmbed: true, linkKey: 'spotify' },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube', hasEmbed: true, linkKey: 'youtube' },
        youtube_music: { name: 'YouTube Music', icon: 'fab fa-youtube', hasEmbed: false, linkKey: 'youtube_music' },
        apple: { name: 'Apple Music', icon: 'fab fa-apple', hasEmbed: true, linkKey: 'apple' },
        itunes: { name: 'Apple Music', icon: 'fab fa-itunes-note', hasEmbed: true, linkKey: 'itunes' },
        deezer: { name: 'Deezer', icon: 'fab fa-deezer', hasEmbed: true, linkKey: 'deezer' },
        tidal: { name: 'Tidal', icon: 'fas fa-water', hasEmbed: false, linkKey: 'tidal' },
        amazon_music: { name: 'Amazon Music', icon: 'fab fa-amazon', hasEmbed: false, linkKey: 'amazon_music' },
        napster: { name: 'Napster', icon: 'fab fa-napster', hasEmbed: false, linkKey: 'napster' },
        audiomack: { name: 'Audiomack', icon: 'fas fa-headphones', hasEmbed: false, linkKey: 'audiomack' },
        bandcamp: { name: 'Bandcamp', icon: 'fab fa-bandcamp', hasEmbed: true, linkKey: 'bandcamp' },
        soundcloud: { name: 'SoundCloud', icon: 'fab fa-soundcloud', hasEmbed: true, linkKey: 'soundcloud' }
    };
    
    let currentTrackData = null;
    
    // Spotify IFrame API for autoplay support
    let spotifyIframeAPI = null;
    let spotifyEmbedController = null;
    
    (function loadSpotifyIframeApi() {
        const script = document.createElement('script');
        script.src = 'https://open.spotify.com/embed/iframe-api/v1';
        script.async = true;
        document.head.appendChild(script);
    })();
    
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
        spotifyIframeAPI = IFrameAPI;
    };
    
    // Songlink API cache and resolver - gets correct track URLs for all platforms
    const songlinkCache = {};
    const songlinkPlatformMap = {
        spotify: 'spotify',
        appleMusic: 'itunes',
        youtubeMusic: 'youtube_music',
        youtube: 'youtube',
        amazonMusic: 'amazon_music',
        deezer: 'deezer',
        tidal: 'tidal',
        soundcloud: 'soundcloud',
        napster: 'napster',
        audiomack: 'audiomack'
    };
    
    async function fetchSonglinkData(spotifyId, type) {
        const spotifyUrl = `https://open.spotify.com/${type}/${spotifyId}`;
        if (songlinkCache[spotifyUrl]) return songlinkCache[spotifyUrl];
        
        try {
            const response = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyUrl)}`);
            if (!response.ok) return null;
            const data = await response.json();
            
            // Extract track-specific URLs from Songlink response
            const trackLinks = {};
            if (data.linksByPlatform) {
                for (const [platform, linkData] of Object.entries(data.linksByPlatform)) {
                    const ourKey = songlinkPlatformMap[platform];
                    if (ourKey && linkData.url) {
                        trackLinks[ourKey] = linkData.url;
                    }
                }
            }
            
            songlinkCache[spotifyUrl] = trackLinks;
            return trackLinks;
        } catch (err) {
            console.warn('Songlink API error:', err);
            return null;
        }
    }
    
    function findBandByName(artistName) {
        if (!bandsData) return null;
        
        // Try exact match first
        let band = bandsData.find(b => b.name.toLowerCase() === artistName.toLowerCase());
        if (band) return band;
        
        // Try first artist in collab (split by comma)
        const firstArtist = artistName.split(',')[0].trim();
        band = bandsData.find(b => b.name.toLowerCase() === firstArtist.toLowerCase());
        if (band) return band;
        
        // Try partial match
        band = bandsData.find(b => artistName.toLowerCase().includes(b.name.toLowerCase()));
        return band;
    }
    
    function getPreferredService() {
        return localStorage.getItem('mmm-preferred-player') || 'spotify';
    }
    
    function setPreferredService(serviceId) {
        localStorage.setItem('mmm-preferred-player', serviceId);
    }
    
    function showMusicPlayer(spotifyId, type = 'artist', title = '', artist = '', thumbnail = '') {
        let player = document.getElementById('music-player');
        
        // Find band links from bands.json
        const band = findBandByName(artist);
        const artistLinks = band?.links || {};
        
        // Use artist thumbnail from chart data if available
        const artistThumbnail = getArtistThumbnail(artist) || thumbnail;
        
        currentTrackData = { spotifyId, type, title, artist, thumbnail: artistThumbnail, artistLinks };
        
        if (!player) {
            // Create player if it doesn't exist
            player = document.createElement('div');
            player.id = 'music-player';
            player.className = 'music-player';
            player.innerHTML = `
                <div class="music-player-bar">
                    <div class="music-player-cover">
                        <img src="" alt="">
                    </div>
                    <div class="music-player-info">
                        <div class="music-player-title"></div>
                        <div class="music-player-artist"></div>
                    </div>
                    <div class="music-player-tabs"></div>
                    <button class="music-player-close" title="Затвори"><i class="fas fa-times"></i></button>
                </div>
                <div class="music-player-embed"></div>
            `;
            document.body.appendChild(player);
            
            // Close button
            player.querySelector('.music-player-close').addEventListener('click', closeMusicPlayer);
            
            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && player.classList.contains('active')) {
                    closeMusicPlayer();
                }
            });
        }
        
        // Update player content
        const coverContainer = player.querySelector('.music-player-cover');
        const coverImg = coverContainer?.querySelector('img');
        if (artistThumbnail) {
            if (coverImg) coverImg.src = artistThumbnail;
            coverContainer.style.display = '';
        } else {
            coverContainer.style.display = 'none';
        }
        player.querySelector('.music-player-title').textContent = title;
        player.querySelector('.music-player-artist').textContent = artist;
        
        // Render service tabs - separate embeddable from external
        renderServiceTabs(player, artistLinks);
        
        // Always default to Spotify when opening a new song
        if (spotifyId) {
            activateService('spotify');
            
            // Fetch track-specific URLs from Songlink API in background
            fetchSonglinkData(spotifyId, type).then(trackLinks => {
                if (trackLinks && currentTrackData && currentTrackData.spotifyId === spotifyId) {
                    // Merge track-specific URLs (override artist profile URLs)
                    currentTrackData.trackLinks = trackLinks;
                    // Re-render tabs with correct song links
                    const player = document.getElementById('music-player');
                    if (player) {
                        renderServiceTabs(player, artistLinks, trackLinks);
                    }
                }
            });
        } else {
            // Fallback to first available service with embed
            const firstEmbeddable = Object.keys(artistLinks).find(k => 
                serviceDefinitions[k]?.hasEmbed && artistLinks[k]
            );
            if (firstEmbeddable) {
                activateService(firstEmbeddable);
            }
        }
        
        player.classList.add('active');
    }
    
    // Helper function to check if a URL can be embedded
    function canEmbed(serviceId, url) {
        if (!url) return false;
        switch (serviceId) {
            case 'youtube':
                return /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(url);
            case 'soundcloud':
                return /soundcloud\.com\/[^\/]+\/[^\/]+/.test(url); // Must be a track, not just artist
            case 'apple':
            case 'itunes':
                return /music\.apple\.com\/[a-z]{2}\/(?:album|playlist)\//.test(url);
            case 'deezer':
                return /deezer\.com\/(?:[a-z]{2}\/)?(track|album|artist)\/\d+/.test(url);
            case 'tidal':
                return /tidal\.com\/(?:browse\/)?(album|track|video)\/\d+/.test(url);
            case 'bandcamp':
                return /bandcamp\.com\/(track|album)\//.test(url);
            default:
                return false;
        }
    }

    function renderServiceTabs(player, artistLinks, trackLinks = null) {
        const tabsContainer = player.querySelector('.music-player-tabs');
        
        // Use track-specific links when available, fall back to artist profile links
        const effectiveLinks = {};
        
        // Start with artist profile links as base
        Object.entries(artistLinks).forEach(([key, url]) => {
            if (key !== 'spotify' && serviceDefinitions[key]) {
                effectiveLinks[key] = { url, isTrackLink: false };
            }
        });
        
        // Override/add with track-specific links from Songlink
        if (trackLinks) {
            Object.entries(trackLinks).forEach(([key, url]) => {
                if (key !== 'spotify' && serviceDefinitions[key]) {
                    effectiveLinks[key] = { url, isTrackLink: true };
                }
            });
        }
        
        // Build available services - separate embeddable from external
        const embeddableServices = [];
        const externalServices = [];
        
        // Spotify is always embeddable if we have spotifyId (with correct song)
        if (currentTrackData.spotifyId) {
            embeddableServices.push({ id: 'spotify', ...serviceDefinitions.spotify, url: null, hasEmbed: true });
        }
        
        // Add other services - use track-specific URL if available
        Object.entries(effectiveLinks).forEach(([key, { url, isTrackLink }]) => {
            const service = { id: key, ...serviceDefinitions[key], url, isTrackLink };
            if (isTrackLink && canEmbed(key, url)) {
                embeddableServices.push(service);
            } else if (!isTrackLink && canEmbed(key, url)) {
                // Artist profile URL that happens to be embeddable - still external since wrong content
                externalServices.push(service);
            } else {
                externalServices.push(service);
            }
        });
        
        if (embeddableServices.length === 0 && externalServices.length === 0) {
            tabsContainer.innerHTML = '';
            return;
        }
        
        // Build HTML with separator between embeddable and external
        let html = '';
        
        // Embeddable services
        if (embeddableServices.length > 0) {
            html += embeddableServices.map(service => `
                <button class="music-player-tab embeddable" 
                        data-service="${service.id}" 
                        data-url="${service.url || ''}"
                        data-has-embed="true"
                        title="${service.name} (плеер)">
                    <i class="${service.icon}"></i>
                </button>
            `).join('');
        }
        
        // Separator and external services (non-embeddable links)
        if (externalServices.length > 0) {
            if (embeddableServices.length > 0) {
                html += '<span class="music-player-separator"></span>';
            }
            html += externalServices.map(service => `
                <a class="music-player-tab external" 
                   href="${service.url}"
                   target="_blank"
                   rel="noopener noreferrer"
                   data-service="${service.id}" 
                   title="${service.name} (профил)">
                    <i class="${service.icon}"></i>
                    <i class="fas fa-external-link-alt external-icon"></i>
                </a>
            `).join('');
        }
        
        tabsContainer.innerHTML = html;
        
        // Add click handlers only for embeddable tabs
        tabsContainer.querySelectorAll('.music-player-tab.embeddable').forEach(tab => {
            tab.addEventListener('click', () => {
                const serviceId = tab.dataset.service;
                activateService(serviceId);
            });
        });
    }
    
    function activateService(serviceId) {
        const player = document.getElementById('music-player');
        if (!player || !currentTrackData) return;
        
        // Clean up previous Spotify embed controller
        if (spotifyEmbedController) {
            spotifyEmbedController.destroy();
            spotifyEmbedController = null;
        }
        
        const tabsContainer = player.querySelector('.music-player-tabs');
        const embedContainer = player.querySelector('.music-player-embed');
        const { spotifyId, type, artistLinks, trackLinks } = currentTrackData;
        // Prefer track-specific URL, fall back to artist profile URL
        const url = (trackLinks && trackLinks[serviceId]) || artistLinks[serviceId];
        
        // Update active tab
        tabsContainer.querySelectorAll('.music-player-tab').forEach(t => t.classList.remove('active'));
        const activeTab = tabsContainer.querySelector(`[data-service="${serviceId}"]`);
        if (activeTab) activeTab.classList.add('active');
        
        // Use Spotify IFrame API for autoplay
        if (serviceId === 'spotify' && spotifyId && spotifyIframeAPI) {
            const target = document.createElement('div');
            embedContainer.innerHTML = '';
            embedContainer.appendChild(target);
            embedContainer.classList.add('expanded');
            spotifyIframeAPI.createController(target, {
                uri: `spotify:${type}:${spotifyId}`,
                autoplay: true
            }, (controller) => {
                spotifyEmbedController = controller;
            });
            return;
        }
        
        // Generate embed HTML based on service
        let embedHtml = '';
        
        if (serviceId === 'spotify' && spotifyId) {
            // Fallback when IFrame API not loaded yet
            embedHtml = `<iframe src="https://open.spotify.com/embed/${type}/${spotifyId}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
        } else if (serviceId === 'youtube' && url) {
            const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (ytMatch) {
                embedHtml = `<iframe class="youtube-embed" src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
            }
        } else if (serviceId === 'soundcloud' && url) {
            const encodedUrl = encodeURIComponent(url);
            embedHtml = `<iframe class="soundcloud-embed" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=${encodedUrl}&color=%23ff5500&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false" allow="autoplay" loading="lazy"></iframe>`;
        } else if ((serviceId === 'apple' || serviceId === 'itunes') && url) {
            const appleMatch = url.match(/music\.apple\.com\/([a-z]{2})\/(?:album|playlist)\/[^\/]+\/([0-9]+)/);
            if (appleMatch) {
                const country = appleMatch[1];
                const albumId = appleMatch[2];
                embedHtml = `<iframe class="apple-embed" src="https://embed.music.apple.com/${country}/album/${albumId}?theme=dark" allow="autoplay *; encrypted-media *; fullscreen *" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" loading="lazy"></iframe>`;
            }
        } else if (serviceId === 'deezer' && url) {
            const deezerMatch = url.match(/deezer\.com\/(?:[a-z]{2}\/)?(track|album|artist)\/(\d+)/);
            if (deezerMatch) {
                const deezerType = deezerMatch[1];
                const deezerId = deezerMatch[2];
                embedHtml = `<iframe class="deezer-embed" scrolling="no" frameborder="0" src="https://widget.deezer.com/widget/dark/${deezerType}/${deezerId}" allow="encrypted-media; clipboard-write" loading="lazy"></iframe>`;
            }
        } else if (serviceId === 'tidal' && url) {
            const tidalMatch = url.match(/tidal\.com\/(?:browse\/)?(album|track|video)\/(\d+)/);
            if (tidalMatch) {
                const tidalType = tidalMatch[1];
                const tidalId = tidalMatch[2];
                embedHtml = `<iframe class="tidal-embed" src="https://embed.tidal.com/${tidalType}s/${tidalId}?layout=gridify" allow="encrypted-media" loading="lazy"></iframe>`;
            }
        } else if (serviceId === 'bandcamp' && url) {
            // Bandcamp requires fetching the page to get embed code, use oEmbed
            embedHtml = `<iframe class="bandcamp-embed" src="https://bandcamp.com/EmbeddedPlayer/size=large/bgcol=333333/linkcol=e99708/tracklist=false/artwork=small/transparent=true/" seamless loading="lazy"><a href="${url}">Open on Bandcamp</a></iframe>`;
        }
        
        // Update embed
        if (embedHtml) {
            embedContainer.innerHTML = embedHtml;
            embedContainer.classList.add('expanded');
        } else {
            embedContainer.innerHTML = `<div class="music-player-no-embed">Нема достапен плеер за оваа услуга</div>`;
            embedContainer.classList.add('expanded');
        }
    }
    
    function closeMusicPlayer() {
        const player = document.getElementById('music-player');
        
        // Clean up Spotify embed controller
        if (spotifyEmbedController) {
            spotifyEmbedController.destroy();
            spotifyEmbedController = null;
        }
        
        if (player) {
            player.classList.remove('active');
            // Stop playback by clearing embed
            const embedContainer = player.querySelector('.music-player-embed');
            if (embedContainer) {
                embedContainer.innerHTML = '';
                embedContainer.classList.remove('expanded');
            }
            currentTrackData = null;
        }
    }
    
    // Keep old function name for compatibility
    function showSpotifyEmbed(spotifyId, type = 'artist') {
        showMusicPlayer(spotifyId, type, '', '', '');
    }
    
    function closeSpotifyEmbed() {
        closeMusicPlayer();
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
            title: 'Линкови',
            description: 'Кликни на иконата и директно те носи на профилот - Spotify, YouTube, Instagram, што има.',
            position: 'bottom'
        },
        {
            element: '.artist-preview-btn',
            title: 'Преслушај',
            description: 'Ова зелено копче <i class="fas fa-play" style="color: #4a9c6d;"></i> ти пушта песна директно тука, без да одиш на друг сајт. Практично за брзо да чуеш како звучи некој.',
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
            description: 'Ако сакаш да помогнеш:<br><br>• Додај артист што го нема<br>• Поправи ако нешто не е точно<br>• Јави се на <a href="https://discord.gg/fj6dJGhM" target="_blank">Xotel Discord</a> ако имаш прашања<br><br>Фала што помагаш! 🎸',
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
            description: 'Ако сакаш да помогнеш:<br><br>• Додај артист што го нема<br>• Поправи ако нешто не е точно<br>• Јави се на <a href="https://discord.gg/fj6dJGhM" target="_blank">Xotel Discord</a> ако имаш прашања<br><br>Фала што помагаш!',
            position: 'center'
        }
    ];

    let currentTourStep = 0;
    let tourActive = false;
    const TOUR_VIEWED_KEY = 'mmm-tour-viewed';

    function initTour() {
        const tourBtn = document.getElementById('start-tour-btn');
        const overlay = document.getElementById('tour-overlay');
        const highlight = overlay.querySelector('.tour-highlight');
        const tooltip = overlay.querySelector('.tour-tooltip');
        const titleEl = tooltip.querySelector('.tour-title');
        const descEl = tooltip.querySelector('.tour-description');
        const progressEl = tooltip.querySelector('.tour-progress');
        const prevBtn = tooltip.querySelector('.tour-btn-prev');
        const nextBtn = tooltip.querySelector('.tour-btn-next');
        const skipBtn = tooltip.querySelector('.tour-btn-skip');

        if (!tourBtn || !overlay) return;

        tourBtn.addEventListener('click', startTour);
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
        const isListPage = window.location.pathname.endsWith('list.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
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

    // Initialize tour
    initTour();
    
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