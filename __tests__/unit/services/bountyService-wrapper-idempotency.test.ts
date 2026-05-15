/**
 * Unit tests for the wrapper bountyService (app/services/bountyService.ts).
 *
 * Verifies the idempotent retry handling that addresses the "false Duplicate
 * Bounty error" bug:
 *   - Double-tap / concurrent submissions for the same draft share a single
 *     insert (atomic in-process dedup).
 *   - A second submission of the same draft within the TTL window returns the
 *     cached result with `created: false`, so callers do NOT double-fund escrow.
 *   - Submissions with any payload field changed (title, description, amount,
 *     work_type, location, timeline, skills, category, isForHonor) get a
 *     different fingerprint and are treated as fresh creates.
 */

jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    create: jest.fn(),
  },
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    incrementUserProperty: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: {
    getOnlineStatus: jest.fn().mockReturnValue(true),
    enqueue: jest.fn(),
  },
}));

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseEnv: { hasUrl: true, hasKey: true, mismatch: false },
}));

jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn().mockReturnValue('user-abc'),
}));

import type { BountyDraft } from '../../../app/hooks/useBountyDraft';
import {
  bountyService,
  __resetIdempotencyCacheForTests,
} from '../../../app/services/bountyService';

const { bountyService: baseBountyService } = require('../../../lib/services/bounty-service');

// A representative full Bounty row (matches what the DB would return).
const makeBounty = (overrides: Partial<any> = {}) => ({
  id: 100,
  title: 'Fix My Website',
  description: 'Need help fixing a login bug on my website',
  amount: 50,
  is_for_honor: false,
  location: '',
  work_type: 'online',
  timeline: '1 week',
  skills_required: 'JS',
  category: 'tech',
  poster_id: 'user-abc',
  user_id: 'user-abc',
  status: 'open',
  created_at: new Date().toISOString(),
  ...overrides,
});

const makeDraft = (overrides: Partial<BountyDraft> = {}): BountyDraft => ({
  title: 'Fix My Website',
  description: 'Need help fixing a login bug on my website',
  amount: 50,
  isForHonor: false,
  location: '',
  workType: 'online',
  timeline: '1 week',
  skills: 'JS',
  category: 'tech',
  attachments: [],
  ...overrides,
});

describe('bountyService.createBounty (wrapper idempotency)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetIdempotencyCacheForTests();
  });

  it('returns { created: true } for a fresh submission', async () => {
    const bounty = makeBounty();
    baseBountyService.create.mockResolvedValueOnce(bounty);

    const result = await bountyService.createBounty(makeDraft());

    expect(result).toEqual({ bounty, created: true });
    expect(baseBountyService.create).toHaveBeenCalledTimes(1);
  });

  it('returns the cached bounty with { created: false } on retry within TTL (regression: no false duplicate, no double escrow)', async () => {
    const bounty = makeBounty({ id: 200 });
    baseBountyService.create.mockResolvedValueOnce(bounty);

    const draft = makeDraft();
    const first = await bountyService.createBounty(draft);
    const second = await bountyService.createBounty(draft);

    expect(first).toEqual({ bounty, created: true });
    expect(second).toEqual({ bounty, created: false });
    // The insert MUST only have run once. The second call is a deduped replay.
    expect(baseBountyService.create).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent double-tap submissions atomically (single insert)', async () => {
    const bounty = makeBounty({ id: 300 });
    let resolveInsert: (value: any) => void = () => undefined;
    baseBountyService.create.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveInsert = resolve;
        })
    );

    const draft = makeDraft();
    // Fire two concurrent submits before the first promise resolves.
    const p1 = bountyService.createBounty(draft);
    const p2 = bountyService.createBounty(draft);

    // Let the queued promises register the in-flight entry.
    await Promise.resolve();
    resolveInsert(bounty);

    const [r1, r2] = await Promise.all([p1, p2]);

    // Exactly one insert was issued for the two concurrent calls.
    expect(baseBountyService.create).toHaveBeenCalledTimes(1);
    // Both callers receive the exact same bounty object (same identity).
    expect(r1.bounty).toBe(r2.bounty);
    expect(r1.bounty).toEqual(bounty);
    // Exactly one of the two calls is treated as the original create; the
    // other is a deduplicated replay.
    const createdFlags = [r1.created, r2.created];
    expect(createdFlags.filter(c => c === true)).toHaveLength(1);
    expect(createdFlags.filter(c => c === false)).toHaveLength(1);
  });

  it('treats drafts with different titles as separate creates (not a replay)', async () => {
    const a = makeBounty({ id: 1, title: 'Fix My Website' });
    const b = makeBounty({ id: 2, title: 'Build A Mobile App' });
    baseBountyService.create.mockResolvedValueOnce(a).mockResolvedValueOnce(b);

    const r1 = await bountyService.createBounty(makeDraft({ title: 'Fix My Website' }));
    const r2 = await bountyService.createBounty(makeDraft({ title: 'Build A Mobile App' }));

    expect(r1).toEqual({ bounty: a, created: true });
    expect(r2).toEqual({ bounty: b, created: true });
    expect(baseBountyService.create).toHaveBeenCalledTimes(2);
  });

  it('treats drafts with the same title but a different description as separate creates', async () => {
    const a = makeBounty({ id: 11 });
    const b = makeBounty({ id: 12 });
    baseBountyService.create.mockResolvedValueOnce(a).mockResolvedValueOnce(b);

    const r1 = await bountyService.createBounty(
      makeDraft({ description: 'Need help fixing a login bug on my website' })
    );
    const r2 = await bountyService.createBounty(
      makeDraft({ description: 'Need help adding a payments integration' })
    );

    // The description is part of the fingerprint, so this must NOT be a replay.
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(baseBountyService.create).toHaveBeenCalledTimes(2);
  });

  it('treats drafts with the same title but a different amount as separate creates (different fingerprint)', async () => {
    const a = makeBounty({ id: 21, amount: 50 });
    const b = makeBounty({ id: 22, amount: 75 });
    baseBountyService.create.mockResolvedValueOnce(a).mockResolvedValueOnce(b);

    const r1 = await bountyService.createBounty(makeDraft({ amount: 50 }));
    const r2 = await bountyService.createBounty(makeDraft({ amount: 75 }));

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(baseBountyService.create).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed insert — a retry after error is treated as a fresh create', async () => {
    baseBountyService.create.mockRejectedValueOnce(new Error('Network failure'));

    const draft = makeDraft();
    await expect(bountyService.createBounty(draft)).rejects.toThrow('Network failure');

    // After the failure, a retry should attempt the insert again (NOT be
    // silently swallowed as a replay).
    const bounty = makeBounty({ id: 999 });
    baseBountyService.create.mockResolvedValueOnce(bounty);

    const result = await bountyService.createBounty(draft);

    expect(result).toEqual({ bounty, created: true });
    expect(baseBountyService.create).toHaveBeenCalledTimes(2);
  });
});
