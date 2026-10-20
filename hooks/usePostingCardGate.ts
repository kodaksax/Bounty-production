/**
 * SBA-05, option B: a first-time poster saves a card before "Post Bounty", so
 * that hiring later is one tap ("Pay $X & hire" with the saved card).
 *
 * Nothing is charged here. Paid app bounties are still 'at_accept': the money
 * moves inside fn_accept_bounty_request when the poster hires. Saving the card
 * is a Stripe SetupIntent (components/add-card-modal.tsx).
 *
 * WHO IS ASKED
 * ------------
 * The server decides who is a first-time poster and whether the switch is on
 * (fn_get_posting_card_requirement -> fn_is_first_time_poster). This hook adds
 * only what the server can't see from here (needsCardAtPost):
 *   * a card already saved (the live Stripe list, not the DB mirror);
 *   * a wallet balance that already covers the reward: hiring is already one
 *     tap ("Confirm & hire");
 *   * iOS with Apple Pay ready (product decision, 2026-10-19);
 *   * web, where Stripe is stubbed and no card can be saved;
 *   * for-honor / $0, and v2/v3 Stripe-native funding (charged at post).
 *
 * FAILS OPEN
 * ----------
 * If the server or Stripe can't answer, the poster is not asked. This is a
 * nudge toward a one-tap hire, not a guard on money: an unfunded bounty still
 * can't start work (trg_bounties_enforce_funding_before_work), and the hire
 * sheet still offers "Link a card" for anyone who arrives without one.
 */

import { getPostingCardRequirement, amountBucket, type PostingCardRequirement } from 'lib/services/bounty-funding-service';
import { analyticsService } from 'lib/services/analytics-service';
import { applePayService } from 'lib/services/apple-pay-service';
import { useStripe } from 'lib/stripe-context';
import { shouldUseStripeNativeFunding } from 'lib/utils/payment-architecture';
import { useWallet } from 'lib/wallet-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export interface CardAtPostInput {
  /** Server answer; null = didn't answer, which never asks. */
  requirement: PostingCardRequirement | null;
  platform: typeof Platform.OS;
  amount: number;
  isForHonor: boolean;
  balance: number;
  hasCard: boolean;
  applePayReady: boolean;
  stripeNativeFunding: boolean;
}

/** Whether this poster must save a card before this post. Pure, for tests. */
export function needsCardAtPost(input: CardAtPostInput): boolean {
  if (input.requirement?.cardRequired !== true) return false;
  if (input.isForHonor || !(input.amount > 0)) return false;
  if (input.platform === 'web') return false;
  if (input.stripeNativeFunding) return false;
  if (input.hasCard) return false;
  if (input.balance >= input.amount) return false;
  if (input.platform === 'ios' && input.applePayReady) return false;
  return true;
}

export type PostingPayment = { amount: number; isForHonor: boolean };

type Phase =
  /** Nothing in flight. */
  | 'idle'
  /** Tap received; reading the server answer and the card list. */
  | 'checking'
  /** Card sheet open. */
  | 'sheet'
  /** Sheet closed; re-reading the card list before deciding. */
  | 'rechecking';

interface Pending {
  payment: PostingPayment;
  proceed: (payment: PostingPayment) => void;
}

export interface PostingCardGate {
  /**
   * The poster would be asked for a card if they posted now, judged from what
   * is already loaded. Drives the copy and CTA label only; requestPublish
   * re-decides with fresh data.
   */
  cardStepExpected: boolean;
  /** A check is in flight; show the CTA as busy. */
  checking: boolean;
  /** Render PaymentMethodsModal (preferredType 'card') while true. */
  showCardSheet: boolean;
  /** The sheet closed (X or backdrop). Publishes if a card now exists. */
  onCardSheetClose: () => void;
  /** Set when the sheet closed without a card. Cleared by the next attempt. */
  dismissed: boolean;
  /**
   * Call instead of publishing directly. Calls `proceed(payment)` at once
   * when no card is needed, or after a card has been saved.
   */
  requestPublish: (payment: PostingPayment, proceed: (payment: PostingPayment) => void) => void;
}

const REQUIREMENT_DEBOUNCE_MS = 250;

export function usePostingCardGate({
  amount,
  isForHonor,
  surface,
}: {
  amount: number;
  isForHonor: boolean;
  surface: string;
}): PostingCardGate {
  const { paymentMethods, isLoading: stripeLoading, loadPaymentMethods } = useStripe();
  const { balance } = useWallet();
  const hasCard = paymentMethods.some((m) => m.type === 'card');

  const [requirement, setRequirement] = useState<PostingCardRequirement | null>(null);
  const requirementAmountRef = useRef<number | null>(null);
  const [applePayReady, setApplePayReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dismissed, setDismissed] = useState(false);
  // Bumped when an async read finishes, so the decision runs in an effect on
  // a render that already has the context's fresh card list.
  const [decideToken, setDecideToken] = useState(0);
  const tokenRef = useRef(0);
  tokenRef.current = decideToken;
  // The token value that means "the reads for the current check are in".
  // Until then the check must not decide on whatever happens to be loaded.
  const awaitTokenRef = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    applePayService
      .isAvailable()
      .then((ready) => {
        if (active) setApplePayReady(ready);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Prefetch the server answer as the amount settles, so the tap rarely waits.
  useEffect(() => {
    if (isForHonor || !(amount > 0) || Platform.OS === 'web') return;
    let active = true;
    const timer = setTimeout(() => {
      getPostingCardRequirement(amount).then((req) => {
        if (!active) return;
        requirementAmountRef.current = amount;
        setRequirement(req);
      });
    }, REQUIREMENT_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [amount, isForHonor]);

  const decide = useCallback(
    (payment: PostingPayment, req: PostingCardRequirement | null) =>
      needsCardAtPost({
        requirement: req,
        platform: Platform.OS,
        amount: payment.amount,
        isForHonor: payment.isForHonor,
        balance,
        hasCard,
        applePayReady,
        stripeNativeFunding: shouldUseStripeNativeFunding(),
      }),
    [balance, hasCard, applePayReady]
  );

  const eventProps = useCallback(
    (payment: PostingPayment) => ({
      surface,
      amountBucket: amountBucket(payment.amount),
      platform: Platform.OS,
      applePayReady,
    }),
    [surface, applePayReady]
  );

  const finish = useCallback((outcome: 'proceed' | 'dismissed') => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPhase('idle');
    if (outcome === 'dismissed') {
      setDismissed(true);
      return;
    }
    pending?.proceed(pending.payment);
  }, []);

  // The decision, always on a render with fresh context values.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const readsIn = decideToken >= awaitTokenRef.current;

    if (phase === 'checking') {
      if (!readsIn || stripeLoading) return;
      if (!decide(pending.payment, requirement)) {
        finish('proceed');
        return;
      }
      analyticsService.trackEvent('posting_card_required', {
        ...eventProps(pending.payment),
        outcome: 'prompted',
      });
      setPhase('sheet');
      return;
    }

    // A card appeared while the sheet was open (saved, or the list finished
    // loading): close it and publish without another tap.
    if (phase === 'sheet' && hasCard) {
      analyticsService.trackEvent('posting_card_required', {
        ...eventProps(pending.payment),
        outcome: 'saved',
      });
      finish('proceed');
      return;
    }

    if (phase === 'rechecking') {
      if (!readsIn || stripeLoading) return;
      if (hasCard) {
        analyticsService.trackEvent('posting_card_required', {
          ...eventProps(pending.payment),
          outcome: 'saved',
        });
        finish('proceed');
        return;
      }
      analyticsService.trackEvent('posting_card_required', {
        ...eventProps(pending.payment),
        outcome: 'dismissed',
      });
      finish('dismissed');
    }
    // decideToken is the trigger after each async read.
  }, [phase, decideToken, stripeLoading, hasCard, requirement, decide, eventProps, finish]);

  const requestPublish = useCallback(
    (payment: PostingPayment, proceed: (payment: PostingPayment) => void) => {
      if (pendingRef.current) return; // a check is already running
      setDismissed(false);

      // Cheap exits first, with no network: these never need a card.
      const exempt =
        payment.isForHonor ||
        !(payment.amount > 0) ||
        Platform.OS === 'web' ||
        shouldUseStripeNativeFunding() ||
        hasCard ||
        balance >= payment.amount ||
        (Platform.OS === 'ios' && applePayReady);
      if (exempt) {
        proceed(payment);
        return;
      }

      // Server answered for this exact amount and says no: publish now.
      if (requirementAmountRef.current === payment.amount && requirement?.cardRequired !== true) {
        proceed(payment);
        return;
      }

      pendingRef.current = { payment, proceed };
      awaitTokenRef.current = tokenRef.current + 1;
      setPhase('checking');

      const needRequirement = requirementAmountRef.current !== payment.amount;
      Promise.all([
        needRequirement
          ? getPostingCardRequirement(payment.amount).then((req) => {
              if (!mountedRef.current) return;
              requirementAmountRef.current = payment.amount;
              setRequirement(req);
            })
          : Promise.resolve(),
        // The list may not have loaded yet; an empty one must not read as
        // "no card". Errors fall through: the sheet then shows its own state.
        loadPaymentMethods().catch(() => {}),
      ]).finally(() => {
        if (mountedRef.current) setDecideToken((n) => n + 1);
      });
    },
    [hasCard, balance, applePayReady, requirement, loadPaymentMethods]
  );

  const onCardSheetClose = useCallback(() => {
    if (!pendingRef.current) return;
    awaitTokenRef.current = tokenRef.current + 1;
    setPhase('rechecking');
    loadPaymentMethods()
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setDecideToken((n) => n + 1);
      });
  }, [loadPaymentMethods]);

  const cardStepExpected = needsCardAtPost({
    requirement,
    platform: Platform.OS,
    amount,
    isForHonor,
    balance,
    hasCard,
    applePayReady,
    stripeNativeFunding: shouldUseStripeNativeFunding(),
  });

  return {
    cardStepExpected,
    checking: phase === 'checking' || phase === 'rechecking',
    showCardSheet: phase === 'sheet',
    onCardSheetClose,
    dismissed,
    requestPublish,
  };
}

export default usePostingCardGate;
