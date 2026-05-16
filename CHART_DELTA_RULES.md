# Chart Delta Rules

This project ranks current charts by `viewsDelta`, not by total YouTube views. The delta must represent views gained during the current chart window only.

## Baseline

- The live baseline is the newest usable file in `data/dynamic/generated/chart-history/`.
- On Monday, if the newest archive is the current ISO week, it is today's snapshot and must not be used as the live baseline. Use the previous archive instead.
- The chart window starts at the baseline week's Monday.

## YouTube Video Snapshot Rule

- A YouTube video's views may count toward `viewsDelta` only if that same `videoId` existed in the baseline snapshot for the same `releaseId`.
- If a video is newly added to an older song/release and that `videoId` was not in the baseline snapshot, its historical views must not be counted this week.
- If the current row has `youtubeVideoIds` but the baseline row has no `youtubeVideoIds`, do not fall back to `current youtubeViews - baseline youtubeViews`. Use `0` delta for that release until the next weekly snapshot creates a comparable video baseline.
- If the release itself is new in the current chart window, only videos uploaded on the release date can count as the release-week delta.
- Videos uploaded during the chart window for an older release, but not on that release's date, are deferred until the next Monday snapshot.

## Generated Data Contract

- `chart-history/chart-YYYY-WNN.json` is the durable baseline source. It should keep `youtubeVideoIds` and `youtubeVideoViews` for each release whenever YouTube views are present.
- `chart-data.json` may omit per-video fields for size, so generators must reconstruct current video IDs from verified `youtubeTracks` when needed.
- `generate-chart-data-youtube.js` and `generate-site-master.ps1` must use the same baseline and video-snapshot rules.
- `sync-chart-views.js` must not create inflated deltas by copying new total views without a comparable baseline.

## Guardrail

Run this before publishing chart changes:

```powershell
npm run verify:chart-deltas
```

The verifier checks generated site chart deltas against the active chart metadata. For live charts it uses the live baseline; for frozen fallback displays it checks the displayed archive against that archive's previous baseline. It fails if a positive delta depends on YouTube videos that were not present in the relevant baseline snapshot.