(function () {
    'use strict';

    var STORAGE_SEED_KEY = 'mmm-radio-seed';
    var STORAGE_STATE_KEY = 'mmm-radio-playback-state';
    var DEFAULT_STATION_ID = 'toplista-radio';
    var QUEUE_LOOKAHEAD = 8;
    var CROSSFADE_SECONDS = 1.6;
    var PROGRESS_INTERVAL_MS = 250;
    var STORAGE_SAVE_INTERVAL_MS = 1000;
    var FADE_STEPS = 10;

    var state = {
        source: null,
        stationId: DEFAULT_STATION_ID,
        queue: [],
        queueIndex: 0,
        players: { a: null, b: null },
        playerReady: { a: false, b: false },
        apiReady: false,
        activePlayerKey: 'a',
        standbyPlayerKey: 'b',
        preparedIndex: null,
        loadedIndex: null,
        durationByVideoId: {},
        isPlaying: false,
        pendingAutoplay: false,
        isTransitioning: false,
        failedVideoIds: {},
        stationCycle: 0,
        resumeStartSeconds: 0,
        resumeVideoId: null,
        resumeAutoplay: false,
        lastPlaybackSaveAt: 0,
        progressTimer: null,
        transitionTimer: null
    };

    var els = {};

    function txt(key, fallback) {
        if (typeof window.t === 'function') {
            var value = window.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function html(value) {
        if (typeof window.escHtml === 'function') return window.escHtml(String(value || ''));
        return String(value || '').replace(/[&<>"']/g, function (character) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
        });
    }

    function localText(value) {
        if (typeof window.localizeText === 'function') return window.localizeText(value || '');
        return value || '';
    }

    function localDateKey() {
        var currentDate = new Date();
        var year = currentDate.getFullYear();
        var month = String(currentDate.getMonth() + 1).padStart(2, '0');
        var day = String(currentDate.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function getSeed() {
        try {
            var existing = localStorage.getItem(STORAGE_SEED_KEY);
            if (existing) return existing;
            var bytes = new Uint32Array(2);
            if (window.crypto && window.crypto.getRandomValues) {
                window.crypto.getRandomValues(bytes);
            } else {
                bytes[0] = Math.floor(Math.random() * 0xffffffff);
                bytes[1] = Date.now() & 0xffffffff;
            }
            var seed = bytes[0].toString(36) + bytes[1].toString(36);
            localStorage.setItem(STORAGE_SEED_KEY, seed);
            return seed;
        } catch (error) {
            return 'session-' + Math.floor(Math.random() * 1000000000).toString(36);
        }
    }

    function xmur3(value) {
        var hash = 1779033703 ^ value.length;
        for (var index = 0; index < value.length; index++) {
            hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
            hash = hash << 13 | hash >>> 19;
        }
        return function () {
            hash = Math.imul(hash ^ hash >>> 16, 2246822507);
            hash = Math.imul(hash ^ hash >>> 13, 3266489909);
            return (hash ^= hash >>> 16) >>> 0;
        };
    }

    function mulberry32(seed) {
        return function () {
            var value = seed += 0x6D2B79F5;
            value = Math.imul(value ^ value >>> 15, value | 1);
            value ^= value + Math.imul(value ^ value >>> 7, value | 61);
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
    }

    function makeRng(stationId) {
        var seed = getSeed() + '|' + localDateKey() + '|' + stationId + '|' + state.stationCycle;
        return mulberry32(xmur3(seed)());
    }

    function readPlaybackState() {
        try {
            var saved = localStorage.getItem(STORAGE_STATE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    function writePlaybackState(wasPlaying) {
        if (!state.source || !state.queue.length) return;
        var item = state.queue[state.queueIndex];
        if (!item || !item.videoId) return;

        var currentTime = state.resumeStartSeconds || 0;
        var player = activePlayer();
        try {
            if (player && typeof player.getCurrentTime === 'function') currentTime = Number(player.getCurrentTime()) || currentTime;
        } catch (error) {}

        var duration = getDurationSeconds(item);
        if (duration && currentTime >= duration - 1) currentTime = 0;

        try {
            localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify({
                version: 1,
                stationId: state.stationId,
                queueIndex: state.queueIndex,
                stationCycle: state.stationCycle,
                videoId: item.videoId,
                currentTime: Math.max(0, currentTime),
                wasPlaying: !!wasPlaying,
                dateKey: localDateKey(),
                sourceDate: state.source.validForDate || '',
                savedAt: Date.now()
            }));
            state.lastPlaybackSaveAt = Date.now();
        } catch (error) {}
    }

    function normalizeArtistKey(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9а-яѓќљњџчшжѕ]+/gi, ' ').trim();
    }

    function splitArtistKeys(value) {
        return String(value || '')
            .split(/,|&| feat\.? | ft\.? | x | X | and | и /)
            .map(normalizeArtistKey)
            .filter(Boolean);
    }

    function getItemArtistKeys(item) {
        if (item && Array.isArray(item.artistKeys) && item.artistKeys.length) return item.artistKeys;
        return splitArtistKeys(item && item.artist ? item.artist : '');
    }

    function hasRecentArtist(recentArtistKeys, item) {
        var artistKeys = getItemArtistKeys(item);
        for (var artistIndex = 0; artistIndex < artistKeys.length; artistIndex++) {
            if (recentArtistKeys.indexOf(artistKeys[artistIndex]) !== -1) return true;
        }
        return false;
    }

    function hasRecentGenre(recentGenreGroups, item) {
        var genreGroup = item && item.genreGroup ? item.genreGroup : 'other';
        return genreGroup !== 'other' && recentGenreGroups.indexOf(genreGroup) !== -1;
    }

    function hasArtistOverlap(firstItem, secondItem) {
        var firstKeys = getItemArtistKeys(firstItem);
        var secondKeys = getItemArtistKeys(secondItem);
        for (var firstIndex = 0; firstIndex < firstKeys.length; firstIndex++) {
            if (secondKeys.indexOf(firstKeys[firstIndex]) !== -1) return true;
        }
        return false;
    }

    function hasGenreConflict(firstItem, secondItem) {
        if (!firstItem || !secondItem) return false;
        var firstGenre = firstItem.genreGroup || 'other';
        var secondGenre = secondItem.genreGroup || 'other';
        return firstGenre !== 'other' && firstGenre === secondGenre;
    }

    function hasQueueConflict(firstItem, secondItem) {
        return hasArtistOverlap(firstItem, secondItem) || hasGenreConflict(firstItem, secondItem);
    }

    function stationById(id) {
        var stations = state.source && state.source.stations ? state.source.stations : [];
        for (var stationIndex = 0; stationIndex < stations.length; stationIndex++) {
            if (stations[stationIndex].id === id) return stations[stationIndex];
        }
        return stations[0] || null;
    }

    function getCandidates(slot) {
        if (!state.source || !state.source.pools) return [];
        if (slot === 'interview') return state.source.pools.interviews || [];
        var songs = state.source.pools.songs || {};
        return songs[slot] || songs.all || [];
    }

    function isPlayableCandidate(item, station, usedVideoIds) {
        if (!item || !item.videoId || state.failedVideoIds[item.videoId]) return false;
        if (usedVideoIds[item.videoId]) return false;
        if (station.type === 'music-only' && item.kind !== 'song') return false;
        if (item.kind === 'song' && station.chartGenreFilter === 'alt' && !item.matchesChartAlt) return false;
        if (item.kind === 'song' && Array.isArray(station.allowedGenreGroups) && station.allowedGenreGroups.length) {
            if (station.allowedGenreGroups.indexOf(item.genreGroup || 'other') === -1) return false;
        }
        if (item.kind === 'song' && Array.isArray(station.blockedGenreGroups) && station.blockedGenreGroups.length) {
            if (station.blockedGenreGroups.indexOf(item.genreGroup || 'other') !== -1) return false;
        }
        return true;
    }

    function filterCandidates(pool, station, usedVideoIds, recentArtistKeys, recentGenreGroups, requireArtistBreak, requireGenreBreak) {
        return pool.filter(function (item) {
            if (!isPlayableCandidate(item, station, usedVideoIds)) return false;
            if (requireArtistBreak && hasRecentArtist(recentArtistKeys, item)) return false;
            if (requireGenreBreak && hasRecentGenre(recentGenreGroups, item)) return false;
            return true;
        });
    }

    function chooseCandidate(candidates, slot, rng, station) {
        if (!candidates.length) return null;
        var configuredWindow = station.pickWindow || 160;
        var windowSize = Math.min(candidates.length, slot === 'interview' ? 36 : configuredWindow);
        var wideWindowSize = Math.min(candidates.length, Math.max(windowSize, Math.floor(configuredWindow * 1.5)));
        var reach = rng() < 0.72 ? windowSize : wideWindowSize;
        return candidates[Math.floor(rng() * reach)];
    }

    function rememberPickedItem(picked, slot, usedVideoIds, recentArtistKeys, recentGenreGroups, station) {
        usedVideoIds[picked.videoId] = true;

        var artistKeys = getItemArtistKeys(picked);
        for (var artistIndex = 0; artistIndex < artistKeys.length; artistIndex++) {
            recentArtistKeys.push(artistKeys[artistIndex]);
        }
        while (recentArtistKeys.length > (station.maxRecentArtistWindow || 8)) recentArtistKeys.shift();

        if (picked.genreGroup && picked.genreGroup !== 'other') recentGenreGroups.push(picked.genreGroup);
        while (recentGenreGroups.length > (station.maxRecentGenreWindow || 3)) recentGenreGroups.shift();

        var copy = {};
        for (var itemKey in picked) copy[itemKey] = picked[itemKey];
        copy.slot = slot;
        copy.programId = slot + '-' + picked.videoId + '-' + Object.keys(usedVideoIds).length;
        return copy;
    }

    function pickItem(slot, rng, recentArtistKeys, recentGenreGroups, usedVideoIds, station) {
        var pool = getCandidates(slot);
        if (!pool.length && slot !== 'all' && slot !== 'interview') pool = getCandidates('all');
        if (!pool.length) return null;

        var strategies = [
            { artistBreak: true, genreBreak: true },
            { artistBreak: true, genreBreak: false },
            { artistBreak: false, genreBreak: true },
            { artistBreak: false, genreBreak: false }
        ];

        for (var strategyIndex = 0; strategyIndex < strategies.length; strategyIndex++) {
            var strategy = strategies[strategyIndex];
            var candidates = filterCandidates(pool, station, usedVideoIds, recentArtistKeys, recentGenreGroups, strategy.artistBreak, strategy.genreBreak);
            var picked = chooseCandidate(candidates, slot, rng, station);
            if (picked) return rememberPickedItem(picked, slot, usedVideoIds, recentArtistKeys, recentGenreGroups, station);
        }

        return null;
    }

    function canSwapInto(queue, targetIndex, swapIndex) {
        var targetItem = queue[targetIndex];
        var swapItem = queue[swapIndex];
        var beforeTarget = queue[targetIndex - 1] || null;
        var afterTarget = queue[targetIndex + 1] || null;
        var beforeSwap = queue[swapIndex - 1] || null;
        var afterSwap = queue[swapIndex + 1] || null;

        if (beforeTarget && hasQueueConflict(beforeTarget, swapItem)) return false;
        if (afterTarget && afterTarget !== swapItem && hasQueueConflict(swapItem, afterTarget)) return false;
        if (beforeSwap && beforeSwap !== targetItem && hasQueueConflict(beforeSwap, targetItem)) return false;
        if (afterSwap && hasQueueConflict(targetItem, afterSwap)) return false;
        return true;
    }

    function rebalanceQueue(queue) {
        var balanced = queue.slice();
        for (var queueIndex = 1; queueIndex < balanced.length; queueIndex++) {
            if (!hasQueueConflict(balanced[queueIndex - 1], balanced[queueIndex])) continue;
            for (var swapIndex = queueIndex + 1; swapIndex < balanced.length; swapIndex++) {
                if (!canSwapInto(balanced, queueIndex, swapIndex)) continue;
                var original = balanced[queueIndex];
                balanced[queueIndex] = balanced[swapIndex];
                balanced[swapIndex] = original;
                break;
            }
        }
        return balanced;
    }

    function buildQueue(stationId) {
        var station = stationById(stationId);
        if (!station) return [];

        var rng = makeRng(stationId);
        var queue = [];
        var usedVideoIds = {};
        var recentArtistKeys = [];
        var recentGenreGroups = [];
        var patterns = station.blockPatterns || [];
        var target = station.targetQueueItems || 72;
        var guard = 0;

        while (queue.length < target && guard < target * 5) {
            guard++;
            var pattern = patterns[Math.floor(rng() * patterns.length)] || { slots: ['current', 'catalog'] };
            var slots = pattern.slots || [];
            for (var slotIndex = 0; slotIndex < slots.length && queue.length < target; slotIndex++) {
                var item = pickItem(slots[slotIndex], rng, recentArtistKeys, recentGenreGroups, usedVideoIds, station);
                if (item) queue.push(item);
            }
        }

        return rebalanceQueue(queue);
    }

    function appendQueueCycle() {
        state.stationCycle++;
        var nextQueue = buildQueue(state.stationId);
        if (!nextQueue.length && Object.keys(state.failedVideoIds).length) {
            state.failedVideoIds = {};
            nextQueue = buildQueue(state.stationId);
        }
        if (nextQueue.length) state.queue = state.queue.concat(nextQueue);
        return nextQueue.length;
    }

    function ensureQueueDepth() {
        var guard = 0;
        while (state.queueIndex + QUEUE_LOOKAHEAD + 1 >= state.queue.length && guard < 4) {
            if (!appendQueueCycle()) break;
            guard++;
        }
    }

    function restorePlaybackState() {
        var saved = readPlaybackState();
        if (!saved || saved.dateKey !== localDateKey() || !stationById(saved.stationId)) return false;

        state.stationId = saved.stationId;
        state.stationCycle = 0;
        state.queue = buildQueue(state.stationId);
        state.queueIndex = 0;

        var savedIndex = Math.max(0, Number(saved.queueIndex) || 0);
        var growGuard = 0;
        while (state.queue.length <= savedIndex + QUEUE_LOOKAHEAD && growGuard < 12) {
            if (!appendQueueCycle()) break;
            growGuard++;
        }

        var matchedIndex = -1;
        if (saved.videoId) {
            var bestDistance = Infinity;
            for (var queueIndex = 0; queueIndex < state.queue.length; queueIndex++) {
                if (!state.queue[queueIndex] || state.queue[queueIndex].videoId !== saved.videoId) continue;
                var distance = Math.abs(queueIndex - savedIndex);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    matchedIndex = queueIndex;
                }
            }
        }
        if (matchedIndex === -1 && state.queue[savedIndex]) matchedIndex = savedIndex;
        if (matchedIndex === -1) return false;

        var matchedItem = state.queue[matchedIndex];
        var matchedSavedVideo = matchedItem && saved.videoId && matchedItem.videoId === saved.videoId;
        state.queueIndex = matchedIndex;
        state.resumeVideoId = matchedSavedVideo ? matchedItem.videoId : null;
        state.resumeStartSeconds = matchedSavedVideo ? Math.max(0, Number(saved.currentTime) || 0) : 0;
        state.resumeAutoplay = !!saved.wasPlaying;
        ensureQueueDepth();
        return true;
    }

    function formatViewsText(value) {
        var numberValue = Number(value || 0);
        if (numberValue >= 1000000000) return (numberValue / 1000000000).toFixed(1) + 'B';
        if (numberValue >= 1000000) return (numberValue / 1000000).toFixed(1) + 'M';
        if (numberValue >= 1000) return (numberValue / 1000).toFixed(1) + 'K';
        return String(numberValue);
    }

    function formatViewsHtml(value) {
        if (typeof window.formatCompactCountHtml === 'function') return window.formatCompactCountHtml(value);
        return html(formatViewsText(value));
    }

    function getDurationSeconds(item) {
        if (!item) return 0;
        var knownDuration = state.durationByVideoId[item.videoId];
        return knownDuration || item.durationSeconds || item.estimatedDurationSeconds || 0;
    }

    function formatDuration(item) {
        var seconds = Math.max(0, Math.round(getDurationSeconds(item)));
        if (!seconds) return '0:00';
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var remainingSeconds = String(seconds % 60).padStart(2, '0');
        if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + remainingSeconds;
        return minutes + ':' + remainingSeconds;
    }

    function itemTypeLabel(item) {
        if (!item) return '';
        if (item.kind === 'interview') return txt('radio.typeInterview', 'Интервју');
        if (item.slot === 'recent' || item.isNew) return txt('radio.typeNew', 'Ново');
        if (item.releaseType === 'album') return txt('radio.typeAlbum', 'Албум');
        if (item.releaseType === 'compilation') return txt('radio.typeCompilation', 'Компилација');
        if (item.releaseType === 'ep') return txt('radio.typeEp', 'EP');
        return txt('radio.typeSingle', 'Сингл');
    }

    function renderStationButtons() {
        var buttons = document.querySelectorAll('[data-radio-station]');
        for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
            var active = buttons[buttonIndex].getAttribute('data-radio-station') === state.stationId;
            buttons[buttonIndex].classList.toggle('active', active);
            buttons[buttonIndex].setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    }

    function renderNowNext() {
        if (!els.now || !els.queue) return;
        ensureQueueDepth();
        var item = state.queue[state.queueIndex];
        if (!item) {
            els.now.innerHTML = '<div class="radio-empty">' + html(txt('radio.empty', 'Нема програма')) + '</div>';
            els.queue.innerHTML = '';
            return;
        }

        var thumb = item.thumbnail ? '<img src="' + html(item.thumbnail) + '" alt="" loading="lazy">' : '<div class="radio-thumb-fallback"><i class="fas fa-music"></i></div>';
        var artist = item.artist || item.source || '';
        var artistHtml = artist ? '<div class="radio-now-artist">' + html(localText(artist)) + '</div>' : '';
        var metaHtml = [];
        if (item.kind === 'song' && item.youtubeViews) {
            metaHtml.push('<span class="radio-meta-chip radio-meta-chip-views"><i class="fas fa-chart-column"></i>' + formatViewsHtml(item.youtubeViews) + '</span>');
        }
        if (item.kind === 'interview' && item.source) {
            metaHtml.push('<span class="radio-meta-chip radio-meta-chip-source"><i class="fas fa-microphone-lines"></i><span>' + html(item.source) + '</span></span>');
        }
        metaHtml.push('<span class="radio-meta-chip radio-meta-chip-duration"><i class="fas fa-clock"></i><span>' + html(formatDuration(item)) + '</span></span>');

        els.now.innerHTML =
            '<div class="radio-now-thumb">' + thumb + '</div>' +
            '<div class="radio-now-copy">' +
                '<div class="radio-kicker">' + html(itemTypeLabel(item)) + '</div>' +
                '<h2>' + html(localText(item.title || item.releaseTitle || '')) + '</h2>' +
                artistHtml +
                '<div class="radio-now-meta">' + metaHtml.join('') + '</div>' +
            '</div>';

        var upcoming = state.queue.slice(state.queueIndex + 1, state.queueIndex + 1 + QUEUE_LOOKAHEAD);
        els.queue.innerHTML = upcoming.map(function (next, upcomingIndex) {
            var nextArtist = next.artist || next.source || '';
            var nextThumb = next.thumbnail ? '<span class="radio-queue-thumb"><img src="' + html(next.thumbnail) + '" alt="" loading="lazy"></span>' : '<span class="radio-queue-thumb fallback"><i class="fas fa-music"></i></span>';
            return '<li>' +
                '<span class="radio-queue-num">' + (upcomingIndex + 1) + '</span>' +
                nextThumb +
                '<span class="radio-queue-main"><strong>' + html(localText(next.title || next.releaseTitle || '')) + '</strong><em>' + html(localText(nextArtist)) + '</em></span>' +
                '<span class="radio-queue-duration">' + html(formatDuration(next)) + '</span>' +
                '<span class="radio-queue-kind">' + html(itemTypeLabel(next)) + '</span>' +
            '</li>';
        }).join('');
    }

    function setStatus(message, mode) {
        if (!els.status) return;
        els.status.textContent = message || '';
        els.status.setAttribute('data-radio-status', mode || 'idle');
    }

    function updatePlayButton() {
        if (!els.playButton) return;
        var label = state.isPlaying ? txt('radio.pause', 'Пауза') : txt('radio.play', 'Пушти');
        var icon = state.isPlaying ? 'fa-pause' : 'fa-play';
        els.playButton.innerHTML = '<i class="fas ' + icon + '"></i><span>' + html(label) + '</span>';
        els.playButton.setAttribute('aria-label', label);
    }

    function getLayer(playerKey) {
        return document.querySelector('[data-radio-player-layer="' + playerKey + '"]');
    }

    function setLayerRoles() {
        var layers = document.querySelectorAll('[data-radio-player-layer]');
        for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
            var layer = layers[layerIndex];
            var playerKey = layer.getAttribute('data-radio-player-layer');
            layer.classList.remove('active', 'standby', 'mixing-in', 'mixing-out');
            layer.classList.add(playerKey === state.activePlayerKey ? 'active' : 'standby');
        }
    }

    function activePlayer() {
        return state.players[state.activePlayerKey];
    }

    function standbyPlayer() {
        return state.players[state.standbyPlayerKey];
    }

    function loadYouTubeApi() {
        if (window.YT && window.YT.Player) {
            state.apiReady = true;
            createPlayers();
            return;
        }
        if (document.getElementById('youtube-iframe-api')) return;
        var previousReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () {
            state.apiReady = true;
            if (typeof previousReady === 'function') previousReady();
            createPlayers();
        };
        var tag = document.createElement('script');
        tag.id = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
    }

    function createPlayers() {
        if (!state.apiReady || !window.YT || !window.YT.Player) return;
        createPlayer('a', 'radio-youtube-player-a');
        createPlayer('b', 'radio-youtube-player-b');
    }

    function createPlayer(playerKey, elementId) {
        if (state.players[playerKey]) return;
        state.players[playerKey] = new window.YT.Player(elementId, {
            width: '100%',
            height: '100%',
            playerVars: {
                playsinline: 1,
                rel: 0,
                origin: window.location.origin
            },
            events: {
                onReady: function () {
                    state.playerReady[playerKey] = true;
                    var shell = document.querySelector('.radio-player-shell');
                    if (shell) shell.classList.add('player-ready');
                    if (state.pendingAutoplay && playerKey === state.activePlayerKey) loadCurrent(true);
                    if (state.isPlaying) prepareNext();
                },
                onStateChange: function (event) {
                    onPlayerStateChange(playerKey, event);
                },
                onError: function () {
                    onPlayerError(playerKey);
                }
            }
        });
    }

    function playerItem(playerKey) {
        if (playerKey === state.activePlayerKey) return state.queue[state.queueIndex];
        if (state.preparedIndex != null) return state.queue[state.preparedIndex];
        return null;
    }

    function rememberDurationFromPlayer(playerKey) {
        var player = state.players[playerKey];
        var item = playerItem(playerKey);
        if (!player || !item || typeof player.getDuration !== 'function') return;
        var duration = Math.round(Number(player.getDuration()) || 0);
        if (duration <= 0 || state.durationByVideoId[item.videoId] === duration) return;
        state.durationByVideoId[item.videoId] = duration;
        item.durationSeconds = duration;
        item.durationConfidence = 'known';
        renderNowNext();
    }

    function onPlayerStateChange(playerKey, event) {
        if (!window.YT || !window.YT.PlayerState) return;
        rememberDurationFromPlayer(playerKey);

        if (event.data === window.YT.PlayerState.ENDED && playerKey === state.activePlayerKey && !state.isTransitioning) {
            advanceProgram();
            return;
        }

        if (event.data === window.YT.PlayerState.PLAYING) {
            if (playerKey === state.activePlayerKey || state.isTransitioning) {
                state.isPlaying = true;
                setStatus(txt('radio.onAir', 'Во етер'), 'on-air');
                updatePlayButton();
                startProgressTimer();
                prepareNext();
            }
        }

        if (event.data === window.YT.PlayerState.PAUSED && playerKey === state.activePlayerKey && !state.isTransitioning) {
            state.isPlaying = false;
            stopProgressTimer();
            writePlaybackState(false);
            setStatus(txt('radio.paused', 'Пауза'), 'paused');
            updatePlayButton();
        }
    }

    function onPlayerError(playerKey) {
        var failedIndex = playerKey === state.activePlayerKey ? state.queueIndex : state.preparedIndex;
        var failedItem = failedIndex == null ? null : state.queue[failedIndex];
        if (failedItem && failedItem.videoId) state.failedVideoIds[failedItem.videoId] = true;

        if (playerKey !== state.activePlayerKey && failedIndex > state.queueIndex) {
            state.queue.splice(failedIndex, 1);
            state.preparedIndex = null;
            renderNowNext();
            prepareNext();
            return;
        }

        advanceProgram(true);
    }

    function stopProgressTimer() {
        if (state.progressTimer) window.clearInterval(state.progressTimer);
        state.progressTimer = null;
    }

    function startProgressTimer() {
        if (state.progressTimer) return;
        state.progressTimer = window.setInterval(function () {
            if (!state.isPlaying || state.isTransitioning) return;
            var player = activePlayer();
            if (!player || typeof player.getDuration !== 'function' || typeof player.getCurrentTime !== 'function') return;
            rememberDurationFromPlayer(state.activePlayerKey);
            prepareNext();
            var duration = Number(player.getDuration()) || 0;
            var currentTime = Number(player.getCurrentTime()) || 0;
            if (Date.now() - state.lastPlaybackSaveAt >= STORAGE_SAVE_INTERVAL_MS) writePlaybackState(true);
            if (duration > 0 && currentTime > 1 && duration - currentTime <= CROSSFADE_SECONDS) {
                beginSeamlessTransition();
            }
        }, PROGRESS_INTERVAL_MS);
    }

    function prepareNext() {
        if (!state.isPlaying || state.isTransitioning) return;
        ensureQueueDepth();
        var nextIndex = state.queueIndex + 1;
        var nextItem = state.queue[nextIndex];
        var player = standbyPlayer();
        if (!nextItem || !player || !state.playerReady[state.standbyPlayerKey]) return;
        if (state.preparedIndex === nextIndex) {
            rememberDurationFromPlayer(state.standbyPlayerKey);
            return;
        }
        state.preparedIndex = nextIndex;
        try {
            if (typeof player.setVolume === 'function') player.setVolume(0);
            player.cueVideoById(nextItem.videoId);
            window.setTimeout(function () {
                rememberDurationFromPlayer(state.standbyPlayerKey);
            }, 650);
        } catch (error) {
            state.preparedIndex = null;
        }
    }

    function clearTransitionTimer() {
        if (state.transitionTimer) window.clearInterval(state.transitionTimer);
        state.transitionTimer = null;
    }

    function beginSeamlessTransition() {
        if (state.isTransitioning) return;
        var nextIndex = state.queueIndex + 1;
        var nextItem = state.queue[nextIndex];
        var oldKey = state.activePlayerKey;
        var nextKey = state.standbyPlayerKey;
        var oldPlayer = state.players[oldKey];
        var nextPlayer = state.players[nextKey];

        if (!nextItem || !nextPlayer || !state.playerReady[nextKey] || state.preparedIndex !== nextIndex) {
            return;
        }

        state.isTransitioning = true;
        stopProgressTimer();

        var oldLayer = getLayer(oldKey);
        var nextLayer = getLayer(nextKey);
        if (oldLayer) oldLayer.classList.add('mixing-out');
        if (nextLayer) {
            nextLayer.classList.remove('standby');
            nextLayer.classList.add('mixing-in');
        }

        try {
            if (typeof nextPlayer.setVolume === 'function') nextPlayer.setVolume(0);
            nextPlayer.playVideo();
        } catch (error) {
            state.isTransitioning = false;
            advanceProgram(true);
            return;
        }

        var fadeStep = 0;
        clearTransitionTimer();
        state.transitionTimer = window.setInterval(function () {
            fadeStep++;
            var ratio = Math.min(1, fadeStep / FADE_STEPS);
            try {
                if (oldPlayer && typeof oldPlayer.setVolume === 'function') oldPlayer.setVolume(Math.max(0, Math.round(100 * (1 - ratio))));
                if (nextPlayer && typeof nextPlayer.setVolume === 'function') nextPlayer.setVolume(Math.min(100, Math.round(100 * ratio)));
            } catch (error) {
                clearTransitionTimer();
                completeTransition(oldKey, nextKey);
                return;
            }
            if (ratio >= 1) {
                clearTransitionTimer();
                completeTransition(oldKey, nextKey);
            }
        }, Math.max(80, Math.floor((CROSSFADE_SECONDS * 1000) / FADE_STEPS)));
    }

    function completeTransition(oldKey, nextKey) {
        var oldPlayer = state.players[oldKey];
        try {
            if (oldPlayer && typeof oldPlayer.stopVideo === 'function') oldPlayer.stopVideo();
            if (oldPlayer && typeof oldPlayer.setVolume === 'function') oldPlayer.setVolume(0);
            if (state.players[nextKey] && typeof state.players[nextKey].setVolume === 'function') state.players[nextKey].setVolume(100);
        } catch (error) {}

        state.queueIndex++;
        ensureQueueDepth();
        state.activePlayerKey = nextKey;
        state.standbyPlayerKey = oldKey;
        state.preparedIndex = null;
        state.loadedIndex = state.queueIndex;
        state.isTransitioning = false;
        state.isPlaying = true;
        setLayerRoles();
        renderNowNext();
        writePlaybackState(true);
        setStatus(txt('radio.onAir', 'Во етер'), 'on-air');
        updatePlayButton();
        prepareNext();
        startProgressTimer();
    }

    function consumeResumeStartSeconds(item) {
        if (!item || !state.resumeVideoId || item.videoId !== state.resumeVideoId) return 0;
        var seconds = Math.max(0, Number(state.resumeStartSeconds) || 0);
        state.resumeStartSeconds = 0;
        state.resumeVideoId = null;
        state.resumeAutoplay = false;
        return seconds;
    }

    function loadCurrent(autoplay) {
        var item = state.queue[state.queueIndex];
        if (!item) return;
        renderNowNext();
        state.pendingAutoplay = !!autoplay;
        loadYouTubeApi();
        var player = activePlayer();
        if (!player || !state.playerReady[state.activePlayerKey]) return;
        clearTransitionTimer();
        state.isTransitioning = false;
        setLayerRoles();
        state.preparedIndex = null;
        try {
            var startSeconds = consumeResumeStartSeconds(item);
            var videoRequest = startSeconds > 0 ? { videoId: item.videoId, startSeconds: startSeconds } : item.videoId;
            if (typeof player.setVolume === 'function') player.setVolume(100);
            if (autoplay) player.loadVideoById(videoRequest);
            else player.cueVideoById(videoRequest);
        } catch (error) {
            onPlayerError(state.activePlayerKey);
            return;
        }
        state.loadedIndex = state.queueIndex;
        if (autoplay) {
            state.isPlaying = true;
            setStatus(txt('radio.onAir', 'Во етер'), 'on-air');
            window.setTimeout(prepareNext, 500);
        }
        updatePlayButton();
    }

    function advanceProgram(fromError) {
        if (!state.queue.length || state.isTransitioning) return;
        stopProgressTimer();
        state.queueIndex++;
        if (state.queueIndex >= state.queue.length) {
            ensureQueueDepth();
            if (state.queueIndex >= state.queue.length) appendQueueCycle();
            if (state.queueIndex >= state.queue.length) {
                setStatus(txt('radio.error', 'Радиото не е достапно'), 'error');
                return;
            }
        }
        state.preparedIndex = null;
        if (fromError) setStatus(txt('radio.recovering', 'Се вчитува следната ставка'), 'loading');
        loadCurrent(true);
    }

    function startPlayback() {
        if (!state.queue.length) return;
        loadYouTubeApi();
        var player = activePlayer();
        if (player && state.playerReady[state.activePlayerKey] && state.loadedIndex === state.queueIndex && typeof player.playVideo === 'function') {
            try {
                player.playVideo();
                return;
            } catch (error) {}
        }
        loadCurrent(true);
    }

    function pausePlayback() {
        clearTransitionTimer();
        stopProgressTimer();
        state.isTransitioning = false;
        try {
            if (state.players.a && state.players.a.pauseVideo) state.players.a.pauseVideo();
            if (state.players.b && state.players.b.pauseVideo) state.players.b.pauseVideo();
        } catch (error) {}
        state.isPlaying = false;
        setLayerRoles();
        writePlaybackState(false);
        setStatus(txt('radio.paused', 'Пауза'), 'paused');
        updatePlayButton();
    }

    function selectStation(stationId) {
        if (state.stationId === stationId) return;
        var wasPlaying = state.isPlaying;
        pausePlayback();
        state.stationId = stationId;
        state.stationCycle = 0;
        state.queue = buildQueue(stationId);
        state.queueIndex = 0;
        state.loadedIndex = null;
        state.preparedIndex = null;
        state.resumeStartSeconds = 0;
        state.resumeVideoId = null;
        state.resumeAutoplay = false;
        renderStationButtons();
        renderNowNext();
        setStatus(txt('radio.ready', 'Подготвено'), 'ready');
        writePlaybackState(false);
        if (wasPlaying) loadCurrent(true);
    }

    function bindEvents() {
        var buttons = document.querySelectorAll('[data-radio-station]');
        for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
            buttons[buttonIndex].addEventListener('click', function () {
                selectStation(this.getAttribute('data-radio-station'));
            });
        }
        if (els.playButton) {
            els.playButton.addEventListener('click', function () {
                if (state.isPlaying) pausePlayback();
                else startPlayback();
            });
        }
        window.addEventListener('pagehide', function () {
            writePlaybackState(state.isPlaying);
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') writePlaybackState(state.isPlaying);
        });
    }

    function renderSourceMeta() {
        if (!els.date || !state.source) return;
        els.date.textContent = state.source.validForDate || localDateKey();
    }

    function initFromSource(source) {
        state.source = source;
        state.stationId = stationById(DEFAULT_STATION_ID) ? DEFAULT_STATION_ID : (source.stations[0] && source.stations[0].id);
        state.stationCycle = 0;
        state.queue = buildQueue(state.stationId);
        state.queueIndex = 0;
        restorePlaybackState();
        renderSourceMeta();
        renderStationButtons();
        renderNowNext();
        setLayerRoles();
        setStatus(txt('radio.ready', 'Подготвено'), 'ready');
        updatePlayButton();
        if (state.resumeAutoplay) loadCurrent(true);
    }

    function loadSource() {
        setStatus(txt('radio.loading', 'Се вчитува...'), 'loading');
        fetch('/radio-source.json?t=' + Date.now())
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(initFromSource)
            .catch(function () {
                setStatus(txt('radio.error', 'Радиото не е достапно'), 'error');
                if (els.now) els.now.innerHTML = '<div class="radio-empty">' + html(txt('radio.error', 'Радиото не е достапно')) + '</div>';
            });
    }

    function init() {
        els.playButton = document.getElementById('radio-play-toggle');
        els.now = document.getElementById('radio-now');
        els.queue = document.getElementById('radio-next-list');
        els.status = document.getElementById('radio-status');
        els.date = document.getElementById('radio-date');
        bindEvents();
        loadSource();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();