/**
 * Pure reconciliation decision logic (Phase 8).
 *
 * These functions decide what is safe to repair and how healthy the system is.
 * They are kept free of Stripe/Supabase clients so they can be unit tested
 * directly — the rules encoded here are the ones that determine whether the
 * system will quietly corrupt a financial record, so they need real tests
 * rather than source-level assertions.
 *
 * The Supabase bundler does not support local imports from an edge function,
 * so index.ts carries an inlined copy; a contract test asserts the two stay
 * in sync. Same pattern as connect/instant-payout-validation.ts.
 */

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Health = 'GREEN' | 'YELLOW' | 'RED';

/** A payout still not paid after this long is a WARNING. */
export const PAYOUT_PENDING_WARN_HOURS = 24;
/** Transfers are near-instant, so an unsettled one is suspicious much sooner. */
export const TRANSFER_PENDING_WARN_HOURS = 2;
/** A ledger withdrawal stuck 'pending' with no Stripe payout id at all. */
export const STALE_PENDING_WARN_HOURS = 2;
/** Beyond this a stuck payout is not slow, it is broken. */
export const PAYOUT_PENDING_CRITICAL_HOURS = 72;

/**
 * Projects a Stripe payout status onto the ledger's vocabulary.
 *
 * Stripe: pending | in_transit | paid | failed | canceled
 * Ledger: pending | completed | failed | cancelled
 *
 * in_transit maps to 'pending' deliberately — the money is still in flight.
 * Treating in-flight funds as settled is the exact legacy bug this migration
 * exists to remove; letting reconciliation do it would certify the bug.
 */
export function normalizeStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'paid':
      return 'completed';
    case 'pending':
    case 'in_transit':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'cancelled';
    default:
      // Unknown statuses pass through rather than being coerced into a known
      // one — a new Stripe status should surface as a mismatch, not be
      // silently mapped onto something plausible.
      return stripeStatus;
  }
}

/**
 * Whether a ledger row may be moved to match Stripe automatically.
 *
 * Safe means all three of:
 *   - the ledger row is still 'pending' (it has not claimed an outcome), and
 *   - Stripe has reached a TERMINAL state, and
 *   - therefore applying Stripe's state adds information without inventing any.
 *
 * Everything else is refused:
 *   - ledger already terminal and disagreeing → a real conflict; overwriting
 *     it destroys the evidence of whichever side is wrong.
 *   - Stripe still in flight → nothing to copy yet.
 *   - amount disagreements → never a status question; handled as CRITICAL.
 */
export function isSafeStatusRepair(stripeStatus: string, ledgerStatus: string): boolean {
  if (ledgerStatus !== 'pending') return false;
  return stripeStatus === 'paid' || stripeStatus === 'failed' || stripeStatus === 'canceled';
}

export interface HealthCounts {
  mismatched: number;
  orphanStripe: number;
  orphanLedger: number;
  stalePending: number;
  deltaCents: number;
  criticalFindings: number;
}

/**
 * Rolls health up from the worst thing observed.
 *
 * RED is reserved for states where money may be wrong: an orphan on either
 * side, an amount delta, or any CRITICAL finding. YELLOW covers "something
 * needs a human eventually" — slow payouts, status lag. GREEN requires that
 * nothing at all was found.
 */
export function computeHealth(counts: HealthCounts): Health {
  if (
    counts.criticalFindings > 0 ||
    counts.orphanStripe > 0 ||
    counts.orphanLedger > 0 ||
    counts.deltaCents !== 0
  ) {
    return 'RED';
  }
  if (counts.mismatched > 0 || counts.stalePending > 0) return 'YELLOW';
  return 'GREEN';
}

/** Severity for a payout that both sides agree is still pending. */
export function payoutAgeSeverity(ageHours: number): Severity | null {
  if (ageHours > PAYOUT_PENDING_CRITICAL_HOURS) return 'CRITICAL';
  if (ageHours > PAYOUT_PENDING_WARN_HOURS) return 'WARNING';
  return null;
}

/** Severity for a ledger withdrawal pending with no Stripe payout id. */
export function stalePendingSeverity(ageHours: number): Severity | null {
  if (ageHours > PAYOUT_PENDING_CRITICAL_HOURS) return 'CRITICAL';
  if (ageHours > STALE_PENDING_WARN_HOURS) return 'WARNING';
  return null;
}

/** Severity for an unsettled transfer, which should have been near-instant. */
export function transferAgeSeverity(ageHours: number): Severity | null {
  if (ageHours > TRANSFER_PENDING_WARN_HOURS) return 'WARNING';
  return null;
}
