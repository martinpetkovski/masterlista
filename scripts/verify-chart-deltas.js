const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT, 'data', 'dynamic', 'generated');
const RELEASES_FILE = path.join(ROOT, 'data', 'dynamic', 'editable', 'releases.json');
const SITE_MASTER_FILE = path.join(GENERATED_DIR, 'site-master.json');
const HISTORY_DIR = path.join(GENERATED_DIR, 'chart-history');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function getIsoWeekId(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getChartMondayFromWeekId(weekId) {
    const match = String(weekId || '').match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;

    const isoYear = Number(match[1]);
    const isoWeek = Number(match[2]);
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() + 1 - dow);

    const chartMonday = new Date(week1Monday);
    chartMonday.setUTCDate(week1Monday.getUTCDate() + 7 * (isoWeek - 1));
    return chartMonday;
}

function parseDateOnly(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setUTCHours(0, 0, 0, 0);
    return parsed;
}

function getReleaseDate(release) {
    return parseDateOnly(release?.effectiveReleaseDate || release?.releaseDate);
}

function getCurrentVerifiedVideoSnapshot(release) {
    const videoIds = [];
    const videoViews = new Map();
    const videoDates = new Map();
    const seen = new Set();

    for (const track of release?.youtubeTracks || []) {
        if (track?.verified !== 'verified' || !track.videoId || seen.has(track.videoId)) continue;
        seen.add(track.videoId);
        videoIds.push(track.videoId);
        videoViews.set(track.videoId, Number(track.views || 0));
        const publishedAt = parseDateOnly(track.publishedAt);
        if (publishedAt) videoDates.set(track.videoId, publishedAt);
    }

    return { videoIds, videoViews, videoDates };
}

function getArchiveVideoSnapshot(snapshotRelease, release) {
    const videoIds = Array.isArray(snapshotRelease?.youtubeVideoIds)
        ? snapshotRelease.youtubeVideoIds.filter(Boolean)
        : [];
    const videoViews = new Map();
    const videoDates = getCurrentVerifiedVideoSnapshot(release).videoDates;

    if (snapshotRelease?.youtubeVideoViews) {
        for (const [videoId, views] of Object.entries(snapshotRelease.youtubeVideoViews)) {
            videoViews.set(videoId, Number(views || 0));
        }
    }

    if (videoViews.size === 0) {
        const currentSnapshot = getCurrentVerifiedVideoSnapshot(release);
        for (const videoId of videoIds) {
            videoViews.set(videoId, Number(currentSnapshot.videoViews.get(videoId) || 0));
        }
    }

    return { videoIds, videoViews, videoDates };
}

function decodeCompactTable(table) {
    if (Array.isArray(table)) return table;
    if (!table?._cols || !table?._rows) return [];
    return table._rows.map(row => Object.fromEntries(table._cols.map((column, index) => [column, row[index]])));
}

function loadArchiveWeeks() {
    if (!fs.existsSync(HISTORY_DIR)) return [];
    return fs.readdirSync(HISTORY_DIR)
        .filter(file => /^chart-\d{4}-W\d{2}\.json$/.test(file))
        .sort()
        .map(file => ({
            file,
            weekId: file.replace(/^chart-/, '').replace(/\.json$/, ''),
            ...readJson(path.join(HISTORY_DIR, file))
        }));
}

function selectLiveBaseline(weeks, now = new Date()) {
    const latest = weeks[weeks.length - 1] || null;
    const previous = weeks[weeks.length - 2] || null;
    const currentWeekId = getIsoWeekId(now);
    if (now.getDay() === 1 && latest?.weekId === currentWeekId && previous) return previous;
    return latest;
}

function selectVerificationSource(siteMaster, weeks) {
    const weekById = new Map(weeks.map(week => [week.weekId, week]));

    if (siteMaster.chartData?.isFrozenFallback && siteMaster.chartData?.displayWeekId) {
        const displayWeek = weekById.get(siteMaster.chartData.displayWeekId);
        const displayIndex = weeks.findIndex(week => week.weekId === siteMaster.chartData.displayWeekId);
        const baselineWeek = displayIndex > 0 ? weeks[displayIndex - 1] : null;
        if (displayWeek && baselineWeek) {
            return {
                mode: 'frozen',
                sourceWeek: displayWeek,
                baselineWeek,
            };
        }
    }

    const baselineWeek = weekById.get(siteMaster.chartData?.baselineWeekId) || selectLiveBaseline(weeks);
    return {
        mode: 'live',
        sourceWeek: null,
        baselineWeek,
    };
}

function isSameDay(left, right) {
    return !!(left && right && left.getTime() === right.getTime());
}

function getBaselineVideoViewsMap(snapshotRelease) {
    const viewsMap = new Map();
    if (!snapshotRelease?.youtubeVideoViews) return viewsMap;
    for (const [videoId, views] of Object.entries(snapshotRelease.youtubeVideoViews)) {
        viewsMap.set(videoId, Number(views || 0));
    }
    return viewsMap;
}

function expectedLiveDelta(release, baselineRelease, baselineMonday) {
    const currentViews = Number(release?.youtubeViews || 0);
    if (currentViews <= 0) return null;

    const releaseDate = getReleaseDate(release);
    const currentSnapshot = getCurrentVerifiedVideoSnapshot(release);
    const currentVideoIds = currentSnapshot.videoIds;

    if (releaseDate && baselineMonday && releaseDate >= baselineMonday) {
        let releaseWeekViews = 0;
        for (const videoId of currentVideoIds) {
            const publishedAt = currentSnapshot.videoDates.get(videoId);
            if (publishedAt && publishedAt >= baselineMonday && isSameDay(publishedAt, releaseDate)) {
                releaseWeekViews += Number(currentSnapshot.videoViews.get(videoId) || 0);
            }
        }
        return releaseWeekViews > 0 ? releaseWeekViews : null;
    }

    if (!baselineRelease) return null;

    const baselineViews = Number(baselineRelease.youtubeViews || 0);
    const baselineVideoIds = Array.isArray(baselineRelease.youtubeVideoIds)
        ? baselineRelease.youtubeVideoIds.filter(Boolean)
        : [];
    const baselineVideoViews = getBaselineVideoViewsMap(baselineRelease);
    const hasBaselineVideoViews = baselineVideoViews.size > 0;

    if (baselineVideoIds.length === 0) {
        return currentVideoIds.length > 0 ? 0 : Math.max(0, currentViews - baselineViews);
    }

    const baselineVideoIdSet = new Set(baselineVideoIds);
    let comparableViews = 0;
    let baselineComparableViews = 0;
    for (const videoId of currentVideoIds) {
        const publishedAt = currentSnapshot.videoDates.get(videoId);
        const releaseWeekVideo = publishedAt && baselineMonday && publishedAt >= baselineMonday && isSameDay(publishedAt, releaseDate);
        if (baselineVideoIdSet.has(videoId) || releaseWeekVideo) {
            let baselineVideoViewsForDelta = 0;
            if (baselineVideoIdSet.has(videoId) && hasBaselineVideoViews) {
                baselineVideoViewsForDelta = baselineVideoViews.has(videoId) ? Number(baselineVideoViews.get(videoId) || 0) : null;
                const hasTrustedBaselineVideoViews = baselineVideoViewsForDelta !== null && (baselineVideoViewsForDelta > 0 || (publishedAt && baselineMonday && publishedAt >= baselineMonday));
                if (!hasTrustedBaselineVideoViews) continue;
            }
            comparableViews += Number(currentSnapshot.videoViews.get(videoId) || 0);
            if (baselineVideoIdSet.has(videoId) && hasBaselineVideoViews) {
                baselineComparableViews += baselineVideoViewsForDelta;
            }
        }
    }

    return Math.max(0, comparableViews - (hasBaselineVideoViews ? baselineComparableViews : baselineViews));
}

function expectedArchiveDelta(snapshotRelease, release, baselineRelease, baselineMonday) {
    const snapshotViews = Number(snapshotRelease?.youtubeViews || 0);
    if (snapshotViews <= 0) return null;

    const releaseDate = getReleaseDate(release);
    const snapshot = getArchiveVideoSnapshot(snapshotRelease, release);

    if (releaseDate && baselineMonday && releaseDate >= baselineMonday) {
        let releaseWeekViews = 0;
        for (const videoId of snapshot.videoIds) {
            const publishedAt = snapshot.videoDates.get(videoId);
            if (publishedAt && publishedAt >= baselineMonday && isSameDay(publishedAt, releaseDate)) {
                releaseWeekViews += Number(snapshot.videoViews.get(videoId) || 0);
            }
        }
        return releaseWeekViews > 0 ? releaseWeekViews : null;
    }

    if (!baselineRelease) return null;

    const baselineViews = Number(baselineRelease.youtubeViews || 0);
    const baselineVideoIds = Array.isArray(baselineRelease.youtubeVideoIds)
        ? baselineRelease.youtubeVideoIds.filter(Boolean)
        : [];
    const baselineVideoViews = getBaselineVideoViewsMap(baselineRelease);
    const hasBaselineVideoViews = baselineVideoViews.size > 0;

    if (snapshot.videoIds.length > 0 && baselineVideoIds.length === 0) return 0;
    if (snapshot.videoIds.length === 0) return Math.max(0, snapshotViews - baselineViews);

    const baselineVideoIdSet = new Set(baselineVideoIds);
    const hasSnapshotVideoViews = !!(snapshotRelease?.youtubeVideoViews && Object.keys(snapshotRelease.youtubeVideoViews).length > 0);
    if (!hasSnapshotVideoViews && !hasBaselineVideoViews && snapshot.videoIds.every(videoId => baselineVideoIdSet.has(videoId))) {
        return Math.max(0, snapshotViews - baselineViews);
    }

    let comparableViews = 0;
    let baselineComparableViews = 0;
    for (const videoId of snapshot.videoIds) {
        const publishedAt = snapshot.videoDates.get(videoId);
        const releaseWeekVideo = publishedAt && baselineMonday && publishedAt >= baselineMonday && isSameDay(publishedAt, releaseDate);
        if (baselineVideoIdSet.has(videoId) || releaseWeekVideo) {
            let baselineVideoViewsForDelta = 0;
            if (baselineVideoIdSet.has(videoId) && hasBaselineVideoViews) {
                baselineVideoViewsForDelta = baselineVideoViews.has(videoId) ? Number(baselineVideoViews.get(videoId) || 0) : null;
                const hasTrustedBaselineVideoViews = baselineVideoViewsForDelta !== null && (baselineVideoViewsForDelta > 0 || (publishedAt && baselineMonday && publishedAt >= baselineMonday));
                if (!hasTrustedBaselineVideoViews) continue;
            }
            comparableViews += Number(snapshot.videoViews.get(videoId) || 0);
            if (baselineVideoIdSet.has(videoId) && hasBaselineVideoViews) {
                baselineComparableViews += baselineVideoViewsForDelta;
            }
        }
    }

    return Math.max(0, comparableViews - (hasBaselineVideoViews ? baselineComparableViews : baselineViews));
}

function main() {
    const releases = readJson(RELEASES_FILE).releases || [];
    const releaseById = new Map(releases.map(release => [release.releaseId, release]));
    const siteMaster = readJson(SITE_MASTER_FILE);
    const siteReleases = decodeCompactTable(siteMaster.chartData?.releases);
    const weeks = loadArchiveWeeks();
    const verificationSource = selectVerificationSource(siteMaster, weeks);
    const baseline = verificationSource.baselineWeek;
    if (!baseline) throw new Error('No chart-history baseline found.');

    const baselineMonday = getChartMondayFromWeekId(baseline.weekId);
    const baselineById = new Map((baseline.releases || []).map(release => [release.releaseId, release]));
    const sourceById = new Map((verificationSource.sourceWeek?.releases || []).map(release => [release.releaseId, release]));
    const failures = [];

    for (const siteRelease of siteReleases) {
        const release = releaseById.get(siteRelease.releaseId);
        if (!release) continue;
        const actualDelta = siteRelease.viewsDelta == null ? null : Number(siteRelease.viewsDelta);
        if (!Number.isFinite(actualDelta) || actualDelta <= 0) continue;

        const sourceRelease = sourceById.get(siteRelease.releaseId);
        const expectedDelta = verificationSource.mode === 'frozen'
            ? expectedArchiveDelta(sourceRelease, release, baselineById.get(siteRelease.releaseId), baselineMonday)
            : expectedLiveDelta(release, baselineById.get(siteRelease.releaseId), baselineMonday);
        const expectedNumber = expectedDelta == null ? null : Number(expectedDelta);
        if (expectedNumber == null || actualDelta > expectedNumber) {
            failures.push({
                releaseId: siteRelease.releaseId,
                artist: release.bandName,
                title: release.releaseTitle,
                actualDelta,
                expectedDelta: expectedNumber,
            });
        }
    }

    if (failures.length > 0) {
        const sourceLabel = verificationSource.mode === 'frozen'
            ? `${verificationSource.sourceWeek.weekId} display against ${baseline.weekId}`
            : baseline.weekId;
        console.error(`Chart delta verification failed against ${sourceLabel}:`);
        for (const failure of failures.slice(0, 25)) {
            console.error(`- ${failure.releaseId} | ${failure.artist} - ${failure.title}: actual ${failure.actualDelta}, allowed ${failure.expectedDelta}`);
        }
        if (failures.length > 25) console.error(`...and ${failures.length - 25} more`);
        process.exit(1);
    }

    const sourceLabel = verificationSource.mode === 'frozen'
        ? `${verificationSource.sourceWeek.weekId} display against ${baseline.weekId}`
        : baseline.weekId;
    console.log(`Chart delta verification passed against ${sourceLabel} (${siteReleases.length} releases checked).`);
}

main();