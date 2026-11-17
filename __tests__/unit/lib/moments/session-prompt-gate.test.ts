/**
 * lib/moments/sessionPromptGate.ts: one prompt per session, none before Home
 * has loaded her jobs, none for the rest of the session once a job needs her.
 */
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));

import {
  beginPromptSession,
  claimPromptWhenDecided,
  markHomeJobsLoading,
  promptGateClosedBy,
  promptGateState,
  reportHomeJobs,
  resetPromptGateForTests,
  tryClaimPrompt,
} from '../../../../lib/moments/sessionPromptGate';

const U = 'user-1';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  mockStore.clear();
  resetPromptGateForTests();
});

describe('session prompt gate', () => {
  it('waits for both the session and Home to have loaded her jobs', async () => {
    expect(promptGateState(U)).toBe('waiting');
    expect(tryClaimPrompt(U, 'moment')).toBe(false);
    await beginPromptSession(U, 3);
    expect(promptGateState(U)).toBe('waiting');
    reportHomeJobs(U, { needsYou: false });
    expect(promptGateState(U)).toBe('open');
  });

  it('allows exactly one prompt per session', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: false });
    expect(tryClaimPrompt(U, 'moment')).toBe(true);
    expect(tryClaimPrompt(U, 'moment')).toBe(false);
    expect(tryClaimPrompt(U, 'resume_draft')).toBe(false);
    expect(promptGateState(U)).toBe('closed');
  });

  it('holds every prompt for the session once a job needs her', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: true });
    expect(promptGateState(U)).toBe('closed');
    expect(promptGateClosedBy(U)).toBe('jobs_need_you');
    // Answering the job later in the session doesn't reopen it.
    reportHomeJobs(U, { needsYou: false });
    expect(tryClaimPrompt(U, 'moment')).toBe(false);
  });

  it('applies a hold reported before the session was known', async () => {
    reportHomeJobs(U, { needsYou: true });
    await beginPromptSession(U, 3);
    expect(promptGateState(U)).toBe('closed');
    expect(tryClaimPrompt(U, 'moment')).toBe(false);
  });

  it('opens again next session, and only once Home has loaded her jobs again', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: true });
    await beginPromptSession(U, 4);
    expect(promptGateState(U)).toBe('waiting');
    reportHomeJobs(U, { needsYou: false });
    expect(tryClaimPrompt(U, 'moment')).toBe(true);
  });

  it('remembers a used session across an app restart inside that session', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: false });
    expect(tryClaimPrompt(U, 'moment')).toBe(true);
    await flush();

    resetPromptGateForTests(); // the JS runtime restarts
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: false });
    expect(promptGateState(U)).toBe('closed');
  });

  it('waits again while Home reloads her jobs for a fresh mount', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: false });
    markHomeJobsLoading(U);
    expect(promptGateState(U)).toBe('waiting');
  });

  it('is per user', async () => {
    await beginPromptSession(U, 3);
    reportHomeJobs(U, { needsYou: false });
    expect(promptGateState('user-2')).toBe('waiting');
  });

  it('a waiting claimant wins the moment the gate opens, before anyone else', async () => {
    await beginPromptSession(U, 3);
    const claim = claimPromptWhenDecided(U, 'resume_draft', () => true);
    reportHomeJobs(U, { needsYou: false });
    // Already claimed synchronously inside the report.
    expect(tryClaimPrompt(U, 'moment')).toBe(false);
    await expect(claim).resolves.toBe(true);
    expect(promptGateClosedBy(U)).toBe('resume_draft');
  });

  it('a waiting claimant that no longer wants to show gives the prompt up', async () => {
    await beginPromptSession(U, 3);
    const claim = claimPromptWhenDecided(U, 'resume_draft', () => false);
    reportHomeJobs(U, { needsYou: false });
    await expect(claim).resolves.toBe(false);
    expect(tryClaimPrompt(U, 'moment')).toBe(true);
  });
});
