#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'dynamic', 'generated', 'contributions.json');
const METADATA_MARKER = 'MMM_CONTRIBUTION_METADATA';
const DEFAULT_REPOSITORY = 'martinpetkovski/masterlista';
const DEFAULT_SYSTEM_CUTOFF = '2026-05-10T00:00:00.000Z';
const EMAIL_RE = /([A-Z0-9._%+-]{1,64})@([A-Z0-9.-]+\.[A-Z]{2,})/ig;

const CONTRIBUTIONS_PULL_REQUEST_QUERY = `
query ContributionsPullRequests($owner: String!, $repo: String!, $states: [PullRequestState!], $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 100, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        number
        title
        body
        url
        mergedAt
        createdAt
        updatedAt
        additions
        deletions
        baseRefName
        author {
          login
          avatarUrl
          url
          ... on User {
            databaseId
            name
          }
        }
      }
    }
  }
}`;

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function splitLogins(value) {
  return String(value || '')
    .split(',')
    .map(login => login.trim().toLowerCase())
    .filter(Boolean);
}

function parseTime(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getRepositoryParts() {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const parts = repository.split('/').map(part => part.trim()).filter(Boolean);
  return { owner: parts[0] || 'martinpetkovski', repo: parts[1] || 'masterlista' };
}

function getSystemRules(owner) {
  const configuredCurrent = splitLogins(process.env.SYSTEM_CONTRIBUTOR_LOGINS || 'toplistamk');
  const currentLogins = new Set(['toplistamk', ...configuredCurrent]);
  const legacyLogins = new Set([
    owner,
    'martinpetkovski',
    ...currentLogins,
    ...splitLogins(process.env.LEGACY_SYSTEM_CONTRIBUTOR_LOGINS),
  ].map(login => String(login || '').toLowerCase()).filter(Boolean));
  return {
    currentLogins,
    legacyLogins,
    cutoff: parseTime(process.env.SYSTEM_CONTRIBUTOR_CUTOFF || DEFAULT_SYSTEM_CUTOFF),
  };
}

function isCommunityContributor(login, rules, submittedAt) {
  const normalized = String(login || '').toLowerCase();
  if (!normalized) return false;
  if (rules.currentLogins.has(normalized)) return true;
  const submittedTime = parseTime(submittedAt);
  return submittedTime !== null
    && rules.cutoff !== null
    && submittedTime < rules.cutoff
    && rules.legacyLogins.has(normalized);
}

function maskEmails(value) {
  return String(value || '').replace(EMAIL_RE, (_, local, domain) => {
    return `${local.slice(0, Math.min(2, local.length))}***@${domain.slice(0, Math.min(2, domain.length))}***`;
  });
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function extractContributionMetadata(body) {
  if (!body || typeof body !== 'string') return null;
  const re = new RegExp(`<!--\\s*${METADATA_MARKER}\\s*([\\s\\S]*?)\\s*-->`, 'm');
  const match = body.match(re);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && parsed.source === 'site' && parsed.submitter && parsed.submitter.login) return parsed;
  } catch (_) {}
  return null;
}

function publicUserFromAuthor(author) {
  author = author || {};
  return {
    id: author.databaseId || null,
    login: author.login || '',
    name: author.name || '',
    avatar_url: author.avatarUrl || '',
    html_url: author.url || (author.login ? `https://github.com/${author.login}` : ''),
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  const login = String(user.login || '').trim();
  if (!login) return null;
  return {
    id: user.id || null,
    login,
    name: maskEmails(user.name || ''),
    avatar_url: user.avatar_url || user.avatarUrl || '',
    html_url: user.html_url || user.url || `https://github.com/${login}`,
  };
}

function submittedAtForPullRequest(node, metadata) {
  return metadata?.createdAt || node.createdAt || node.updatedAt || node.mergedAt || '';
}

function buildRecord(node, status, rules) {
  const metadata = extractContributionMetadata(node.body || '');
  const submitter = sanitizeUser(metadata?.submitter || publicUserFromAuthor(node.author));
  if (!submitter) return null;
  const submittedAt = submittedAtForPullRequest(node, metadata);
  const additions = toNonNegativeInteger(node.additions ?? metadata?.additions);
  const deletions = toNonNegativeInteger(node.deletions ?? metadata?.deletions);
  const lineChanges = additions + deletions || toNonNegativeInteger(metadata?.lineChanges ?? metadata?.contributionScore);
  const contributionScore = status === 'pending' ? 0 : lineChanges;
  const community = isCommunityContributor(submitter.login, rules, submittedAt);
  return {
    prNumber: node.number,
    prUrl: node.url || '',
    title: maskEmails(node.title || ''),
    mergedAt: node.mergedAt || '',
    createdAt: node.createdAt || '',
    submittedAt,
    updatedAt: node.updatedAt || '',
    additions,
    deletions,
    lineChanges,
    contributionCount: contributionScore,
    contributionScore,
    submitter,
    system: community,
    community,
    status,
    source: metadata ? 'site' : 'github',
    files: Array.isArray(metadata?.files) ? metadata.files : [],
    baseBranch: metadata?.baseBranch || node.baseRefName || '',
  };
}

async function graphqlRequest(token, query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'mmm-contributions-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL request failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(`GitHub GraphQL errors: ${body.errors.map(error => error.message).join('; ')}`);
  }
  return body.data;
}

async function fetchPullRequestRecords({ token, owner, repo, states, status, rules, maxPages }) {
  const records = [];
  let after = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await graphqlRequest(token, CONTRIBUTIONS_PULL_REQUEST_QUERY, { owner, repo, states, after });
    const connection = data?.repository?.pullRequests;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    if (!nodes.length) break;
    for (const node of nodes) {
      const record = buildRecord(node, status, rules);
      if (record) records.push(record);
    }
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor || null;
    if (!after) break;
  }
  return records;
}

function aggregateRecords(records, pendingRecords, previous) {
  records.sort((a, b) => String(b.mergedAt || '').localeCompare(String(a.mergedAt || '')));
  pendingRecords.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  const byUser = new Map();
  for (const record of records) {
    const community = !!(record.community || record.system);
    const login = community ? 'community' : record.submitter.login;
    const existing = byUser.get(login) || {
      login,
      id: community ? null : record.submitter.id,
      name: community ? 'Community' : (record.submitter.name || ''),
      avatar_url: community ? '' : (record.submitter.avatar_url || ''),
      html_url: community ? '' : (record.submitter.html_url || `https://github.com/${login}`),
      contributions: 0,
      lineChanges: 0,
      lastContributionAt: null,
      system: community,
      community,
    };
    existing.contributions += Number(record.contributionCount || 0);
    existing.lineChanges += Number(record.lineChanges || 0);
    if (!existing.lastContributionAt || String(record.mergedAt || '') > String(existing.lastContributionAt || '')) {
      existing.lastContributionAt = record.mergedAt;
    }
    byUser.set(login, existing);
  }

  let rank = 1;
  const leaderboard = Array.from(byUser.values())
    .sort((a, b) => (b.contributions - a.contributions) || String(a.login).localeCompare(String(b.login)))
    .map(entry => ({ ...entry, rank: entry.community || entry.system ? null : rank++ }));

  const totalLineChanges = records.reduce((sum, record) => sum + Number(record.contributionCount || 0), 0);
  const leaderboardLineChanges = records.filter(record => !(record.community || record.system)).reduce((sum, record) => sum + Number(record.contributionCount || 0), 0);
  const communityLineChanges = records.filter(record => record.community || record.system).reduce((sum, record) => sum + Number(record.contributionCount || 0), 0);

  const next = {
    generatedAt: new Date().toISOString(),
    scoreMode: 'line_changes',
    totalContributions: totalLineChanges,
    totalLineChanges,
    leaderboardContributions: leaderboardLineChanges,
    leaderboardLineChanges,
    systemContributions: communityLineChanges,
    communityContributions: communityLineChanges,
    communityLineChanges,
    totalContributors: leaderboard.filter(entry => !(entry.community || entry.system)).length,
    leaderboard,
    records,
    pendingRecords,
    totalRecords: records.length,
    totalPendingRecords: pendingRecords.length,
  };

  if (previous && sameContributionPayload(previous, next)) {
    next.generatedAt = previous.generatedAt || next.generatedAt;
  }
  return next;
}

function sameContributionPayload(previous, next) {
  const withoutGeneratedAt = value => {
    const clone = JSON.parse(JSON.stringify(value || {}));
    delete clone.generatedAt;
    return clone;
  };
  return JSON.stringify(withoutGeneratedAt(previous)) === JSON.stringify(withoutGeneratedAt(next));
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('Missing GITHUB_TOKEN or GH_TOKEN. GitHub GraphQL requires authentication.');

  const { owner, repo } = getRepositoryParts();
  const rules = getSystemRules(owner);
  const maxPages = Math.max(1, Math.min(parseInt(process.env.CONTRIBUTIONS_MAX_PAGES || '20', 10) || 20, 50));
  const previous = readJson(OUTPUT_PATH, null);
  const pendingRecords = await fetchPullRequestRecords({ token, owner, repo, states: ['OPEN'], status: 'pending', rules, maxPages: 2 });
  const records = await fetchPullRequestRecords({ token, owner, repo, states: ['MERGED'], status: 'merged', rules, maxPages });
  const aggregate = aggregateRecords(records, pendingRecords, previous);
  writeJson(OUTPUT_PATH, aggregate);
  console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${aggregate.totalRecords} merged records and ${aggregate.totalPendingRecords} pending records. Points: ${aggregate.totalLineChanges}.`);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
