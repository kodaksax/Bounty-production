/**
 * Verification decision for POST /wallet/deposit.
 *
 * Extracted as a pure function so the money-path rules are unit testable
 * without standing up an edge function, Stripe or a database.
 *
 * The rule this enforces: the client may nominate a PaymentIntent id and
 * nothing else. The credited amount, the payment status, the currency and the
 * ownership of the payment are all read back from Stripe. Before this check
 * existed the endpoint credited `body.amount` for any string the caller
 * passed as `paymentIntentId`, so any authenticated user could mint arbitrary
 * wallet balance without paying anything.
 *
 * `apply_deposit` itself remains idempotent on `stripe_payment_intent_id`, so
 * a verified deposit that races the Stripe webhook is a safe no-op.
 */

/**
 * Stripe PaymentIntent ids are `pi_` followed by an alphanumeric id. Reject
 * anything else before spending a Stripe API call on it — an arbitrary unique
 * string must never reach the database as proof of payment.
 */
const PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9]{8,}$/;

/**
 * The wallet ledger is denominated in USD and `profiles.balance` has no
 * currency column, so a non-USD PaymentIntent must never be credited as if it
 * were dollars. POST /payments/create-intent still accepts eur/gbp for flows
 * that do not touch the wallet.
 */
export const WALLET_DEPOSIT_CURRENCY = 'usd';

export function isPaymentIntentId(value: unknown): value is string {
  return typeof value === 'string' && PAYMENT_INTENT_ID_PATTERN.test(value);
}

/** The subset of a Stripe PaymentIntent the deposit decision depends on. */
export interface DepositPaymentIntent {
  id: string;
  /** Smallest currency unit (cents). */
  amount: number;
  currency: string;
  status: string;
  metadata?: Record<string, string> | null;
}

export interface VerifyDepositParams {
  /** Authenticated user id, from the verified JWT — never from the body. */
  callerId: string;
  /** The PaymentIntent as retrieved from Stripe. Never client-supplied. */
  intent: DepositPaymentIntent;
  /** Optional `amount` from the request body. Logged on mismatch, never used. */
  requestedAmount?: unknown;
}

export type DepositRejectionEvent =
  | 'deposit_verification_failed'
  | 'deposit_payment_intent_not_succeeded'
  | 'deposit_payment_intent_user_mismatch';

export type VerifyDepositResult =
  | {
      ok: true;
      /** The amount to credit, in dollars, derived from Stripe. */
      amount: number;
      /** Set when the client asked for a different amount than Stripe charged. */
      amountMismatch?: { requested: number; verified: number };
    }
  | {
      ok: false;
      status: number;
      error: string;
      event: DepositRejectionEvent;
      /** Machine-readable reason for the security log. */
      reason: string;
    };

/**
 * Decide whether a retrieved PaymentIntent may credit `callerId`'s wallet, and
 * for how much. Every branch that returns `ok: false` must leave the ledger and
 * the balance untouched.
 */
export function verifyDepositPaymentIntent(params: VerifyDepositParams): VerifyDepositResult {
  const { callerId, intent, requestedAmount } = params;

  // B. It must have actually settled. requires_payment_method,
  //    requires_confirmation, requires_action, processing, canceled and every
  //    other state credit nothing — the webhook applies the deposit if and
  //    when the intent reaches `succeeded`.
  if (intent.status !== 'succeeded') {
    return {
      ok: false,
      status: 409,
      error: 'Payment has not completed',
      event: 'deposit_payment_intent_not_succeeded',
      reason: `status_${intent.status}`,
    };
  }

  // C. It must belong to the caller. metadata.user_id is the ownership
  //    mechanism already used by POST /payments/confirm and the webhook
  //    handler; it is stamped server-side at PaymentIntent creation and cannot
  //    be set by the client.
  const intentUserId = String(intent.metadata?.user_id ?? '');
  if (!intentUserId || intentUserId !== callerId) {
    return {
      ok: false,
      status: 403,
      error: 'Not authorized to apply this payment',
      event: 'deposit_payment_intent_user_mismatch',
      reason: intentUserId ? 'user_mismatch' : 'missing_intent_user_id',
    };
  }

  // Only wallet top-ups may credit the wallet. Bounty escrow intents settle
  // through bounty_payments, so crediting one here would hand the poster the
  // money twice.
  if (intent.metadata?.purpose !== 'wallet_deposit') {
    return {
      ok: false,
      status: 400,
      error: 'Payment is not a wallet deposit',
      event: 'deposit_verification_failed',
      reason: 'purpose_not_wallet_deposit',
    };
  }

  // E. Currency must be the one the wallet ledger is denominated in. Never
  //    silently convert.
  if (intent.currency !== WALLET_DEPOSIT_CURRENCY) {
    return {
      ok: false,
      status: 400,
      error: 'Unsupported payment currency',
      event: 'deposit_verification_failed',
      reason: 'unexpected_currency',
    };
  }

  // D. The credited amount comes from Stripe, never from the client.
  //    `amount` is in the smallest currency unit; the wallet ledger is in
  //    dollars, matching the /payments/confirm and webhook handlers.
  const amount = intent.amount / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid payment amount',
      event: 'deposit_verification_failed',
      reason: 'non_positive_stripe_amount',
    };
  }

  const requested = typeof requestedAmount === 'number' ? requestedAmount : Number(requestedAmount);
  // Not fatal — Stripe wins either way — but a gap is the exact signature of an
  // amount-manipulation attempt, so surface it to the caller for logging.
  const amountMismatch =
    Number.isFinite(requested) && Math.abs(requested - amount) > 0.005
      ? { requested, verified: amount }
      : undefined;

  return amountMismatch ? { ok: true, amount, amountMismatch } : { ok: true, amount };
}
