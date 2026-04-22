/**
 * Check YouTube link verification status in releases.json.
 * 
 * Exit codes:
 *   0 — All links verified (or no YouTube links at all)
 *   1 — Unverified links remain
 * 
 * Output: JSON with counts on stdout.
 */

const fs = require('fs');
const path = require('path');

const RELEASES_FILE = path.join(__dirname, '..', 'data', 'dynamic', 'editable', 'releases.json');

if (!fs.existsSync(RELEASES_FILE)) {
    console.error('releases.json not found');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8'));
const releases = data.releases || [];

let verified = 0, unverified = 0, willNotVerify = 0, noYt = 0;

for (const r of releases) {
    if (!r.youtubeTracks || r.youtubeTracks.length === 0) {
        noYt++;
        continue;
    }
    for (const t of r.youtubeTracks) {
        if (t.verified === 'verified') verified++;
        else if (t.verified === 'will-not-verify') willNotVerify++;
        else unverified++;
    }
}

console.log(JSON.stringify({ verified, unverified, willNotVerify, releasesWithoutYt: noYt }));
process.exit(unverified > 0 ? 1 : 0);
