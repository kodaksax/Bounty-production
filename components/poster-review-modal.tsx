// components/poster-review-modal.tsx - Modal for poster to review hunter's submission
import { MaterialIcons } from '@expo/vector-icons';
import { userProfileService } from 'lib/services/userProfile';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    Modal,
    PanResponder,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VerificationBadge, type VerificationLevel } from './ui/verification-badge';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { analyticsService } from '../lib/services/analytics-service';
import { approveAndRelease } from '../lib/services/completion-approval';
import { completionService, type CompletionSubmission, type ProofItem } from '../lib/services/completion-service';
import { ratingsService } from '../lib/services/ratings';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import type { Attachment } from '../lib/types';
import { getCurrentUserId } from '../lib/utils/data-utils';
import { useWallet } from '../lib/wallet-context';
import { AttachmentViewerModal } from './attachment-viewer-modal';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { RatingStars } from './ui/rating-stars';
import { KeyboardAwareScrollView } from './ui/keyboard-avoiding';
import { withAlpha } from '../lib/utils';

const EMERALD_SHADOW = {
  shadowColor: '#008E2A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 8,
  elevation: 6,
} as const;

interface PosterReviewModalProps {
  visible: boolean;
  bountyId: string;
  hunterId: string;
  hunterName: string;
  bountyAmount: number;
  isForHonor: boolean;
  // Analytics only: which settlement path a release will use, so
  // escrow_released can be segmented by v1/v2/v3. The caller already has the
  // full bounty row (this component doesn't fetch one), so it's supplied
  // rather than re-derived here.
  architecture?: 'v1' | 'v2' | 'v3';
  /**
   * Open straight on the rating step: a completed job's "Leave a review".
   * The caller checks ratingsService.hasRated first. This never shows the
   * approve/payout step, so it cannot release anything.
   */
  startOnRating?: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const SLIDER_HANDLE_WIDTH = 56;
// Uniform inset (px) between the handle and the track edges when at rest.
// Matches the vertical top/bottom gap so the handle looks centred on all sides.
const SLIDER_HANDLE_INSET = 2;
// Fraction of the track the handle must reach for a release to count as a
// confirm. 0.92 demanded almost the entire width before the gesture "took",
// so near-complete drags were discarded; 0.75 still requires a deliberate
// sweep well past halfway.
const SLIDER_CONFIRM_THRESHOLD = 0.75;
// Snap-back: no overshoot and a gentler speed. The old bounciness:8/speed:12
// recoil read as the control actively rejecting the drag.
const SLIDER_SPRING_BACK = { bounciness: 0, speed: 8 } as const;
// Grows the handle's touch target without changing how it looks. Extra room on
// the right because that is the direction the finger travels.
const SLIDER_HANDLE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 24 } as const;

interface SlideToConfirmProps {
  label: string;
  onConfirmed: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

const SlideToConfirm: React.FC<SlideToConfirmProps> = React.memo(function SlideToConfirm({
  label,
  onConfirmed,
  disabled = false,
  isProcessing = false,
}) {
  const { theme } = useAppThemeContext();
  const ss = useMemo(() => makeSliderStyles(theme), [theme]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const hasConfirmedRef = useRef(false);
  // fillWidth = translateX + (inset + handle width) so the fill always covers
  // from the track's left edge to the handle's right edge with no gap.
  const handleOffset = useRef(new Animated.Value(SLIDER_HANDLE_WIDTH + SLIDER_HANDLE_INSET));
  const accessibilityLabelText = isProcessing ? 'Processing payout' : label;
  // Screen readers (VoiceOver, TalkBack, Switch/Voice Control) confirm with
  // the 'activate' action below, a double tap: no drag is needed, so the hint
  // must not say there is one.
  const accessibilityHintText = 'Double tap to confirm. This cannot be undone.';

  // Maximum translate: leave SLIDER_HANDLE_INSET gap on the right so the
  // handle stops symmetrically with its left-edge inset.
  const maxTranslate = Math.max(trackWidth - SLIDER_HANDLE_WIDTH - SLIDER_HANDLE_INSET * 2, 0);

  // The PanResponder below is created exactly once. It used to be rebuilt by a
  // useMemo keyed on onConfirmed, which the parent passes as a fresh arrow on
  // every render: any re-render mid-drag swapped in an instance whose
  // gestureState was zeroed and had never seen the grant, so dx restarted from
  // 0 and the handle jumped back to the origin. Anything the handlers need
  // that can change between renders is read through this ref instead.
  const latest = useRef({ disabled, isProcessing, maxTranslate, onConfirmed });
  latest.current = { disabled, isProcessing, maxTranslate, onConfirmed };

  // translateX at the moment the drag was granted. Dragging from this offset
  // instead of from 0 keeps the handle under the finger even if the responder
  // is granted part-way along the track.
  const startXRef = useRef(0);

  const settleBack = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: false,
      ...SLIDER_SPRING_BACK,
    }).start(() => { hasConfirmedRef.current = false; });
  }, [translateX]);

  const runConfirm = useCallback(() => {
    const { maxTranslate: max, onConfirmed: confirm } = latest.current;
    hasConfirmedRef.current = true;
    if (max <= 0) { confirm(); return; }
    Animated.timing(translateX, {
      toValue: max,
      duration: 180,
      useNativeDriver: false,
    }).start(() => { confirm(); });
  }, [translateX]);

  useEffect(() => {
    if (!isProcessing && !disabled && hasConfirmedRef.current) {
      Animated.timing(translateX, {
        toValue: 0,
        duration: 160,
        useNativeDriver: false,
      }).start(() => {
        hasConfirmedRef.current = false;
      });
    }
  }, [disabled, isProcessing, translateX]);

  const panResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (panResponderRef.current === null) {
    panResponderRef.current = PanResponder.create({
      // Claim the touch the moment it lands on the handle. This previously
      // returned false and left the decision to onMoveShouldSetPanResponder so
      // that a vertical drag could still scroll the modal — but the handle is a
      // 56px target inside a ScrollView, and by the time the direction was
      // known the ScrollView had already won the responder, so the handle
      // never moved. Claiming on start is what the working swipe-to-confirm in
      // bounty-confirmation-card.tsx does; the ScrollView still scrolls
      // normally anywhere off the handle.
      onStartShouldSetPanResponder: () => !latest.current.disabled && !latest.current.isProcessing,
      onMoveShouldSetPanResponder: () => !latest.current.disabled && !latest.current.isProcessing,
      // Deliberately no onMoveShouldSetPanResponderCapture. Capture propagates
      // root -> target, so a capture handler here runs *after* an ancestor
      // ScrollView's and cannot pre-empt it; all it did was make PanResponder
      // run _updateGestureStateOnMove twice per event (dt === 0 on the second
      // pass, leaving vx/vy NaN and moveX/moveY at -1).
      //
      // Once the drag is ours, keep it. Without this the enclosing ScrollView
      // could take the responder the moment a finger drifted vertically,
      // firing onPanResponderTerminate and snapping the handle back
      // mid-gesture.
      onPanResponderTerminationRequest: () => false,
      // Android: keep the native ScrollView recognizer out of this touch.
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        translateX.stopAnimation((value) => {
          startXRef.current = typeof value === 'number' ? value : 0;
        });
      },
      onPanResponderMove: (_evt, gestureState) => {
        const { maxTranslate: max } = latest.current;
        translateX.setValue(Math.max(0, Math.min(startXRef.current + gestureState.dx, max)));
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const { maxTranslate: max } = latest.current;
        const releaseX = Math.max(0, Math.min(startXRef.current + gestureState.dx, max));
        startXRef.current = 0;
        if (max > 0 && releaseX >= max * SLIDER_CONFIRM_THRESHOLD && !hasConfirmedRef.current) {
          runConfirm();
        } else {
          settleBack();
        }
      },
      onPanResponderTerminate: () => {
        startXRef.current = 0;
        settleBack();
      },
    });
  }
  const panResponder = panResponderRef.current!;

  const fillWidth = useMemo(() => Animated.add(translateX, handleOffset.current), [handleOffset, translateX]);

  return (
    <View style={ss.sliderWrapper}>
      <View
        style={ss.sliderTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        <Animated.View style={[ss.sliderFill, { width: fillWidth }]} />
        <Text style={ss.sliderLabel}>{label}</Text>
        <Animated.View
          style={[ss.sliderHandle, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
          hitSlop={SLIDER_HANDLE_HIT_SLOP}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabelText}
          accessibilityHint={accessibilityHintText}
          accessibilityState={{ disabled: disabled || isProcessing, busy: isProcessing }}
          accessibilityActions={[{ name: 'activate', label: label }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate' && !disabled && !isProcessing && !hasConfirmedRef.current) {
              runConfirm();
            }
          }}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="chevron-right" size={24} color="#fff" />
          )}
        </Animated.View>
      </View>
    </View>
  );
});

export function PosterReviewModal({
  visible,
  bountyId,
  hunterId,
  hunterName,
  bountyAmount,
  isForHonor,
  architecture,
  startOnRating = false,
  onClose,
  onComplete,
}: PosterReviewModalProps) {
  const insets = useSafeAreaInsets();
  const { releaseFunds } = useWallet();
  const { triggerHaptic } = useHapticFeedback();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const accentColor = theme.isDark ? '#1FAE49' : theme.primary;

  const [submission, setSubmission] = useState<CompletionSubmission | null>(null);
  const [hunterProfile, setHunterProfile] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [showPayoutWarning, setShowPayoutWarning] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  // A failed load is not "No submission yet": it says so and offers a retry.
  const [loadFailed, setLoadFailed] = useState(false);
  // Set once approveAndRelease succeeds in this sheet. The rating step then
  // says what just happened, and closing the sheet any way at all still tells
  // the caller to refresh (onComplete), so the page behind it can't keep
  // offering "Review & release payment" for a job that was just approved.
  const [approvedHere, setApprovedHere] = useState(false);
  // isProcessing is React state, so two taps inside one render could both
  // pass it. This ref blocks a second rating or revision send while one is
  // in flight.
  const sendingRef = useRef(false);
  const ratingPromptLoggedRef = useRef(false);

  const formattedPayoutAmount = useMemo(() => {
    try {
      return bountyAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    } catch {
      return `$${Number.isFinite(bountyAmount) ? bountyAmount.toFixed(2) : '0.00'}`;
    }
  }, [bountyAmount]);

  const displayHunterName = hunterProfile?.username || hunterName || submission?.hunter_id || 'Hunter';

  useEffect(() => {
    if (visible) { loadSubmission(); }
  }, [visible, bountyId]);

  useEffect(() => {
    let mounted = true;
    async function loadHunter() {
      const lookupId = hunterId || submission?.hunter_id;
      if (!visible || !lookupId) return;
      try {
        const p = await userProfileService.getProfile(String(lookupId));
        if (!mounted) return;
        setHunterProfile(p);
      } catch (e) {
        console.error('Error loading hunter profile:', e);
      }
    }
    loadHunter();
    return () => { mounted = false; };
  }, [visible, hunterId]);

  useEffect(() => {
    if (!visible) {
      setViewerVisible(false);
      setSelectedAttachment(null);
      setShowPayoutWarning(false);
      setShowRatingForm(false);
      setShowRevisionForm(false);
      setRating(0);
      setRatingComment('');
      setRevisionFeedback('');
      setIsProcessing(false);
      setSubmission(null);
      setHunterProfile(null);
      setLoadFailed(false);
      setApprovedHere(false);
      sendingRef.current = false;
      ratingPromptLoggedRef.current = false;
    }
  }, [visible]);

  // Reopening this modal on a submission that's already approved (from the
  // "Review" tap targets in my-posting-expandable.tsx, or the rating_reminder
  // notification's deep link) should land straight on the rating step rather
  // than the read-only submission view -- unless the poster already rated
  // this hunter for this bounty, in which case there's nothing left to do
  // here. hasRated is a best-effort check: on failure this falls back to not
  // auto-opening the form, which just means the poster sees the submission
  // view instead -- never a hard error.
  useEffect(() => {
    let mounted = true;
    async function checkExistingRating() {
      if (!visible || !submission || submission.status !== 'approved') return;
      const targetHunterId = hunterId || submission?.hunter_id || '';
      const posterId = getCurrentUserId();
      if (!targetHunterId || !posterId) return;
      try {
        const alreadyRated = await ratingsService.hasRated(posterId, bountyId, targetHunterId);
        if (mounted && !alreadyRated) setShowRatingForm(true);
      } catch {
        /* best-effort */
      }
    }
    checkExistingRating();
    return () => { mounted = false; };
  }, [visible, submission, hunterId, bountyId]);

  useEffect(() => {
    if (visible && startOnRating) setShowRatingForm(true);
  }, [visible, startOnRating]);

  useEffect(() => {
    if (showRatingForm && !ratingPromptLoggedRef.current) {
      ratingPromptLoggedRef.current = true;
      void analyticsService
        .trackEvent('rating_prompt_shown', { bountyId: String(bountyId), role: 'poster' })
        .catch(() => {});
    }
  }, [showRatingForm, bountyId]);

  const loadSubmission = async () => {
    try {
      setIsLoading(true);
      setLoadFailed(false);
      const data = await completionService.getSubmission(bountyId);
      setSubmission(data);
    } catch (err) {
      console.error('Error loading submission:', err);
      // Shown inline with a retry (see render). The rating-only sheet doesn't
      // need the submission at all, so it carries on without one.
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (): Promise<boolean> => {
    if (!submission) return false;
    try {
      setIsProcessing(true);
      const ok = await approveAndRelease({
        bountyId,
        hunterId,
        title: `Bounty ${bountyId}`,
        isForHonor,
        amount: bountyAmount,
        posterId: getCurrentUserId(),
        architecture,
        releaseFn: releaseFunds,
        approveFn: async (id: string) => {
          await completionService.approveSubmission(id);
          return true;
        },
        // No notifyFn: the hunter's rating prompt is enqueued by the
        // `trg_completion_review_notification` database trigger when the
        // submission flips to 'approved'. Enqueueing it here never worked —
        // notifications_outbox is service-role only (RLS enabled, no policies),
        // so the insert was rejected and the failure logged to console.
      });

      // `false` usually means the release wasn't confirmed and the work was
      // left unapproved (approveAndRelease never approves before a release
      // succeeds), but it can also mean the release went through and only the
      // approval failed. Neither case is "work approved", and neither is a
      // confirmed "nothing was paid", so the copy claims neither.
      if (!ok) {
        Alert.alert(paymentNotConfirmedTitle(isForHonor), paymentNotConfirmedMessage(isForHonor));
        setShowPayoutWarning(true);
        return false;
      }

      triggerHaptic('success');
      setApprovedHere(true);
      setShowPayoutWarning(false);
      setShowRatingForm(true);
      return true;
    } catch (err) {
      console.error('Error approving completion:', err);
      // approveAndRelease re-throws errors that carry a reason the poster can
      // act on (no payout account, session expired), so show it.
      const reason = err instanceof Error && err.message ? `${err.message}\n\n` : '';
      Alert.alert(paymentNotConfirmedTitle(isForHonor), `${reason}${paymentNotConfirmedMessage(isForHonor)}`);
      setShowPayoutWarning(true);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!submission || sendingRef.current) return;
    if (!revisionFeedback.trim()) {
      Alert.alert('Add Feedback', 'Please provide feedback for the revision request.');
      return;
    }
    sendingRef.current = true;
    try {
      setIsProcessing(true);
      await completionService.requestRevision(submission.id!, revisionFeedback.trim());
      Alert.alert('Revision Requested', 'The hunter has been notified of your feedback and can resubmit.', [
        { text: 'OK', onPress: () => { onClose(); onComplete(); } },
      ]);
    } catch (err) {
      console.error('Error requesting revision:', err);
      // The typed feedback stays in the box, so trying again is one tap.
      Alert.alert("Couldn't send your feedback", "It wasn't sent to the hunter. Check your connection and try again.");
    } finally {
      sendingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Closing after an approval in this sheet always tells the caller to
  // refresh, whichever way the sheet is closed.
  const closeSheet = () => {
    onClose();
    if (approvedHere) onComplete();
  };

  const handleHeaderClose = () => {
    if (showRevisionForm) { setShowRevisionForm(false); return; }
    if (showPayoutWarning) { setShowPayoutWarning(false); return; }
    closeSheet();
  };

  // Android's back button: steps back like the header arrow, and is ignored
  // while a release or rating is being sent so it can't drop the poster out
  // mid-request without knowing how it ended.
  const handleRequestClose = () => {
    if (isProcessing) return;
    handleHeaderClose();
  };

  const handleSubmitRating = async () => {
    if (sendingRef.current) return;
    if (rating === 0) { Alert.alert('Add Rating', 'Please provide a star rating.'); return; }
    const targetHunterId = hunterId || submission?.hunter_id || '';
    if (!targetHunterId) {
      Alert.alert('Missing Hunter', 'Could not determine who to rate. Please try again.');
      return;
    }
    const trimmedComment = ratingComment.trim();
    sendingRef.current = true;
    try {
      setIsProcessing(true);
      await completionService.submitRating({
        bounty_id: bountyId,
        from_user_id: '',
        to_user_id: targetHunterId,
        rating,
        comment: trimmedComment || undefined,
      });
      void analyticsService
        .trackEvent('rating_submitted', {
          bountyId: String(bountyId),
          role: 'poster',
          rating,
          hasComment: trimmedComment.length > 0,
        })
        .catch(() => {});
      if (trimmedComment.length > 0) {
        void analyticsService
          .trackEvent('review_submitted', { bountyId: String(bountyId), role: 'poster' })
          .catch(() => {});
      }
      // Says only what this step did: it saved a review. It used to add
      // "Payment has been released." even from a completed job's "Leave a
      // review", where this sheet releases nothing (and a v3 release is still
      // settling when the rating step first appears).
      Alert.alert(
        'Thanks for your review',
        `You rated ${displayHunterName} ${rating} ${rating === 1 ? 'star' : 'stars'}.`,
        [{ text: 'OK', onPress: () => { onClose(); onComplete(); } }]
      );
    } catch (err) {
      console.error('Error submitting rating:', err);
      // The stars and comment stay on screen, so "Try again" is one tap. It
      // used to close the sheet and throw them away.
      Alert.alert(
        "Couldn't save your review",
        approvedHere
          ? 'Your approval of the work already went through. Only the review was not saved. Check your connection and try again.'
          : 'Your review was not saved. Check your connection and try again.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => { onClose(); onComplete(); } },
          { text: 'Try again', onPress: () => { void handleSubmitRating(); } },
        ]
      );
    } finally {
      sendingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Never holds up the bounty -- payment already went out in handleApprove
  // before this step is ever shown. Skipping just closes the modal; the
  // rating_reminder cron job (fn_remind_pending_hunter_ratings) is what
  // brings the poster back to this same rating step ~24h later if the hunter
  // still has no rating for this bounty.
  const handleSkipRating = () => {
    void analyticsService
      .trackEvent('rating_skipped', { bountyId: String(bountyId), role: 'poster' })
      .catch(() => {});
    onClose();
    onComplete();
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleAttachmentPress = (item: ProofItem) => {
    const remoteUri = (item as any).url && (item as any).url.length > 0
      ? (item as any).url
      : ((item as any).remoteUri && (item as any).remoteUri.length > 0 ? (item as any).remoteUri : undefined);
    const primaryUri = item.uri || remoteUri;
    if (!primaryUri) { Alert.alert('Unavailable', 'This attachment is missing a file reference.'); return; }
    const attachment: Attachment = {
      id: item.id,
      name: item.name || 'Attachment',
      uri: primaryUri,
      remoteUri,
      mimeType: item.mimeType,
      mime: item.mimeType,
      size: item.size,
      status: 'uploaded',
    };
    if (attachment.uri && /^\/\//.test(attachment.uri)) {
      attachment.uri = `https:${attachment.uri}`;
    }
    setSelectedAttachment(attachment);
    setTimeout(() => setViewerVisible(true), 30);
  };

  const renderProofItem = ({ item }: { item: ProofItem }) => {
    const displayName = item.name || 'Attachment';
    return (
      <TouchableOpacity
        style={s.proofItem}
        onPress={() => handleAttachmentPress(item)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`View attachment ${displayName}`}
        accessibilityHint="Opens the attachment in a viewer"
      >
        <View style={s.proofIcon}>
          <MaterialIcons
            name={item.type === 'image' ? 'image' : 'insert-drive-file'}
            size={32}
            color={accentColor}
          />
        </View>
        <View style={s.proofInfo}>
          <Text style={s.proofName} numberOfLines={1}>{displayName}</Text>
          <Text style={s.proofSize}>{formatFileSize(item.size)}</Text>
        </View>
        <MaterialIcons name="open-in-new" size={20} color={theme.textSecondary} />
      </TouchableOpacity>
    );
  };

  if (!visible) return null;

  // Shared by the normal flow (after approval) and startOnRating (a completed
  // job's "Leave a review", which may have no submission row to show).
  const ratingForm = (
    <KeyboardAwareScrollView
      style={s.scrollView}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
    >
      <View style={s.ratingFormContainer}>
        {approvedHere && (
          // The release's only confirmation used to be a haptic. Announced
          // to screen readers as the step changes.
          <View
            style={s.approvedBanner}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="review-approved-banner"
          >
            <MaterialIcons name="check-circle" size={20} color={theme.success} />
            <Text style={s.approvedBannerText}>
              {isForHonor
                ? `Work approved. ${displayHunterName} has been told the job is complete.`
                : architecture === 'v1' || architecture === 'v2'
                  ? `Work approved. ${formattedPayoutAmount} has been released to ${displayHunterName}.`
                  : `Work approved. Your ${formattedPayoutAmount} payment to ${displayHunterName} is being processed.`}
            </Text>
          </View>
        )}
        <MaterialIcons name="star" size={64} color={theme.warningText} />
        <Text style={s.ratingTitle}>Rate {hunterName}</Text>
        <Text style={s.ratingSubtitle}>How would you rate their work on this bounty?</Text>
        <View style={s.ratingStarsContainer}>
          <RatingStars rating={rating} onRatingChange={setRating} size="large" />
        </View>
        <TextInput
          style={s.commentInput}
          placeholder="Add an optional comment (visible to hunter)..."
          placeholderTextColor={theme.textDisabled}
          value={ratingComment}
          onChangeText={setRatingComment}
          multiline
          numberOfLines={4}
          maxLength={500}
          textAlignVertical="top"
        />
        {/* "Submit review", not "Complete Bounty & Rate Hunter": by this step
            the job is already complete, and the old label read as one more
            irreversible step. Dimmed until a star is chosen. */}
        <TouchableOpacity accessibilityRole="button"
          style={[s.primaryButton, (isProcessing || rating === 0) && s.buttonDisabled]}
          onPress={handleSubmitRating}
          disabled={isProcessing || rating === 0}
          accessibilityLabel={isProcessing ? 'Sending your review' : 'Submit review'}
          accessibilityHint={rating === 0 ? 'Choose a star rating first' : undefined}
          accessibilityState={{ disabled: isProcessing || rating === 0, busy: isProcessing }}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={s.buttonText}>Submit review</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.skipRatingButton}
          onPress={handleSkipRating}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel="Skip rating for now"
        >
          <Text style={s.skipRatingText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleRequestClose}
      >
        <View style={[s.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity accessibilityRole="button"
              style={s.closeButton}
              onPress={handleHeaderClose}
              disabled={isProcessing}
              accessibilityLabel={showRevisionForm || showPayoutWarning ? 'Back to previous step' : 'Close'}
              accessibilityState={{ disabled: isProcessing }}
            >
              <MaterialIcons
                name={(showRevisionForm || showPayoutWarning) ? 'arrow-back' : 'close'}
                size={24}
                color={theme.text}
              />
            </TouchableOpacity>
            <Text style={s.headerTitle} accessibilityRole="header">
              {showRevisionForm
                ? 'Request Changes'
                : showPayoutWarning
                  ? 'Confirm Payout'
                  : showRatingForm || startOnRating
                    ? 'Leave a review'
                    : 'Review Submission'}
            </Text>
            <View style={s.headerSpacer} />
          </View>

          {isLoading ? (
            <View style={s.loadingContainer} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" color={theme.primaryLight} />
              <Text style={s.loadingText}>{startOnRating ? 'Opening your review…' : 'Loading the submitted work…'}</Text>
            </View>
          ) : startOnRating && showRatingForm ? (
            ratingForm
          ) : loadFailed ? (
            <View style={s.emptyContainer} accessibilityRole="alert" testID="review-load-failed">
              <MaterialIcons name="cloud-off" size={64} color={theme.textSecondary} />
              <Text style={s.emptyText}>{"Couldn't load the submitted work"}</Text>
              <Text style={s.emptySubtext}>
                {"Check your connection and try again. Opening this screen doesn't approve or pay anything."}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={s.retryButton}
                onPress={() => { void loadSubmission(); }}
              >
                <Text style={s.buttonText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : !submission ? (
            <View style={s.emptyContainer}>
              <MaterialIcons name="inbox" size={64} color={accentColor} />
              <Text style={s.emptyText}>No submission yet</Text>
              <Text style={s.emptySubtext}>Waiting for {displayHunterName} to submit their work.</Text>
            </View>
          ) : showPayoutWarning ? (
            <ScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
              // Scrolling stays on here. It was disabled as a workaround for the
              // slide-to-confirm handle losing every gesture to this ScrollView;
              // the handle now claims the responder on touch-down and refuses
              // termination, so the two no longer fight and the payout copy can
              // still scroll on short screens.
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.payoutWarningContainer}>
                <View style={s.warningIcon}>
                  <MaterialIcons name="warning" size={28} color={theme.warningText} />
                </View>
                <Text style={s.warningTitle}>Complete and release payment?</Text>
                <Text style={s.warningDescription}>
                  {isForHonor
                    ? 'Completing this bounty will mark the work as finished for honor and alert the hunter.'
                    : `This will mark the bounty as completed and release ${formattedPayoutAmount} to ${displayHunterName}.`}
                </Text>
                {!isForHonor && bountyAmount > 0 && (
                  <View style={s.warningAmountChip}>
                    <MaterialIcons name="account-balance-wallet" size={16} color={theme.warningText} />
                    <Text style={s.warningAmountText}>{formattedPayoutAmount} escrow release</Text>
                  </View>
                )}
                <Text style={s.warningFootnote}>Once you continue, this action cannot be undone.</Text>
              </View>

              <SlideToConfirm
                label={
                  isProcessing
                    ? 'Processing payout…'
                    : isForHonor
                      ? 'Slide to mark complete'
                      : 'Slide to confirm payout'
                }
                onConfirmed={() => { handleApprove(); }}
                disabled={isProcessing}
                isProcessing={isProcessing}
              />

              <View style={s.warningActions}>
                <TouchableOpacity accessibilityRole="button"
                  style={[s.warningCancelButton, isProcessing && s.buttonDisabled]}
                  onPress={() => setShowPayoutWarning(false)}
                  disabled={isProcessing}
                >
                  <MaterialIcons name="arrow-back" size={18} color={theme.textSecondary} />
                  <Text style={s.warningCancelText}>Back to review</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : showRatingForm ? (
            ratingForm
          ) : showRevisionForm ? (
            <KeyboardAwareScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
            >
              <View style={s.revisionFormContainer}>
                <MaterialIcons name="feedback" size={64} color={theme.warningText} />
                <Text style={s.revisionTitle}>Request Changes</Text>
                <Text style={s.revisionSubtitle}>Explain what needs to be improved or changed.</Text>
                <TextInput
                  style={s.feedbackInput}
                  placeholder="Describe the changes needed..."
                  placeholderTextColor={theme.textDisabled}
                  value={revisionFeedback}
                  onChangeText={setRevisionFeedback}
                  multiline
                  numberOfLines={6}
                  maxLength={1000}
                  textAlignVertical="top"
                />
                <View style={s.buttonRow}>
                  <TouchableOpacity accessibilityRole="button" style={s.secondaryButton} onPress={() => setShowRevisionForm(false)}>
                    <Text style={s.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button"
                    style={[s.primaryButton, isProcessing && s.buttonDisabled]}
                    onPress={handleRequestRevision}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.buttonText}>Send Feedback</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAwareScrollView>
          ) : (
            <ScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
            >
              <View style={s.hunterInfo}>
                <Avatar style={s.hunterAvatar}>
                  <AvatarImage src={hunterProfile?.avatar || undefined} alt={hunterProfile?.username || displayHunterName} />
                  <AvatarFallback>
                    <Text style={s.avatarFallbackText}>
                      {(hunterProfile?.username || displayHunterName)?.charAt(0)?.toUpperCase() || '?'}
                    </Text>
                  </AvatarFallback>
                </Avatar>
                <View style={s.hunterDetails}>
                  <View style={s.hunterNameRow}>
                    <Text style={s.hunterName}>{hunterProfile?.username || displayHunterName}</Text>
                    {hunterProfile?.verificationStatus && hunterProfile.verificationStatus !== 'unverified' && (
                      <VerificationBadge
                        status={hunterProfile.verificationStatus as VerificationLevel}
                        size="small"
                        showLabel={false}
                        showExplanation={false}
                      />
                    )}
                  </View>
                  <Text style={s.submittedText}>
                    Submitted {new Date(submission.submitted_at!).toLocaleDateString()}
                  </Text>
                </View>
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>Message from Hunter</Text>
                <View style={s.messageBox}>
                  <Text style={s.messageText}>{submission.message}</Text>
                </View>
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>Proof of Completion</Text>
                {submission.proof_items && submission.proof_items.length > 0 ? (
                  <FlatList
                    data={submission.proof_items}
                    renderItem={renderProofItem}
                    keyExtractor={(item) => item.id}
                    scrollEnabled={false}
                    contentContainerStyle={s.proofList}
                  />
                ) : (
                  <View style={s.emptyProof}>
                    <Text style={s.emptyProofText}>No proof attached</Text>
                  </View>
                )}
              </View>

              {/* Action buttons — unique colors preserved */}
              <View style={s.actionButtons}>
                <TouchableOpacity accessibilityRole="button"
                  style={s.rejectButton}
                  onPress={() => setShowRevisionForm(true)}
                  disabled={isProcessing}
                >
                  <MaterialIcons name="feedback" size={20} color="#fff" />
                  <Text style={s.rejectButtonText}>Request Changes</Text>
                </TouchableOpacity>

                <TouchableOpacity accessibilityRole="button"
                  style={[s.approveButton, isProcessing && s.buttonDisabled]}
                  onPress={() => setShowPayoutWarning(true)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons name="check-circle" size={20} color="#fff" />
                      <Text style={s.approveButtonText}>Proceed to Payout</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>

        <AttachmentViewerModal
          visible={viewerVisible}
          attachment={selectedAttachment}
          onClose={() => { setViewerVisible(false); setSelectedAttachment(null); }}
        />
      </Modal>
    </>
  );
}

/**
 * A release or approval that didn't confirm. It never says "approved" and
 * never says "nothing was paid": approveAndRelease's false/throw covers both
 * "release didn't happen" and "release went through, approval didn't". So the
 * poster is sent to check the job before trying again.
 */
export function paymentNotConfirmedTitle(isForHonor: boolean): string {
  return isForHonor ? "Couldn't mark this complete" : "Payment not confirmed";
}

export function paymentNotConfirmedMessage(isForHonor: boolean): string {
  return isForHonor
    ? "We couldn't confirm the job was marked complete. Check your connection and try again."
    : "We couldn't confirm the payment went through. Before trying again, close this and check the job's Payment section. If you're unsure, contact support.";
}

function makeSliderStyles(t: AppTheme) {
  return StyleSheet.create({
    sliderWrapper: {
      marginTop: 24,
      marginBottom: 16,
      width: '100%',
    },
    sliderTrack: {
      position: 'relative',
      backgroundColor: t.isDark ? 'rgba(4,120,87,0.4)' : withAlpha(t.primary, 0.15),
      borderRadius: 999,
      height: 60,
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.25) : withAlpha(t.primary, 0.3),
    },
    sliderFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.45) : withAlpha(t.primary, 0.35),
    },
    sliderLabel: {
      color: t.isDark ? 'rgba(255,254,245,0.85)' : t.text,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.4,
      textAlign: 'center',
    },
    sliderHandle: {
      position: 'absolute',
      width: SLIDER_HANDLE_WIDTH,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.primary,
      justifyContent: 'center',
      alignItems: 'center',
      top: SLIDER_HANDLE_INSET,
      left: SLIDER_HANDLE_INSET,
      ...EMERALD_SHADOW,
    },
  });
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: t.isDark ? withAlpha(t.primary, 0.1) : t.border,
    },
    // 44x44: the minimum comfortable target (it was 32x32).
    closeButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSpacer: {
      width: 44,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: t.text,
      fontSize: 18,
      fontWeight: '600',
    },
    retryButton: {
      backgroundColor: t.primary,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 12,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approvedBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      alignSelf: 'stretch',
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(t.success, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(t.success, 0.4),
    },
    approvedBannerText: {
      flex: 1,
      color: t.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '600',
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 20,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
    },
    loadingText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
      gap: 16,
    },
    emptyText: {
      color: t.text,
      fontSize: 18,
      fontWeight: '600',
    },
    emptySubtext: {
      color: t.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
    hunterInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : withAlpha(t.primary, 0.07),
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.3) : withAlpha(t.primary, 0.2),
    },
    hunterAvatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.3) : withAlpha(t.primary, 0.12),
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarFallbackText: {
      fontSize: 20,
      fontWeight: '600',
      color: t.primaryLight,
    },
    hunterDetails: {
      flex: 1,
    },
    hunterNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    hunterName: {
      color: t.text,
      fontSize: 18,
      fontWeight: '600',
    },
    submittedText: {
      color: t.isDark ? t.primaryLight : t.primary,
      fontSize: 13,
      marginTop: 4,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      color: t.isDark ? t.primaryLight : t.primary,
      fontSize: 14,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    messageBox: {
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
    },
    messageText: {
      color: t.text,
      fontSize: 15,
      lineHeight: 22,
    },
    proofList: {
      gap: 12,
    },
    proofItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
      borderRadius: 12,
      padding: 12,
      gap: 12,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
    },
    proofIcon: {
      width: 48,
      height: 48,
      borderRadius: 8,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.3) : withAlpha(t.primary, 0.1),
      justifyContent: 'center',
      alignItems: 'center',
    },
    proofInfo: {
      flex: 1,
      gap: 4,
    },
    proofName: {
      color: t.text,
      fontSize: 14,
      fontWeight: '500',
    },
    proofSize: {
      color: t.isDark ? t.primaryLight : t.primary,
      fontSize: 12,
    },
    emptyProof: {
      padding: 24,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.1) : t.surfaceSecondary,
      borderRadius: 12,
      alignItems: 'center',
    },
    emptyProofText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    actionButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    // Unique colors — kept exactly as designed
    rejectButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.error,
      paddingVertical: 16,
      borderRadius: 12,
    },
    rejectButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    approveButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.primary,
      paddingVertical: 16,
      borderRadius: 12,
      ...EMERALD_SHADOW,
    },
    approveButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    ratingFormContainer: {
      alignItems: 'center',
      gap: 20,
      padding: 20,
    },
    ratingTitle: {
      color: t.text,
      fontSize: 24,
      fontWeight: '700',
    },
    ratingSubtitle: {
      color: t.textSecondary,
      fontSize: 15,
      textAlign: 'center',
    },
    ratingStarsContainer: {
      paddingVertical: 20,
    },
    commentInput: {
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
      borderRadius: 12,
      padding: 16,
      color: t.text,
      fontSize: 15,
      minHeight: 120,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
      width: '100%',
    },
    primaryButton: {
      backgroundColor: t.primary,
      paddingVertical: 16,
      paddingHorizontal: 32,
      borderRadius: 12,
      width: '100%',
      alignItems: 'center',
      ...EMERALD_SHADOW,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    skipRatingButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
    },
    skipRatingText: {
      color: t.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },
    revisionFormContainer: {
      alignItems: 'center',
      gap: 20,
      padding: 20,
    },
    revisionTitle: {
      color: t.text,
      fontSize: 24,
      fontWeight: '700',
    },
    revisionSubtitle: {
      color: t.textSecondary,
      fontSize: 15,
      textAlign: 'center',
    },
    feedbackInput: {
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
      borderRadius: 12,
      padding: 16,
      color: t.text,
      fontSize: 15,
      minHeight: 150,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
      width: '100%',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: t.surfaceSecondary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.primary,
    },
    secondaryButtonText: {
      color: t.primaryLight,
      fontSize: 16,
      fontWeight: '600',
    },
    payoutWarningContainer: {
      gap: 16,
      padding: 20,
      borderRadius: 16,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.18) : withAlpha(t.primary, 0.07),
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.35) : withAlpha(t.primary, 0.2),
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    warningIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: withAlpha(t.warning, 0.15),
      justifyContent: 'center',
      alignItems: 'center',
    },
    warningTitle: {
      color: t.text,
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'center',
    },
    warningDescription: {
      color: t.textSecondary,
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 22,
    },
    // Unique amber chip — kept as designed
    warningAmountChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: withAlpha(t.warning, 0.18),
    },
    warningAmountText: {
      color: t.warningText,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    // The one line that says this can't be undone: full-contrast text at a
    // readable size, not 12px secondary grey.
    warningFootnote: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
    warningActions: {
      alignItems: 'center',
      marginTop: 8,
      gap: 12,
    },
    warningCancelButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 18,
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.35) : t.border,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
    },
    warningCancelText: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
  });
}
