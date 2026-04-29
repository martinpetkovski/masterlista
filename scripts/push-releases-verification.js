const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const releasesRepoPath = 'data/dynamic/editable/releases.json';
const releasesUrlPath = releasesRepoPath.split('/').map(encodeURIComponent).join('/');
const releasesPath = path.join(root, 'data', 'dynamic', 'editable', 'releases.json');

function parseArgs(argv) {
  const args = { unverified: null, dryRun: false, owner: '', repo: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--unverified' && argv[index + 1]) {
      args.unverified = String(argv[++index]);
    } else if (arg === '--owner' && argv[index + 1]) {
      args.owner = String(argv[++index]);
    } else if (arg === '--repo' && argv[index + 1]) {
      args.repo = String(argv[++index]);
    }
  }
  return args;
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function gitStatus(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return result.status;
}

function readGitConfig(name) {
  const result = spawnSync('git', ['config', '--get', name], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

function ensureGitIdentity() {
  if (!readGitConfig('user.name')) {
    runGit(['config', 'user.name', process.env.GIT_AUTHOR_NAME || 'github-actions[bot]']);
  }
  if (!readGitConfig('user.email')) {
    runGit(['config', 'user.email', process.env.GIT_AUTHOR_EMAIL || '41898282+github-actions[bot]@users.noreply.github.com']);
  }
}

function parseGitHubRemote(remoteUrl) {
  if (!remoteUrl) return null;
  let match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  match = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

function buildUrls(owner, repo, branch) {
  if (!owner || !repo || !branch) return { editUrl: null, blobUrl: null };
  return {
    editUrl: `https://github.com/${owner}/${repo}/edit/${encodeURIComponent(branch)}/${releasesUrlPath}`,
    blobUrl: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${releasesUrlPath}`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const branch = runGit(['branch', '--show-current']);
  if (!branch) {
    throw new Error('Unable to determine current git branch');
  }

  const remoteUrl = runGit(['config', '--get', 'remote.origin.url']);
  const parsedRemote = parseGitHubRemote(remoteUrl) || {};
  const owner = args.owner || process.env.GITHUB_OWNER || parsedRemote.owner || '';
  const repo = args.repo || process.env.GITHUB_REPO || parsedRemote.repo || '';

  const hasUnstaged = gitStatus(['diff', '--quiet', '--', releasesRepoPath]) !== 0;
  const hasStaged = gitStatus(['diff', '--cached', '--quiet', '--', releasesRepoPath]) !== 0;
  const hasChanges = hasUnstaged || hasStaged;

  let committed = false;
  if (hasChanges) {
    const commitMessage = `YouTube link matching - ${args.unverified || 'pending'} links pending verification`;
    if (!args.dryRun) {
      ensureGitIdentity();
      runGit(['add', releasesRepoPath]);
      runGit(['commit', '-m', commitMessage, '--quiet']);
      committed = true;
    }
  }

  const commitSha = runGit(['log', '-1', '--format=%H', '--', releasesRepoPath]);
  if (!commitSha) {
    throw new Error('Unable to determine latest releases.json commit SHA');
  }

  if (!args.dryRun) {
    runGit(['push', 'origin', branch, '--quiet']);
  }

  const urls = buildUrls(owner, repo, branch);
  const payload = {
    ok: true,
    branch,
    commitSha,
    owner: owner || null,
    repo: repo || null,
    editUrl: urls.editUrl,
    blobUrl: urls.blobUrl,
    committed,
    pushed: !args.dryRun,
    hadChanges: hasChanges,
    releasesPath,
  };

  process.stdout.write(JSON.stringify(payload));
}

try {
  main();
} catch (error) {
  process.stderr.write((error && error.message) ? error.message : String(error));
  process.exit(1);
}
