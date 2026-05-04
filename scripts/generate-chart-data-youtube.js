/**
 * YouTube Popularity Calculator
 * 
 * Runs AFTER generate-chart-data.js. Reads releases.json (release catalog) and
 * chart-data.json (weekly views), looks up YouTube views for each release's tracks,
 * and computes a popularity score (0–100) based on the week-over-week view increase.
 * 
 * Strategy:
 *   1. Use YouTube channels from bands.json to fetch each artist's uploaded videos
 *      (supports multiple channels per artist — links.youtube can be a string or array)
 *   2. For each release, fuzzy-match ALL its tracks to YouTube videos across all channels
 *   3. Sum YouTube views across all tracks in a release (if same song on multiple channels, sum views)
 *   4. Load last week's chart-history to get previous youtubeViews
 *      (if no YT history exists, approximate from Spotify historical popularity)
 *   5. popularity = normalize(thisWeekViews - lastWeekViews) → 0–100
 *   6. Update releases.json with youtube track matches (preserving verified links)
 *   7. Update chart-data.json with new popularity values and youtubeViews
 * 
 * Run locally: node scripts/generate-chart-data-youtube.js
 * 
 * Prerequisites:
 *   - releases.json and chart-data.json must exist (run generate-chart-data.js first)
 *   - config/credentials/youtube-credentials.json with your YouTube Data API v3 key
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const EDITABLE_DATA_DIR = path.join(ROOT, 'data', 'dynamic', 'editable');
const GENERATED_DATA_DIR = path.join(ROOT, 'data', 'dynamic', 'generated');
const YT_BATCH_SIZE = 50;
const API_DELAY_MS = 100;
const API_RETRY_DELAY_MS = 1000;
const API_MAX_RETRIES = 3;
const CACHE_FILE = path.join(ROOT, '.cache', 'youtube-id-cache.json');
const BANDS_FILE = path.join(EDITABLE_DATA_DIR, 'bands.json');
const RELEASES_FILE = path.join(EDITABLE_DATA_DIR, 'releases.json');
const CHART_DATA = path.join(GENERATED_DATA_DIR, 'chart-data.json');
const HISTORY_DIR = path.join(GENERATED_DATA_DIR, 'chart-history');

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let quotaUsed = 0;

function loadCache() {
    try {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (!data.channels) data.channels = {};
        if (!data.tracks) data.tracks = {};       // releaseId -> [{ trackName, videoIds: [vid1, ...] }]
        if (!data.channelVideos) data.channelVideos = {}; // channelId -> [{ videoId, title }]
        if (!data.globalChannels) data.globalChannels = {}; // url -> channelId
        // Migrate old single-channel cache entries to arrays
        for (const [key, val] of Object.entries(data.channels)) {
            if (typeof val === 'string') data.channels[key] = [val];
        }
        // Migrate old track cache entries from single videoId to videoIds array
        for (const [relId, tracks] of Object.entries(data.tracks)) {
            for (const t of tracks) {
                if ('videoId' in t && !('videoIds' in t)) {
                    t.videoIds = t.videoId ? [t.videoId] : [];
                    delete t.videoId;
                }
            }
        }
        return data;
    } catch {
        return { channels: {}, tracks: {}, channelVideos: {}, globalChannels: {} };
    }
}

function saveCache(cache) {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function getYouTubeApiKey() {
    if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
    try {
        const credPath = path.join(ROOT, 'config', 'credentials', 'youtube-credentials.json');
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (creds.apiKey && creds.apiKey !== 'YOUR_YOUTUBE_DATA_API_V3_KEY_HERE') return creds.apiKey;
    } catch { /* ignore */ }
    return null;
}

async function ytApi(endpoint, params, apiKey) {
    const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;
    for (let attempt = 1; attempt <= API_MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url);
            quotaUsed++;
            if (!res.ok) {
                const text = await res.text();
                const isRetryable = res.status === 429 || res.status >= 500;
                if (isRetryable && attempt < API_MAX_RETRIES) {
                    const waitMs = API_RETRY_DELAY_MS * attempt;
                    console.warn(`  YT API retry ${attempt}/${API_MAX_RETRIES} on ${endpoint}: ${res.status}; waiting ${waitMs}ms`);
                    await sleep(waitMs);
                    continue;
                }
                console.error(`  YT API error ${res.status} on ${endpoint}: ${text.slice(0, 200)}`);
                return null;
            }
            return res.json();
        } catch (error) {
            if (attempt >= API_MAX_RETRIES) {
                console.error(`  YT API network error on ${endpoint} after ${API_MAX_RETRIES} retries: ${error.code || error.message}`);
                return null;
            }
            const waitMs = API_RETRY_DELAY_MS * attempt;
            console.warn(`  YT API retry ${attempt}/${API_MAX_RETRIES} on ${endpoint}: ${error.code || error.message}; waiting ${waitMs}ms`);
            await sleep(waitMs);
        }
    }
    return null;
}

// ── Channel resolution ──────────────────────────────────────────────────────

function parseYouTubeLink(url) {
    if (!url) return null;
    let m;
    m = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (m) return { type: 'channelId', value: m[1] };
    m = url.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/);
    if (m) return { type: 'handle', value: m[1] };
    m = url.match(/youtube\.com\/user\/([a-zA-Z0-9._-]+)/);
    if (m) return { type: 'username', value: m[1] };
    m = url.match(/youtube\.com\/c\/([a-zA-Z0-9._-]+)/);
    if (m) return { type: 'customUrl', value: m[1] };
    m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return { type: 'videoId', value: m[1] };
    m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m) return { type: 'videoId', value: m[1] };
    m = url.match(/youtube\.com\/([a-zA-Z0-9._-]{3,})\/?$/);
    if (m && !['watch', 'playlist', 'channel', 'user', 'c', 'feed', 'results'].includes(m[1]))
        return { type: 'customUrl', value: m[1] };
    return null;
}

async function resolveHandle(handle, apiKey) {
    const data = await ytApi('channels', { part: 'id', forHandle: handle }, apiKey);
    return data?.items?.[0]?.id || null;
}

async function resolveUsername(username, apiKey) {
    const data = await ytApi('channels', { part: 'id', forUsername: username }, apiKey);
    return data?.items?.[0]?.id || null;
}

async function resolveVideoChannels(videoIds, apiKey) {
    const result = new Map();
    for (let i = 0; i < videoIds.length; i += YT_BATCH_SIZE) {
        const batch = videoIds.slice(i, i + YT_BATCH_SIZE);
        const data = await ytApi('videos', { part: 'snippet', id: batch.join(',') }, apiKey);
        if (data?.items) for (const item of data.items) result.set(item.id, item.snippet.channelId);
        if (i + YT_BATCH_SIZE < videoIds.length) await sleep(API_DELAY_MS);
    }
    return result;
}

async function resolveCustomUrl(name, apiKey) {
    let id = await resolveHandle(name, apiKey);
    if (id) return id;
    await sleep(API_DELAY_MS);
    return await resolveUsername(name, apiKey);
}

// ── Fetch channel uploads ───────────────────────────────────────────────────

async function getChannelVideos(channelId, apiKey, cache) {
    // Return cached channel videos if available (refreshed each run for view counts, but titles are stable)
    if (cache.channelVideos[channelId]) return cache.channelVideos[channelId];

    const uploadsPlaylistId = 'UU' + channelId.slice(2);
    const videos = [];
    let pageToken = '';

    do {
        const params = { part: 'snippet', playlistId: uploadsPlaylistId, maxResults: '50' };
        if (pageToken) params.pageToken = pageToken;
        const data = await ytApi('playlistItems', params, apiKey);
        if (!data?.items) break;
        for (const item of data.items) {
            const s = item.snippet;
            if (s.resourceId?.kind === 'youtube#video') {
                videos.push({ videoId: s.resourceId.videoId, title: s.title });
            }
        }
        pageToken = data.nextPageToken || '';
        if (pageToken) await sleep(API_DELAY_MS);
    } while (pageToken);

    cache.channelVideos[channelId] = videos;
    return videos;
}

// ── Fuzzy matching ──────────────────────────────────────────────────────────

function normalize(s) {
    return (s || '')
        .toLowerCase()
        .replace(/\(official\s*(music\s*)?video\)/gi, '')
        .replace(/\(official\s*audio\)/gi, '')
        .replace(/\(lyric\s*video\)/gi, '')
        .replace(/\(visuali[sz]er\)/gi, '')
        .replace(/\[official.*?\]/gi, '')
        .replace(/official\s*(music\s*)?video/gi, '')
        .replace(/[\(\)\[\]「」『』""''«»]/g, '')
        .replace(/[^\p{L}\p{N}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Transliteration (Macedonian Cyrillic ↔ Latin) ───────────────────────────

const CYR_TO_LAT_MAP = {};
const MK_PAIRS = [
    ['ш', 'sh'], ['ч', 'ch'], ['ж', 'zh'], ['џ', 'dz'], ['љ', 'lj'], ['њ', 'nj'],
    ['ѓ', 'gj'], ['ќ', 'kj'], ['ѕ', 'dz'],
    ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'], ['е', 'e'], ['з', 'z'],
    ['и', 'i'], ['ј', 'j'], ['к', 'k'], ['л', 'l'], ['м', 'm'], ['н', 'n'], ['о', 'o'],
    ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'], ['ф', 'f'], ['х', 'h'], ['ц', 'c'],
    // Serbian extras
    ['ђ', 'dj'], ['ћ', 'c'],
    // Bulgarian/Russian common
    ['я', 'ya'], ['ю', 'yu'], ['щ', 'sht'], ['ъ', 'a'], ['ь', ''], ['э', 'e'], ['ы', 'i'], ['й', 'j'],
];
for (const [cyr, lat] of MK_PAIRS) CYR_TO_LAT_MAP[cyr] = lat;

/** Convert Cyrillic characters to Latin equivalents (pass-through for non-Cyrillic) */
function toLatin(s) {
    let result = '';
    for (const ch of s) result += CYR_TO_LAT_MAP[ch] || ch;
    return result;
}

/** Collapse digraphs: sh→s, ch→c, zh→z, etc. for looser matching */
function simplifyDigraphs(s) {
    return s
        .replace(/dzh/g, 'z').replace(/dz/g, 'z')
        .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/zh/g, 'z')
        .replace(/lj/g, 'l').replace(/nj/g, 'n')
        .replace(/gj/g, 'g').replace(/kj/g, 'k')
        .replace(/dj/g, 'd').replace(/sht/g, 'st');
}

/** Get matching variants: [original, latin, latin-simplified] */
function matchVariants(s) {
    const lat = toLatin(s);
    const simple = simplifyDigraphs(lat);
    return [s, lat, simple];
}

/** Levenshtein edit distance between two strings */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
        }
        prev = curr;
    }
    return prev[n];
}

/** Similarity ratio 0–1 based on Levenshtein distance */
function stringSimilarity(a, b) {
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
}

function matchScore(videoTitle, trackName, artistName, spotifyName) {
    const normVideo = normalize(videoTitle);
    const normTrack = normalize(trackName);
    const normArtist = normalize(artistName);
    const normSpotify = spotifyName ? normalize(spotifyName) : '';

    // Generate transliteration variants for cross-script matching
    const videoVars = matchVariants(normVideo);
    const trackVars = matchVariants(normTrack);
    const artistVars = matchVariants(normArtist);
    const spotifyVars = normSpotify ? matchVariants(normSpotify) : [];

    // Check: does any video variant contain any track variant?
    let trackFound = false;
    outer1: for (const vv of videoVars) {
        for (const tv of trackVars) {
            if (tv.length > 0 && vv.includes(tv)) { trackFound = true; break outer1; }
        }
    }

    if (trackFound) {
        // Check if artist name also found in video title
        let artistFound = false;
        outer2: for (const vv of videoVars) {
            for (const av of artistVars) {
                if (av.length > 0 && vv.includes(av)) { artistFound = true; break outer2; }
            }
            for (const sv of spotifyVars) {
                if (sv.length > 0 && vv.includes(sv)) { artistFound = true; break outer2; }
            }
        }
        return artistFound ? 1.0 : 0.9;
    }

    // Word overlap — try each variant pair, take the best score
    let bestWordScore = 0;
    for (let i = 0; i < videoVars.length; i++) {
        const videoWords = new Set(videoVars[i].split(' '));
        const trackWords = trackVars[i].split(' ').filter(w => w.length > 1);
        if (trackWords.length === 0) continue;
        const matched = trackWords.filter(w => videoWords.has(w));
        const overlap = matched.length / trackWords.length;
        let score = 0;
        if (overlap >= 0.7 && matched.length >= 2) score = 0.5 + overlap * 0.3;
        else if (trackWords.length === 1 && matched.length >= 1) score = 0.7;
        if (score > bestWordScore) bestWordScore = score;
    }

    if (bestWordScore >= 0.6) return bestWordScore;

    // Fuzzy match — useful when video title is just the song name with slight differences
    let bestFuzzy = 0;
    for (const vv of videoVars) {
        for (const tv of trackVars) {
            if (tv.length < 3) continue;
            const sim = stringSimilarity(vv, tv);
            if (sim > bestFuzzy) bestFuzzy = sim;
        }
    }
    if (bestFuzzy >= 0.85) return Math.max(bestWordScore, 0.8);
    if (bestFuzzy >= 0.75) return Math.max(bestWordScore, 0.65);

    return bestWordScore;
}

/** Match a single track to the best video from a channel's videos */
function findBestVideoForTrack(trackName, artistName, spotifyName, channelVideos) {
    let best = null, bestScore = 0;
    for (const video of channelVideos) {
        const score = matchScore(video.title, trackName, artistName, spotifyName);
        if (score > bestScore) { bestScore = score; best = video; }
    }
    return (bestScore >= 0.6 && best) ? { videoId: best.videoId, title: best.title, score: bestScore } : null;
}

/** For a release, match ALL its tracks to YouTube videos across all channels.
 *  For each track, find the best match on each channel's videos separately,
 *  collecting all unique videoIds (to sum views from multiple channels later).
 *  Returns array of { trackName, videoIds: [vid1, vid2, ...] } */
function matchReleaseTracks(release, allChannelVideos) {
    const trackNames = release.trackNames || [release.releaseTitle];
    const results = [];
    const globalUsedVideoIds = new Set();

    for (const trackName of trackNames) {
        const trackVideoIds = [];
        for (const channelVideos of allChannelVideos) {
            const match = findBestVideoForTrack(trackName, release.bandName, release.spotifyName, channelVideos);
            if (match && !globalUsedVideoIds.has(match.videoId)) {
                trackVideoIds.push(match.videoId);
                globalUsedVideoIds.add(match.videoId);
            }
        }
        results.push({ trackName, videoIds: trackVideoIds });
    }
    return results;
}

// ── Video statistics ────────────────────────────────────────────────────────

async function getVideoStatsBatch(videoIds, apiKey) {
    const results = new Map();
    for (let i = 0; i < videoIds.length; i += YT_BATCH_SIZE) {
        const batch = videoIds.slice(i, i + YT_BATCH_SIZE);
        const data = await ytApi('videos', { part: 'statistics,snippet', id: batch.join(',') }, apiKey);
        if (data?.items) {
            for (const item of data.items) {
                results.set(item.id, {
                    viewCount: parseInt(item.statistics.viewCount || '0', 10),
                    likeCount: parseInt(item.statistics.likeCount || '0', 10),
                    commentCount: parseInt(item.statistics.commentCount || '0', 10),
                    publishedAt: item.snippet?.publishedAt || null,
                });
            }
        }
        if (i + YT_BATCH_SIZE < videoIds.length) await sleep(API_DELAY_MS);
    }
    return results;
}

// ── Load archive week data ──────────────────────────────────────────────────

function loadRecentArchiveWeeks() {
    if (!fs.existsSync(HISTORY_DIR)) return { latest: null, previous: null, beforePrevious: null, all: [] };

    const files = fs.readdirSync(HISTORY_DIR)
        .filter(f => f.match(/^chart-\d{4}-W\d{2}\.json$/))
        .sort();

    if (files.length === 0) return { latest: null, previous: null, beforePrevious: null, all: [] };

    const loaded = [];
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'));
            loaded.push({
                fileName: file,
                weekId: file.replace('chart-', '').replace('.json', ''),
                releases: data.releases || [],
                generatedAt: data.generatedAt || null
            });
        } catch {
            // Ignore unreadable history files and continue with the rest.
        }
    }

    if (loaded.length === 0) return { latest: null, previous: null, beforePrevious: null, all: [] };

    const latest = loaded[loaded.length - 1] || null;
    const previous = loaded.length > 1 ? loaded[loaded.length - 2] : null;
    const beforePrevious = loaded.length > 2 ? loaded[loaded.length - 3] : null;

    if (latest) {
        console.log(`  Loaded latest archive: ${latest.fileName} (${latest.releases.length} releases)`);
    }
    if (previous) {
        console.log(`  Loaded previous archive: ${previous.fileName} (${previous.releases.length} releases)`);
    }

    return { latest, previous, beforePrevious, all: loaded };
}

function getChartMondayFromWeekId(weekId) {
    if (!weekId) return null;
    const match = weekId.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;

    const isoYear = parseInt(match[1], 10);
    const isoWeek = parseInt(match[2], 10);
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() + 1 - dow);

    const chartMonday = new Date(week1Monday);
    chartMonday.setUTCDate(week1Monday.getUTCDate() + 7 * (isoWeek - 1));
    return chartMonday;
}

function getISOWeekId(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function selectLiveArchiveWeeks(archiveWeeks, now = new Date()) {
    const latest = archiveWeeks.latest;
    const previous = archiveWeeks.previous;
    const beforePrevious = archiveWeeks.beforePrevious;
    const currentWeekId = getISOWeekId(now);
    const isCurrentMondayArchive = now.getDay() === 1 && latest?.weekId === currentWeekId && previous;

    if (isCurrentMondayArchive) {
        console.log(`  Current Monday archive ${latest.fileName} is today's snapshot — using ${previous.fileName} as live baseline`);
        return {
            deltaBaseline: previous,
            frozenDisplay: previous,
            frozenReference: beforePrevious,
            ignoredCurrent: latest,
            usingPreviousWeekForMonday: true
        };
    }

    return {
        deltaBaseline: latest,
        frozenDisplay: previous,
        frozenReference: beforePrevious,
        ignoredCurrent: null,
        usingPreviousWeekForMonday: false
    };
}

function parseReleaseDate(release) {
    const dateValue = release?.effectiveReleaseDate || release?.releaseDate;
    if (!dateValue) return null;
    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildArchiveReleaseMap(releases) {
    const releaseMap = new Map();
    for (const release of releases || []) {
        releaseMap.set(release.releaseId, release);
    }
    return releaseMap;
}

function computeArchiveViewsDelta(snapshotRelease, baselineRelease, baselineMonday, releaseById) {
    const snapshotViews = Number(snapshotRelease?.youtubeViews || 0);
    if (snapshotViews <= 0) return null;

    const releaseDate = parseReleaseDate(releaseById?.get(snapshotRelease.releaseId));
    if (releaseDate && baselineMonday && releaseDate >= baselineMonday) {
        return snapshotViews;
    }

    if (baselineRelease) {
        const baselineViews = Number(baselineRelease.youtubeViews || 0);
        if (baselineViews <= 0) return 0;
        return snapshotViews - baselineViews;
    }

    return null;
}

function applyFrozenChartState(chartReleases, frozenWeek, frozenBaselineWeek, releaseById) {
    const frozenMap = new Map();
    for (const release of frozenWeek?.releases || []) {
        frozenMap.set(release.releaseId, release);
    }
    const frozenBaselineMap = buildArchiveReleaseMap(frozenBaselineWeek?.releases || []);
    const frozenBaselineMonday = getChartMondayFromWeekId(frozenBaselineWeek?.weekId);

    let reusedCount = 0;
    for (const chartRelease of chartReleases) {
        const frozenRelease = frozenMap.get(chartRelease.releaseId);
        if (frozenRelease) {
            chartRelease.popularity = frozenRelease.popularity || 0;
            chartRelease.youtubeViews = frozenRelease.youtubeViews || 0;
            chartRelease.youtubeTrackCount = frozenRelease.youtubeTrackCount || 0;
            const storedDelta = Number(frozenRelease.viewsDelta);
            const computedDelta = Number.isFinite(storedDelta)
                ? storedDelta
                : computeArchiveViewsDelta(frozenRelease, frozenBaselineMap.get(frozenRelease.releaseId), frozenBaselineMonday, releaseById);
            chartRelease.viewsDelta = Number.isFinite(computedDelta) ? computedDelta : null;
            reusedCount++;
        } else {
            chartRelease.popularity = 0;
            chartRelease.youtubeViews = 0;
            chartRelease.youtubeTrackCount = 0;
            chartRelease.viewsDelta = null;
        }
    }

    return reusedCount;
}

const NEGATIVE_VIEWS_DELTA_ISSUE_CODE = 'negative-views-delta';
const NEGATIVE_VIEWS_DELTA_ISSUE_LABEL = 'ГРЕШКА';

function clearChartIssue(release) {
    if (!release) return;
    if (release.chartIssueCode === NEGATIVE_VIEWS_DELTA_ISSUE_CODE) {
        delete release.chartIssueCode;
        delete release.chartIssueLabel;
        delete release.chartIssueReason;
    }
}

function flagNegativeViewsDelta(release, baselineWeekId, currentViews, baselineViews) {
    if (!release) return;
    release.chartIssueCode = NEGATIVE_VIEWS_DELTA_ISSUE_CODE;
    release.chartIssueLabel = NEGATIVE_VIEWS_DELTA_ISSUE_LABEL;
    release.chartIssueReason = baselineWeekId
        ? `Негативен views delta (${currentViews} < ${baselineViews}) наспроти архивата ${baselineWeekId}`
        : `Негативен views delta (${currentViews} < ${baselineViews}) наспроти архивската недела`;
}

/** Check if archive week data has YouTube views (i.e., was generated with this script) */
function hasYouTubeHistory(archiveWeek) {
    if (!archiveWeek?.releases?.length) return false;
    return archiveWeek.releases.some(r => r.youtubeViews !== undefined && r.youtubeViews > 0);
}

// ── Popularity calculation ──────────────────────────────────────────────────

/**
 * Compute popularity normalized 0–100 based on week-over-week view delta.
 * Max delta is calculated separately for singles and albums so each category
 * has its own release at 100.
 * @param {Array} chartReleases - chart data entries with _viewDelta
 * @param {Map} typeMap - releaseId -> releaseType lookup
 */
function computePopularities(chartReleases, typeMap) {
    // Find max delta per release type
    const maxDeltas = { single: 0, album: 0 };
    for (const r of chartReleases) {
        const type = (typeMap.get(r.releaseId) || 'single') === 'album' ? 'album' : 'single';
        if (r._viewDelta > maxDeltas[type]) maxDeltas[type] = r._viewDelta;
    }

    for (const r of chartReleases) {
        const type = (typeMap.get(r.releaseId) || 'single') === 'album' ? 'album' : 'single';
        const maxDelta = maxDeltas[type];
        r.viewsDelta = Number.isFinite(r._viewDelta) ? r._viewDelta : null;
        r.popularity = (r._viewDelta > 0 && maxDelta > 0)
            ? Math.min(100, Math.round((r._viewDelta / maxDelta) * 100))
            : 0;
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== YouTube Popularity Calculator ===\n');

    // 1. Load releases.json (release catalog) and chart-data.json (weekly views)
    if (!fs.existsSync(RELEASES_FILE)) {
        console.error('releases.json not found. Run generate-chart-data.js first.');
        process.exit(1);
    }
    if (!fs.existsSync(CHART_DATA)) {
        console.error('chart-data.json not found. Run generate-chart-data.js first.');
        process.exit(1);
    }
    const releasesData = JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8'));
    const releases = releasesData.releases;
    const chartData = JSON.parse(fs.readFileSync(CHART_DATA, 'utf8'));
    const chartReleases = chartData.releases;
    const chartMap = new Map();
    for (const cr of chartReleases) chartMap.set(cr.releaseId, cr);
    console.log(`Loaded ${releases.length} releases from releases.json, ${chartReleases.length} chart entries`);

    // 2. Load YouTube API key
    const apiKey = getYouTubeApiKey();
    if (!apiKey) {
        console.error('No YouTube API key. Set YOUTUBE_API_KEY env var or edit config/credentials/youtube-credentials.json.');
        process.exit(1);
    }

    // 3. Load bands.json for YouTube channel links
    const bandsRaw = fs.readFileSync(BANDS_FILE, 'utf8').replace(/^\uFEFF/, '');
    const bands = JSON.parse(bandsRaw).muzickaMasterLista || JSON.parse(bandsRaw);
    const bandByName = new Map();
    bands.forEach(b => bandByName.set(b.name.toLowerCase().trim(), b));

    // 4. Load cache
    const cache = loadCache();
    const cachedTracks = Object.keys(cache.tracks).length;
    if (cachedTracks > 0) console.log(`Cache: ${cachedTracks} release track mappings, ${Object.keys(cache.channels).length} channel IDs`);

    // 5. Load recent archive weeks
    console.log('\n── Loading archive week data ──');
    const archiveWeeks = loadRecentArchiveWeeks();
    const selectedArchiveWeeks = selectLiveArchiveWeeks(archiveWeeks);
    const deltaBaselineWeek = selectedArchiveWeeks.deltaBaseline;
    const frozenDisplayWeek = selectedArchiveWeeks.frozenDisplay;
    const frozenReferenceWeek = selectedArchiveWeeks.frozenReference;
    const prevMap = new Map(); // releaseId -> { popularity, youtubeViews }
    if (deltaBaselineWeek) {
        for (const r of deltaBaselineWeek.releases) {
            prevMap.set(r.releaseId, { popularity: r.popularity || 0, youtubeViews: r.youtubeViews || 0, youtubeVideoIds: r.youtubeVideoIds || null });
        }
    }
    const useYTHistory = hasYouTubeHistory(deltaBaselineWeek);
    console.log(useYTHistory
        ? '  Archive baseline has YouTube views — using real delta'
        : '  No YouTube history — will approximate last week views from Spotify popularity');

    // ── Step 1: Resolve YouTube channels ────────────────────────────────────
    console.log('\n── Step 1: Resolving YouTube channels ──');

    const artistNames = [...new Set(releases.map(r => r.bandName))];
    const artistsToProcess = [];
    let noYtLink = 0;

    for (const name of artistNames) {
        const band = bandByName.get(name.toLowerCase().trim());
        const rawYt = band?.links?.youtube;
        // Normalize to array of URLs
        const ytUrls = Array.isArray(rawYt) ? rawYt : (rawYt ? [rawYt] : []);
        const parsedLinks = [];
        for (const url of ytUrls) {
            if (!url || url === 'недостигаат податоци') continue;
            const parsed = parseYouTubeLink(url);
            if (parsed) parsedLinks.push({ parsed, ytUrl: url });
        }
        if (parsedLinks.length === 0) { noYtLink++; continue; }
        artistsToProcess.push({ name, band, parsedLinks });
    }
    console.log(`  ${artistsToProcess.length} artists with YouTube links (${noYtLink} without)`);

    // Resolve all to channel IDs (each artist can have multiple)
    const videoIdArtists = []; // { videoId, artistName, linkIndex }
    const needsResolve = [];   // { artist, linkIndex, parsed }

    for (const artist of artistsToProcess) {
        const cacheKey = artist.name.toLowerCase().trim();
        if (cache.channels[cacheKey]?.length > 0) continue; // already resolved

        const channelIds = [];
        for (let li = 0; li < artist.parsedLinks.length; li++) {
            const p = artist.parsedLinks[li].parsed;
            if (p.type === 'channelId') {
                channelIds.push(p.value);
            } else if (p.type === 'videoId') {
                videoIdArtists.push({ videoId: p.value, artistName: artist.name, linkIndex: li });
            } else {
                needsResolve.push({ artist, linkIndex: li, parsed: p });
            }
        }
        if (channelIds.length > 0) {
            cache.channels[cacheKey] = channelIds;
        }
    }

    // Resolve video ID links to channel IDs
    if (videoIdArtists.length > 0) {
        console.log(`  Resolving ${videoIdArtists.length} video links to channels...`);
        const vidChannels = await resolveVideoChannels(videoIdArtists.map(v => v.videoId), apiKey);
        for (const { videoId, artistName } of videoIdArtists) {
            const chId = vidChannels.get(videoId);
            if (chId) {
                const cacheKey = artistName.toLowerCase().trim();
                if (!cache.channels[cacheKey]) cache.channels[cacheKey] = [];
                if (!cache.channels[cacheKey].includes(chId)) cache.channels[cacheKey].push(chId);
            }
        }
    }

    // Resolve handles/usernames/custom URLs
    if (needsResolve.length > 0) {
        console.log(`  Resolving ${needsResolve.length} handles/usernames...`);
        for (let i = 0; i < needsResolve.length; i++) {
            const { artist, parsed: p } = needsResolve[i];
            const cacheKey = artist.name.toLowerCase().trim();
            let channelId = null;
            if (p.type === 'handle') channelId = await resolveHandle(p.value, apiKey);
            else if (p.type === 'username') channelId = await resolveUsername(p.value, apiKey);
            else if (p.type === 'customUrl') channelId = await resolveCustomUrl(p.value, apiKey);
            if (channelId) {
                if (!cache.channels[cacheKey]) cache.channels[cacheKey] = [];
                if (!cache.channels[cacheKey].includes(channelId)) cache.channels[cacheKey].push(channelId);
            }
            if ((i + 1) % 50 === 0) { console.log(`    ${i + 1}/${needsResolve.length}`); saveCache(cache); }
            await sleep(API_DELAY_MS);
        }
    }

    saveCache(cache);
    const resolvedCount = artistsToProcess.filter(a => cache.channels[a.name.toLowerCase().trim()]?.length > 0).length;
    console.log(`  Resolved: ${resolvedCount}/${artistsToProcess.length} artists`);

    // Build artist -> releases map (used by invalidation and Step 2)
    const releasesByArtist = new Map();
    for (const r of releases) {
        const key = r.bandName.toLowerCase().trim();
        if (!releasesByArtist.has(key)) releasesByArtist.set(key, []);
        releasesByArtist.get(key).push(r);
    }

    // Invalidate track cache for artists whose channel count increased
    // (so releases get re-matched across all channels)
    let invalidated = 0;
    for (const artist of artistsToProcess) {
        const cacheKey = artist.name.toLowerCase().trim();
        const channelIds = cache.channels[cacheKey] || [];
        if (channelIds.length <= 1) continue;
        const artistReleases = releasesByArtist.get(cacheKey) || [];
        for (const r of artistReleases) {
            const cached = cache.tracks[r.releaseId];
            if (!cached) continue;
            // If any track only has 1 videoId but we now have multiple channels, re-match
            const maxVids = Math.max(0, ...cached.map(t => (t.videoIds || []).length));
            if (maxVids < channelIds.length) {
                delete cache.tracks[r.releaseId];
                invalidated++;
            }
        }
    }
    if (invalidated > 0) console.log(`  Invalidated ${invalidated} cached track entries for multi-channel re-matching`);

    // Invalidate releases where ALL tracks have empty videoIds (failed matches should be retried)
    let emptyInvalidated = 0;
    for (const [releaseId, tracks] of Object.entries(cache.tracks)) {
        if (tracks.length > 0 && tracks.every(t => (t.videoIds || []).length === 0)) {
            delete cache.tracks[releaseId];
            emptyInvalidated++;
        }
    }
    if (emptyInvalidated > 0) console.log(`  Invalidated ${emptyInvalidated} cached entries with no matched videos (will retry)`);

    // ── Step 2: Match release tracks to YouTube videos ──────────────────────
    console.log('\n── Step 2: Matching release tracks to YouTube videos ──');

    let totalTracksMatched = 0, totalTracksUnmatched = 0, artistsDone = 0;
    const startTime = Date.now();

    for (const artist of artistsToProcess) {
        const cacheKey = artist.name.toLowerCase().trim();
        const channelIds = cache.channels[cacheKey] || [];
        if (channelIds.length === 0) continue;

        const artistReleases = releasesByArtist.get(cacheKey) || [];
        const uncached = artistReleases.filter(r => !cache.tracks[r.releaseId]);
        if (uncached.length === 0) { artistsDone++; continue; }

        // Fetch videos from ALL channels for this artist
        const allChannelVideos = [];
        try {
            for (const chId of channelIds) {
                const videos = await getChannelVideos(chId, apiKey, cache);
                allChannelVideos.push(videos);
            }
        } catch (err) {
            console.warn(`  Skipping ${artist.name}: channel fetch failed (${err.code || err.message})`);
            artistsDone++;
            continue;
        }

        // Match each uncached release's tracks across all channels
        for (const release of uncached) {
            const trackMatches = matchReleaseTracks(release, allChannelVideos);
            cache.tracks[release.releaseId] = trackMatches;
            totalTracksMatched += trackMatches.filter(t => t.videoIds.length > 0).length;
            totalTracksUnmatched += trackMatches.filter(t => t.videoIds.length === 0).length;
        }

        artistsDone++;
        if (artistsDone % 25 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  ${artistsDone}/${resolvedCount} artists | ${totalTracksMatched} tracks matched | ${elapsed}s | quota: ${quotaUsed}`);
            saveCache(cache);
        }
        await sleep(API_DELAY_MS);
    }

    saveCache(cache);

    console.log(`  Done: ${totalTracksMatched} tracks matched, ${totalTracksUnmatched} unmatched`);

    // ── --match-only: Save matches to releases.json and exit ────────────────
    if (process.argv.includes('--match-only')) {
        console.log('\n── Match-only mode: Saving YouTube track matches to releases.json ──');

        // Build map of existing youtube tracks (to preserve verified/will-not-verify)
        const existingYtMapMO = new Map();
        for (const r of releases) {
            if (r.youtubeTracks?.length > 0) {
                const trackMap = new Map();
                for (const t of r.youtubeTracks) {
                    trackMap.set(t.videoId, t);
                }
                existingYtMapMO.set(r.releaseId, trackMap);
            }
        }

        let newMatchCount = 0;
        for (const r of releases) {
            const trackMatches = cache.tracks[r.releaseId] || [];
            const existingTracks = existingYtMapMO.get(r.releaseId) || new Map();
            const ytTracks = [];
            const seenVids = new Set();

            // Preserve existing tracks (verified, will-not-verify, or already-unverified)
            for (const [vid, track] of existingTracks) {
                seenVids.add(vid);
                ytTracks.push(track);
            }

            // Add new matches from cache
            for (const t of trackMatches) {
                for (const vid of (t.videoIds || [])) {
                    if (seenVids.has(vid)) continue;
                    seenVids.add(vid);
                    newMatchCount++;
                    ytTracks.push({
                        name: t.trackName,
                        videoId: vid,
                        url: `https://www.youtube.com/watch?v=${vid}`,
                        verified: 'unverified'
                    });
                }
            }

            r.youtubeTracks = ytTracks.length > 0 ? ytTracks : undefined;
        }

        releasesData.generatedAt = new Date().toISOString();
        fs.writeFileSync(RELEASES_FILE, JSON.stringify(releasesData, null, 2), 'utf8');

        // Count verification status
        let unverifiedCount = 0, verifiedCount = 0, willNotVerifyCount = 0;
        for (const r of releases) {
            for (const t of (r.youtubeTracks || [])) {
                if (t.verified === 'verified') verifiedCount++;
                else if (t.verified === 'will-not-verify') willNotVerifyCount++;
                else unverifiedCount++;
            }
        }

        console.log(`\n=== Match-only Summary ===`);
        console.log(`  New matches added:   ${newMatchCount}`);
        console.log(`  Verified:            ${verifiedCount}`);
        console.log(`  Unverified:          ${unverifiedCount}`);
        console.log(`  Will-not-verify:     ${willNotVerifyCount}`);
        console.log(`  YouTube API quota:   ~${quotaUsed} units`);

        if (unverifiedCount > 0) {
            console.log(`\nPlease verify ${unverifiedCount} unverified YouTube link(s) in releases.json`);
        } else {
            console.log(`\nAll YouTube links are verified. Ready for popularity calculation.`);
        }

        return;
    }

    // ── Step 3: Fetch view counts only for verified video IDs ───────────────
    // Build a map of existing youtube tracks from releases.json (need verified status)
    const existingYtMap = new Map(); // releaseId -> Map<videoId, { verified, name }>
    for (const r of releases) {
        if (r.youtubeTracks?.length > 0) {
            const trackMap = new Map();
            for (const t of r.youtubeTracks) {
                trackMap.set(t.videoId, { verified: t.verified || 'unverified', name: t.name });
            }
            existingYtMap.set(r.releaseId, trackMap);
        }
    }

    // Collect video IDs for verified and unverified tracks (skip will-not-verify)
    const fetchVideoIds = new Set();
    let totalMatchedIds = 0;
    for (const r of releases) {
        const trackMatches = cache.tracks[r.releaseId] || [];
        const existingTracks = existingYtMap.get(r.releaseId) || new Map();
        for (const t of trackMatches) {
            for (const vid of (t.videoIds || [])) {
                totalMatchedIds++;
                const existing = existingTracks.get(vid);
                if (existing?.verified !== 'will-not-verify') fetchVideoIds.add(vid);
            }
        }
        // Also include manually-added verified/unverified tracks not in cache
        for (const [vid, info] of existingTracks) {
            if (info.verified !== 'will-not-verify') fetchVideoIds.add(vid);
        }
    }
    console.log(`\n── Step 3: Fetching view counts for ${fetchVideoIds.size} verified+unverified videos (of ${totalMatchedIds} total matched) ──`);
    const allStats = await getVideoStatsBatch([...fetchVideoIds], apiKey);
    console.log(`  Got stats for ${allStats.size} videos`);

    // ── Step 4: Compute per-release total views and update releases.json ─────
    console.log('\n── Step 4: Computing YouTube views per release ──');

    // Track globally seen video IDs so each YouTube video is counted only once
    const globalSeenVideoIds = new Set();

    for (const r of releases) {
        const trackMatches = cache.tracks[r.releaseId] || [];
        let totalViews = 0;
        const ytTracks = [];
        const contributingVideoIds = [];
        const existingTracks = existingYtMap.get(r.releaseId) || new Map();

        for (const t of trackMatches) {
            for (const vid of (t.videoIds || [])) {
                const alreadyCounted = globalSeenVideoIds.has(vid);
                globalSeenVideoIds.add(vid);
                const existing = existingTracks.get(vid);
                const isVerified = existing?.verified === 'verified';
                const isWillNotVerify = existing?.verified === 'will-not-verify';
                const stats = !isWillNotVerify ? allStats.get(vid) : null;
                const views = stats?.viewCount || 0;
                const publishedAt = stats?.publishedAt ? stats.publishedAt.slice(0, 10) : null;
                ytTracks.push({
                    name: t.trackName,
                    videoId: vid,
                    url: `https://www.youtube.com/watch?v=${vid}`,
                    verified: isWillNotVerify ? 'will-not-verify' : isVerified ? 'verified' : 'unverified',
                    ...(views > 0 ? { views } : {}),
                    ...(publishedAt ? { publishedAt } : {})
                });
                // Only verified views count toward charts
                if (isVerified && !alreadyCounted) {
                    totalViews += views;
                    contributingVideoIds.push(vid);
                }
                existingTracks.delete(vid); // Mark as processed
            }
        }

        // Preserve any manually-added verified/will-not-verify youtube tracks that weren't auto-matched
        for (const [vid, info] of existingTracks) {
            if (info.verified === 'verified' || info.verified === 'will-not-verify') {
                const alreadyCounted = globalSeenVideoIds.has(vid);
                globalSeenVideoIds.add(vid);
                const isVerified = info.verified === 'verified';
                const stats = isVerified ? allStats.get(vid) : null;
                const views = stats?.viewCount || 0;
                const manualPublishedAt = stats?.publishedAt ? stats.publishedAt.slice(0, 10) : null;
                if (isVerified && !alreadyCounted) {
                    totalViews += views;
                    contributingVideoIds.push(vid);
                }
                ytTracks.push({
                    name: info.name,
                    videoId: vid,
                    url: `https://www.youtube.com/watch?v=${vid}`,
                    verified: info.verified,
                    ...(views > 0 ? { views } : {}),
                    ...(manualPublishedAt ? { publishedAt: manualPublishedAt } : {})
                });
            }
        }

        // Compute effectiveReleaseDate for singles/songs.
        // Prefer a verified upload tied to the current Spotify release cycle when one exists,
        // otherwise fall back to the earliest verified YouTube upload to keep archival-only
        // reissues anchored to their original run. Albums always use the Spotify releaseDate.
        if (r.releaseType !== 'album') {
            const ytDates = ytTracks
                .filter(t => t.publishedAt && t.verified !== 'will-not-verify')
                .map(t => t.publishedAt)
                .sort();
            if (ytDates.length > 0) {
                const earliestYt = ytDates[0];
                if (r.releaseDate) {
                    const releaseTs = Date.parse(r.releaseDate);
                    const releaseWindowMs = 30 * 24 * 60 * 60 * 1000;
                    if (!Number.isNaN(releaseTs)) {
                        const cycleDates = ytDates.filter(date => {
                            const ytTs = Date.parse(date);
                            if (Number.isNaN(ytTs) || ytTs > releaseTs) return false;
                            return (releaseTs - ytTs) <= releaseWindowMs;
                        });
                        if (cycleDates.length > 0) {
                            r.effectiveReleaseDate = cycleDates[cycleDates.length - 1];
                        } else {
                            r.effectiveReleaseDate = r.releaseDate < earliestYt
                                ? r.releaseDate
                                : earliestYt;
                        }
                    } else {
                        r.effectiveReleaseDate = r.releaseDate < earliestYt
                            ? r.releaseDate
                            : earliestYt;
                    }
                } else {
                    r.effectiveReleaseDate = earliestYt;
                }
            } else {
                r.effectiveReleaseDate = r.releaseDate;
            }
        } else {
            r.effectiveReleaseDate = r.releaseDate;
        }

        // Update release catalog entry
        r.youtubeTracks = ytTracks.length > 0 ? ytTracks : undefined;
        r.youtubeViews = totalViews;

        // Update chart data entry
        const chartEntry = chartMap.get(r.releaseId);
        if (chartEntry) {
            chartEntry.youtubeViews = totalViews;
            chartEntry.youtubeTrackCount = ytTracks.length;
            chartEntry.youtubeVideoIds = contributingVideoIds.length > 0 ? contributingVideoIds : undefined;
            chartEntry.spotifyPopularity = chartEntry.popularity || 0;
            chartEntry._totalViews = totalViews;
        }
    }

    const dupeCount = globalSeenVideoIds.size;
    console.log(`  Counted ${dupeCount} unique YouTube videos across all releases`);

    // ── Step 5: Compute popularity ──────────────────────────────────────────
    const releaseById = new Map();
    for (const r of releases) releaseById.set(r.releaseId, r);

    let archiveChartData = null;
    if (useYTHistory) {
        // Real YouTube history available — compute delta-based popularity
        console.log('\n── Step 5: Computing popularity from YouTube view deltas ──');

        let newReleaseDeltaCount = 0;
        let videoFilteredCount = 0;
        let newlyLinkedZeroDeltaCount = 0;
        let missingBaselineCount = 0;
        let negativeDeltaCount = 0;

        // Determine the Monday of the selected chart-history baseline week from weekId (e.g. "2026-W11")
        const prevChartMonday = getChartMondayFromWeekId(deltaBaselineWeek?.weekId);
        if (prevChartMonday) {
            console.log(`  Archive baseline Monday: ${prevChartMonday.toISOString().slice(0, 10)}`);
        }

        for (const cr of chartReleases) {
            const rel = releaseById.get(cr.releaseId);
            const effectiveDate = rel?.effectiveReleaseDate || rel?.releaseDate;
            const releaseDate = effectiveDate ? new Date(effectiveDate) : null;

            clearChartIssue(cr);
            clearChartIssue(rel);

            // If the release came out after the previous chart Monday, all views are this week's
            if (releaseDate && prevChartMonday && releaseDate >= prevChartMonday) {
                cr._viewDelta = cr.youtubeViews || 0;
                newReleaseDeltaCount++;
            } else {
                const prev = prevMap.get(cr.releaseId);
                if (prev) {
                    if (prev.youtubeVideoIds && prev.youtubeVideoIds.length > 0) {
                        // Per-video comparison: only count views from videos that existed last week
                        const prevIdSet = new Set(prev.youtubeVideoIds);
                        const currVideoIds = cr.youtubeVideoIds || [];
                        let comparableViews = 0;
                        for (const vid of currVideoIds) {
                            if (prevIdSet.has(vid)) {
                                const stats = allStats.get(vid);
                                comparableViews += stats?.viewCount || 0;
                            }
                        }
                        const rawDelta = comparableViews - prev.youtubeViews;
                        if (rawDelta < 0) {
                            flagNegativeViewsDelta(cr, deltaBaselineWeek?.weekId, comparableViews, prev.youtubeViews);
                            flagNegativeViewsDelta(rel, deltaBaselineWeek?.weekId, comparableViews, prev.youtubeViews);
                            negativeDeltaCount++;
                        }
                        cr._viewDelta = Math.max(0, rawDelta);
                        if (currVideoIds.length > prevIdSet.size) videoFilteredCount++;
                    } else if (prev.youtubeViews > 0) {
                        // No per-video data in prev week — fall back to total comparison
                        const currentViews = cr.youtubeViews || 0;
                        const rawDelta = currentViews - prev.youtubeViews;
                        if (rawDelta < 0) {
                            flagNegativeViewsDelta(cr, deltaBaselineWeek?.weekId, currentViews, prev.youtubeViews);
                            flagNegativeViewsDelta(rel, deltaBaselineWeek?.weekId, currentViews, prev.youtubeViews);
                            negativeDeltaCount++;
                        }
                        cr._viewDelta = Math.max(0, rawDelta);
                    } else {
                        // Older release/link had no previous YouTube baseline. Its newly added
                        // historical views should start contributing only after this snapshot.
                        cr._viewDelta = 0;
                        if ((cr.youtubeViews || 0) > 0) newlyLinkedZeroDeltaCount++;
                    }
                } else {
                    // Older release was not present in previous chart-history, so there is no
                    // reliable weekly baseline for its current YouTube views.
                    cr._viewDelta = null;
                    if ((cr.youtubeViews || 0) > 0) missingBaselineCount++;
                }
            }
        }
        if (newReleaseDeltaCount > 0) {
            console.log(`  ${newReleaseDeltaCount} new release(s) released after previous chart Monday — using total views as delta`);
        }
        if (videoFilteredCount > 0) {
            console.log(`  ${videoFilteredCount} release(s) had newly matched videos filtered out of delta calculation`);
        }
        if (newlyLinkedZeroDeltaCount > 0) {
            console.log(`  ${newlyLinkedZeroDeltaCount} older release(s) had newly added YouTube links with no baseline — using 0 delta`);
        }
        if (missingBaselineCount > 0) {
            console.log(`  ${missingBaselineCount} older release(s) had YouTube views but no archive baseline — skipping delta`);
        }
        if (negativeDeltaCount > 0) {
            console.log(`  ${negativeDeltaCount} release(s) had negative live view deltas and were flagged for chart exclusion`);
        }
        const typeMap = new Map();
        for (const r of releases) typeMap.set(r.releaseId, r.releaseType);
        computePopularities(chartReleases, typeMap);
        archiveChartData = JSON.parse(JSON.stringify(chartData));

        const hasPositiveDelta = chartReleases.some(cr => (cr._viewDelta || 0) > 0);
        if (!hasPositiveDelta && frozenDisplayWeek?.releases?.length) {
            const reusedCount = applyFrozenChartState(chartReleases, frozenDisplayWeek, frozenReferenceWeek, releaseById);
            console.log(`  No positive live deltas yet — reusing ${frozenDisplayWeek.weekId} chart state for ${reusedCount} release(s)`);
        }

        for (const cr of chartReleases) { delete cr._totalViews; delete cr._viewDelta; }
    } else {
        // No YouTube history yet — use Spotify popularity as-is
        console.log('\n── Step 5: No YouTube history — using Spotify popularity ──');
        for (const cr of chartReleases) {
            delete cr._totalViews;
            clearChartIssue(cr);
            clearChartIssue(releaseById.get(cr.releaseId));
        }
    }

    // ── Step 6: Save updated files ──────────────────────────────────────────
    // Save releases.json (with updated youtube tracks and verified flags)
    releasesData.generatedAt = new Date().toISOString();
    fs.writeFileSync(RELEASES_FILE, JSON.stringify(releasesData, null, 2), 'utf8');
    console.log(`\nUpdated releases.json with YouTube track matches`);

    // Save chart history FIRST (includes youtubeVideoIds for per-video delta tracking)
    chartData.generatedAt = new Date().toISOString();
    if (archiveChartData) {
        archiveChartData.generatedAt = chartData.generatedAt;
    }
    const now = new Date();
    if (now.getDay() === 1) {
        const d = new Date(now); d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const isoWeek = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        const weekFileName = `chart-${d.getFullYear()}-W${String(isoWeek).padStart(2, '0')}.json`;
        const weekFilePath = path.join(HISTORY_DIR, weekFileName);
        if (fs.existsSync(weekFilePath)) {
            const weekChartData = archiveChartData || chartData;
            fs.writeFileSync(weekFilePath, JSON.stringify(weekChartData, null, 2), 'utf8');
            console.log(`Updated chart-history/${weekFileName} with YouTube-based popularity`);
        }
    } else {
        console.log(`Skipping chart-history update (today is not Monday)`);
    }

    // Strip youtubeVideoIds before saving chart-data.json (only needed in chart history for delta tracking)
    for (const cr of chartReleases) { delete cr.youtubeVideoIds; }

    // Save chart-data.json (with updated views and popularity, without video ID lists)
    fs.writeFileSync(CHART_DATA, JSON.stringify(chartData, null, 2), 'utf8');
    console.log(`Updated chart-data.json with YouTube-based popularity`);

    // Also save channel video cache (strip to save space — only keep titles, not full data)
    delete cache.channelVideos; // Don't persist full channel video lists (refreshed each run)
    saveCache(cache);

    // ── Summary ─────────────────────────────────────────────────────────────
    const withViews = chartReleases.filter(r => r.youtubeViews > 0);
    const pops = chartReleases.map(r => r.popularity).filter(p => p > 0).sort((a, b) => b - a);
    const viewsArr = withViews.map(r => r.youtubeViews).sort((a, b) => b - a);

    console.log('\n=== Summary ===');
    console.log(`Total releases:           ${releases.length}`);
    console.log(`With YouTube views:       ${withViews.length} (${Math.round(withViews.length / releases.length * 100)}%)`);
    console.log(`Non-zero popularity:      ${pops.length}`);
    if (pops.length) {
        console.log(`Popularity range:         ${pops[pops.length - 1]}–${pops[0]} (median: ${pops[Math.floor(pops.length / 2)]})`);
    }

    console.log(`\nTop 15 by popularity:`);
    // Build lookup from releases for display
    const releaseNameMap = new Map();
    for (const r of releases) releaseNameMap.set(r.releaseId, r);
    const topPop = [...chartReleases].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15);
    for (let i = 0; i < topPop.length; i++) {
        const cr = topPop[i];
        const r = releaseNameMap.get(cr.releaseId);
        const name = r ? `${r.bandName} — ${r.releaseTitle}` : cr.releaseId;
        console.log(`  #${i + 1} ${name} | views: ${(cr.youtubeViews || 0).toLocaleString()} → pop: ${cr.popularity}`);
    }

    console.log(`\nYouTube API quota used: ~${quotaUsed} units (of 10,000 daily)`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
