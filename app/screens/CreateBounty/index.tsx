import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { useBountyDraft } from 'app/hooks/useBountyDraft';
import { PublishFundingGate } from 'app/screens/CreateBounty/PublishFundingGate';
import { StepDirectionContext } from 'app/screens/CreateBounty/quick/QuickStepLayout';
import { StepPay } from 'app/screens/CreateBounty/quick/StepPay';
import { StepPhotos } from 'app/screens/CreateBounty/quick/StepPhotos';
import type { DetailTarget } from 'app/screens/CreateBounty/quick/StepPostPublish';
import { StepPostPublish } from 'app/screens/CreateBounty/quick/StepPostPublish';
import { StepTask } from 'app/screens/CreateBounty/quick/StepTask';
import { StepWhen } from 'app/screens/CreateBounty/quick/StepWhen';
import { StepWhere } from 'app/screens/CreateBounty/quick/StepWhere';
import { useBountyPublish } from 'app/screens/CreateBounty/useBountyPublish';
import { bountyService } from 'app/services/bountyService';
import { ErrorBanner } from 'components/error-banner';
import { EmailVerificationBanner } from 'components/ui/email-verification-banner';
import { useAuthContext } from 'hooks/use-auth-context';
import { useEmailVerification } from 'hooks/use-email-verification';
import { useBackHandler } from 'hooks/useBackHandler';
import { analyticsService } from 'lib/services/analytics-service';
import { useStripe } from 'lib/stripe-context';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { createForegroundTimer, getMonotonicNow } from 'lib/utils/foreground-timer';
import { useWallet } from 'lib/wallet-context';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
    KeyboardAvoidingView,
    Platform,
    Text,
    View,
} from 'react-native';
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

/**
 * The two-step flow publishes after the title and the amount — everything
 * else is offered afterwards, on StepPostPublish, against the live bounty.
 */
const TOTAL_STEPS = 2;
const STEP_TITLES = ['Task', 'Compensation'];

/**
 * Identifies this posting surface in the shared posting funnel. The onboarding
 * poster branch (app/onboarding/details.tsx) emits the same events with
 * `surface: 'onboarding'` so both can be analysed as one funnel.
 */
const POST_SURFACE = 'create_flow';

/**
 * The `variant` prop on the post-flow "graveyard" funnel events (see
 * analytics-service.ts). This surface is now the deferred-detail fast path
 * described in useBountyPublish.ts's "6-step (control) and 2-step (two_step)"
 * note, so it reports as `two_step` — funnel comparisons against the old
 * six-step numbers must filter on this, since step_index/step_name no longer
 * mean the same thing.
 */
const POST_FLOW_VARIANT = 'two_step';

/**
 * A poster can leave the app open on a step for a very long time without
 * ever backgrounding it — cap the reported duration so one outlier session
 * doesn't skew the funnel's median/p75, while still flagging it via
 * `seconds_capped` so the dashboard can filter capped sessions out of timing
 * percentiles without dropping them from conversion rates.
 */
const SECONDS_CAP = 1800;

function capSeconds(rawSeconds: number): { seconds: number; capped: boolean } {
  if (rawSeconds > SECONDS_CAP) {
    return { seconds: SECONDS_CAP, capped: true };
  }
  return { seconds: rawSeconds, capped: false };
}

export function CreateBountyFlow({
  onComplete,
  onCancel,
  onStepChange,
  entryPoint = 'unknown',
}: CreateBountyFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  // 1 = advancing, -1 = going back. Read by each step's layout to pick the side
  // it slides in from.
  const [stepDirection, setStepDirection] = useState(1);

  // --- Post-publish phase -------------------------------------------------
  // Non-null once the bounty is live. From here on the flow is no longer
  // editing a draft: `postedDraft` is the published snapshot plus whatever
  // optional details have since been persisted onto the real row.
  const [postedBountyId, setPostedBountyId] = useState<string | null>(null);
  const [postedDraft, setPostedDraft] = useState<BountyDraft | null>(null);
  // Which optional-detail screen is open over the confirmation screen, and the
  // working copy it edits. Kept separate from `postedDraft` so backing out of a
  // detail screen discards its edits instead of leaving the confirmation
  // screen showing something that was never saved.
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [detailDraft, setDetailDraft] = useState<BountyDraft | null>(null);
  const [isSavingDetail, setIsSavingDetail] = useState(false);
  // Snapshot of the draft taken when publishing starts, since useBountyPublish
  // calls clearDraft() before it reports back — by the time onPublished runs,
  // `draft` itself has been reset to defaults.
  const publishedDraftRef = useRef<BountyDraft | null>(null);
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
  // flowTimerRef/stepTimerRef accumulate FOREGROUND-ONLY elapsed time (see
  // lib/utils/foreground-timer.ts) so a backgrounded phone call or a poster
  // setting the app down doesn't inflate seconds_total/seconds_on_step.
  // flowTimerRef starts once, at post_flow_started; stepTimerRef resets on
  // every step transition.
  const flowTimerRef = useRef(createForegroundTimer());
  const stepTimerRef = useRef(createForegroundTimer());
  // Guards post_step_viewed against firing more than once for the same step
  // entry — see the post_step_viewed effect below.
  const lastViewedStepRef = useRef<number | null>(null);
  // Backgrounded time for the CURRENT step only, feeding post_step_abandoned's
  // background_seconds. Reset alongside stepTimerRef on every step
  // transition; backgroundedAtRef holds the in-progress segment while
  // currently backgrounded (folded in on the next resume, or read live if
  // still backgrounded when the flow unmounts).
  const stepBackgroundMsRef = useRef(0);
  const backgroundedAtRef = useRef<number | null>(null);
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
          const wasActive = appStateRef.current === 'active';
          const nowActive = next === 'active';
          appStateRef.current = next;

          if (wasActive && !nowActive) {
            flowTimerRef.current.pause();
            stepTimerRef.current.pause();
            backgroundedAtRef.current = getMonotonicNow();
          } else if (!wasActive && nowActive) {
            flowTimerRef.current.resume();
            stepTimerRef.current.resume();
            if (backgroundedAtRef.current !== null) {
              stepBackgroundMsRef.current += getMonotonicNow() - backgroundedAtRef.current;
              backgroundedAtRef.current = null;
            }
          }
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
    // StepPostPublish IS the success confirmation, so the native
    // "Bounty Posted!" alert would be a redundant second one.
    suppressSuccessAlert: true,
    onPublished: (bountyId, meta) => {
      const { seconds: secondsTotal, capped: secondsCapped } = capSeconds(
        flowTimerRef.current.elapsedSeconds()
      );
      analyticsService.trackEvent('bounty_published', {
        category: meta.category,
        amount_cents: meta.amountCents,
        // No category-chip UI exists yet on this arm — always false.
        used_chip: false,
        seconds_total: secondsTotal,
        seconds_capped: secondsCapped,
        variant: POST_FLOW_VARIANT,
      });
      // Hand off to the confirmation screen rather than leaving the flow —
      // onComplete now fires from its Continue button, so the host screen
      // still navigates to the feed, just one screen later.
      setPostedBountyId(bountyId);
      setPostedDraft(publishedDraftRef.current ?? draft);
    },
    onEditAmount: () => handleGoToStep(2),
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

  /** Step 2's CTA. Snapshots the draft first — publishing clears it. */
  const handlePublishFromAmountStep = () => {
    publishedDraftRef.current = draft;
    handlePublish();
  };

  /** Open one of the optional-detail screens over the confirmation screen. */
  const handleAddDetail = (target: DetailTarget) => {
    if (!postedDraft) return;
    setDetailDraft(postedDraft);
    setDetailTarget(target);
    setStepDirection(1);
  };

  /** Back out of a detail screen, discarding its unsaved edits. */
  const handleCancelDetail = () => {
    setDetailTarget(null);
    setDetailDraft(null);
    setStepDirection(-1);
  };

  /**
   * Persist a detail screen's edits onto the LIVE bounty. On failure the
   * working copy is kept and the screen stays open so the poster can retry —
   * nothing here can leave the bounty itself in a bad state, since the row
   * already exists and only optional columns are being written.
   */
  const handleSaveDetail = async () => {
    if (!postedBountyId || !detailDraft || isSavingDetail) return;
    setIsSavingDetail(true);
    try {
      await bountyService.updateBountyDetails(postedBountyId, detailDraft);
      setPostedDraft(detailDraft);
      setDetailTarget(null);
      setDetailDraft(null);
      setStepDirection(-1);
    } catch (error) {
      const userError = getUserFriendlyError(error);
      if (Platform.OS !== 'web') {
        Alert.alert(userError.title, `${userError.message}\n\nYour bounty is still posted.`, [
          { text: 'OK' },
        ]);
      }
    } finally {
      setIsSavingDetail(false);
    }
  };

  /** Confirmation screen's CTA — leaves the flow for the bounty feed. */
  const handleFinish = () => {
    if (postedBountyId && onComplete) {
      onComplete(postedBountyId);
      return true;
    }
    if (onCancel) {
      onCancel();
      return true;
    }
    return false;
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
    // Once published there is nothing to discard and no step to return to —
    // back closes an open detail screen, or leaves for the feed.
    if (postedBountyId) {
      if (detailTarget) {
        handleCancelDetail();
        return true;
      } else {
        return handleFinish();
      }
    }
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
  // the draft load settles so `resumed_draft` reflects whether the poster is
  // resuming or starting cold. `resumed_draft` (snake_case) is the single
  // canonical spelling — it matches the onboarding surface's emit so the two
  // don't fragment the breakdown.
  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;
    flowTimerRef.current.start();
    stepTimerRef.current.start();
    stepBackgroundMsRef.current = 0;
    backgroundedAtRef.current = appStateRef.current === 'active' ? null : getMonotonicNow();
    analyticsService.trackEvent('post_started', {
      surface: POST_SURFACE,
      resumed_draft: Boolean(draft.title?.trim()),
    });
    analyticsService.trackEvent('post_flow_started', {
      variant: POST_FLOW_VARIANT,
      entry_point: entryPoint,
    });
  }, [isLoading, draft.title, entryPoint]);

  // post_step_viewed — per-step drop-off. Emitted exactly ONCE per step
  // entry, including backwards navigation (`direction` disambiguates).
  // lastViewedStepRef is what makes it once-per-entry: this effect also
  // re-runs whenever `isLoading` flips (draft autosaves do that on every
  // keystroke), which previously re-emitted the same step view dozens of
  // times per person. Also fires post_step_completed when the change is a
  // genuine forward advance, timing how long the poster spent on the step
  // they just left.
  useEffect(() => {
    if (isLoading) return;
    if (lastViewedStepRef.current === currentStep) return;

    const previousStep = currentStepRef.current;
    const isFirstEntry = lastViewedStepRef.current === null;
    lastViewedStepRef.current = currentStep;
    currentStepRef.current = currentStep;

    analyticsService.trackEvent('post_step_viewed', {
      surface: POST_SURFACE,
      direction: currentStep >= previousStep ? 'forward' : 'back',
      step_index: currentStep,
      step_name: STEP_TITLES[currentStep - 1],
      variant: POST_FLOW_VARIANT,
    });

    if (!isFirstEntry && currentStep > previousStep) {
      const { seconds, capped } = capSeconds(stepTimerRef.current.elapsedSeconds());
      analyticsService.trackEvent('post_step_completed', {
        step_index: previousStep,
        step_name: STEP_TITLES[previousStep - 1],
        seconds_on_step: seconds,
        seconds_capped: capped,
        variant: POST_FLOW_VARIANT,
      });
    }

    // New step — restart per-step accumulation, including any in-progress
    // background segment (only time backgrounded *on this step* counts).
    stepTimerRef.current.reset();
    stepBackgroundMsRef.current = 0;
    if (backgroundedAtRef.current !== null) {
      backgroundedAtRef.current = getMonotonicNow();
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
        appStateRef.current !== 'active' ? 'background' : (exitMethodRef.current ?? 'tab');
      const { seconds, capped } = capSeconds(stepTimerRef.current.elapsedSeconds());
      // Fold in the still-open background segment when the flow is torn down
      // while backgrounded — the common case for exit_method: 'background'.
      const backgroundMs =
        stepBackgroundMsRef.current +
        (backgroundedAtRef.current === null ? 0 : getMonotonicNow() - backgroundedAtRef.current);
      analyticsService.trackEvent('post_step_abandoned', {
        step_index: currentStepRef.current,
        step_name: STEP_TITLES[currentStepRef.current - 1],
        seconds_on_step: seconds,
        seconds_capped: capped,
        background_seconds: Math.round(backgroundMs / 1000),
        exit_method: exitMethod,
        variant: POST_FLOW_VARIANT,
      });
    };
  }, []);

  if (isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: theme.background }}
      >
        <ActivityIndicator size="large" color={theme.text} />
        <Text className="mt-4" style={{ color: theme.text }}>
          Loading draft...
        </Text>
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
            {/* --- Pre-publish: the two steps that gate posting --- */}
            {!postedBountyId && currentStep === 1 && (
              <StepTask
                draft={draft}
                onUpdate={saveDraft}
                onNext={handleNext}
                step={1}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {!postedBountyId && currentStep === 2 && (
              <StepPay
                draft={draft}
                onUpdate={saveDraft}
                onNext={handlePublishFromAmountStep}
                onBack={handleBack}
                step={2}
                totalSteps={TOTAL_STEPS}
                onInsufficientBalance={showInsufficientBalanceFromAmountStep}
                ctaLabel="Post Bounty"
                isSubmitting={isSubmitting}
              />
            )}

            {/* --- Post-publish: confirmation, plus the optional detail
                screens it opens. These edit `detailDraft` (a working copy) and
                persist onto the live bounty via handleSaveDetail, NOT the
                draft — the draft was cleared at publish. --- */}
            {postedBountyId && postedDraft && !detailTarget && (
              <StepPostPublish
                draft={postedDraft}
                onAddDetail={handleAddDetail}
                onContinue={handleFinish}
                step={TOTAL_STEPS}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {postedBountyId && detailDraft && detailTarget === 'photos' && (
              <StepPhotos
                draft={detailDraft}
                onUpdate={patch => setDetailDraft(prev => (prev ? { ...prev, ...patch } : prev))}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                step={TOTAL_STEPS}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {postedBountyId && detailDraft && detailTarget === 'where' && (
              <StepWhere
                draft={detailDraft}
                onUpdate={patch => setDetailDraft(prev => (prev ? { ...prev, ...patch } : prev))}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                step={TOTAL_STEPS}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {postedBountyId && detailDraft && detailTarget === 'when' && (
              <StepWhen
                draft={detailDraft}
                onUpdate={patch => setDetailDraft(prev => (prev ? { ...prev, ...patch } : prev))}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                step={TOTAL_STEPS}
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
