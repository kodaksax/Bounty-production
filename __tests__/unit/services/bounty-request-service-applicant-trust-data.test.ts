// Unit tests for the applicant-trust-layer data bounty-request-service now
// attaches to each applicant's profile: hunterCompleted (via the batched
// get_profile_activity_stats_batch RPC), skills, and rating stats. Covers
// the MVP poster-facing trust layer's data-correctness requirements: no N+1
// RPC calls, and a graceful zeroed fallback if the batched stats call fails.

describe('bountyRequestService.getAllWithDetails — applicant trust data', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeChainBuilder(resolvedValue: { data: any; error: any }) {
    const chain: any = {};
    const methods = ['from', 'select', 'in', 'eq', 'order', 'range'];
    for (const m of methods) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: any) => resolve(resolvedValue);
    (chain as any)[Symbol.toStringTag] = 'Promise';
    return chain;
  }

  function mockCommonDeps() {
    jest.doMock('../../../lib/utils/error-logger', () => ({
      logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
    }));
  }

  test('batches one RPC call for all applicants and merges hunterCompleted + skills per profile', async () => {
    mockCommonDeps();

    const requestsChain = makeChainBuilder({
      data: [
        { id: 'r1', bounty_id: 'b1', hunter_id: 'h1', status: 'pending' },
        { id: 'r2', bounty_id: 'b1', hunter_id: 'h2', status: 'pending' },
      ],
      error: null,
    });
    const bountiesChain = makeChainBuilder({
      data: [{ id: 'b1', title: 'Fix a leaking sink', description: 'Need a plumber today', category: 'home', amount: 50 }],
      error: null,
    });
    const profilesChain = makeChainBuilder({
      data: [
        { id: 'h1', username: 'alice', stripe_identity_status: 'verified', skills: ['Plumbing', 'Carpentry'] },
        { id: 'h2', username: 'bob', stripe_identity_status: 'unstarted', skills: ['Graphic Design'] },
      ],
      error: null,
    });
    const ratingsChain = makeChainBuilder({ data: [], error: null });

    const rpcMock = jest.fn().mockResolvedValue({
      data: [
        { user_id: 'h1', bounties_posted: 0, bounties_completed: 0, hunter_completed: 5, first_bounty_posted_at: null, rating_avg: 4.8, rating_count: 6 },
        { user_id: 'h2', bounties_posted: 0, bounties_completed: 0, hunter_completed: 0, first_bounty_posted_at: null, rating_avg: null, rating_count: 0 },
      ],
      error: null,
    });

    jest.doMock('../../../lib/supabase', () => ({
      isSupabaseConfigured: true,
      supabase: {
        rpc: rpcMock,
        from: jest.fn((table: string) => {
          if (table === 'bounty_requests') return requestsChain;
          if (table === 'bounties') return bountiesChain;
          if (table === 'public_profiles') return profilesChain;
          if (table === 'ratings') return ratingsChain;
          return makeChainBuilder({ data: [], error: null });
        }),
      },
    }));

    const { bountyRequestService } = require('../../../lib/services/bounty-request-service');
    const result = await bountyRequestService.getAllWithDetails({ bountyId: 'b1' });

    // One batched call, not one per applicant.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_profile_activity_stats_batch', {
      target_user_ids: expect.arrayContaining(['h1', 'h2']),
    });

    const alice = result.find((r: any) => r.hunter_id === 'h1');
    const bob = result.find((r: any) => r.hunter_id === 'h2');

    expect(alice.profile.hunterCompleted).toBe(5);
    expect(alice.profile.skills).toEqual(['Plumbing', 'Carpentry']);
    expect(alice.profile.averageRating).toBe(4.8);
    expect(bob.profile.hunterCompleted).toBe(0);
    expect(bob.profile.skills).toEqual(['Graphic Design']);
    // A null rating_avg from the RPC must stay null, not become 0 -- a real
    // 0-star average and "no average available" are not the same thing (see
    // lib/utils/trust-summary.ts, which only renders a star average that is
    // a finite number > 0).
    expect(bob.profile.averageRating).toBeNull();
  });

  test('zeroes hunterCompleted for every applicant instead of throwing when the batched RPC fails', async () => {
    mockCommonDeps();

    const requestsChain = makeChainBuilder({
      data: [{ id: 'r1', bounty_id: 'b1', hunter_id: 'h1', status: 'pending' }],
      error: null,
    });
    const bountiesChain = makeChainBuilder({
      data: [{ id: 'b1', title: 'Fix a leaking sink', description: 'Need a plumber', category: 'home', amount: 50 }],
      error: null,
    });
    const profilesChain = makeChainBuilder({
      data: [{ id: 'h1', username: 'alice', stripe_identity_status: 'verified', skills: [] }],
      error: null,
    });
    const ratingsChain = makeChainBuilder({ data: [], error: null });

    const rpcMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'function not found' } });

    jest.doMock('../../../lib/supabase', () => ({
      isSupabaseConfigured: true,
      supabase: {
        rpc: rpcMock,
        from: jest.fn((table: string) => {
          if (table === 'bounty_requests') return requestsChain;
          if (table === 'bounties') return bountiesChain;
          if (table === 'public_profiles') return profilesChain;
          if (table === 'ratings') return ratingsChain;
          return makeChainBuilder({ data: [], error: null });
        }),
      },
    }));

    const { bountyRequestService } = require('../../../lib/services/bounty-request-service');
    const result = await bountyRequestService.getAllWithDetails({ bountyId: 'b1' });

    expect(result).toHaveLength(1);
    expect(result[0].profile.hunterCompleted).toBe(0);
    expect(result[0].profile.averageRating).toBeNull();
  });
});
