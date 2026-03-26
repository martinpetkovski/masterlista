/**
 * Sync chart-data.json youtubeViews from releases.json.
 * Uses the youtubeViews field computed by generate-chart-data-youtube.js
 * (which has correct global video deduplication).
 * Called by generate-site-master.ps1 to pick up newly verified links.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const chartPath = path.join(root, 'chart-data.json');
const releasesPath = path.join(root, 'releases.json');

let cdRaw = fs.readFileSync(chartPath, 'utf8');
if (cdRaw.charCodeAt(0) === 0xFEFF) cdRaw = cdRaw.slice(1);
const cd = JSON.parse(cdRaw);
let rlRaw = fs.readFileSync(releasesPath, 'utf8');
if (rlRaw.charCodeAt(0) === 0xFEFF) rlRaw = rlRaw.slice(1);
const rl = JSON.parse(rlRaw);

// Build release lookup from releases.json
const rMap = new Map();
for (const r of rl.releases) {
    rMap.set(r.releaseId, r);
}

let updated = 0;
for (const cr of cd.releases) {
    const rel = rMap.get(cr.releaseId);
    // Use releases.json's youtubeViews (computed by youtube script with global dedup)
    const correctViews = rel?.youtubeViews || 0;
    if (correctViews !== (cr.youtubeViews || 0)) {
        cr.youtubeViews = correctViews;
        updated++;
    }
}

// Add releases that exist in releases.json but are missing from chart-data.json
const cdSet = new Set(cd.releases.map(r => r.releaseId));
let added = 0;
for (const r of rl.releases) {
    if (!cdSet.has(r.releaseId)) {
        cd.releases.push({
            releaseId: r.releaseId,
            popularity: 0,
            followers: 0,
            youtubeViews: r.youtubeViews || 0,
            spotifyPopularity: 0,
            youtubeTrackCount: r.youtubeTracks?.length || 0
        });
        added++;
    }
}

if (updated > 0 || added > 0) {
    cd.totalReleases = cd.releases.length;
    cd.generatedAt = new Date().toISOString();
    fs.writeFileSync(chartPath, JSON.stringify(cd, null, 2), 'utf8');
    if (updated > 0) console.log(`  > Updated ${updated} releases in chart-data.json`);
    if (added > 0) console.log(`  > Added ${added} missing releases to chart-data.json`);
}
