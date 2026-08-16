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
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
  onStepChange?: (step: number) => void;
  /** Where this flow was opened from — the `post_flow_started` funnel prop.
   * Defaults to 'unknown' rather than being required, since a couple of
   * older/test call sites don't pass it. */
  entryPoint?: string;
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

/**
 * The `variant` prop on the post-flow "graveyard" funnel events (see
 * analytics-service.ts). Hardcoded until the redesigned fast-path flow
 * (chips, price anchor, deferred detail fields) exists as a second arm —
 * see useBountyPublish.ts's "6-step (control) and 2-step (two_step)" note.
 */
const POST_FLOW_VARIANT = 'control';

export function CreateBountyFlow({ onComplete, onCancel, onStepChange, entryPoint = 'unknown' }: CreateBountyFlowProps) {
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

  // "Graveyard" funnel bookkeeping (post_flow_started/post_step_completed/
  // post_step_abandoned/bounty_published — see analytics-service.ts).
  const flowStartedAtRef = useRef<number | null>(null);
  const stepEnteredAtRef = useRef<number>(Date.now());
  const titleTypedFiredRef = useRef(false);
  // Set right before an explicit exit path runs, so the post_step_abandoned
  // cleanup below can attribute *why* the flow was left. Left null when the
  // unmount is caused by something this component can't see directly (e.g.
  // the host screen switching bottom-nav tabs while this flow is still
  // mounted) — that residual case reads as 'tab'.
  const exitMethodRef = useRef<'back' | 'close' | 'tab' | 'background' | null>(null);
  // Tracks whether the app itself is foregrounded, independent of in-app
  // navigation, so an abandon that happens while backgrounded is attributed
  // to 'background' rather than whatever in-app exit path happens to run
  // after the fact.
  const appStateRef = useRef(AppState?.currentState ?? 'active');

  useEffect(() => {
    let subscription: { remove?: () => void } | null = null;
    try {
      if (AppState?.addEventListener) {
        subscription = AppState.addEventListener('change', next => {
          appStateRef.current = next;
        });
      }
    } catch {
      // AppState may be unavailable in some test environments; skip gracefully.
    }
    return () => {
      try {
        subscription?.remove?.();
      } catch {
        // best-effort cleanup
      }
    };
  }, []);

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
    onPublished: (bountyId, meta) => {
      analyticsService.trackEvent('bounty_published', {
        category: meta.category,
        amount_cents: meta.amountCents,
        // No category-chip UI exists yet on the control arm — always false.
        used_chip: false,
        seconds_total: flowStartedAtRef.current
          ? Number(((Date.now() - flowStartedAtRef.current) / 1000).toFixed(1))
          : 0,
        variant: POST_FLOW_VARIANT,
      });
      onComplete?.(bountyId);
    },
    onEditAmount: () => handleGoToStep(5),
    onCancelGate: onCancel,
  });

  const handleNext = () => {
    // post_title_typed — fires once, the first time the poster advances past
    // the title step (step 1), regardless of how many times they later
    // return to it.
    if (currentStep === 1 && !titleTypedFiredRef.current) {
      titleTypedFiredRef.current = true;
      analyticsService.trackEvent('post_title_typed', {
        surface: POST_SURFACE,
        // No category-chip UI exists yet on the control arm — always false.
        used_chip: false,
        char_count: (draft.title || '').trim().length,
        variant: POST_FLOW_VARIANT,
      });
    }
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
          {
            text: 'Keep Editing',
            style: 'cancel',
            // Clears a 'back' tag set by the hardware-back handler below so
            // it doesn't leak into a later, unrelated exit.
            onPress: () => {
              exitMethodRef.current = null;
            },
          },
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
    // Android hardware back at step 1 is the only exit path this component
    // can directly attribute — tag it before handleCancel's confirm dialog
    // runs so the eventual post_step_abandoned reflects it.
    exitMethodRef.current = 'back';
    handleCancel();
    return true;
  }, true);

  useEffect(() => {
    onStepChange?.(currentStep);
  }, [currentStep, onStepChange]);

  // post_started / post_flow_started — once per entry into the flow, after
  // the draft load settles so `resumedDraft` reflects whether the poster is
  // resuming or starting cold.
  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;
    flowStartedAtRef.current = Date.now();
    stepEnteredAtRef.current = Date.now();
    analyticsService.trackEvent('post_started', {
      surface: POST_SURFACE,
      resumedDraft: Boolean(draft.title?.trim()),
    });
    analyticsService.trackEvent('post_flow_started', {
      variant: POST_FLOW_VARIANT,
      entry_point: entryPoint,
    });
  }, [isLoading, draft.title, entryPoint]);

  // post_step_viewed — per-step drop-off. Emitted on every step change,
  // including backwards navigation (`direction` disambiguates). Also fires
  // post_step_completed when the change is a genuine forward advance, timing
  // how long the poster spent on the step they just left.
  useEffect(() => {
    const previousStep = currentStepRef.current;
    const previousStepEnteredAt = stepEnteredAtRef.current;
    currentStepRef.current = currentStep;
    stepEnteredAtRef.current = Date.now();
    if (isLoading) return;

    analyticsService.trackEvent('post_step_viewed', {
      surface: POST_SURFACE,
      step: currentStep,
      stepTitle: STEP_TITLES[currentStep - 1],
      direction: currentStep >= previousStep ? 'forward' : 'back',
      step_index: currentStep,
      step_name: STEP_TITLES[currentStep - 1],
      variant: POST_FLOW_VARIANT,
    });

    if (currentStep > previousStep) {
      analyticsService.trackEvent('post_step_completed', {
        step_index: previousStep,
        step_name: STEP_TITLES[previousStep - 1],
        seconds_on_step: Number(((Date.now() - previousStepEnteredAt) / 1000).toFixed(1)),
        variant: POST_FLOW_VARIANT,
      });
    }
  }, [currentStep, isLoading]);

  // post_abandoned / post_step_abandoned — fires when the flow unmounts
  // without a publish. Covers both explicit cancel and navigating away,
  // which the cancel handler alone would miss.
  useEffect(() => {
    return () => {
      if (!startedRef.current || publishedRef.current) return;
      analyticsService.trackEvent('post_abandoned', {
        surface: POST_SURFACE,
        step: currentStepRef.current,
        stepTitle: STEP_TITLES[currentStepRef.current - 1],
      });
      // Backgrounding is the strongest available signal — if the app isn't
      // foregrounded right now, prefer that over an in-app exit path that
      // may just be the host screen tearing this component down as a side
      // effect of the same background/resume cycle. Otherwise fall back to
      // whatever explicit exit path set exitMethodRef, or 'tab' as the
      // residual bucket (e.g. the host screen switching bottom-nav tabs,
      // which unmounts this component directly without going through
      // handleCancel at all).
      const exitMethod: 'back' | 'close' | 'tab' | 'background' =
        appStateRef.current !== 'active' ? 'background' : exitMethodRef.current ?? 'tab';
      analyticsService.trackEvent('post_step_abandoned', {
        step_index: currentStepRef.current,
        step_name: STEP_TITLES[currentStepRef.current - 1],
        seconds_on_step: Number(((Date.now() - stepEnteredAtRef.current) / 1000).toFixed(1)),
        exit_method: exitMethod,
        variant: POST_FLOW_VARIANT,
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
