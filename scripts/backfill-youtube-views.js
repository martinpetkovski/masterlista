/**
 * Backfill youtubeViews into chart-history JSON files.
 *
 * Starting from chart-data.json (current week with real YouTube views),
 * works backwards through each history file, estimating previous weeks' views:
 *
 *   views_thisWeek = max(0, views_nextWeek - spotifyPopularity * 800)
 *
 * Also copies spotifyPopularity from the existing popularity field
 * (which was Spotify-sourced in the original history files).
 *
 * Usage: node scripts/backfill-youtube-views.js
 */

const fs = require('fs');
const path = require('path');

const CHART_DATA = path.join(__dirname, '..', 'chart-data.json');
const HISTORY_DIR = path.join(__dirname, '..', 'chart-history');

// Load current chart-data.json (has real youtubeViews)
const chartData = JSON.parse(fs.readFileSync(CHART_DATA, 'utf8'));
const currentViews = new Map();
for (const r of chartData.releases) {
    currentViews.set(r.releaseId, r.youtubeViews || 0);
}
console.log(`Loaded chart-data.json: ${chartData.releases.length} releases`);

// Load history files sorted chronologically
const historyFiles = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.match(/^chart-\d{4}-W\d{2}\.json$/))
    .sort();

console.log(`Found ${historyFiles.length} history files: ${historyFiles.join(', ')}\n`);

// Work backwards: most recent history first
// nextWeekViews starts as chart-data.json views (the "future" of the most recent history)
let nextWeekViews = new Map(currentViews);

for (let i = historyFiles.length - 1; i >= 0; i--) {
    const filename = historyFiles[i];
    const filePath = path.join(HISTORY_DIR, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const releases = data.releases;

    const thisWeekViews = new Map();
    let backfilled = 0;
    let noFutureData = 0;

    for (const r of releases) {
        // The existing popularity field is the original Spotify popularity
        r.spotifyPopularity = r.popularity || 0;

        const futureViews = nextWeekViews.get(r.releaseId);
        if (futureViews !== undefined && futureViews > 0) {
            // Estimate this week's views by subtracting growth
            const estimated = Math.max(0, futureViews - r.spotifyPopularity * 800);
            r.youtubeViews = estimated;
            thisWeekViews.set(r.releaseId, estimated);
            backfilled++;
        } else {
            // No future data for this release — set to 0
            r.youtubeViews = 0;
            thisWeekViews.set(r.releaseId, 0);
            noFutureData++;
        }
    }

    // Save the updated history file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`${filename}: ${releases.length} releases, ${backfilled} backfilled, ${noFutureData} no future data`);

    // This week's views become the "future" for the previous week
    nextWeekViews = thisWeekViews;
}

console.log('\nDone! All chart-history files now have youtubeViews and spotifyPopularity.');
