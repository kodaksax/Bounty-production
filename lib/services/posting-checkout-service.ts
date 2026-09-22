/**
 * Client surface for the pre-publish posting checkout (the $1 service fee
 * experiment — see lib/experiments/posting-fee-variant.ts).
 *
 * WHAT THIS CHARGES
 * -----------------
 * One Stripe PaymentIntent covering the flat posting service fee AND the full
 * bounty reward, collected BEFORE the bounty row is created. On settlement the
 * server splits it: the reward is credited to the poster's custodial wallet
 * (and is then escrowed by the ordinary `at_post` trigger when the bounty is
 * inserted), while the fee is recorded as platform revenue and deliberately
 * never credited to the wallet.
 *
 * Every amount is decided by the server. The client names only the reward it
 * is already displaying, and the fee comes from the edge function's own
 * constant — so this module cannot change the price, only refuse to use the
 * flow. `POSTING_FEE_CENTS` in lib/constants/posting-fee.ts exists purely to
 * itemise the total before the round-trip, and `assertServerTotalsMatch` below
 * turns any drift between the two into a loud failure instead of a silent
 * overcharge.
 *
 * WHY THE ATTEMPT ID MATTERS
 * --------------------------
 * `postingAttemptId` is a uuid the composer generates once and keeps for the
 * whole posting attempt, across retries, remounts and app restarts. It is the
 * UNIQUE key of `bounty_posting_checkouts` and the seed of the Stripe
 * idempotency key, which together make a duplicate charge structurally
 * impossible rather than merely unlikely:
 *
 *   * double-tap / remount  -> same attempt id -> same PaymentIntent
 *   * retry after a timeout -> same attempt id -> same PaymentIntent
 *   * publish failed after
 *     a settled checkout    -> paid-but-unconsumed row is reused, not recharged
 *
 * This is deliberately NOT built on generateStripeIdempotencyKey() from
 * payment-error-handler.ts: that key is nonce-based on purpose (so Stripe
 * cannot dedupe two legitimate deposits of the same size), which means it
 * cannot protect against a lost response — exactly the case that matters here.
 */

import { supabase } from 'lib/supabase';
import { invokePayments } from 'lib/services/stripe-internal';
import { logger } from 'lib/utils/error-logger';
import { POSTING_FEE_CENTS } from 'lib/constants/posting-fee';

/** Lifecycle of a checkout row, mirroring the DB check constraint. */
export type PostingCheckoutStatus =
  | 'pending'
  | 'paid'
  | 'consumed'
  | 'failed'
  | 'canceled'
  | 'refunded';

export interface PostingCheckoutIntent {
  /** True when this attempt was ALREADY paid — do not charge, just publish. */
  alreadyPaid: boolean;
  /** Absent when alreadyPaid is true. */
  clientSecret?: string;
  paymentIntentId?: string;
  status?: string;
  feeCents: number;
  rewardCents: number;
  totalCents: number;
}

export interface PostingCheckoutSettlement {
  status: PostingCheckoutStatus | 'pending';
  paid: boolean;
  /** True when the charge is still settling asynchronously (ACH, some wallets). */
  processing?: boolean;
  paymentIntentId?: string;
  feeCents?: number;
  rewardCents?: number;
  /** Short machine-readable failure label, never a raw Stripe message. */
  code?: string;
}

export interface ReusablePostingCheckout {
  postingAttemptId: string;
  status: PostingCheckoutStatus;
  feeCents: number;
  rewardCents: number;
  totalCents: number;
  createdAt: string;
}

/**
 * Mint an attempt id. Called ONCE per posting attempt by the composer, which
 * then holds it for the life of that attempt — see the header for why
 * regenerating it would reintroduce the double-charge risk this prevents.
 */
export function createPostingAttemptId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual construction below.
  }
  // RFC-4122 v4 shape, built by hand for runtimes without crypto.randomUUID.
  // The server validates the shape, so it has to be a real v4 layout rather
  // than an arbitrary random string.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/**
 * Refuse to proceed if the server itemised the checkout differently from what
 * the poster was shown.
 *
 * The poster has just read "$1.00 service fee" and a total on screen and is
 * about to authorise a card. If the server's split disagrees with the client's
 * constant — a half-deployed release, a tuned server constant, a stale build —
 * the honest outcome is a hard failure the poster can retry, not silently
 * charging a number they never saw.
 */
export function assertServerTotalsMatch(
  intent: Pick<PostingCheckoutIntent, 'feeCents' | 'rewardCents' | 'totalCents'>,
  expectedRewardCents: number
): void {
  const problems: string[] = [];
  if (intent.feeCents !== POSTING_FEE_CENTS) {
    problems.push(`fee ${intent.feeCents} != ${POSTING_FEE_CENTS}`);
  }
  if (intent.rewardCents !== expectedRewardCents) {
    problems.push(`reward ${intent.rewardCents} != ${expectedRewardCents}`);
  }
  if (intent.totalCents !== intent.feeCents + intent.rewardCents) {
    problems.push(`total ${intent.totalCents} != ${intent.feeCents} + ${intent.rewardCents}`);
  }
  if (problems.length > 0) {
    logger.error('[PostingCheckout] server/client total mismatch', { problems });
    throw Object.assign(
      new Error("This bounty's total changed. Please review the amount and try again."),
      { code: 'posting_checkout_total_mismatch' }
    );
  }
}

/**
 * Open (or re-open) the checkout for this posting attempt.
 *
 * Returns `alreadyPaid: true` when this attempt has already been charged, in
 * which case the caller must skip the payment sheet entirely and go straight
 * to publishing. That is the interrupted-checkout path: the poster paid, the
 * app died before the bounty was created, and they came back.
 */
export async function openPostingCheckout(params: {
  postingAttemptId: string;
  rewardCents: number;
  paymentMethodId?: string;
  accessToken?: string;
}): Promise<PostingCheckoutIntent> {
  const { postingAttemptId, rewardCents, paymentMethodId, accessToken } = params;

  const result = await invokePayments<PostingCheckoutIntent>(
    'payments/posting-checkout/intent',
    {
      body: {
        postingAttemptId,
        rewardAmountCents: rewardCents,
        ...(paymentMethodId ? { paymentMethodId } : {}),
      },
      ...(accessToken ? { accessToken } : {}),
    }
  );

  assertServerTotalsMatch(result, rewardCents);
  return result;
}

/**
 * Verify the charge with Stripe and split it (reward -> wallet, fee ->
 * platform revenue). Safe to call more than once: the server dedupes on the
 * PaymentIntent id, so a retry after a dropped response is a no-op rather than
 * a second credit.
 *
 * The caller MUST NOT publish unless this resolves with `paid: true`. A
 * `processing: true` result means the money has not landed yet.
 */
export async function settlePostingCheckout(params: {
  postingAttemptId: string;
  accessToken?: string;
}): Promise<PostingCheckoutSettlement> {
  const { postingAttemptId, accessToken } = params;

  return invokePayments<PostingCheckoutSettlement>('payments/posting-checkout/settle', {
    body: { postingAttemptId },
    ...(accessToken ? { accessToken } : {}),
  });
}

/**
 * Find a paid-but-unconsumed checkout for this poster, so an interrupted
 * attempt is reused instead of re-charged.
 *
 * Read through RLS (`posting_checkouts_select_own`) rather than an edge
 * function, because it is a plain read of the poster's own rows and adding a
 * route for it would be surface for no benefit.
 *
 * Returns null on ANY failure, including a missing table on an environment
 * where the migration has not been applied. That is the safe direction: the
 * caller then treats it as "no prior payment" and opens a checkout, where the
 * attempt-id/idempotency-key machinery still prevents a double charge. A read
 * failure must never be the reason a poster cannot post.
 */
export async function findReusablePaidCheckout(
  posterId: string
): Promise<ReusablePostingCheckout | null> {
  try {
    const { data, error } = await supabase
      .from('bounty_posting_checkouts')
      .select(
        'posting_attempt_id, status, fee_amount_cents, reward_amount_cents, total_amount_cents, created_at'
      )
      .eq('poster_id', posterId)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as Record<string, any>;
    return {
      postingAttemptId: String(row.posting_attempt_id),
      status: row.status as PostingCheckoutStatus,
      feeCents: Number(row.fee_amount_cents),
      rewardCents: Number(row.reward_amount_cents),
      totalCents: Number(row.total_amount_cents),
      createdAt: String(row.created_at),
    };
  } catch {
    return null;
  }
}

export const postingCheckoutService = {
  createPostingAttemptId,
  openPostingCheckout,
  settlePostingCheckout,
  findReusablePaidCheckout,
  assertServerTotalsMatch,
};

export default postingCheckoutService;
