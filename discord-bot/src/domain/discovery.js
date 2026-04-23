'use strict';

const fs = require('fs');
const path = require('path');

const { loadBandsDocument } = require('../repo-data');

function readGeneratedJson(repoRoot, fileName) {
  const filePath = path.join(repoRoot, 'data', 'dynamic', 'generated', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toTimestamp(value) {
  const time = Date.parse(String(value || ''));
  return Number.isNaN(time) ? 0 : time;
}

function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }

  return list[Math.floor(Math.random() * list.length)];
}

function getLatestChartBucket(repoRoot) {
  const history = readGeneratedJson(repoRoot, 'chart-history-data.json');
  const weeks = Array.isArray(history.weeks) ? history.weeks : [];
  const latestWeek = weeks.length ? weeks[weeks.length - 1] : null;
  const bucket = latestWeek && history.data ? history.data[latestWeek] : null;

  return {
    latestWeek,
    charts: bucket && bucket.charts ? bucket.charts : {}
  };
}

function getRandomSong(repoRoot) {
  const chartData = readGeneratedJson(repoRoot, 'chart-data.json');
  const releases = Array.isArray(chartData.releases) ? chartData.releases : [];
  const candidates = releases.filter((release) => Array.isArray(release.trackNames) && release.trackNames.length);
  const release = pickRandom(candidates);

  if (!release) {
    return null;
  }

  const trackIndex = Math.floor(Math.random() * release.trackNames.length);
  const trackName = release.trackNames[trackIndex] || release.releaseTitle || 'Unknown song';
  const trackArtists = Array.isArray(release.trackArtists) && Array.isArray(release.trackArtists[trackIndex])
    ? release.trackArtists[trackIndex]
    : null;

  return {
    title: trackName,
    artist: trackArtists && trackArtists.length ? trackArtists.join(', ') : (release.bandName || 'Unknown artist'),
    releaseTitle: release.releaseTitle || null,
    releaseDate: release.effectiveReleaseDate || release.releaseDate || null,
    url: release.releaseUrl || null
  };
}

function getRandomArtist(repoRoot) {
  const bandsDoc = loadBandsDocument(repoRoot);
  const artists = Array.isArray(bandsDoc.muzickaMasterLista) ? bandsDoc.muzickaMasterLista : [];
  const artist = pickRandom(artists);

  if (!artist) {
    return null;
  }

  const links = artist.links && typeof artist.links === 'object' ? artist.links : {};
  const preferredLinks = ['spotify', 'youtube', 'instagram', 'facebook', 'linktree'];
  let link = null;

  for (const key of preferredLinks) {
    if (typeof links[key] === 'string' && links[key].trim()) {
      link = links[key].trim();
      break;
    }
  }

  if (!link) {
    const firstEntry = Object.values(links).find((value) => typeof value === 'string' && value.trim());
    link = firstEntry || null;
  }

  return {
    name: artist.name || 'Unknown artist',
    city: artist.city || null,
    genre: artist.genre || null,
    link
  };
}

function getTopChart(repoRoot, count) {
  const { latestWeek, charts } = getLatestChartBucket(repoRoot);
  const list = Array.isArray(charts.all_single) ? charts.all_single : [];
  return {
    weekId: latestWeek,
    entries: list.slice(0, count)
  };
}

function getAlternativeChart(repoRoot, count) {
  const { latestWeek, charts } = getLatestChartBucket(repoRoot);
  const list = Array.isArray(charts.alt_single) ? charts.alt_single : [];
  return {
    weekId: latestWeek,
    entries: list.slice(0, count)
  };
}

function getNewReleases(repoRoot, count) {
  const chartData = readGeneratedJson(repoRoot, 'chart-data.json');
  const releases = Array.isArray(chartData.releases) ? chartData.releases.slice() : [];

  releases.sort((left, right) => {
    const leftDate = left.effectiveReleaseDate || left.releaseDate;
    const rightDate = right.effectiveReleaseDate || right.releaseDate;
    return toTimestamp(rightDate) - toTimestamp(leftDate);
  });

  return releases.slice(0, count);
}

function getNews(repoRoot, count) {
  const news = readGeneratedJson(repoRoot, 'articles-filtered.json');
  const list = Array.isArray(news.articles) ? news.articles.slice() : [];

  list.sort((left, right) => toTimestamp(right.date) - toTimestamp(left.date));
  return list.slice(0, count);
}

function getInterviews(repoRoot, count) {
  const interviews = readGeneratedJson(repoRoot, 'interviews-filtered.json');
  const list = Array.isArray(interviews.interviews) ? interviews.interviews.slice() : [];

  list.sort((left, right) => toTimestamp(right.date) - toTimestamp(left.date));
  return list.slice(0, count);
}

function getRandomInterview(repoRoot) {
  const interviews = readGeneratedJson(repoRoot, 'interviews-filtered.json');
  const list = Array.isArray(interviews.interviews) ? interviews.interviews : [];
  return pickRandom(list);
}

module.exports = {
  getAlternativeChart,
  getInterviews,
  getNewReleases,
  getNews,
  getRandomArtist,
  getRandomInterview,
  getRandomSong,
  getTopChart
};