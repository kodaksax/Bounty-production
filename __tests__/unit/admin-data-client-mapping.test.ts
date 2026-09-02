// Regression tests for the admin console's row mappers.
//
// Every case here corresponds to a column the mappers used to read that does
// not exist on the production schema. Each one resolved to `undefined` and was
// then defaulted, so the admin panel rendered a plausible-looking value
// (a hidden hunter, "Flagged 0 times", an all-zero financial summary) instead
// of failing visibly. These tests pin the real column names so the same class
// of bug cannot return silently.

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
  isSupabaseConfigured: true,
}));

import { __adminDataClientInternals } from '../../lib/admin/adminDataClient';

const { mapBounty, mapUser, mapTransaction, sanitizeSearchTerm, pageRange } =
  __adminDataClientInternals;

describe('mapBounty', () => {
  test('reads the poster from poster_id, not the non-existent creator_id', () => {
    const row = { id: 'b1', poster_id: 'poster-uuid', user_id: 'legacy-uuid' };
    expect(mapBounty(row).user_id).toBe('poster-uuid');
  });

  test('falls back to user_id when poster_id is absent on an older row', () => {
    expect(mapBounty({ id: 'b1', user_id: 'legacy-uuid' }).user_id).toBe('legacy-uuid');
  });

  test('reads the hunter from accepted_by, not the non-existent hunter_id', () => {
    // 44 of 114 production bounties have accepted_by set; the old mapper read
    // `hunter_id` and so never surfaced any of them.
    const row = { id: 'b1', poster_id: 'p', accepted_by: 'hunter-uuid' };
    expect(mapBounty(row).acceptedBy).toBe('hunter-uuid');
  });

  test('leaves acceptedBy undefined when nobody has been accepted', () => {
    expect(mapBounty({ id: 'b1', poster_id: 'p' }).acceptedBy).toBeUndefined();
  });

  test('does not invent a flaggedCount field', () => {
    // `bounties.flagged_count` does not exist. The old mapper defaulted it to
    // 0, which made the "Flagged N times" banner permanently invisible while
    // looking like a real, working feature.
    expect('flaggedCount' in mapBounty({ id: 'b1', poster_id: 'p' })).toBe(false);
  });

  test('surfaces the stale flag the expiry sweeper actually writes', () => {
    const mapped = mapBounty({ id: 'b1', poster_id: 'p', is_stale: true, stale_reason: 'expired' });
    expect(mapped.isStale).toBe(true);
    expect(mapped.staleReason).toBe('expired');
  });

  test('preserves every bounty_status_enum value rather than collapsing to open', () => {
    for (const status of ['open', 'in_progress', 'completed', 'archived', 'cancelled', 'cancellation_requested', 'deleted']) {
      expect(mapBounty({ id: 'b', poster_id: 'p', status }).status).toBe(status);
    }
  });

  test('coerces a numeric-string amount from the numeric column', () => {
    expect(mapBounty({ id: 'b', poster_id: 'p', amount: '42.50' }).amount).toBe(42.5);
  });

  test('leaves amount undefined for an honor bounty rather than reporting $0', () => {
    expect(mapBounty({ id: 'b', poster_id: 'p', amount: null }).amount).toBeUndefined();
  });
});

describe('mapUser', () => {
  const profileRow = {
    id: 'u1',
    username: 'someone',
    balance: '12.34',
    account_status: 'suspended',
    verification_status: 'verified',
  };

  test('marks stats as not loaded when the aggregate is absent', () => {
    // `profiles` has no bounties_posted / total_spent / ... columns. Rather
    // than defaulting them to 0 (which is what made every user look inactive),
    // the mapper records that they were never computed so the UI can show an
    // em dash.
    const mapped = mapUser(profileRow);
    expect(mapped.statsLoaded).toBe(false);
    expect(mapped.bountiesPosted).toBe(0);
    expect(mapped.totalEarned).toBe(0);
  });

  test('uses the aggregate when the Edge Function supplied one', () => {
    const mapped = mapUser({
      ...profileRow,
      __stats: {
        bountiesPosted: 7,
        bountiesAccepted: 3,
        bountiesCompleted: 2,
        totalSpent: 100,
        totalEarned: 250,
      },
    });
    expect(mapped.statsLoaded).toBe(true);
    expect(mapped.bountiesPosted).toBe(7);
    expect(mapped.totalEarned).toBe(250);
  });

  test('a measured zero is still reported as loaded', () => {
    // A brand-new user genuinely has zero activity. That must be
    // distinguishable from "we could not compute it".
    const mapped = mapUser({
      ...profileRow,
      __stats: {
        bountiesPosted: 0,
        bountiesAccepted: 0,
        bountiesCompleted: 0,
        totalSpent: 0,
        totalEarned: 0,
      },
    });
    expect(mapped.statsLoaded).toBe(true);
    expect(mapped.bountiesPosted).toBe(0);
  });

  test('reads account_status, not the non-existent status column', () => {
    expect(mapUser(profileRow).status).toBe('suspended');
  });

  test('reads the avatar column (there is no avatar_url)', () => {
    expect(mapUser({ ...profileRow, avatar: 'https://x/y.png' }).avatar).toBe('https://x/y.png');
  });
});

describe('mapTransaction', () => {
  test('reads the recipient from receiver_id, not the non-existent to_user_id', () => {
    // The old mapper read `to_user_id`, so the "To:" line never rendered on
    // any transaction in the console.
    const mapped = mapTransaction({
      id: 't1',
      type: 'release',
      amount: '25.00',
      user_id: 'from-uuid',
      receiver_id: 'to-uuid',
    });
    expect(mapped.fromUserId).toBe('from-uuid');
    expect(mapped.toUserId).toBe('to-uuid');
    expect(mapped.amount).toBe(25);
  });

  test('does not fall back to sender_id, which is never populated', () => {
    const mapped = mapTransaction({ id: 't1', type: 'escrow', sender_id: 'never-set' });
    expect(mapped.fromUserId).toBeUndefined();
  });

  test('defaults a missing status to completed but keeps a real one', () => {
    expect(mapTransaction({ id: 't', type: 'escrow' }).status).toBe('completed');
    expect(mapTransaction({ id: 't', type: 'escrow', status: 'failed' }).status).toBe('failed');
  });
});

describe('sanitizeSearchTerm', () => {
  test('strips the characters PostgREST treats as structural inside or()', () => {
    // An unescaped comma or paren would either error the request or break out
    // of the or() group and widen the match.
    expect(sanitizeSearchTerm('a,b(c)d')).toBe('a b c d');
    expect(sanitizeSearchTerm('100% off')).toBe('100 off');
    expect(sanitizeSearchTerm('back\\slash')).toBe('back slash');
  });

  test('collapses whitespace and trims', () => {
    expect(sanitizeSearchTerm('  hello   world  ')).toBe('hello world');
  });

  test('caps the length', () => {
    expect(sanitizeSearchTerm('x'.repeat(500))).toHaveLength(120);
  });

  test('returns empty for undefined or blank input', () => {
    expect(sanitizeSearchTerm(undefined)).toBe('');
    expect(sanitizeSearchTerm('   ')).toBe('');
  });
});

describe('pageRange', () => {
  test('produces an inclusive range for the requested page', () => {
    expect(pageRange({ page: 0, pageSize: 25 })).toEqual({ from: 0, to: 24, pageSize: 25 });
    expect(pageRange({ page: 2, pageSize: 10 })).toEqual({ from: 20, to: 29, pageSize: 10 });
  });

  test('clamps a hostile page size instead of returning an unbounded query', () => {
    expect(pageRange({ pageSize: 100000 }).pageSize).toBe(200);
    expect(pageRange({ pageSize: 0 }).pageSize).toBe(1);
  });

  test('clamps a negative page to the first page', () => {
    expect(pageRange({ page: -5, pageSize: 25 }).from).toBe(0);
  });

  test('defaults to the standard page size', () => {
    expect(pageRange(undefined).pageSize).toBe(25);
  });
});
