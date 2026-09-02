/**
 * Classifies a failed withdrawal request into the correct analytics event.
 *
 * Both withdrawal paths (legacy /connect/transfer, driven from
 * withdraw-with-bank-screen.tsx, and Connect-native /connect/payout +
 * /connect/instant-payout, driven from useConnectPayout) hit this so the two
 * cannot drift into inconsistent taxonomy the way the legacy path did on its
 * own — see the 2026-08-24 incident this exists to prevent.
 *
 * A hunter who already has a withdrawal pending and keeps tapping "Withdraw"
 * is not producing failed payouts: the backend rejects the request BEFORE
 * ever asking Stripe to move money (see findInFlightWithdrawal() /
 * inFlightWithdrawalResponse() in supabase/functions/connect/index.ts).
 * Counting that as `payout_failed` makes one blocked hunter's retries read as
 * many independent provider failures — exactly what happened: a single
 * account's 36 retries against this exact block, over 6 days, dominated the
 * `payout_failed` metric.
 *
 * The backend marks every genuine provider-attempt failure with
 * `stripeAttempted: true` (only set on responses returned from a catch block
 * around an actual stripe.transfers.create()/stripe.payouts.create() call).
 * Its absence means the request was rejected pre-flight by a Bounty business
 * rule, so `payout_failed` may only fire when it is explicitly true.
 */
export type PayoutFailureEvent = 'payout_already_pending' | 'payout_rejected' | 'payout_failed';

export function classifyPayoutFailure(params: {
  code?: string | null;
  stripeAttempted?: boolean | null;
}): PayoutFailureEvent {
  if (params.code === 'withdrawal_already_in_progress') return 'payout_already_pending';
  if (params.stripeAttempted === true) return 'payout_failed';
  // A code with no stripeAttempted flag is still a server-issued business-rule
  // rejection (validation, eligibility, insufficient balance, etc.) — those
  // codes exist entirely on the pre-flight side of every withdrawal route.
  if (params.code) return 'payout_rejected';
  // No code at all means the request never got a parsed server response —
  // a network error, timeout, or abort. Whether Stripe was reached is
  // genuinely unknown, so this stays payout_failed rather than being
  // optimistically downgraded to a rejection.
  return 'payout_failed';
}
