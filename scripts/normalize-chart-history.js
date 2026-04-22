/**
 * Normalize chart-history popularity data for W03-W07
 * 
 * Before W08, popularity was calculated as the max track popularity
 * (highest individual track popularity in a release).
 * From W08 onward, popularity uses Spotify's album-level popularity.
 * 
 * This script converts W03-W07 popularity values to the album-popularity
 * scale using linear regressions derived from overlapping releases in
 * W07 (old formula) and W08 (new formula):
 * 
 *   Singles: new_pop = 0.6908 * old_pop - 3.3027  (R² = 0.937)
 *   Albums:  new_pop = 0.8032 * old_pop - 0.5405  (R² = 0.922)
 * 
 * Also removes legacy topTrack* fields not present in the new format.
 */

const fs = require('fs');
const path = require('path');

const WEEKS_TO_NORMALIZE = ['W03', 'W04', 'W05', 'W06', 'W07'];

// Regression coefficients from W07→W08 matched-release analysis
const REGRESSIONS = {
  single: { slope: 0.6908, intercept: -3.3027 },
  album:  { slope: 0.8032, intercept: -0.5405 }
};

// Fields to remove (not present in W08+ format)
const FIELDS_TO_REMOVE = ['topTrackName', 'topTrackId', 'topTrackPopularity', 'topTrackUrl'];

function convertPopularity(oldPop, releaseType) {
  if (oldPop === 0) return 0;

  // Use album regression for anything that's not a single (albums, compilations, EPs)
  const reg = releaseType === 'single' ? REGRESSIONS.single : REGRESSIONS.album;
  const newPop = Math.max(0, Math.round(reg.slope * oldPop + reg.intercept));
  return newPop;
}

function normalizeFile(weekLabel) {
  const filePath = path.join(__dirname, '..', 'data', 'dynamic', 'generated', 'chart-history', `chart-2026-${weekLabel}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${weekLabel}: file not found`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  let converted = 0;
  let zeroed = 0;
  let alreadyZero = 0;
  let unchanged = 0;

  data.releases = data.releases.map(release => {
    const oldPop = release.popularity;
    const newPop = convertPopularity(oldPop, release.releaseType);

    if (oldPop === 0) {
      alreadyZero++;
    } else if (newPop === 0) {
      zeroed++;
    } else if (newPop !== oldPop) {
      converted++;
    } else {
      unchanged++;
    }

    // Build new release object without legacy fields
    const cleaned = {};
    for (const [key, value] of Object.entries(release)) {
      if (!FIELDS_TO_REMOVE.includes(key)) {
        cleaned[key] = value;
      }
    }
    cleaned.popularity = newPop;

    return cleaned;
  });

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');

  console.log(`${weekLabel}: ${data.releases.length} releases — ${converted} converted, ${zeroed} zeroed out, ${alreadyZero} already zero, ${unchanged} unchanged`);
}

// Run normalization
console.log('Normalizing chart-history popularity (max-track-pop → album-pop scale)');
console.log('Regressions used:');
console.log(`  Singles: new = ${REGRESSIONS.single.slope} * old + ${REGRESSIONS.single.intercept}`);
console.log(`  Albums:  new = ${REGRESSIONS.album.slope} * old + ${REGRESSIONS.album.intercept}`);
console.log('');

for (const week of WEEKS_TO_NORMALIZE) {
  normalizeFile(week);
}

console.log('\nDone. Legacy topTrack* fields removed.');
