/**
 * Charging the poster's saved card when they accept a hunter.
 *
 * The acceptance itself is unchanged: fn_accept_bounty_request reserves escrow
 * from the wallet in the same transaction as the hire. This module only makes
 * sure the wallet can cover it, by charging exactly the shortfall as an ordinary
 * wallet deposit, and takes that deposit back if the hire then fails.
 *
 * Dependencies are injected so these money rules run under Jest without an edge
 * runtime, Stripe or a database.
 */

import { liveRefunds, type RefundLike } from '../_shared/refund-reflection.ts';
import { verifyDepositPaymentIntent } from '../_shared/deposit-verification.ts';

/** Stripe refuses a USD charge under this. A smaller shortfall charges this; the rest stays in the wallet. */
export const STRIPE_MIN_CHARGE_CENTS = 50;

// Only the Stripe surface this flow uses, so tests can supply a small fake.
export interface FundingPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata?: Record<string, string> | null;
  latest_charge?: string | { id: string } | null;
}

export interface FundingStripe {
  paymentMethods: {
    retrieve(
      id: string
    ): Promise<{ id: string; type: string; customer?: string | { id: string } | null }>;
    list(params: {
      customer: string;
      type: 'card';
      limit: number;
    }): Promise<{ data: Array<{ id: string }> }>;
  };
  paymentIntents: {
    create(
      params: {
        amount: number;
        currency: string;
        customer: string;
        payment_method: string;
        off_session: true;
        confirm: true;
        metadata: Record<string, string>;
      },
      options: { idempotencyKey: string }
    ): Promise<FundingPaymentIntent>;
  };
  refunds: {
    create(
      params: { payment_intent: string; metadata: Record<string, string> },
      options: { idempotencyKey: string }
    ): Promise<{ id: string }>;
    list(params: { payment_intent: string; limit: number }): Promise<{ data: unknown[] }>;
  };
}

export interface AcceptFundingDeps {
  stripe: FundingStripe;
  /** Dollars. Reads fn_get_bounty_funding_requirement as the poster. Null when it has no answer. */
  getShortfall(bountyId: string): Promise<number | null>;
  getBountyStatus(bountyId: string): Promise<string | null>;
  getProfileCustomerId(userId: string): Promise<string | null>;
  getDefaultCardId(userId: string): Promise<string | null>;
  getRequestStatus(requestId: string): Promise<string | null>;
  applyDeposit(args: {
    userId: string;
    amount: number;
    paymentIntentId: string;
    metadata: Record<string, string>;
  }): Promise<void>;
  applyRefund(args: {
    userId: string;
    amount: number;
    refundId: string;
    chargeId: string | null;
    description: string;
    metadata: Record<string, string>;
  }): Promise<void>;
  /** Best-effort page to the team. Must not throw. */
  alertAdmins(alert: { title: string; body: string; bountyId: string | null }): Promise<void>;
  log: {
    warn(message: string, details?: unknown): void;
    error(message: string, details?: unknown): void;
  };
}

export interface AcceptFundingInput {
  requestId: string;
  bountyId: string;
  posterId: string;
}

export type AcceptFundingResult =
  /** No charge was attempted. fn_accept_bounty_request decides, as it always has. */
  | { kind: 'not_charged' }
  /** The wallet now holds the deposit. Go on to accept. */
  | { kind: 'charged'; paymentIntentId: string; chargeId: string | null; amount: number }
  /** Nothing was accepted, and this attempt moved no money. Offer the top-up. */
  | { kind: 'card_failed'; reason: string }
  /** Another tap is creating this same charge right now. */
  | { kind: 'in_progress' }
  /** A charge may exist but is not confirmed in the wallet. Retrying is safe. */
  | { kind: 'unavailable'; reason: string };

/**
 * Whether this accept may charge a saved card. Only an explicit false turns it
 * off, so the flag can only ever stop a charge, and a caller that doesn't send it
 * (poster-web) gets the charge. A request that is no longer pending is left to
 * the RPC, which answers with the same 409 as always and charges nothing.
 */
export function mayChargeCard(requestStatus: unknown, allowCardCharge: unknown): boolean {
  return requestStatus === 'pending' && allowCardCharge !== false;
}

/** Banned is stricter than suspended, so it is refused too; a missing row is left to the RPC. */
export function blockedAccountCode(
  status: string | null
): 'account_suspended' | 'account_banned' | null {
  if (status === 'suspended') return 'account_suspended';
  if (status === 'banned') return 'account_banned';
  return null;
}

/** Wallet amounts are dollars with at most 2 decimals; rounds up so a float can never under-charge. */
export function shortfallToCents(shortfallDollars: number): number {
  return Math.ceil(Number((shortfallDollars * 100).toFixed(4)));
}

/**
 * A PostgREST error carrying a Postgres `code` means the transaction rolled back.
 * A 4xx never reached a commit. Anything else (network failure, gateway timeout,
 * a bare 5xx) may have committed after the connection was lost, so the outcome
 * is unknown and no money may be returned on the strength of it.
 */
export function isDefinitiveAcceptFailure(status: number, body: string): boolean {
  if (status >= 400 && status < 500) return true;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.code === 'string' && parsed.code.length > 0;
  } catch {
    return false;
  }
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * The card to charge, as (customer, payment method). The saved row is only a
 * hint: payment_methods is client-writable under RLS and known to go stale, so
 * a card is used only if Stripe says it belongs to the poster's own customer.
 * Trusting pm.customer alone would let a poster insert someone else's pm_ id and
 * have that person's card fund their wallet.
 */
async function resolveCard(
  deps: AcceptFundingDeps,
  posterId: string
): Promise<{ customer: string; paymentMethod: string } | null> {
  const customer = await deps.getProfileCustomerId(posterId);
  if (!customer) return null;

  const savedId = await deps.getDefaultCardId(posterId);
  if (savedId) {
    try {
      const pm = await deps.stripe.paymentMethods.retrieve(savedId);
      if (pm.type === 'card' && idOf(pm.customer) === customer) {
        return { customer, paymentMethod: pm.id };
      }
    } catch (err) {
      deps.log.warn(
        'accept-bounty-request: saved card could not be read, trying the customer list',
        {
          message: (err as { message?: string })?.message,
        }
      );
    }
  }

  const listed = await deps.stripe.paymentMethods.list({ customer, type: 'card', limit: 1 });
  const first = listed.data[0];
  return first ? { customer, paymentMethod: first.id } : null;
}

/**
 * Charges the shortfall and credits the wallet, when there is one and a card to
 * charge. Anything short of a confirmed charge leaves the current behaviour.
 */
export async function fundAcceptanceFromCard(
  deps: AcceptFundingDeps,
  input: AcceptFundingInput
): Promise<AcceptFundingResult> {
  const { requestId, bountyId, posterId } = input;

  let card: { customer: string; paymentMethod: string } | null;
  let cents: number;
  try {
    const shortfall = await deps.getShortfall(bountyId);
    if (shortfall === null || !(shortfall > 0)) return { kind: 'not_charged' };

    // Refunding a hire that was never possible would cost the Stripe fee.
    if ((await deps.getBountyStatus(bountyId)) !== 'open') return { kind: 'not_charged' };

    cents = Math.max(shortfallToCents(shortfall), STRIPE_MIN_CHARGE_CENTS);
    card = await resolveCard(deps, posterId);
  } catch (err) {
    deps.log.warn(
      'accept-bounty-request: could not prepare a card charge, leaving it to the wallet',
      {
        requestId,
        message: (err as { message?: string })?.message,
      }
    );
    return { kind: 'not_charged' };
  }

  if (!card) return { kind: 'not_charged' };
  if (cents < STRIPE_MIN_CHARGE_CENTS)
    return { kind: 'card_failed', reason: 'below_stripe_minimum' };

  const metadata = {
    purpose: 'wallet_deposit',
    user_id: posterId,
    bounty_id: bountyId,
    request_id: requestId,
  };

  let intent: FundingPaymentIntent;
  try {
    intent = await deps.stripe.paymentIntents.create(
      {
        amount: cents,
        currency: 'usd',
        customer: card.customer,
        payment_method: card.paymentMethod,
        off_session: true,
        confirm: true,
        metadata,
      },
      { idempotencyKey: `fund_${requestId}_${card.paymentMethod}_${cents}` }
    );
  } catch (err) {
    return classifyChargeError(deps, requestId, err);
  }

  if (intent.status !== 'succeeded') {
    // 'processing' settles later and the webhook credits it then.
    return { kind: 'card_failed', reason: `status_${intent.status}` };
  }

  // A Stripe idempotency replay returns the original 'succeeded' response even
  // after we refunded that charge. Re-crediting is a no-op, so without this
  // check a retry would see a successful charge and a wallet without the money.
  try {
    const { data } = await deps.stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
    if (liveRefunds(data as RefundLike[]).length > 0) {
      return { kind: 'card_failed', reason: 'previous_charge_refunded' };
    }
  } catch (err) {
    deps.log.warn('accept-bounty-request: could not check refunds on the charge', {
      requestId,
      paymentIntentId: intent.id,
      message: (err as { message?: string })?.message,
    });
    return { kind: 'unavailable', reason: 'refund_check_failed' };
  }

  const verified = verifyDepositPaymentIntent({ callerId: posterId, intent });
  if (!verified.ok) {
    deps.log.error('accept-bounty-request: charge failed deposit verification', {
      requestId,
      paymentIntentId: intent.id,
      reason: verified.reason,
    });
    return { kind: 'unavailable', reason: verified.reason };
  }

  try {
    await deps.applyDeposit({
      userId: posterId,
      amount: verified.amount,
      paymentIntentId: intent.id,
      metadata,
    });
  } catch (err) {
    // The money is real and payment_intent.succeeded will credit it, so a retry
    // finds it in the wallet. Refunding here would race that webhook.
    deps.log.error('accept-bounty-request: charge succeeded but apply_deposit failed', {
      requestId,
      paymentIntentId: intent.id,
      message: (err as { message?: string })?.message,
    });
    return { kind: 'unavailable', reason: 'deposit_not_applied' };
  }

  return {
    kind: 'charged',
    paymentIntentId: intent.id,
    chargeId: idOf(intent.latest_charge),
    amount: verified.amount,
  };
}

function classifyChargeError(
  deps: AcceptFundingDeps,
  requestId: string,
  err: unknown
): AcceptFundingResult {
  const e = err as { type?: string; code?: string; statusCode?: number; message?: string };

  // By code and status, not type: Stripe reports this as a
  // StripeInvalidRequestError (seen in the sandbox), and reading it as a refusal
  // would tell a poster their card failed while the other tap's charge goes through.
  if (e.code === 'idempotency_key_in_use' || e.statusCode === 409) {
    return { kind: 'in_progress' };
  }
  // Declines and authentication_required are StripeCardError. A detached card or
  // a changed shortfall on the same key are 400s that create no charge.
  if (e.type === 'StripeCardError' || e.statusCode === 402) {
    return { kind: 'card_failed', reason: e.code ?? 'card_error' };
  }
  if (e.type === 'StripeIdempotencyError' || e.type === 'StripeInvalidRequestError') {
    deps.log.warn('accept-bounty-request: charge refused by Stripe', {
      requestId,
      type: e.type,
      code: e.code,
    });
    return { kind: 'card_failed', reason: e.code ?? 'invalid_request' };
  }
  // Network errors and 5xx: Stripe may have charged. The same key finds out.
  deps.log.error('accept-bounty-request: charge outcome unknown', {
    requestId,
    type: e.type,
    message: e.message,
  });
  return { kind: 'unavailable', reason: 'charge_outcome_unknown' };
}

export type UnwindOutcome =
  | 'refunded'
  /** A concurrent tap's hire committed, and its escrow is spending this deposit. */
  | 'kept_request_accepted'
  /** The hire may have committed, or we could not tell. The money stays in the wallet. */
  | 'kept_outcome_unknown'
  /** Stripe refused or could not be reached. The money stays in the wallet. */
  | 'kept_refund_failed'
  /** Stripe refunded it. charge.refunded retries the ledger entry, keyed on the refund id. */
  | 'refunded_ledger_pending';

/**
 * The charge succeeded and the hire did not. Returns the money, unless the money
 * turns out to be in use.
 */
export async function unwindChargeAfterFailedAccept(
  deps: AcceptFundingDeps,
  args: {
    requestId: string;
    posterId: string;
    charge: { paymentIntentId: string; chargeId: string | null; amount: number };
    bountyId?: string | null;
    rpcStatus: number;
    rpcBody: string;
  }
): Promise<UnwindOutcome> {
  const { requestId, posterId, charge, rpcStatus, rpcBody } = args;
  const context = { requestId, posterId, paymentIntentId: charge.paymentIntentId };

  if (!isDefinitiveAcceptFailure(rpcStatus, rpcBody)) {
    deps.log.error(
      'accept-bounty-request: acceptance outcome unknown, keeping the deposit',
      context
    );
    return 'kept_outcome_unknown';
  }

  let requestStatus: string | null;
  try {
    requestStatus = await deps.getRequestStatus(requestId);
  } catch {
    requestStatus = null;
  }
  if (requestStatus === 'accepted') return 'kept_request_accepted';
  if (requestStatus === null) {
    deps.log.error(
      'accept-bounty-request: could not re-read the request, keeping the deposit',
      context
    );
    return 'kept_outcome_unknown';
  }

  let refundId: string;
  try {
    const refund = await deps.stripe.refunds.create(
      {
        payment_intent: charge.paymentIntentId,
        metadata: { purpose: 'accept_funding_reversal', request_id: requestId },
      },
      { idempotencyKey: `fund_refund_${charge.paymentIntentId}` }
    );
    refundId = refund.id;
  } catch (err) {
    deps.log.error('accept-bounty-request: refund failed, the deposit stays in the wallet', {
      ...context,
      message: (err as { message?: string })?.message,
    });
    return 'kept_refund_failed';
  }

  try {
    await deps.applyRefund({
      userId: posterId,
      amount: -charge.amount,
      refundId,
      chargeId: charge.chargeId,
      description: 'Refund: hire did not complete',
      metadata: { refund_id: refundId, request_id: requestId, refund_reason: 'accept_failed' },
    });
  } catch (err) {
    const message = (err as { message?: string; code?: string })?.message;
    deps.log.error('accept-bounty-request: refund issued but apply_refund failed', {
      ...context,
      refundId,
      message,
    });
    // The card has the money back and the wallet may still show it. Usually
    // charge.refunded fixes this; the balance having been spent in the meantime
    // (a concurrent hire) cannot fix itself, and needs a person. Ids only.
    await deps.alertAdmins({
      title: 'Refund not reversed from wallet after a failed hire',
      body:
        `Stripe refund ${refundId} was issued but apply_refund failed: ${
          message ?? 'unknown error'
        }. ` +
        `Payment intent ${charge.paymentIntentId}, request ${requestId}, poster ${posterId}, ` +
        `amount $${charge.amount.toFixed(
          2
        )}. Check the poster's balance and whether a hire used this deposit.`,
      bountyId: args.bountyId ?? null,
    });
    return 'refunded_ledger_pending';
  }

  return 'refunded';
}
