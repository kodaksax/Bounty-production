/**
 * E2E-01 (Whole-Job Test, 2026-11-24): the poster's job page showed a stage the
 * server data didn't support while it loaded — "No one has offered yet" on a job
 * with three offers, "working on your job" on submitted work, "Work underway"
 * after "Yes, pay" — and, during session restore, sent the poster to the public
 * page.
 *
 * These tests drive useBountyLifecycle with every read held open, release the
 * reads in a chosen order, and record what the hook publishes on each render.
 * A "painted" frame is one a screen would draw (see `painted`). Every painted
 * frame must be the true stage.
 */
import { act, renderHook } from '@testing-library/react-native';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const reads: Record<string, Deferred<any>[]> = {};
function next(name: string) {
  const d = deferred<any>();
  (reads[name] ??= []).push(d);
  return d.promise;
}
let onSubmission: ((s: any) => void) | null = null;

jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: () => next('bounty') } }));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: (q: any) => next(q?.status === 'pending' ? 'offers' : 'myRequest') },
}));
jest.mock('lib/services/completion-service', () => ({
  completionService: {
    getSubmission: () => next('submission'),
    subscribeSubmission: (_id: string, cb: (s: any) => void) => {
      onSubmission = cb;
      return () => {};
    },
  },
}));
jest.mock('lib/services/dispute-service', () => ({ disputeService: { getDisputeByBountyId: () => next('dispute') } }));
jest.mock('lib/services/cancellation-service', () => ({
  cancellationService: { getCancellationByBountyId: () => next('cancellation') },
}));
jest.mock('lib/services/userProfile', () => ({ userProfileService: { getProfile: () => next('profile') } }));
jest.mock('lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return { supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() } };
});
jest.mock('../../../hooks/useRequestExpiryPolicy', () => ({ useRequestExpiryPolicy: () => ({ expiryHours: 72 }) }));

import { useBountyLifecycle } from '../../../hooks/useBountyLifecycle';
import { describePosterStage } from '../../../lib/utils/poster-stage-copy';

const POSTER = 'poster-1';
const HELPER = 'h1';
const openJob = { id: 'b1', status: 'open', poster_id: POSTER, title: 'Garage', amount: 60, accepted_by: null, funding_mode: 'at_accept' };
const workingJob = { id: 'b1', status: 'in_progress', poster_id: POSTER, title: 'Dry cleaning', amount: 25, accepted_by: HELPER };
const doneJob = { ...workingJob, status: 'completed', completed_at: '2026-11-24T12:00:00Z' };
const pendingSubmission = { id: 's1', bounty_id: 'b1', hunter_id: HELPER, status: 'pending', submitted_at: '2026-11-24T10:00:00Z' };
const approvedSubmission = { ...pendingSubmission, status: 'approved' };
const THREE_OFFERS = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
const helperCancels = {
  id: 'c1',
  bountyId: 'b1',
  requesterId: HELPER,
  requesterType: 'hunter',
  reason: "I've hurt my back",
  status: 'pending',
  refundAmount: 25,
  createdAt: '2026-11-24T11:00:00Z',
};

async function release(name: string, value: any) {
  const d = reads[name]?.shift();
  if (!d) throw new Error(`no ${name} read in flight`);
  await act(async () => {
    d.resolve(value);
    await Promise.resolve();
  });
}

type Frame = {
  bounty: any;
  isLoading: boolean;
  role: string;
  status: string | null;
  paying: boolean;
  applicationCount: number;
  hasCancellationRequest: boolean;
  cancellation: any;
};

function mount(viewer: string | null | undefined = POSTER) {
  const history: Frame[] = [];
  const hook = renderHook(({ v }: { v: string | null | undefined }) => {
    const ctx = useBountyLifecycle('b1', v);
    history.push({
      bounty: ctx.bounty,
      isLoading: ctx.isLoading,
      role: ctx.role,
      status: ctx.state?.status ?? null,
      paying: !!ctx.state?.paying,
      applicationCount: ctx.applicationCount,
      hasCancellationRequest: ctx.hasCancellationRequest,
      cancellation: ctx.cancellation,
    });
    return ctx;
  }, { initialProps: { v: viewer } });
  return { ...hook, history };
}

/**
 * Frames a screen would draw. The poster page drew whenever a bounty was
 * present (it only showed its loader for `isLoading && !bounty`), so that is
 * the test: a bounty on screen means a stage on screen.
 */
const painted = (h: Frame[]) => h.filter((f) => f.bounty);

/** Every order the reads that follow the job row can come back in. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  onSubmission = null;
});

describe('cold open: a stage is published only when every read is in', () => {
  const openValues: Record<string, any> = { offers: THREE_OFFERS, submission: null, dispute: null, cancellation: null };
  it.each(permutations(Object.keys(openValues)).map((order) => [order.join(' → ')]))(
    'offers waiting, reads in order %s: never "no offers"',
    async (label) => {
      const order = label.split(' → ');
      const { result, history } = mount();
      await release('bounty', openJob);
      for (const name of order) {
        expect(painted(history)).toEqual([]);
        await release(name, openValues[name]);
      }
      expect(result.current.isLoading).toBe(false);
      expect(result.current.applicationCount).toBe(3);
      // Every painted frame has the three offers.
      expect(painted(history).map((f) => f.applicationCount)).not.toContain(0);
    }
  );

  const workingValues: Record<string, any> = {
    profile: { username: 'ana' },
    submission: pendingSubmission,
    dispute: null,
    cancellation: null,
  };
  it.each(permutations(Object.keys(workingValues)).map((order) => [order.join(' → ')]))(
    'work submitted, reads in order %s: never "working"',
    async (label) => {
      const order = label.split(' → ');
      const { result, history } = mount();
      await release('bounty', workingJob);
      for (const name of order) await release(name, workingValues[name]);
      expect(result.current.state?.status).toBe('review_needed');
      expect(painted(history).map((f) => f.status).filter((s) => s !== 'review_needed')).toEqual([]);
    }
  );

  it('the job row arriving last (after its offers would have) still paints nothing early', async () => {
    // The offers read can only start once the row says who posted it, so the
    // row resolving "last" means everything else was already settled: the row
    // is held open while the test checks nothing was painted.
    const { history } = mount();
    expect(painted(history)).toEqual([]);
    await release('bounty', openJob);
    expect(painted(history)).toEqual([]);
    await release('offers', THREE_OFFERS);
    await release('submission', null);
    await release('dispute', null);
    expect(painted(history)).toEqual([]);
    await release('cancellation', null);
    expect(painted(history).at(-1)?.applicationCount).toBe(3);
  });
});

describe('session restore (cause 2): a load for an unknown viewer never lands last', () => {
  it('the visitor read finishing after the poster read is dropped; the poster is never a visitor', async () => {
    const { result, history, rerender } = mount(null);
    // First load starts with no viewer (session still restoring).
    await release('bounty', openJob);
    // The session restores: a second load starts for the real viewer.
    rerender({ v: POSTER });
    // Finish the viewer-less load first (the poster's profile, submission,
    // dispute, cancellation; no offers read for a visitor).
    await release('profile', { username: 'olive' });
    await release('submission', null);
    await release('dispute', null);
    await release('cancellation', null);
    expect(result.current.isLoading).toBe(true);
    // Now the poster load.
    await release('bounty', openJob);
    await release('offers', THREE_OFFERS);
    await release('submission', null);
    await release('dispute', null);
    await release('cancellation', null);
    const afterRestore = history.slice(history.findIndex((f) => f.isLoading && !f.bounty) + 1);
    expect(painted(afterRestore).map((f) => f.role)).not.toContain('visitor');
    expect(result.current.role).toBe('poster');
    expect(result.current.applicationCount).toBe(3);
  });

  it('a slower, older refetch landing after a newer one never replaces it', async () => {
    const { result } = mount();
    await release('bounty', workingJob);
    for (const [n, v] of Object.entries({ profile: { username: 'ana' }, submission: pendingSubmission, dispute: null, cancellation: null })) {
      await release(n, v);
    }
    // Two refetches in flight; the second (newer) finishes first.
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.refresh();
    });
    act(() => {
      b = result.current.refresh();
    });
    const [oldRow, newRow] = reads.bounty.splice(0, 2);
    await act(async () => {
      newRow.resolve(doneJob);
      await Promise.resolve();
    });
    for (const n of ['profile', 'submission', 'dispute', 'cancellation']) {
      const d = reads[n].pop()!;
      await act(async () => {
        d.resolve(n === 'submission' ? approvedSubmission : n === 'profile' ? { username: 'ana' } : null);
        await Promise.resolve();
      });
    }
    expect(result.current.state?.status).toBe('completed');
    await act(async () => {
      oldRow.resolve(workingJob);
      await Promise.resolve();
    });
    for (const n of ['profile', 'submission', 'dispute', 'cancellation']) {
      const d = reads[n].pop()!;
      await act(async () => {
        d.resolve(n === 'submission' ? pendingSubmission : n === 'profile' ? { username: 'ana' } : null);
        await Promise.resolve();
      });
    }
    await act(async () => {
      await Promise.all([a, b]);
    });
    expect(result.current.state?.status).toBe('completed');
  });
});

async function openSubmitted() {
  const m = mount();
  await m.result.current; // no-op, keeps the shape uniform
  await release('bounty', workingJob);
  await release('profile', { username: 'ana' });
  await release('submission', pendingSubmission);
  await release('dispute', null);
  await release('cancellation', null);
  expect(m.result.current.state?.status).toBe('review_needed');
  return m;
}

async function refetch(m: ReturnType<typeof mount>, values: { bounty: any; submission: any; dispute?: any; cancellation?: any; offers?: any }) {
  let p!: Promise<void>;
  act(() => {
    p = m.result.current.refresh();
  });
  await release('bounty', values.bounty);
  if (values.bounty.status === 'open' && reads.offers?.length) await release('offers', values.offers ?? []);
  if (reads.profile?.length) await release('profile', { username: 'ana' });
  await release('submission', values.submission);
  await release('dispute', values.dispute ?? null);
  await release('cancellation', values.cancellation ?? null);
  await act(async () => {
    await p;
  });
}

describe('refetches never move the stage backward without a real server change', () => {
  it('a stale read (submission back to nothing) is refused: the review stays on screen', async () => {
    const m = await openSubmitted();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await refetch(m, { bounty: workingJob, submission: null });
    expect(m.result.current.state?.status).toBe('review_needed');
    warn.mockRestore();
  });

  it('allowed: the poster sent the work back (review → working)', async () => {
    const m = await openSubmitted();
    await refetch(m, { bounty: workingJob, submission: { ...pendingSubmission, status: 'revision_requested' } });
    expect(m.result.current.state?.status).toBe('in_progress');
  });

  it('allowed: cancelled', async () => {
    const m = await openSubmitted();
    await refetch(m, { bounty: { ...workingJob, status: 'cancelled' }, submission: pendingSubmission });
    expect(m.result.current.state?.status).toBe('cancelled');
  });

  it('allowed: a report opened (paused)', async () => {
    const m = await openSubmitted();
    await refetch(m, { bounty: workingJob, submission: pendingSubmission, dispute: { id: 'd1', status: 'open', initiatorId: POSTER } });
    expect(m.result.current.hasDispute).toBe(true);
  });

  it('allowed: every offer withdrawn or expired (choosing → posted)', async () => {
    const m = mount();
    await release('bounty', openJob);
    await release('offers', THREE_OFFERS);
    await release('submission', null);
    await release('dispute', null);
    await release('cancellation', null);
    expect(m.result.current.applicationCount).toBe(3);
    await refetch(m, { bounty: openJob, submission: null, offers: [] });
    expect(m.result.current.applicationCount).toBe(0);
  });

  it('allowed: the helper asks to stop during review — flag and detail land together, on the cancellation stage', async () => {
    const m = await openSubmitted();
    const from = m.history.length;
    await refetch(m, { bounty: { ...workingJob, status: 'cancellation_requested' }, submission: pendingSubmission, cancellation: helperCancels });
    const frames = painted(m.history.slice(from));
    // No frame has the flag without the record it describes.
    expect(frames.filter((f) => f.hasCancellationRequest && !f.cancellation)).toEqual([]);
    const ctx = m.result.current;
    const view = describePosterStage({
      bounty: ctx.bounty as any,
      lifecycle: ctx.state!,
      helperName: 'ana',
      applicantCount: 0,
      submission: ctx.submission,
      hasDispute: ctx.hasDispute,
      cancellation: { requesterType: ctx.cancellation!.requesterType, reason: ctx.cancellation!.reason, refundAmount: ctx.cancellation!.refundAmount ?? null },
      openJobCharge: null,
    });
    expect(view.screenId).toBe('J.3');
    expect(view.now).toBe('ana asked to cancel.');
    expect(view.stage).not.toMatch(/Work underway/);
  });
});

describe('after "Yes, pay": the paying stage holds until the job reads back finished', () => {
  it('the live submission update arriving alone is "paying", never "working"', async () => {
    const m = await openSubmitted();
    const from = m.history.length;
    await act(async () => onSubmission?.(approvedSubmission));
    const frames = painted(m.history.slice(from));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.paying)).toBe(true);
    // The poster's page says it is paying, not working.
    const ctx = m.result.current;
    const view = describePosterStage({
      bounty: ctx.bounty as any,
      lifecycle: ctx.state!,
      helperName: 'ana',
      applicantCount: 0,
      submission: ctx.submission,
      hasDispute: false,
      openJobCharge: null,
    });
    expect(view.screenId).toBe('I.2');
    expect(view.now).toBe('Paying ana…');
  });

  it('settlement read last: a refetch that still sees the old row keeps "paying", then "completed" arrives', async () => {
    const m = await openSubmitted();
    await act(async () => onSubmission?.(approvedSubmission));
    // A reload (the rating sheet closing) whose row read is from before the
    // completion and whose submission is from before the approval: refused.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await refetch(m, { bounty: workingJob, submission: pendingSubmission });
    expect(m.result.current.state?.paying).toBe(true);
    warn.mockRestore();
    // The same reload with the approved submission: still paying.
    await refetch(m, { bounty: workingJob, submission: approvedSubmission });
    expect(m.result.current.state?.paying).toBe(true);
    // The row reads back completed.
    await refetch(m, { bounty: doneJob, submission: approvedSubmission });
    expect(m.result.current.state?.status).toBe('completed');
    expect(m.result.current.state?.paying).toBeFalsy();
  });
});
