// Withdrawal request validation + Stripe error mapping for the
// /connect/transfer edge function.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports
// (same pattern as process-notification/push-receipts.ts).
//
// KEEP IN SYNC with the inlined copy in supabase/functions/connect/index.ts.

// `Deno` only exists in the Edge Function runtime — this module is also
// imported directly by Jest (Node) unit tests, where the global is absent.
// `typeof` is safe to use on an undeclared identifier; a direct reference
// would throw a ReferenceError under Jest.
function readEnvNumber(key: string, fallback: number): number {
  const raw = typeof Deno !== 'undefined' ? Deno.env.get(key) : undefined;
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  // Guard against a misconfigured (non-numeric) env value silently disabling
  // the limit entirely: `amount < NaN` and `amount > NaN` are both always
  // `false`, so an invalid override would remove the min/max check rather
  // than falling back to a safe default.
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Minimum withdrawal in USD — env-configurable via WITHDRAW_MIN_USD; defaults to 10. */
export const MIN_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MIN_USD', 10);

/** Maximum single withdrawal in USD (fraud/typo guard) — env-configurable via WITHDRAW_MAX_USD; defaults to 10000. */
export const MAX_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MAX_USD', 10000);

export interface WithdrawalValidationSuccess {
  ok: true;
  /** Amount normalized to 2 decimal places (whole cents). */
  amount: number;
  amountCents: number;
}

export interface WithdrawalValidationFailure {
  ok: false;
  error: string;
  code: string;
}

export type WithdrawalValidationResult =
  | WithdrawalValidationSuccess
  | WithdrawalValidationFailure;

/**
 * Validates a withdrawal request body ({ amount, currency }).
 * - amount must be a finite positive number
 * - amount is normalized to whole cents (rejects sub-cent precision)
 * - enforces MIN_WITHDRAWAL_USD and MAX_WITHDRAWAL_USD
 * - currency must be 'usd' (or omitted)
 */
export function validateWithdrawalRequest(body: {
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

/**
 * Maps a Stripe transfer-creation error to an actionable, human-readable
 * message safe to show to end users (no internal/PII details).
 */
export function mapStripeTransferError(err: {
  code?: string;
  type?: string;
  message?: string;
}): { error: string; code: string; status: number } {
  const code = err?.code ?? '';
  const type = err?.type ?? '';

  if (code === 'balance_insufficient') {
    // Platform Stripe balance is short — a platform-side problem, not the user's.
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

/**
 * Maps a withdraw_balance RPC failure to an actionable client error.
 * The RPC raises with messages containing 'frozen' (dispute freeze) or
 * 'Insufficient available balance' (hold-aware balance check).
 */
export function mapWithdrawBalanceError(message: string | undefined): {
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
//
// BACKGROUND: stripe.transfers.create({ destination: connectedAccountId })
// moves funds into the connected account's shared Stripe balance — it does
// NOT target a specific external bank account. Which bank account actually
// receives money is decided later, entirely by Stripe, based on whichever
// external account is currently `default_for_currency` on that connected
// account when Stripe's automatic payout schedule next sweeps the balance.
//
// Previously the withdraw screen let a hunter pick a bank account in the UI,
// but that selection was never communicated to Stripe and never promoted to
// `default_for_currency` — so Stripe would always pay out to whatever was
// already default, regardless of what was tapped. This is the confirmed root
// cause of "I withdrew to the wrong account" reports.
//
// FIX: the withdrawal request now carries the selected `bankAccountId`. This
// pure resolver decides, given the account's current list of external bank
// accounts and the requested id, which account should be the transfer's
// intended destination and whether index.ts needs to call
// stripe.accounts.updateExternalAccount(..., { default_for_currency: true })
// before creating the Transfer. The actual Stripe API calls stay in index.ts;
// this function is kept pure and dependency-free so the decision logic is
// unit-testable without mocking the Stripe SDK.
//
// RESIDUAL LIMITATION (cannot be fully closed without a bigger architectural
// change — see docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md):
// because Transfers land in a single shared connected-account balance and
// Stripe's automatic payout schedule sweeps that whole balance to whatever is
// default AT SWEEP TIME (not per-transfer), two withdrawals for the same user
// with different bank-account selections that both land before the next
// Stripe payout will still be swept together to a single account — the last
// selection to actually update `default_for_currency` wins for the combined
// balance. True per-withdrawal destination precision would require switching
// the connected accounts to Stripe's manual payout schedule and creating
// explicit `stripe.payouts.create({ destination })` calls per withdrawal,
// which is a materially larger architectural change and is documented as a
// recommendation, not implemented here.

export interface ExternalAccountSummary {
  id: string;
  default_for_currency?: boolean | null;
  bank_name?: string | null;
  last4?: string | null;
}

export type DestinationResolution =
  | {
      ok: true;
      targetAccount: ExternalAccountSummary;
      /** True if index.ts must call stripe.accounts.updateExternalAccount to promote targetAccount to default_for_currency before transferring. */
      needsDefaultUpdate: boolean;
    }
  | {
      ok: false;
      error: string;
      code: string;
    };

/**
 * Decides which external bank account a withdrawal should target.
 * - If the caller requested a specific bankAccountId, it must exist on the
 *   connected account (otherwise `bank_account_not_found`).
 * - If no bankAccountId was supplied (older client), falls back to whichever
 *   account Stripe already has marked default — no state is changed.
 */
export function resolveWithdrawalDestination(
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
    return { ok: true, targetAccount: requested, needsDefaultUpdate: !requested.default_for_currency };
  }

  // No explicit selection — preserve prior behavior (whatever Stripe already
  // has as default) rather than changing anything. Stripe always keeps
  // exactly one default_for_currency account when at least one external
  // account exists in practice; fall back to the first account so this stays
  // a total function even if that invariant were ever violated.
  const current = accounts.find(a => a.default_for_currency) ?? accounts[0];
  return { ok: true, targetAccount: current, needsDefaultUpdate: false };
}

export type AccountEligibilityResult = { ok: true } | { ok: false; error: string; code: string };

/**
 * Blocks self-service withdrawals (both standard and Instant Cash Out) for
 * accounts an admin has suspended or banned via profiles.account_status
 * (see 20260719030000_add_profiles_account_status.sql). That migration
 * shipped as plumbing-only and explicitly named "no withdrawal check reads
 * this column yet" as a known follow-up (docs/withdrawals/09-security-audit-findings-2026-07-19.md
 * finding #3) — this is that follow-up. Deliberately NOT applied to the
 * admin-withdrawals recovery tool (force_retry/manual_adjustment): paying
 * out a legitimately-earned balance to a suspended/banned user is a human
 * admin decision, not something this guard should block.
 */
export function validateAccountEligibility(
  accountStatus: string | null | undefined
): AccountEligibilityResult {
  if (accountStatus === 'suspended' || accountStatus === 'banned') {
    return {
      ok: false,
      error: 'Withdrawals are unavailable while your account is under review. Contact support for details.',
      code: 'account_not_eligible',
    };
  }
  return { ok: true };
}
