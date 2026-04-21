/**
 * fetch-interviews.js
 *
 * Reads YouTube channel URLs from interview-channels.json, resolves each
 * channel, fetches every uploaded video for new channels, incrementally fetches
 * recent uploads for existing channels, and writes interviews.json.
 *
 * Output shape intentionally mirrors articles.json closely so site-master can
 * apply the same blacklist and artist-matching pipeline as News.
 *
 * Usage:
 *   node scripts/fetch-interviews.js
 *   node scripts/fetch-interviews.js --full
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHANNELS_PATH = path.join(ROOT, 'interview-channels.json');
const OUTPUT_PATH = path.join(ROOT, 'interviews.json');
const CACHE_PATH = path.join(ROOT, '.interview-channel-cache.json');
const API_DELAY_MS = 100;
const API_RETRY_DELAY_MS = 1000;
const API_MAX_RETRIES = 3;
const VIDEO_DETAILS_BATCH_SIZE = 50;
const PLAYER_MAX_DIMENSION = 800;
const SHORTS_MAX_DURATION_SECONDS = 180;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4) + '\n', 'utf8');
}

function getYouTubeApiKey() {
    if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
    try {
        const credPath = path.join(ROOT, 'youtube-credentials.json');
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (creds.apiKey && creds.apiKey !== 'YOUR_YOUTUBE_DATA_API_V3_KEY_HERE') {
            return creds.apiKey;
        }
    } catch {
        // ignore
    }
    return null;
}

async function ytApi(endpoint, params, apiKey) {
    const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;

    for (let attempt = 1; attempt <= API_MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const body = await response.text();
                const retryable = response.status === 429 || response.status >= 500;
                if (retryable && attempt < API_MAX_RETRIES) {
                    await sleep(API_RETRY_DELAY_MS * attempt);
                    continue;
                }
                throw new Error(`YouTube API ${response.status}: ${body.slice(0, 200)}`);
            }
            return await response.json();
        } catch (error) {
            if (attempt >= API_MAX_RETRIES) throw error;
            await sleep(API_RETRY_DELAY_MS * attempt);
        }
    }

    return null;
}

function parseYouTubeLink(url) {
    if (!url || typeof url !== 'string') return null;

    let match = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channelId', value: match[1] };

    match = url.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/i);
    if (match) return { type: 'handle', value: match[1] };

    match = url.match(/youtube\.com\/user\/([a-zA-Z0-9._-]+)/i);
    if (match) return { type: 'username', value: match[1] };

    match = url.match(/youtube\.com\/c\/([a-zA-Z0-9._-]+)/i);
    if (match) return { type: 'customUrl', value: match[1] };

    match = url.match(/youtube\.com\/([a-zA-Z0-9._-]{3,})\/?$/i);
    if (match && !['watch', 'playlist', 'channel', 'user', 'c', 'feed', 'results'].includes(match[1].toLowerCase())) {
        return { type: 'customUrl', value: match[1] };
    }

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

async function resolveCustomUrl(name, apiKey) {
    let id = await resolveHandle(name, apiKey);
    if (id) return id;
    await sleep(API_DELAY_MS);
    return await resolveUsername(name, apiKey);
}

async function resolveChannelId(channelUrl, apiKey, cache) {
    if (cache[channelUrl]) return cache[channelUrl];

    const parsed = parseYouTubeLink(channelUrl);
    if (!parsed) {
        throw new Error(`Unsupported YouTube channel URL: ${channelUrl}`);
    }

    let channelId = null;
    if (parsed.type === 'channelId') channelId = parsed.value;
    if (parsed.type === 'handle') channelId = await resolveHandle(parsed.value, apiKey);
    if (parsed.type === 'username') channelId = await resolveUsername(parsed.value, apiKey);
    if (parsed.type === 'customUrl') channelId = await resolveCustomUrl(parsed.value, apiKey);

    if (!channelId) {
        throw new Error(`Could not resolve channel ID for ${channelUrl}`);
    }

    cache[channelUrl] = channelId;
    return channelId;
}

async function getChannelMeta(channelId, apiKey) {
    const data = await ytApi('channels', {
        part: 'snippet,contentDetails',
        id: channelId,
    }, apiKey);
    return data?.items?.[0] || null;
}

function parseDurationSeconds(isoDuration) {
    if (typeof isoDuration !== 'string' || !isoDuration) return null;

    const match = isoDuration.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return null;

    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);

    return ((((days * 24) + hours) * 60) + minutes) * 60 + seconds;
}

function parsePlayerDimension(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLikelyShortFormVideo(videoDetails) {
    if (!videoDetails) return false;

    return Number.isFinite(videoDetails.durationSeconds)
        && videoDetails.durationSeconds > 0
        && videoDetails.durationSeconds <= SHORTS_MAX_DURATION_SECONDS
        && Number.isFinite(videoDetails.embedWidth)
        && Number.isFinite(videoDetails.embedHeight)
        && videoDetails.embedHeight > videoDetails.embedWidth;
}

async function getVideoDetailsMap(videoIds, apiKey) {
    const uniqueVideoIds = Array.from(new Set(
        (Array.isArray(videoIds) ? videoIds : []).filter((videoId) => typeof videoId === 'string' && videoId)
    ));
    const details = new Map();

    for (let index = 0; index < uniqueVideoIds.length; index += VIDEO_DETAILS_BATCH_SIZE) {
        const batchIds = uniqueVideoIds.slice(index, index + VIDEO_DETAILS_BATCH_SIZE);
        const data = await ytApi('videos', {
            part: 'contentDetails,player',
            id: batchIds.join(','),
            maxHeight: String(PLAYER_MAX_DIMENSION),
            maxWidth: String(PLAYER_MAX_DIMENSION),
        }, apiKey);
        const items = Array.isArray(data?.items) ? data.items : [];

        for (const item of items) {
            const videoDetails = {
                durationSeconds: parseDurationSeconds(item?.contentDetails?.duration),
                embedWidth: parsePlayerDimension(item?.player?.embedWidth),
                embedHeight: parsePlayerDimension(item?.player?.embedHeight),
            };
            videoDetails.shortForm = isLikelyShortFormVideo(videoDetails);
            details.set(item.id, videoDetails);
        }

        if (index + VIDEO_DETAILS_BATCH_SIZE < uniqueVideoIds.length) {
            await sleep(API_DELAY_MS);
        }
    }

    return details;
}

async function hydrateVideosWithVideoDetails(videos, apiKey) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return { videos: [], shortCount: 0, hydratedCount: 0 };
    }

    const details = await getVideoDetailsMap(videos.map((video) => video?.videoId), apiKey);
    const hydratedVideos = [];
    let shortCount = 0;
    let hydratedCount = 0;

    for (const video of videos) {
        const videoDetails = details.get(video.videoId);
        if (!videoDetails) {
            hydratedVideos.push(video);
            continue;
        }

        hydratedCount += 1;
        if (videoDetails.shortForm) {
            shortCount += 1;
            continue;
        }

        hydratedVideos.push({
            ...video,
            durationSeconds: videoDetails.durationSeconds,
            embedWidth: videoDetails.embedWidth,
            embedHeight: videoDetails.embedHeight,
            shortForm: videoDetails.shortForm,
        });
    }

    return {
        videos: hydratedVideos,
        shortCount,
        hydratedCount,
    };
}

async function getUploads(channelId, uploadsPlaylistId, apiKey, options) {
    const results = [];
    let pageToken = '';
    const knownVideoIds = options?.knownVideoIds instanceof Set && options.knownVideoIds.size > 0
        ? options.knownVideoIds
        : null;
    let stoppedAtKnownVideo = false;

    do {
        const params = {
            part: 'snippet,contentDetails',
            playlistId: uploadsPlaylistId,
            maxResults: '50',
        };
        if (pageToken) params.pageToken = pageToken;

        const data = await ytApi('playlistItems', params, apiKey);
        const items = Array.isArray(data?.items) ? data.items : [];

        for (const item of items) {
            const snippet = item?.snippet || {};
            const contentDetails = item?.contentDetails || {};
            const videoId = snippet.resourceId?.videoId || contentDetails.videoId || null;
            if (!videoId) continue;
            if (snippet.title === 'Private video' || snippet.title === 'Deleted video') continue;

            if (knownVideoIds && knownVideoIds.has(videoId)) {
                stoppedAtKnownVideo = true;
                break;
            }

            results.push({
                videoId,
                title: snippet.title || '',
                description: snippet.description || '',
                publishedAt: snippet.publishedAt || '',
                thumbnail:
                    snippet.thumbnails?.medium?.url ||
                    snippet.thumbnails?.high?.url ||
                    snippet.thumbnails?.default?.url ||
                    '',
                channelTitle: snippet.videoOwnerChannelTitle || snippet.channelTitle || '',
            });
        }

        if (stoppedAtKnownVideo) break;

        pageToken = data?.nextPageToken || '';
        if (pageToken) await sleep(API_DELAY_MS);
    } while (pageToken);

    const hydratedResults = await hydrateVideosWithVideoDetails(results, apiKey);

    return {
        videos: hydratedResults.videos,
        shortCount: hydratedResults.shortCount,
        stoppedAtKnownVideo,
    };
}

function normalizeDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
}

function getInterviewKey(interview) {
    if (!interview || typeof interview !== 'object') return null;
    return interview.videoId || interview.link || [interview.title || '', interview.date || '', interview.siteUrl || ''].join('|');
}

async function hydrateExistingInterviewsWithVideoDetails(interviews, apiKey) {
    if (!Array.isArray(interviews) || interviews.length === 0) {
        return { interviews: [], shortCount: 0, hydratedCount: 0 };
    }

    const missingVideoIds = [];
    const seenVideoIds = new Set();

    for (const interview of interviews) {
        const videoId = interview?.videoId;
        if (typeof videoId !== 'string' || !videoId) continue;
        if (typeof interview.shortForm === 'boolean') continue;
        if (seenVideoIds.has(videoId)) continue;
        seenVideoIds.add(videoId);
        missingVideoIds.push(videoId);
    }

    const details = missingVideoIds.length > 0
        ? await getVideoDetailsMap(missingVideoIds, apiKey)
        : new Map();
    const hydratedInterviews = [];
    let shortCount = 0;
    let hydratedCount = 0;

    for (const interview of interviews) {
        const videoId = interview?.videoId;
        let hydratedInterview = interview;

        if (typeof videoId === 'string' && videoId && typeof interview.shortForm !== 'boolean') {
            const videoDetails = details.get(videoId);
            if (videoDetails) {
                hydratedInterview = {
                    ...interview,
                    durationSeconds: videoDetails.durationSeconds,
                    embedWidth: videoDetails.embedWidth,
                    embedHeight: videoDetails.embedHeight,
                    shortForm: videoDetails.shortForm,
                };
                hydratedCount += 1;
            }
        }

        if (hydratedInterview?.shortForm === true) {
            shortCount += 1;
            continue;
        }

        hydratedInterviews.push(hydratedInterview);
    }

    return {
        interviews: hydratedInterviews,
        shortCount,
        hydratedCount,
    };
}

function buildInterviewIndexes(interviews) {
    const byChannelId = new Map();
    const bySiteUrl = new Map();

    const addToIndex = (index, key, interview) => {
        if (!key) return;
        const existing = index.get(key);
        if (existing) {
            existing.push(interview);
            return;
        }
        index.set(key, [interview]);
    };

    for (const interview of interviews) {
        if (!interview || typeof interview !== 'object') continue;
        addToIndex(byChannelId, interview.channelId || '', interview);
        addToIndex(bySiteUrl, interview.siteUrl || '', interview);
    }

    return {
        byChannelId,
        bySiteUrl,
    };
}

function getExistingChannelInterviews(indexes, channelId, channelUrl) {
    const deduped = new Map();

    const addEntries = (entries) => {
        for (const entry of entries || []) {
            const key = getInterviewKey(entry);
            if (!key || deduped.has(key)) continue;
            deduped.set(key, entry);
        }
    };

    addEntries(indexes.byChannelId.get(channelId));
    addEntries(indexes.bySiteUrl.get(channelUrl));

    return Array.from(deduped.values());
}

function createInterviewRecord(video, channelTitle, channelUrl, channelThumb, channelId, fetchedAt) {
    return {
        title: video.title,
        link: `https://www.youtube.com/watch?v=${video.videoId}`,
        description: video.description,
        date: normalizeDate(video.publishedAt),
        source: channelTitle,
        siteUrl: channelUrl,
        iconUrl: channelThumb,
        thumbnail: video.thumbnail,
        videoId: video.videoId,
        channelId,
        durationSeconds: Number.isFinite(video.durationSeconds) ? video.durationSeconds : null,
        embedWidth: Number.isFinite(video.embedWidth) ? video.embedWidth : null,
        embedHeight: Number.isFinite(video.embedHeight) ? video.embedHeight : null,
        shortForm: typeof video.shortForm === 'boolean' ? video.shortForm : null,
        fetchedAt,
    };
}

function mergeChannelInterviews(existingInterviews, fetchedVideos, channelTitle, channelUrl, channelThumb, channelId, fetchedAt) {
    const merged = new Map();

    for (const interview of existingInterviews) {
        const key = getInterviewKey(interview);
        if (!key || merged.has(key)) continue;
        merged.set(key, interview);
    }

    for (const video of fetchedVideos) {
        merged.set(
            video.videoId,
            createInterviewRecord(video, channelTitle, channelUrl, channelThumb, channelId, fetchedAt)
        );
    }

    return Array.from(merged.values());
}

async function main() {
    const forceFullFetch = process.argv.includes('--full');
    const rawChannels = readJson(CHANNELS_PATH, []);
    const channelUrls = Array.isArray(rawChannels)
        ? rawChannels.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
        : [];

    if (channelUrls.length === 0) {
        writeJson(OUTPUT_PATH, {
            lastUpdated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
            totalVideos: 0,
            interviews: [],
        });
        console.log('No interview channels configured; wrote empty interviews.json');
        return;
    }

    const apiKey = getYouTubeApiKey();
    if (!apiKey) {
        throw new Error('No YouTube API key. Set YOUTUBE_API_KEY or add youtube-credentials.json.');
    }

    const existingOutput = readJson(OUTPUT_PATH, null);
    const rawExistingInterviews = forceFullFetch
        ? []
        : (Array.isArray(existingOutput?.interviews) ? existingOutput.interviews : []);
    const {
        interviews: existingInterviews,
        shortCount: prunedExistingShorts,
        hydratedCount: hydratedExistingInterviews,
    } = forceFullFetch
        ? { interviews: [], shortCount: 0, hydratedCount: 0 }
        : await hydrateExistingInterviewsWithVideoDetails(rawExistingInterviews, apiKey);
    const existingIndexes = buildInterviewIndexes(existingInterviews);
    const cache = readJson(CACHE_PATH, {});
    const interviews = [];
    const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    if (!forceFullFetch && hydratedExistingInterviews > 0) {
        console.log(`Hydrated API video details for ${hydratedExistingInterviews} existing interviews`);
    }

    if (!forceFullFetch && prunedExistingShorts > 0) {
        console.log(`Pruned ${prunedExistingShorts} Shorts from existing interviews baseline`);
    }

    if (forceFullFetch) {
        console.log('Running full interview refresh for all configured channels');
    }

    for (const channelUrl of channelUrls) {
        console.log(`Resolving channel: ${channelUrl}`);
        const channelId = await resolveChannelId(channelUrl, apiKey, cache);
        await sleep(API_DELAY_MS);

        const meta = await getChannelMeta(channelId, apiKey);
        if (!meta) {
            console.warn(`  Skipping ${channelUrl} (channel metadata unavailable)`);
            continue;
        }

        const uploadsPlaylistId = meta.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) {
            console.warn(`  Skipping ${channelUrl} (uploads playlist unavailable)`);
            continue;
        }

        const channelTitle = meta.snippet?.title || channelUrl;
        const channelThumb =
            meta.snippet?.thumbnails?.default?.url ||
            meta.snippet?.thumbnails?.medium?.url ||
            meta.snippet?.thumbnails?.high?.url ||
            '';

        const existingChannelInterviews = getExistingChannelInterviews(existingIndexes, channelId, channelUrl);
        const knownVideoIds = new Set(
            existingChannelInterviews
                .map((interview) => interview?.videoId)
                .filter((videoId) => typeof videoId === 'string' && videoId)
        );
        const shouldFetchFullHistory = forceFullFetch || knownVideoIds.size === 0;

        console.log(
            shouldFetchFullHistory
                ? `  Fetching full upload history for ${channelTitle}${forceFullFetch ? ' (--full)' : ' (new channel)'}`
                : `  Fetching recent uploads for ${channelTitle} (${knownVideoIds.size} known videos)`
        );
        const { videos, stoppedAtKnownVideo, shortCount } = await getUploads(
            channelId,
            uploadsPlaylistId,
            apiKey,
            shouldFetchFullHistory ? undefined : { knownVideoIds }
        );

        console.log(
            shouldFetchFullHistory
                ? `    Retrieved ${videos.length} videos for full channel fetch${shortCount ? `, skipped ${shortCount} Shorts` : ''}`
                : `    Retrieved ${videos.length} new videos${stoppedAtKnownVideo ? ' before the first known upload' : ''}${shortCount ? `, skipped ${shortCount} Shorts` : ''}`
        );

        interviews.push(
            ...mergeChannelInterviews(
                existingChannelInterviews,
                videos,
                channelTitle,
                channelUrl,
                channelThumb,
                channelId,
                fetchedAt
            )
        );

        await sleep(API_DELAY_MS);
    }

    interviews.sort((a, b) => {
        const left = a.date || '';
        const right = b.date || '';
        if (left === right) return (a.title || '').localeCompare(b.title || '', 'en');
        return right.localeCompare(left);
    });

    writeJson(CACHE_PATH, cache);
    writeJson(OUTPUT_PATH, {
        lastUpdated: fetchedAt,
        totalVideos: interviews.length,
        interviews,
    });

    console.log(`Wrote interviews.json with ${interviews.length} videos from ${channelUrls.length} channel(s)`);
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});