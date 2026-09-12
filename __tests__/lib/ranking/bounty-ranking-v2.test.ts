import {
  CATEGORY_SCORES,
  DEFAULT_CATEGORY_SCORE,
  NEUTRAL_FRESHNESS_SCORE,
  categoryScore,
  computeRankScore,
  freshnessScore,
  jitterFor,
  jitterSeed,
  paidBoost,
  payScore,
  rankAndSectionPool,
  rankPool,
  seededRandom,
  type PoolBounty,
} from '../../../lib/ranking/bounty-ranking-v2';

const DAY = 86400;

describe('payScore', () => {
  it('is 0 for an honor bounty (amount <= 0)', () => {
    expect(payScore(0, 100)).toBe(0);
    expect(payScore(null, 100)).toBe(0);
    expect(payScore(undefined, 100)).toBe(0);
  });

  it('log-normalizes against the pool max', () => {
    expect(payScore(100, 100)).toBeCloseTo(1, 10);
    expect(payScore(50, 100)).toBeCloseTo(Math.log(51) / Math.log(101), 10);
  });

  it('is 0 for every bounty when the whole pool is unpaid (max = 0)', () => {
    expect(payScore(0, 0)).toBe(0);
  });
});

describe('freshnessScore', () => {
  it('scores a brand-new bounty at 1.0', () => {
    expect(freshnessScore(0)).toBe(1.0);
  });

  it('decays linearly to 0 at the 14-day floor', () => {
    expect(freshnessScore(7 * DAY)).toBeCloseTo(0.5, 10);
    expect(freshnessScore(14 * DAY)).toBeCloseTo(0, 10);
  });

  it('floors at 0 past 14 days, never negative', () => {
    expect(freshnessScore(30 * DAY)).toBe(0);
  });

  it('treats null/undefined as neutral (0.5)', () => {
    expect(freshnessScore(null)).toBe(NEUTRAL_FRESHNESS_SCORE);
    expect(freshnessScore(undefined)).toBe(NEUTRAL_FRESHNESS_SCORE);
  });
});

describe('paidBoost', () => {
  it('is 0 for honor, 1 otherwise', () => {
    expect(paidBoost(true)).toBe(0);
    expect(paidBoost(false)).toBe(1);
    expect(paidBoost(null)).toBe(1);
    expect(paidBoost(undefined)).toBe(1);
  });
});

describe('categoryScore', () => {
  it('matches the documented conversion-rate table', () => {
    expect(categoryScore('labor')).toBe(1.0);
    expect(categoryScore('other')).toBe(0.96);
    expect(categoryScore('writing')).toBe(0.6);
    expect(categoryScore('tech')).toBe(0.4);
    expect(categoryScore('design')).toBe(0.48);
    expect(categoryScore('delivery')).toBe(0.6);
  });

  it('is case-insensitive', () => {
    expect(categoryScore('LABOR')).toBe(CATEGORY_SCORES.labor);
  });

  it('defaults to 0.50 for unknown/missing categories', () => {
    expect(categoryScore('gardening')).toBe(DEFAULT_CATEGORY_SCORE);
    expect(categoryScore(null)).toBe(DEFAULT_CATEGORY_SCORE);
    expect(categoryScore(undefined)).toBe(DEFAULT_CATEGORY_SCORE);
  });
});

describe('computeRankScore', () => {
  it('weights the four signals 0.40/0.35/0.15/0.10', () => {
    const bounty = {
      id: 'b1',
      amount: 100,
      is_for_honor: false,
      seconds_since_posted: 0,
      category: 'labor',
    };
    // pay=1.0, freshness=1.0, paidBoost=1.0, category=1.0 -> perfect score
    expect(computeRankScore(bounty, 100)).toBeCloseTo(1.0, 10);
  });

  it('an honor bounty loses pay_score and paid_boost entirely', () => {
    const bounty = {
      id: 'b2',
      amount: 0,
      is_for_honor: true,
      seconds_since_posted: 0,
      category: 'labor',
    };
    // freshness(0.35) + category(0.10) only
    expect(computeRankScore(bounty, 100)).toBeCloseTo(0.35 + 0.1, 10);
  });
});

describe('seededRandom / jitterFor', () => {
  it('is deterministic for the same seed + bountyId', () => {
    const a = seededRandom('seed', 'bounty-1');
    const b = seededRandom('seed', 'bounty-1');
    expect(a).toBe(b);
  });

  it('differs across bounty ids (not just returning a constant)', () => {
    const a = seededRandom('seed', 'bounty-1');
    const b = seededRandom('seed', 'bounty-2');
    expect(a).not.toBe(b);
  });

  it('differs across seeds for the same bounty (changes daily / per user)', () => {
    const a = seededRandom('user1:2026-09-11', 'bounty-1');
    const b = seededRandom('user1:2026-09-12', 'bounty-1');
    expect(a).not.toBe(b);
  });

  it('always lands in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = seededRandom('seed', `bounty-${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('jitter stays within [0.85, 1.15)', () => {
    for (let i = 0; i < 50; i++) {
      const j = jitterFor('seed', `bounty-${i}`);
      expect(j).toBeGreaterThanOrEqual(0.85);
      expect(j).toBeLessThan(1.15);
    }
  });

  it('jitterSeed composes userId + date', () => {
    expect(jitterSeed('u1', '2026-09-11')).toBe('u1:2026-09-11');
  });
});

describe('rankPool', () => {
  it('sorts descending by final (post-jitter) score', () => {
    const bounties = [
      { id: 'low', amount: 5, is_for_honor: false, seconds_since_posted: 20 * DAY, category: 'tech' },
      { id: 'high', amount: 200, is_for_honor: false, seconds_since_posted: 0, category: 'labor' },
    ];
    const ranked = rankPool(bounties, { userId: 'u1', dateString: '2026-09-11' });
    expect(ranked[0].id).toBe('high');
    expect(ranked[1].id).toBe('low');
  });

  it('reports rank_score without jitter applied (rank_score !== final_score in general)', () => {
    const bounties = [
      { id: 'a', amount: 100, is_for_honor: false, seconds_since_posted: 0, category: 'labor' },
    ];
    const [ranked] = rankPool(bounties, { userId: 'u1', dateString: '2026-09-11' });
    const jitter = ranked.final_score / ranked.rank_score;
    expect(jitter).toBeGreaterThanOrEqual(0.85);
    expect(jitter).toBeLessThan(1.15);
  });
});

describe('rankAndSectionPool', () => {
  const opts = { userId: 'u1', dateString: '2026-09-11' };

  function makeBounty(overrides: Partial<PoolBounty> & { id: string }): PoolBounty {
    return {
      amount: 50,
      is_for_honor: false,
      seconds_since_posted: DAY,
      category: 'labor',
      application_count: 0,
      ...overrides,
    };
  }

  it('skips scoring and recency-sorts when the pool has fewer than 5 bounties', () => {
    const pool = [
      makeBounty({ id: 'newer', seconds_since_posted: DAY }),
      makeBounty({ id: 'older', seconds_since_posted: 2 * DAY }),
    ];
    const { main, dormant, honor } = rankAndSectionPool(pool, opts);
    expect(main.map(b => b.id)).toEqual(['newer', 'older']);
    expect(main.every(b => b.rank_score === 0)).toBe(true);
    expect(dormant).toEqual([]);
    expect(honor).toEqual([]);
  });

  it('moves bounties older than 30 days with zero applications to dormant', () => {
    const pool = [
      makeBounty({ id: 'stale', seconds_since_posted: 31 * DAY, application_count: 0 }),
      makeBounty({ id: 'old-but-active', seconds_since_posted: 31 * DAY, application_count: 3 }),
      makeBounty({ id: 'p1' }),
      makeBounty({ id: 'p2' }),
      makeBounty({ id: 'p3' }),
    ];
    const { main, dormant } = rankAndSectionPool(pool, opts);
    expect(dormant.map(b => b.id)).toEqual(['stale']);
    expect(main.map(b => b.id)).toContain('old-but-active');
    expect(main.map(b => b.id)).not.toContain('stale');
  });

  it('separates honor bounties into their own section when the pool is mixed', () => {
    const pool = [
      makeBounty({ id: 'honor1', is_for_honor: true, amount: 0 }),
      makeBounty({ id: 'paid1' }),
      makeBounty({ id: 'paid2' }),
      makeBounty({ id: 'paid3' }),
      makeBounty({ id: 'paid4' }),
    ];
    const { main, honor } = rankAndSectionPool(pool, opts);
    expect(honor.map(b => b.id)).toEqual(['honor1']);
    expect(main.map(b => b.id)).not.toContain('honor1');
  });

  it('keeps honor bounties in main (no separate section) when the whole pool is honor', () => {
    const pool = [
      makeBounty({ id: 'h1', is_for_honor: true, amount: 0, seconds_since_posted: 0 }),
      makeBounty({ id: 'h2', is_for_honor: true, amount: 0, seconds_since_posted: DAY }),
      makeBounty({ id: 'h3', is_for_honor: true, amount: 0, seconds_since_posted: 2 * DAY }),
      makeBounty({ id: 'h4', is_for_honor: true, amount: 0, seconds_since_posted: 3 * DAY }),
      makeBounty({ id: 'h5', is_for_honor: true, amount: 0, seconds_since_posted: 4 * DAY }),
    ];
    const { main, honor } = rankAndSectionPool(pool, opts);
    expect(honor).toEqual([]);
    expect(main).toHaveLength(5);
  });

  it('treats a missing amount as 0 and a missing seconds_since_posted as neutral freshness', () => {
    const pool = [
      makeBounty({ id: 'a', amount: null, seconds_since_posted: null }),
      makeBounty({ id: 'b' }),
      makeBounty({ id: 'c' }),
      makeBounty({ id: 'd' }),
      makeBounty({ id: 'e' }),
    ];
    expect(() => rankAndSectionPool(pool, opts)).not.toThrow();
  });
});
