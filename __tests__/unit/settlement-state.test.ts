/**
 * ADR 0001 — the settlement invariant, tested behaviourally.
 *
 * The three regression tests Phase 3 requires are the last three describes in
 * this file. Each is written to FAIL against the pre-ADR code path and PASS
 * against the new one; where the enforcement lives in SQL or in a Deno Edge
 * Function that takes live Stripe/Supabase clients, the assertion is made
 * against the shipped source text — the same convention as
 * withdrawal-payout-integrity.test.ts and financial-invariants.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  deriveSettlementState,
  describeSettlement,
  hasStripeEvidence,
  mayDescribeAsPaid,
  type SettlementState,
  type WalletTxType,
} from '../../supabase/functions/_shared/settlement-state';
import * as clientVocab from '../../lib/utils/settlement-vocabulary';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const deriveTriggerSql = read(
  'supabase/migrations/20260824010200_derive_settlement_state_trigger.sql'
);
const evidenceCheckSql = read(
  'supabase/migrations/20260824010400_settlement_state_requires_evidence_check.sql'
);
const walletSource = read('supabase/functions/wallet/index.ts');
const adminWithdrawalsSource = read('supabase/functions/admin-withdrawals/index.ts');
const bountyPaymentsSource = read('supabase/functions/bounty-payments/index.ts');

const ALL_TYPES: WalletTxType[] = [
  'escrow',
  'release',
  'refund',
  'deposit',
  'withdrawal',
  'dispute_loss',
  'admin_adjustment',
];
const ALL_STATES: SettlementState[] = [
  'ledger_only',
  'stripe_pending',
  'stripe_settled',
  'stripe_failed',
];

// ─── Derivation ──────────────────────────────────────────────────────────────

describe('deriveSettlementState: evidence, never status', () => {
  test('a v1 release has no transfer id and is therefore ledger_only', () => {
    expect(deriveSettlementState({ type: 'release' })).toBe('ledger_only');
    expect(deriveSettlementState({ type: 'release', stripeTransferId: null })).toBe('ledger_only');
    // Empty string is not evidence. A blank column would otherwise read as
    // "settled" through a naive `!= null` check.
    expect(deriveSettlementState({ type: 'release', stripeTransferId: '   ' })).toBe('ledger_only');
  });

  test('a v2 release with a Stripe transfer is settled', () => {
    expect(deriveSettlementState({ type: 'release', stripeTransferId: 'tr_123' })).toBe(
      'stripe_settled'
    );
  });

  test('the 25 historical withdrawals classify as ledger_only, not settled', () => {
    // This is the exact shape of those rows: the ledger said completed, and
    // Stripe had no payout at all. The old rule read `status` and would have
    // called every one of these settled.
    expect(
      deriveSettlementState({
        type: 'withdrawal',
        stripePayoutId: null,
        stripeTransferId: 'tr_legacy', // a Transfer is NOT evidence of payment
      })
    ).toBe('ledger_only');
  });

  test('a transfer id can never settle a withdrawal', () => {
    // The 2026-08-13 incident in one assertion: hop one is not delivery.
    const state = deriveSettlementState({
      type: 'withdrawal',
      stripeTransferId: 'tr_abc',
      stripePayoutId: null,
      stripePayoutStatus: 'paid', // even this must not rescue it
    });
    expect(state).toBe('ledger_only');
    expect(mayDescribeAsPaid(state)).toBe(false);
  });

  test('a withdrawal with a payout is pending until Stripe says paid', () => {
    expect(deriveSettlementState({ type: 'withdrawal', stripePayoutId: 'po_1' })).toBe(
      'stripe_pending'
    );
    expect(
      deriveSettlementState({
        type: 'withdrawal',
        stripePayoutId: 'po_1',
        stripePayoutStatus: 'in_transit',
      })
    ).toBe('stripe_pending');
    expect(
      deriveSettlementState({
        type: 'withdrawal',
        stripePayoutId: 'po_1',
        stripePayoutStatus: 'paid',
      })
    ).toBe('stripe_settled');
  });

  test('a rejected payout is stripe_failed, never "on its way"', () => {
    for (const failure of ['failed', 'canceled']) {
      const state = deriveSettlementState({
        type: 'withdrawal',
        stripePayoutId: 'po_1',
        stripePayoutStatus: failure,
      });
      expect(state).toBe('stripe_failed');
      // The bug this fourth state exists to prevent: describing a rejected
      // payout with in-flight language.
      expect(describeSettlement('withdrawal', state).label).not.toBe('On its way');
    }
  });

  test('internal ledger movements are always ledger_only', () => {
    for (const type of ['escrow', 'dispute_loss', 'admin_adjustment'] as WalletTxType[]) {
      expect(
        deriveSettlementState({
          type,
          // Even with every evidence field populated: these types have no
          // external counterpart, so a stray id must not promote them.
          stripePayoutId: 'po_x',
          stripeTransferId: 'tr_x',
          stripeChargeId: 'ch_x',
          stripePayoutStatus: 'paid',
        })
      ).toBe('ledger_only');
    }
  });

  test('the ledger status field is never consulted', () => {
    // Passing a `status` through has no effect, because the input type has no
    // such field. This test is a tripwire: if someone adds one, it fails.
    const evidence = { type: 'withdrawal' as const, stripePayoutId: null };
    const withStatus = { ...evidence, status: 'completed' } as never;
    expect(deriveSettlementState(withStatus)).toBe(deriveSettlementState(evidence));
  });
});

// ─── Vocabulary ──────────────────────────────────────────────────────────────

describe('describeSettlement: "Paid" requires Stripe evidence', () => {
  test('no type/state pair says "Paid" unless stripe_settled', () => {
    for (const type of ALL_TYPES) {
      for (const state of ALL_STATES) {
        const { label } = describeSettlement(type, state);
        if (/^paid$/i.test(label)) {
          expect(state).toBe('stripe_settled');
        }
      }
    }
  });

  test('a v1 release is described as a balance credit, not a payment', () => {
    const { label, detail } = describeSettlement('release', 'ledger_only');
    expect(label).toBe('Added to balance');
    expect(detail).toMatch(/balance/i);
    expect(label).not.toMatch(/paid/i);
  });

  test('the 25 historical withdrawals read as unconfirmed, not complete', () => {
    const { label } = describeSettlement('withdrawal', 'ledger_only');
    expect(label).toBe('Unconfirmed');
  });

  test('client and edge vocabulary cannot drift', () => {
    // The two modules are duplicated on purpose (see the header of
    // lib/utils/settlement-vocabulary.ts). This is what keeps them honest.
    for (const type of ALL_TYPES) {
      for (const state of ALL_STATES) {
        expect(clientVocab.describeSettlement(type, state)).toEqual(
          describeSettlement(type, state)
        );
      }
    }
    for (const state of ALL_STATES) {
      expect(clientVocab.mayDescribeAsPaid(state)).toBe(mayDescribeAsPaid(state));
    }
  });

  test('an unknown settlement state on the client is not treated as paid', () => {
    expect(clientVocab.mayDescribeAsPaid(undefined)).toBe(false);
    expect(clientVocab.mayDescribeAsPaid(null)).toBe(false);
  });
});

describe('hasStripeEvidence', () => {
  test('is false for a row with no Stripe object', () => {
    expect(hasStripeEvidence({ type: 'release' })).toBe(false);
    expect(hasStripeEvidence({ type: 'withdrawal', stripePayoutId: '  ' })).toBe(false);
  });

  test('is true for any populated evidence column', () => {
    expect(hasStripeEvidence({ type: 'withdrawal', stripePayoutId: 'po_1' })).toBe(true);
    expect(hasStripeEvidence({ type: 'release', stripeTransferId: 'tr_1' })).toBe(true);
    expect(hasStripeEvidence({ type: 'deposit', stripeChargeId: 'ch_1' })).toBe(true);
  });
});

// ─── The SQL mirrors the TypeScript ─────────────────────────────────────────

describe('the derive trigger mirrors the shared module', () => {
  test('trigger fires BEFORE INSERT OR UPDATE so no writer can set the column', () => {
    expect(deriveTriggerSql).toMatch(
      /CREATE TRIGGER trg_wallet_tx_derive_settlement_state\s+BEFORE INSERT OR UPDATE ON public\.wallet_transactions/
    );
  });

  test('the trigger never reads NEW.status', () => {
    // The single most important property of this migration. A future edit that
    // reintroduces `status` as an input recreates the original defect.
    const body = deriveTriggerSql.slice(
      deriveTriggerSql.indexOf('fn_derive_settlement_state()'),
      deriveTriggerSql.indexOf('COMMENT ON FUNCTION public.fn_derive_settlement_state')
    );
    expect(body.length).toBeGreaterThan(200);

    // Strip `--` comments first: the function is documented with a note saying
    // NEW.status is deliberately never read, and asserting against raw text
    // would match that prose rather than the executable SQL it describes.
    const executable = body
      .split('\n')
      .map(line => line.replace(/--.*$/, ''))
      .join('\n');
    expect(executable).toMatch(/NEW\.stripe_payout_id/); // sanity: we sliced real code
    expect(executable).not.toMatch(/NEW\.status/);
  });

  test('the trigger encodes the same four outcomes as the module', () => {
    expect(deriveTriggerSql).toMatch(/p_payout_status = 'paid'[\s\S]*?'stripe_settled'/);
    expect(deriveTriggerSql).toMatch(/IN \('failed', 'canceled'\)[\s\S]*?'stripe_failed'/);
    expect(deriveTriggerSql).toMatch(/p_payout_id.*?IS NULL[\s\S]*?'ledger_only'/);
  });

  test('the shared rule takes no LEDGER status parameter', () => {
    // The signature is the guardrail. `p_payout_status` is permitted and
    // required — that is Stripe's own payout.status, i.e. evidence. What must
    // never appear is the ledger's own `status`, which is the application's
    // belief and is what the 25 historical rows prove cannot be trusted.
    const signature = deriveTriggerSql.slice(
      deriveTriggerSql.indexOf('FUNCTION public.fn_settlement_state_for('),
      deriveTriggerSql.indexOf('RETURNS public.settlement_state_enum')
    );
    expect(signature.length).toBeGreaterThan(50);
    expect(signature).toMatch(/p_payout_status\s+text/); // evidence: required
    expect(signature).not.toMatch(/\bp_status\b/); // belief: forbidden
    expect(signature).not.toMatch(/\bp_ledger_status\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The three Phase 3 regression tests.
// ═══════════════════════════════════════════════════════════════════════════

describe('REGRESSION 1: a v2 release cannot be settled without a transfer id', () => {
  test('the derivation refuses it', () => {
    expect(deriveSettlementState({ type: 'release', stripeTransferId: null })).not.toBe(
      'stripe_settled'
    );
  });

  test('a CHECK constraint enforces it independently of the trigger', () => {
    // Fails against the old code path: before this migration no constraint tied
    // a settled release to a transfer id, so a direct UPDATE could assert one.
    expect(evidenceCheckSql).toMatch(
      /CONSTRAINT wallet_transactions_settled_release_requires_transfer/
    );
    expect(evidenceCheckSql).toMatch(
      /type <> 'release'::wallet_tx_type_enum\s*OR settlement_state <> 'stripe_settled'\s*OR stripe_transfer_id IS NOT NULL/
    );
  });

  test('only the transfer.created webhook may mark a v2 payment released', () => {
    // The v2 half of the invariant, already true before this ADR — asserted
    // here so the two halves cannot drift apart.
    expect(bountyPaymentsSource).toMatch(/bp\.status === 'released' && bp\.stripe_transfer_id/);
  });
});

describe('REGRESSION 2: a withdrawal cannot be completed without a payout id', () => {
  test('the derivation refuses to call it settled', () => {
    // The bug class behind the 25 historical rows, stated as one assertion.
    expect(
      deriveSettlementState({
        type: 'withdrawal',
        stripePayoutId: null,
        stripeTransferId: 'tr_hop_one_only',
      })
    ).toBe('ledger_only');
  });

  test('a CHECK constraint enforces it with NO date exemption', () => {
    expect(evidenceCheckSql).toMatch(
      /CONSTRAINT wallet_transactions_settled_withdrawal_requires_payout/
    );
    // The 2026-08-16 constraint had to grandfather 25 rows via `created_at <`.
    // This one must not, because ledger_only is a true statement about them.
    const constraint = evidenceCheckSql.slice(
      evidenceCheckSql.indexOf('wallet_transactions_settled_withdrawal_requires_payout'),
      evidenceCheckSql.indexOf('COMMENT ON CONSTRAINT wallet_transactions_settled_withdrawal_requires_payout')
    );
    expect(constraint).not.toMatch(/created_at/);
  });

  test('the admin force_retry path no longer writes completed on a Transfer alone', () => {
    // Fails against the old code path: force_retry used to update
    // `{ stripe_transfer_id, status: 'completed' }` with no payout at all.
    const handler = adminWithdrawalsSource.slice(
      adminWithdrawalsSource.indexOf("if (action === 'force_retry')"),
      adminWithdrawalsSource.indexOf("if (action === 'manual_adjustment')")
    );
    expect(handler.length).toBeGreaterThan(500);

    // It must now create a Payout...
    expect(handler).toMatch(/stripe\.payouts\.create/);
    // ...record its id...
    expect(handler).toMatch(/stripe_payout_id: retryPayout\?\.id \?\? null/);
    // ...and leave the row pending.
    expect(handler).toMatch(/status: 'pending'/);
    // The regression itself: no completed write anywhere in this handler.
    expect(handler).not.toMatch(/status: 'completed'/);
  });

  test('force_retry consults the state machine instead of forcing the transition', () => {
    expect(adminWithdrawalsSource).toMatch(/mayAdminReopenFailedWithdrawal/);
  });
});

describe('REGRESSION 3: an unready hunter cannot trigger a settled fund release', () => {
  test('the v2 release endpoint blocks a hunter without payouts enabled', () => {
    // The /release route now serves v3 first (it captures an authorization and
    // Transfers) and falls through to the v2 path. Slice to the LAST
    // stripe.transfers.create so the v2 release guard — which sits after the v3
    // block's own Transfer call — is included.
    const releaseRoute = bountyPaymentsSource.slice(
      bountyPaymentsSource.indexOf("subPath === '/release'"),
      bountyPaymentsSource.lastIndexOf('stripe.transfers.create')
    );
    expect(releaseRoute.length).toBeGreaterThan(500);
    expect(releaseRoute).toMatch(/stripe_connect_payouts_enabled !== true/);
    expect(releaseRoute).toMatch(/hunter_payouts_disabled/);
    expect(releaseRoute).toMatch(/hunter_not_onboarded/);
  });

  test('a v1 release to an unready hunter can never claim settlement', () => {
    // ADR 0001 §4.3 (B3): v1 release is deliberately NOT blocked, because the
    // credit is recoverable and blocking strands the poster's escrow. What is
    // guaranteed instead is that it can never be *described* as paid.
    const state = deriveSettlementState({ type: 'release', stripeTransferId: null });
    expect(mayDescribeAsPaid(state)).toBe(false);
    expect(describeSettlement('release', state).label).toBe('Added to balance');
  });

  test('the v1 release path reports hunter payout readiness to the caller', () => {
    const releaseRoute = walletSource.slice(walletSource.indexOf("subPath === '/release'"));
    expect(releaseRoute).toMatch(/stripe_connect_payouts_enabled/);
    expect(releaseRoute).toMatch(/hunterPayoutReady/);
    // And it must not claim payment.
    expect(releaseRoute).not.toMatch(/released to hunter/);
  });

  test('every release path notifies an unready payee, including the PL/pgSQL one', () => {
    const notifySql = read(
      'supabase/migrations/20260824010500_notify_unready_payee_on_release.sql'
    );
    // Two triggers, because /wallet/release promotes pending -> completed via
    // UPDATE while the dispute path inserts completed directly. An INSERT-only
    // trigger would silently cover just one of them.
    expect(notifySql).toMatch(/AFTER INSERT ON public\.wallet_transactions/);
    expect(notifySql).toMatch(/AFTER UPDATE ON public\.wallet_transactions/);
    expect(notifySql).toMatch(/OLD\.status IS DISTINCT FROM 'completed'/);
    expect(notifySql).toMatch(/notifications_outbox/);
  });

  test('the withdrawal gate uses the live-synced field, not the never-cleared one', () => {
    const connectSource = read('supabase/functions/connect/index.ts');
    const instantRoute = connectSource.slice(
      connectSource.indexOf("subPath === '/instant-payout'")
    );
    // stripe_connect_onboarded_at is set once and never cleared, so a
    // since-restricted hunter passed the old gate.
    expect(instantRoute).toMatch(/p\.stripe_connect_payouts_enabled !== true/);
    expect(instantRoute).toMatch(/payouts_disabled/);
  });
});

// ─── Migration hygiene ──────────────────────────────────────────────────────

describe('migration set', () => {
  test('all ADR 0001 migrations are present and ordered', () => {
    const expected = [
      '20260824010000_add_stripe_payout_status_column.sql',
      '20260824010100_add_settlement_state.sql',
      '20260824010200_derive_settlement_state_trigger.sql',
      '20260824010300_backfill_settlement_state.sql',
      '20260824010400_settlement_state_requires_evidence_check.sql',
      '20260824010500_notify_unready_payee_on_release.sql',
    ];
    const present = fs.readdirSync(MIGRATIONS);
    for (const file of expected) {
      expect(present).toContain(file);
    }
    // The backfill must sort after the trigger that it fires, or it computes
    // nothing; the CHECK must sort after the backfill, or it rejects rows that
    // have not been classified yet.
    expect(expected).toEqual([...expected].sort());
  });

  test('the backfill calls the shared rule rather than duplicating the CASE', () => {
    const backfill = read('supabase/migrations/20260824010300_backfill_settlement_state.sql');
    expect(backfill).toMatch(/SET settlement_state = public\.fn_settlement_state_for\(/);
    // A second implementation of the rule is a second thing that can be wrong.
    const executable = backfill
      .split('\n')
      .map(l => l.replace(/--.*$/, ''))
      .join('\n');
    expect(executable).not.toMatch(/WHEN p_payout_status = 'paid'/);
  });

  test('the backfill does not silently rewrite updated_at on a financial ledger', () => {
    // set_updated_at() is `NEW.updated_at = NOW()` unconditionally, so ANY
    // update to this table rewrites the audit timestamp unless the trigger is
    // suppressed. An earlier draft used `SET updated_at = updated_at` believing
    // it a no-op; it was not.
    const backfill = read('supabase/migrations/20260824010300_backfill_settlement_state.sql');
    expect(backfill).not.toMatch(
      /UPDATE public\.wallet_transactions\s+SET updated_at = updated_at/
    );
    expect(backfill).toMatch(
      /DISABLE TRIGGER trg_wallet_transactions_updated_at/
    );
    expect(backfill).toMatch(/ENABLE TRIGGER trg_wallet_transactions_updated_at/);
  });

  test('the backfill does not broadcast fabricated change events', () => {
    const backfill = read('supabase/migrations/20260824010300_backfill_settlement_state.sql');
    expect(backfill).toMatch(/SELECT EXISTS \(/);
    expect(backfill).toMatch(/trigger\.tgname = 'wallet_transactions_broadcast_trigger'/);
    expect(backfill).toMatch(/IF v_has_broadcast_trigger THEN/);
    expect(backfill).toMatch(/DISABLE TRIGGER wallet_transactions_broadcast_trigger/);
    expect(backfill).toMatch(/ENABLE TRIGGER wallet_transactions_broadcast_trigger/);
  });

  test('every disabled trigger is re-enabled', () => {
    const backfill = read('supabase/migrations/20260824010300_backfill_settlement_state.sql');
    const disabled = [...backfill.matchAll(/DISABLE TRIGGER (\w+)/g)].map(m => m[1]);
    const enabled = [...backfill.matchAll(/ENABLE TRIGGER (\w+)/g)].map(m => m[1]);
    expect(disabled.length).toBeGreaterThan(0);
    expect([...disabled].sort()).toEqual([...enabled].sort());
  });

  test('the backfill asserts its own invariants instead of trusting the run', () => {
    const backfill = read('supabase/migrations/20260824010300_backfill_settlement_state.sql');
    expect(backfill).toMatch(/RAISE EXCEPTION 'backfill produced a settled release/);
    expect(backfill).toMatch(/RAISE EXCEPTION 'backfill produced a settled withdrawal/);
  });
});
