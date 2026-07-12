// Withdrawal request validation + Stripe error mapping for the
// /connect/transfer edge function.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports
// (same pattern as process-notification/push-receipts.ts).
//
// KEEP IN SYNC with the inlined copy in supabase/functions/connect/index.ts.

/** Minimum withdrawal in USD — keep in sync with lib/constants.ts MIN_WITHDRAWAL_AMOUNT. */
export const MIN_WITHDRAWAL_USD = 10;

/** Maximum single withdrawal in USD (fraud/typo guard). */
export const MAX_WITHDRAWAL_USD = 10000;

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
