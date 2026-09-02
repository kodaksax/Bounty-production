import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { bountyService } from 'app/services/bountyService';
import { useFormSubmission } from 'hooks/useFormSubmission';
import { useDeferredFundingVariant } from 'lib/experiments/deferred-funding-variant';
import { analyticsService } from 'lib/services/analytics-service';
import { amountBucket, canDeferBountyFunding } from 'lib/services/bounty-funding-service';
import { bountyPaymentsService } from 'lib/services/bounty-payments-service';
import { offlineQueueService } from 'lib/services/offline-queue-service';
import { stripeService } from 'lib/services/stripe-service';
import {
  getAmountNeeded,
  getInsufficientBalanceMessage,
  toCents,
  validateBalance,
} from 'lib/utils/bounty-validation';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { shouldUseStripeNativeFunding } from 'lib/utils/payment-architecture';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

/**
 * Shared escrow/publish logic for both the 6-step (control) and 2-step
 * (two_step) posting flows. Extracted verbatim from the original
 * app/screens/CreateBounty/index.tsx so a create -> fund -> roll-back-on-
 * failure sequence against a real custodial wallet debit exists in exactly
 * one place. See the "why extract rather than duplicate" note in the plan —
 * a divergent copy's failure mode is an orphaned bounty or a debited wallet
 * with nothing to show for it.
 */

export interface PublishedBountyMeta {
  amountCents: number;
  category: string;
  architecture: 1 | 2 | 3;
  /** Canonical `bounty_published` payload fields. The surface layer emits the
   * single terminal event (see app/screens/CreateBounty/index.tsx onPublished);
   * this hook no longer emits it itself, to avoid the historical duplicate
   * where post_published AND bounty_published both fired per publish. */
  surface: string;
  bountyId: string;
  amountDollars: number;
  isForHonor: boolean;
  funded: boolean;
  workType?: string;
  queuedOffline: boolean;
}

/** Props matching InsufficientBalanceScreen/AddMoneyScreen exactly, so
 * PublishFundingGate can be a pure pass-through with no logic of its own. */
export interface BountyPublishFunding {
  showInsufficientBalance: boolean;
  showTopUp: boolean;
  walletBalance: number;
  bountyAmount: number;
  onAddFunds: () => void;
  onEditAmount: () => void;
  onCancel: () => void;
  initialAmount: string;
  headerLabel: string;
  primaryCtaLabel: (amount: number) => string;
  onBack: () => void;
  onAddMoney: () => void;
}

export interface UseBountyPublishParams {
  /** Tags every analytics event from this hook — 'create_flow' for control,
   * a two-step-specific value for the new arm. */
  surface: string;
  draft: BountyDraft;
  clearDraft: () => Promise<void>;
  balance: number;
  createEscrow: (
    bountyId: string | number,
    amount: number,
    title: string,
    userId: string
  ) => Promise<unknown>;
  paymentMethods: { id: string }[];
  sessionUserId?: string;
  canPostBounties: boolean;
  /** Called once a bounty is live (after clearDraft, after the success alert
   * has been dismissed unless suppressSuccessAlert is set). */
  onPublished: (bountyId: string, meta: PublishedBountyMeta) => void;
  /** Where "Edit amount" on the insufficient-balance screen should send the
   * poster — control jumps to its Compensation step, two_step to its step 2. */
  onEditAmount: () => void;
  /** The flow's own exit callback, invoked if the poster cancels from the
   * insufficient-balance gate. */
  onCancelGate?: () => void;
  /** two_step passes true: its PostPublishScreen IS the success confirmation,
   * so the native "Bounty Posted!" alert would be a redundant second one. */
  suppressSuccessAlert?: boolean;
}

export function useBountyPublish(params: UseBountyPublishParams) {
  const {
    surface,
    draft,
    clearDraft,
    balance,
    createEscrow,
    paymentMethods,
    sessionUserId,
    canPostBounties,
    onPublished,
    onEditAmount,
    onCancelGate,
    suppressSuccessAlert = false,
  } = params;

  const [showInsufficientBalance, setShowInsufficientBalance] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [insufficientBalanceOrigin, setInsufficientBalanceOrigin] = useState<
    'amount_step' | 'publish' | null
  >(null);
  // Distinguishes a real abandon from unmounting after a successful publish —
  // exposed so the caller's own post_abandoned tracking doesn't double-count.
  const publishedRef = useRef(false);

  // --- "Post first, pay at accept" ----------------------------------------
  // `variant` is this device's PostHog arm; it decides whether we ASK. The
  // server decides whether we GET it, which is what deferredGrantRef records.
  //
  // A ref rather than state on purpose: submit() is created once by
  // useFormSubmission and closes over this hook's scope, so a state value read
  // inside it could be a render behind the publish() call that set it. The
  // consequence of reading a stale value here would be posting a bounty with
  // the wrong funding expectation, so it has to be the ref.
  const { variant: fundingVariant } = useDeferredFundingVariant();
  const deferredGrantRef = useRef(false);

  /**
   * Whether this bounty will be posted unfunded — PREFETCHED, not resolved on
   * the button press.
   *
   * Pay-at-accept is the product default now, not an experiment arm: posting is
   * publishing an offer and never debits the wallet. The PostHog variant no
   * longer gates it (it was the reason the whole mechanism sat inert — the flag
   * was never created, so every device resolved 'control' and never asked).
   *
   * Resolved AHEAD of the tap on purpose. The publish path must stay
   * synchronous: an await between the tap and the funding gate leaves the CTA
   * looking dead for a round-trip (the submit spinner has not started yet), and
   * it perturbs the very posting funnel this feature is measured on. Amount is
   * chosen several steps before Publish, so this has always resolved by then.
   *
   * `null` = not answered yet. Treated as NOT deferred at publish time, which
   * is the safe direction: the poster sees the same pre-funding gate they saw
   * before this feature existed, rather than being sent down a deferred path
   * the server might not grant.
   *
   * This is only a PREDICTION. The authority is
   * trg_bounties_normalize_funding_mode, which re-decides at INSERT from the
   * bounty's own columns and ignores whatever the client asked for — so a wrong
   * answer here is cosmetic, never financial: we read the granted mode back off
   * the created row before deciding whether to escrow.
   */
  const deferredEligibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    deferredEligibleRef.current = null;

    if (draft.isForHonor || draft.amount <= 0) {
      deferredEligibleRef.current = false;
      return;
    }

    let cancelled = false;
    canDeferBountyFunding(draft.amount)
      .then(eligible => {
        if (!cancelled) deferredEligibleRef.current = eligible;
      })
      .catch(() => {
        // Eligibility is an optimisation; failing to read it just means this
        // poster takes the pre-funded path.
        if (!cancelled) deferredEligibleRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [draft.amount, draft.isForHonor]);

  // Defensive invariant: if the wallet becomes sufficient while the
  // insufficient-balance summary is showing (a delayed webhook/reconcile, or
  // the poster funding from elsewhere while this screen happens to still be
  // mounted), dismiss it immediately rather than leave it displaying a stale
  // amount needed. Deliberately scoped to showInsufficientBalance only, NOT
  // showTopUp — AddMoneyScreen owns its own in-flight success sequence, and
  // onAddMoney (below) is the sole intended trigger for leaving showTopUp.
  useEffect(() => {
    if (!showInsufficientBalance) return;
    if (!validateBalance(draft.amount, balance, draft.isForHonor)) return;
    setShowInsufficientBalance(false);
    setInsufficientBalanceOrigin(null);
  }, [balance, draft.amount, draft.isForHonor, showInsufficientBalance]);

  const {
    submit,
    isSubmitting,
    error: submitError,
    reset: resetSubmitError,
  } = useFormSubmission(
    async () => {
      // Canonical `bounty_submitted` — the poster committed a publish attempt.
      // Fires once per create attempt (including a retry) BEFORE the
      // create/escrow round-trip, so bounty_published ÷ bounty_submitted is
      // the publish success rate.
      analyticsService.trackEvent('bounty_submitted', {
        surface,
        role: 'poster',
        is_for_honor: draft.isForHonor,
        amount: draft.isForHonor ? 0 : draft.amount,
      });

      if (!canPostBounties) {
        throw new Error(
          'Please verify your email address before posting bounties. Check your inbox for the verification link.'
        );
      }

      const useStripeNativePayments =
        !draft.isForHonor && draft.amount > 0 && shouldUseStripeNativeFunding();

      // publish() resolves this immediately before calling submit(), so the ref
      // is current here. retry() re-runs the SAME publish attempt and correctly
      // reuses it. onTopUpComplete() only ever runs after the funding gate,
      // which a deferred publish never reaches — so the ref is false there,
      // which is also correct: that poster has just pre-funded.
      const deferFunding = deferredGrantRef.current;

      if (!deferFunding && !useStripeNativePayments && !validateBalance(draft.amount, balance, draft.isForHonor)) {
        analyticsService.trackEvent('post_amount_blocked_by_balance', {
          surface,
          attemptedAmount: draft.amount,
          balance,
          shortfall: Number((draft.amount - balance).toFixed(2)),
          method: 'publish',
        });
        throw new Error(getInsufficientBalanceMessage(draft.amount, balance));
      }

      const { bounty: createdBounty, created } = await bountyService.createBounty(draft, {
        fundingMode: deferFunding ? 'at_accept' : 'at_post',
      });
      let paymentArchitectureVersion: 1 | 2 | 3 = 1;
      paymentArchitectureVersion = useStripeNativePayments ? 2 : 1;

      if (!createdBounty) {
        throw new Error('Failed to create bounty');
      }

      // Read back what the SERVER actually granted rather than what we asked
      // for: trg_bounties_normalize_funding_mode silently downgrades an
      // ineligible request, and the confirmation copy ("you'll be charged when
      // you pick someone") must not appear on a bounty that was in fact charged
      // at insert. Offline publishes hand back a synthetic temp row with no
      // server-decided column, so fall back to what we requested there.
      // When the server did not tell us (an offline publish hands back a
      // synthetic temp row with no server-decided column), assume DEFERRED and
      // skip the post-time escrow. Both directions of being wrong were weighed:
      //
      //   * assume at_post  -> if the server actually deferred, we debit the
      //     poster at post time. That is the exact bug this whole change
      //     exists to remove, and it is invisible to the poster until their
      //     balance is short.
      //   * assume at_accept -> if the server actually chose at_post, the
      //     AFTER INSERT trigger (fn_reserve_bounty_escrow) has ALREADY taken
      //     the money server-side. The client call we skip here is redundant
      //     belt-and-braces; apply_escrow would have returned applied=false.
      //
      // So the unknown case is safe in one direction and harmful in the other.
      // Deliberately NOT falling back to `deferFunding`: since the server now
      // grants at_accept from the bounty's own columns and ignores what the
      // client asked, our request is no longer evidence of what it decided.
      const grantedFundingMode =
        (createdBounty as { funding_mode?: string | null }).funding_mode ?? 'at_accept';
      const postedUnfunded = grantedFundingMode === 'at_accept';

      // Skip the post-time escrow for a granted deferred bounty. The DB trigger
      // has already skipped its own debit, and calling createEscrow here would
      // charge the poster at exactly the moment the experiment exists to avoid.
      if (created && !draft.isForHonor && draft.amount > 0 && !postedUnfunded) {
        try {
          await analyticsService.trackEvent('payment_architecture_routed', {
            bountyId: String(createdBounty.id),
            version: useStripeNativePayments ? 2 : 1,
            context: 'funding',
          });
        } catch {
          /* analytics is best-effort */
        }

        if (useStripeNativePayments) {
          try {
            const paymentResult = await bountyPaymentsService.createBountyPayment(
              String(createdBounty.id)
            );
            paymentArchitectureVersion =
              ((paymentResult as { architectureVersion?: number }).architectureVersion ?? 2) === 3
                ? 3
                : ((paymentResult as { architectureVersion?: number }).architectureVersion ?? 2) === 2
                  ? 2
                  : 1;

            try {
              await analyticsService.trackEvent('payment_architecture_routed', {
                bountyId: String(createdBounty.id),
                version: paymentArchitectureVersion,
                context: 'funding',
              });
            } catch {
              /* analytics is best-effort */
            }

            try {
              await analyticsService.trackEvent('payment_initiated', {
                bountyId: String(createdBounty.id),
                architecture: paymentArchitectureVersion === 3 ? 'v3' : 'v2',
                amount: draft.amount,
              });
            } catch {
              /* analytics is best-effort */
            }

            const paymentMethodId = paymentMethods[0]?.id;
            if (!paymentMethodId) {
              throw new Error('No payment method available. Please add a payment method first.');
            }
            const confirmedIntent = await stripeService.confirmPaymentSecure(
              paymentResult.clientSecret,
              paymentMethodId,
              undefined,
              { userId: sessionUserId }
            );
            // v2 captures immediately, so a confirmed intent lands on
            // 'succeeded'. v3 authorizes without capturing, so a *successful*
            // v3 confirmation lands on 'requires_capture' — treating that as a
            // failure would roll back and delete every v3 bounty ever posted.
            // The server tells us which path actually ran.
            const isV3Payment = paymentArchitectureVersion === 3;
            const acceptableStatuses = isV3Payment
              ? ['requires_capture', 'succeeded']
              : ['succeeded'];
            if (!acceptableStatuses.includes(confirmedIntent.status)) {
              throw new Error('Payment was not completed. Please try again.');
            }

            try {
              await analyticsService.trackEvent('escrow_funded', {
                bountyId: String(createdBounty.id),
                architecture: paymentArchitectureVersion === 3 ? 'v3' : 'v2',
                amount: draft.amount,
              });
            } catch {
              /* analytics is best-effort */
            }
          } catch (escrowError) {
            try {
              await analyticsService.trackEvent('payment_failed', {
                bountyId: String(createdBounty.id),
                architecture: 'v2',
                stage: 'create_or_confirm',
              });
            } catch {
              /* analytics is best-effort */
            }
            try {
              await bountyPaymentsService.cancelBountyPayment(String(createdBounty.id));
            } catch {
              /* best-effort — the bounty delete below is the real safety net */
            }
            try {
              await bountyService.deleteBounty(createdBounty.id);
              console.error('Bounty creation rolled back due to failed Stripe payment:', escrowError);
            } catch (deleteErr) {
              console.error('Failed to delete bounty after payment failure:', deleteErr);
              throw new Error(
                'Failed to charge your card and could not roll back the bounty. Please contact support.'
              );
            }
            throw new Error('Failed to charge your card for this bounty. Your bounty was not posted.');
          }
        } else {
          try {
            await createEscrow(createdBounty.id, draft.amount, draft.title, sessionUserId ?? '');
            try {
              await analyticsService.trackEvent('escrow_funded', {
                bountyId: String(createdBounty.id),
                architecture: 'v1',
                amount: draft.amount,
              });
            } catch {
              /* analytics is best-effort */
            }
          } catch (escrowError) {
            try {
              await analyticsService.trackEvent('payment_failed', {
                bountyId: String(createdBounty.id),
                architecture: 'v1',
                stage: 'create_escrow',
              });
            } catch {
              /* analytics is best-effort */
            }
            try {
              await bountyService.deleteBounty(createdBounty.id);
              console.error('Bounty creation rolled back due to failed escrow:', escrowError);
            } catch (deleteErr) {
              console.error('Failed to delete bounty after escrow failure:', deleteErr);
              throw new Error(
                'Failed to create escrow and could not roll back bounty. Please contact support.'
              );
            }
            throw new Error('Failed to create escrow for this bounty. Your bounty was not posted.');
          }
        }
      }

      const isOnline = offlineQueueService.getOnlineStatus();

      if (created) {
        publishedRef.current = true;
        analyticsService.trackEvent('post_published', {
          surface,
          bountyId: String(createdBounty.id),
          amount: draft.isForHonor ? 0 : draft.amount,
          isForHonor: draft.isForHonor,
          // `funded` used to be implied by "paid bounty published". A deferred
          // bounty breaks that equivalence — it is a paid bounty with no money
          // captured — so this now reports the real funding state. Dashboards
          // reading `funded` keep working and simply become correct.
          funded: !draft.isForHonor && draft.amount > 0 && !postedUnfunded,
          fundingMode: grantedFundingMode,
          variant: fundingVariant,
          category: draft.category || 'none',
          workType: draft.workType,
          architecture: useStripeNativePayments ? 2 : 1,
          queuedOffline: !isOnline,
        });

        if (postedUnfunded) {
          // The experiment's step-2 event: a real, discoverable bounty exists
          // and nothing has been charged. `firstBounty` is true by construction
          // here — the only scope that grants a deferral today is
          // 'first_bounty' — but it is emitted explicitly so the funnel keeps
          // meaning the same thing after the scope is widened to
          // 'all_bounties'.
          analyticsService.trackEvent('bounty_posted_unfunded', {
            surface,
            bountyId: String(createdBounty.id),
            amountBucket: amountBucket(draft.amount),
            fundingMode: 'at_accept',
            variant: fundingVariant,
            firstBounty: true,
            category: draft.category || 'none',
            workType: draft.workType,
            platform: Platform.OS,
          });
        }
      }

      await clearDraft();

      // The single canonical `bounty_published` is emitted by the surface layer
      // (index.tsx onPublished) from this meta plus its own flow-timing props —
      // see PublishedBountyMeta. This hook deliberately no longer emits a
      // terminal event of its own.
      const meta: PublishedBountyMeta = {
        amountCents: toCents(draft.isForHonor ? 0 : draft.amount),
        category: draft.category || 'other',
        architecture: paymentArchitectureVersion,
        surface,
        bountyId: String(createdBounty.id),
        amountDollars: draft.isForHonor ? 0 : draft.amount,
        isForHonor: draft.isForHonor,
        funded: !draft.isForHonor && draft.amount > 0 && !postedUnfunded,
        workType: draft.workType,
        queuedOffline: !isOnline,
      };
      const finish = () => onPublished(createdBounty.id.toString(), meta);

      if (suppressSuccessAlert) {
        finish();
        return;
      }

      if (Platform.OS === 'web') {
        // Alert.alert is a no-op on web — proceed immediately after success
        finish();
      } else {
        Alert.alert(
          isOnline ? 'Bounty Posted! 🎉' : 'Bounty Queued! 📋',
          !isOnline
            ? "You're offline. Your bounty will be posted automatically when you reconnect."
            : postedUnfunded
              ? // Sets the expectation the whole experiment depends on, in one
                // line, without explaining escrow mechanics.
                "Your bounty is live. You'll only be charged when you choose someone to do it."
              : 'Your bounty has been posted successfully. Hunters will be able to see it and apply.',
          [
            {
              text: isOnline ? 'View Bounty' : 'OK',
              onPress: finish,
            },
          ]
        );
      }
    },
    {
      debounceMs: 1000,
      onError: error => {
        const userError = getUserFriendlyError(error);
        console.error('[CreateBounty] bounty_create failed:', error?.message ?? error);
        if (Platform.OS === 'web') {
          // Error is already surfaced via the ErrorBanner component below
        } else {
          Alert.alert(
            userError.title,
            userError.message + '\n\nYour draft has been saved. Please try again.',
            [{ text: 'OK' }]
          );
        }
      },
    }
  );

  // Gate at the UI boundary: check balance before ever calling submit(), so
  // an expected insufficient-balance case routes to the top-up screen
  // instead of the throw/Alert error path (submit's own check stays as a
  // safety net for anything that reaches it despite this gate).
  /** The pre-experiment publish decision, unchanged and fully synchronous. */
  const publishWithBalanceGate = (useStripeNativePayments: boolean) => {
    if (!useStripeNativePayments && !validateBalance(draft.amount, balance, draft.isForHonor)) {
      analyticsService.trackEvent('post_amount_blocked_by_balance', {
        surface,
        attemptedAmount: draft.amount,
        balance,
        shortfall: Number((draft.amount - balance).toFixed(2)),
        method: 'publish',
      });
      setInsufficientBalanceOrigin('publish');
      setShowInsufficientBalance(true);
      return;
    }
    submit();
  };

  const publish = () => {
    const useStripeNativePayments =
      !draft.isForHonor && draft.amount > 0 && shouldUseStripeNativeFunding();

    // Fully synchronous: the eligibility answer was prefetched when the amount
    // was chosen (see deferredEligibleRef). A poster whose bounty defers must
    // never see the insufficient-balance gate at all — but reaching that
    // decision must not put a network round-trip between the tap and the next
    // screen, which would leave the CTA looking dead with no spinner.
    //
    // Anything unresolved or ineligible falls through to publishWithBalanceGate,
    // i.e. the pre-funded path. That is the safe direction to be wrong in: the
    // poster is asked to fund up front, and the server still refuses to debit at
    // insert if it independently decides the bounty defers.
    const deferred =
      !useStripeNativePayments &&
      !draft.isForHonor &&
      draft.amount > 0 &&
      deferredEligibleRef.current === true;

    deferredGrantRef.current = deferred;

    if (deferred) {
      submit();
      return;
    }
    publishWithBalanceGate(useStripeNativePayments);
  };

  const onTopUpComplete = () => {
    // The deposit is already applied to wallet state inside useWalletDeposit
    // — `balance` here already reflects it.
    setShowTopUp(false);

    // The poster can edit the pre-filled amount, so the top-up may be less
    // than the full shortfall. Re-check rather than assuming success.
    if (!validateBalance(draft.amount, balance, draft.isForHonor)) {
      setShowInsufficientBalance(true);
      return;
    }

    setShowInsufficientBalance(false);
    const origin = insufficientBalanceOrigin;
    setInsufficientBalanceOrigin(null);
    if (origin === 'publish') {
      // Continue straight into publishing instead of dropping the poster
      // back at a prior step, so returning from top-up finishes the post.
      submit();
    }
    // amount_step origin: draft.amount is already set to the chosen amount,
    // so simply returning to the amount step (now with a cleared balance
    // warning) is enough — the poster taps Continue themselves.
  };

  const shortfall = getAmountNeeded(draft.amount, balance);

  const funding: BountyPublishFunding = {
    showInsufficientBalance,
    showTopUp,
    walletBalance: balance,
    bountyAmount: draft.amount,
    onAddFunds: () => {
      setShowInsufficientBalance(false);
      setShowTopUp(true);
    },
    onEditAmount: () => {
      setShowInsufficientBalance(false);
      setInsufficientBalanceOrigin(null);
      onEditAmount();
    },
    onCancel: () => {
      setShowInsufficientBalance(false);
      setInsufficientBalanceOrigin(null);
      onCancelGate?.();
    },
    initialAmount: shortfall.toFixed(2),
    headerLabel: 'ADD FUNDS TO POST',
    primaryCtaLabel: amount => `Add $${amount.toFixed(2)} & Continue`,
    onBack: () => {
      setShowTopUp(false);
      setShowInsufficientBalance(true);
    },
    onAddMoney: onTopUpComplete,
  };

  // Triggered by the amount step itself when the poster commits to an amount
  // (preset tap or custom Continue) that exceeds their balance — the other
  // entry point into the gate besides the publish-time check above.
  const showInsufficientBalanceFromAmountStep = () => {
    setInsufficientBalanceOrigin('amount_step');
    setShowInsufficientBalance(true);
  };

  return {
    publish,
    /** Raw submit, bypassing the balance gate — matches the existing
     * ErrorBanner retry action, which always called submit() directly. */
    retry: submit,
    isSubmitting,
    submitError,
    resetSubmitError,
    publishedRef,
    funding,
    showInsufficientBalanceFromAmountStep,
  };
}

export default useBountyPublish;
