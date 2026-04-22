'use strict';

const fs = require('fs');
const path = require('path');

const { LOGICAL_FILE_PATHS, resolveRepoPath } = require('./constants');

function stripBom(content) {
  return String(content || '').replace(/^\uFEFF/, '');
}

function readJsonFile(filePath) {
  return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
}

function resolveRepoFilePath(repoRoot, logicalPath) {
  const repoPath = resolveRepoPath(logicalPath);
  return path.join(repoRoot, ...repoPath.split('/'));
}

function loadEditableDocument(repoRoot, logicalPath) {
  return readJsonFile(resolveRepoFilePath(repoRoot, logicalPath));
}

function loadBandsDocument(repoRoot) {
  return loadEditableDocument(repoRoot, LOGICAL_FILE_PATHS.BANDS);
}

function loadEventsDocument(repoRoot) {
  return loadEditableDocument(repoRoot, LOGICAL_FILE_PATHS.EVENTS);
}

function loadGenres(repoRoot) {
  return readJsonFile(path.join(repoRoot, 'data', 'static', 'genres.json'));
}

function getBandsList(document) {
  return Array.isArray(document && document.muzickaMasterLista)
    ? document.muzickaMasterLista
    : [];
}

function getEventsList(document) {
  return Array.isArray(document && document.events)
    ? document.events
    : [];
}

module.exports = {
  getBandsList,
  getEventsList,
  loadBandsDocument,
  loadEditableDocument,
  loadEventsDocument,
  loadGenres,
  readJsonFile,
  resolveRepoFilePath
};