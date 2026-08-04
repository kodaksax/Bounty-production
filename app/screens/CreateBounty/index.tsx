import { useBountyDraft } from 'app/hooks/useBountyDraft';
// Quick flow step screens. The previous long-form steps (StepTitle,
// StepDetails, StepSchedule, StepCompensation, StepLocation, StepReview) are
// preserved alongside these but are no longer rendered.
import { StepDirectionContext } from 'app/screens/CreateBounty/quick/QuickStepLayout';
import { StepPay } from 'app/screens/CreateBounty/quick/StepPay';
import { StepPhotos } from 'app/screens/CreateBounty/quick/StepPhotos';
import { StepReviewQuick } from 'app/screens/CreateBounty/quick/StepReviewQuick';
import { StepTask } from 'app/screens/CreateBounty/quick/StepTask';
import { StepWhen } from 'app/screens/CreateBounty/quick/StepWhen';
import { StepWhere } from 'app/screens/CreateBounty/quick/StepWhere';
import { bountyService } from 'app/services/bountyService';
import { ErrorBanner } from 'components/error-banner';
import { EmailVerificationBanner } from 'components/ui/email-verification-banner';
import { useAuthContext } from 'hooks/use-auth-context';
import { useEmailVerification } from 'hooks/use-email-verification';
import { useBackHandler } from 'hooks/useBackHandler';
import { useFormSubmission } from 'hooks/useFormSubmission';
import { analyticsService } from 'lib/services/analytics-service';
import { bountyPaymentsService } from 'lib/services/bounty-payments-service';
import { offlineQueueService } from 'lib/services/offline-queue-service';
import { stripeService } from 'lib/services/stripe-service';
import { useStripe } from 'lib/stripe-context';
import { getInsufficientBalanceMessage, validateBalance } from 'lib/utils/bounty-validation';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { shouldFundNewBountiesWithPhase2 } from 'lib/utils/payment-architecture';
import { useWallet } from 'lib/wallet-context';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
  onStepChange?: (step: number) => void;
}

const TOTAL_STEPS = 6;
const STEP_TITLES = [
  'Task',
  'Photos',
  'Location',
  'Schedule',
  'Compensation',
  'Review & Confirm',
];

/**
 * Identifies this posting surface in the shared posting funnel. The onboarding
 * poster branch (app/onboarding/details.tsx) emits the same events with
 * `surface: 'onboarding'` so both can be analysed as one funnel.
 */
const POST_SURFACE = 'create_flow';

export function CreateBountyFlow({ onComplete, onCancel, onStepChange }: CreateBountyFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  // 1 = advancing, -1 = going back. Read by each step's layout to pick the side
  // it slides in from.
  const [stepDirection, setStepDirection] = useState(1);
  const { session } = useAuthContext();
  const { draft, saveDraft, clearDraft, isLoading } = useBountyDraft(session?.user?.id);
  const insets = useSafeAreaInsets();
  const { createEscrow, balance } = useWallet();
  const { paymentMethods } = useStripe();
  const { theme } = useAppThemeContext();
  const { isEmailVerified, canPostBounties, userEmail } = useEmailVerification();

  // Posting-funnel bookkeeping. `publishedRef` distinguishes a real abandon
  // (user backed out) from unmounting after a successful publish, so
  // `post_abandoned` never double-counts a completed post.
  const startedRef = useRef(false);
  const publishedRef = useRef(false);
  // Mirrors `currentStep` for use inside cleanup/callbacks that would
  // otherwise close over a stale value.
  const currentStepRef = useRef(1);

  // Use form submission hook with debouncing
  const {
    submit,
    isSubmitting,
    error: submitError,
    reset,
  } = useFormSubmission(
    async () => {
      // Email verification gate: Block posting if email not verified
      if (!canPostBounties) {
        throw new Error(
          'Please verify your email address before posting bounties. Check your inbox for the verification link.'
        );
      }

      // Route new paid bounties to the Stripe-native Phase 2 escrow path when
      // enabled; existing/legacy bounties always keep the custodial wallet
      // flow they were created with (see lib/utils/payment-architecture.ts).
      const useV2Payments =
        !draft.isForHonor && draft.amount > 0 && shouldFundNewBountiesWithPhase2();

      // Check balance before posting using shared validation (for non-honor,
      // v1 bounties). The v2 path charges a card directly via Stripe, so the
      // custodial wallet balance is not relevant there.
      if (!useV2Payments && !validateBalance(draft.amount, balance, draft.isForHonor)) {
        // The hard stop: poster composed a priced bounty, reached Publish, and
        // is refused because their wallet was never funded — with no way to
        // add funds from here. This is the terminal form of the funnel's
        // biggest leak, so it is counted separately from the preset-tap block.
        analyticsService.trackEvent('post_amount_blocked_by_balance', {
          surface: POST_SURFACE,
          attemptedAmount: draft.amount,
          balance,
          shortfall: Number((draft.amount - balance).toFixed(2)),
          method: 'publish',
        });
        throw new Error(getInsufficientBalanceMessage(draft.amount, balance));
      }

      // Create the bounty first (before deducting funds to prevent loss on failure).
      // The service may return `created: false` when this submission is an
      // idempotent retry of a recent identical create (double-tap / network
      // retry). In that case the original call already funded escrow, so we
      // must NOT fund escrow again.
      const { bounty: createdBounty, created } = await bountyService.createBounty(draft);

      if (!createdBounty) {
        throw new Error('Failed to create bounty');
      }

      // Only create escrow for fresh creates of paid bounties.
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

            // Confirm the PaymentIntent against the poster's saved payment
            // method. This codebase does not use Stripe's PaymentSheet UI
            // component — card confirmation goes through stripeService
            // directly, the same call used by the wallet deposit flow (see
            // hooks/use-wallet-deposit.ts / lib/stripe-context.tsx).
            const paymentMethodId = paymentMethods[0]?.id;
            if (!paymentMethodId) {
              throw new Error('No payment method available. Please add a payment method first.');
            }
            const confirmedIntent = await stripeService.confirmPaymentSecure(
              paymentResult.clientSecret,
              paymentMethodId,
              undefined,
              { userId: session?.user?.id }
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
            // Best-effort: cancel the PaymentIntent server-side before rolling
            // back the bounty (no-ops safely if it never reached create).
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
            await createEscrow(createdBounty.id, draft.amount, draft.title, session?.user?.id ?? '');
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
            // If escrow creation fails, delete the bounty to maintain consistency
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

      // post_published — the funnel's terminal step for the poster. Guarded on
      // `created` so an idempotent retry of an already-published bounty (see
      // bountyService.createBounty) doesn't double-count. `funded` is the
      // headline metric: did this published bounty have real money on it.
      if (created) {
        publishedRef.current = true;
        analyticsService.trackEvent('post_published', {
          surface: POST_SURFACE,
          bountyId: String(createdBounty.id),
          amount: draft.isForHonor ? 0 : draft.amount,
          isForHonor: draft.isForHonor,
          funded: !draft.isForHonor && draft.amount > 0,
          category: draft.category || 'none',
          workType: draft.workType,
          architecture: useV2Payments ? 2 : 1,
          queuedOffline: !isOnline,
        });
      }

      // Clear draft on success
      await clearDraft();

      if (Platform.OS === 'web') {
        // Alert.alert is a no-op on web — navigate immediately after success
        if (onComplete) {
          onComplete(createdBounty.id.toString());
        }
      } else {
        Alert.alert(
          isOnline ? 'Bounty Posted! 🎉' : 'Bounty Queued! 📋',
          isOnline
            ? 'Your bounty has been posted successfully. Hunters will be able to see it and apply.'
            : "You're offline. Your bounty will be posted automatically when you reconnect.",
          [
            {
              text: isOnline ? 'View Bounty' : 'OK',
              onPress: () => {
                if (onComplete) {
                  onComplete(createdBounty.id.toString());
                }
              },
            },
          ]
        );
      }
    },
    {
      debounceMs: 1000,
      onError: error => {
        const userError = getUserFriendlyError(error);
        // Always log the raw error so it appears in Metro/device logs regardless of platform
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

  useEffect(() => {
    if (!isLoading) {
      // Draft is already saved via saveDraft calls in step components
    }
  }, [draft, isLoading]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      const next = currentStep + 1;
      setStepDirection(1);
      setCurrentStep(next);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      const prev = currentStep - 1;
      setStepDirection(-1);
      setCurrentStep(prev);
    }
  };

  /** Jump to an arbitrary step (the review screen's Edit links). */
  const handleGoToStep = (target: number) => {
    setStepDirection(target >= currentStep ? 1 : -1);
    setCurrentStep(target);
  };

  const handleCancel = () => {
    if (Platform.OS === 'web') {
      // Alert.alert is a no-op on web — call onCancel directly
      if (onCancel) onCancel();
    } else {
      Alert.alert(
        'Discard Draft?',
        'Your progress will be saved. You can return to this draft anytime.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Exit',
            style: 'destructive',
            onPress: () => {
              if (onCancel) onCancel();
            },
          },
        ]
      );
    }
  };

  useBackHandler(() => {
    if (currentStep > 1) {
      handleBack();
      return true;
    }
    handleCancel();
    return true;
  }, true);

  useEffect(() => {
    onStepChange?.(currentStep);
  }, [currentStep, onStepChange]);

  // post_started — once per entry into the flow, after the draft load settles
  // so `resumedDraft` reflects whether the poster is resuming or starting cold.
  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;
    analyticsService.trackEvent('post_started', {
      surface: POST_SURFACE,
      resumedDraft: Boolean(draft.title?.trim()),
    });
  }, [isLoading, draft.title]);

  // post_step_viewed — per-step drop-off. Emitted on every step change,
  // including backwards navigation (`direction` disambiguates).
  useEffect(() => {
    const previous = currentStepRef.current;
    currentStepRef.current = currentStep;
    if (isLoading) return;
    analyticsService.trackEvent('post_step_viewed', {
      surface: POST_SURFACE,
      step: currentStep,
      stepTitle: STEP_TITLES[currentStep - 1],
      direction: currentStep >= previous ? 'forward' : 'back',
    });
  }, [currentStep, isLoading]);

  // post_abandoned — fires when the flow unmounts without a publish. Covers
  // both explicit cancel and navigating away, which the cancel handler alone
  // would miss.
  useEffect(() => {
    return () => {
      if (!startedRef.current || publishedRef.current) return;
      analyticsService.trackEvent('post_abandoned', {
        surface: POST_SURFACE,
        step: currentStepRef.current,
        stepTitle: STEP_TITLES[currentStepRef.current - 1],
      });
    };
  }, []);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.text} />
        <Text className="mt-4" style={{ color: theme.text }}>Loading draft...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      <View className="flex-1">
        {!isEmailVerified && <EmailVerificationBanner email={userEmail} />}

        <StepDirectionContext.Provider value={stepDirection}>
        <View className="flex-1">
          {currentStep === 1 && (
            <StepTask
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              step={1}
              totalSteps={TOTAL_STEPS}
            />
          )}
          {currentStep === 2 && (
            <StepPhotos
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
              step={2}
              totalSteps={TOTAL_STEPS}
            />
          )}
          {currentStep === 3 && (
            <StepWhere
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
              step={3}
              totalSteps={TOTAL_STEPS}
            />
          )}
          {currentStep === 4 && (
            <StepWhen
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
              step={4}
              totalSteps={TOTAL_STEPS}
            />
          )}
          {currentStep === 5 && (
            <StepPay
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
              step={5}
              totalSteps={TOTAL_STEPS}
            />
          )}
          {currentStep === 6 && (
            <StepReviewQuick
              draft={draft}
              onSubmit={submit}
              onBack={handleBack}
              onEdit={handleGoToStep}
              isSubmitting={isSubmitting}
              step={6}
              totalSteps={TOTAL_STEPS}
            />
          )}
        </View>
        </StepDirectionContext.Provider>

        {submitError && (
          <View className="px-4 pb-4">
            <ErrorBanner
              error={getUserFriendlyError(submitError)}
              onDismiss={reset}
              onAction={submitError ? () => submit(draft) : undefined}
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default CreateBountyFlow;
