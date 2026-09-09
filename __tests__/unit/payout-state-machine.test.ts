/**
 * Behavioural tests for the withdrawal/payout state machine.
 *
 * REGRESSION TARGET: the 2026-08-13 incident, in which 13 withdrawals
 * ($275, 2 users) were written to the ledger as `completed` because a Stripe
 * *Transfer* had succeeded and an instant payout had failed. No Stripe Payout
 * existed for any of them.
 *
 * Unlike the source-contract suites in this directory, these exercise the real
 * exported logic in supabase/functions/_shared/payout-state.ts — the module
 * both the connect and webhooks Edge Functions import — so the guarantees
 * below are properties of the running code, not of its text.
 */
import {
  RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES,
  NON_RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES,
  buildNativePayoutIdempotencyKey,
  isRecoverableInstantPayoutError,
  mapStripePayoutStatusToLedger,
  isTerminalLedgerStatus,
  canTransition,
  mayCompleteWithdrawal,
  decidePayoutEventAction,
  buildPayoutIdempotencyKey,
  buildTransferIdempotencyKey,
  selectTwoHopWithdrawalMatch,
  type LedgerStatus,
  type TwoHopCandidateRow,
} from '../../supabase/functions/_shared/payout-state';

const ALL_STATUSES: LedgerStatus[] = ['pending', 'completed', 'failed', 'manually_paid'];

describe('the core invariant: completion requires a settled payout', () => {
  test('a withdrawal cannot complete without a payout id', () => {
    expect(
      mayCompleteWithdrawal({
        currentStatus: 'pending',
        stripePayoutId: null,
        stripePayoutStatus: 'paid',
      })
    ).toBe(false);
  });

  test('a withdrawal cannot complete on a payout that has not settled', () => {
    for (const status of ['pending', 'in_transit']) {
      expect(
        mayCompleteWithdrawal({
          currentStatus: 'pending',
          stripePayoutId: 'po_123',
          stripePayoutStatus: status,
        })
      ).toBe(false);
    }
  });

  test('a withdrawal cannot complete on a failed or canceled payout', () => {
    for (const status of ['failed', 'canceled']) {
      expect(
        mayCompleteWithdrawal({
          currentStatus: 'pending',
          stripePayoutId: 'po_123',
          stripePayoutStatus: status,
        })
      ).toBe(false);
    }
  });

  test('a withdrawal completes only on a paid payout with an id', () => {
    expect(
      mayCompleteWithdrawal({
        currentStatus: 'pending',
        stripePayoutId: 'po_123',
        stripePayoutStatus: 'paid',
      })
    ).toBe(true);
  });

  test('a successful Transfer is not expressible as completion', () => {
    // There is deliberately no argument shape by which a transfer id alone
    // can satisfy this predicate. This is the 2026-08-13 bug in one assertion.
    expect(
      mayCompleteWithdrawal({
        currentStatus: 'pending',
        stripePayoutId: null,
        stripePayoutStatus: null,
      })
    ).toBe(false);
  });
});

describe('Stripe payout status -> ledger status', () => {
  test('only `paid` maps to completed', () => {
    expect(mapStripePayoutStatusToLedger('paid')).toBe('completed');
  });

  test('failed and canceled map to failed', () => {
    expect(mapStripePayoutStatusToLedger('failed')).toBe('failed');
    expect(mapStripePayoutStatusToLedger('canceled')).toBe('failed');
  });

  test('in-flight statuses map to no transition at all', () => {
    expect(mapStripePayoutStatusToLedger('pending')).toBeNull();
    expect(mapStripePayoutStatusToLedger('in_transit')).toBeNull();
  });

  test('an unknown status never invents a transition', () => {
    expect(mapStripePayoutStatusToLedger('some_future_status')).toBeNull();
  });
});

describe('transition legality', () => {
  test('pending is the only non-terminal status', () => {
    expect(isTerminalLedgerStatus('pending')).toBe(false);
    for (const s of ['completed', 'failed', 'manually_paid']) {
      expect(isTerminalLedgerStatus(s)).toBe(true);
    }
  });

  test('terminal statuses absorb every transition', () => {
    for (const from of ALL_STATUSES.filter(s => s !== 'pending')) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  test('pending may reach every terminal status', () => {
    expect(canTransition('pending', 'completed')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);
    expect(canTransition('pending', 'manually_paid')).toBe(true);
  });

  test('an unknown source status permits nothing', () => {
    expect(canTransition('bogus', 'completed')).toBe(false);
  });
});

describe('instant-payout error classification', () => {
  test('both incident error codes fall back rather than failing the withdrawal', () => {
    expect(
      isRecoverableInstantPayoutError('cannot_create_connect_instant_payouts_through_api')
    ).toBe(true);
    expect(isRecoverableInstantPayoutError('instant_payouts_limit_exceeded')).toBe(true);
  });

  test('every declared recoverable code is recoverable', () => {
    for (const code of RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES) {
      expect(isRecoverableInstantPayoutError(code)).toBe(true);
    }
  });

  test('account-level failures do not fall back to the same destination', () => {
    for (const code of NON_RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES) {
      expect(isRecoverableInstantPayoutError(code)).toBe(false);
    }
  });

  test('an unrecognised code falls back rather than stranding the funds', () => {
    expect(isRecoverableInstantPayoutError('brand_new_stripe_code')).toBe(true);
    expect(isRecoverableInstantPayoutError(null)).toBe(true);
    expect(isRecoverableInstantPayoutError(undefined)).toBe(true);
  });

  test('classification never itself authorises completion', () => {
    // Whichever branch is taken, the withdrawal is not paid by taking it.
    for (const code of [
      ...RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES,
      ...NON_RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES,
    ]) {
      isRecoverableInstantPayoutError(code);
      expect(
        mayCompleteWithdrawal({
          currentStatus: 'pending',
          stripePayoutId: null,
          stripePayoutStatus: null,
        })
      ).toBe(false);
    }
  });
});

describe('webhook decisions: duplicates, replays and out-of-order delivery', () => {
  const pendingRow = { id: 'tx_1', status: 'pending' as const, amount: -25, metadata: {} };

  test('payout.paid completes a pending withdrawal', () => {
    expect(decidePayoutEventAction({ outcome: 'paid', row: pendingRow })).toEqual({
      kind: 'complete',
      transactionId: 'tx_1',
    });
  });

  test('a duplicate payout.paid is a no-op', () => {
    const completed = { ...pendingRow, status: 'completed' as const };
    expect(decidePayoutEventAction({ outcome: 'paid', row: completed })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('payout.failed refunds a pending withdrawal exactly once', () => {
    expect(decidePayoutEventAction({ outcome: 'failed', row: pendingRow })).toEqual({
      kind: 'fail',
      transactionId: 'tx_1',
      refundAmount: 25,
      outcome: 'failed',
    });
  });

  test('payout.canceled refunds a pending withdrawal exactly once', () => {
    expect(decidePayoutEventAction({ outcome: 'canceled', row: pendingRow })).toEqual({
      kind: 'fail',
      transactionId: 'tx_1',
      refundAmount: 25,
      outcome: 'canceled',
    });
  });

  test('a redelivered failure does not refund a second time', () => {
    const alreadyRefunded = {
      ...pendingRow,
      status: 'failed' as const,
      metadata: { payout_status: 'failed' },
    };
    expect(decidePayoutEventAction({ outcome: 'failed', row: alreadyRefunded })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('a refund marker on a still-pending row also blocks a second refund', () => {
    // Defends the window where metadata was written but status had not yet
    // been observed as terminal by this replica.
    const marked = { ...pendingRow, metadata: { payout_status: 'canceled' } };
    expect(decidePayoutEventAction({ outcome: 'failed', row: marked })).toEqual({
      kind: 'noop',
      reason: 'already_refunded',
    });
  });

  test('a late payout.failed cannot un-complete a settled withdrawal', () => {
    // Out-of-order delivery: paid landed first, failed arrives afterwards.
    const completed = { ...pendingRow, status: 'completed' as const };
    expect(decidePayoutEventAction({ outcome: 'failed', row: completed })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('a late payout.failed cannot refund a settled withdrawal', () => {
    const completed = { ...pendingRow, status: 'completed' as const };
    const action = decidePayoutEventAction({ outcome: 'failed', row: completed });
    expect(action.kind).not.toBe('fail');
  });

  test('an unmatched payout produces no ledger effect', () => {
    for (const outcome of ['paid', 'failed', 'canceled'] as const) {
      expect(decidePayoutEventAction({ outcome, row: null })).toEqual({
        kind: 'noop',
        reason: 'no_matching_withdrawal',
      });
    }
  });

  test('a manually_paid row is never disturbed by a payout event', () => {
    const manual = { ...pendingRow, status: 'manually_paid' as const };
    for (const outcome of ['paid', 'failed', 'canceled'] as const) {
      expect(decidePayoutEventAction({ outcome, row: manual }).kind).toBe('noop');
    }
  });

  test('replaying the same event N times has the effect of applying it once', () => {
    // Model the CAS the handler performs: apply the action, then re-decide.
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown> } = {
      ...pendingRow,
    };
    let completions = 0;

    for (let i = 0; i < 5; i++) {
      const action = decidePayoutEventAction({ outcome: 'paid', row });
      if (action.kind === 'complete') {
        completions++;
        row = { ...row, status: 'completed' };
      }
    }
    expect(completions).toBe(1);
  });

  test('replaying a failure N times refunds exactly once', () => {
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown> } = {
      ...pendingRow,
    };
    let refunded = 0;

    for (let i = 0; i < 5; i++) {
      const action = decidePayoutEventAction({ outcome: 'failed', row });
      if (action.kind === 'fail') {
        refunded += action.refundAmount;
        row = { ...row, status: 'failed', metadata: { payout_status: 'failed' } };
      }
    }
    expect(refunded).toBe(25);
  });

  test('two concurrent deliveries resolve to a single effect', () => {
    // Both callers read the same pending row and both decide 'complete'; the
    // CAS in the handler is what serialises them. Model that: the first write
    // wins, the second re-decides against the updated row.
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown> } = {
      ...pendingRow,
    };
    const first = decidePayoutEventAction({ outcome: 'paid', row });
    const secondBeforeWrite = decidePayoutEventAction({ outcome: 'paid', row });
    expect(first.kind).toBe('complete');
    expect(secondBeforeWrite.kind).toBe('complete');

    // First write lands.
    row = { ...row, status: 'completed' };
    // Second write is a CAS on status='pending' and matches nothing.
    expect(decidePayoutEventAction({ outcome: 'paid', row }).kind).toBe('noop');
  });
});

describe('idempotency keys are deterministic', () => {
  const args = { userId: 'user_1', clientKey: 'key_abc', amountCents: 1500 } as const;

  test('the same logical payout produces the same key every time', () => {
    const a = buildPayoutIdempotencyKey({ ...args, method: 'standard' });
    const b = buildPayoutIdempotencyKey({ ...args, method: 'standard' });
    expect(a).toBe(b);
  });

  test('the same logical transfer produces the same key every time', () => {
    const a = buildTransferIdempotencyKey({ ...args, purpose: 'instant' });
    const b = buildTransferIdempotencyKey({ ...args, purpose: 'instant' });
    expect(a).toBe(b);
  });

  test('keys carry no timestamp, so a retry replays instead of paying twice', () => {
    // The pre-fix keys interpolated Date.now(), which is exactly why Stripe's
    // idempotency protection never engaged on retry.
    const key = buildPayoutIdempotencyKey({ ...args, method: 'standard' });
    expect(key).not.toMatch(/\d{13}/);
  });

  test('different amounts, methods and users do not collide', () => {
    const base = buildPayoutIdempotencyKey({ ...args, method: 'standard' });
    expect(buildPayoutIdempotencyKey({ ...args, method: 'instant' })).not.toBe(base);
    expect(buildPayoutIdempotencyKey({ ...args, amountCents: 1501, method: 'standard' })).not.toBe(
      base
    );
    expect(buildPayoutIdempotencyKey({ ...args, userId: 'user_2', method: 'standard' })).not.toBe(
      base
    );
  });

  test('transfer and payout keys never collide with each other', () => {
    expect(buildTransferIdempotencyKey({ ...args, purpose: 'standard' })).not.toBe(
      buildPayoutIdempotencyKey({ ...args, method: 'standard' })
    );
  });

  test('hashed keys stay within Stripe’s 255-character limit even with a long client key', () => {
    const longClientKey = 'k'.repeat(200);
    expect(
      buildTransferIdempotencyKey({
        userId: '12345678-1234-1234-1234-123456789abc',
        clientKey: longClientKey,
        amountCents: 9_999_999,
        purpose: 'standard',
      }).length
    ).toBeLessThanOrEqual(255);
    expect(
      buildPayoutIdempotencyKey({
        userId: '12345678-1234-1234-1234-123456789abc',
        clientKey: longClientKey,
        amountCents: 9_999_999,
        method: 'standard',
      }).length
    ).toBeLessThanOrEqual(255);
    expect(
      buildNativePayoutIdempotencyKey({
        userId: '12345678-1234-1234-1234-123456789abc',
        clientKey: longClientKey,
        amountCents: 9_999_999,
        method: 'standard',
      }).length
    ).toBeLessThanOrEqual(255);
  });
});

/**
 * REGRESSION TARGET: withdrawal 205beb22 (user 6fdeb6f5, $49.36), created
 * 2026-09-01 and still `pending` on 2026-09-08 — a week after Stripe payout
 * po_1UB2dy… had actually paid it into the hunter's bank.
 *
 * Cause: /connect could not create the Payout itself
 * (`cannot_create_connect_standard_payouts_through_api`, which Stripe returns
 * for a connected account on an automatic payout schedule), so the row was
 * born with a NULL `stripe_payout_id`. Both webhook paths that could have
 * attached the id looked the row up *by* that same id, so neither could ever
 * find it. `payout.created`'s backfill was doubly unreachable: it then
 * guarded its write with `stripe_payout_id IS NULL`, which its own lookup had
 * just excluded.
 *
 * These tests pin the two rules that let the new matcher be safe where the
 * amount-only heuristic removed on 2026-08-16 was not: destination identity
 * and uniqueness.
 */
describe('selectTwoHopWithdrawalMatch', () => {
  const BANK = 'ba_1UApGBJpXfRe26uc2EdE9zOJ';

  const row = (over: Partial<TwoHopCandidateRow> = {}): TwoHopCandidateRow => ({
    id: 'tx-1',
    amount: -49.36,
    status: 'pending',
    metadata: { destination_bank_account_id: BANK },
    ...over,
  });

  it('matches the real stranded withdrawal: exact cents and same destination', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row()],
      payoutAmountCents: 4936,
      payoutDestination: BANK,
    });
    expect(result).toEqual({ kind: 'match', row: expect.objectContaining({ id: 'tx-1' }) });
  });

  it('compares the absolute value of a negative ledger amount', () => {
    expect(
      selectTwoHopWithdrawalMatch({
        candidates: [row({ amount: '-49.36' })],
        payoutAmountCents: 4936,
        payoutDestination: BANK,
      }).kind
    ).toBe('match');
  });

  it('refuses a different destination even when the amount is exact', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row()],
      payoutAmountCents: 4936,
      payoutDestination: 'ba_someoneElsesBank',
    });
    expect(result).toEqual({ kind: 'none', reason: 'no_exact_match' });
  });

  it('refuses a row carrying no destination at all', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row({ metadata: {} }), row({ id: 'tx-2', metadata: null })],
      payoutAmountCents: 4936,
      payoutDestination: BANK,
    });
    expect(result).toEqual({ kind: 'none', reason: 'no_exact_match' });
  });

  it('refuses when the payout itself has no destination — amount alone is never enough', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row()],
      payoutAmountCents: 4936,
      payoutDestination: null,
    });
    expect(result).toEqual({ kind: 'none', reason: 'no_destination' });
  });

  it('refuses a cent-off amount rather than rounding toward a match', () => {
    expect(
      selectTwoHopWithdrawalMatch({
        candidates: [row({ amount: -49.35 })],
        payoutAmountCents: 4936,
        payoutDestination: BANK,
      })
    ).toEqual({ kind: 'none', reason: 'no_exact_match' });
  });

  /**
   * Stripe's automatic payouts sweep the connected account's entire balance,
   * so a sweep settling two withdrawals equals neither of them. Matching
   * nothing is the correct — and safe — outcome.
   */
  it('does not match a balance sweep covering two withdrawals', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row({ id: 'a', amount: -20 }), row({ id: 'b', amount: -29.36 })],
      payoutAmountCents: 4936,
      payoutDestination: BANK,
    });
    expect(result).toEqual({ kind: 'none', reason: 'no_exact_match' });
  });

  it('reports ambiguity instead of guessing between two identical candidates', () => {
    const result = selectTwoHopWithdrawalMatch({
      candidates: [row({ id: 'a' }), row({ id: 'b' })],
      payoutAmountCents: 4936,
      payoutDestination: BANK,
    });
    expect(result).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('returns no_candidates when the caller narrowed everything away', () => {
    expect(
      selectTwoHopWithdrawalMatch({
        candidates: [],
        payoutAmountCents: 4936,
        payoutDestination: BANK,
      })
    ).toEqual({ kind: 'none', reason: 'no_candidates' });
  });

  it('never returns a row it was not given', () => {
    const only = row();
    const result = selectTwoHopWithdrawalMatch({
      candidates: [only],
      payoutAmountCents: 4936,
      payoutDestination: BANK,
    });
    expect(result.kind === 'match' && result.row).toBe(only);
  });
});
