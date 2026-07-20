// Instant Cash Out (debit-card payout) validation + destination resolution
// for the POST /connect/instant-payout edge function route.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports (same
// pattern as ./withdrawal-validation.ts, which is inlined into the same
// file — see that module's header comment). Amount validation itself
// (finite/positive, whole-cent, min/max, USD-only) is NOT duplicated here:
// the instant-payout route reuses the existing validateWithdrawalRequest()
// from withdrawal-validation.ts, since the rules are identical and both
// modules end up inlined into the same index.ts — a second copy would be
// dead weight at best and a drift risk at worst.
//
// KEEP IN SYNC with the inlined copy in supabase/functions/connect/index.ts.

// `Deno` only exists in the Edge Function runtime — this module is also
// imported directly by Jest (Node) unit tests, where the global is absent.
// Named distinctly from withdrawal-validation.ts's readEnvNumber() (rather
// than reusing that name) because both modules' inlined copies coexist in
// the same index.ts module scope, where two `function readEnvNumber`
// declarations would collide.
function readEnvNumberForInstantPayout(key: string, fallback: number): number {
  const raw = typeof Deno !== 'undefined' ? Deno.env.get(key) : undefined;
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Estimated instant-payout fee rate, as a percent — env-configurable via INSTANT_PAYOUT_FEE_PERCENT; defaults to 1 (%). */
export const INSTANT_PAYOUT_FEE_PERCENT = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_PERCENT', 1);

/** Estimated minimum instant-payout fee in USD — env-configurable via INSTANT_PAYOUT_FEE_MIN_USD; defaults to 0.50. */
export const INSTANT_PAYOUT_FEE_MIN_USD = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_MIN_USD', 0.5);

/**
 * Estimates the instant-payout fee (in whole cents) for display BEFORE the
 * hunter confirms — e.g. "You'll receive $98.50 (after a $1.50 instant fee)".
 *
 * This is a display estimate only. The authoritative fee is whatever Stripe
 * actually charges on the created Payout object / its balance transaction,
 * which is what gets persisted to wallet_transactions.instant_fee_amount
 * (see the payout.paid/payout.updated webhook handling in webhooks/index.ts).
 * If Stripe's actual fee ever diverges meaningfully from this estimate, that
 * drift is logged (CRITICAL) for review rather than silently trusted.
 */
export function estimateInstantFeeCents(amountCents: number): number {
  const percentFee = Math.round((amountCents * INSTANT_PAYOUT_FEE_PERCENT) / 100);
  const minFeeCents = Math.round(INSTANT_PAYOUT_FEE_MIN_USD * 100);
  return Math.max(percentFee, minFeeCents);
}

// ─── Instant Cash Out destination (debit card) resolution ───────────────────
//
// Unlike bank accounts (see resolveWithdrawalDestination in
// withdrawal-validation.ts), a debit card added for Instant Cash Out must
// NEVER be promoted to default_for_currency: Stripe's automatic payout
// sweep — which still drives every *standard* withdrawal — always pays out
// to whichever external account is currently default. Promoting a card
// would silently redirect every future standard withdrawal to the card
// instead of the hunter's bank. This resolver therefore never returns a
// "needs default update" instruction; index.ts must not call
// stripe.accounts.updateExternalAccount(..., { default_for_currency: true })
// anywhere in the instant-payout code path.

export interface InstantCardSummary {
  id: string;
  brand?: string | null;
  last4?: string | null;
  /** Stripe's own per-external-account eligibility list, e.g. ['standard'] or ['standard', 'instant']. */
  available_payout_methods?: string[] | null;
}

export type InstantDestinationResolution =
  | { ok: true; targetCard: InstantCardSummary }
  | { ok: false; error: string; code: string };

/**
 * Decides which linked debit card an Instant Cash Out should target.
 * - No cards linked at all -> 'no_debit_card' (guide the user to add one).
 * - Cards exist but none currently support instant payouts (Stripe
 *   determines this per-card, based on the issuing bank/network, and it can
 *   change over time) -> 'no_instant_eligible_card'.
 * - A specific card was requested but doesn't exist on the account ->
 *   'debit_card_not_found'.
 * - A specific card was requested and exists, but isn't instant-eligible ->
 *   'card_not_instant_eligible' (distinct from not-found so the UI can
 *   explain *why*, per the "no confusing generic failures" requirement).
 * - No specific card requested -> the first instant-eligible card.
 */
export function resolveInstantDestination(
  cards: InstantCardSummary[],
  requestedCardId: string | undefined
): InstantDestinationResolution {
  if (cards.length === 0) {
    return {
      ok: false,
      error: 'No debit card is linked for Instant Cash Out. Add a debit card to use this feature.',
      code: 'no_debit_card',
    };
  }

  const instantEligible = cards.filter(
    c => Array.isArray(c.available_payout_methods) && c.available_payout_methods.includes('instant')
  );

  if (requestedCardId) {
    const requested = cards.find(c => c.id === requestedCardId);
    if (!requested) {
      return {
        ok: false,
        error: 'Your selected debit card could not be found. Please refresh and try again.',
        code: 'debit_card_not_found',
      };
    }
    const isEligible = Array.isArray(requested.available_payout_methods)
      && requested.available_payout_methods.includes('instant');
    if (!isEligible) {
      return {
        ok: false,
        error:
          'This debit card does not currently support Instant Cash Out. Choose a different card, or use a standard bank withdrawal instead.',
        code: 'card_not_instant_eligible',
      };
    }
    return { ok: true, targetCard: requested };
  }

  if (instantEligible.length === 0) {
    return {
      ok: false,
      error:
        "None of your linked debit cards currently support Instant Cash Out. This is determined by your card's bank and may change — you can still withdraw normally to your bank account.",
      code: 'no_instant_eligible_card',
    };
  }

  return { ok: true, targetCard: instantEligible[0] };
}
