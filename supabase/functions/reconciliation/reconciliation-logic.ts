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
export function isSafeStatusRepair(
  stripeStatus: string,
  ledgerStatus: string,
  metadata?: Record<string, unknown> | null
): boolean {
  if (ledgerStatus !== 'pending') return false;
  if (stripeStatus === 'paid') return true;
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    return metadata?.connect_native === true;
  }
  return false;
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

// ---------------------------------------------------------------------------
// Finding identity (2026-09-01)
// ---------------------------------------------------------------------------
// Findings were written with a plain INSERT on every run. Production runs this
// job every 15 minutes (cron job `stripe-payout-reconciliation-15min`), so a
// single unresolved issue wrote 96 rows a day. The "288 critical mismatches"
// reported for 2026-08-31 was 96 runs x 3 underlying issues — two orphaned
// payouts and one invariant rollup — not 288 problems. A backlog counter that
// grows with the cron frequency measures the cron, not the system.
//
// A finding therefore needs a stable identity: the same underlying problem must
// produce the same key on every run, so re-observing it updates one row rather
// than appending another.

/**
 * Stable identity for a finding.
 *
 * The subject must be the durable identifier of the *underlying problem* —
 * a payout id, a transaction id, an account id — never anything that varies
 * per run (timestamps, ages, counts). Two observations of one problem must
 * collide; two different problems must not.
 *
 * Returns null when there is no durable subject, which tells the caller to
 * fall back to a plain insert rather than collapse unrelated findings together.
 */
export function buildFindingKey(findingType: string, subject: string | null): string | null {
  if (!subject) return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;
  return `${findingType}:${trimmed}`;
}

/**
 * The durable subject for each finding type.
 *
 * Kept as one function so that adding a finding type without giving it an
 * identity is a visible omission rather than a silent duplicate-forever.
 */
export function findingSubject(
  findingType: string,
  details: Record<string, unknown>
): string | null {
  const pick = (k: string): string | null => {
    const v = details[k];
    return typeof v === 'string' && v ? v : null;
  };
  switch (findingType) {
    case 'orphan_stripe_payout':
    case 'orphan_ledger_withdrawal':
      return pick('payoutId');
    case 'payout_id_never_recorded':
      // Keyed on the payout: one Stripe payout is one unrecorded settlement.
      return pick('payoutId');
    case 'completed_withdrawal_without_payout':
    case 'stale_pending_withdrawal':
    case 'withdrawal_missing_transfer_id':
      return pick('transactionId');
    case 'stripe_account_unreadable':
      return pick('accountId');
    case 'amount_mismatch':
    case 'status_mismatch':
      return pick('payoutId') ?? pick('transactionId');
    // Rollups describe a set, not a row. One open rollup per type is correct.
    case 'completed_withdrawal_without_payout_total':
    case 'completed_withdrawal_without_payout_grandfathered':
    case 'invariant_sweep_failed':
      return findingType;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Two-hop settlement correlation (2026-09-01)
// ---------------------------------------------------------------------------
// A standard Bounty withdrawal is two Stripe hops:
//   hop 1  platform  -> connected account   (Transfer, created by /connect)
//   hop 2  connected account -> hunter bank (Payout, created by Stripe's
//                                            automatic payout schedule)
//
// The ledger row is written at hop 1, so `stripe_payout_id` is NULL at birth —
// contrary to findCandidateWithdrawalTx's premise in webhooks/index.ts that
// "every withdrawal row created by /connect carries its payout id from birth",
// which holds only for the instant-payout path where /connect creates the
// Payout itself. The id is supposed to be backfilled by the `payout.created`
// webhook. When those webhook deliveries stop, one event produces two findings
// that look independent: the payout has no ledger row (orphan_stripe_payout)
// and the ledger row has no payout (stale_pending_withdrawal).
//
// Correlating them is a REPORTING improvement only. It never repairs, never
// writes a payout id, and never moves a ledger row — amount-based matching was
// removed from the repair path on 2026-08-16 for good reason (it attached a
// dashboard payout to a withdrawal eleven days older). The rule here is
// deliberately stricter than that removed heuristic and its output is a
// finding for a human, not a mutation.

export interface PendingWithdrawalCandidate {
  id: string;
  userId: string;
  amountCents: number;
  createdAtMs: number;
  hasPayoutId: boolean;
  hasTransferId: boolean;
}

export type PayoutCorrelation =
  | { kind: 'none' }
  | { kind: 'unique'; transactionId: string }
  | { kind: 'ambiguous'; transactionIds: string[] };

/**
 * Explains an apparently-orphaned Stripe payout as an unrecorded hop-2
 * settlement of a known pending withdrawal.
 *
 * Requires ALL of:
 *   - same user (the payout's connected account already resolved to them),
 *   - exact amount in cents,
 *   - the withdrawal has a transfer id but no payout id (the two-hop shape),
 *   - the withdrawal predates the payout (money cannot settle before request),
 *   - and the match is UNIQUE.
 *
 * Anything ambiguous returns 'ambiguous' and the caller must keep reporting a
 * plain orphan. Guessing between two candidates is exactly the failure mode
 * that made amount-matching unsafe.
 */
export function correlatePayoutToPendingWithdrawal(
  payout: { userId: string; amountCents: number; createdAtMs: number },
  candidates: PendingWithdrawalCandidate[]
): PayoutCorrelation {
  const matches = candidates.filter(
    c =>
      c.userId === payout.userId &&
      c.amountCents === payout.amountCents &&
      !c.hasPayoutId &&
      c.hasTransferId &&
      c.createdAtMs <= payout.createdAtMs
  );
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'unique', transactionId: matches[0].id };
  return { kind: 'ambiguous', transactionIds: matches.map(m => m.id) };
}

// ---------------------------------------------------------------------------
// Invariant-violation classification (2026-09-01)
// ---------------------------------------------------------------------------

/**
 * The date the completed-withdrawal-requires-payout CHECK constraint began
 * enforcing. Rows older than this are the known instant-payout fallback
 * incident set, explicitly grandfathered by the constraint.
 */
export const INVARIANT_GRANDFATHER_CUTOFF_ISO = '2026-08-15T00:00:00.000Z';

export interface InvariantViolationRow {
  id: string;
  createdAtMs: number;
  amountCents: number;
}

export interface InvariantSplit {
  grandfathered: InvariantViolationRow[];
  current: InvariantViolationRow[];
}

/**
 * Splits invariant violations into the known historical set and genuinely new
 * ones.
 *
 * Both halves stay visible — the historical set is a real unpaid-evidence
 * backlog and must not be hidden. But emitting it as CRITICAL on every run
 * pages an operator about a decision that was already made and recorded, which
 * is how a critical channel stops being read. Only a violation NEWER than the
 * cutoff means the invariant is actively being bypassed, and only that is
 * CRITICAL.
 */
export function splitInvariantViolations(
  rows: InvariantViolationRow[],
  cutoffIso: string = INVARIANT_GRANDFATHER_CUTOFF_ISO
): InvariantSplit {
  const cutoffMs = Date.parse(cutoffIso);
  const grandfathered: InvariantViolationRow[] = [];
  const current: InvariantViolationRow[] = [];
  for (const row of rows) {
    if (row.createdAtMs < cutoffMs) grandfathered.push(row);
    else current.push(row);
  }
  return { grandfathered, current };
}
