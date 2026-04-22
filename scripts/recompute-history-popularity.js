/**
 * Recompute 'popularity' in all chart-history files using YouTube view deltas.
 *
 * After backfill-youtube-views.js added youtubeViews to history files,
 * the 'popularity' field still contained old Spotify values.
 * This script recomputes it using the same formula as generate-chart-data-youtube.js:
 *
 *   delta = max(0, thisWeek.youtubeViews - prevWeek.youtubeViews)
 *   popularity = round(delta / maxDelta * 100)   (separate max for singles vs albums)
 *
 * For the earliest week (W03), there's no previous week → delta = 0 → popularity = 0
 * for all releases (unless they have no youtubeViews, in which case spotifyPopularity is used).
 *
 * Usage: node scripts/recompute-history-popularity.js
 */

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'data', 'dynamic', 'generated', 'chart-history');

function computePopularities(releases) {
    const maxDeltas = { single: 0, album: 0 };
    for (const r of releases) {
        const type = r.releaseType === 'album' ? 'album' : 'single';
        if (r._viewDelta > maxDeltas[type]) maxDeltas[type] = r._viewDelta;
    }

    for (const r of releases) {
        const type = r.releaseType === 'album' ? 'album' : 'single';
        const maxDelta = maxDeltas[type];
        r.popularity = (r._viewDelta > 0 && maxDelta > 0)
            ? Math.min(100, Math.round((r._viewDelta / maxDelta) * 100))
            : 0;
    }

    return maxDeltas;
}

// Load history files sorted chronologically
const historyFiles = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.match(/^chart-\d{4}-W\d{2}\.json$/))
    .sort();

console.log(`Found ${historyFiles.length} history files: ${historyFiles.join(', ')}\n`);

// Load all history data
const weeks = historyFiles.map(filename => {
    const filePath = path.join(HISTORY_DIR, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { filename, filePath, data };
});

// Process each week: compute delta from previous week, then normalize
for (let i = 0; i < weeks.length; i++) {
    const { filename, filePath, data } = weeks[i];
    const releases = data.releases;

    // Build previous week's views map (if any)
    let prevViewsMap = null;
    if (i > 0) {
        prevViewsMap = new Map();
        for (const r of weeks[i - 1].data.releases) {
            prevViewsMap.set(r.releaseId, r.youtubeViews || 0);
        }
    }

    let withDelta = 0;
    let usedSpotify = 0;

    for (const r of releases) {
        const hasYT = r.youtubeViews !== undefined && r.youtubeViews > 0;

        if (!hasYT) {
            // No YouTube views — use spotifyPopularity as fallback
            r.popularity = r.spotifyPopularity || 0;
            r._viewDelta = 0;
            usedSpotify++;
            continue;
        }

        if (prevViewsMap) {
            const prevViews = prevViewsMap.get(r.releaseId);
            if (prevViews !== undefined) {
                r._viewDelta = Math.max(0, r.youtubeViews - prevViews);
            } else {
                // Not in previous week — no delta baseline
                r._viewDelta = 0;
            }
        } else {
            // First week — no previous data
            r._viewDelta = 0;
        }
        withDelta++;
    }

    // Normalize deltas to 0-100 (separate max for singles/albums)
    // Only apply to releases that have YouTube data
    const ytReleases = releases.filter(r => r._viewDelta !== undefined && (r.youtubeViews || 0) > 0);
    const maxDeltas = computePopularities(ytReleases);

    // Clean up temp field
    for (const r of releases) {
        delete r._viewDelta;
    }

    // Save
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

    const nonZeroPop = releases.filter(r => r.popularity > 0).length;
    console.log(`${filename}: ${releases.length} releases, ${withDelta} with YT delta, ${usedSpotify} Spotify fallback, ${nonZeroPop} non-zero popularity (maxDelta single=${maxDeltas.single}, album=${maxDeltas.album})`);
}

console.log('\nDone! All chart-history files now have YouTube-delta-based popularity.');
