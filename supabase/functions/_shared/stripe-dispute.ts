/**
 * How a Stripe chargeback (charge.dispute.*) is attributed to a Bounty user.
 *
 * Extracted from supabase/functions/webhooks/index.ts so the rules are unit
 * testable without the webhook, Stripe or a database. The webhook supplies the
 * three lookups; everything that decides money lives here.
 *
 * Two production defects this fixes (found 2026-11-04):
 *
 *  1. The payer was looked up ONLY in `wallet_transactions` by PaymentIntent.
 *     That row exists for v1 wallet deposits (apply_deposit) and nothing else.
 *     Every v2 escrow charge (`bounty_payments`, including Checkout-funded
 *     bounties) and every v3 charge (`bounty_v3_funding`) has no such row —
 *     11 of 11 v2 PaymentIntents in production. A chargeback on any of them was
 *     logged "logging only" and dropped: no dispute record, no freeze, no admin
 *     review item, and the escrow could still be released to the hunter.
 *
 *  2. The dispute row was written with `stripe_payment_intent_id`. Production's
 *     `bounty_disputes` has no such column — its equivalent of migration
 *     20260414_add_stripe_dispute_columns was applied out of band as
 *     `payment_intent_id` (the migration never reached the ledger). Staging has
 *     both. Every DB function that reads the PI off a dispute
 *     (fn_release_wallet_escrow_for_dispute, trg_bounty_events_from_disputes)
 *     reads `payment_intent_id` in BOTH environments. So in production the
 *     insert and its update fallback both failed (unknown column), the webhook
 *     returned 500 and Stripe retried for days without ever recording the
 *     dispute or freezing the wallet — even for v1 deposits. In staging the PI
 *     landed in a column nothing reads. `payment_intent_id` is correct in both.
 *
 * What is deliberately NOT automated: when a chargeback on a v2/v3 escrow
 * charge is LOST, the money never passed through the payer's wallet, so taking
 * it from their wallet balance would be a new financial policy, not a bug fix.
 * Those losses are recorded and left frozen for an admin decision. v1 deposit
 * losses keep their existing automatic wallet deduction.
 */

/** Which record identified the payer. */
export type DisputePayerSource = 'wallet_transaction' | 'bounty_payment' | 'bounty_v3_funding';

export interface DisputePayer {
  userId: string;
  bountyId: string | null;
  source: DisputePayerSource;
}

/** The identifiers a Stripe Dispute carries about the disputed charge. */
export interface DisputeChargeRef {
  paymentIntentId: string | null;
  chargeId: string | null;
}

/** A row found by one lookup. `userId` null = row exists but has no owner. */
export interface PayerRow {
  userId: string | null;
  bountyId: string | null;
}

/**
 * Database lookups, supplied by the caller. Each returns null when nothing
 * matches and THROWS on a query error (so the webhook returns 500 and Stripe
 * retries, rather than silently treating an outage as "no payer").
 */
export interface DisputePayerLookups {
  walletDepositByCharge(ref: DisputeChargeRef): Promise<PayerRow | null>;
  bountyPaymentByCharge(ref: DisputeChargeRef): Promise<PayerRow | null>;
  v3FundingByCharge(ref: DisputeChargeRef): Promise<PayerRow | null>;
}

/** Normalises Stripe's `payment_intent` / `charge` (id string or expanded object). */
export function disputeChargeRef(dispute: {
  payment_intent?: string | { id?: string | null } | null;
  charge?: string | { id?: string | null } | null;
}): DisputeChargeRef {
  const idOf = (v: string | { id?: string | null } | null | undefined): string | null => {
    if (typeof v === 'string') return v || null;
    return v?.id ?? null;
  };
  return { paymentIntentId: idOf(dispute.payment_intent), chargeId: idOf(dispute.charge) };
}

/**
 * Finds who paid for the disputed charge. Tries v1 → v2 → v3 in that order;
 * the first row with an owner wins. Returns null when no Bounty record owns
 * the charge (e.g. a CLI-triggered test charge) — the caller logs and moves on.
 */
export async function resolveDisputePayer(
  ref: DisputeChargeRef,
  lookups: DisputePayerLookups
): Promise<DisputePayer | null> {
  if (!ref.paymentIntentId && !ref.chargeId) return null;

  const ordered: Array<[DisputePayerSource, (r: DisputeChargeRef) => Promise<PayerRow | null>]> = [
    ['wallet_transaction', r => lookups.walletDepositByCharge(r)],
    ['bounty_payment', r => lookups.bountyPaymentByCharge(r)],
    ['bounty_v3_funding', r => lookups.v3FundingByCharge(r)],
  ];

  for (const [source, lookup] of ordered) {
    const row = await lookup(ref);
    if (row?.userId) {
      return { userId: row.userId, bountyId: row.bountyId ?? null, source };
    }
  }
  return null;
}

/**
 * The bounty_disputes row for a newly opened Stripe dispute.
 *
 * Writes the PI to `payment_intent_id` — the column production has and every
 * DB function reads. Never `stripe_payment_intent_id` (absent in production).
 */
export function buildStripeDisputeRow(
  disputeId: string,
  ref: DisputeChargeRef,
  payer: DisputePayer
): Record<string, unknown> {
  return {
    initiator_id: payer.userId,
    bounty_id: payer.bountyId,
    reason: `Stripe chargeback dispute opened (${disputeId})`,
    status: 'stripe_dispute',
    stripe_dispute_id: disputeId,
    payment_intent_id: ref.paymentIntentId,
    // 'cancellation' is the closest available dispute_stage value for a Stripe
    // chargeback, which arrives outside the normal in-app dispute flow.
    dispute_stage: 'cancellation',
  };
}

export type DisputeLossAction =
  /** v1: the disputed money was a wallet deposit — take it back from the wallet. */
  | { kind: 'deduct_from_wallet' }
  /** v2/v3, or payer unknown: record, stay frozen, needs an admin decision. */
  | { kind: 'manual_review'; reason: string };

/**
 * What to do with the user's balance when a dispute is LOST.
 *
 * Only a chargeback on a wallet deposit is deducted automatically. Before this
 * module existed only wallet-deposit disputes could ever be recorded, so this
 * preserves the existing behaviour for every row that could exist before.
 */
export function decideDisputeLossAction(payer: DisputePayer | null): DisputeLossAction {
  if (payer?.source === 'wallet_transaction') return { kind: 'deduct_from_wallet' };
  if (!payer) {
    return {
      kind: 'manual_review',
      reason: 'disputed charge is not linked to any Bounty payment record',
    };
  }
  return {
    kind: 'manual_review',
    reason: `disputed charge funded a bounty directly (${payer.source}); it never entered the payer's wallet, so the wallet is not debited automatically`,
  };
}
