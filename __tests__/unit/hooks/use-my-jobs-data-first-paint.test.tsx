/**
 * E2E-01 on My Jobs: the tab's `loading` covered the jobs and offers but not
 * the submissions or the dispute / cancellation overlays, which arrive in
 * later effects. A job with submitted work could first paint as "working",
 * and a disputed one as plain work. The first paint now waits for all of them.
 */
import { act, renderHook } from '@testing-library/react-native';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => (resolve = r)), resolve };
}
const pending: Record<string, Deferred<any>[]> = {};
function hold(name: string) {
  const d = deferred<any>();
  (pending[name] ??= []).push(d);
  return d.promise;
}
/** Answers every read of `name` in flight (the overlay effect also runs once before the jobs load). */
async function release(name: string, value: any) {
  const ds = pending[name]?.splice(0) ?? [];
  if (ds.length === 0) throw new Error(`no ${name} read in flight`);
  await act(async () => {
    for (const d of ds) d.resolve(value);
    await Promise.resolve();
  });
}

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { getAll: () => hold('posted'), getFundingModes: () => hold('fundingModes') },
}));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAllWithDetails: () => hold('offers'),
    getAllWithDetailsBatch: () => hold('applications'),
  },
}));
jest.mock('lib/services/completion-service', () => ({
  completionService: { getLatestSubmissionsForBounties: () => hold('submissions') },
}));
jest.mock('lib/services/dispute-service', () => ({ disputeService: { getOpenDisputeBountyIds: () => hold('disputes') } }));
jest.mock('lib/services/cancellation-service', () => ({
  cancellationService: { getPendingCancellationsForBounties: () => hold('cancellations') },
}));
jest.mock('lib/utils/hunter-hidden-bounties', () => ({
  hideBountyForHunter: jest.fn(),
  loadHunterHiddenBountyIds: () => Promise.resolve(new Set()),
}));
jest.mock('../../../hooks/useConversations', () => ({
  useConversations: () => ({ totalUnreadCount: 0, conversations: [], refresh: () => Promise.resolve() }),
}));
jest.mock('../../../lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return { supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() } };
});

import { useMyJobsData } from '../../../hooks/useMyJobsData';

const ME = 'poster-1';
const submittedJob = {
  id: 'b1',
  title: 'Pick up my dry cleaning',
  status: 'in_progress',
  amount: 25,
  is_for_honor: false,
  poster_id: ME,
  user_id: ME,
  accepted_by: 'h1',
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-24T10:00:00Z',
};

beforeEach(() => {
  for (const k of Object.keys(pending)) delete pending[k];
});

it('a job with submitted work never first paints as "working"', async () => {
  const frames: { loading: boolean; status: string | null }[] = [];
  const { result } = renderHook(() => {
    const d = useMyJobsData(ME);
    frames.push({ loading: d.loading, status: d.jobs.find((j) => j.bountyId === 'b1')?.status.text ?? null });
    return d;
  });
  await release('posted', [submittedJob]);
  await release('offers', []);
  // Jobs and offers are in; submissions and overlays are not.
  await release('fundingModes', new Map());
  await release('disputes', new Set());
  await release('cancellations', new Map());
  expect(result.current.loading).toBe(true);
  expect(result.current.jobs).toEqual([]);
  await release('submissions', new Map([['b1', { bounty_id: 'b1', hunter_id: 'h1', status: 'pending', submitted_at: '2026-11-24T09:00:00Z', proof_items: [] }]]));
  expect(result.current.loading).toBe(false);
  const shown = frames.filter((f) => f.status !== null).map((f) => f.status);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter((s) => !/says the job is done/.test(s!))).toEqual([]);
});

it('a disputed job waits for the overlays before its first paint', async () => {
  const frames: (string | null)[] = [];
  const { result } = renderHook(() => {
    const d = useMyJobsData(ME);
    frames.push(d.jobs.find((j) => j.bountyId === 'b1')?.status.text ?? null);
    return d;
  });
  await release('posted', [{ ...submittedJob }]);
  await release('offers', []);
  await release('submissions', new Map());
  await release('fundingModes', new Map());
  expect(result.current.jobs).toEqual([]);
  await release('disputes', new Set(['b1']));
  expect(result.current.jobs).toEqual([]);
  await release('cancellations', new Map());
  const shown = frames.filter(Boolean);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter((s) => /working/i.test(s!))).toEqual([]);
});
