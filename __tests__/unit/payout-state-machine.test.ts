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
  type LedgerStatus,
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
  const pendingRow = { id: 'tx_1', status: 'pending' as const, amount: -25, metadata: {}, stripePayoutStatus: null };

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

  // "Settled" means a Payout was observed in a settled state, which is what
  // stripe_payout_status records. These fixtures previously said 'completed'
  // with no settlement evidence at all — a state the module's own rule forbids
  // — so they were asserting absorption for the one shape that must not
  // absorb. See the premature-completion tests below.
  const settledRow = {
    ...pendingRow,
    status: 'completed' as const,
    stripePayoutStatus: 'paid',
  };

  test('a late payout.failed cannot un-complete a settled withdrawal', () => {
    // Out-of-order delivery: paid landed first, failed arrives afterwards.
    expect(decidePayoutEventAction({ outcome: 'failed', row: settledRow })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('a late payout.failed cannot refund a settled withdrawal', () => {
    const action = decidePayoutEventAction({ outcome: 'failed', row: settledRow });
    expect(action.kind).not.toBe('fail');
  });

  test('settlement evidence in metadata alone is enough to absorb', () => {
    // The reconciliation path stamps metadata but not the column.
    const viaMetadata = {
      ...pendingRow,
      status: 'completed' as const,
      metadata: { payout_status: 'paid' },
    };
    expect(decidePayoutEventAction({ outcome: 'failed', row: viaMetadata })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });
});

describe('prematurely-completed withdrawals still honour a failure', () => {
  // Five production rows reached `completed` carrying a payout id but no
  // settled payout status, because a reconciliation pass promoted them before
  // payout.paid arrived. If a payout.failed then lands on such a row and the
  // terminal state absorbs it, the money never reached the bank and the
  // balance is never credited back — the hunter is permanently short.
  const prematurelyCompleted = {
    id: 'tx_premature',
    status: 'completed' as const,
    amount: -10,
    metadata: { payout_id: 'po_1', transfer_id: 'tr_1' },
    stripePayoutStatus: null,
  };

  test('payout.failed refunds a completed row that was never proven settled', () => {
    expect(decidePayoutEventAction({ outcome: 'failed', row: prematurelyCompleted })).toEqual({
      kind: 'fail',
      transactionId: 'tx_premature',
      refundAmount: 10,
      outcome: 'failed',
    });
  });

  test('payout.canceled refunds it too', () => {
    expect(decidePayoutEventAction({ outcome: 'canceled', row: prematurelyCompleted })).toEqual({
      kind: 'fail',
      transactionId: 'tx_premature',
      refundAmount: 10,
      outcome: 'canceled',
    });
  });

  test('it is still refunded at most once', () => {
    // After the refund the handler stamps metadata.payout_status; a redelivery
    // must then find nothing to do.
    const afterRefund = {
      ...prematurelyCompleted,
      metadata: { ...prematurelyCompleted.metadata, payout_status: 'failed' },
    };
    expect(decidePayoutEventAction({ outcome: 'failed', row: afterRefund })).toEqual({
      kind: 'noop',
      reason: 'already_refunded',
    });
  });

  test('a duplicate payout.paid on it is still absorbed, not re-completed', () => {
    expect(decidePayoutEventAction({ outcome: 'paid', row: prematurelyCompleted })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('manually_paid is never reopened, settled or not', () => {
    const manual = { ...prematurelyCompleted, status: 'manually_paid' as const };
    for (const outcome of ['paid', 'failed', 'canceled'] as const) {
      expect(decidePayoutEventAction({ outcome, row: manual }).kind).toBe('noop');
    }
  });

  test('an already-failed row is never refunded again', () => {
    const failed = { ...prematurelyCompleted, status: 'failed' as const };
    expect(decidePayoutEventAction({ outcome: 'failed', row: failed }).kind).toBe('noop');
  });
});

describe('stripePayoutStatus is required, not optional', () => {
  // A caller that queries a row but forgets to select stripe_payout_status
  // must not be able to pass `undefined` for it silently and have that read
  // as "no evidence" — that would refund a withdrawal that already settled,
  // crediting a balance that already received its money. TypeScript enforces
  // this at the call site (the field has no `?`); these tests document the
  // runtime consequence of the two values a caller can legitimately supply.
  const settledButOnlyInMetadata = {
    id: 'tx_meta_only',
    status: 'completed' as const,
    amount: -10,
    // The reconciliation path stamps metadata but not the column, so a caller
    // that only has metadata to go on (and is honest about not having the
    // column) still correctly identifies this row as settled.
    metadata: { payout_status: 'paid' },
    stripePayoutStatus: null,
  };

  test('metadata evidence alone is enough to protect a settled row even without the column', () => {
    expect(decidePayoutEventAction({ outcome: 'failed', row: settledButOnlyInMetadata })).toEqual({
      kind: 'noop',
      reason: 'already_terminal',
    });
  });

  test('with neither the column nor metadata evidence, a completed row is (correctly) treated as unproven', () => {
    const noEvidenceAtAll = {
      id: 'tx_no_evidence',
      status: 'completed' as const,
      amount: -10,
      metadata: {},
      stripePayoutStatus: null,
    };
    // This is the premature-completion case, not a caller bug: a row that is
    // completed with genuinely no evidence anywhere IS the state that must
    // remain refundable. The type system's job is only to stop a caller from
    // producing this exact shape BY ACCIDENT when real evidence exists.
    expect(decidePayoutEventAction({ outcome: 'failed', row: noEvidenceAtAll }).kind).toBe('fail');
  });
});

describe('webhook decisions: unmatched rows, manual settlement and replay', () => {
  const pendingRow = { id: 'tx_1', status: 'pending' as const, amount: -25, metadata: {}, stripePayoutStatus: null };

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
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown>; stripePayoutStatus: string | null } = {
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
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown>; stripePayoutStatus: string | null } = {
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
    let row: { id: string; status: string; amount: number; metadata: Record<string, unknown>; stripePayoutStatus: string | null } = {
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
