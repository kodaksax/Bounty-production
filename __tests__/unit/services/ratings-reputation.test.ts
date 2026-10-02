/**
 * Client side of rating integrity (supabase/migrations/20261002160000_rating_reputation_integrity.sql).
 *
 * The server decides what counts as reputation; the client must read through
 * the functions that apply that rule and must never write anywhere but
 * `ratings`:
 *   * reviews list   -> get_user_reviews (transaction context, star-only included)
 *   * average/count  -> get_profile_activity_stats (same rule as the list)
 *   * rating status  -> get_my_rating_status
 *   * no `user_ratings` fallback, on read or write -- it was an ungated store
 */

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn() },
}));

jest.mock('../../../lib/utils/network', () => ({
  getReachableApiBaseUrl: jest.fn().mockReturnValue('http://localhost:3001'),
}));

import { ratingsService } from '../../../lib/services/ratings';

const { supabase } = require('../../../lib/supabase');

const rpcResult = (result: any) => {
  const p: any = Promise.resolve(result);
  p.single = jest.fn().mockResolvedValue(result);
  p.maybeSingle = jest.fn().mockResolvedValue(result);
  return p;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ratingsService.getByUserId', () => {
  test('reads get_user_reviews and keeps the transaction context, including star-only ratings', async () => {
    supabase.rpc.mockReturnValue(
      rpcResult({
        data: [
          {
            id: 'r1', rating: 5, comment: null, created_at: '2026-10-01T00:00:00Z', rater_role: 'hunter',
            rater_id: 'h1', rater_username: 'sam', rater_avatar: null, bounty_id: 'b1',
            bounty_title: 'Walk my dog', bounty_completed_at: '2026-09-30T00:00:00Z', is_for_honor: false,
          },
        ],
        error: null,
      })
    );

    const reviews = await ratingsService.getByUserId('poster-1', { limit: 20 });

    expect(supabase.rpc).toHaveBeenCalledWith('get_user_reviews', { p_user_id: 'poster-1', p_limit: 20, p_offset: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(reviews).toEqual([
      expect.objectContaining({
        id: 'r1', user_id: 'poster-1', rater_id: 'h1', score: 5, comment: undefined,
        raterRole: 'hunter', raterName: 'sam', bountyId: 'b1', bountyTitle: 'Walk my dog', isForHonor: false,
      }),
    ]);
  });

  test('falls back to the (RLS-filtered) ratings table only when the RPC is not deployed', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    const range = jest.fn().mockResolvedValue({ data: [{ id: 'r1', to_user_id: 'u', from_user_id: 'p', bounty_id: 'b', rating: 4, comment: 'ok', created_at: 'x' }], error: null });
    supabase.from.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ range }) }) }) });

    const reviews = await ratingsService.getByUserId('u');

    expect(supabase.from).toHaveBeenCalledWith('ratings');
    expect(supabase.from).not.toHaveBeenCalledWith('user_ratings');
    expect(reviews[0]).toEqual(expect.objectContaining({ id: 'r1', score: 4 }));
  });

  test('any other RPC error never reaches for user_ratings', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: null, error: { code: '42P01', message: 'relation "x" does not exist' } }));

    const reviews = await ratingsService.getByUserId('u');

    expect(reviews).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('ratingsService.getAggregatedStats', () => {
  test('uses get_profile_activity_stats instead of averaging raw rows', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: { rating_avg: '4.50', rating_count: 2 }, error: null }));

    const stats = await ratingsService.getAggregatedStats('h1');

    expect(supabase.rpc).toHaveBeenCalledWith('get_profile_activity_stats', { target_user_id: 'h1' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(stats).toEqual({ averageRating: 4.5, ratingCount: 2 });
  });

  test('no counted ratings -> 0 / 0, never a NULL average read as a number', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: { rating_avg: null, rating_count: 0 }, error: null }));
    expect(await ratingsService.getAggregatedStats('h1')).toEqual({ averageRating: 0, ratingCount: 0 });
  });
});

describe('ratingsService.create / hasRated', () => {
  test('a rejected insert surfaces the error and never writes to user_ratings', async () => {
    const single = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'new row for relation "ratings" violates check constraint "ratings_rating_check"' },
    });
    supabase.from.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });

    await expect(
      ratingsService.create({ user_id: 'h', rater_id: 'p', bountyId: 'b', score: 5 } as any)
    ).rejects.toBeDefined();
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('ratings');
  });

  test('hasRated reads only ratings', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    const eq3 = { maybeSingle };
    supabase.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => eq3 }) }) }) });

    expect(await ratingsService.hasRated('p', 'b', 'h')).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('ratings');
    expect(supabase.from).not.toHaveBeenCalledWith('user_ratings');
  });
});

describe('ratingsService.getMyRatingStatus', () => {
  test('maps the server decision', async () => {
    supabase.rpc.mockReturnValue(
      rpcResult({ data: { rater_role: 'hunter', ratee_id: 'p1', ratee_username: 'pat', eligible: true, already_rated: false }, error: null })
    );

    expect(await ratingsService.getMyRatingStatus('b1')).toEqual({
      raterRole: 'hunter', rateeId: 'p1', rateeName: 'pat', eligible: true, alreadyRated: false,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_my_rating_status', { p_bounty_id: 'b1' });
  });

  test('not a party -> null', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: null, error: null }));
    expect(await ratingsService.getMyRatingStatus('b1')).toBeNull();
  });

  test('errors -> null (the prompt is optional and never blocks the screen)', async () => {
    supabase.rpc.mockReturnValue(rpcResult({ data: null, error: { message: 'boom' } }));
    expect(await ratingsService.getMyRatingStatus('b1')).toBeNull();
  });
});
