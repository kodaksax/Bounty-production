/**
 * Orchestrates the pre-publish posting checkout for the $1 service-fee
 * experiment: open a combined PaymentIntent (fee + full bounty reward),
 * collect payment, verify it server-side, and only then report success so the
 * composer may publish.
 *
 * WHY PAYMENT SHEET RATHER THAN processPaymentSecure()
 * ----------------------------------------------------
 * `processPaymentSecure` (lib/stripe-context.tsx) confirms against an
 * ALREADY-SAVED payment method and throws "No payment method available"
 * otherwise. Because bounty funding is deferred today, a large share of
 * posters have never added a card — routing them through that helper would
 * dead-end the treatment arm at an add-a-card wall, which is precisely the
 * friction that would make the experiment measure the wall instead of the fee.
 *
 * Stripe's PaymentSheet collects a card inline when there is none, offers
 * Apple/Google Pay, and handles 3DS, so the checkout works for every poster on
 * the first try. It also reports cancellation distinctly, which is what makes
 * `posting_checkout_abandoned` a real signal rather than an inferred one.
 *
 * On web the native sheet is unavailable (react-native-web has no Stripe SDK
 * here), so this falls back to confirming against a saved method — which is
 * the pre-existing behaviour for every other payment on web.
 *
 * SAFETY CONTRACT
 * ---------------
 * `pay()` resolves true ONLY when the server has verified with Stripe that the
 * charge succeeded and has split it (reward -> wallet, fee -> platform
 * revenue). The composer must not create a bounty on anything weaker:
 *
 *   * a cancelled or failed sheet resolves false
 *   * an asynchronously-settling charge ('processing') resolves false, because
 *     the reward is not in the wallet yet and the bounty INSERT would fail to
 *     escrow it
 *   * a dropped response resolves false, and the retry re-uses the same
 *     attempt id, so it cannot become a second charge
 *
 * Duplicate protection lives in three places, none of which is this hook's
 * in-flight ref alone: the UNIQUE posting_attempt_id in the DB, the
 * deterministic Stripe idempotency key derived from it, and the server
 * returning `alreadyPaid` instead of charging again. The ref below is only a
 * UI courtesy so a double-tap does not open two sheets.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuthContext } from 'hooks/use-auth-context';
import { useStripe } from 'lib/stripe-context';
import { calculatePostingCheckout, POSTING_FEE_CENTS } from 'lib/constants/posting-fee';
import { analyticsService } from 'lib/services/analytics-service';
import {
  createPostingAttemptId,
  openPostingCheckout,
  settlePostingCheckout,
} from 'lib/services/posting-checkout-service';
import { stripeService } from 'lib/services/stripe-service';
import { getUserFriendlyError } from 'lib/utils/error-messages';

export type PostingCheckoutState =
  | 'idle'
  /** Opening or recovering the PaymentIntent. */
  | 'opening'
  /** The poster is in the payment sheet. */
  | 'confirming'
  /** Charge collected; the server is verifying and splitting it. */
  | 'settling'
  /** Verified paid. The composer may publish. */
  | 'paid'
  | 'failed';

/** Where a failure happened, for the `stage` property on the failure event. */
export type PostingCheckoutStage = 'intent' | 'confirm' | 'settle';

export interface UsePostingCheckoutParams {
  /** The bounty reward in dollars, as the poster named it. */
  rewardDollars: number;
  /** Tags every analytics event from this hook, matching the composer's surface. */
  surface: string;
  /** The resolved experiment arm, carried on every event for arm comparison. */
  variant: string;
}

export interface UsePostingCheckoutResult {
  state: PostingCheckoutState;
  /** True while any round-trip or sheet is in flight. */
  isBusy: boolean;
  /** User-facing message. Null unless state is 'failed'. */
  error: string | null;
  /** Short machine-readable label for the last failure. */
  failureCode: string | null;
  /** True when the charge was already paid before this attempt (interrupted flow). */
  prepaid: boolean;
  totals: ReturnType<typeof calculatePostingCheckout>;
  /** Stable for the whole posting attempt. The composer passes it to publish. */
  attemptId: string;
  /** Resolves true only when the server has verified the charge. */
  pay: () => Promise<boolean>;
  /** Clears a failure so the CTA returns to its normal label. */
  reset: () => void;
}

export function usePostingCheckout({
  rewardDollars,
  surface,
  variant,
}: UsePostingCheckoutParams): UsePostingCheckoutResult {
  const { session } = useAuthContext();
  const { paymentMethods } = useStripe();

  const [state, setState] = useState<PostingCheckoutState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [prepaid, setPrepaid] = useState(false);

  const totals = calculatePostingCheckout(rewardDollars);

  // One attempt id for the life of this hook instance. Deliberately NOT keyed
  // on the amount: if the poster edits the reward and comes back, the server
  // cancels the superseded PaymentIntent and opens a new one under the same
  // attempt, which keeps "one attempt, at most one live charge" true. A fresh
  // id per amount would leave the old intent confirmable by a stale sheet.
  const attemptIdRef = useRef<string | null>(null);
  if (attemptIdRef.current === null) attemptIdRef.current = createPostingAttemptId();
  const attemptId = attemptIdRef.current;

  // Guards a double-tap from opening two sheets. Not the duplicate-charge
  // defence — see the header for where that actually lives.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setStateSafe = useCallback((next: PostingCheckoutState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const baseProps = useCallback(
    () => ({
      surface,
      variant,
      postingAttemptId: attemptId,
      feeCents: POSTING_FEE_CENTS,
      rewardCents: totals.rewardCents,
      totalCents: totals.totalCents,
      platform: Platform.OS,
    }),
    [surface, variant, attemptId, totals.rewardCents, totals.totalCents]
  );

  const trackFailure = useCallback(
    (stage: PostingCheckoutStage, reason: string) => {
      analyticsService.trackEvent('posting_checkout_failed', {
        ...baseProps(),
        stage,
        reason,
      });
    },
    [baseProps]
  );

  const fail = useCallback(
    (stage: PostingCheckoutStage, reason: string, message: string) => {
      if (mountedRef.current) {
        setError(message);
        setFailureCode(reason);
        setState('failed');
      }
      trackFailure(stage, reason);
    },
    [trackFailure]
  );

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setError(null);
    setFailureCode(null);
    // A paid checkout must stay paid — resetting it would offer the poster a
    // second charge for money they have already handed over.
    setState(current => (current === 'paid' ? 'paid' : 'idle'));
  }, []);

  const pay = useCallback(async (): Promise<boolean> => {
    // Already verified paid: the composer can publish. This is what makes a
    // retry after a FAILED PUBLISH free rather than a second charge.
    if (state === 'paid') return true;
    if (inFlightRef.current) return false;

    inFlightRef.current = true;
    setError(null);
    setFailureCode(null);

    try {
      analyticsService.trackEvent('posting_checkout_started', baseProps());

      // ── 1. Open (or recover) the charge ────────────────────────────────
      setStateSafe('opening');
      let intent;
      try {
        intent = await openPostingCheckout({
          postingAttemptId: attemptId,
          rewardCents: totals.rewardCents,
          paymentMethodId: paymentMethods[0]?.id,
          accessToken: session?.access_token,
        });
      } catch (err: any) {
        const friendly = getUserFriendlyError(err);
        fail('intent', String(err?.code ?? 'intent_failed'), friendly.message);
        return false;
      }

      // The poster already paid for this attempt — the app died between the
      // charge and the publish. Consume it rather than charging again. This
      // event is the duplicate-charge canary: it should be rare and it should
      // never be accompanied by a second posting_checkout_succeeded.
      if (intent.alreadyPaid) {
        if (mountedRef.current) setPrepaid(true);
        setStateSafe('paid');
        analyticsService.trackEvent('posting_checkout_reused', {
          ...baseProps(),
          recoveredStatus: intent.status ?? 'paid',
        });
        return true;
      }

      if (!intent.clientSecret) {
        fail('intent', 'missing_client_secret', 'Could not start checkout. Please try again.');
        return false;
      }

      // ── 2. Collect payment ────────────────────────────────────────────
      setStateSafe('confirming');

      const sheet = await stripeService.presentPaymentSheet(intent.clientSecret);

      if (!sheet.success) {
        const code = sheet.error?.code ?? 'payment_failed';

        // The poster dismissed the sheet. Not a failure — an abandon. Kept as
        // a separate event so a declined card and a change of mind are never
        // pooled into one number.
        if (code === 'canceled' || code === 'Canceled') {
          setStateSafe('idle');
          analyticsService.trackEvent('posting_checkout_abandoned', {
            ...baseProps(),
            trigger: 'sheet_dismissed',
          });
          return false;
        }

        // PaymentSheet is not available (web, or a build without the native
        // SDK). Fall back to confirming against a saved method, which is how
        // every other payment on web already works.
        if (code === 'not_supported') {
          const pmId = paymentMethods[0]?.id;
          if (!pmId) {
            fail(
              'confirm',
              'no_payment_method',
              'Add a payment method to post this bounty, then try again.'
            );
            return false;
          }
          try {
            const confirmed = await stripeService.confirmPaymentSecure(
              intent.clientSecret,
              pmId,
              undefined,
              { userId: session?.user?.id }
            );
            if (confirmed.status !== 'succeeded') {
              fail(
                'confirm',
                `status_${confirmed.status}`,
                'Payment was not completed. Please try again.'
              );
              return false;
            }
          } catch (err: any) {
            const friendly = getUserFriendlyError(err);
            fail('confirm', String(err?.code ?? 'confirm_failed'), friendly.message);
            return false;
          }
        } else {
          fail('confirm', String(code), sheet.error?.message ?? 'Payment failed. Please try again.');
          return false;
        }
      }

      // ── 3. Verify and split, server-side ──────────────────────────────
      // The sheet reporting success is NOT sufficient to publish on: the
      // reward has to actually be in the wallet before the bounty INSERT can
      // escrow it, and only the server can confirm that.
      setStateSafe('settling');

      let settlement;
      try {
        settlement = await settlePostingCheckout({
          postingAttemptId: attemptId,
          accessToken: session?.access_token,
        });
      } catch (err: any) {
        // The charge may well have gone through — we just could not confirm
        // it. Do NOT publish. The retry re-uses the same attempt id, so the
        // server will report alreadyPaid rather than charging twice.
        fail(
          'settle',
          String(err?.code ?? 'settle_failed'),
          'Your payment may have gone through but we could not confirm it. Tap to check again — you will not be charged twice.'
        );
        return false;
      }

      if (settlement.processing) {
        fail(
          'settle',
          'processing',
          'Your payment is still processing. Give it a moment and try again — you will not be charged twice.'
        );
        return false;
      }

      if (!settlement.paid) {
        fail(
          'settle',
          String(settlement.code ?? 'not_paid'),
          'Payment was not completed. Please try again.'
        );
        return false;
      }

      setStateSafe('paid');
      // No PaymentIntent id, charge id or client secret goes to analytics —
      // see the money-safety note on this event block in analytics-service.ts.
      analyticsService.trackEvent('posting_checkout_succeeded', baseProps());
      return true;
    } finally {
      inFlightRef.current = false;
    }
  }, [
    state,
    attemptId,
    baseProps,
    fail,
    paymentMethods,
    session?.access_token,
    session?.user?.id,
    setStateSafe,
    totals.rewardCents,
  ]);

  return {
    state,
    isBusy: state === 'opening' || state === 'confirming' || state === 'settling',
    error,
    failureCode,
    prepaid,
    totals,
    attemptId,
    pay,
    reset,
  };
}

export default usePostingCheckout;
