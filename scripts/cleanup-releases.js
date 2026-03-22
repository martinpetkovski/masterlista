// cleanup-releases.js
// Removes releases from releases.json whose artistId no longer matches any artist in bands.json.
// This handles artists that have been deleted from the master lista.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bandsPath = path.join(root, 'bands.json');
const releasesPath = path.join(root, 'releases.json');

// Build set of Spotify artist IDs from bands.json
const bands = JSON.parse(fs.readFileSync(bandsPath, 'utf8')).muzickaMasterLista;
const artistIds = new Set();
for (const band of bands) {
    const spotifyUrl = band.links && band.links.spotify;
    if (spotifyUrl) {
        const m = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/);
        if (m) artistIds.add(m[1]);
    }
}

// Filter releases
const data = JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
const before = data.releases.length;
const removed = [];

data.releases = data.releases.filter(r => {
    if (artistIds.has(r.artistId)) return true;
    removed.push(`${r.bandName} - ${r.releaseTitle} (${r.artistId})`);
    return false;
});

const after = data.releases.length;

if (removed.length === 0) {
    console.log('No orphaned releases found. releases.json is clean.');
    process.exit(0);
}

// Log removed entries grouped by artist
const byArtist = {};
for (const entry of removed) {
    const name = entry.split(' - ')[0];
    byArtist[name] = (byArtist[name] || 0) + 1;
}
for (const [name, count] of Object.entries(byArtist)) {
    console.log(`Removed ${count} releases from: ${name}`);
}
console.log(`Total: ${before} → ${after} releases (removed ${removed.length})`);

// Update metadata and write
data.totalReleases = data.releases.length;
const artistsRemaining = new Set(data.releases.map(r => r.artistId));
data.totalArtists = artistsRemaining.size;

fs.writeFileSync(releasesPath, JSON.stringify(data, null, 2), 'utf8');
console.log('releases.json updated.');
