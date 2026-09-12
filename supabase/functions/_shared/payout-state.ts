import { createHash } from 'node:crypto';

/**
 * The withdrawal/payout state machine — the single source of truth shared by
 * the `connect`, `webhooks` and `reconciliation` Edge Functions.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * On 2026-08-13 thirteen withdrawals totalling $275 were written to the ledger
 * as `completed` on the strength of a Stripe *Transfer* alone. A Transfer moves
 * money from the platform balance into a connected account; it does not put a
 * single cent in a hunter's bank. The withdrawals that carried that status had
 * no Stripe Payout behind them at all, and because every downstream control
 * (payout.paid, payout.failed, the reconciliation sweep) keys off
 * `stripe_payout_id`, a null there removed those rows from the reach of every
 * safety net that existed.
 *
 * The rule this module encodes, and which the DB constraint
 * `wallet_transactions_completed_withdrawal_requires_payout` enforces:
 *
 *     A withdrawal may only be `completed` when a Stripe Payout for it has
 *     been observed in a settled state. Nothing else — not a successful
 *     Transfer, not a submitted payout, not an instant-payout attempt —
 *     is evidence of payment.
 *
 * This file is deliberately dependency-free and side-effect-free so it can be
 * imported by Deno (Edge Functions) and by Jest (unit tests) alike, and so the
 * transition rules can be tested directly rather than inferred from source.
 */

/** Ledger vocabulary — mirrors the `wallet_tx_status_enum` Postgres type. */
export type LedgerStatus = 'pending' | 'completed' | 'failed' | 'manually_paid';

/** Stripe's own Payout lifecycle statuses. */
export type StripePayoutStatus = 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';

/**
 * Instant-payout failures that mean "this account cannot be paid *instantly*
 * right now" rather than "this withdrawal cannot happen". Each of these must
 * fall back to a standard payout; none of them may complete the withdrawal.
 *
 * `cannot_create_connect_instant_payouts_through_api` is the platform-level
 * one: Stripe does not permit creating Instant Payouts for Express accounts
 * through the API unless the platform is specifically approved. It fails 100%
 * of the time until Stripe enables it, and it accounted for 4 of the 13
 * transactions in the 2026-08-13 incident.
 *
 * `instant_payouts_limit_exceeded` is the per-account volume ceiling and
 * accounted for the other 9.
 */
export const RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES: readonly string[] = [
  'cannot_create_connect_instant_payouts_through_api',
  'instant_payouts_limit_exceeded',
  'instant_payouts_unsupported',
  'payout_method_not_available',
  'balance_insufficient_for_instant',
];

/**
 * Instant failures that indicate the *withdrawal itself* cannot proceed, not
 * merely that instant delivery is unavailable. These must not fall back to a
 * standard payout to the same destination — the destination or the account is
 * the problem, and a standard payout would fail the same way or, worse, send
 * money somewhere it should not go.
 */
export const NON_RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES: readonly string[] = [
  'account_closed',
  'account_frozen',
  'payouts_not_allowed',
];

/**
 * True when an instant-payout failure should fall back to a standard payout.
 *
 * Unrecognised codes are treated as recoverable on purpose: the safe default
 * for an unknown instant failure is to attempt the standard payout, which
 * either succeeds or fails loudly and leaves the row `pending` for
 * reconciliation to surface. Abandoning a withdrawal whose funds have already
 * been transferred into the connected account would strand them.
 *
 * Note what this function does *not* decide: whether the withdrawal completes.
 * Neither branch may ever produce `completed` — that requires a settled payout,
 * and this is only choosing how to try to obtain one.
 */
export function isRecoverableInstantPayoutError(code: string | null | undefined): boolean {
  if (!code) return true;
  if (RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES.includes(code)) return true;
  return !NON_RECOVERABLE_INSTANT_PAYOUT_ERROR_CODES.includes(code);
}

/**
 * Projects a Stripe Payout status onto ledger vocabulary.
 *
 * Returns `null` for the non-terminal statuses (`pending`, `in_transit`) —
 * "money is on its way" is not a ledger transition, and callers must leave the
 * row alone rather than guessing. Only `paid` yields `completed`; this is the
 * single place in the codebase permitted to make that mapping.
 */
export function mapStripePayoutStatusToLedger(
  status: StripePayoutStatus | string
): LedgerStatus | null {
  switch (status) {
    case 'paid':
      return 'completed';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'pending':
    case 'in_transit':
      return null;
    default:
      return null;
  }
}

/** Statuses from which no further transition is legal. */
export const TERMINAL_LEDGER_STATUSES: readonly LedgerStatus[] = [
  'completed',
  'failed',
  'manually_paid',
];

export function isTerminalLedgerStatus(status: LedgerStatus | string): boolean {
  return TERMINAL_LEDGER_STATUSES.includes(status as LedgerStatus);
}

/**
 * The complete set of legal withdrawal transitions.
 *
 * `pending` is the only non-terminal state, and it is where a withdrawal lives
 * for the 1-2 business days a standard payout takes to settle. Every exit from
 * it requires authoritative Stripe evidence:
 *
 *     pending -> completed      payout.paid, or reconciliation observing `paid`
 *     pending -> failed         payout.failed / payout.canceled
 *     pending -> manually_paid  admin escape hatch (mark_externally_settled)
 *
 * Terminal states are absorbing. A replayed webhook, an out-of-order delivery
 * or a duplicate reconciliation pass therefore cannot move an already-resolved
 * row, which is what makes those operations safe to repeat.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<LedgerStatus, readonly LedgerStatus[]>> = {
  pending: ['completed', 'failed', 'manually_paid'],
  completed: [],
  failed: [],
  manually_paid: [],
};

export function canTransition(from: LedgerStatus | string, to: LedgerStatus | string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from as LedgerStatus];
  if (!allowed) return false;
  return allowed.includes(to as LedgerStatus);
}

/**
 * The one audited exception to `failed` being absorbing: an admin re-opening a
 * failed withdrawal for another attempt via `admin-withdrawals` `force_retry`.
 *
 * This is deliberately NOT expressed as a `failed -> pending` entry in
 * ALLOWED_TRANSITIONS. That table governs what *webhooks* may do, and its whole
 * value is that terminal states absorb replayed, duplicate and out-of-order
 * deliveries. Making `failed` non-terminal there would let a late
 * `payout.failed`/`payout.paid` pair start moving a resolved row again — a much
 * larger hole than the one being opened here.
 *
 * So the escape hatch is a separate, explicitly-named predicate that only the
 * admin path calls, and every call is written to admin_action_log.
 *
 * `force_retry` previously performed `failed -> completed` directly, consulting
 * no state machine at all and recording a Transfer as proof of payment. The
 * legal move is `failed -> pending`: a new payout has been created and nothing
 * is settled until `payout.paid` says so.
 */
export function mayAdminReopenFailedWithdrawal(args: {
  currentStatus: LedgerStatus | string;
  hasConnectAccount: boolean;
}): boolean {
  if (args.currentStatus !== 'failed') return false;
  return args.hasConnectAccount;
}

/**
 * Whether a withdrawal row may legally be written as `completed`.
 *
 * This is the invariant in function form, and the assertion the application
 * makes before every write that could produce a completed withdrawal. The DB
 * CHECK constraint enforces the same rule independently — application
 * discipline and storage-level enforcement, not one or the other.
 */
export function mayCompleteWithdrawal(args: {
  currentStatus: LedgerStatus | string;
  stripePayoutId: string | null | undefined;
  stripePayoutStatus: StripePayoutStatus | string | null | undefined;
}): boolean {
  if (!canTransition(args.currentStatus, 'completed')) return false;
  if (!args.stripePayoutId) return false;
  return mapStripePayoutStatusToLedger(args.stripePayoutStatus ?? '') === 'completed';
}

/** The ledger effect a payout webhook should have. */
export type PayoutLedgerAction =
  | { kind: 'complete'; transactionId: string }
  | { kind: 'fail'; transactionId: string; refundAmount: number; outcome: 'failed' | 'canceled' }
  | { kind: 'noop'; reason: PayoutNoopReason };

export type PayoutNoopReason =
  | 'no_matching_withdrawal'
  | 'already_terminal'
  | 'already_refunded'
  | 'non_terminal_payout_status';

/**
 * Decides what a `payout.paid` / `payout.failed` / `payout.canceled` delivery
 * should do to the ledger, given the row it matched.
 *
 * This is where duplicate deliveries, replays and out-of-order events are
 * resolved, and it is pure so those cases can actually be tested rather than
 * reasoned about. The rules:
 *
 *   - A row that is already terminal absorbs everything. This is what makes a
 *     duplicate delivery a no-op, and what stops a late `payout.failed` from
 *     un-completing (or double-refunding) a withdrawal that `payout.paid`
 *     already settled.
 *   - A refund is issued at most once, tracked by `metadata.payout_status`,
 *     so redelivery of a failure cannot credit the balance twice.
 *   - An unmatched payout does nothing. Payouts frequently have no
 *     corresponding withdrawal — automatic balance sweeps and hunter-initiated
 *     Express Dashboard payouts both look exactly like ours at the API level —
 *     and guessing at a row by amount is what let a foreign payout attach
 *     itself to an unrelated withdrawal before 2026-08-16.
 *
 * The caller still performs its database write as a compare-and-set on the
 * same status this function checked, so two concurrent deliveries that both
 * pass here still result in exactly one write.
 */
export function decidePayoutEventAction(args: {
  outcome: 'paid' | 'failed' | 'canceled';
  row: {
    id: string;
    status: LedgerStatus | string;
    amount: number;
    metadata?: Record<string, unknown> | null;
    /**
     * The `stripe_payout_status` column, REQUIRED (pass `null` explicitly if
     * the caller genuinely does not have it).
     *
     * This is deliberately not optional. A `completed` row's correctness now
     * turns on this field via `hasSettlementEvidence` — a `completed` row with
     * no settlement evidence is treated as unproven and CAN be refunded by a
     * late `payout.failed`/`payout.canceled`, while a genuinely-settled one
     * must not be. An optional field lets a caller that simply forgot to
     * SELECT the column pass `undefined` by accident, which reads as "no
     * evidence" and would refund a withdrawal that was already correctly
     * paid — crediting a balance that already received its money, the
     * opposite failure from the one this field exists to prevent. Requiring
     * it forces every call site to look up the column (or its `metadata`
     * fallback) and decide, rather than omit it silently.
     */
    stripePayoutStatus: string | null;
  } | null;
}): PayoutLedgerAction {
  const { outcome, row } = args;

  if (!row) return { kind: 'noop', reason: 'no_matching_withdrawal' };

  if (isTerminalLedgerStatus(row.status)) {
    // Terminal states absorb — with one exception, and it is a money-loss one.
    //
    // This module's rule is that a withdrawal may only be `completed` once a
    // settled Payout has been observed. Production violates it: five rows
    // reached `completed` carrying a payout id but no settled payout status,
    // because a reconciliation pass promoted them before payout.paid landed.
    //
    // For such a row, absorbing a later `payout.failed`/`payout.canceled`
    // means the money never reached the bank, the balance is never credited
    // back, and the hunter is permanently short the withdrawal amount with no
    // automated recovery — precisely the 2026-08-13 failure this module was
    // written to prevent, reached by a different route.
    //
    // So a `completed` row with NO settlement evidence is not treated as
    // absorbing for a failure outcome. Everything else still absorbs, and
    // double-refunding is still prevented by the `already_refunded` check
    // below plus the atomic refund RPC, which reports `refunded: false` when
    // a concurrent delivery got there first.
    const failureOutcome = outcome === 'failed' || outcome === 'canceled';
    const prematurelyCompleted = row.status === 'completed' && !hasSettlementEvidence(row);
    if (!(failureOutcome && prematurelyCompleted)) {
      return { kind: 'noop', reason: 'already_terminal' };
    }
  }

  if (outcome === 'paid') {
    if (!canTransition(row.status, 'completed')) {
      return { kind: 'noop', reason: 'already_terminal' };
    }
    return { kind: 'complete', transactionId: row.id };
  }

  const priorPayoutStatus = (row.metadata ?? {}).payout_status;
  if (priorPayoutStatus === 'failed' || priorPayoutStatus === 'canceled') {
    return { kind: 'noop', reason: 'already_refunded' };
  }

  // `completed` is not in ALLOWED_TRANSITIONS' exits, so the premature-
  // completion case above has to bypass this check too; it is the same
  // decision, expressed once.
  if (row.status !== 'completed' && !canTransition(row.status, 'failed')) {
    return { kind: 'noop', reason: 'already_terminal' };
  }

  return {
    kind: 'fail',
    transactionId: row.id,
    refundAmount: Math.abs(row.amount),
    outcome,
  };
}

/**
 * Whether a row carries positive evidence that its Payout actually settled.
 *
 * Reads the `stripe_payout_status` column first — the column the
 * `settlement_state` derive trigger keys off, and therefore the only one that
 * makes a completion provable — and falls back to the `payout_status` written
 * into `metadata` by the reconciliation path, which stamps metadata but not
 * the column.
 */
export function hasSettlementEvidence(row: {
  metadata?: Record<string, unknown> | null;
  stripePayoutStatus?: string | null;
}): boolean {
  if (mapStripePayoutStatusToLedger(row.stripePayoutStatus ?? '') === 'completed') return true;
  const fromMetadata = (row.metadata ?? {}).payout_status;
  return typeof fromMetadata === 'string'
    && mapStripePayoutStatusToLedger(fromMetadata) === 'completed';
}

/**
 * Deterministic Stripe idempotency keys.
 *
 * The pre-fix keys interpolated a client-supplied millisecond timestamp
 * (`instant_<userId>_<Date.now()>`), so every retry produced a *different* key
 * and Stripe's idempotency protection never engaged — the mechanism was
 * present in the code and absent in effect. These builders derive the key
 * purely from the logical identity of the request, so a retry of the same
 * withdrawal always replays rather than creating a second money movement.
 */
export function buildTransferIdempotencyKey(args: {
  userId: string;
  clientKey: string;
  amountCents: number;
  purpose: string;
}): string {
  return `wtr_${args.purpose}_${args.userId}_${hashClientKey(args.clientKey)}_${args.amountCents}`;
}

export function buildPayoutIdempotencyKey(args: {
  userId: string;
  clientKey: string;
  amountCents: number;
  method: 'standard' | 'instant';
}): string {
  return `wpo_${args.method}_${args.userId}_${hashClientKey(args.clientKey)}_${args.amountCents}`;
}

export function buildNativePayoutIdempotencyKey(args: {
  userId: string;
  clientKey: string;
  amountCents: number;
  method: 'standard' | 'instant';
}): string {
  return `wnp_${args.method}_${args.userId}_${hashClientKey(args.clientKey)}_${args.amountCents}`;
}

function hashClientKey(clientKey: string): string {
  return createHash('sha256').update(clientKey).digest('hex');
}
