import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { bountyService } from 'app/services/bountyService';
import { useFormSubmission } from 'hooks/useFormSubmission';
import { analyticsService } from 'lib/services/analytics-service';
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
import { shouldFundNewBountiesWithPhase2 } from 'lib/utils/payment-architecture';
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
  architecture: 1 | 2;
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

      const useV2Payments =
        !draft.isForHonor && draft.amount > 0 && shouldFundNewBountiesWithPhase2();

      if (!useV2Payments && !validateBalance(draft.amount, balance, draft.isForHonor)) {
        analyticsService.trackEvent('post_amount_blocked_by_balance', {
          surface,
          attemptedAmount: draft.amount,
          balance,
          shortfall: Number((draft.amount - balance).toFixed(2)),
          method: 'publish',
        });
        throw new Error(getInsufficientBalanceMessage(draft.amount, balance));
      }

      const { bounty: createdBounty, created } = await bountyService.createBounty(draft);

      if (!createdBounty) {
        throw new Error('Failed to create bounty');
      }

      if (created && !draft.isForHonor && draft.amount > 0) {
        try {
          await analyticsService.trackEvent('payment_architecture_routed', {
            bountyId: String(createdBounty.id),
            version: useV2Payments ? 2 : 1,
            context: 'funding',
          });
        } catch {
          /* analytics is best-effort */
        }

        if (useV2Payments) {
          try {
            try {
              await analyticsService.trackEvent('payment_initiated', {
                bountyId: String(createdBounty.id),
                architecture: 'v2',
                amount: draft.amount,
              });
            } catch {
              /* analytics is best-effort */
            }

            const paymentResult = await bountyPaymentsService.createBountyPayment(
              String(createdBounty.id)
            );

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
            if (confirmedIntent.status !== 'succeeded') {
              throw new Error('Payment was not completed. Please try again.');
            }

            try {
              await analyticsService.trackEvent('escrow_funded', {
                bountyId: String(createdBounty.id),
                architecture: 'v2',
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
      }

      await clearDraft();

      // The single canonical `bounty_published` is emitted by the surface layer
      // (index.tsx onPublished) from this meta plus its own flow-timing props —
      // see PublishedBountyMeta. This hook deliberately no longer emits a
      // terminal event of its own.
      const meta: PublishedBountyMeta = {
        amountCents: toCents(draft.isForHonor ? 0 : draft.amount),
        category: draft.category || 'other',
        architecture: useV2Payments ? 2 : 1,
        surface,
        bountyId: String(createdBounty.id),
        amountDollars: draft.isForHonor ? 0 : draft.amount,
        isForHonor: draft.isForHonor,
        funded: !draft.isForHonor && draft.amount > 0,
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
          isOnline
            ? 'Your bounty has been posted successfully. Hunters will be able to see it and apply.'
            : "You're offline. Your bounty will be posted automatically when you reconnect.",
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
  const publish = () => {
    const useV2Payments =
      !draft.isForHonor && draft.amount > 0 && shouldFundNewBountiesWithPhase2();

    if (!useV2Payments && !validateBalance(draft.amount, balance, draft.isForHonor)) {
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
