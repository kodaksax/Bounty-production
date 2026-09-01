// Supabase Edge Function: connect
// Handles all /connect/* routes previously served by the Node/Express server.
//
// These Connect accounts have controller.requirement_collection === "stripe"
// (verified live against a real connected account), which means Stripe
// itself owns writes to external accounts on them: the platform CANNOT call
// stripe.accounts.createExternalAccount / updateExternalAccount /
// deleteExternalAccount — Stripe rejects all three unconditionally with a
// permissions error, regardless of payouts_enabled or any other account
// state. Adding, removing, or setting a default bank account/debit card can
// therefore only happen through Stripe's own hosted Express Dashboard,
// reached via POST /connect/login-link. Routes:
//   POST /connect/create-account-link
//   POST /connect/create-account-session   (Stripe Connect Embedded Components)
//   POST /connect/login-link               (Express Dashboard login link — add/remove/default payout methods)
//   GET  /connect/embedded                 (HTML shim that mounts embedded components in a WebView)
//   POST /connect/verify-onboarding
//   POST /connect/transfer
//   POST /connect/retry-transfer
//   POST /connect/instant-payout           (Instant Cash Out to a linked debit card — flag-gated)
//   GET  /connect/bank-accounts            (list external bank accounts on Connect account)
//   POST /connect/bank-accounts            (410 DEPRECATED — use Financial Connections for deposits + login-link for payout accounts)
//   DELETE /connect/bank-accounts/:id      (410 DEPRECATED — use login-link)
//   POST /connect/bank-accounts/:id/default (410 DEPRECATED — use login-link)
//   GET  /connect/debit-cards              (list debit-card external accounts, Instant Cash Out only)
//   POST /connect/debit-cards              (410 DEPRECATED — use login-link)
//   DELETE /connect/debit-cards/:id        (410 DEPRECATED — use login-link)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import type { Profile, WalletTransaction } from '../_shared/types.ts';
import {
  buildNativePayoutIdempotencyKey,
  buildPayoutIdempotencyKey,
  buildTransferIdempotencyKey,
  isRecoverableInstantPayoutError,
} from '../_shared/payout-state.ts';

// stripe@14's bundled types for Balance.InstantAvailable omit `net_available`,
// even though the live API returns it (see
// https://docs.stripe.com/api/balance/balance_object — "Breakdown of balance
// by destination", net of Stripe's instant-payout fee). readConnectBalance()
// below explains why the code must read this field instead of `.amount`.
type InstantAvailableWithNet = Stripe.Balance.InstantAvailable & {
  net_available?: Array<{ amount: number; destination: string }>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Structured logging for the CRITICAL/manual-reconciliation-required cases —
// keeps the "CRITICAL" substring for backward-compatible grep against
// existing saved log searches while emitting one machine-parseable JSON blob
// per line instead of a message string plus a separate context object.
// Duplicated identically in webhooks/index.ts and admin-withdrawals/index.ts
// (local imports are not supported by the deploy bundler — see the
// withdrawal-validation helpers below for the same constraint).
function logCritical(event: string, context: Record<string, unknown>) {
  console.error(
    `CRITICAL [connect] ${event}`,
    JSON.stringify({ event, ts: new Date().toISOString(), ...context })
  );
}

// ─── Inlined from ./withdrawal-validation.ts ────────────────────────────────
// (local imports are not supported by the Supabase bundler — keep both copies
// in sync; the sibling module is the unit-tested source of truth)

// Guard against a misconfigured (non-numeric) env value silently disabling
// the limit entirely: `amount < NaN` and `amount > NaN` are both always
// `false`, so an invalid override would remove the min/max check rather
// than falling back to a safe default.
function readEnvNumber(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Minimum withdrawal in USD — env-configurable via WITHDRAW_MIN_USD; defaults to 10. */
const MIN_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MIN_USD', 10);

/** Maximum single withdrawal in USD (fraud/typo guard) — env-configurable via WITHDRAW_MAX_USD; defaults to 10000. */
const MAX_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MAX_USD', 10000);

type WithdrawalValidationResult =
  | { ok: true; amount: number; amountCents: number }
  | { ok: false; error: string; code: string };

function validateWithdrawalRequest(body: {
  amount?: unknown;
  currency?: unknown;
}): WithdrawalValidationResult {
  const rawAmount = Number(body?.amount);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return {
      ok: false,
      error: 'Please enter a valid withdrawal amount.',
      code: 'invalid_amount',
    };
  }

  const amountCents = Math.round(rawAmount * 100);
  const amount = amountCents / 100;

  // Reject sub-cent precision (e.g. 10.001) instead of silently rounding.
  // The 1e-6 tolerance absorbs binary floating-point representation noise
  // (e.g. 10.10 * 100 === 1009.9999999999999) while still catching any real
  // sub-cent fraction, whose smallest distance from a whole cent is 0.1.
  if (Math.abs(rawAmount * 100 - amountCents) > 1e-6) {
    return {
      ok: false,
      error: 'Withdrawal amount cannot include fractions of a cent.',
      code: 'invalid_amount_precision',
    };
  }

  if (amount < MIN_WITHDRAWAL_USD) {
    return {
      ok: false,
      error: `The minimum withdrawal amount is $${MIN_WITHDRAWAL_USD.toFixed(2)}.`,
      code: 'below_minimum',
    };
  }

  if (amount > MAX_WITHDRAWAL_USD) {
    return {
      ok: false,
      error: `The maximum withdrawal amount is $${MAX_WITHDRAWAL_USD.toLocaleString('en-US')} per transfer. Please contact support for larger withdrawals.`,
      code: 'above_maximum',
    };
  }

  const currency = typeof body?.currency === 'string' ? body.currency.toLowerCase() : 'usd';
  if (currency !== 'usd') {
    return {
      ok: false,
      error: 'Only USD withdrawals are supported.',
      code: 'unsupported_currency',
    };
  }

  return { ok: true, amount, amountCents };
}

function mapStripeTransferError(err: { code?: string; type?: string; message?: string }): {
  error: string;
  code: string;
  status: number;
} {
  const code = err?.code ?? '';
  const type = err?.type ?? '';

  if (code === 'balance_insufficient') {
    return {
      error:
        'Withdrawals are temporarily unavailable. Your balance has not been charged — please try again later.',
      code: 'platform_balance_insufficient',
      status: 503,
    };
  }

  if (code === 'account_invalid' || code === 'transfers_not_allowed') {
    return {
      error:
        'Your linked bank account cannot receive transfers right now. Please review your payout details in your account settings.',
      code: 'destination_account_invalid',
      status: 400,
    };
  }

  if (type === 'StripeConnectionError' || type === 'api_connection_error') {
    return {
      error:
        'We could not reach our payment provider. Your balance has not been charged — please try again.',
      code: 'stripe_unreachable',
      status: 503,
    };
  }

  if (type === 'idempotency_error' || type === 'StripeIdempotencyError') {
    return {
      error:
        'This withdrawal request conflicts with a previous attempt. Please start a new withdrawal.',
      code: 'idempotency_conflict',
      status: 409,
    };
  }

  return {
    error:
      'The transfer could not be completed. Your balance has not been charged — please try again or contact support.',
    code: 'transfer_failed',
    status: 502,
  };
}

function mapWithdrawBalanceError(message: string | undefined): {
  error: string;
  code: string;
  status: number;
} {
  const msg = message ?? '';

  if (/frozen/i.test(msg)) {
    return {
      error:
        'Your balance is temporarily frozen due to an open payment dispute. Withdrawals will be available once the dispute is resolved.',
      code: 'balance_frozen',
      status: 403,
    };
  }

  if (/insufficient/i.test(msg)) {
    return {
      error:
        'Insufficient available balance. Part of your balance may be on hold or already reserved.',
      code: 'insufficient_balance',
      status: 400,
    };
  }

  return {
    error: 'Failed to reserve your balance for withdrawal. Please try again.',
    code: 'balance_reservation_failed',
    status: 500,
  };
}

// ─── Withdrawal destination (bank account) resolution ───────────────────────
// See the identical, documented copy in ./withdrawal-validation.ts for the
// full rationale and the documented residual limitation. Keep in sync.

interface ExternalAccountSummary {
  id: string;
  default_for_currency?: boolean | null;
  bank_name?: string | null;
  last4?: string | null;
}

type DestinationResolution =
  | {
      ok: true;
      targetAccount: ExternalAccountSummary;
      needsDefaultUpdate: boolean;
    }
  | {
      ok: false;
      error: string;
      code: string;
    };

function resolveWithdrawalDestination(
  accounts: ExternalAccountSummary[],
  requestedBankAccountId: string | undefined
): DestinationResolution {
  if (accounts.length === 0) {
    return {
      ok: false,
      error: 'No bank account is linked to your payout account. Please add one before withdrawing.',
      code: 'no_bank_account',
    };
  }

  if (requestedBankAccountId) {
    const requested = accounts.find(a => a.id === requestedBankAccountId);
    if (!requested) {
      return {
        ok: false,
        error:
          'Your selected bank account could not be found on your payout account. Please refresh and try again.',
        code: 'bank_account_not_found',
      };
    }
    return {
      ok: true,
      targetAccount: requested,
      needsDefaultUpdate: !requested.default_for_currency,
    };
  }

  const current = accounts.find(a => a.default_for_currency) ?? accounts[0];
  return { ok: true, targetAccount: current, needsDefaultUpdate: false };
}

type AccountEligibilityResult = { ok: true } | { ok: false; error: string; code: string };

// Blocks self-service /transfer and /instant-payout for suspended/banned
// accounts (profiles.account_status). Deliberately not applied to
// admin-withdrawals' recovery actions — see withdrawal-validation.ts for
// the full rationale. Keep in sync.
function validateAccountEligibility(
  accountStatus: string | null | undefined
): AccountEligibilityResult {
  if (accountStatus === 'suspended' || accountStatus === 'banned') {
    return {
      ok: false,
      error:
        'Withdrawals are unavailable while your account is under review. Contact support for details.',
      code: 'account_not_eligible',
    };
  }
  return { ok: true };
}
// ─── End inlined withdrawal-validation helpers ──────────────────────────────

// ─── Inlined from ./instant-payout-validation.ts ────────────────────────────
// (local imports are not supported by the Supabase bundler — keep both
// copies in sync; the sibling module is the unit-tested source of truth)

// Named distinctly from readEnvNumber() above (rather than reusing it)
// because both inlined copies coexist in this module's scope, where two
// `function readEnvNumber` declarations would collide.
function readEnvNumberForInstantPayout(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Estimated instant-payout fee rate, as a percent — env-configurable via INSTANT_PAYOUT_FEE_PERCENT; defaults to 1 (%). */
const INSTANT_PAYOUT_FEE_PERCENT = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_PERCENT', 1);

/** Estimated minimum instant-payout fee in USD — env-configurable via INSTANT_PAYOUT_FEE_MIN_USD; defaults to 0.50. */
const INSTANT_PAYOUT_FEE_MIN_USD = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_MIN_USD', 0.5);

/**
 * Estimates the instant-payout fee (in whole cents) for pre-confirmation
 * display only — the authoritative fee is whatever Stripe actually charges
 * on the created Payout, reconciled via the payout.paid/payout.updated
 * webhook handling in webhooks/index.ts.
 */
function estimateInstantFeeCents(amountCents: number): number {
  const percentFee = Math.round((amountCents * INSTANT_PAYOUT_FEE_PERCENT) / 100);
  const minFeeCents = Math.round(INSTANT_PAYOUT_FEE_MIN_USD * 100);
  return Math.max(percentFee, minFeeCents);
}

interface InstantCardSummary {
  id: string;
  brand?: string | null;
  last4?: string | null;
  available_payout_methods?: string[] | null;
}

// ---------------------------------------------------------------------------
// Connect-native payouts (Phases 4-5)
// ---------------------------------------------------------------------------

/**
 * Lifecycle events written to public.payout_audit_log.
 *
 * Connect-native payouts never move profiles.balance, so this log is the only
 * durable record of why a payout was allowed or refused. Emitted even on the
 * failure paths — especially on the failure paths.
 */
type PayoutAuditEvent =
  | 'withdrawal_requested'
  | 'withdrawal_validated'
  | 'stripe_payout_created'
  // An instant payout Stripe refused. Recorded separately from
  // withdrawal_failed because the withdrawal itself has NOT failed — it falls
  // back to a standard payout and stays pending. Conflating the two is the
  // reasoning that produced the 2026-08-13 incident.
  | 'instant_payout_failed'
  | 'withdrawal_completed'
  | 'withdrawal_failed';

interface PayoutAuditEntry {
  userId: string;
  event: PayoutAuditEvent;
  payoutMethod?: 'instant' | 'standard';
  amountCents?: number;
  currency?: string;
  balanceAvailableCents?: number;
  balanceInstantAvailableCents?: number;
  stripePayoutId?: string | null;
  stripeConnectAccountId?: string | null;
  idempotencyKey?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Best-effort audit write. Deliberately never throws and never blocks the
 * payout: losing an audit row is bad, but failing a payout that Stripe already
 * accepted because we could not write a log line would be worse. Failures are
 * logged loudly so they surface in monitoring.
 */
async function writePayoutAudit(supabase: SupabaseClient, entry: PayoutAuditEntry): Promise<void> {
  try {
    const { error } = await supabase.from('payout_audit_log').insert({
      user_id: entry.userId,
      event: entry.event,
      payout_method: entry.payoutMethod ?? null,
      amount_cents: entry.amountCents ?? null,
      currency: entry.currency ?? 'usd',
      balance_available_cents: entry.balanceAvailableCents ?? null,
      balance_instant_available_cents: entry.balanceInstantAvailableCents ?? null,
      stripe_payout_id: entry.stripePayoutId ?? null,
      stripe_connect_account_id: entry.stripeConnectAccountId ?? null,
      idempotency_key: entry.idempotencyKey ?? null,
      error_code: entry.errorCode ?? null,
      error_message: entry.errorMessage ?? null,
      detail: entry.detail ?? null,
    });
    if (error) {
      console.error('[payout-audit] failed to write audit row', {
        userId: entry.userId,
        event: entry.event,
        error: error.message,
      });
    }
  } catch (auditError) {
    console.error('[payout-audit] threw while writing audit row', {
      userId: entry.userId,
      event: entry.event,
      error: (auditError as { message?: string })?.message,
    });
  }
}

/**
 * True when this hunter already has a withdrawal in flight.
 *
 * `idx_wallet_tx_one_pending_withdrawal` is a partial UNIQUE index on
 * (user_id) WHERE type='withdrawal' AND status='pending', so the database
 * permits exactly one in-flight withdrawal per hunter. Before 2026-08-16 that
 * index was effectively inert: withdrawals were written straight to
 * 'completed', so 'pending' lasted microseconds and the index never fired.
 *
 * Now that a withdrawal legitimately stays 'pending' for the 1-2 business days
 * a standard payout takes to settle, the index becomes a real serialization
 * lock. Checking it here — BEFORE withdraw_balance() debits anything — turns
 * what would otherwise be a raw 23505 after a balance deduction into a clean,
 * refund-free rejection with copy the hunter can act on.
 *
 * The begin_legacy_withdrawal / retry_failed_withdrawal RPCs still handle
 * 23505 as the race backstop if two requests pass this check simultaneously.
 */
async function findInFlightWithdrawal(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string; amount: number; created_at: string } | null> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('id, amount, created_at')
    .eq('user_id', userId)
    .eq('type', 'withdrawal')
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    // Fail open: the DB index is the real guarantee, and blocking every
    // withdrawal because a read failed would be worse than letting the insert
    // hit 23505 and refund.
    console.warn('[connect] in-flight withdrawal pre-check failed (non-fatal)', {
      userId,
      error: error.message,
    });
    return null;
  }
  return (data as { id: string; amount: number; created_at: string } | null) ?? null;
}

/**
 * Shared 409 for a hunter who already has a withdrawal settling.
 *
 * `stripeAttempted: false` marks this as a pre-flight business-rule rejection
 * for the client's analytics layer — Stripe was never asked to move money
 * for THIS request, so it must not be counted as a payout failure (see the
 * 2026-08-24 incident where a single hunter's 36 retries against this exact
 * block inflated the payout_failed metric 5x). `pendingAmount` is the numeric
 * amount of the withdrawal already in flight, exposed structurally (not just
 * interpolated into `error`) so the client can build UI copy and analytics
 * properties without parsing prose out of an error string.
 */
function inFlightWithdrawalResponse(inFlight: { amount: number }): Response {
  const pendingAmount = Math.abs(inFlight.amount);
  return jsonResponse(
    {
      error: `You already have a withdrawal of $${pendingAmount.toFixed(2)} on its way to your bank. You can start another one once it lands — usually within 1-2 business days.`,
      code: 'withdrawal_already_in_progress',
      pendingAmount,
      stripeAttempted: false,
    },
    409
  );
}

/**
 * Projects a Stripe payout status onto the vocabulary wallet_transactions
 * uses, so the two can be compared without a mismatch being reported every
 * time the words simply differ.
 *
 * Stripe: pending | in_transit | paid | failed | canceled
 * Ledger: pending | completed | failed | cancelled
 *
 * in_transit maps to 'pending' deliberately — the money is still in flight,
 * and treating it as complete is what let the legacy flow mark withdrawals
 * 'completed' before they had actually landed.
 */
function normalizePayoutStatusForLedger(stripeStatus: string): string {
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
      return stripeStatus;
  }
}

interface ConnectBalanceSnapshot {
  availableCents: number;
  pendingCents: number;
  instantAvailableCents: number;
  currency: string;
}

/**
 * Reads the spendable balances from a connected account.
 *
 * instant_available is summed from net_available — the amount NET of Stripe's
 * instant payout fee — not from .amount. Stripe warns that using .amount
 * breaks the integration once instant-payout application fees are enabled,
 * because the gross figure is more than the account can actually pay out.
 */
async function readConnectBalance(
  stripe: Stripe,
  accountId: string,
  currency: string
): Promise<ConnectBalanceSnapshot> {
  const balance = await stripe.balance.retrieve({ stripeAccount: accountId });

  const sumFor = (buckets: Array<{ currency: string; amount: number }> | undefined): number =>
    (buckets ?? [])
      .filter(b => b.currency === currency)
      .reduce((total, b) => total + (b.amount ?? 0), 0);

  const instantAvailableCents = ((balance.instant_available ?? []) as InstantAvailableWithNet[])
    .filter(b => b.currency === currency)
    .reduce(
      (total, b) => total + (b.net_available?.reduce((s, n) => s + (n.amount ?? 0), 0) ?? 0),
      0
    );

  return {
    availableCents: sumFor(balance.available),
    pendingCents: sumFor(balance.pending),
    instantAvailableCents,
    currency,
  };
}

/**
 * Maps a Stripe payouts.create failure to user-facing copy.
 *
 * Kept separate from mapStripeTransferError because the failure modes are
 * genuinely different: a payout can fail for reasons a transfer cannot
 * (instant ineligibility, destination card declined, daily instant limits),
 * and conflating them produced misleading messages in the legacy flow.
 */
function mapStripePayoutError(err: {
  code?: string;
  type?: string;
  message?: string;
  raw?: { code?: string; message?: string };
}): { error: string; code: string; status: number } {
  const code = err?.code ?? err?.raw?.code ?? '';

  switch (code) {
    case 'balance_insufficient':
      return {
        error:
          'Your Stripe balance no longer covers this amount. It may have changed since this screen loaded — refresh and try again.',
        code: 'insufficient_balance',
        status: 400,
      };
    case 'payouts_not_allowed':
      return {
        error:
          'Payouts are not enabled on your account yet. Complete your payout setup and try again.',
        code: 'payouts_disabled',
        status: 400,
      };
    case 'instant_payouts_unsupported':
    case 'instant_payouts_not_allowed':
      return {
        error:
          'This card cannot receive instant payouts. Choose a different debit card or use a standard withdrawal.',
        code: 'instant_unsupported',
        status: 400,
      };
    case 'instant_payouts_limit_exceeded':
      return {
        error:
          'You have reached the instant payout limit for today. Try again tomorrow or use a standard withdrawal.',
        code: 'instant_limit_exceeded',
        status: 429,
      };
    case 'invalid_request_error':
      return {
        error: 'We could not process this withdrawal. Please refresh and try again.',
        code: 'payout_invalid_request',
        status: 400,
      };
    default:
      break;
  }

  if (err?.type === 'StripeConnectionError' || err?.type === 'StripeAPIError') {
    return {
      error:
        'We could not reach Stripe to complete your withdrawal. No funds have moved — please try again.',
      code: 'stripe_unavailable',
      status: 503,
    };
  }

  return {
    error:
      'We could not complete this withdrawal right now. No funds have moved — please try again.',
    code: 'payout_failed',
    status: 502,
  };
}

interface NativePayoutParams {
  stripe: Stripe;
  supabase: SupabaseClient;
  userId: string;
  body: Record<string, unknown>;
  method: 'instant' | 'standard';
}

/**
 * Connect-native withdrawal — Phases 4 (instant) and 5 (standard).
 *
 * Spends the balance already held in the user's connected account:
 *
 *     Connect balance --payouts.create()--> bank account / debit card
 *
 * Contrast with the legacy path, which debited profiles.balance and then
 * pushed a *fresh* platform Transfer into the connected account before paying
 * out. That design could not spend money the account already held, which is
 * precisely why Phase 2 earnings were unreachable.
 *
 * Invariants (enforced by tests):
 *   - profiles.balance is never read as a funding source and never mutated.
 *   - No stripe.transfers.create call. The money is already there.
 *   - The connected account is resolved from the caller's JWT; the client
 *     cannot name an account.
 *
 * Both methods share this one path so validation, idempotency, audit and error
 * mapping cannot drift apart between instant and standard withdrawals.
 */
async function handleConnectNativePayout(params: NativePayoutParams): Promise<Response> {
  const { stripe, supabase, userId, body, method } = params;
  const currency = 'usd';
  const log = `[connect/native-payout:${method}]`;

  const validation = validateWithdrawalRequest(
    body as Parameters<typeof validateWithdrawalRequest>[0]
  );
  if (!validation.ok) {
    console.warn(`${log} validation failed`, { userId, code: validation.code });
    return jsonResponse({ error: validation.error, code: validation.code }, 400);
  }
  const amount = validation.amount;
  const amountCents = validation.amountCents;

  if (method === 'instant') {
    const instantAmountCheck = validateInstantAmount(amount);
    if (!instantAmountCheck.ok) {
      return jsonResponse({ error: instantAmountCheck.error, code: instantAmountCheck.code }, 400);
    }
  }

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 200)
      : undefined;

  const requestedDestinationId =
    typeof body.destinationId === 'string' && body.destinationId.trim()
      ? body.destinationId.trim()
      : typeof body.debitCardId === 'string' && body.debitCardId.trim()
        ? body.debitCardId.trim()
        : undefined;

  await writePayoutAudit(supabase, {
    userId,
    event: 'withdrawal_requested',
    payoutMethod: method,
    amountCents,
    currency,
    idempotencyKey,
    detail: { hasRequestedDestination: !!requestedDestinationId },
  });

  // Idempotency replay. Shares the (user_id, idempotency_key) unique index on
  // wallet_transactions with the legacy routes; clients mint a fresh key per
  // attempt. Returning the original result rather than paying out twice is the
  // whole point — a retried request must never move money a second time.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('wallet_transactions')
      .select('id, stripe_payout_id, stripe_connect_account_id, amount, status, payout_method')
      .eq('user_id', userId)
      .eq('type', 'withdrawal')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing) {
      const e = existing as WalletTransaction & {
        stripe_connect_account_id?: string;
        stripe_payout_id?: string | null;
        payout_method?: string;
      };
      console.log(`${log} idempotent replay`, { userId, transactionId: e.id });
      return jsonResponse({
        payoutId: e.stripe_payout_id ?? null,
        payoutMethod: e.payout_method ?? method,
        status: e.status ?? 'pending',
        amount: Math.abs(e.amount),
        currency,
        accountId: e.stripe_connect_account_id,
        transactionId: e.id,
        duplicate: true,
        message: 'This withdrawal was already submitted and is being processed.',
      });
    }
  }

  // profiles.balance is deliberately NOT selected here. Under this
  // architecture it is not a funding source, and reading it invites a future
  // change to start gating on it again.
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_onboarded_at, account_status')
    .eq('id', userId)
    .single();

  if (!profile) {
    return jsonResponse({ error: 'Profile not found' }, 404);
  }
  const p = profile as Profile;

  const accountEligibility = validateAccountEligibility(p.account_status);
  if (!accountEligibility.ok) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      errorCode: accountEligibility.code,
    });
    return jsonResponse({ error: accountEligibility.error, code: accountEligibility.code }, 403);
  }

  if (!p.stripe_connect_account_id) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      errorCode: 'no_connect_account',
    });
    return jsonResponse(
      {
        error: 'You do not have a payout account yet. Set up payouts to withdraw your earnings.',
        code: 'no_connect_account',
      },
      400
    );
  }

  if (!p.stripe_connect_onboarded_at) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      errorCode: 'connect_not_onboarded',
      stripeConnectAccountId: p.stripe_connect_account_id,
    });
    return jsonResponse(
      {
        error: 'Your payout setup is not finished yet. Complete onboarding before withdrawing.',
        code: 'connect_not_onboarded',
      },
      400
    );
  }

  const accountId = p.stripe_connect_account_id;

  // Stripe caps instant payouts at 10 per day per connected account. Checked
  // before touching Stripe so the user gets a clear message instead of a raw
  // rejection mid-payout.
  if (method === 'instant') {
    const { count: instantPayoutsToday, error: instantCountError } = await supabase
      .from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'withdrawal')
      .eq('payout_method', 'instant')
      .in('status', ['completed', 'pending'])
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (instantCountError) {
      return jsonResponse(
        {
          error: 'We could not verify your Instant Cash Out eligibility. Please try again.',
          code: 'account_verification_failed',
        },
        503
      );
    }
    const dailyLimitCheck = checkInstantDailyLimit(instantPayoutsToday ?? 0);
    if (!dailyLimitCheck.ok) {
      await writePayoutAudit(supabase, {
        userId,
        event: 'withdrawal_failed',
        payoutMethod: method,
        amountCents,
        currency,
        idempotencyKey,
        errorCode: dailyLimitCheck.code,
        stripeConnectAccountId: accountId,
      });
      return jsonResponse({ error: dailyLimitCheck.error, code: dailyLimitCheck.code }, 429);
    }
  }

  // Account state + live balance, in parallel — both are required before we
  // can decide whether this withdrawal is allowed.
  let account: Stripe.Account;
  let balance: ConnectBalanceSnapshot;
  try {
    [account, balance] = await Promise.all([
      stripe.accounts.retrieve(accountId),
      readConnectBalance(stripe, accountId, currency),
    ]);
  } catch (balanceError) {
    const errInfo = balanceError as { message?: string; code?: string };
    console.error(`${log} failed to read account or balance`, {
      userId,
      accountId,
      error: errInfo?.message,
    });
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      stripeConnectAccountId: accountId,
      errorCode: 'stripe_unavailable',
      errorMessage: errInfo?.message ?? null,
    });
    return jsonResponse(
      {
        error:
          'We could not reach Stripe to check your balance. No funds have moved — please try again.',
        code: 'stripe_unavailable',
      },
      503
    );
  }

  if (!account.payouts_enabled) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      stripeConnectAccountId: accountId,
      errorCode: 'payouts_disabled',
      detail: { disabledReason: account.requirements?.disabled_reason ?? null },
    });
    return jsonResponse(
      {
        error:
          'Payouts are currently disabled on your account. Review your payout details and try again.',
        code: 'payouts_disabled',
        disabledReason: account.requirements?.disabled_reason ?? null,
        requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
      },
      400
    );
  }

  // Instant draws on instant_available (which includes not-yet-settled card
  // funds); standard draws on available (settled only). Using the wrong one
  // produces "insufficient funds" on money the user can genuinely access, or
  // the reverse.
  const spendableCents =
    method === 'instant' ? balance.instantAvailableCents : balance.availableCents;

  if (spendableCents <= 0) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      stripeConnectAccountId: accountId,
      errorCode: 'no_available_funds',
      balanceAvailableCents: balance.availableCents,
      balanceInstantAvailableCents: balance.instantAvailableCents,
    });
    return jsonResponse(
      {
        error:
          method === 'instant'
            ? 'You have no funds available for instant withdrawal right now. Recent earnings may still be clearing.'
            : 'You have no funds available to withdraw right now. Recent earnings may still be clearing.',
        code: 'no_available_funds',
        availableCents: balance.availableCents,
        pendingCents: balance.pendingCents,
        instantAvailableCents: balance.instantAvailableCents,
      },
      400
    );
  }

  if (amountCents > spendableCents) {
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      stripeConnectAccountId: accountId,
      errorCode: 'insufficient_balance',
      balanceAvailableCents: balance.availableCents,
      balanceInstantAvailableCents: balance.instantAvailableCents,
    });
    return jsonResponse(
      {
        error: 'That is more than you have available to withdraw.',
        code: 'insufficient_balance',
        availableCents: balance.availableCents,
        pendingCents: balance.pendingCents,
        instantAvailableCents: balance.instantAvailableCents,
      },
      400
    );
  }

  // Destination. Instant requires an instant-eligible debit card. Standard
  // omits `destination` unless one was explicitly requested, letting Stripe
  // use the account's default external account.
  let destinationId: string | undefined;
  let destinationCard: InstantCardSummary | undefined;

  if (method === 'instant') {
    try {
      const externalAccounts = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'card',
        limit: 100,
      });
      const cards: InstantCardSummary[] = externalAccounts.data.map(c => ({
        id: c.id,
        brand: (c as unknown as { brand?: string }).brand ?? null,
        last4: (c as unknown as { last4?: string }).last4 ?? null,
        available_payout_methods:
          (c as unknown as { available_payout_methods?: string[] }).available_payout_methods ??
          null,
      }));

      const destination = resolveInstantDestination(cards, requestedDestinationId);
      if (!destination.ok) {
        await writePayoutAudit(supabase, {
          userId,
          event: 'withdrawal_failed',
          payoutMethod: method,
          amountCents,
          currency,
          idempotencyKey,
          stripeConnectAccountId: accountId,
          errorCode: destination.code,
        });
        return jsonResponse({ error: destination.error, code: destination.code }, 400);
      }
      destinationCard = destination.targetCard;
      destinationId = destination.targetCard.id;
    } catch (cardError) {
      await writePayoutAudit(supabase, {
        userId,
        event: 'withdrawal_failed',
        payoutMethod: method,
        amountCents,
        currency,
        idempotencyKey,
        stripeConnectAccountId: accountId,
        errorCode: 'account_verification_failed',
        errorMessage: (cardError as { message?: string })?.message ?? null,
      });
      return jsonResponse(
        {
          error: 'We could not verify your payout card. No funds have moved — please try again.',
          code: 'account_verification_failed',
        },
        503
      );
    }
  } else {
    destinationId = requestedDestinationId;
  }

  await writePayoutAudit(supabase, {
    userId,
    event: 'withdrawal_validated',
    payoutMethod: method,
    amountCents,
    currency,
    idempotencyKey,
    stripeConnectAccountId: accountId,
    balanceAvailableCents: balance.availableCents,
    balanceInstantAvailableCents: balance.instantAvailableCents,
    detail: { destinationId: destinationId ?? null },
  });

  // The payout itself. This is the ONLY money movement in this handler: funds
  // already in the connected account go out to the user's bank or card.
  let payout: Stripe.Payout;
  try {
    payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency,
        method,
        ...(destinationId ? { destination: destinationId } : {}),
        metadata: {
          user_id: userId,
          purpose: method === 'instant' ? 'instant_cash_out' : 'standard_withdrawal',
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        },
      },
      {
        stripeAccount: accountId,
        // Scoped by user, key, amount and method so a retry of the same
        // request replays, while a genuinely different request does not
        // collide with it.
        idempotencyKey: idempotencyKey
          ? buildNativePayoutIdempotencyKey({
              userId,
              clientKey: idempotencyKey,
              amountCents,
              method,
            })
          : undefined,
      }
    );
  } catch (payoutError) {
    const errInfo = payoutError as { code?: string; type?: string; message?: string };
    console.error(`${log} payout creation failed`, {
      userId,
      accountId,
      amountCents,
      stripeCode: errInfo?.code,
      message: errInfo?.message,
    });
    await writePayoutAudit(supabase, {
      userId,
      event: 'withdrawal_failed',
      payoutMethod: method,
      amountCents,
      currency,
      idempotencyKey,
      stripeConnectAccountId: accountId,
      errorCode: errInfo?.code ?? 'payout_failed',
      errorMessage: errInfo?.message ?? null,
      balanceAvailableCents: balance.availableCents,
      balanceInstantAvailableCents: balance.instantAvailableCents,
    });
    // No compensating action is needed or correct here: nothing was debited
    // anywhere. The money never left the connected account.
    //
    // stripeAttempted: true — the payout-creation call just above was actually
    // made and Stripe rejected or failed to process it. This is the one
    // genuine provider-failure exit from this function; every other error
    // return above happens before that call and must not carry the flag.
    const mapped = mapStripePayoutError(errInfo);
    return jsonResponse({ error: mapped.error, code: mapped.code, stripeAttempted: true }, mapped.status);
  }

  await writePayoutAudit(supabase, {
    userId,
    event: 'stripe_payout_created',
    payoutMethod: method,
    amountCents,
    currency,
    idempotencyKey,
    stripeConnectAccountId: accountId,
    stripePayoutId: payout.id,
    detail: { status: payout.status, arrivalDate: payout.arrival_date ?? null },
  });

  const estimatedFeeCents = method === 'instant' ? estimateInstantFeeCents(amountCents) : 0;

  // History record. Status mirrors Stripe's own payout status rather than
  // being assumed 'completed' — a payout is 'pending' until it lands, and the
  // payout.paid / payout.failed webhooks advance it from here.
  const { data: transaction, error: txError } = await supabase
    .from('wallet_transactions')
    .insert({
      user_id: userId,
      type: 'withdrawal',
      amount: -amount,
      description:
        method === 'instant' ? 'Instant Cash Out to debit card' : 'Withdrawal to bank account',
      status: 'pending',
      payout_method: method,
      stripe_payout_id: payout.id,
      stripe_connect_account_id: accountId,
      idempotency_key: idempotencyKey ?? null,
      instant_fee_amount: method === 'instant' ? estimatedFeeCents / 100 : null,
      metadata: {
        payout_id: payout.id,
        payout_status: payout.status,
        arrival_date: payout.arrival_date ?? null,
        idempotency_key: idempotencyKey ?? null,
        connect_native: true,
        ...(destinationCard
          ? {
              destination_card_id: destinationCard.id,
              destination_card_last4: destinationCard.last4 ?? null,
              destination_card_brand: destinationCard.brand ?? null,
            }
          : { destination_id: destinationId ?? null }),
        ...(method === 'instant' ? { estimated_fee_cents: estimatedFeeCents } : {}),
      },
    })
    .select()
    .single();

  if (txError) {
    // A concurrent request with the same key won the insert. Stripe's own
    // idempotency means both calls resolved to the SAME payout, so there is
    // nothing to reverse — report the winner.
    if ((txError as { code?: string }).code === '23505' && idempotencyKey) {
      const { data: winner } = await supabase
        .from('wallet_transactions')
        .select('id, stripe_payout_id, status, payout_method')
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      const w = winner as
        | (WalletTransaction & { stripe_payout_id?: string; payout_method?: string })
        | null;
      return jsonResponse({
        payoutId: w?.stripe_payout_id ?? payout.id,
        payoutMethod: w?.payout_method ?? method,
        status: w?.status ?? payout.status,
        amount,
        currency,
        accountId,
        transactionId: w?.id,
        duplicate: true,
        message: 'This withdrawal was already submitted and is being processed.',
      });
    }

    logCritical(
      'connect-native payout succeeded but transaction record failed — reconciliation required',
      {
        userId,
        payoutId: payout.id,
        amountCents,
        error: txError,
      }
    );
    // The payout is real and the audit log has it; only the history row is
    // missing, so this is reported as success with a caveat.
    return jsonResponse({
      payoutId: payout.id,
      payoutMethod: method,
      status: payout.status,
      amount,
      currency,
      accountId,
      arrivalDate: payout.arrival_date ?? null,
      message: 'Withdrawal initiated.',
      warning: 'Transaction history may take a moment to update.',
    });
  }

  await writePayoutAudit(supabase, {
    userId,
    event: 'withdrawal_completed',
    payoutMethod: method,
    amountCents,
    currency,
    idempotencyKey,
    stripeConnectAccountId: accountId,
    stripePayoutId: payout.id,
    detail: { transactionId: (transaction as WalletTransaction).id, status: payout.status },
  });

  console.log(`${log} payout created`, { userId, payoutId: payout.id, amountCents });

  return jsonResponse({
    payoutId: payout.id,
    payoutMethod: method,
    status: payout.status,
    amount,
    currency,
    accountId,
    transactionId: (transaction as WalletTransaction).id,
    arrivalDate: payout.arrival_date ?? null,
    ...(method === 'instant' ? { estimatedFee: estimatedFeeCents / 100 } : {}),
    remainingAvailableCents: Math.max(0, spendableCents - amountCents),
    message:
      method === 'instant'
        ? 'Instant Cash Out sent. Funds typically arrive within minutes.'
        : 'Withdrawal sent. Funds typically arrive in 1-2 business days.',
  });
}

type InstantDestinationResolution =
  | { ok: true; targetCard: InstantCardSummary }
  | { ok: false; error: string; code: string };

/**
 * Decides which linked debit card an Instant Cash Out should target. Unlike
 * resolveWithdrawalDestination() above, this NEVER instructs promoting the
 * chosen card to default_for_currency — Stripe's automatic payout sweep
 * (which still drives every *standard* withdrawal) must keep targeting the
 * bank account, never a linked instant-payout card.
 */
function resolveInstantDestination(
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
    const isEligible =
      Array.isArray(requested.available_payout_methods) &&
      requested.available_payout_methods.includes('instant');
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

// Instant-specific limits — see the identical, documented copy in
// ./instant-payout-validation.ts for the full rationale. Keep in sync.
const INSTANT_PAYOUT_MAX_USD = readEnvNumberForInstantPayout('INSTANT_PAYOUT_MAX_USD', 9999);
const MAX_INSTANT_PAYOUTS_PER_DAY = readEnvNumberForInstantPayout('MAX_INSTANT_PAYOUTS_PER_DAY', 10);

type InstantLimitResult = { ok: true } | { ok: false; error: string; code: string };

function validateInstantAmount(amount: number): InstantLimitResult {
  if (amount > INSTANT_PAYOUT_MAX_USD) {
    return {
      ok: false,
      error: `Instant Cash Out is limited to $${INSTANT_PAYOUT_MAX_USD.toLocaleString('en-US')} per transfer. Please use a standard bank withdrawal for larger amounts.`,
      code: 'above_instant_maximum',
    };
  }
  return { ok: true };
}

function checkInstantDailyLimit(countToday: number): InstantLimitResult {
  if (countToday >= MAX_INSTANT_PAYOUTS_PER_DAY) {
    return {
      ok: false,
      error: `You've reached the limit of ${MAX_INSTANT_PAYOUTS_PER_DAY} Instant Cash Outs per day. Please try again tomorrow, or use a standard bank withdrawal.`,
      code: 'daily_instant_limit_reached',
    };
  }
  return { ok: true };
}
// ─── End inlined instant-payout-validation helpers ──────────────────────────

// ─── Staged Phase 2 retirement of the legacy wallet-balance withdrawal path ─
// When true, /connect/transfer and /connect/retry-transfer return 410 Gone
// (mirroring the completed /bank-accounts deprecation further below) instead
// of running the legacy custodial-wallet withdrawal flow. Off by default —
// this is a STAGED step for the Stripe Phase 2 migration
// (see supabase/functions/bounty-payments) and must not be flipped on until
// production wallet balances are confirmed fully migrated. The legacy
// withdrawal logic below is left completely intact; this only adds a guard
// in front of it.
const CONNECT_TRANSFER_RETIRED = Deno.env.get('CONNECT_TRANSFER_RETIRED') === 'true';

// Whether NEWLY created Connect accounts hold their balance until the user
// explicitly withdraws, instead of Stripe sweeping it to their bank on its
// default automatic daily schedule.
//
// This is what makes the connected account's balance behave as "the wallet":
// under the automatic default, an available balance is paid out within ~a day,
// so a "Withdraw Now" button would almost always find $0 to draw and the
// wallet would read ~$0 even for a hunter who just got paid. Stripe treats the
// schedule as all-or-nothing per account — there is no per-payment override.
//
// Trade-off accepted deliberately: under a manual schedule the platform is
// obliged to pay funds out within 2 years (US) / 90 days (most other
// countries), and a user who never taps Withdraw leaves money sitting in
// Stripe. Mitigated by idle-balance reminders and monitoring — see
// docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md §7 R1.
//
// Applied to new accounts only. Existing accounts keep the automatic schedule
// they were created with until a deliberate backfill (ibid. §6 step 7, R10),
// so no current user's payouts silently stop arriving.
const CONNECT_MANUAL_PAYOUTS = Deno.env.get('CONNECT_MANUAL_PAYOUTS') === 'true';

// Payout-schedule settings for stripe.accounts.create(). Spread into the call
// so that with the flag off the request is byte-identical to what it was
// before this change.
const manualPayoutSettings = CONNECT_MANUAL_PAYOUTS
  ? { settings: { payouts: { schedule: { interval: 'manual' as const } } } }
  : {};

// Routes withdrawals through the Connect-native payout path: spend the money
// already sitting in the user's connected account, instead of debiting
// profiles.balance and pushing a fresh platform Transfer across first.
//
// Off by default. While off, /instant-payout keeps its legacy behaviour
// byte-for-byte and /payout refuses, so this flag is also the rollback lever
// (docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md §8).
const CONNECT_NATIVE_PAYOUTS = Deno.env.get('CONNECT_NATIVE_PAYOUTS') === 'true';

function legacyTransferRetiredResponse() {
  return jsonResponse(
    {
      error:
        'Wallet-balance withdrawals are being retired in favor of the new Stripe-backed payout flow. Please contact support if you still have a pending balance.',
      code: 'legacy_transfer_deprecated',
      migrate_to: '/functions/v1/bounty-payments',
    },
    410
  );
}

// ─── Instant Cash Out rollout flag ───────────────────────────────────────────
// Off by default. POST /connect/instant-payout and the debit-card management
// routes are implemented and safe to deploy inert, but must not be flipped on
// in production until: (1) the migration adding wallet_transactions'
// payout_method/stripe_payout_id/instant_fee_amount columns has been applied,
// (2) an end-to-end Instant Cash Out has been exercised against a Stripe
// test-mode account (add a test card, confirm available_payout_methods
// includes 'instant', run a payout, confirm the webhook updates the row),
// and (3) a standard withdrawal has been re-confirmed to still route to the
// bank account, never a linked card — see docs/withdrawals/13-instant-cash-out.md.
const INSTANT_CASHOUT_ENABLED = Deno.env.get('INSTANT_CASHOUT_ENABLED') === 'true';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/connect');
  const subPath = pathParts.length > 1 ? pathParts[1] : '/';

  // GET /connect/embedded — HTML shim loaded inside a React Native WebView.
  // Public (no auth header) because WebView's initial navigation cannot set
  // Authorization. The page itself does NOT call Stripe with any secret; it
  // only receives a short-lived client_secret via postMessage from the app.
  if (req.method === 'GET' && subPath === '/embedded') {
    return new Response(renderEmbeddedPage(), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Allow loading Stripe's Connect JS and API from the CDN.
        'Content-Security-Policy':
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' https://connect-js.stripe.com https://js.stripe.com; " +
          'frame-src https://connect-js.stripe.com https://js.stripe.com; ' +
          'connect-src https://api.stripe.com https://connect-js.stripe.com https://merchant-ui-api.stripe.com; ' +
          "img-src 'self' data: https:; " +
          "style-src 'self' 'unsafe-inline';",
      },
    });
  }

  const isBankAccountsPath = subPath === '/bank-accounts' || subPath.startsWith('/bank-accounts/');
  const isDebitCardsPath = subPath === '/debit-cards' || subPath.startsWith('/debit-cards/');
  const isBalancePath = subPath === '/balance';
  const isPayoutsPath = subPath === '/payouts';
  if (
    req.method !== 'POST' &&
    !(
      req.method === 'GET' &&
      (isBankAccountsPath || isDebitCardsPath || isBalancePath || isPayoutsPath)
    ) &&
    !(req.method === 'DELETE' && (isBankAccountsPath || isDebitCardsPath))
  ) {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500);
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  const token = authHeader.substring(7);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  const userId = user.id;

  try {
    const configuredAppUrl = Deno.env.get('APP_URL');
    if (!configuredAppUrl && Deno.env.get('APP_ENV') === 'production') {
      console.error('[connect] APP_URL is required in production');
      return jsonResponse({ error: 'Connect return URLs are not configured' }, 500);
    }
    const appUrl = configuredAppUrl ?? 'http://localhost:8081';

    // POST /connect/create-account-link
    if (subPath === '/create-account-link') {
      const body = await req.json();
      const { returnUrl, refreshUrl, type: linkType } = body;

      // Supported link types: 'account_onboarding' (default) and 'account_update'
      const accountLinkType: 'account_onboarding' | 'account_update' =
        linkType === 'account_update' ? 'account_update' : 'account_onboarding';

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, email, full_name, phone, zip_code')
        .eq('id', userId)
        .single();

      const profileRow = profile as Profile | null;
      let accountId = profileRow?.stripe_connect_account_id;

      if (!accountId) {
        if (accountLinkType === 'account_update') {
          // Cannot update an account that doesn't exist yet
          return jsonResponse(
            {
              error: 'No Stripe Connect account found to update. Please complete onboarding first.',
            },
            400
          );
        }
        const fullName = profileRow?.full_name?.trim() ?? '';
        const nameParts = fullName.split(/\s+/).filter(Boolean);
        const individual: Record<string, unknown> = {
          first_name: nameParts[0] ?? undefined,
          last_name: nameParts.slice(1).join(' ') || undefined,
          email: profileRow?.email ?? undefined,
          phone: profileRow?.phone ?? undefined,
          address: {
            postal_code: profileRow?.zip_code ?? undefined,
          },
        };
        const account = await stripe.accounts.create({
          type: 'express',
          email: profileRow?.email ?? undefined,
          // Request card_payments in addition to transfers. verify-onboarding
          // and the account.updated webhook both gate `onboarded` on
          // charges_enabled && payouts_enabled, and charges_enabled tracks the
          // card_payments capability. Without it, charges_enabled stays false
          // forever, so a hunter who finishes KYC is never marked onboarded and
          // stripe_connect_onboarded_at is never written. The embedded-session
          // path and services/api/src/services/stripe-connect-service.ts already
          // request both.
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
          individual,
          business_profile: {
            product_description: 'Completes local errands and tasks via the Bounty marketplace.',
          },
          metadata: { user_id: userId },
          ...manualPayoutSettings,
        });
        accountId = account.id;
        await supabase
          .from('profiles')
          .update({ stripe_connect_account_id: accountId })
          .eq('id', userId);
        console.log(`[connect] Created new account: ${accountId} for user ${userId}`, {
          manualPayouts: CONNECT_MANUAL_PAYOUTS,
        });
      } else {
        // Legacy accounts created here before card_payments was requested only
        // have the transfers capability, so charges_enabled never turns true and
        // the hunter stays wrongly reported as not onboarded. Re-request
        // card_payments so re-entering onboarding can finish. Requesting an
        // already-active capability is a no-op, so this is safe for accounts
        // that already have it. Best-effort: a failure here must not block the
        // onboarding link.
        try {
          await stripe.accounts.update(accountId, {
            capabilities: { card_payments: { requested: true } },
          });
        } catch (err) {
          console.warn('[connect] Failed to backfill card_payments capability', {
            userId,
            accountId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl ?? `${appUrl}/wallet/connect/refresh`,
        return_url: returnUrl ?? `${appUrl}/wallet/connect/return`,
        type: accountLinkType,
      });

      return jsonResponse({
        url: accountLink.url,
        accountId,
        expiresAt: accountLink.expires_at * 1000,
      });
    }

    // POST /connect/login-link — a fresh, single-use link into the user's
    // Stripe Express Dashboard. This is the ONLY supported way for a hunter
    // to add, remove, or set a default bank account / debit card: these
    // Connect accounts have controller.requirement_collection === "stripe",
    // so Stripe rejects stripe.accounts.createExternalAccount /
    // updateExternalAccount / deleteExternalAccount from the platform side
    // with a permissions error, unconditionally — Stripe itself owns writes
    // to external accounts for these accounts. See the (now-deprecated)
    // /debit-cards, /bank-accounts/:id, and /bank-accounts/:id/default
    // handlers below for the endpoints this replaces.
    if (req.method === 'POST' && subPath === '/login-link') {
      console.log('[connect/login-link] request received', { userId });

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, stripe_connect_onboarded_at')
        .eq('id', userId)
        .single();

      const p = profile as {
        stripe_connect_account_id?: string;
        stripe_connect_onboarded_at?: string;
      } | null;
      const accountId = p?.stripe_connect_account_id;
      if (!accountId || !p?.stripe_connect_onboarded_at) {
        console.warn('[connect/login-link] no onboarded connected account for user', {
          userId,
          hasAccountId: !!accountId,
          onboardedAt: p?.stripe_connect_onboarded_at ?? null,
        });
        return jsonResponse(
          {
            error: 'Complete Stripe Connect onboarding before managing payout methods.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      console.log('[connect/login-link] connected account located', { userId, accountId });

      try {
        const loginLink = await stripe.accounts.createLoginLink(accountId);
        console.log('[connect/login-link] login link created', { userId, accountId });
        return jsonResponse({ url: loginLink.url });
      } catch (loginLinkError) {
        console.error('[connect/login-link] failed to create login link', {
          userId,
          accountId,
          error: (loginLinkError as { message?: string })?.message,
          type: (loginLinkError as { type?: string })?.type,
          code: (loginLinkError as { code?: string })?.code,
        });
        return jsonResponse(
          {
            error: 'Could not open your payout dashboard. Please try again.',
            code: 'login_link_failed',
          },
          502
        );
      }
    }

    // POST /connect/create-account-session
    // Creates a Stripe Connect Account Session for Embedded Components.
    // If the user doesn't have a Connect account yet, one is created lazily
    // (Express account, individual, card_payments + transfers capabilities).
    if (subPath === '/create-account-session') {
      const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
      if (!publishableKey) {
        console.error('[connect] STRIPE_PUBLISHABLE_KEY not configured');
        return jsonResponse({ error: 'Stripe publishable key not configured' }, 500);
      }

      const body = await req.json().catch(() => ({}));
      const components =
        body && typeof body.components === 'object' && body.components !== null
          ? body.components
          : { account_onboarding: true, payments: true, payouts: true };

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, email')
        .eq('id', userId)
        .single();

      const profileRow = profile as Profile | null;
      let accountId = profileRow?.stripe_connect_account_id;

      if (!accountId) {
        const requestedCountry =
          typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
        const country = /^[A-Z]{2}$/.test(requestedCountry) ? requestedCountry : 'US';
        const account = await stripe.accounts.create({
          type: 'express',
          country,
          email: profileRow?.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: { user_id: userId },
          ...manualPayoutSettings,
        });
        accountId = account.id;
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ stripe_connect_account_id: accountId })
          .eq('id', userId);
        if (updateError) {
          console.error('[connect] Failed to persist stripe_connect_account_id', {
            userId,
            accountId,
            error: updateError,
          });
          // We created an orphan Stripe account; surface the error so the client retries.
          return jsonResponse({ error: 'Failed to save account. Please try again.' }, 500);
        }
        console.log(`[connect] Created new Express account ${accountId} for user ${userId}`);
      }

      // Build the components payload. Accept either:
      //   { account_onboarding: true, payments: true }
      //   { account_onboarding: { enabled: true, features: { ... } }, ... }
      type ComponentSpec = boolean | { enabled?: boolean; features?: Record<string, unknown> };
      const normalize = (spec: ComponentSpec, defaultFeatures?: Record<string, unknown>) => {
        if (spec === false || spec === undefined) return undefined;
        if (spec === true) {
          return { enabled: true, ...(defaultFeatures ? { features: defaultFeatures } : {}) };
        }
        if (typeof spec === 'object' && spec.enabled !== false) {
          return {
            enabled: true,
            ...(spec.features
              ? { features: spec.features }
              : defaultFeatures
                ? { features: defaultFeatures }
                : {}),
          };
        }
        return undefined;
      };

      const componentsPayload: Record<string, unknown> = {};
      const accountOnboardingConfig = normalize(components.account_onboarding, {
        external_account_collection: true,
      });
      if (accountOnboardingConfig) componentsPayload.account_onboarding = accountOnboardingConfig;
      const paymentsConfig = normalize(components.payments, {
        refund_management: true,
        dispute_management: true,
        capture_payments: true,
      });
      if (paymentsConfig) componentsPayload.payments = paymentsConfig;
      const payoutsConfig = normalize(components.payouts, {
        instant_payouts: false,
        standard_payouts: true,
        edit_payout_schedule: false,
      });
      if (payoutsConfig) componentsPayload.payouts = payoutsConfig;

      if (Object.keys(componentsPayload).length === 0) {
        componentsPayload.account_onboarding = { enabled: true };
      }

      const accountSession = await stripe.accountSessions.create({
        account: accountId,
        components: componentsPayload as Stripe.AccountSessionCreateParams.Components,
      });

      return jsonResponse({
        clientSecret: accountSession.client_secret,
        publishableKey,
        accountId,
        expiresAt: accountSession.expires_at * 1000,
      });
    }

    // POST /connect/verify-onboarding
    if (subPath === '/verify-onboarding') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, stripe_connect_onboarded_at, payout_failed_at')
        .eq('id', userId)
        .single();

      const profileRow = profile as (Profile & { payout_failed_at?: string | null }) | null;
      if (!profileRow?.stripe_connect_account_id) {
        return jsonResponse({ onboarded: false });
      }

      const account = await stripe.accounts.retrieve(profileRow.stripe_connect_account_id);
      const onboarded = account.charges_enabled && account.payouts_enabled;

      console.log('[connect/verify-onboarding] account eligibility snapshot', {
        userId,
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        onboarded,
        currentlyDue: account.requirements?.currently_due ?? [],
        pendingVerification: account.requirements?.pending_verification ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      });

      const profileUpdates: Record<string, unknown> = {};

      if (onboarded && !profileRow.stripe_connect_onboarded_at) {
        profileUpdates.stripe_connect_onboarded_at = new Date().toISOString();
      }

      // Clear payout_failed_at when payouts are re-enabled so the recovery banner dismisses
      if (account.payouts_enabled && profileRow.payout_failed_at) {
        profileUpdates.payout_failed_at = null;
        profileUpdates.payout_failure_code = null;
        console.log(`[connect] Cleared payout_failed_at for user ${userId} — payouts re-enabled`);
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', userId);

        if (updateError) {
          console.error('[connect] Failed to update profile during verify-onboarding', {
            userId,
            error: updateError,
          });
          return jsonResponse({ error: 'Failed to update account status. Please try again.' }, 500);
        }
      }

      return jsonResponse({
        onboarded,
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        payoutFailedCleared: account.payouts_enabled && !!profileRow.payout_failed_at,
        requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
        requirementsPendingVerification: account.requirements?.pending_verification ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      });
    }

    // GET /connect/balance — the caller's own Stripe Connect account balance.
    //
    // This is the authoritative source of WITHDRAWABLE funds under the Phase 2
    // (payment_architecture_version = 2) architecture, where bounty releases
    // Transfer money straight into the hunter's connected account and never
    // touch profiles.balance. Deliberately reads nothing from profiles except
    // the account id — profiles.balance is the legacy v1 ledger and must not
    // be blended into this figure (see
    // docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md).
    //
    // Scoped to the authenticated caller's own account: there is no accountId
    // parameter, by design, so this can never be used to read another user's
    // balance.
    //
    // Unonboarded users get a 200 with zeros and hasConnectAccount:false
    // rather than an error — "no account yet" is a normal state the UI
    // renders as an onboarding CTA, not a failure.
    if (req.method === 'GET' && isBalancePath) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;

      if (!accountId) {
        return jsonResponse({
          available: 0,
          pending: 0,
          instantAvailable: 0,
          currency: 'usd',
          lastUpdated: new Date().toISOString(),
          hasConnectAccount: false,
          payoutsEnabled: false,
        });
      }

      // Balance and account state are independent reads; fetch in parallel so
      // the client's blocking balance call stays a single round trip.
      const [balance, account] = await Promise.all([
        stripe.balance.retrieve({ stripeAccount: accountId }),
        stripe.accounts.retrieve(accountId),
      ]);

      // Currency selection: prefer the account's own default so this doesn't
      // silently report 0 for a non-USD account, falling back to the first
      // currency Stripe reports.
      const currency = (
        account.default_currency ??
        balance.available?.[0]?.currency ??
        'usd'
      ).toLowerCase();

      const sumFor = (buckets: Array<{ currency: string; amount: number }> | undefined): number =>
        (buckets ?? [])
          .filter(b => b.currency === currency)
          .reduce((total, b) => total + (b.amount ?? 0), 0);

      // instant_available must be read via net_available (amount NET of the
      // instant payout fee), not .amount. Stripe explicitly warns that reading
      // .amount breaks the integration once instant-payout application fees
      // are enabled, because the user cannot actually pay out the gross figure.
      const instantAvailable = ((balance.instant_available ?? []) as InstantAvailableWithNet[])
        .filter(b => b.currency === currency)
        .reduce(
          (total, b) => total + (b.net_available?.reduce((s, n) => s + (n.amount ?? 0), 0) ?? 0),
          0
        );

      const payload = {
        available: sumFor(balance.available),
        pending: sumFor(balance.pending),
        instantAvailable,
        currency,
        lastUpdated: new Date().toISOString(),
        hasConnectAccount: true,
        payoutsEnabled: account.payouts_enabled === true,
      };

      console.log('[connect/balance] snapshot', {
        userId,
        accountId,
        available: payload.available,
        pending: payload.pending,
        instantAvailable: payload.instantAvailable,
        currency: payload.currency,
        payoutsEnabled: payload.payoutsEnabled,
      });

      return jsonResponse(payload);
    }

    // POST /connect/transfer
    if (subPath === '/transfer') {
      if (CONNECT_TRANSFER_RETIRED) return legacyTransferRetiredResponse();
      const body = await req.json();

      // Server-side validation: finite, whole-cent, min/max, USD only.
      const validation = validateWithdrawalRequest(body);
      if (!validation.ok) {
        console.warn('[connect/transfer] validation failed', {
          userId,
          code: validation.code,
        });
        return jsonResponse({ error: validation.error, code: validation.code }, 400);
      }
      const amount = validation.amount;
      const currency = 'usd';

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 200)
          : undefined;

      // Which external bank account the hunter selected in the withdraw
      // screen. Optional for backward compatibility with older clients; see
      // resolveWithdrawalDestination() above for why this is now required to
      // actually control where the money goes (it previously wasn't wired
      // through at all — see docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §3.8).
      const requestedBankAccountId =
        typeof body.bankAccountId === 'string' && body.bankAccountId.trim()
          ? body.bankAccountId.trim()
          : undefined;

      console.log('[connect/transfer] withdrawal requested', {
        userId,
        amount,
        hasIdempotencyKey: !!idempotencyKey,
        hasBankAccountId: !!requestedBankAccountId,
      });

      // Idempotency replay: if this key was already processed, return the
      // recorded withdrawal instead of creating a duplicate payout.
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from('wallet_transactions')
          .select('id, stripe_transfer_id, stripe_connect_account_id, amount, status')
          .eq('user_id', userId)
          .eq('type', 'withdrawal')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existing) {
          const e = existing as WalletTransaction & { stripe_connect_account_id?: string };
          console.log('[connect/transfer] idempotent replay', {
            userId,
            transactionId: e.id,
            transferId: e.stripe_transfer_id,
          });
          const { data: replayProfile } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
          const replayBalance =
            typeof (replayProfile as { balance?: number } | null)?.balance === 'number'
              ? (replayProfile as { balance: number }).balance
              : null;
          return jsonResponse({
            transferId: e.stripe_transfer_id,
            status: e.status ?? 'pending',
            amount: Math.abs(e.amount),
            currency,
            accountId: e.stripe_connect_account_id,
            transactionId: e.id,
            newBalance: replayBalance,
            duplicate: true,
            estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            message: 'This withdrawal was already submitted and is being processed.',
          });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'balance, balance_on_hold, stripe_connect_account_id, stripe_connect_onboarded_at, stripe_connect_payouts_enabled, account_status'
        )
        .eq('id', userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404);
      }

      const p = profile as Profile;

      const accountEligibility = validateAccountEligibility(p.account_status);
      if (!accountEligibility.ok) {
        console.warn('[connect/transfer] blocked for account_status', {
          userId,
          accountStatus: p.account_status,
        });
        return jsonResponse(
          { error: accountEligibility.error, code: accountEligibility.code },
          403
        );
      }

      if (!p.stripe_connect_account_id || !p.stripe_connect_onboarded_at) {
        return jsonResponse(
          {
            error:
              'Your payout account is not set up yet. Please complete Stripe Connect onboarding before withdrawing.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      // Live payout eligibility check: onboarding may have been completed in
      // the past but the account can become restricted (missing requirements,
      // disabled payouts, disconnected bank). Verify with Stripe before
      // touching the user's balance.
      try {
        const account = await stripe.accounts.retrieve(p.stripe_connect_account_id);
        if (!account.payouts_enabled) {
          console.warn('[connect/transfer] payouts disabled on connected account', {
            userId,
            accountId: p.stripe_connect_account_id,
            disabledReason: account.requirements?.disabled_reason ?? null,
          });
          return jsonResponse(
            {
              error:
                'Payouts are currently disabled on your account. Please review and update your payout details, then try again.',
              code: 'payouts_disabled',
            },
            400
          );
        }
      } catch (accountError) {
        console.error('[connect/transfer] failed to verify connected account', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (accountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not verify your payout account. Your balance has not been charged — please try again.',
            code: 'account_verification_failed',
          },
          503
        );
      }

      // Resolve and (if needed) promote the destination bank account BEFORE
      // touching the balance. stripe.transfers.create() below only moves
      // funds into the connected account's shared Stripe balance — Stripe's
      // own automatic payout schedule later sweeps that balance to whichever
      // external account is `default_for_currency` at sweep time. Making the
      // hunter's selection authoritative here is what actually fixes "money
      // sent to the wrong account" (see the extended rationale next to
      // resolveWithdrawalDestination() above).
      let destinationAccount: ExternalAccountSummary;
      try {
        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'bank_account', limit: 100 }
        );
        const summaries: ExternalAccountSummary[] = externalAccounts.data.map(ba => ({
          id: ba.id,
          default_for_currency: (ba as unknown as { default_for_currency?: boolean })
            .default_for_currency,
          bank_name: (ba as unknown as { bank_name?: string }).bank_name ?? null,
          last4: (ba as unknown as { last4?: string }).last4 ?? null,
        }));

        const destination = resolveWithdrawalDestination(summaries, requestedBankAccountId);
        if (!destination.ok) {
          console.warn('[connect/transfer] bank account resolution failed', {
            userId,
            code: destination.code,
            requestedBankAccountId,
          });
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }

        destinationAccount = destination.targetAccount;

        // CANNOT promote destinationAccount to default_for_currency here:
        // these Connect accounts have controller.requirement_collection ===
        // "stripe", so stripe.accounts.updateExternalAccount is rejected by
        // Stripe with a permissions error unconditionally — there is no
        // "payouts disabled" case that unblocks it, it always fails. Fail
        // closed immediately with a clear, actionable message instead of
        // attempting (and always losing to) that call. The user must set
        // their selected bank as default themselves via the Stripe payout
        // dashboard (POST /connect/login-link) — Stripe's own automatic
        // payout sweep pays out to whichever account is default at sweep
        // time, so this is the only account that can correctly receive it.
        if (destination.needsDefaultUpdate) {
          console.warn(
            '[connect/transfer] selected bank account is not the default payout account',
            {
              userId,
              accountId: p.stripe_connect_account_id,
              bankAccountId: destinationAccount.id,
            }
          );
          return jsonResponse(
            {
              error:
                'This bank account is not your default payout method. Open your payout dashboard to set it as default, then try again.',
              code: 'bank_account_not_default',
            },
            400
          );
        }
      } catch (bankAccountError) {
        console.error('[connect/transfer] failed to resolve/set destination bank account', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (bankAccountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not confirm your payout destination. Your balance has not been charged — please try again.',
            code: 'bank_account_resolution_failed',
          },
          503
        );
      }

      // Enforce hold: available = balance - balance_on_hold (pre-check; the
      // withdraw_balance RPC re-enforces this atomically under a row lock).
      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        console.warn('[connect/transfer] insufficient available balance', { userId, amount });
        return jsonResponse(
          {
            error:
              'Insufficient available balance. Part of your balance may be on hold or already reserved.',
            code: 'insufficient_balance',
          },
          400
        );
      }

      // One withdrawal in flight at a time — checked before any money moves so
      // the hunter is never left with a deducted balance and a rejected
      // request. See findInFlightWithdrawal().
      const transferInFlight = await findInFlightWithdrawal(supabase, userId);
      if (transferInFlight) {
        console.warn('[connect/transfer] blocked: withdrawal already in flight', {
          userId,
          existingTransactionId: transferInFlight.id,
        });
        return inFlightWithdrawalResponse(transferInFlight);
      }

      const reservationMetadata = {
        idempotency_key: idempotencyKey ?? null,
        destination_bank_account_id: destinationAccount.id,
        destination_bank_last4: destinationAccount.last4 ?? null,
        destination_bank_name: destinationAccount.bank_name ?? null,
      };
      const { data: reservation, error: reservationError } = await supabase
        .rpc('begin_legacy_withdrawal', {
          p_user_id: userId,
          p_amount: amount,
          p_description: 'Withdrawal to bank account',
          p_payout_method: 'standard',
          p_idempotency_key: idempotencyKey ?? null,
          p_stripe_connect_account_id: p.stripe_connect_account_id,
          p_instant_fee_amount: null,
          p_metadata: reservationMetadata,
        })
        .single();

      if (reservationError) {
        const violatedConstraint = `${(reservationError as { message?: string }).message ?? ''} ${
          (reservationError as { details?: string }).details ?? ''
        }`;
        if (
          (reservationError as { code?: string }).code === '23505' &&
          violatedConstraint.includes('idx_wallet_tx_one_pending_withdrawal')
        ) {
          const inFlight = await findInFlightWithdrawal(supabase, userId);
          return inFlightWithdrawalResponse(inFlight ?? { amount: -amount });
        }

        if ((reservationError as { code?: string }).code === '23505' && idempotencyKey) {
          const { data: winner } = await supabase
            .from('wallet_transactions')
            .select('id, stripe_transfer_id, stripe_payout_id, status, payout_method')
            .eq('user_id', userId)
            .eq('type', 'withdrawal')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

          const w = winner as
            | (WalletTransaction & { stripe_payout_id?: string; payout_method?: string })
            | null;
          return jsonResponse({
            transferId: w?.stripe_transfer_id ?? null,
            payoutId: w?.stripe_payout_id ?? null,
            payoutMethod: w?.payout_method ?? 'standard',
            status: w?.status ?? 'pending',
            amount,
            currency,
            accountId: p.stripe_connect_account_id,
            transactionId: w?.id,
            duplicate: true,
            estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            message: 'This withdrawal was already submitted and is being processed.',
          });
        }

        console.error('[connect/transfer] Error reserving withdrawal before transfer:', {
          userId,
          amount,
          error: reservationError.message,
        });
        const mapped = mapWithdrawBalanceError(reservationError.message);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      const reservedWithdrawal = reservation as { tx_id?: string | null; new_balance?: number | null } | null;
      const transactionId = reservedWithdrawal?.tx_id ?? null;
      const newBalance =
        typeof reservedWithdrawal?.new_balance === 'number' ? reservedWithdrawal.new_balance : null;

      let transfer: Stripe.Transfer;
      try {
        console.log('[connect/transfer] creating Stripe transfer', {
          userId,
          amountCents: validation.amountCents,
          accountId: p.stripe_connect_account_id,
        });
        transfer = await stripe.transfers.create(
          {
            amount: validation.amountCents,
            currency,
            destination: p.stripe_connect_account_id,
            metadata: {
              user_id: userId,
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          // Stripe-side idempotency: retries of the same client key with the
          // same amount cannot create a second transfer even if two requests
          // race past the DB replay check above.
          idempotencyKey
            ? {
                idempotencyKey: buildTransferIdempotencyKey({
                  userId,
                  clientKey: idempotencyKey,
                  amountCents: validation.amountCents,
                  purpose: 'standard',
                }),
              }
            : undefined
        );
      } catch (stripeError) {
        const errInfo = stripeError as { code?: string; type?: string; message?: string };
        console.error('[connect/transfer] Transfer creation failed, refunding balance:', {
          userId,
          amount,
          stripeCode: errInfo?.code,
          stripeType: errInfo?.type,
          message: errInfo?.message,
        });
        const { data: rollbackResult, error: refundError } = await supabase
          .rpc('fail_legacy_withdrawal', {
            p_transaction_id: transactionId,
            p_user_id: userId,
            p_stripe_transfer_id: null,
            p_stripe_payout_id: null,
            p_metadata_patch: {
              ...reservationMetadata,
              transfer_creation_failed: errInfo?.code ?? errInfo?.message ?? 'transfer_failed',
            },
          })
          .single();
        if (refundError || !(rollbackResult as { refunded?: boolean | null } | null)?.refunded) {
          logCritical(
            'balance refund after failed transfer also failed — manual reconciliation required',
            {
              userId,
              amount,
              error: refundError,
            }
          );
          // stripeAttempted: true on both exits from this catch block —
          // stripe.transfers.create() was actually called and rejected the
          // request; the refund-RPC failure is a second, independent problem
          // on top of that genuine provider failure, not a reason to treat it
          // as unattempted.
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
              stripeAttempted: true,
            },
            500
          );
        }
        const mapped = mapStripeTransferError(errInfo);
        return jsonResponse({ error: mapped.error, code: mapped.code, stripeAttempted: true }, mapped.status);
      }

      console.log('[connect/transfer] Stripe transfer created', {
        userId,
        transferId: transfer.id,
      });

      // The Transfer above is synchronous: by the time transfers.create()
      // returned, funds sit in the connected account's Stripe balance. That is
      // hop one of two. Hop two — the Payout that actually reaches the
      // hunter's bank — is created here.
      //
      // This route used to stop after hop one and write 'completed', reasoning
      // that no `transfer.paid` webhook exists to promote a pending row. That
      // is true and irrelevant: the event that matters is `payout.paid`, and
      // the way to receive it is to create a payout. Not doing so produced 13
      // withdrawals ($261.65) whose delivery nobody could verify.
      let standardPayout: Stripe.Payout | null = null;
      let standardPayoutError: string | null = null;
      try {
        standardPayout = await stripe.payouts.create(
          {
            amount: validation.amountCents,
            currency,
            method: 'standard',
            destination: destinationAccount.id,
            metadata: {
              user_id: userId,
              purpose: 'standard_withdrawal',
              transfer_id: transfer.id,
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          {
            stripeAccount: p.stripe_connect_account_id,
            idempotencyKey: idempotencyKey
              ? buildPayoutIdempotencyKey({
                  userId,
                  clientKey: idempotencyKey,
                  amountCents: validation.amountCents,
                  method: 'standard',
                })
              : undefined,
          }
        );
      } catch (payoutCreateError) {
        // Funds are in the connected account but no payout exists. Refunding
        // is wrong (the transfer did happen) and completing is wrong (nothing
        // was delivered), so the row stays `pending` with no payout id and
        // reconciliation raises it as CRITICAL.
        const pcInfo = payoutCreateError as { code?: string; message?: string };
        standardPayoutError = pcInfo?.code ?? pcInfo?.message ?? 'unknown';
        logCritical(
          'standard payout creation failed after transfer landed — funds are in the connected account with no payout, manual reconciliation required',
          { userId, transferId: transfer.id, amount, error: standardPayoutError }
        );
      }

      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .update({
          // Only payout.paid may promote this.
          payout_method: 'standard',
          stripe_transfer_id: transfer.id,
          stripe_payout_id: standardPayout?.id ?? null,
          metadata: {
            ...reservationMetadata,
            transfer_id: transfer.id,
            payout_id: standardPayout?.id ?? null,
            ...(standardPayoutError ? { payout_creation_failed: standardPayoutError } : {}),
          },
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (txError) {
        // The transfer already succeeded and the balance is correctly
        // deducted — only the history row failed. Do NOT surface an error
        // (the user's money IS on the way); log loudly for reconciliation.
        logCritical(
          'transfer succeeded but transaction record failed — manual reconciliation required',
          {
            userId,
            transferId: transfer.id,
            amount,
            error: txError,
          }
        );
        return jsonResponse({
          transferId: transfer.id,
          payoutId: standardPayout?.id ?? null,
          status: 'pending',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          newBalance,
          estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          message: 'Transfer initiated. Funds typically arrive in 1-2 business days.',
          warning: 'Transaction history may take a moment to update.',
        });
      }

      console.log('[connect/transfer] withdrawal submitted', {
        userId,
        transferId: transfer.id,
        payoutId: standardPayout?.id ?? null,
        transactionId: (transaction as WalletTransaction).id,
      });

      return jsonResponse({
        transferId: transfer.id,
        payoutId: standardPayout?.id ?? null,
        status: 'pending',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
        newBalance,
        estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        message: 'Transfer initiated. Funds typically arrive in 1-2 business days.',
      });
    }

    // POST /connect/retry-transfer
    if (subPath === '/retry-transfer') {
      if (CONNECT_TRANSFER_RETIRED) return legacyTransferRetiredResponse();
      const body = await req.json();
      const { transactionId } = body;
      // Optional: let the hunter pick a different destination on retry (e.g.
      // the original attempt failed because that bank account was invalid).
      // Falls back to the original transaction's recorded destination, then
      // to whatever Stripe currently has as default for rows created before
      // this fix existed — see resolveWithdrawalDestination() above.
      const requestedBankAccountId =
        typeof body.bankAccountId === 'string' && body.bankAccountId.trim()
          ? body.bankAccountId.trim()
          : undefined;

      if (!transactionId) {
        return jsonResponse({ error: 'Transaction ID is required' }, 400);
      }

      const { data: tx, error: txError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .eq('status', 'failed')
        .single();

      if (txError || !tx) {
        return jsonResponse({ error: 'Failed transaction not found' }, 404);
      }

      const t = tx as WalletTransaction;
      const retryCount =
        ((t.metadata as Record<string, unknown> | null)?.retry_count as number) ?? 0;
      if (retryCount >= 3) {
        return jsonResponse(
          {
            error: 'Maximum retry attempts reached. Please contact support.',
            maxRetriesReached: true,
          },
          400
        );
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, balance, balance_on_hold')
        .eq('id', userId)
        .single();

      const p = profile as Profile | null;
      if (!p?.stripe_connect_account_id) {
        return jsonResponse({ error: 'Stripe Connect account not found' }, 400);
      }

      const amount = Math.abs(t.amount);

      // Resolve/promote the destination bank account before touching the
      // balance — same logic and rationale as the primary /transfer path.
      const originalDestinationId = (t.metadata as Record<string, unknown> | null)
        ?.destination_bank_account_id;
      const effectiveRequestedBankAccountId =
        requestedBankAccountId ??
        (typeof originalDestinationId === 'string' ? originalDestinationId : undefined);

      let destinationAccount: ExternalAccountSummary;
      try {
        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'bank_account', limit: 100 }
        );
        const summaries: ExternalAccountSummary[] = externalAccounts.data.map(ba => ({
          id: ba.id,
          default_for_currency: (ba as unknown as { default_for_currency?: boolean })
            .default_for_currency,
          bank_name: (ba as unknown as { bank_name?: string }).bank_name ?? null,
          last4: (ba as unknown as { last4?: string }).last4 ?? null,
        }));

        const destination = resolveWithdrawalDestination(
          summaries,
          effectiveRequestedBankAccountId
        );
        if (!destination.ok) {
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }
        destinationAccount = destination.targetAccount;

        // Same fail-closed reasoning as /transfer above: updateExternalAccount
        // always fails for these accounts, so don't attempt it.
        if (destination.needsDefaultUpdate) {
          console.warn(
            '[connect/retry-transfer] selected bank account is not the default payout account',
            {
              userId,
              accountId: p.stripe_connect_account_id,
              bankAccountId: destinationAccount.id,
            }
          );
          return jsonResponse(
            {
              error:
                'This bank account is not your default payout method. Open your payout dashboard to set it as default, then try again.',
              code: 'bank_account_not_default',
            },
            400
          );
        }
      } catch (bankAccountError) {
        console.error('[connect] failed to resolve/set destination bank account during retry', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (bankAccountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not confirm your payout destination. Your balance has not been charged — please try again.',
            code: 'bank_account_resolution_failed',
          },
          503
        );
      }

      // Enforce hold: available = balance - balance_on_hold.
      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        return jsonResponse({ error: 'Insufficient balance for retry' }, 400);
      }

      const { error: retryReservationError } = await supabase
        .rpc('retry_failed_withdrawal', {
          p_transaction_id: transactionId,
          p_user_id: userId,
          p_amount: amount,
        })
        .single();

      if (retryReservationError) {
        const violatedConstraint = `${(retryReservationError as { message?: string }).message ?? ''} ${
          (retryReservationError as { details?: string }).details ?? ''
        }`;
        if (
          (retryReservationError as { code?: string }).code === '23505' &&
          violatedConstraint.includes('idx_wallet_tx_one_pending_withdrawal')
        ) {
          const inFlight = await findInFlightWithdrawal(supabase, userId);
          return inFlightWithdrawalResponse(inFlight ?? { amount: -amount });
        }

        if ((retryReservationError as { code?: string }).code === '23514') {
          return jsonResponse({ error: 'Insufficient balance for retry' }, 400);
        }

        console.error(
          '[connect] retry_failed_withdrawal RPC failed during transfer retry:',
          retryReservationError
        );
        return jsonResponse({ error: 'Failed to reserve balance for retry' }, 500);
      }

      let transfer: Stripe.Transfer;
      try {
        transfer = await stripe.transfers.create(
          {
            amount: Math.round(amount * 100),
            currency: 'usd',
            destination: p.stripe_connect_account_id,
            metadata: { user_id: userId, retry_of_transaction: transactionId },
          },
          // Stripe-side idempotency: a repeated retry of the same attempt
          // number for the same transaction cannot create a second transfer.
          { idempotencyKey: `retry_${transactionId}_${retryCount + 1}` }
        );
      } catch (stripeError) {
        console.error('[connect] Transfer creation failed, refunding balance:', stripeError);
        const retryErrInfo = stripeError as { code?: string; type?: string; message?: string };
        const { data: rollbackResult, error: retryRefundError } = await supabase
          .rpc('fail_legacy_withdrawal', {
            p_transaction_id: transactionId,
            p_user_id: userId,
            p_stripe_transfer_id: t.stripe_transfer_id ?? null,
            p_stripe_payout_id: (t as WalletTransaction & { stripe_payout_id?: string | null })
              .stripe_payout_id ?? null,
            p_metadata_patch: {
              ...((t.metadata as Record<string, unknown> | null) ?? {}),
              retry_transfer_failed: retryErrInfo?.code ?? retryErrInfo?.message ?? 'transfer_failed',
            },
          })
          .single();
        if (retryRefundError || !(rollbackResult as { refunded?: boolean | null } | null)?.refunded) {
          logCritical(
            'balance refund after failed retry transfer also failed — manual reconciliation required',
            {
              userId,
              amount,
              error: retryRefundError,
            }
          );
          // stripeAttempted: true on both exits — stripe.transfers.create()
          // was actually called and rejected the request. See the identical
          // rationale on the primary /transfer route above.
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
              stripeAttempted: true,
            },
            500
          );
        }
        const mapped = mapStripeTransferError(
          stripeError as { code?: string; type?: string; message?: string }
        );
        return jsonResponse({ error: mapped.error, code: mapped.code, stripeAttempted: true }, mapped.status);
      }

      // Same two-hop rule as the primary /transfer path: the retry re-ran hop
      // one, so create hop two and leave the row `pending` for payout.paid.
      let retryPayout: Stripe.Payout | null = null;
      let retryPayoutError: string | null = null;
      try {
        retryPayout = await stripe.payouts.create(
          {
            amount: Math.round(amount * 100),
            currency: 'usd',
            method: 'standard',
            destination: destinationAccount.id,
            metadata: {
              user_id: userId,
              purpose: 'standard_withdrawal_retry',
              transfer_id: transfer.id,
              retry_of_transaction: transactionId,
            },
          },
          {
            stripeAccount: p.stripe_connect_account_id,
            idempotencyKey: `wpo_retry_${transactionId}_${retryCount + 1}`,
          }
        );
      } catch (retryPayoutCreateError) {
        const rpInfo = retryPayoutCreateError as { code?: string; message?: string };
        retryPayoutError = rpInfo?.code ?? rpInfo?.message ?? 'unknown';
        logCritical(
          'standard payout creation failed on withdrawal retry — funds are in the connected account with no payout, manual reconciliation required',
          { userId, transferId: transfer.id, transactionId, amount, error: retryPayoutError }
        );
      }

      const { data: retriedTx, error: retriedTxError } = await supabase
        .from('wallet_transactions')
        .update({
          stripe_transfer_id: transfer.id,
          stripe_payout_id: retryPayout?.id ?? null,
          status: 'pending',
          metadata: {
            ...t.metadata,
            retry_count: retryCount + 1,
            retried_at: new Date().toISOString(),
            payout_id: retryPayout?.id ?? null,
            destination_bank_account_id: destinationAccount.id,
            destination_bank_last4: destinationAccount.last4 ?? null,
            destination_bank_name: destinationAccount.bank_name ?? null,
            ...(retryPayoutError ? { payout_creation_failed: retryPayoutError } : {}),
          },
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (retriedTxError) {
        logCritical(
          'retry transfer succeeded but transaction record failed — manual reconciliation required',
          {
            userId,
            transferId: transfer.id,
            payoutId: retryPayout?.id ?? null,
            transactionId,
            amount,
            error: retriedTxError,
          }
        );
        return jsonResponse({
          success: true,
          transferId: transfer.id,
          payoutId: retryPayout?.id ?? null,
          transactionId,
          status: 'pending',
          message: 'Transfer retry initiated successfully.',
          warning: 'Transaction history may take a moment to update.',
        });
      }

      console.log(
        `[connect] Transfer retry successful: ${transfer.id} for transaction ${transactionId}`
      );

      return jsonResponse({
        success: true,
        transferId: transfer.id,
        payoutId: retryPayout?.id ?? null,
        transactionId: (retriedTx as WalletTransaction | null)?.id ?? transactionId,
        status: 'pending',
        message: 'Transfer retry initiated successfully.',
      });
    }

    // POST /connect/instant-payout — Instant Cash Out to a linked debit card.
    // Deliberately a fresh, independent implementation rather than a refactor
    // of /transfer's internals (which are already audited/tested and out of
    // scope to touch here) — it duplicates the platform-Transfer step but
    // never shares code paths with /transfer, so nothing about that route's
    // existing behavior changes.
    // GET /connect/payouts — payout history read straight from Stripe (Phase 6).
    //
    // Stripe is the authority on what actually happened to the money, so the
    // list itself comes from stripe.payouts.list rather than from
    // wallet_transactions. The local rows are then matched in by payout id
    // purely to attach our own context (description, bounty linkage) and to
    // surface reconciliation drift: a payout Stripe knows about with no local
    // row, or a local row Stripe has no record of, is exactly the kind of
    // divergence the legacy ledger-derived history could never show.
    if (req.method === 'GET' && isPayoutsPath) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;

      if (!accountId) {
        return jsonResponse({ payouts: [], hasConnectAccount: false, unreconciled: [] });
      }

      const limitParam = Number(url.searchParams.get('limit') ?? '25');
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;

      let stripePayouts: Stripe.ApiList<Stripe.Payout>;
      try {
        stripePayouts = await stripe.payouts.list({ limit }, { stripeAccount: accountId });
      } catch (listError) {
        console.error('[connect/payouts] failed to list payouts', {
          userId,
          accountId,
          error: (listError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error: 'We could not load your withdrawal history from Stripe. Please try again.',
            code: 'stripe_unavailable',
          },
          503
        );
      }

      const payoutIds = stripePayouts.data.map(p => p.id);
      const { data: localRows } = await supabase
        .from('wallet_transactions')
        .select('id, stripe_payout_id, description, status, payout_method, created_at, bounty_id')
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .in('stripe_payout_id', payoutIds.length > 0 ? payoutIds : ['__none__']);

      const localByPayoutId = new Map<string, Record<string, unknown>>();
      for (const row of (localRows ?? []) as Array<Record<string, unknown>>) {
        const pid = row.stripe_payout_id;
        if (typeof pid === 'string') localByPayoutId.set(pid, row);
      }

      const payouts = stripePayouts.data.map(p => {
        const local = localByPayoutId.get(p.id);
        return {
          payoutId: p.id,
          // Stripe's status is authoritative: pending | in_transit | paid |
          // failed | canceled. The local row's status is reported separately
          // rather than merged, so drift stays visible instead of being
          // silently resolved in favour of one side.
          status: p.status,
          amountCents: p.amount,
          currency: p.currency,
          method: p.method,
          arrivalDate: p.arrival_date ?? null,
          createdAt: p.created,
          failureCode: p.failure_code ?? null,
          failureMessage: p.failure_message ?? null,
          destinationId:
            typeof p.destination === 'string' ? p.destination : (p.destination?.id ?? null),
          // Reconciliation fields.
          ledgerStatus: (local?.status as string) ?? null,
          transactionId: (local?.id as string) ?? null,
          bountyId: (local?.bounty_id as string) ?? null,
          description: (local?.description as string) ?? null,
          reconciled: !!local,
          statusMatchesLedger: local
            ? normalizePayoutStatusForLedger(p.status) === (local.status as string)
            : null,
        };
      });

      // Local withdrawal rows carrying a payout id Stripe did not return.
      // Usually just older than the page requested; genuinely orphaned rows
      // are a real reconciliation finding, which Phase 8 alerts on.
      const { data: recentLocal } = await supabase
        .from('wallet_transactions')
        .select('id, stripe_payout_id, status, amount, created_at')
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .not('stripe_payout_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      const stripeIdSet = new Set(payoutIds);
      const unreconciled = ((recentLocal ?? []) as Array<Record<string, unknown>>)
        .filter(
          r =>
            typeof r.stripe_payout_id === 'string' && !stripeIdSet.has(r.stripe_payout_id as string)
        )
        .map(r => ({
          transactionId: r.id as string,
          payoutId: r.stripe_payout_id as string,
          ledgerStatus: r.status as string,
          createdAt: r.created_at as string,
        }));

      console.log('[connect/payouts] history snapshot', {
        userId,
        accountId,
        stripeCount: payouts.length,
        unreconciledCount: unreconciled.length,
      });

      return jsonResponse({
        payouts,
        hasConnectAccount: true,
        unreconciled,
        lastUpdated: new Date().toISOString(),
      });
    }

    // POST /connect/payout — Connect-native standard withdrawal (Phase 5).
    // Pays out the settled balance already held in the connected account, so
    // the user never has to wait on Stripe's automatic schedule.
    if (subPath === '/payout') {
      if (!CONNECT_NATIVE_PAYOUTS) {
        return jsonResponse(
          {
            error:
              'This withdrawal method is not available yet. Please use the standard withdrawal option.',
            code: 'native_payouts_disabled',
          },
          503
        );
      }
      const payoutBody = await req.json();
      return await handleConnectNativePayout({
        stripe,
        supabase,
        userId,
        body: payoutBody as Record<string, unknown>,
        method: 'standard',
      });
    }

    if (subPath === '/instant-payout') {
      if (!INSTANT_CASHOUT_ENABLED) {
        return jsonResponse(
          {
            error:
              'Instant Cash Out is not currently available. Please use a standard bank withdrawal.',
            code: 'instant_cashout_disabled',
          },
          503
        );
      }

      // Connect-native path (Phase 4): spend the connected account's own
      // balance. Everything below this branch is the legacy ledger-backed
      // implementation, kept intact so the flag is a true rollback lever.
      if (CONNECT_NATIVE_PAYOUTS) {
        const nativeBody = await req.json();
        return await handleConnectNativePayout({
          stripe,
          supabase,
          userId,
          body: nativeBody as Record<string, unknown>,
          method: 'instant',
        });
      }

      const body = await req.json();

      const validation = validateWithdrawalRequest(body);
      if (!validation.ok) {
        console.warn('[connect/instant-payout] validation failed', {
          userId,
          code: validation.code,
        });
        return jsonResponse({ error: validation.error, code: validation.code }, 400);
      }
      const amount = validation.amount;
      const currency = 'usd';

      // Instant-specific ceiling — tighter than the shared MAX_WITHDRAWAL_USD.
      const instantAmountCheck = validateInstantAmount(amount);
      if (!instantAmountCheck.ok) {
        console.warn('[connect/instant-payout] amount above instant maximum', { userId, amount });
        return jsonResponse(
          { error: instantAmountCheck.error, code: instantAmountCheck.code },
          400
        );
      }

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 200)
          : undefined;

      const requestedCardId =
        typeof body.debitCardId === 'string' && body.debitCardId.trim()
          ? body.debitCardId.trim()
          : undefined;

      console.log('[connect/instant-payout] instant cash out requested', {
        userId,
        amount,
        hasIdempotencyKey: !!idempotencyKey,
        hasDebitCardId: !!requestedCardId,
      });

      // Idempotency replay — same DB-level pattern as /transfer, sharing the
      // (user_id, idempotency_key) unique index on wallet_transactions. A
      // client generates a fresh key per attempt (never reused across
      // /transfer and /instant-payout), so this is safe to share.
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from('wallet_transactions')
          .select(
            'id, stripe_transfer_id, stripe_payout_id, stripe_connect_account_id, amount, status, payout_method'
          )
          .eq('user_id', userId)
          .eq('type', 'withdrawal')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existing) {
          const e = existing as WalletTransaction & {
            stripe_connect_account_id?: string;
            stripe_payout_id?: string | null;
            payout_method?: string;
          };
          console.log('[connect/instant-payout] idempotent replay', {
            userId,
            transactionId: e.id,
          });
          const { data: replayProfile } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
          const replayBalance =
            typeof (replayProfile as { balance?: number } | null)?.balance === 'number'
              ? (replayProfile as { balance: number }).balance
              : null;
          return jsonResponse({
            transferId: e.stripe_transfer_id,
            payoutId: e.stripe_payout_id ?? null,
            payoutMethod: e.payout_method ?? 'standard',
            // Never default to 'completed': an unknown status is not a
            // settled one, and this response is what the client renders.
            status: e.status ?? 'pending',
            amount: Math.abs(e.amount),
            currency,
            accountId: e.stripe_connect_account_id,
            transactionId: e.id,
            newBalance: replayBalance,
            duplicate: true,
            message: 'This Instant Cash Out was already submitted and is being processed.',
          });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'balance, balance_on_hold, stripe_connect_account_id, stripe_connect_onboarded_at, stripe_connect_payouts_enabled, account_status'
        )
        .eq('id', userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404);
      }

      const p = profile as Profile;

      const accountEligibility = validateAccountEligibility(p.account_status);
      if (!accountEligibility.ok) {
        console.warn('[connect/instant-payout] blocked for account_status', {
          userId,
          accountStatus: p.account_status,
        });
        return jsonResponse(
          { error: accountEligibility.error, code: accountEligibility.code },
          403
        );
      }

      if (!p.stripe_connect_account_id || !p.stripe_connect_onboarded_at) {
        return jsonResponse(
          {
            error:
              'Your payout account is not set up yet. Please complete Stripe Connect onboarding before withdrawing.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      // stripe_connect_onboarded_at is set exactly once on the first transition
      // to fully-onboarded and is NEVER cleared (see
      // docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md), so the
      // gate above passes for a hunter who onboarded months ago and has since
      // become restricted. stripe_connect_payouts_enabled is the field the
      // account.updated / capability.updated webhooks keep live-synced, and it
      // is the one that answers "can this account receive a payout right now".
      //
      // /connect/transfer follows this with a live stripe.accounts.retrieve
      // check; this route had neither. ADR 0001 §4.3 item 4.
      if (p.stripe_connect_payouts_enabled !== true) {
        console.warn('[connect/instant-payout] payouts not enabled on profile', {
          userId,
          accountId: p.stripe_connect_account_id,
        });
        return jsonResponse(
          {
            error:
              'Payouts are not enabled on your account yet. Please finish your payout setup, then try again.',
            code: 'payouts_disabled',
          },
          400
        );
      }

      // Stripe caps instant payouts at 10/day per connected account — count
      // this hunter's completed instant withdrawals in the last rolling 24h
      // before touching the balance, same fail-closed discipline as the rest
      // of this route.
      // Counts every instant payout SUBMITTED in the window, not just settled
      // ones. Instant rows are now created `pending` and only reach
      // `completed` when payout.paid lands, so a `status = 'completed'` filter
      // here (the pre-2026-08-16 behaviour) would count almost nothing and let
      // a hunter blow straight through Stripe's 10/day ceiling. `failed` is
      // excluded because a payout that never delivered did not consume quota.
      const { count: instantPayoutsToday, error: instantCountError } = await supabase
        .from('wallet_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .eq('payout_method', 'instant')
        .neq('status', 'failed')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if (instantCountError) {
        console.error("[connect/instant-payout] failed to count today's instant payouts", {
          userId,
          error: instantCountError,
        });
        return jsonResponse(
          {
            error: 'We could not verify your Instant Cash Out eligibility. Please try again.',
            code: 'account_verification_failed',
          },
          503
        );
      }
      const dailyLimitCheck = checkInstantDailyLimit(instantPayoutsToday ?? 0);
      if (!dailyLimitCheck.ok) {
        console.warn('[connect/instant-payout] daily instant limit reached', {
          userId,
          count: instantPayoutsToday,
        });
        return jsonResponse({ error: dailyLimitCheck.error, code: dailyLimitCheck.code }, 429);
      }

      // Live payout eligibility + instant-eligible card resolution, before
      // touching the balance — same fail-closed discipline as /transfer.
      //
      // Deliberately NOT checked here: the connected account's pre-existing
      // balance.instant_available. This used to be checked at this point and
      // hard-blocked the request below Stripe's reported instant-eligible
      // balance was too low — but that balance is necessarily $0 (or
      // whatever residue is left over from a previous instant payout) for
      // every hunter who hasn't already completed a prior withdrawal: this
      // route's own Step 1 (below) is what moves money from the platform's
      // balance INTO the connected account, and that transfer hasn't
      // happened yet at this point in the request. Checking instant_available
      // here was checking a pre-transfer snapshot that structurally can
      // never reflect the money this exact request is about to move,
      // meaning the check always failed for first-time instant cash-outs —
      // this was the actual root cause of "Instant Payout remains
      // locked/disabled even after adding a debit card" (2026-07-21 audit).
      // The correct authority on instant-eligibility of the POST-transfer
      // balance is Stripe's own stripe.payouts.create call below, which the
      // catch block already handles gracefully by falling back to a
      // standard payout — no separate pre-check is needed or safe to add
      // back at this point in the flow.
      let destinationCard: InstantCardSummary;
      try {
        const account = await stripe.accounts.retrieve(p.stripe_connect_account_id);
        console.log('[connect/instant-payout] connected account state', {
          userId,
          accountId: p.stripe_connect_account_id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          currentlyDue: account.requirements?.currently_due ?? [],
          pendingVerification: account.requirements?.pending_verification ?? [],
          disabledReason: account.requirements?.disabled_reason ?? null,
        });
        if (!account.payouts_enabled) {
          console.warn('[connect/instant-payout] payouts disabled on connected account', {
            userId,
            accountId: p.stripe_connect_account_id,
            disabledReason: account.requirements?.disabled_reason ?? null,
            currentlyDue: account.requirements?.currently_due ?? [],
          });
          return jsonResponse(
            {
              error:
                'Payouts are currently disabled on your account. Please review and update your payout details, then try again.',
              code: 'payouts_disabled',
              disabledReason: account.requirements?.disabled_reason ?? null,
              requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
            },
            400
          );
        }

        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'card', limit: 100 }
        );
        const cards: InstantCardSummary[] = externalAccounts.data.map(c => ({
          id: c.id,
          brand: (c as unknown as { brand?: string }).brand ?? null,
          last4: (c as unknown as { last4?: string }).last4 ?? null,
          available_payout_methods:
            (c as unknown as { available_payout_methods?: string[] }).available_payout_methods ??
            null,
        }));
        console.log('[connect/instant-payout] external cards found', {
          userId,
          cardCount: cards.length,
          instantEligibleCardIds: cards
            .filter(
              c =>
                Array.isArray(c.available_payout_methods) &&
                c.available_payout_methods.includes('instant')
            )
            .map(c => c.id),
        });

        const destination = resolveInstantDestination(cards, requestedCardId);
        if (!destination.ok) {
          console.warn('[connect/instant-payout] destination resolution failed', {
            userId,
            code: destination.code,
          });
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }
        destinationCard = destination.targetCard;
        console.log('[connect/instant-payout] destination card resolved', {
          userId,
          cardId: destinationCard.id,
        });

        // Informational only (see comment above) — logged so a genuine
        // Stripe-side "insufficient instant balance" rejection from
        // payouts.create below can be cross-referenced against what the
        // account reported just before the transfer, without this value
        // ever gating the request.
        try {
          const preTransferBalance = await stripe.balance.retrieve({
            stripeAccount: p.stripe_connect_account_id,
          });
          const preTransferInstantAvailableCents =
            (preTransferBalance.instant_available as InstantAvailableWithNet[] | undefined)?.find(
              b => b.currency === 'usd'
            )?.net_available?.[0]?.amount ?? 0;
          console.log(
            '[connect/instant-payout] pre-transfer instant_available (informational only)',
            {
              userId,
              preTransferInstantAvailableCents,
            }
          );
        } catch (balanceLogError) {
          console.warn(
            '[connect/instant-payout] failed to fetch pre-transfer balance for logging',
            {
              userId,
              error: (balanceLogError as { message?: string })?.message,
            }
          );
        }
      } catch (accountError) {
        console.error('[connect/instant-payout] failed to verify connected account or cards', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (accountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not verify your Instant Cash Out eligibility. Your balance has not been charged — please try again.',
            code: 'account_verification_failed',
          },
          503
        );
      }

      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        console.warn('[connect/instant-payout] insufficient available balance', { userId, amount });
        return jsonResponse(
          {
            error:
              'Insufficient available balance. Part of your balance may be on hold or already reserved.',
            code: 'insufficient_balance',
          },
          400
        );
      }

      // One withdrawal in flight at a time — see findInFlightWithdrawal().
      const instantInFlight = await findInFlightWithdrawal(supabase, userId);
      if (instantInFlight) {
        console.warn('[connect/instant-payout] blocked: withdrawal already in flight', {
          userId,
          existingTransactionId: instantInFlight.id,
        });
        return inFlightWithdrawalResponse(instantInFlight);
      }

      const estimatedFeeCents = estimateInstantFeeCents(validation.amountCents);
      const instantReservationMetadata = {
        idempotency_key: idempotencyKey ?? null,
        destination_card_id: destinationCard.id,
        destination_card_last4: destinationCard.last4 ?? null,
        destination_card_brand: destinationCard.brand ?? null,
        estimated_fee_cents: estimatedFeeCents,
      };
      const { data: reservation, error: reservationError } = await supabase
        .rpc('begin_legacy_withdrawal', {
          p_user_id: userId,
          p_amount: amount,
          p_description: 'Instant Cash Out to debit card',
          p_payout_method: 'instant',
          p_idempotency_key: idempotencyKey ?? null,
          p_stripe_connect_account_id: p.stripe_connect_account_id,
          p_instant_fee_amount: estimatedFeeCents / 100,
          p_metadata: instantReservationMetadata,
        })
        .single();

      if (reservationError) {
        const violatedConstraint = `${(reservationError as { message?: string }).message ?? ''} ${
          (reservationError as { details?: string }).details ?? ''
        }`;
        if (
          (reservationError as { code?: string }).code === '23505' &&
          violatedConstraint.includes('idx_wallet_tx_one_pending_withdrawal')
        ) {
          const inFlight = await findInFlightWithdrawal(supabase, userId);
          return inFlightWithdrawalResponse(inFlight ?? { amount: -amount });
        }

        if ((reservationError as { code?: string }).code === '23505' && idempotencyKey) {
          const { data: winner } = await supabase
            .from('wallet_transactions')
            .select('id, stripe_transfer_id, stripe_payout_id, status, payout_method')
            .eq('user_id', userId)
            .eq('type', 'withdrawal')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

          const w = winner as
            | (WalletTransaction & { stripe_payout_id?: string; payout_method?: string })
            | null;
          return jsonResponse({
            transferId: w?.stripe_transfer_id ?? null,
            payoutId: w?.stripe_payout_id ?? null,
            payoutMethod: w?.payout_method ?? 'instant',
            status: w?.status ?? 'pending',
            amount,
            currency,
            accountId: p.stripe_connect_account_id,
            transactionId: w?.id,
            duplicate: true,
            message: 'This withdrawal was already submitted and is being processed.',
          });
        }

        console.error('[connect/instant-payout] Error deducting balance before transfer:', {
          userId,
          amount,
          error: reservationError.message,
        });
        const mapped = mapWithdrawBalanceError(reservationError.message);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      const reservedWithdrawal = reservation as { tx_id?: string | null; new_balance?: number | null } | null;
      const transactionId = reservedWithdrawal?.tx_id ?? null;
      const newBalance =
        typeof reservedWithdrawal?.new_balance === 'number' ? reservedWithdrawal.new_balance : null;

      // Step 1: move funds from the platform balance into the connected
      // account's Stripe balance — required before Stripe will let the
      // connected account pay any of it out, instant or otherwise.
      let transfer: Stripe.Transfer;
      try {
        console.log('[connect/instant-payout] creating platform transfer', {
          userId,
          amountCents: validation.amountCents,
          accountId: p.stripe_connect_account_id,
        });
        transfer = await stripe.transfers.create(
          {
            amount: validation.amountCents,
            currency,
            destination: p.stripe_connect_account_id,
            metadata: {
              user_id: userId,
              purpose: 'instant_cash_out',
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          idempotencyKey
            ? {
                idempotencyKey: buildTransferIdempotencyKey({
                  userId,
                  clientKey: idempotencyKey,
                  amountCents: validation.amountCents,
                  purpose: 'instant',
                }),
              }
            : undefined
        );
      } catch (stripeError) {
        const errInfo = stripeError as { code?: string; type?: string; message?: string };
        console.error('[connect/instant-payout] Transfer creation failed, refunding balance:', {
          userId,
          amount,
          stripeCode: errInfo?.code,
          message: errInfo?.message,
        });
        const { data: rollbackResult, error: refundError } = await supabase
          .rpc('fail_legacy_withdrawal', {
            p_transaction_id: transactionId,
            p_user_id: userId,
            p_stripe_transfer_id: null,
            p_stripe_payout_id: null,
            p_metadata_patch: {
              ...instantReservationMetadata,
              transfer_creation_failed: errInfo?.code ?? errInfo?.message ?? 'transfer_failed',
            },
          })
          .single();
        if (refundError || !(rollbackResult as { refunded?: boolean | null } | null)?.refunded) {
          logCritical(
            'balance refund after failed instant-payout transfer also failed — manual reconciliation required',
            {
              userId,
              amount,
              error: refundError,
            }
          );
          // stripeAttempted: true on both exits from this catch block —
          // stripe.transfers.create() was actually called and rejected the
          // request; the refund-RPC failure is a second, independent problem
          // on top of that genuine provider failure, not a reason to treat it
          // as unattempted.
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
              stripeAttempted: true,
            },
            500
          );
        }
        const mapped = mapStripeTransferError(errInfo);
        return jsonResponse({ error: mapped.error, code: mapped.code, stripeAttempted: true }, mapped.status);
      }

      console.log('[connect/instant-payout] platform transfer created', {
        userId,
        transferId: transfer.id,
      });

      // Step 2: request the actual instant payout FROM the connected
      // account's now-funded balance TO the debit card. Scoped via
      // { stripeAccount } — this Stripe call acts "as" the connected
      // account, unlike every other Stripe call in this file.
      let payout: Stripe.Payout;
      try {
        payout = await stripe.payouts.create(
          {
            amount: validation.amountCents,
            currency,
            method: 'instant',
            destination: destinationCard.id,
            metadata: {
              user_id: userId,
              transfer_id: transfer.id,
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          {
            stripeAccount: p.stripe_connect_account_id,
            idempotencyKey: idempotencyKey
              ? buildPayoutIdempotencyKey({
                  userId,
                  clientKey: idempotencyKey,
                  amountCents: validation.amountCents,
                  method: 'instant',
                })
              : undefined,
          }
        );
      } catch (payoutError) {
        // The platform Transfer above already succeeded, so the money is
        // sitting in the connected account's Stripe balance. That is NOT
        // payment and must never be recorded as one.
        //
        // This block used to insert `status: 'completed'` here on the theory
        // that Stripe's automatic payout schedule would sweep the funds out
        // eventually. That theory produced the 2026-08-13 incident: 13
        // withdrawals ($275) marked paid with no Stripe Payout behind them,
        // invisible to every control that keys off stripe_payout_id. Whether
        // the money later arrived depended entirely on account configuration
        // this code never reads, and on one hunter who knew to pay themselves
        // from the Stripe Express Dashboard.
        //
        // What happens instead: create the STANDARD payout ourselves, record
        // its id, and leave the row `pending` until payout.paid says the money
        // landed. A balance refund is still wrong here (the funds did move to
        // the connected account) — but so is claiming success.
        const errInfo = payoutError as { code?: string; type?: string; message?: string };
        const instantErrorCode = errInfo?.code ?? errInfo?.message ?? 'unknown';
        console.warn(
          '[connect/instant-payout] instant payout failed, creating standard payout instead',
          {
            userId,
            transferId: transfer.id,
            stripeCode: errInfo?.code,
            message: errInfo?.message,
          }
        );

        await writePayoutAudit(supabase, {
          userId,
          event: 'instant_payout_failed',
          payoutMethod: 'instant',
          amountCents: validation.amountCents,
          currency,
          idempotencyKey,
          stripeConnectAccountId: p.stripe_connect_account_id,
          errorCode: errInfo?.code ?? 'instant_payout_failed',
          errorMessage: errInfo?.message ?? null,
          detail: { transferId: transfer.id },
        });

        if (!isRecoverableInstantPayoutError(errInfo?.code)) {
          // The account or destination is the problem, not the delivery
          // speed. Retrying as `standard` would fail the same way. Leave the
          // row pending with no payout so reconciliation surfaces it, rather
          // than sending money at a destination Stripe just rejected.
          logCritical(
            'instant payout failed with a non-recoverable error after the transfer landed — funds are in the connected account with no payout',
            {
              userId,
              transferId: transfer.id,
              amount,
              stripeCode: errInfo?.code,
            }
          );
        }

        // Standard payout from the connected account's balance. Scoped via
        // { stripeAccount } so it acts AS the connected account, and keyed
        // deterministically so a retry replays instead of paying twice.
        let fallbackPayout: Stripe.Payout | null = null;
        let fallbackPayoutError: string | null = null;
        if (isRecoverableInstantPayoutError(errInfo?.code)) {
          try {
            fallbackPayout = await stripe.payouts.create(
              {
                amount: validation.amountCents,
                currency,
                method: 'standard',
                metadata: {
                  user_id: userId,
                  purpose: 'instant_cash_out_fallback',
                  transfer_id: transfer.id,
                  instant_payout_error: instantErrorCode,
                  ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
                },
              },
              {
                stripeAccount: p.stripe_connect_account_id,
                idempotencyKey: idempotencyKey
                  ? buildPayoutIdempotencyKey({
                      userId,
                      clientKey: idempotencyKey,
                      amountCents: validation.amountCents,
                      method: 'standard',
                    })
                  : undefined,
              }
            );
          } catch (fallbackError) {
            // Both payout attempts failed. The transfer still landed, so the
            // funds are recoverable — but nothing about this is "completed".
            // Leave the row pending with no payout id: reconciliation raises
            // `stale_pending_withdrawal` for it, which is exactly the loud
            // failure the old silent-success path denied us.
            const fbInfo = fallbackError as { code?: string; message?: string };
            fallbackPayoutError = fbInfo?.code ?? fbInfo?.message ?? 'unknown';
            logCritical(
              'standard payout fallback also failed — funds are in the connected account with no payout, manual reconciliation required',
              {
                userId,
                transferId: transfer.id,
                amount,
                instantError: instantErrorCode,
                standardError: fallbackPayoutError,
              }
            );
          }
        }

        const { data: fallbackTx, error: fallbackTxError } = await supabase
          .from('wallet_transactions')
          .update({
            description: 'Withdrawal to bank account (Instant Cash Out unavailable)',
            // NOT 'completed'. Only payout.paid may promote this row.
            payout_method: 'standard',
            stripe_transfer_id: transfer.id,
            stripe_payout_id: fallbackPayout?.id ?? null,
            metadata: {
              ...instantReservationMetadata,
              transfer_id: transfer.id,
              payout_id: fallbackPayout?.id ?? null,
              instant_payout_attempted_but_fell_back: true,
              instant_payout_error: instantErrorCode,
              ...(fallbackPayoutError ? { payout_creation_failed: fallbackPayoutError } : {}),
            },
          })
          .eq('id', transactionId)
          .select()
          .single();

        if (fallbackTxError) {
          // A payout may already exist at this point, so there is real money
          // in flight with no ledger row behind it. Never swallow this.
          logCritical(
            'fallback withdrawal row update failed — payout may exist with no ledger record, manual reconciliation required',
            {
              userId,
              transferId: transfer.id,
              payoutId: fallbackPayout?.id ?? null,
              amount,
              error: fallbackTxError,
            }
          );
        }

        await writePayoutAudit(supabase, {
          userId,
          event: fallbackPayout ? 'stripe_payout_created' : 'withdrawal_failed',
          payoutMethod: 'standard',
          amountCents: validation.amountCents,
          currency,
          idempotencyKey,
          stripeConnectAccountId: p.stripe_connect_account_id,
          stripePayoutId: fallbackPayout?.id ?? null,
          errorCode: fallbackPayoutError ?? null,
          detail: {
            transferId: transfer.id,
            fellBackFromInstant: true,
            instantError: instantErrorCode,
          },
        });

        return jsonResponse({
          transferId: transfer.id,
          payoutId: fallbackPayout?.id ?? null,
          payoutMethod: 'standard',
          status: 'pending',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          transactionId: (fallbackTx as WalletTransaction | null)?.id,
          newBalance,
          fellBackToStandard: true,
          message: fallbackPayout
            ? "Instant Cash Out isn't available for this card, so your withdrawal is on its way as a standard bank transfer. It typically arrives in 1-2 business days, and your balance was deducted only once."
            : "Your withdrawal is being processed. It's taking longer than usual to confirm with our payments provider — we're on it, and your balance was deducted only once.",
        });
      }

      console.log('[connect/instant-payout] instant payout created', {
        userId,
        payoutId: payout.id,
      });

      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .update({
          // A submitted payout is not a settled payout. Even an instant
          // payout can fail or be canceled after creation, so the row waits
          // for payout.paid like every other withdrawal. Instant payouts
          // typically settle within minutes, so this window is short — but it
          // is a real window, and pretending otherwise is what this whole
          // change exists to stop.
          stripe_transfer_id: transfer.id,
          stripe_payout_id: payout.id,
          metadata: {
            ...instantReservationMetadata,
            transfer_id: transfer.id,
            payout_id: payout.id,
          },
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (txError) {
        logCritical(
          'instant payout succeeded but transaction record failed — manual reconciliation required',
          {
            userId,
            transferId: transfer.id,
            payoutId: payout.id,
            amount,
            error: txError,
          }
        );
        return jsonResponse({
          transferId: transfer.id,
          payoutId: payout.id,
          payoutMethod: 'instant',
          status: 'pending',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          newBalance,
          message: 'Instant Cash Out initiated.',
          warning: 'Transaction history may take a moment to update.',
        });
      }

      console.log('[connect/instant-payout] instant payout submitted', {
        userId,
        transferId: transfer.id,
        payoutId: payout.id,
        transactionId: (transaction as WalletTransaction).id,
      });

      return jsonResponse({
        transferId: transfer.id,
        payoutId: payout.id,
        payoutMethod: 'instant',
        status: 'pending',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
        newBalance,
        estimatedFee: estimatedFeeCents / 100,
        message: 'Instant Cash Out sent. Funds typically arrive within minutes.',
      });
    }

    // GET /connect/bank-accounts — list external bank accounts on the Connect
    // account, plus the server-computed withdrawal limits/available balance
    // the withdraw screen renders. BUGFIX: this response previously returned
    // only `{ bankAccounts }`, but withdraw-with-bank-screen.tsx has always
    // read `minWithdrawal`/`maxWithdrawal`/`availableBalance` from it too —
    // those fields were silently always undefined, so the screen fell back
    // to a client-side default minimum, no maximum, and the wallet context's
    // cached balance instead of the real balance-minus-hold figure. Fixed by
    // actually returning the values this file already computes elsewhere.
    if (req.method === 'GET' && subPath === '/bank-accounts') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, balance, balance_on_hold')
        .eq('id', userId)
        .single();

      const p = profile as Profile | null;
      const accountId = p?.stripe_connect_account_id;
      const availableBalance = (p?.balance ?? 0) - (p?.balance_on_hold ?? 0);

      if (!accountId) {
        return jsonResponse({
          bankAccounts: [],
          minWithdrawal: MIN_WITHDRAWAL_USD,
          maxWithdrawal: MAX_WITHDRAWAL_USD,
          availableBalance,
        });
      }

      const accounts = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'bank_account',
        limit: 20,
      });
      const bankAccounts = accounts.data.map(ba => ({
        id: ba.id,
        bankName: (ba as unknown as { bank_name?: string }).bank_name ?? null,
        last4: ba.last4,
        routingNumber: (ba as unknown as { routing_number?: string }).routing_number ?? null,
        accountHolderName:
          (ba as unknown as { account_holder_name?: string }).account_holder_name ?? null,
        accountType: (ba as unknown as { account_type?: string }).account_type ?? null,
        default: ba.default_for_currency,
        status: ba.status,
      }));
      return jsonResponse({
        bankAccounts,
        minWithdrawal: MIN_WITHDRAWAL_USD,
        maxWithdrawal: MAX_WITHDRAWAL_USD,
        availableBalance,
      });
    }

    // GET /connect/debit-cards — list debit-card external accounts (Instant
    // Cash Out destinations only; never used for the standard automatic
    // payout sweep, see the default_for_currency note on POST below).
    //
    // Also returns instantAvailableCents (from balance.instant_available on
    // the CONNECTED account) — informational only, NOT used by the client to
    // gate/lock the Instant option. That balance is necessarily $0 (or
    // whatever residue a previous instant payout left behind) for any hunter
    // who hasn't already completed a prior withdrawal, because money only
    // moves into the connected account's Stripe balance at the moment
    // POST /connect/instant-payout runs its own transfer step — nothing
    // pre-funds it ahead of time. Gating card-eligibility UI on this figure
    // was the root cause of Instant Cash Out staying permanently
    // locked/disabled for first-time users even after linking an eligible
    // debit card (2026-07-21 audit) — see the comment in the
    // POST /connect/instant-payout handler for the full explanation.
    if (req.method === 'GET' && subPath === '/debit-cards') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        console.log('[connect/debit-cards] no connected account for user', { userId });
        return jsonResponse({
          debitCards: [],
          instantAvailableCents: 0,
          instantCashOutEnabled: INSTANT_CASHOUT_ENABLED,
        });
      }

      const cards = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'card',
        limit: 20,
      });
      const debitCards = cards.data.map(c => {
        const methods =
          (c as unknown as { available_payout_methods?: string[] }).available_payout_methods ?? [];
        return {
          id: c.id,
          brand: (c as unknown as { brand?: string }).brand ?? null,
          last4: (c as unknown as { last4?: string }).last4 ?? null,
          expMonth: (c as unknown as { exp_month?: number }).exp_month ?? null,
          expYear: (c as unknown as { exp_year?: number }).exp_year ?? null,
          availablePayoutMethods: methods,
          instantEligible: methods.includes('instant'),
        };
      });

      let instantAvailableCents = 0;
      try {
        const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
        instantAvailableCents =
          (balance.instant_available as InstantAvailableWithNet[] | undefined)?.find(
            b => b.currency === 'usd'
          )?.net_available?.[0]?.amount ?? 0;
      } catch (balanceError) {
        console.warn('[connect/debit-cards] failed to fetch instant_available balance', {
          userId,
          accountId,
          error: (balanceError as { message?: string })?.message,
        });
        // Non-fatal: the list of cards is still useful without this figure;
        // the client just can't pre-gate on instant balance this refresh.
      }

      console.log('[connect/debit-cards] eligibility snapshot', {
        userId,
        accountId,
        cardCount: debitCards.length,
        instantEligibleCardIds: debitCards.filter(c => c.instantEligible).map(c => c.id),
        instantAvailableCents,
      });

      return jsonResponse({
        debitCards,
        instantAvailableCents,
        instantCashOutEnabled: INSTANT_CASHOUT_ENABLED,
      });
    }

    // POST /connect/debit-cards — DEPRECATED.
    // Adding a debit card via a client-tokenized card token
    // (stripe.accounts.createExternalAccount) can never succeed: these
    // Connect accounts have controller.requirement_collection === "stripe",
    // so Stripe rejects the call with a permissions error unconditionally —
    // this is not a "payouts disabled" condition that can be worked around.
    // Debit cards must be added through Stripe's own hosted Express
    // Dashboard instead. Returns 410 Gone so clients can detect the
    // deprecation and migrate, matching the POST /bank-accounts pattern.
    if (req.method === 'POST' && subPath === '/debit-cards') {
      return jsonResponse(
        {
          error:
            'Adding a debit card here is no longer supported. Please add it securely through your Stripe payout dashboard.',
          code: 'debit_card_add_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410
      );
    }

    // DELETE /connect/debit-cards/:debitCardId — DEPRECATED, same reason as
    // POST /debit-cards above (stripe.accounts.deleteExternalAccount is
    // rejected unconditionally for these accounts).
    if (req.method === 'DELETE' && subPath.startsWith('/debit-cards/')) {
      return jsonResponse(
        {
          error:
            'Removing a debit card here is no longer supported. Please remove it through your Stripe payout dashboard.',
          code: 'debit_card_remove_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410
      );
    }

    // POST /connect/bank-accounts — DEPRECATED.
    // Manual bank-account entry (raw routing/account numbers) is no longer
    // supported. Clients must use Stripe Financial Connections instead via:
    //   POST /payments/create-financial-connections-session
    //   POST /payments/financial-connections-complete
    // Returns 410 Gone so older clients can detect the deprecation and migrate.
    if (req.method === 'POST' && subPath === '/bank-accounts') {
      return jsonResponse(
        {
          error:
            'Manual bank account entry is no longer supported. Please link your bank securely using Stripe Financial Connections.',
          code: 'manual_bank_entry_deprecated',
          migrate_to: '/functions/v1/payments/create-financial-connections-session',
        },
        410
      );
    }

    // DELETE /connect/bank-accounts/:bankAccountId — DEPRECATED.
    // stripe.accounts.deleteExternalAccount is rejected unconditionally for
    // these Connect accounts (controller.requirement_collection === "stripe").
    // Remove bank accounts through the Stripe payout dashboard instead.
    if (req.method === 'DELETE' && subPath.startsWith('/bank-accounts/')) {
      return jsonResponse(
        {
          error:
            'Removing a bank account here is no longer supported. Please remove it through your Stripe payout dashboard.',
          code: 'bank_account_remove_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410
      );
    }

    // POST /connect/bank-accounts/:bankAccountId/default — DEPRECATED.
    // stripe.accounts.updateExternalAccount is rejected unconditionally for
    // these Connect accounts. Set the default payout account through the
    // Stripe payout dashboard instead.
    if (
      req.method === 'POST' &&
      subPath.startsWith('/bank-accounts/') &&
      subPath.endsWith('/default')
    ) {
      return jsonResponse(
        {
          error:
            'Setting a default bank account here is no longer supported. Please set it through your Stripe payout dashboard.',
          code: 'bank_account_default_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410
      );
    }

    console.warn('[connect] unmatched route', { method: req.method, subPath, userId });
    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[connect edge fn] Error:', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});

/**
 * Returns the HTML document that is loaded inside a React Native WebView to
 * host Stripe Connect Embedded Components (onboarding / payments / payouts).
 *
 * Protocol (postMessage between WebView and RN):
 *   WebView -> RN:  { type: 'ready' }                     // page has loaded Connect.js
 *                   { type: 'exit' }                      // onExit from onboarding
 *                   { type: 'load_error', error: string } // Connect.js load failed
 *                   { type: 'log', level, message }       // console passthrough
 *                   { type: 'mounted' }                   // component mounted OK
 *   RN -> WebView:  { type: 'init', publishableKey, clientSecret,
 *                     component: 'onboarding' | 'payments' | 'payouts',
 *                     appearance?: object, locale?: string }
 *
 * The page never sees the Stripe secret key. The client_secret is short-lived
 * (≈ minutes) and scoped to a single connected account + component set.
 */
function renderEmbeddedPage(): string {
  // Branded dark emerald theme matching lib/theme.ts
  const defaultAppearance = {
    overlays: 'dialog',
    variables: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      colorPrimary: '#00912C',
      colorBackground: '#1a3d2e',
      colorText: '#fffef5',
      colorSecondaryText: 'rgba(255, 254, 245, 0.75)',
      colorBorder: 'rgba(0, 145, 44, 0.4)',
      colorDanger: '#ef4444',
      buttonPrimaryColorBackground: '#00912C',
      buttonPrimaryColorBorder: '#00912C',
      buttonPrimaryColorText: '#ffffff',
      buttonSecondaryColorBackground: '#2d5240',
      buttonSecondaryColorText: '#fffef5',
      buttonSecondaryColorBorder: 'rgba(0, 145, 44, 0.4)',
      formHighlightColorBorder: '#00912C',
      formAccentColor: '#00912C',
      actionPrimaryColorText: '#00912C',
      actionSecondaryColorText: 'rgba(255, 254, 245, 0.8)',
      badgeNeutralColorBackground: 'rgba(45, 82, 64, 0.85)',
      badgeNeutralColorText: '#fffef5',
      offsetBackgroundColor: '#2d5240',
      formBackgroundColor: 'rgba(45, 82, 64, 0.75)',
      borderRadius: '12px',
      buttonBorderRadius: '10px',
      formBorderRadius: '10px',
      badgeBorderRadius: '8px',
      overlayBorderRadius: '16px',
      spacingUnit: '9px',
      fontSizeBase: '15px',
    },
  };
  const appearanceJson = JSON.stringify(defaultAppearance);

  // NOTE: Escape `</` inside the string literal below if you add any.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover" />
<title>Bounty • Stripe Connect</title>
<style>
  html, body { margin: 0; padding: 0; background: #1a3d2e; color: #fffef5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; -webkit-font-smoothing: antialiased; }
  #root { padding: 16px 12px 48px; max-width: 720px; margin: 0 auto; }
  .state { display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 60vh; gap: 16px; text-align: center; padding: 24px; }
  .spinner { width: 36px; height: 36px; border-radius: 50%;
    border: 3px solid rgba(0,145,44,0.25); border-top-color: #00912C;
    animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: rgba(255,254,245,0.7); font-size: 14px; line-height: 1.5; }
  .err { color: #fecaca; background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.4); border-radius: 12px; padding: 16px;
    font-size: 14px; line-height: 1.5; max-width: 420px; }
  .retry { margin-top: 8px; background: #00912C; color: #fff; border: 0;
    border-radius: 10px; padding: 12px 20px; font-size: 15px; font-weight: 600;
    cursor: pointer; }
</style>
</head>
<body>
<div id="root">
  <div id="loading" class="state">
    <div class="spinner" aria-hidden="true"></div>
    <div class="muted">Loading secure Stripe session…</div>
  </div>
  <div id="container" style="display:none"></div>
  <div id="error" class="state" style="display:none">
    <div class="err" id="error-message">Something went wrong.</div>
    <button class="retry" id="retry-btn" type="button">Try again</button>
  </div>
</div>
<script>
  (function () {
    var DEFAULT_APPEARANCE = ${appearanceJson};
    var rn = (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
      ? function (obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (_) {} }
      : function () {};

    function show(id) {
      ['loading', 'container', 'error'].forEach(function (k) {
        var el = document.getElementById(k);
        if (el) el.style.display = (k === id) ? (k === 'container' ? 'block' : 'flex') : 'none';
      });
    }
    function showError(msg) {
      var el = document.getElementById('error-message');
      if (el) el.textContent = msg || 'Something went wrong.';
      show('error');
      rn({ type: 'load_error', error: msg });
    }

    ['log', 'warn', 'error'].forEach(function (level) {
      var orig = console[level];
      console[level] = function () {
        try {
          rn({ type: 'log', level: level, message: Array.prototype.slice.call(arguments).map(String).join(' ') });
        } catch (_) {}
        if (orig) orig.apply(console, arguments);
      };
    });

    window.addEventListener('error', function (ev) {
      rn({ type: 'log', level: 'error', message: 'window.error: ' + (ev && ev.message) });
    });

    document.getElementById('retry-btn').addEventListener('click', function () {
      rn({ type: 'retry' });
    });

    var initialized = false;
    function handleInit(payload) {
      if (initialized) return;
      if (!payload || !payload.publishableKey || !payload.clientSecret) {
        showError('Missing Stripe credentials.');
        return;
      }
      initialized = true;
      var component = payload.component || 'onboarding';
      var appearance = payload.appearance || DEFAULT_APPEARANCE;
      var locale = payload.locale || 'en-US';

      var loader =
        (window.StripeConnect && (window.StripeConnect.init || window.StripeConnect.loadConnectAndInitialize)) ||
        window.loadConnectAndInitialize;
      if (typeof loader !== 'function') {
        showError('Stripe Connect SDK failed to load.');
        return;
      }

      try {
        var instance = loader({
          publishableKey: payload.publishableKey,
          fetchClientSecret: function () { return Promise.resolve(payload.clientSecret); },
          appearance: { overlays: appearance.overlays || 'dialog', variables: appearance.variables || {} },
          locale: locale,
        });

        var container = document.getElementById('container');
        container.innerHTML = '';
        var el;
        if (component === 'payments') {
          el = instance.create('payments');
        } else if (component === 'payouts') {
          el = instance.create('payouts');
        } else {
          el = instance.create('account-onboarding');
          el.setOnExit(function () { rn({ type: 'exit' }); });
          el.setOnLoadError(function (e) {
            rn({ type: 'load_error', error: (e && e.error && e.error.message) || 'onboarding load error' });
          });
        }
        container.appendChild(el);
        show('container');
        rn({ type: 'mounted', component: component });
      } catch (e) {
        showError((e && e.message) || 'Failed to initialize Stripe Connect.');
      }
    }

    function onMessage(ev) {
      var data = ev && ev.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { return; }
      }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'init') handleInit(data);
    }
    // WebView delivers messages on both window and document depending on platform.
    window.addEventListener('message', onMessage);
    document.addEventListener('message', onMessage);

    function loadScript() {
      var s = document.createElement('script');
      s.src = 'https://connect-js.stripe.com/v1.0/connect.js';
      s.async = true;
      s.onload = function () { rn({ type: 'ready' }); };
      s.onerror = function () { showError('Could not reach Stripe. Check your connection.'); };
      document.head.appendChild(s);
    }
    loadScript();
  })();
</script>
</body>
</html>`;
}
