import { useBountyDraft } from 'app/hooks/useBountyDraft';
import { PublishFundingGate } from 'app/screens/CreateBounty/PublishFundingGate';
import { StepDirectionContext } from 'app/screens/CreateBounty/quick/QuickStepLayout';
import { StepPay } from 'app/screens/CreateBounty/quick/StepPay';
import { StepPhotos } from 'app/screens/CreateBounty/quick/StepPhotos';
import { StepReviewQuick } from 'app/screens/CreateBounty/quick/StepReviewQuick';
import { StepTask } from 'app/screens/CreateBounty/quick/StepTask';
import { StepWhen } from 'app/screens/CreateBounty/quick/StepWhen';
import { StepWhere } from 'app/screens/CreateBounty/quick/StepWhere';
import { useBountyPublish } from 'app/screens/CreateBounty/useBountyPublish';
import { ErrorBanner } from 'components/error-banner';
import { EmailVerificationBanner } from 'components/ui/email-verification-banner';
import { useAuthContext } from 'hooks/use-auth-context';
import { useEmailVerification } from 'hooks/use-email-verification';
import { useBackHandler } from 'hooks/useBackHandler';
import { analyticsService } from 'lib/services/analytics-service';
import { useStripe } from 'lib/stripe-context';
import { getUserFriendlyError } from 'lib/utils/error-messages';
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

  // Posting-funnel bookkeeping. `startedRef`/`currentStepRef` stay local to
  // this orchestrator; `publishedRef` (below) comes from useBountyPublish so
  // post_abandoned never double-counts a completed publish.
  const startedRef = useRef(false);
  // Mirrors `currentStep` for use inside cleanup/callbacks that would
  // otherwise close over a stale value.
  const currentStepRef = useRef(1);

  /** Jump to an arbitrary step (the review screen's Edit links, and the
   * insufficient-balance gate's "Edit amount"). */
  const handleGoToStep = (target: number) => {
    setStepDirection(target >= currentStep ? 1 : -1);
    setCurrentStep(target);
  };

  const {
    publish: handlePublish,
    retry,
    isSubmitting,
    submitError,
    resetSubmitError,
    publishedRef,
    funding,
    showInsufficientBalanceFromAmountStep,
  } = useBountyPublish({
    surface: POST_SURFACE,
    draft,
    clearDraft,
    balance,
    createEscrow,
    paymentMethods,
    sessionUserId: session?.user?.id,
    canPostBounties,
    onPublished: bountyId => onComplete?.(bountyId),
    onEditAmount: () => handleGoToStep(5),
    onCancelGate: onCancel,
  });

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

  if (funding.showTopUp || funding.showInsufficientBalance) {
    return <PublishFundingGate funding={funding} />;
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
              onInsufficientBalance={showInsufficientBalanceFromAmountStep}
            />
          )}
          {currentStep === 6 && (
            <StepReviewQuick
              draft={draft}
              onSubmit={handlePublish}
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
              onDismiss={resetSubmitError}
              onAction={submitError ? () => retry(draft) : undefined}
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default CreateBountyFlow;
