// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const {
  parseArgs,
  extractClosingIssueRefs,
  collectIssueClosureTargets,
  evaluateIssueStates,
} = require('../../scripts/verify-issue-closures.js');

describe('verify-issue-closures: parseArgs', () => {
  it('reads explicit CLI overrides', () => {
    expect(parseArgs(['--owner=kodaksax', '--repo=Bounty-production', '--sha=abc123', '--event-path=/tmp/event.json'])).toEqual({
      owner: 'kodaksax',
      repo: 'Bounty-production',
      sha: 'abc123',
      eventPath: '/tmp/event.json',
    });
  });
});

describe('verify-issue-closures: extractClosingIssueRefs', () => {
  it('extracts same-repo issue references from closing keywords', () => {
    expect(extractClosingIssueRefs('Fixes #809 and closes #812', 'kodaksax', 'Bounty-production')).toEqual([
      { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 809 },
      { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 812 },
    ]);
  });

  it('keeps explicit cross-repo references intact', () => {
    expect(extractClosingIssueRefs('Resolves octo/demo#42', 'kodaksax', 'Bounty-production')).toEqual([
      { owner: 'octo', repo: 'demo', issueNumber: 42 },
    ]);
  });
});

describe('verify-issue-closures: collectIssueClosureTargets', () => {
  it('dedupes references gathered from the PR body and pushed commits', () => {
    expect(
      collectIssueClosureTargets({
        owner: 'kodaksax',
        repo: 'Bounty-production',
        pullRequests: [{ body: 'Fixes #809, closes #812' }],
        event: {
          commits: [{ message: 'Fixes #809' }],
          head_commit: { message: 'Resolves #812' },
        },
      })
    ).toEqual([
      { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 809 },
      { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 812 },
    ]);
  });
});

describe('verify-issue-closures: evaluateIssueStates', () => {
  it('passes when every linked issue is closed', () => {
    expect(
      evaluateIssueStates([
        { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 809, state: 'closed' },
        { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 812, state: 'closed' },
      ])
    ).toEqual({ ok: true, stillOpen: [] });
  });

  it('reports any linked issue that is still open', () => {
    expect(
      evaluateIssueStates([
        { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 809, state: 'closed' },
        { owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 812, state: 'open' },
      ])
    ).toEqual({
      ok: false,
      stillOpen: [{ owner: 'kodaksax', repo: 'Bounty-production', issueNumber: 812, state: 'open' }],
    });
  });
});
