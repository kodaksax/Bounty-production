/**
 * Regression tests for the atomic bounty escrow reservation fix (May 2026).
 *
 * Bug: A user with $11 balance could create multiple $11 bounties because
 * escrow funds were not reserved atomically with bounty creation. The fix
 * adds a database trigger (migration 20260518_atomic_bounty_escrow_reservation.sql)
 * that reserves escrow in the same transaction as the bounty INSERT, and
 * updates the client-side createEscrow flow to treat the resulting "already
 * exists" (409 duplicate_transaction) response as a successful idempotent
 * reservation instead of throwing — which would otherwise cause the caller
 * to delete the (correctly funded) bounty.
 *
 * These tests reimplement the small piece of client logic in isolation so we
 * do not need to mount the full WalletContext / React tree.
 */

export {};

function makeFetch(status: number, body: object = {}) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  });
}

/**
 * Minimal reimplementation of the relevant branch of WalletContext.createEscrow.
 * Mirrors lib/wallet-context.tsx after the fix: a 409 with code
 * 'duplicate_transaction' is treated as a successful idempotent reservation
 * (escrow already created by the bounty INSERT trigger), the local balance is
 * synced from the server-provided newBalance, and a non-throwing record is
 * returned.
 */
async function createEscrowClient(opts: {
  bountyId: string;
  amount: number;
  balance: number;
  fetchFn: typeof fetch;
  setBalance: (n: number) => void;
}): Promise<{ ok: true; deducted: boolean } | { ok: false; error: string }> {
  const { bountyId, amount, balance, fetchFn, setBalance } = opts;
  const response = await fetchFn('https://example/wallet/escrow', {
    method: 'POST',
    body: JSON.stringify({ bountyId, amount }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errCode = (errData as any).code;
    if (response.status === 409 && errCode === 'duplicate_transaction') {
      const dupBalance =
        typeof (errData as any).newBalance === 'number'
          ? (errData as any).newBalance
          : Math.max(0, balance - amount);
      setBalance(dupBalance);
      return { ok: true, deducted: true };
    }
    return { ok: false, error: (errData as any).error || 'Failed to create escrow on server' };
  }

  const data = await response.json();
  const newBalance = typeof data.newBalance === 'number' ? data.newBalance : balance - amount;
  setBalance(newBalance);
  return { ok: true, deducted: true };
}

describe('Atomic escrow reservation — client createEscrow handling', () => {
  it('200 OK: deducts balance from server-provided newBalance', async () => {
    const fetchFn = makeFetch(200, { success: true, newBalance: 0, amount: 11 });
    const setBalance = jest.fn();
    const result = await createEscrowClient({
      bountyId: 'b1',
      amount: 11,
      balance: 11,
      fetchFn: fetchFn as any,
      setBalance,
    });
    expect(result.ok).toBe(true);
    expect(setBalance).toHaveBeenCalledWith(0);
  });

  it('409 duplicate_transaction is treated as success (trigger already reserved)', async () => {
    // After the migration, the INSERT trigger fires inside the bounty INSERT
    // transaction and creates the escrow row. The client's follow-up POST
    // /wallet/escrow then sees an already-existing escrow and the server
    // returns 409 with the current balance.
    const fetchFn = makeFetch(409, {
      error: 'Escrow already exists for this bounty',
      code: 'duplicate_transaction',
      newBalance: 0,
      amount: 11,
    });
    const setBalance = jest.fn();
    const result = await createEscrowClient({
      bountyId: 'b1',
      amount: 11,
      balance: 11,
      fetchFn: fetchFn as any,
      setBalance,
    });
    expect(result.ok).toBe(true);
    // Critical: balance must be synced to 0, not left at $11 — otherwise the
    // poster could double-spend the same funds across another bounty.
    expect(setBalance).toHaveBeenCalledWith(0);
  });

  it('409 duplicate_transaction with no newBalance falls back to local deduction', async () => {
    const fetchFn = makeFetch(409, {
      error: 'Escrow already exists for this bounty',
      code: 'duplicate_transaction',
    });
    const setBalance = jest.fn();
    const result = await createEscrowClient({
      bountyId: 'b1',
      amount: 11,
      balance: 11,
      fetchFn: fetchFn as any,
      setBalance,
    });
    expect(result.ok).toBe(true);
    expect(setBalance).toHaveBeenCalledWith(0);
  });

  it('non-duplicate 4xx is surfaced as a failure (caller will roll back bounty)', async () => {
    const fetchFn = makeFetch(400, { error: 'Insufficient balance' });
    const setBalance = jest.fn();
    const result = await createEscrowClient({
      bountyId: 'b1',
      amount: 11,
      balance: 5,
      fetchFn: fetchFn as any,
      setBalance,
    });
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/Insufficient/);
    expect(setBalance).not.toHaveBeenCalled();
  });

  it('409 without duplicate_transaction code is NOT silently accepted', async () => {
    // Defence-in-depth: only the specific duplicate_transaction code is
    // treated as success; an unknown 409 must propagate as a failure.
    const fetchFn = makeFetch(409, { error: 'something else', code: 'other_conflict' });
    const setBalance = jest.fn();
    const result = await createEscrowClient({
      bountyId: 'b1',
      amount: 11,
      balance: 11,
      fetchFn: fetchFn as any,
      setBalance,
    });
    expect(result.ok).toBe(false);
    expect(setBalance).not.toHaveBeenCalled();
  });
});

/**
 * Documents the invariant enforced by the trigger and update_balance check.
 * Re-implements the SQL contract in plain JS so we can encode the property
 * "no paid bounty can commit without a full escrow reservation".
 */
describe('Atomic escrow reservation — DB trigger semantics (model)', () => {
  type Profile = { id: string; balance: number };
  type Bounty = { id: string; posterId: string; amount: number; isForHonor: boolean };
  type Escrow = { bountyId: string; userId: string; amount: number };

  function insertBountyWithTrigger(
    profiles: Map<string, Profile>,
    escrows: Map<string, Escrow>,
    bounty: Bounty
  ): { committed: boolean; reason?: string } {
    // Honor / unpriced bounties bypass the reservation, like the trigger does.
    if (bounty.isForHonor || !bounty.amount || bounty.amount <= 0) {
      return { committed: true };
    }
    const profile = profiles.get(bounty.posterId);
    if (!profile) return { committed: false, reason: 'no_profile' };

    // Idempotency via unique index on (bounty_id) WHERE type='escrow' AND status='completed'.
    if (escrows.has(bounty.id)) {
      return { committed: true }; // bounty row still commits, escrow already present
    }

    // The whole INSERT + trigger runs in one transaction: if balance would go
    // negative, the trigger raises and the bounty INSERT is rolled back.
    if (profile.balance < bounty.amount) {
      return { committed: false, reason: 'insufficient_funds' };
    }
    escrows.set(bounty.id, {
      bountyId: bounty.id,
      userId: bounty.posterId,
      amount: bounty.amount,
    });
    profile.balance -= bounty.amount;
    return { committed: true };
  }

  it('rejects a second paid bounty when balance is fully escrowed by the first', () => {
    const profiles = new Map<string, Profile>([['u1', { id: 'u1', balance: 11 }]]);
    const escrows = new Map<string, Escrow>();

    const first = insertBountyWithTrigger(profiles, escrows, {
      id: 'b1',
      posterId: 'u1',
      amount: 11,
      isForHonor: false,
    });
    expect(first.committed).toBe(true);
    expect(profiles.get('u1')!.balance).toBe(0);

    const second = insertBountyWithTrigger(profiles, escrows, {
      id: 'b2',
      posterId: 'u1',
      amount: 11,
      isForHonor: false,
    });
    expect(second.committed).toBe(false);
    expect(second.reason).toBe('insufficient_funds');
    // No partial debit, no orphan escrow row for b2.
    expect(profiles.get('u1')!.balance).toBe(0);
    expect(escrows.has('b2')).toBe(false);
  });

  it('honor bounties do not touch balance and do not create escrow rows', () => {
    const profiles = new Map<string, Profile>([['u1', { id: 'u1', balance: 11 }]]);
    const escrows = new Map<string, Escrow>();
    const result = insertBountyWithTrigger(profiles, escrows, {
      id: 'bh',
      posterId: 'u1',
      amount: 0,
      isForHonor: true,
    });
    expect(result.committed).toBe(true);
    expect(profiles.get('u1')!.balance).toBe(11);
    expect(escrows.has('bh')).toBe(false);
  });

  it('is idempotent: a re-fired insert for the same bounty does not double-deduct', () => {
    const profiles = new Map<string, Profile>([['u1', { id: 'u1', balance: 20 }]]);
    const escrows = new Map<string, Escrow>();
    insertBountyWithTrigger(profiles, escrows, {
      id: 'b1',
      posterId: 'u1',
      amount: 5,
      isForHonor: false,
    });
    insertBountyWithTrigger(profiles, escrows, {
      id: 'b1',
      posterId: 'u1',
      amount: 5,
      isForHonor: false,
    });
    expect(profiles.get('u1')!.balance).toBe(15);
    expect(escrows.size).toBe(1);
  });
});

/**
 * End-to-end round-trip model for the wallet-escrow path covered by the
 * "business logic sanity check" issue:
 *
 *   poster has $8.40 → creates a $1.00 paid bounty → balance is $7.40
 *     → bounty is disputed and resolved in the poster's favour
 *     → balance is restored to $8.40
 *
 * The on-disk implementation lives in two places, which this model mirrors:
 *   1. `fn_reserve_bounty_escrow` (migration 20260518) — AFTER INSERT trigger
 *      on `public.bounties` that writes the negative `escrow` ledger row and
 *      debits `profiles.balance` in the same transaction as the bounty INSERT.
 *   2. `fn_refund_wallet_escrow_for_dispute` (migration 20260519) — SECURITY
 *      DEFINER RPC invoked by `disputeService.resolveDispute` when the bounty
 *      has no `payment_intent_id` (wallet-escrow path) and the dispute is
 *      resolved in the poster's favour.  It writes a positive `refund` ledger
 *      row and credits `profiles.balance`, atomically and idempotently
 *      (already-settled disputes return applied=false without touching the
 *      balance).
 *
 * Keeping a JS-level model of both legs here lets us assert the full
 * round-trip property without standing up a real Postgres instance.
 */
describe('Wallet-escrow round-trip — bounty creation + dispute resolution (poster wins)', () => {
  type Profile = { id: string; balance: number };
  type Bounty = {
    id: string;
    posterId: string;
    amount: number;
    isForHonor: boolean;
    paymentIntentId?: string | null;
  };
  type Ledger = {
    bountyId: string;
    userId: string;
    type: 'escrow' | 'refund' | 'release';
    amount: number;
    status: 'completed';
  };

  // Mirrors fn_reserve_bounty_escrow.
  function insertBountyWithTrigger(
    profiles: Map<string, Profile>,
    ledger: Ledger[],
    bounty: Bounty
  ): { committed: boolean; reason?: string } {
    if (bounty.isForHonor || !bounty.amount || bounty.amount <= 0) {
      return { committed: true };
    }
    const profile = profiles.get(bounty.posterId);
    if (!profile) return { committed: false, reason: 'no_profile' };
    // Idempotency guard from the partial unique index on (bounty_id) WHERE
    // type='escrow' AND status='completed'.
    if (ledger.some(r => r.bountyId === bounty.id && r.type === 'escrow')) {
      return { committed: true };
    }
    if (profile.balance < bounty.amount) {
      return { committed: false, reason: 'insufficient_funds' };
    }
    ledger.push({
      bountyId: bounty.id,
      userId: bounty.posterId,
      type: 'escrow',
      amount: -bounty.amount,
      status: 'completed',
    });
    profile.balance -= bounty.amount;
    return { committed: true };
  }

  // Mirrors fn_refund_wallet_escrow_for_dispute.
  function refundWalletEscrowForDispute(
    profiles: Map<string, Profile>,
    ledger: Ledger[],
    dispute: {
      bountyId: string;
      status: string;
      winner: 'poster' | 'hunter' | null;
    },
    bounty: Bounty
  ): { applied: boolean; refundAmount?: number } {
    // Only refund when the dispute resolved in the poster's favour.
    if (dispute.status !== 'resolved_poster_wins' || dispute.winner !== 'poster') {
      return { applied: false };
    }
    // Honor / non-monetary bounties have nothing to refund.
    if (bounty.isForHonor || !bounty.amount || bounty.amount <= 0) {
      return { applied: false };
    }
    // Stripe-backed bounties refund through paymentService.refundEscrow, not
    // this RPC.
    if (bounty.paymentIntentId) {
      return { applied: false };
    }
    // Idempotency: if a release or refund is already on the ledger for this
    // bounty, no-op.
    if (
      ledger.some(
        r =>
          r.bountyId === bounty.id &&
          (r.type === 'refund' || r.type === 'release') &&
          r.status === 'completed'
      )
    ) {
      return { applied: false };
    }
    const escrow = ledger.find(r => r.bountyId === bounty.id && r.type === 'escrow');
    if (!escrow) return { applied: false };
    const refundAmount = Math.abs(escrow.amount);
    if (refundAmount <= 0) return { applied: false };
    const profile = profiles.get(bounty.posterId);
    if (!profile) return { applied: false };
    ledger.push({
      bountyId: bounty.id,
      userId: bounty.posterId,
      type: 'refund',
      amount: refundAmount,
      status: 'completed',
    });
    profile.balance += refundAmount;
    return { applied: true, refundAmount };
  }

  it('issue scenario: $8.40 balance → $1 bounty → $7.40 → poster wins dispute → $8.40', () => {
    const profiles = new Map<string, Profile>([['poster1', { id: 'poster1', balance: 8.4 }]]);
    const ledger: Ledger[] = [];

    // 1. Poster creates a $1 paid bounty. Trigger reserves escrow and debits.
    const created = insertBountyWithTrigger(profiles, ledger, {
      id: 'bounty1',
      posterId: 'poster1',
      amount: 1,
      isForHonor: false,
    });
    expect(created.committed).toBe(true);
    // Use toBeCloseTo to avoid IEEE-754 float artefacts (8.4 - 1 ≈ 7.4).
    expect(profiles.get('poster1')!.balance).toBeCloseTo(7.4, 10);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      bountyId: 'bounty1',
      type: 'escrow',
      amount: -1,
      status: 'completed',
    });

    // 2. Dispute is opened and resolved in the poster's favour.
    const refund = refundWalletEscrowForDispute(
      profiles,
      ledger,
      { bountyId: 'bounty1', status: 'resolved_poster_wins', winner: 'poster' },
      { id: 'bounty1', posterId: 'poster1', amount: 1, isForHonor: false }
    );
    expect(refund.applied).toBe(true);
    expect(refund.refundAmount).toBe(1);
    // Balance must be restored exactly to the starting $8.40.
    expect(profiles.get('poster1')!.balance).toBeCloseTo(8.4, 10);
    // Both the escrow debit and the refund credit are on the ledger.
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      bountyId: 'bounty1',
      type: 'refund',
      amount: 1,
      status: 'completed',
    });
  });

  it('refund RPC is idempotent: a retried resolution does not double-credit', () => {
    const profiles = new Map<string, Profile>([['poster1', { id: 'poster1', balance: 8.4 }]]);
    const ledger: Ledger[] = [];
    const bounty: Bounty = {
      id: 'bounty1',
      posterId: 'poster1',
      amount: 1,
      isForHonor: false,
    };
    const dispute = {
      bountyId: 'bounty1',
      status: 'resolved_poster_wins',
      winner: 'poster' as const,
    };

    insertBountyWithTrigger(profiles, ledger, bounty);
    const first = refundWalletEscrowForDispute(profiles, ledger, dispute, bounty);
    const second = refundWalletEscrowForDispute(profiles, ledger, dispute, bounty);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    // Balance is restored exactly once, regardless of how many times the
    // resolution is retried.
    expect(profiles.get('poster1')!.balance).toBeCloseTo(8.4, 10);
    expect(ledger.filter(r => r.type === 'refund')).toHaveLength(1);
  });

  it('refund RPC is a no-op when the dispute did not resolve in the poster\'s favour', () => {
    const profiles = new Map<string, Profile>([['poster1', { id: 'poster1', balance: 8.4 }]]);
    const ledger: Ledger[] = [];
    const bounty: Bounty = {
      id: 'bounty1',
      posterId: 'poster1',
      amount: 1,
      isForHonor: false,
    };

    insertBountyWithTrigger(profiles, ledger, bounty);

    // Hunter wins — wallet must not be credited.
    const hunterWins = refundWalletEscrowForDispute(
      profiles,
      ledger,
      { bountyId: 'bounty1', status: 'resolved_hunter_wins', winner: 'hunter' },
      bounty
    );
    expect(hunterWins.applied).toBe(false);
    expect(profiles.get('poster1')!.balance).toBeCloseTo(7.4, 10);

    // Open / undecided dispute — wallet must not be credited.
    const openDispute = refundWalletEscrowForDispute(
      profiles,
      ledger,
      { bountyId: 'bounty1', status: 'under_review', winner: null },
      bounty
    );
    expect(openDispute.applied).toBe(false);
    expect(profiles.get('poster1')!.balance).toBeCloseTo(7.4, 10);
  });

  it('Stripe-backed bounties are NOT refunded via the wallet RPC (handled by paymentService.refundEscrow)', () => {
    const profiles = new Map<string, Profile>([['poster1', { id: 'poster1', balance: 8.4 }]]);
    const ledger: Ledger[] = [];
    // Stripe-backed bounty: payment_intent_id is set, so the wallet trigger
    // does not run in real life. Model the ledger as empty and assert the
    // refund RPC declines to act.
    const stripeBounty: Bounty = {
      id: 'bounty1',
      posterId: 'poster1',
      amount: 1,
      isForHonor: false,
      paymentIntentId: 'pi_test_123',
    };

    const result = refundWalletEscrowForDispute(
      profiles,
      ledger,
      { bountyId: 'bounty1', status: 'resolved_poster_wins', winner: 'poster' },
      stripeBounty
    );
    expect(result.applied).toBe(false);
    expect(profiles.get('poster1')!.balance).toBeCloseTo(8.4, 10);
    expect(ledger).toHaveLength(0);
  });
});
