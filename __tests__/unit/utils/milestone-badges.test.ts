/**
 * Unit tests for milestone-badge utilities
 */

import {
  getMilestoneBadges,
  type MilestoneBadgeInput,
} from '../../../lib/utils/verification-badges';

describe('getMilestoneBadges', () => {
  it('returns 3 badges', () => {
    expect(getMilestoneBadges({})).toHaveLength(3);
  });

  it('first_bounty_posted is earned once bounties_posted >= 1', () => {
    expect(
      getMilestoneBadges({ bounties_posted: 0 }).find((b) => b.id === 'first_bounty_posted')?.earned
    ).toBe(false);
    expect(
      getMilestoneBadges({ bounties_posted: 1 }).find((b) => b.id === 'first_bounty_posted')?.earned
    ).toBe(true);
  });

  it('bounties_completed_5 requires at least 5 completed', () => {
    expect(
      getMilestoneBadges({ bounties_completed: 4 }).find((b) => b.id === 'bounties_completed_5')
        ?.earned
    ).toBe(false);
    expect(
      getMilestoneBadges({ bounties_completed: 5 }).find((b) => b.id === 'bounties_completed_5')
        ?.earned
    ).toBe(true);
  });

  it('top_rated requires both a 4.5+ average AND at least 5 ratings', () => {
    const highAvgLowCount: MilestoneBadgeInput = { average_rating: 5, rating_count: 1 };
    expect(getMilestoneBadges(highAvgLowCount).find((b) => b.id === 'top_rated')?.earned).toBe(
      false
    );

    const lowAvgHighCount: MilestoneBadgeInput = { average_rating: 3, rating_count: 20 };
    expect(getMilestoneBadges(lowAvgHighCount).find((b) => b.id === 'top_rated')?.earned).toBe(
      false
    );

    const both: MilestoneBadgeInput = { average_rating: 4.5, rating_count: 5 };
    expect(getMilestoneBadges(both).find((b) => b.id === 'top_rated')?.earned).toBe(true);
  });

  it('degrades to unearned on empty input rather than throwing', () => {
    expect(() => getMilestoneBadges({})).not.toThrow();
    getMilestoneBadges({}).forEach((b) => expect(b.earned).toBe(false));
  });
});
