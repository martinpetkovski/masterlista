#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASES_REPO_PATH = 'data/dynamic/editable/releases.json';
const RELEASES_FILE = path.join(ROOT, ...RELEASES_REPO_PATH.split('/'));
const STATUS_PRIORITY = {
  unverified: 0,
  'will-not-verify': 1,
  verified: 2
};

function parseArgs(argv) {
  const args = { from: '', write: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--from' && argv[index + 1]) {
      args.from = argv[++index];
    } else if (argv[index] === '--write') {
      args.write = true;
    }
  }
  if (!args.from) {
    throw new Error('Usage: node scripts/restore-youtube-verification.js --from <git-revision> [--write]');
  }
  return args;
}

function readHistoricalCatalog(revision) {
  const result = spawnSync('git', ['show', `${revision}:${RELEASES_REPO_PATH}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `Could not read releases.json at ${revision}`);
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}

function buildHistoricalTrackMap(releases) {
  const tracksByVideoId = new Map();
  for (const release of releases || []) {
    for (const track of release.youtubeTracks || []) {
      if (!track.videoId || !STATUS_PRIORITY.hasOwnProperty(track.verified)) continue;
      const existing = tracksByVideoId.get(track.videoId);
      if (!existing || STATUS_PRIORITY[track.verified] > STATUS_PRIORITY[existing.verified]) {
        tracksByVideoId.set(track.videoId, track);
      }
    }
  }
  return tracksByVideoId;
}

function buildHistoricalReleaseTrackMap(releases) {
  const tracksByReleaseId = new Map();
  for (const release of releases || []) {
    if (!release.releaseId) continue;
    const tracksByVideoId = new Map();
    for (const track of release.youtubeTracks || []) {
      if (
        !track.videoId ||
        (track.verified !== 'verified' && track.verified !== 'will-not-verify')
      ) {
        continue;
      }
      const existing = tracksByVideoId.get(track.videoId);
      if (!existing || STATUS_PRIORITY[track.verified] > STATUS_PRIORITY[existing.verified]) {
        tracksByVideoId.set(track.videoId, track);
      }
    }
    if (tracksByVideoId.size > 0) {
      tracksByReleaseId.set(release.releaseId, tracksByVideoId);
    }
  }
  return tracksByReleaseId;
}

function countStatuses(releases) {
  const counts = { verified: 0, unverified: 0, willNotVerify: 0 };
  for (const release of releases || []) {
    for (const track of release.youtubeTracks || []) {
      if (track.verified === 'verified') counts.verified++;
      else if (track.verified === 'will-not-verify') counts.willNotVerify++;
      else counts.unverified++;
    }
  }
  return counts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const current = JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const historical = readHistoricalCatalog(args.from);
  const historicalTracks = buildHistoricalTrackMap(historical.releases);
  const historicalReleaseTracks = buildHistoricalReleaseTrackMap(historical.releases);
  let restoredVerified = 0;
  let restoredWillNotVerify = 0;
  let restoredMissingVerifiedTracks = 0;
  let restoredMissingWillNotVerifyTracks = 0;
  let noHistoricalMatch = 0;

  for (const release of current.releases || []) {
    if (!Array.isArray(release.youtubeTracks)) release.youtubeTracks = [];
    for (const track of release.youtubeTracks || []) {
      const oldTrack = historicalTracks.get(track.videoId);
      if (!oldTrack || oldTrack.verified === 'unverified') {
        noHistoricalMatch++;
        continue;
      }
      if (track.verified === oldTrack.verified) continue;

      track.verified = oldTrack.verified;
      if (!track.views && oldTrack.views) track.views = oldTrack.views;
      if (!track.publishedAt && oldTrack.publishedAt) track.publishedAt = oldTrack.publishedAt;
      if (oldTrack.verified === 'verified') restoredVerified++;
      else restoredWillNotVerify++;
    }

    const oldReleaseTracks = historicalReleaseTracks.get(release.releaseId);
    if (oldReleaseTracks) {
      const currentVideoIds = new Set(release.youtubeTracks.map(track => track.videoId).filter(Boolean));
      for (const [videoId, oldTrack] of oldReleaseTracks) {
        if (currentVideoIds.has(videoId)) continue;
        release.youtubeTracks.push({ ...oldTrack });
        currentVideoIds.add(videoId);
        if (oldTrack.verified === 'verified') restoredMissingVerifiedTracks++;
        else restoredMissingWillNotVerifyTracks++;
      }
    }

    if (release.youtubeTracks.length === 0) delete release.youtubeTracks;
  }

  const result = {
    sourceRevision: args.from,
    restoredVerified,
    restoredWillNotVerify,
    restoredMissingVerifiedTracks,
    restoredMissingWillNotVerifyTracks,
    noHistoricalMatch,
    statuses: countStatuses(current.releases),
    wroteFile: args.write
  };

  if (args.write) {
    fs.writeFileSync(RELEASES_FILE, JSON.stringify(current, null, 2), 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
