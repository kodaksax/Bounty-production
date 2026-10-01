/**
 * Posting service fee — the flat charge collected when a bounty is published.
 *
 * DISTINCT FROM `PLATFORM_FEE_PERCENT` in lib/constants/fees.ts. The two are
 * unrelated and must never be conflated:
 *
 *   PLATFORM_FEE_PERCENT (5%)  — deducted from the HUNTER's payout on release.
 *   POSTING_FEE_CENTS   ($1)   — charged to the POSTER at publish time.
 *
 * They hit different people at different moments, and a receipt that mixes
 * them up is a trust bug (see the header of fees.ts for what happened the last
 * time a fee constant drifted from the server's).
 *
 * The server is the authority on what is actually charged: the amount is
 * re-derived inside the `/payments/posting-checkout/intent` route from its own
 * constant, and the PaymentIntent it creates is what the poster pays. This
 * constant exists so the checkout screen can itemise the total BEFORE the
 * round-trip, and so a mismatch between the two is a loud test failure rather
 * than a silent overcharge — see the reconciliation check in
 * lib/services/posting-checkout-service.ts.
 */

/** Flat posting service fee, in cents. Mirrors POSTING_FEE_CENTS in the edge fn. */
export const POSTING_FEE_CENTS = 100;

/** Same fee in dollars, for arithmetic against draft amounts. */
export const POSTING_FEE_DOLLARS = POSTING_FEE_CENTS / 100;

/** "$1.00" — for display. */
export const POSTING_FEE_DISPLAY = `$${POSTING_FEE_DOLLARS.toFixed(2)}`;

export interface PostingCheckoutTotals {
  /** The bounty reward the poster named, in cents. */
  rewardCents: number;
  /** The flat posting service fee, in cents. */
  feeCents: number;
  /** What the card is actually charged, in cents. */
  totalCents: number;
}

/**
 * Itemise a posting checkout the way the confirmation screen displays it.
 *
 * Works in integer cents throughout. The draft carries `amount` as a float in
 * dollars, and summing dollars before converting is how you end up charging
 * $51.000000000000004 — Stripe rejects a non-integer minor unit outright, so
 * this would be a hard publish failure rather than a rounding blemish.
 */
export function calculatePostingCheckout(rewardDollars: number | null | undefined): PostingCheckoutTotals {
  const reward =
    Number.isFinite(rewardDollars) && (rewardDollars as number) > 0 ? Number(rewardDollars) : 0;
  const rewardCents = Math.round(reward * 100);
  return {
    rewardCents,
    feeCents: POSTING_FEE_CENTS,
    totalCents: rewardCents + POSTING_FEE_CENTS,
  };
}
