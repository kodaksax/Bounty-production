/**
 * Unit tests for lib/moments/backfill.ts — specifically which primaryRole
 * values reach each moment's enqueue-vs-complete resolution.
 *
 * The asymmetry under test is deliberate and was a production bug before it
 * existed: profiles.primary_role is NULL for the large majority of accounts,
 * so gating post_first_bounty on a 'poster'/'both' value meant it was never
 * enqueued for anyone. See the comment in backfill.ts.
 */

const eq = jest.fn();
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select }));

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from },
}));

const enqueue = jest.fn(() => Promise.resolve());
const markCompleted = jest.fn(() => Promise.resolve());

jest.mock('../../../../lib/moments/momentsService', () => ({
  momentsService: { enqueue, markCompleted },
}));

import { backfillEventMoments } from '../../../../lib/moments/backfill';
import type { MomentState, MomentType } from '../../../../lib/moments/types';

/**
 * Both count queries chain `.eq(...)`; accept_first_bounty adds a second one.
 * Returning a thenable that also exposes `eq` lets a single mock serve both
 * shapes — `await`ing after one or two `.eq()` calls resolves the same way.
 */
function mockCount(count: number) {
  const result: any = {
    eq: () => result,
    then: (resolve: (value: { count: number }) => unknown) => resolve({ count }),
  };
  return result;
}

const NO_STATES = new Map<MomentType, MomentState>();

describe('backfillEventMoments', () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    enqueue.mockClear();
    markCompleted.mockClear();
    eq.mockImplementation(() => mockCount(0));
  });

  it.each([['poster' as const], ['both' as const], [null], [undefined]])(
    'enqueues post_first_bounty when primaryRole is %s',
    async primaryRole => {
      await backfillEventMoments('user-1', primaryRole, NO_STATES);

      expect(enqueue).toHaveBeenCalledWith('user-1', 'post_first_bounty', {});
    }
  );

  it('does not enqueue post_first_bounty for a declared hunter', async () => {
    await backfillEventMoments('user-1', 'hunter', NO_STATES);

    expect(enqueue).not.toHaveBeenCalledWith('user-1', 'post_first_bounty', {});
  });

  it('keeps accept_first_bounty gated to hunters — an unknown role does not get it', async () => {
    await backfillEventMoments('user-1', null, NO_STATES);

    expect(enqueue).not.toHaveBeenCalledWith('user-1', 'accept_first_bounty', {});
  });

  it('enqueues accept_first_bounty for a declared hunter', async () => {
    await backfillEventMoments('user-1', 'hunter', NO_STATES);

    expect(enqueue).toHaveBeenCalledWith('user-1', 'accept_first_bounty', {});
  });

  it('enqueues accept_first_bounty for a declared both', async () => {
    await backfillEventMoments('user-1', 'both', NO_STATES);

    expect(enqueue).toHaveBeenCalledWith('user-1', 'accept_first_bounty', {});
  });

  it('does not enqueue accept_first_bounty for a declared poster', async () => {
    await backfillEventMoments('user-1', 'poster', NO_STATES);

    expect(enqueue).not.toHaveBeenCalledWith('user-1', 'accept_first_bounty', {});
  });

  it('marks post_first_bounty completed instead of enqueuing when the user already posted', async () => {
    eq.mockImplementation(() => mockCount(2));

    await backfillEventMoments('user-1', null, NO_STATES);

    expect(markCompleted).toHaveBeenCalledWith('user-1', 'post_first_bounty');
    expect(enqueue).not.toHaveBeenCalledWith('user-1', 'post_first_bounty', {});
  });

  it('skips entirely when a state row already exists', async () => {
    const states = new Map<MomentType, MomentState>([
      [
        'post_first_bounty',
        {
          momentType: 'post_first_bounty',
          status: 'pending',
          shownCount: 0,
          firstShownAt: null,
          lastShownAt: null,
          dismissedAt: null,
          completedAt: null,
          snoozedUntil: null,
          metadata: {},
        },
      ],
    ]);

    await backfillEventMoments('user-1', null, states);

    expect(from).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(markCompleted).not.toHaveBeenCalled();
  });
});
