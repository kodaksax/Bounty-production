/**
 * The settlement invariant — ADR 0001.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * On 2026-08-24 a forensic audit established that the v1 payment architecture
 * (the ledger behind all 44 bounties ever marked completed) never calls Stripe
 * on either the escrow or the release side. That is not a defect: an in-app
 * balance is a legitimate product primitive. The defect was that the system
 * *described* a v1 ledger credit using the vocabulary of settlement — "Paid",
 * "released to hunter", a green check — when no money had left the platform and,
 * for 313 of 315 profiles, no money could.
 *
 * The rule this module encodes:
 *
 *     A record may only be described to a user as settled when a Stripe object
 *     confirms it. Everything else is described as what it actually is.
 *
 * THE ONE RULE ABOUT `status`
 * ---------------------------
 * `deriveSettlementState` never reads the ledger's own `status`. That is
 * deliberate and it is the whole point. `status` is an assertion the
 * application makes; a Stripe id is evidence. Of the 27 withdrawals marked
 * `completed` before 2026-08-16, 25 have no `stripe_payout_id` — a rule that
 * trusted `status` would certify exactly those 25 as settled, which is the bug
 * this module exists to close.
 *
 * This file is deliberately dependency-free and side-effect-free so it can be
 * imported by Deno (Edge Functions) and Jest alike, and so the derivation can
 * be tested directly rather than inferred from source. It mirrors, statement
 * for statement, the SQL in
 * supabase/migrations/20260824010200_derive_settlement_state_trigger.sql —
 * settlement-state.test.ts asserts the two agree.
 */

/**
 * Mirrors the `settlement_state_enum` Postgres type.
 *
 * ADR 0001 §2.1 specified three states. `stripe_failed` was added during
 * implementation: without it a payout Stripe had explicitly rejected derived as
 * `stripe_pending`, which `describeSettlement` renders as "On its way" — a
 * statement that is not merely imprecise but false, and false in the same
 * direction as the bug this module exists to fix. A Stripe object that tried
 * and did not deliver is its own fact and needs its own name.
 */
export type SettlementState =
  | 'ledger_only'
  | 'stripe_pending'
  | 'stripe_settled'
  | 'stripe_failed';

/** Mirrors the `wallet_tx_type_enum` Postgres type. */
export type WalletTxType =
  | 'escrow'
  | 'release'
  | 'refund'
  | 'deposit'
  | 'withdrawal'
  | 'dispute_loss'
  | 'admin_adjustment';

/** Stripe's own Payout lifecycle statuses, as recorded on the ledger row. */
export type StripePayoutStatus = 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';

/**
 * The evidence columns on a `wallet_transactions` row. Note the absence of
 * `status` — see the module comment. Adding it here would be the regression.
 */
export interface SettlementEvidence {
  type: WalletTxType | string;
  stripePayoutId?: string | null;
  stripePayoutStatus?: StripePayoutStatus | string | null;
  stripeTransferId?: string | null;
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeRefundId?: string | null;
}

const present = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Classifies a ledger row by what Stripe can actually prove about it.
 *
 * `stripe_pending` exists as a distinct state because it is where every
 * correctly-behaving withdrawal lives for the 1-2 business days a standard
 * payout takes to land. Collapsing it into `stripe_settled` is precisely the
 * 2026-08-13 incident (a submitted payout called paid); collapsing it into
 * `ledger_only` would erase the fact that real money is in flight.
 */
export function deriveSettlementState(row: SettlementEvidence): SettlementState {
  switch (row.type) {
    case 'withdrawal':
      // A payout id is the only evidence a withdrawal was ever attempted at
      // Stripe. Without one the row is a ledger assertion and nothing more —
      // this is the branch that correctly reclassifies the 25 historical rows.
      if (!present(row.stripePayoutId)) return 'ledger_only';
      if (row.stripePayoutStatus === 'paid') return 'stripe_settled';
      if (row.stripePayoutStatus === 'failed' || row.stripePayoutStatus === 'canceled') {
        return 'stripe_failed';
      }
      return 'stripe_pending';

    case 'deposit':
      return present(row.stripePaymentIntentId) || present(row.stripeChargeId)
        ? 'stripe_settled'
        : 'ledger_only';

    case 'release':
      // v1 releases can never have a transfer id (the wallet function does not
      // import Stripe at all), so every v1 release lands in `ledger_only` by
      // construction. v2 releases carry one, set only by transfer.created.
      return present(row.stripeTransferId) ? 'stripe_settled' : 'ledger_only';

    case 'refund':
      return present(row.stripeRefundId) ? 'stripe_settled' : 'ledger_only';

    default:
      // escrow, dispute_loss, admin_adjustment: internal ledger movements with
      // no external counterpart, by definition.
      return 'ledger_only';
  }
}

/**
 * True when a row carries any Stripe object at all. This is the predicate the
 * DB CHECK constraint enforces independently of the trigger — application
 * discipline and storage-level enforcement, not one or the other.
 */
export function hasStripeEvidence(row: SettlementEvidence): boolean {
  return (
    present(row.stripePayoutId) ||
    present(row.stripeTransferId) ||
    present(row.stripeChargeId) ||
    present(row.stripePaymentIntentId) ||
    present(row.stripeRefundId)
  );
}

// ─── User-facing vocabulary ─────────────────────────────────────────────────

export type SettlementTone = 'neutral' | 'pending' | 'success';

export interface SettlementDescription {
  /** Short status word. Only ever "Paid" when Stripe confirmed it. */
  label: string;
  /** One sentence a user can act on. */
  detail: string;
  tone: SettlementTone;
}

/**
 * The single source of user-facing settlement language.
 *
 * Every string a user reads about whether money moved comes from here. The
 * word "Paid" appears in exactly one branch of this function, guarded by
 * `state === 'stripe_settled'`; that is what makes the invariant checkable
 * rather than a matter of reviewer diligence.
 */
export function describeSettlement(
  type: WalletTxType | string,
  state: SettlementState
): SettlementDescription {
  switch (type) {
    case 'release':
      return state === 'stripe_settled'
        ? {
            label: 'Paid',
            detail: 'Sent to the hunter’s bank account via Stripe.',
            tone: 'success',
          }
        : {
            label: 'Added to balance',
            detail:
              'Available in the hunter’s Bounty balance. They’ll need to set up payouts to move it to a bank account.',
            tone: 'neutral',
          };

    case 'withdrawal':
      switch (state) {
        case 'stripe_settled':
          return { label: 'Paid', detail: 'Arrived in your bank account.', tone: 'success' };
        case 'stripe_pending':
          return {
            label: 'On its way',
            detail: 'Sent to your bank. This typically takes 1-2 business days.',
            tone: 'pending',
          };
        case 'stripe_failed':
          return {
            label: 'Failed',
            detail:
              'This payout did not reach your bank. The funds were returned to your Bounty balance.',
            tone: 'neutral',
          };
        default:
          // The 25 historical rows land here. "Unconfirmed" is the honest word:
          // the ledger says this withdrawal completed and Stripe has no record.
          return {
            label: 'Unconfirmed',
            detail:
              'We could not confirm this payout reached your bank. Please contact support.',
            tone: 'neutral',
          };
      }

    case 'deposit':
      return state === 'stripe_settled'
        ? { label: 'Added', detail: 'Funds added to your Bounty balance.', tone: 'success' }
        : { label: 'Pending', detail: 'This deposit has not been confirmed yet.', tone: 'pending' };

    case 'escrow':
      return {
        label: 'Held',
        detail: 'Reserved from your balance until the bounty is completed.',
        tone: 'neutral',
      };

    case 'refund':
      return state === 'stripe_settled'
        ? { label: 'Refunded', detail: 'Returned to your original payment method.', tone: 'success' }
        : { label: 'Returned to balance', detail: 'Returned to your Bounty balance.', tone: 'neutral' };

    default:
      return { label: 'Recorded', detail: 'This adjustment was applied to your balance.', tone: 'neutral' };
  }
}

/**
 * Guard for any code path about to claim settlement. Returns false unless
 * Stripe confirmed it.
 *
 * Callers use this rather than reimplementing the check, so there is one place
 * to audit and one place a future edit can go wrong.
 */
export function mayDescribeAsPaid(state: SettlementState): boolean {
  return state === 'stripe_settled';
}
