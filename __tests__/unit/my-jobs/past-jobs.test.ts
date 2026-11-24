/**
 * Profile › Past jobs (Focus-first P.1) rows and facts: which jobs belong,
 * what each row may say about money (only what a record or the app's own
 * receipt figure stands behind), never "Paid" for a wallet credit, and the
 * rating threshold.
 */
import { calculateHunterEarnings } from '../../../lib/constants/fees';
import {
  buildPastJobs,
  describeRatingFact,
  formatPastDay,
  pastOutcome,
  refundsByBounty,
} from '../../../lib/my-jobs/past-jobs';
import type { Bounty } from '../../../lib/services/database.types';
import type { UserRating } from '../../../lib/types';

const ME = 'me-1';
// A Wednesday.
const NOW = new Date(2026, 10, 18, 12, 0, 0);
const SATURDAY = new Date(2026, 10, 14, 15, 0, 0).toISOString();
const OCTOBER = new Date(2026, 9, 9, 10, 0, 0).toISOString();
const SEPTEMBER = new Date(2026, 8, 2, 10, 0, 0).toISOString();
const LAST_YEAR = new Date(2025, 9, 9, 10, 0, 0).toISOString();

// updated_at and payment_status are selected/merged at runtime but not declared on Bounty.
type BountyFixture = Partial<Bounty> & { id: string; updated_at?: string; payment_status?: string };

function bounty(over: BountyFixture): Bounty {
  return {
    title: 'Mount a TV on the wall',
    description: '',
    amount: 80,
    is_for_honor: false,
    location: 'Austin, TX',
    timeline: '',
    skills_required: '',
    poster_id: 'poster-1',
    created_at: new Date(2026, 8, 1).toISOString(),
    status: 'completed',
    ...over,
  } as Bounty;
}

function review(over: Partial<UserRating>): UserRating {
  return { id: 'r', user_id: ME, rater_id: 'x', score: 5, createdAt: SATURDAY, ...over } as UserRating;
}

const net80 = `$${calculateHunterEarnings(80).net}`;

describe('pastOutcome', () => {
  it('finished and cancelled jobs are past jobs; active and removed ones are not', () => {
    expect(pastOutcome({ status: 'completed' })).toBe('completed');
    expect(pastOutcome({ status: 'cancelled' })).toBe('cancelled');
    expect(pastOutcome({ status: 'open' })).toBeNull();
    expect(pastOutcome({ status: 'in_progress' })).toBeNull();
    expect(pastOutcome({ status: 'cancellation_requested' })).toBeNull();
    // "Remove from my list" sets 'deleted': the user asked for it to go.
    expect(pastOutcome({ status: 'deleted', completed_at: SATURDAY })).toBeNull();
  });

  it('an archived job counts as finished only when it has a completion time', () => {
    expect(pastOutcome({ status: 'archived', completed_at: SATURDAY })).toBe('completed');
    expect(pastOutcome({ status: 'archived', completed_at: null })).toBeNull();
  });
});

describe('refundsByBounty', () => {
  it('reads only refund records, per job', () => {
    const refunds = refundsByBounty([
      { type: 'refund', amount: 25, details: { bounty_id: 'b-3' } },
      { type: 'refund', amount: 5, details: { bounty_id: 'b-3' } },
      { type: 'release', amount: 76, details: { bounty_id: 'b-1' } },
      { type: 'refund', amount: -3, details: { bounty_id: 'b-4' } },
      { type: 'refund', amount: 9, details: {} },
    ]);
    expect([...refunds.entries()]).toEqual([['b-3', 30]]);
    expect(refundsByBounty(null).size).toBe(0);
  });
});

describe('formatPastDay', () => {
  it('reads like the design: weekday this week, month this year, month and year before', () => {
    expect(formatPastDay(SATURDAY, NOW)).toBe('Saturday');
    expect(formatPastDay(NOW.toISOString(), NOW)).toBe('Today');
    expect(formatPastDay(new Date(2026, 10, 17, 9).toISOString(), NOW)).toBe('Yesterday');
    expect(formatPastDay(OCTOBER, NOW)).toBe('October');
    expect(formatPastDay(LAST_YEAR, NOW)).toBe('October 2025');
    expect(formatPastDay('not a date', NOW)).toBeNull();
    expect(formatPastDay(null, NOW)).toBeNull();
  });
});

describe('buildPastJobs — WORK YOU DID', () => {
  const tv = bounty({ id: 'b-1', accepted_by: ME, username: 'Jordan K.', completed_at: SATURDAY, category: 'labor' });

  it('a finished paid job: take-home from calculateHunterEarnings, "Released" to the wallet, the poster’s review as the quote', () => {
    const { work, earned } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [{ bounty: tv }],
      paymentStates: new Map([['b-1', 'released']]),
      reviews: [review({ bountyId: 'b-1', raterRole: 'poster', raterName: 'Jordan K.', comment: 'Quick and tidy, cables hidden.' })],
      now: NOW,
    });
    expect(work).toHaveLength(1);
    expect(work[0]).toEqual(
      expect.objectContaining({
        key: 'did:b-1',
        side: 'did',
        title: 'Mount a TV on the wall',
        meta: 'For Jordan K. · Saturday',
        amount: net80,
        state: 'done',
        status: `Released · ${net80} to your wallet`,
        quote: '“Quick and tidy, cables hidden.” Jordan · 5 stars',
      })
    );
    expect(earned).toBe(calculateHunterEarnings(80).net);
  });

  it('a star-only review still shows who rated and how; a review the poster received is not used', () => {
    const { work } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [{ bounty: tv }],
      paymentStates: new Map([['b-1', 'released']]),
      reviews: [
        review({ bountyId: 'b-1', raterRole: 'hunter', raterName: 'Someone', score: 1, comment: 'Not about your work' }),
        review({ bountyId: 'b-1', raterRole: 'poster', raterName: 'Jordan K.', score: 4 }),
      ],
      now: NOW,
    });
    expect(work[0].quote).toBe('Jordan · 4 stars');
  });

  it('only jobs you were chosen for and that ended; each job once', () => {
    const { work } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [
        { bounty: tv },
        { bounty: tv },
        { bounty: bounty({ id: 'b-2', accepted_by: 'someone-else' }) },
        { bounty: bounty({ id: 'b-3', accepted_by: ME, status: 'in_progress' }) },
        { bounty: null },
      ],
      now: NOW,
    });
    expect(work.map((r) => r.bountyId)).toEqual(['b-1']);
  });

  it('for honor: no money, and nothing added to earnings', () => {
    const { work, earned } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [{ bounty: bounty({ id: 'b-1', accepted_by: ME, is_for_honor: true, amount: 0 }) }],
      now: NOW,
    });
    expect(work[0]).toEqual(expect.objectContaining({ amount: 'For honor', status: 'Finished for honor' }));
    expect(earned).toBe(0);
  });

  it('a job cancelled after you were chosen: no amount, no money claimed', () => {
    const { work, earned } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [{ bounty: bounty({ id: 'b-1', accepted_by: ME, status: 'cancelled', updated_at: OCTOBER }) }],
      now: NOW,
    });
    expect(work[0]).toEqual(expect.objectContaining({ amount: null, state: 'cancel', status: 'Cancelled', quote: null }));
    expect(earned).toBe(0);
  });

  it('an approval still settling says "on its way", not "Released"', () => {
    const { work } = buildPastJobs({
      viewerId: ME,
      posted: [],
      offers: [
        {
          bounty: bounty({ id: 'b-1', accepted_by: ME, payment_architecture_version: 2, payment_status: 'release_pending' }),
        },
      ],
      paymentStates: new Map([['b-1', 'pending']]),
      now: NOW,
    });
    expect(work[0].status).toBe(`Approved · ${net80} on its way to your wallet`);
  });
});

describe('buildPastJobs — JOBS YOU POSTED', () => {
  const gate = bounty({ id: 'p-1', title: 'Fix a wobbly gate', amount: 35, accepted_by: 'h-1', completed_at: OCTOBER, poster_id: ME });
  const plants = bounty({ id: 'p-2', title: "Water plants while I'm away", amount: 25, status: 'cancelled', updated_at: SEPTEMBER, poster_id: ME });

  it('"Finished · $X released to {Hunter}" and "Cancelled · $X back to your balance" only with a record', () => {
    const { posted } = buildPastJobs({
      viewerId: ME,
      posted: [gate, plants],
      offers: [],
      helperNames: new Map([['p-1', 'Sam T.']]),
      paymentStates: new Map([['p-1', 'released']]),
      refunds: new Map([['p-2', 25]]),
      now: NOW,
    });
    expect(posted.map((r) => [r.meta, r.amount, r.status])).toEqual([
      ['Sam T. · October', '$35', 'Finished · $35 released to Sam'],
      ['September', '$25', 'Cancelled · $25 back to your balance'],
    ]);
  });

  it('without a refund record a cancelled job says only "Cancelled"; without a name, "your helper"', () => {
    const { posted } = buildPastJobs({ viewerId: ME, posted: [gate, plants], offers: [], now: NOW });
    expect(posted.map((r) => r.status)).toEqual(['Finished · $35 settlement unconfirmed', 'Cancelled']);
  });

  it('a card-funded job refunds to the card, so it does not say "back to your balance"', () => {
    const { posted } = buildPastJobs({
      viewerId: ME,
      posted: [{ ...plants, payment_architecture_version: 2 }],
      offers: [],
      refunds: new Map([['p-2', 25]]),
      now: NOW,
    });
    expect(posted[0].status).toBe('Cancelled · $25 refunded');
  });

  it('for honor: "Finished", and a refund record is never read for it', () => {
    const { posted } = buildPastJobs({
      viewerId: ME,
      posted: [
        { ...gate, is_for_honor: true, amount: 0 },
        { ...plants, is_for_honor: true, amount: 0 },
      ],
      offers: [],
      refunds: new Map([['p-2', 25]]),
      now: NOW,
    });
    expect(posted.map((r) => [r.amount, r.status])).toEqual([
      ['For honor', 'Finished'],
      ['For honor', 'Cancelled'],
    ]);
  });

  it('active and removed jobs stay out; archived finished jobs stay in', () => {
    const { posted } = buildPastJobs({
      viewerId: ME,
      posted: [
        bounty({ id: 'p-3', status: 'open' }),
        bounty({ id: 'p-4', status: 'deleted' }),
        bounty({ id: 'p-5', status: 'archived', completed_at: SATURDAY, accepted_by: 'h-2' }),
      ],
      offers: [],
      paymentStates: new Map([['p-5', 'released']]),
      now: NOW,
    });
    expect(posted.map((r) => r.bountyId)).toEqual(['p-5']);
    expect(posted[0].status).toBe('Finished · $80 released to your helper');
  });
});

describe('buildPastJobs — both sides', () => {
  it('newest first within each section, and no row ever says "Paid"', () => {
    const result = buildPastJobs({
      viewerId: ME,
      posted: [
        bounty({ id: 'p-old', status: 'cancelled', updated_at: SEPTEMBER, poster_id: ME }),
        bounty({ id: 'p-new', accepted_by: 'h-1', completed_at: SATURDAY, poster_id: ME }),
      ],
      offers: [
        { bounty: bounty({ id: 'd-old', accepted_by: ME, completed_at: OCTOBER }) },
        { bounty: bounty({ id: 'd-new', accepted_by: ME, completed_at: SATURDAY }) },
      ],
      refunds: new Map([['p-old', 80]]),
      now: NOW,
    });
    expect(result.work.map((r) => r.bountyId)).toEqual(['d-new', 'd-old']);
    expect(result.posted.map((r) => r.bountyId)).toEqual(['p-new', 'p-old']);
    for (const row of [...result.work, ...result.posted]) expect(row.status).not.toMatch(/\bpaid\b/i);
    expect(result.earned).toBeCloseTo(calculateHunterEarnings(80).net * 2, 2);
  });
});

describe('describeRatingFact', () => {
  const didIds = new Set(['b-1', 'b-2', 'b-3']);
  const postedIds = new Set(['p-1']);
  const helperReviews = [
    review({ id: '1', bountyId: 'b-1', raterRole: 'poster', score: 5 }),
    review({ id: '2', bountyId: 'b-2', raterRole: 'poster', score: 5 }),
    review({ id: '3', bountyId: 'b-3', raterRole: 'poster', score: 4 }),
  ];
  const fromHunter = review({ id: '4', bountyId: 'p-1', raterRole: 'hunter', score: 1 });

  it('"Your rating as a helper" counts only what posters said about your work', () => {
    expect(
      describeRatingFact({
        reviews: [...helperReviews, fromHunter],
        aggregate: { averageRating: 3.75, ratingCount: 4 },
        workedAsHelper: true,
        didIds,
        postedIds,
      })
    ).toEqual({ label: 'Your rating as a helper', value: '4.7 out of 5 · 3 reviews', muted: false });
  });

  it('a whole number reads "5 out of 5"', () => {
    const fives = helperReviews.map((r) => ({ ...r, score: 5 as const }));
    expect(
      describeRatingFact({ reviews: fives, aggregate: { averageRating: 5, ratingCount: 3 }, workedAsHelper: true, didIds, postedIds }).value
    ).toBe('5 out of 5 · 3 reviews');
  });

  it('below the review threshold: a count without an average; none: "No reviews yet"', () => {
    expect(
      describeRatingFact({ reviews: [helperReviews[0]], aggregate: { averageRating: 5, ratingCount: 1 }, workedAsHelper: true, didIds, postedIds })
    ).toEqual({ label: 'Your rating as a helper', value: '1 review so far', muted: true });
    expect(
      describeRatingFact({ reviews: [], aggregate: { averageRating: 0, ratingCount: 0 }, workedAsHelper: true, didIds, postedIds })
    ).toEqual({ label: 'Your rating as a helper', value: 'No reviews yet', muted: true });
  });

  it('an incomplete review list falls back to the overall figure under a neutral label', () => {
    expect(
      describeRatingFact({ reviews: helperReviews, aggregate: { averageRating: 4.82, ratingCount: 60 }, workedAsHelper: true, didIds, postedIds })
    ).toEqual({ label: 'Your rating', value: '4.8 out of 5 · 60 reviews', muted: false });
  });

  it('rows without a rater role are placed by job; one that can’t be placed falls back', () => {
    const legacy = helperReviews.map((r) => ({ ...r, raterRole: undefined }));
    expect(
      describeRatingFact({ reviews: legacy, aggregate: { averageRating: 4.67, ratingCount: 3 }, workedAsHelper: true, didIds, postedIds }).label
    ).toBe('Your rating as a helper');
    const unplaced = [...legacy.slice(0, 2), { ...legacy[2], bountyId: 'gone' }];
    expect(
      describeRatingFact({ reviews: unplaced, aggregate: { averageRating: 4.67, ratingCount: 3 }, workedAsHelper: true, didIds, postedIds }).label
    ).toBe('Your rating');
  });

  it('a poster-only account gets its overall rating, not a helper rating', () => {
    expect(
      describeRatingFact({ reviews: [fromHunter], aggregate: { averageRating: 1, ratingCount: 1 }, workedAsHelper: false, didIds, postedIds })
    ).toEqual({ label: 'Your rating', value: '1 review so far', muted: true });
  });
});
