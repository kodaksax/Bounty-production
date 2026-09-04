import { isBountyPoster } from '../../../lib/utils/poster-bounty-dashboard';

// getPosterDashboardNextRoute and its test went with the poster dashboard's
// locally-tracked "stage" model — the primary action for a bounty is now
// derived from backend state (see __tests__/unit/utils/bounty-lifecycle.test.ts)
// rather than from a UI step index.
describe('poster bounty dashboard guards', () => {
  it('recognizes the canonical poster_id ownership field', () => {
    expect(isBountyPoster({ poster_id: 'poster-1', user_id: null } as any, 'poster-1')).toBe(true);
  });

  it('recognizes the legacy user_id alias', () => {
    expect(isBountyPoster({ poster_id: null, user_id: 'poster-1' } as any, 'poster-1')).toBe(true);
  });

  it('rejects a viewer who owns neither id', () => {
    // The payout screen used to compare `user_id` alone, which locked the real
    // poster out of a bounty whose poster_id was the populated column.
    expect(isBountyPoster({ poster_id: 'poster-1', user_id: null } as any, 'someone-else')).toBe(
      false
    );
    expect(isBountyPoster({ poster_id: null, user_id: null } as any, 'poster-1')).toBe(false);
  });
});
