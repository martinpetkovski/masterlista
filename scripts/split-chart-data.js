/**
 * One-time migration script: Split chart-data.json into releases.json + chart-data.json
 *
 * releases.json  — static release catalog (metadata + youtube track links with verified flag)
 * chart-data.json — weekly popularity/views data only
 *
 * Run:  node scripts/split-chart-data.js
 */

const fs = require('fs');
const path = require('path');

const CHART_DATA = path.join(__dirname, '..', 'chart-data.json');
const RELEASES_FILE = path.join(__dirname, '..', 'releases.json');

if (!fs.existsSync(CHART_DATA)) {
    console.error('chart-data.json not found.');
    process.exit(1);
}

const chartData = JSON.parse(fs.readFileSync(CHART_DATA, 'utf8'));
const releases = chartData.releases || [];

console.log(`Loaded ${releases.length} releases from chart-data.json`);

// Build releases.json (catalog data)
const releaseCatalog = releases.map(r => {
    const entry = {
        bandName: r.bandName,
        ...(r.spotifyName ? { spotifyName: r.spotifyName } : {}),
        artistId: r.artistId,
        releaseId: r.releaseId,
        releaseTitle: r.releaseTitle,
        releaseType: r.releaseType,
        releaseDate: r.releaseDate,
        releaseUrl: r.releaseUrl,
        thumbnail: r.thumbnail,
        totalTracks: r.totalTracks,
        ...(r.trackNames ? { trackNames: r.trackNames } : {}),
        spotifyUrl: r.spotifyUrl
    };

    // Convert existing youtubeTracks: add verified=false (auto-matched)
    if (r.youtubeTracks && r.youtubeTracks.length > 0) {
        entry.youtubeTracks = r.youtubeTracks.map(t => ({
            name: t.name,
            videoId: t.videoId,
            url: t.url,
            verified: false
        }));
    }

    return entry;
});

// Build new chart-data.json (weekly views/popularity only)
const weeklyData = releases.map(r => {
    const entry = {
        releaseId: r.releaseId,
        popularity: r.popularity || 0,
        followers: r.followers || 0,
        youtubeViews: r.youtubeViews || 0,
        spotifyPopularity: r.spotifyPopularity || 0
    };
    return entry;
});

// Write releases.json
const releasesOutput = {
    generatedAt: chartData.generatedAt,
    totalReleases: releaseCatalog.length,
    totalArtists: chartData.totalArtists,
    releases: releaseCatalog
};
fs.writeFileSync(RELEASES_FILE, JSON.stringify(releasesOutput, null, 2), 'utf8');
console.log(`Wrote ${releaseCatalog.length} releases to releases.json`);

// Write new chart-data.json
const newChartData = {
    generatedAt: chartData.generatedAt,
    totalReleases: weeklyData.length,
    totalArtists: chartData.totalArtists,
    releases: weeklyData
};
fs.writeFileSync(CHART_DATA, JSON.stringify(newChartData, null, 2), 'utf8');
console.log(`Wrote ${weeklyData.length} entries to chart-data.json (weekly data only)`);

// Stats
const withYt = releaseCatalog.filter(r => r.youtubeTracks && r.youtubeTracks.length > 0).length;
console.log(`\nSummary:`);
console.log(`  Releases with YouTube tracks: ${withYt}/${releaseCatalog.length}`);
console.log(`  All YouTube tracks marked as verified=false (auto-matched)`);
console.log(`\nMigration complete. You can now run the verification page to verify links.`);
