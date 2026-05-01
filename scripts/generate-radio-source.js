#!/usr/bin/env node
// Generates radio-source.json candidate pools for the browser radio page.
// This script only uses metadata and provider IDs. It must not download or cache media.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'automation', 'radio-stations.json');
const EDITABLE_DIR = path.join(ROOT, 'data', 'dynamic', 'editable');
const GENERATED_DIR = path.join(ROOT, 'data', 'dynamic', 'generated');
const BANDS_PATH = path.join(EDITABLE_DIR, 'bands.json');
const RELEASES_PATH = path.join(EDITABLE_DIR, 'releases.json');
const CHART_PATH = path.join(GENERATED_DIR, 'chart-data.json');
const INTERVIEWS_PATH = path.join(GENERATED_DIR, 'interviews.json');
const FILTERED_INTERVIEWS_PATH = path.join(GENERATED_DIR, 'interviews-filtered.json');
const CHART_GENRES_PATH = path.join(ROOT, 'data', 'static', 'chart-genres.json');
const OUTPUT_PATH = path.join(GENERATED_DIR, 'radio-source.json');

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function splitArtists(value) {
  return String(value || '')
    .split(/,|&| feat\.? | ft\.? | x | X | and | и /)
    .map(name => name.trim())
    .filter(Boolean);
}

function makeArtistGenreMap(bands) {
  const map = new Map();
  for (const artist of bands || []) {
    const key = normalizeName(artist.name);
    if (!key) continue;
    map.set(key, String(artist.genre || '').trim());
  }
  return map;
}

function getArtistGenres(artistNames, artistGenreMap) {
  const genres = [];
  const seen = new Set();
  for (const artistName of artistNames) {
    const genre = artistGenreMap.get(normalizeName(artistName));
    if (!genre) continue;
    for (const part of genre.split(',')) {
      const clean = part.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        genres.push(clean);
      }
    }
  }
  return genres;
}

function makeChartGenreConfig(chartGenres) {
  const rap = new Set((chartGenres.rap || []).map(genre => String(genre || '').trim().toLowerCase()).filter(Boolean));
  const electronic = new Set((chartGenres.electronic || []).map(genre => String(genre || '').trim().toLowerCase()).filter(Boolean));
  const pop = new Set((chartGenres.pop || []).map(genre => String(genre || '').trim().toLowerCase()).filter(Boolean));
  const altExplicit = new Set((chartGenres.alternative || []).map(genre => String(genre || '').trim().toLowerCase()).filter(Boolean));
  const nonAlt = new Set([...rap, ...electronic, ...pop]);
  return { altExplicit, nonAlt };
}

function getPrimaryArtistGenres(artistName, artistNames, artistGenreMap) {
  const exactGenre = artistGenreMap.get(normalizeName(artistName));
  if (exactGenre) return exactGenre.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  const firstArtist = artistNames[0] ? artistGenreMap.get(normalizeName(artistNames[0])) : '';
  return String(firstArtist || '').split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
}

function matchesAlternativeChart(primaryGenres, chartGenreConfig) {
  if (!primaryGenres.length) return false;
  let matchesAlt = true;
  let explicitAlt = false;
  for (const genre of primaryGenres) {
    if (chartGenreConfig.altExplicit.has(genre)) explicitAlt = true;
    if (chartGenreConfig.nonAlt.has(genre)) matchesAlt = false;
  }
  if (explicitAlt) matchesAlt = true;
  return matchesAlt;
}

function getGenreGroup(genres) {
  const text = genres.join(' ').toLowerCase();
  if (!text) return 'other';
  if (/rap|hip.?hop|trap|r&b|rnb|drill/.test(text)) return 'rap-rnb';
  if (/rock|metal|punk|hardcore|alternative|indie|garage|grunge/.test(text)) return 'rock-alt';
  if (/pop|dance|electro|edm|house|techno|disco/.test(text)) return 'pop-dance';
  if (/folk|ethno|world|traditional/.test(text)) return 'folk-ethno';
  if (/jazz|blues|soul|funk/.test(text)) return 'jazz-soul';
  return 'other';
}

function parseYoutubeId(url) {
  if (!url || typeof url !== 'string') return '';
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{6,})/,
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function chooseBestYoutubeTrack(release) {
  const tracks = Array.isArray(release.youtubeTracks) ? release.youtubeTracks : [];
  const verified = tracks.filter(track => track && track.videoId && track.verified === 'verified');
  if (!verified.length) return null;
  return verified.sort((a, b) => toNumber(b.views) - toNumber(a.views))[0];
}

function makeSongPools(config, releases, chartReleases, artistGenreMap, chartGenreConfig) {
  const chartMap = new Map((chartReleases || []).map(item => [item.releaseId, item]));
  const today = new Date();
  const byVideoId = new Map();

  for (const release of releases || []) {
    if (!release || !release.releaseId) continue;
    const topTrack = chooseBestYoutubeTrack(release);
    if (!topTrack) continue;

    const chart = chartMap.get(release.releaseId) || {};
    const releaseDate = parseDate(release.effectiveReleaseDate || release.releaseDate || topTrack.publishedAt);
    const releaseAgeDays = releaseDate ? daysBetween(today, releaseDate) : null;
    const youtubeViews = toNumber(release.youtubeViews, toNumber(chart.youtubeViews, toNumber(topTrack.views)));
    const viewsDelta = chart.viewsDelta == null ? null : toNumber(chart.viewsDelta, 0);
    const score = (Math.max(0, viewsDelta || 0) * 4) + Math.log10(Math.max(10, youtubeViews));
    const artistNames = splitArtists(release.bandName || release.spotifyName || '');
    const genres = getArtistGenres(artistNames, artistGenreMap);
    const primaryArtistGenres = getPrimaryArtistGenres(release.bandName || release.spotifyName || '', artistNames, artistGenreMap);

    const item = {
      kind: 'song',
      videoId: topTrack.videoId,
      title: topTrack.name || release.releaseTitle || 'Untitled',
      artist: release.bandName || release.spotifyName || '',
      artistKeys: artistNames.map(normalizeName).filter(Boolean),
      sourceUrl: topTrack.url || `https://www.youtube.com/watch?v=${topTrack.videoId}`,
      durationSeconds: null,
      estimatedDurationSeconds: 240,
      durationConfidence: 'estimated',
      releaseId: release.releaseId,
      releaseTitle: release.releaseTitle || topTrack.name || '',
      releaseType: release.releaseType || 'single',
      releaseDate: release.effectiveReleaseDate || release.releaseDate || topTrack.publishedAt || null,
      isNew: releaseAgeDays != null && releaseAgeDays <= config.songPools.recent.maxReleaseAgeDays,
      genres,
      genreGroup: getGenreGroup(genres),
      matchesChartAlt: matchesAlternativeChart(primaryArtistGenres, chartGenreConfig),
      thumbnail: release.thumbnail || '',
      youtubeViews,
      viewsDelta,
      score: Number(score.toFixed(3)),
      buckets: []
    };

    if (viewsDelta != null && viewsDelta >= config.songPools.current.minViewsDelta) item.buckets.push('current');
    if (releaseAgeDays != null && releaseAgeDays <= config.songPools.recent.maxReleaseAgeDays) item.buckets.push('recent');
    if (releaseAgeDays == null || releaseAgeDays >= config.songPools.catalog.minReleaseAgeDays || youtubeViews >= config.songPools.catalog.minYoutubeViews) item.buckets.push('catalog');
    if (youtubeViews >= config.songPools.discovery.minYoutubeViews && youtubeViews <= config.songPools.discovery.maxYoutubeViews) item.buckets.push('discovery');
    item.buckets.push('all');

    const existing = byVideoId.get(item.videoId);
    if (!existing || item.score > existing.score) byVideoId.set(item.videoId, item);
  }

  const allSongs = Array.from(byVideoId.values());
  const byScore = (a, b) => b.score - a.score || b.youtubeViews - a.youtubeViews;
  const newest = (a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')) || byScore(a, b);

  return {
    current: allSongs.filter(item => item.buckets.includes('current')).sort(byScore).slice(0, config.songPools.current.maxItems),
    recent: allSongs.filter(item => item.buckets.includes('recent')).sort(newest).slice(0, config.songPools.recent.maxItems),
    catalog: allSongs.filter(item => item.buckets.includes('catalog')).sort(byScore).slice(0, config.songPools.catalog.maxItems),
    discovery: allSongs.filter(item => item.buckets.includes('discovery')).sort((a, b) => b.viewsDelta - a.viewsDelta || a.youtubeViews - b.youtubeViews).slice(0, config.songPools.discovery.maxItems),
    all: allSongs.sort(byScore).slice(0, config.songPools.all.maxItems)
  };
}

function makeInterviewPool(config, interviews, filteredInterviews) {
  const rawByVideo = new Map();
  for (const interview of interviews || []) {
    const videoId = interview.videoId || parseYoutubeId(interview.link);
    if (videoId) rawByVideo.set(videoId, interview);
  }

  const source = filteredInterviews && filteredInterviews.length ? filteredInterviews : interviews;
  const seen = new Set();
  const excluded = (config.interviews.excludedTitlePatterns || []).map(pattern => pattern.toLowerCase());
  const pool = [];

  for (const interview of source || []) {
    const videoId = interview.videoId || parseYoutubeId(interview.link);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const raw = rawByVideo.get(videoId) || {};
    const title = interview.title || raw.title || 'Interview';
    const titleLower = title.toLowerCase();
    if (excluded.some(pattern => titleLower.includes(pattern))) continue;
    if (!config.interviews.includeShortForm && (interview.shortForm || raw.shortForm)) continue;

    const knownDuration = toNumber(interview.durationSeconds, toNumber(raw.durationSeconds, 0));
    if (knownDuration > 0 && knownDuration < config.interviews.minDurationSeconds) continue;
    if (knownDuration > config.interviews.maxDurationSeconds) continue;

    const durationSeconds = knownDuration || 900;
    pool.push({
      kind: 'interview',
      videoId,
      title,
      artist: Array.isArray(interview.matchedArtists) ? interview.matchedArtists.join(', ') : '',
      source: interview.source || raw.source || '',
      sourceUrl: interview.link || raw.link || `https://www.youtube.com/watch?v=${videoId}`,
      durationSeconds,
      estimatedDurationSeconds: knownDuration ? null : durationSeconds,
      durationConfidence: knownDuration ? 'known' : 'estimated',
      interviewId: videoId,
      date: interview.date || raw.date || null,
      thumbnail: interview.thumbnail || raw.thumbnail || '',
      matchedArtists: Array.isArray(interview.matchedArtists) ? interview.matchedArtists : [],
      score: Date.parse(interview.date || raw.date || '') || 0,
      buckets: ['interview']
    });
  }

  return pool.sort((a, b) => b.score - a.score).slice(0, config.interviews.maxItems);
}

function validateSource(source) {
  const errors = [];
  const songs = source.pools.songs;
  if (!songs.current.length) errors.push('No current songs available');
  if (!songs.catalog.length) errors.push('No catalog songs available');
  if (!songs.all.length) errors.push('No playable songs available');

  for (const [poolName, items] of Object.entries(songs)) {
    for (const item of items) {
      if (item.kind !== 'song') errors.push(`Non-song item in songs.${poolName}: ${item.videoId || item.title}`);
      if (!item.videoId) errors.push(`Missing videoId in songs.${poolName}: ${item.title}`);
    }
  }

  for (const item of source.pools.interviews) {
    if (item.kind !== 'interview') errors.push(`Non-interview item in interviews: ${item.videoId || item.title}`);
    if (!item.videoId) errors.push(`Missing videoId in interview: ${item.title}`);
  }

  const musicStations = source.stations.filter(station => station.type === 'music-only');
  for (const musicStation of musicStations) {
    for (const pattern of musicStation.blockPatterns || []) {
      if ((pattern.slots || []).some(slot => slot === 'interview')) {
        errors.push(`Music-only station contains an interview slot: ${musicStation.id}`);
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
}

function main() {
  const config = readJson(CONFIG_PATH);
  const chartGenres = readJson(CHART_GENRES_PATH, {});
  const bandsData = readJson(BANDS_PATH, { muzickaMasterLista: [] });
  const releasesData = readJson(RELEASES_PATH, { releases: [] });
  const chartData = readJson(CHART_PATH, { releases: [] });
  const interviewsData = readJson(INTERVIEWS_PATH, { interviews: [] });
  const filteredInterviewsData = readJson(FILTERED_INTERVIEWS_PATH, { interviews: [] });

  const artistGenreMap = makeArtistGenreMap(bandsData.muzickaMasterLista || []);
  const chartGenreConfig = makeChartGenreConfig(chartGenres || {});
  const songs = makeSongPools(config, releasesData.releases || [], chartData.releases || [], artistGenreMap, chartGenreConfig);
  const interviews = makeInterviewPool(config, interviewsData.interviews || [], filteredInterviewsData.interviews || []);

  const now = new Date();
  const source = {
    version: 1,
    generatedAt: now.toISOString(),
    validForDate: now.toISOString().slice(0, 10),
    seedModel: 'client-local-seed-plus-date-plus-station',
    stations: config.stations,
    pools: {
      songs,
      interviews
    },
    totals: {
      songsCurrent: songs.current.length,
      songsRecent: songs.recent.length,
      songsCatalog: songs.catalog.length,
      songsDiscovery: songs.discovery.length,
      songsAll: songs.all.length,
      interviews: interviews.length
    }
  };

  validateSource(source);
  writeJson(OUTPUT_PATH, source);

  console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`Songs: current ${source.totals.songsCurrent}, catalog ${source.totals.songsCatalog}, discovery ${source.totals.songsDiscovery}, all ${source.totals.songsAll}`);
  console.log(`Interviews: ${source.totals.interviews}`);
}

main();