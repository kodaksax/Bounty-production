#!/usr/bin/env node
'use strict';

const fs = require('fs');

const CLOSING_REFERENCE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b(?:\s*:\s*|\s+)((?:(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+)(?:\s*(?:,|and)\s*(?:(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+))*)/gi;
const ISSUE_REFERENCE_RE = /(?:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+))?#(?<issue>\d+)/g;

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    if (!value) continue;
    if (key === 'owner') args.owner = value;
    if (key === 'repo') args.repo = value;
    if (key === 'sha') args.sha = value;
    if (key === 'event-path') args.eventPath = value;
  }
  return args;
}

function extractClosingIssueRefs(text, fallbackOwner, fallbackRepo) {
  const refs = [];
  if (!text) return refs;

  for (const match of text.matchAll(CLOSING_REFERENCE_RE)) {
    const chunk = match[1];
    for (const ref of chunk.matchAll(ISSUE_REFERENCE_RE)) {
      refs.push({
        owner: ref.groups?.owner || fallbackOwner,
        repo: ref.groups?.repo || fallbackRepo,
        issueNumber: Number(ref.groups?.issue),
      });
    }
  }

  return refs;
}

function uniqueIssueRefs(refs) {
  const seen = new Set();
  return refs.filter(ref => {
    const key = `${ref.owner}/${ref.repo}#${ref.issueNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectIssueClosureTargets({ owner, repo, event, pullRequests }) {
  const refs = [];

  for (const pr of pullRequests) {
    refs.push(...extractClosingIssueRefs(pr.body || '', owner, repo));
  }

  const commits = Array.isArray(event?.commits) ? event.commits : [];
  for (const commit of commits) {
    refs.push(...extractClosingIssueRefs(commit.message || '', owner, repo));
  }

  if (event?.head_commit?.message) {
    refs.push(...extractClosingIssueRefs(event.head_commit.message, owner, repo));
  }

  return uniqueIssueRefs(refs).filter(ref => ref.owner && ref.repo && Number.isInteger(ref.issueNumber));
}

function evaluateIssueStates(issueStates) {
  const stillOpen = issueStates.filter(issue => issue.state !== 'closed');
  return {
    ok: stillOpen.length === 0,
    stillOpen,
  };
}

async function githubGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'User-Agent': 'bountyexpo-ci-issue-closure-check',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url}: ${await response.text()}`);
  }

  return response.json();
}

async function getAssociatedPullRequests({ owner, repo, sha, token }) {
  return githubGet(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`, token);
}

async function getIssueState(ref, token) {
  const issue = await githubGet(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`, token);
  return {
    ...ref,
    title: issue.title,
    htmlUrl: issue.html_url,
    state: issue.state,
  };
}

function repoFromEnv(value) {
  const [owner, repo] = (value || '').split('/');
  return { owner, repo };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoInfo = repoFromEnv(process.env.GITHUB_REPOSITORY);
  const owner = args.owner || repoInfo.owner;
  const repo = args.repo || repoInfo.repo;
  const sha = args.sha || process.env.GITHUB_SHA;
  const eventPath = args.eventPath || process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !sha || !eventPath) {
    throw new Error('owner, repo, sha, and event-path are required (via args or GitHub Actions env).');
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pullRequests = await getAssociatedPullRequests({ owner, repo, sha, token });
  const targets = collectIssueClosureTargets({ owner, repo, event, pullRequests });

  if (targets.length === 0) {
    console.log('[verify-issue-closures] No Fixes/Closes/Resolves issue references found for this build.');
    return;
  }

  console.log(
    `[verify-issue-closures] Verifying ${targets.length} linked issue(s): ${targets
      .map(ref => `${ref.owner}/${ref.repo}#${ref.issueNumber}`)
      .join(', ')}`
  );

  const states = await Promise.all(targets.map(ref => getIssueState(ref, token)));
  const result = evaluateIssueStates(states);

  if (!result.ok) {
    console.error('[verify-issue-closures] ❌ Linked issues still open after the fix landed:');
    for (const issue of result.stillOpen) {
      console.error(`  - ${issue.owner}/${issue.repo}#${issue.issueNumber} (${issue.state}): ${issue.title} — ${issue.htmlUrl}`);
    }
    process.exit(1);
  }

  console.log('[verify-issue-closures] ✅ Every linked Fixes/Closes/Resolves issue is closed.');
}

module.exports = {
  parseArgs,
  extractClosingIssueRefs,
  collectIssueClosureTargets,
  evaluateIssueStates,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[verify-issue-closures] ${error.message}`);
    process.exit(1);
  });
}
