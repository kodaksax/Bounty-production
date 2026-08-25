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
  Platform,
  Text,
  View,
} from 'react-native';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
  onStepChange?: (step: number) => void;
  /** Where this flow was opened from — the `post_flow_started` funnel prop.
   * Defaults to 'unknown' rather than being required, since a couple of
   * older/test call sites don't pass it. */
  entryPoint?: string;
  /**
   * Attests that THIS mount was caused by an explicit "Post a bounty" tap
   * (a bottom-nav press, a segmented-control tab press, an empty-state CTA
   * — not a screen simply defaulting to showing the composer). Gates
   * `post_flow_started` — see the event's doc comment in
   * lib/services/analytics-service.ts for why this exists. Defaults to
   * false so an unaudited call site under-reports rather than silently
   * re-introducing the leak.
   */
  deliberateTap?: boolean;
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
  deliberateTap = false,
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
  // The authoritative copy of the in-progress detail edits. `detailDraft`
  // state drives rendering; this ref is what actually gets persisted. They
  // exist separately because the step screens patch and advance within a
  // single tick — StepWhere geocodes the typed address, calls onUpdate with
  // the coordinates, then immediately calls onNext — and `detailDraft` read
  // during that same tick is still the pre-patch value, so the last edit
  // before Continue (coordinates, a batch of uploaded photos) would never
  // reach the bounty row.
  const detailDraftRef = useRef<BountyDraft | null>(null);
  // Snapshot of the draft taken when publishing starts, since useBountyPublish
  // calls clearDraft() before it reports back — by the time onPublished runs,
  // `draft` itself has been reset to defaults.
  const publishedDraftRef = useRef<BountyDraft | null>(null);
  const { session } = useAuthContext();
  const { draft, saveDraft, clearDraft, isLoading } = useBountyDraft(session?.user?.id);
  const { createEscrow, balance } = useWallet();
  const { paymentMethods } = useStripe();
  const { theme } = useAppThemeContext();
  const { isEmailVerified, canPostBounties, userEmail } = useEmailVerification();

  // Posting-funnel bookkeeping. These stay local to this orchestrator;
  // `publishedRef` (below) comes from useBountyPublish so post_abandoned
  // never double-counts a completed publish.
  //
  // TWO distinct "started" notions, deliberately not merged:
  //
  //  - `flowMountedRef` — the composer finished mounting and its draft
  //    settled. This is a RENDER fact, not a user fact: the host screen
  //    mounts this component whenever the Post tab is selected (see
  //    app/tabs/bounty-app.tsx's `{activeScreen === "postings" && ...}`),
  //    so it is also true for someone who merely tapped through the tab
  //    bar. It gates the "graveyard" funnel's timers and
  //    post_step_abandoned, whose denominator is post_flow_started.
  //
  //  - `composerStartedRef` — the poster actually interacted with the
  //    composer. Gates post_started/post_abandoned. See
  //    markComposerStarted() below for why this exists.
  const flowMountedRef = useRef(false);
  const composerStartedRef = useRef(false);
  // Whether a saved draft was already present when the poster ARRIVED, not
  // whether one exists by the time they first interact. Snapshotted at
  // mount-settle because post_started now fires later than that, and by then
  // the poster's own first keystroke would make every start look "resumed".
  const resumedDraftRef = useRef(false);
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
  // Snapshots `deliberateTap` at construction — a ref initializer runs only
  // on this instance's first render, so a later prop change (or a parent
  // re-render that leaves this component mounted) can't retroactively flip
  // whether the mount that already fired post_flow_started counted as
  // deliberate.
  const deliberateTapRef = useRef(deliberateTap);
  // Same reasoning as deliberateTapRef, plus it keeps the unmount effect
  // below (deps: []) from closing over a stale prop.
  const entryPointRef = useRef(entryPoint);
  // Guards post_field_focused against firing more than once per flow
  // instance — the composer-engagement signal only cares about the FIRST
  // real interaction.
  const fieldFocusedFiredRef = useRef(false);
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
    // Advancing a step is composer intent even if the title arrived from a
    // resumed draft and the poster never focused the field.
    markComposerStarted('step_advance');
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
        deliberate_entry: deliberateTapRef.current,
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
    // Backstop so a publish can never outrun its own funnel start — every
    // realistic path here already went through handleNext.
    markComposerStarted('publish');
    publishedDraftRef.current = draft;
    handlePublish();
  };

  /** Open one of the optional-detail screens over the confirmation screen. */
  const handleAddDetail = (target: DetailTarget) => {
    if (!postedDraft) return;
    detailDraftRef.current = postedDraft;
    setDetailDraft(postedDraft);
    setDetailTarget(target);
    setStepDirection(1);
  };

  /**
   * Apply one step screen's edit to the working copy. Patches compose off the
   * ref rather than off React state so several updates dispatched in the same
   * tick (the upload hook fires onUploaded once per photo in a synchronous
   * loop) all survive instead of the last one clobbering the rest.
   */
  const applyDetailPatch = (patch: Partial<BountyDraft>) => {
    const base = detailDraftRef.current;
    if (!base) return;
    const next = { ...base, ...patch };
    detailDraftRef.current = next;
    setDetailDraft(next);
  };

  /** Back out of a detail screen, discarding its unsaved edits. */
  const handleCancelDetail = () => {
    detailDraftRef.current = null;
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
    // Read the ref, not `detailDraft` — see detailDraftRef's note above: a
    // screen that patches and advances in one tick has not re-rendered yet.
    const pendingDraft = detailDraftRef.current;
    if (!postedBountyId || !pendingDraft || isSavingDetail) return;
    setIsSavingDetail(true);
    try {
      await bountyService.updateBountyDetails(postedBountyId, pendingDraft);
      setPostedDraft(pendingDraft);
      detailDraftRef.current = null;
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

  // Flow mount — starts the graveyard funnel's timers and, for a mount a
  // call site attests was a deliberate "Post a bounty" tap, emits
  // post_flow_started. Runs once the draft load settles.
  //
  // This effect deliberately does NOT emit post_started; see
  // markComposerStarted() below.
  useEffect(() => {
    if (isLoading || flowMountedRef.current) return;
    flowMountedRef.current = true;
    resumedDraftRef.current = Boolean(draft.title?.trim());
    flowTimerRef.current.start();
    stepTimerRef.current.start();
    stepBackgroundMsRef.current = 0;
    backgroundedAtRef.current = appStateRef.current === 'active' ? null : getMonotonicNow();
    if (deliberateTapRef.current) {
      analyticsService.trackEvent('post_flow_started', {
        variant: POST_FLOW_VARIANT,
        entry_point: entryPoint,
        deliberate_entry: true,
      });
    }
  }, [isLoading, draft.title, entryPoint]);

  /**
   * post_started — emitted at most once per composer instance, on the FIRST
   * genuine interaction with the composer.
   *
   * It used to fire from the mount effect above. That was wrong, and
   * measurably so: the host screen mounts this component whenever the Post
   * tab is selected and unmounts it when the poster leaves, so every pass
   * through the tab bar produced a post_started + post_abandoned pair. In
   * production that made the median gap between the two 0.9 seconds, put
   * 100% of post_step_abandoned into `exit_method: 'tab'`, and let single
   * sessions rack up 29 and 35 "composer opens" without a keystroke. The
   * `deliberateTap` gate added for post_flow_started doesn't help here —
   * a bottom-nav tab press IS a deliberate tap, it just isn't intent to
   * compose.
   *
   * So `post_started` now means: the poster typed, focused the title field,
   * advanced a step, or tried to publish. Mount, focus, re-render, back
   * navigation and app resume cannot reach it — none of them call this.
   *
   * `trigger` records which of those it was, so the intent boundary itself
   * stays auditable rather than becoming another unexaminable default.
   */
  const markComposerStarted = (
    trigger: 'field_focus' | 'draft_edit' | 'step_advance' | 'publish'
  ) => {
    if (composerStartedRef.current) return;
    composerStartedRef.current = true;
    analyticsService.trackEvent('post_started', {
      surface: POST_SURFACE,
      // snake_case is the single canonical spelling — it matches the
      // onboarding surface's emit so the two don't fragment the breakdown.
      resumed_draft: resumedDraftRef.current,
      entry_point: entryPointRef.current,
      deliberate_entry: deliberateTapRef.current,
      trigger,
    });
  };

  /** Draft edits are composer intent — wrap saveDraft rather than passing it
   * to the step screens raw. Only real onUpdate calls reach this; nothing
   * writes the draft on mount. */
  const handleDraftUpdate = (patch: Partial<BountyDraft>) => {
    markComposerStarted('draft_edit');
    saveDraft(patch);
  };

  /** post_field_focused — the composer-engagement signal, fired once per
   * flow instance on the first real interaction with the title field (the
   * flow's first screen), regardless of `deliberateTap`. `deliberate_entry`
   * lets this be segmented the same way as the rest of the funnel below —
   * see the `deliberate_entry` note above `bounty_published`. */
  const handleFieldFocused = () => {
    // The earliest reliable intent signal in this UX: the title field is not
    // autoFocused, so reaching here always took a tap.
    markComposerStarted('field_focus');
    if (fieldFocusedFiredRef.current) return;
    fieldFocusedFiredRef.current = true;
    analyticsService.trackEvent('post_field_focused', {
      surface: POST_SURFACE,
      step_index: 1,
      variant: POST_FLOW_VARIANT,
      entry_point: entryPoint,
      deliberate_entry: deliberateTapRef.current,
    });
  };

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
      deliberate_entry: deliberateTapRef.current,
    });

    if (!isFirstEntry && currentStep > previousStep) {
      const { seconds, capped } = capSeconds(stepTimerRef.current.elapsedSeconds());
      analyticsService.trackEvent('post_step_completed', {
        step_index: previousStep,
        step_name: STEP_TITLES[previousStep - 1],
        seconds_on_step: seconds,
        seconds_capped: capped,
        variant: POST_FLOW_VARIANT,
        deliberate_entry: deliberateTapRef.current,
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

  // post_abandoned / post_step_abandoned — fire when the flow unmounts
  // without a publish. Covers both explicit cancel and navigating away,
  // which the cancel handler alone would miss.
  //
  // The two are gated DIFFERENTLY on purpose:
  //  - post_abandoned needs a genuine composer start, so it stays the exact
  //    mirror of post_started. No start, no abandon.
  //  - post_step_abandoned keeps firing for any mounted flow, because its
  //    funnel counterpart (post_flow_started) also counts mounts. Dropping
  //    it here would leave that funnel with starts and no terminations. It
  //    instead carries `composer_started` so incidental tab teardowns can be
  //    filtered out at query time rather than deleted at source.
  useEffect(() => {
    return () => {
      if (!flowMountedRef.current || publishedRef.current) return;
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
        deliberate_entry: deliberateTapRef.current,
        composer_started: composerStartedRef.current,
      });

      // Only a composition that actually began can be abandoned.
      if (!composerStartedRef.current) return;
      analyticsService.trackEvent('post_abandoned', {
        surface: POST_SURFACE,
        step: currentStepRef.current,
        stepTitle: STEP_TITLES[currentStepRef.current - 1],
        // Carried here too so `exit_method: 'tab'` finally means "left a
        // real composition via the tab bar" on at least one event, rather
        // than only ever appearing on mounts nobody engaged with.
        exit_method: exitMethod,
        entry_point: entryPointRef.current,
        deliberate_entry: deliberateTapRef.current,
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
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <View className="flex-1">
        {!isEmailVerified && <EmailVerificationBanner email={userEmail} />}

        <StepDirectionContext.Provider value={stepDirection}>
          <View className="flex-1">
            {/* --- Pre-publish: the two steps that gate posting --- */}
            {!postedBountyId && currentStep === 1 && (
              <StepTask
                draft={draft}
                onUpdate={handleDraftUpdate}
                onNext={handleNext}
                onFieldFocus={handleFieldFocused}
                step={1}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {!postedBountyId && currentStep === 2 && (
              <StepPay
                draft={draft}
                onUpdate={handleDraftUpdate}
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
                onUpdate={applyDetailPatch}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                isSaving={isSavingDetail}
                step={TOTAL_STEPS}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {postedBountyId && detailDraft && detailTarget === 'where' && (
              <StepWhere
                draft={detailDraft}
                onUpdate={applyDetailPatch}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                isSaving={isSavingDetail}
                step={TOTAL_STEPS}
                totalSteps={TOTAL_STEPS}
              />
            )}
            {postedBountyId && detailDraft && detailTarget === 'when' && (
              <StepWhen
                draft={detailDraft}
                onUpdate={applyDetailPatch}
                onNext={handleSaveDetail}
                onBack={handleCancelDetail}
                isSaving={isSavingDetail}
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
    </View>
  );
}

export default CreateBountyFlow;
