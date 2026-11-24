// components/poster-review-modal.tsx - Modal for poster to review hunter's submission
import { MaterialIcons } from '@expo/vector-icons';
import { userProfileService } from 'lib/services/userProfile';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SlideInScreen } from './ui/slide-in-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { ConsequenceList, FlowTitle, NoteBox } from './poster/blocks';
import { ProofPhotos } from './poster/media';
import { firstName, formatJobAmount } from '../lib/my-jobs/format';
import { AttachmentViewerModal } from './attachment-viewer-modal';
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
  /**
   * Stars already chosen on the workspace (stage I.3). Only prefills the
   * rating step's stars; the poster still sends the review from here.
   */
  initialRating?: number;
  onClose: () => void;
  onComplete: () => void;
}

export function PosterReviewModal({
  visible,
  bountyId,
  hunterId,
  hunterName,
  bountyAmount,
  isForHonor,
  architecture,
  startOnRating = false,
  initialRating,
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
  // Same idea for the release. The "Yes, pay" button is disabled while a
  // release is in flight, but that is state too: two taps in one render
  // must still reach approveAndRelease only once.
  const releasingRef = useRef(false);
  // Second step of approve-and-pay: "Approve and pay $X" opens this
  // confirmation; only its "Yes, pay $X" calls approveAndRelease.
  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const payConfirmQuestionRef = useRef<React.ElementRef<typeof Text> | null>(null);
  const ratingPromptLoggedRef = useRef(false);
  // Bumped on every load and on close, so a load that finishes after the
  // sheet closed (or after a newer load started) changes nothing.
  const loadSeqRef = useRef(0);

  const formattedPayoutAmount = useMemo(() => {
    try {
      return bountyAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    } catch {
      return `$${Number.isFinite(bountyAmount) ? bountyAmount.toFixed(2) : '0.00'}`;
    }
  }, [bountyAmount]);

  const displayHunterName = hunterProfile?.username || hunterName || submission?.hunter_id || 'Hunter';

  // Approve-and-pay copy (Focus-first I / I.2). A for-honor job moves no
  // money, so it never says "pay". Amounts drop whole cents, as in the design.
  const shortAmount = formatJobAmount(bountyAmount);
  const helperFirst = firstName(displayHunterName) ?? displayHunterName;
  const payPrimaryLabel = isForHonor ? 'Approve and mark complete' : `Approve and pay ${helperFirst} ${shortAmount}`;
  const payConfirmQuestion = isForHonor
    ? `Mark this job complete for ${helperFirst}?`
    : `Pay ${helperFirst} ${shortAmount}?`;
  const payYesLabel = isForHonor ? 'Yes, mark complete' : `Yes, pay ${helperFirst} ${shortAmount}`;
  const payBusyLabel = isForHonor ? 'Marking complete' : 'Sending payment';

  useEffect(() => {
    if (visible) { loadSubmission(); }
  }, [visible, bountyId, hunterId]);

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
      setShowPayConfirm(false);
      setShowRatingForm(false);
      setShowRevisionForm(false);
      setRating(0);
      setRatingComment('');
      setRevisionFeedback('');
      setIsProcessing(false);
      setSubmission(null);
      setHunterProfile(null);
      // Reopening starts on the loading state, never on a frame of the
      // previous opening's result.
      setIsLoading(true);
      setLoadFailed(false);
      setApprovedHere(false);
      sendingRef.current = false;
      releasingRef.current = false;
      ratingPromptLoggedRef.current = false;
      loadSeqRef.current += 1;
    }
  }, [visible]);

  // The confirmation replaces the button that had screen-reader focus, so
  // move VoiceOver/TalkBack focus to its question. Otherwise focus can land
  // anywhere and the poster hears nothing about what they're confirming.
  useEffect(() => {
    if (!showPayConfirm) return;
    const timer = setTimeout(() => {
      const node = payConfirmQuestionRef.current;
      if (node && typeof AccessibilityInfo.sendAccessibilityEvent === 'function') {
        AccessibilityInfo.sendAccessibilityEvent(node as any, 'focus');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [showPayConfirm]);

  useEffect(() => {
    if (visible && startOnRating) setShowRatingForm(true);
  }, [visible, startOnRating]);

  useEffect(() => {
    if (visible && startOnRating && initialRating && initialRating >= 1 && initialRating <= 5) {
      setRating(initialRating);
    }
  }, [visible, startOnRating, initialRating]);

  useEffect(() => {
    if (showRatingForm && !ratingPromptLoggedRef.current) {
      ratingPromptLoggedRef.current = true;
      void analyticsService
        .trackEvent('rating_prompt_shown', { bountyId: String(bountyId), role: 'poster' })
        .catch(() => {});
    }
  }, [showRatingForm, bountyId]);

  const loadSubmission = async () => {
    const seq = ++loadSeqRef.current;
    try {
      setIsLoading(true);
      setLoadFailed(false);
      const data = await completionService.getSubmissionForReview(bountyId, hunterId);
      // Reopened on work that's already approved (my-posting-expandable's
      // "Review" taps): land straight on the rating step, unless this hunter
      // was already rated for this bounty. Checked before the loading state
      // ends, so the sheet never shows another step first and then jumps.
      // Best-effort: if the check fails, the sheet just says it's approved.
      let openRating = false;
      if (data?.status === 'approved') {
        const targetHunterId = hunterId || data.hunter_id || '';
        const posterId = getCurrentUserId();
        if (targetHunterId && posterId) {
          try {
            openRating = !(await ratingsService.hasRated(posterId, bountyId, targetHunterId));
          } catch {
            /* best-effort */
          }
        }
      }
      if (seq !== loadSeqRef.current) return;
      setSubmission(data);
      if (openRating) setShowRatingForm(true);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading submission:', err);
      // Shown inline with a retry (see render). The rating-only sheet doesn't
      // need the submission at all, so it carries on without one.
      setLoadFailed(true);
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  };

  const handleApprove = async (): Promise<boolean> => {
    if (!submission || releasingRef.current) return false;
    releasingRef.current = true;
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
        // Back to the single "Approve and pay" button: the alert asks the
        // poster to check the job before trying again, so the "Yes, pay"
        // step is not left armed.
        setShowPayConfirm(false);
        return false;
      }

      triggerHaptic('success');
      setApprovedHere(true);
      setShowPayConfirm(false);
      setShowRatingForm(true);
      return true;
    } catch (err) {
      console.error('Error approving completion:', err);
      // approveAndRelease re-throws errors that carry a reason the poster can
      // act on (no payout account, session expired), so show it.
      const reason = err instanceof Error && err.message ? `${err.message}\n\n` : '';
      Alert.alert(paymentNotConfirmedTitle(isForHonor), `${reason}${paymentNotConfirmedMessage(isForHonor)}`);
      setShowPayConfirm(false);
      return false;
    } finally {
      releasingRef.current = false;
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
    // Steps back one at a time: "Yes, pay" → "Approve and pay" → closed.
    if (showPayConfirm) { setShowPayConfirm(false); return; }
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

  // Inside a step (asking for changes, or the "Yes, pay" confirmation), the
  // header steps back one level; on the review itself it closes the sheet.
  const steppedIn = showRevisionForm || showPayConfirm;

  // The proof, as the design's review screen (I) shows it: photos in a grid,
  // any other file as a row. Both open the attachment viewer.
  const proofItems: ProofItem[] = Array.isArray(submission?.proof_items) ? submission!.proof_items : [];
  const proofPhotos = proofItems
    .filter((item) => item.type === 'image')
    .map((item, i) => ({
      key: String(item.id ?? i),
      uri: (item as any).url || (item as any).remoteUri || item.uri || null,
      label: item.name || `Photo ${i + 1}`,
      onPress: () => handleAttachmentPress(item),
    }));
  const proofFiles = proofItems.filter((item) => item.type !== 'image');

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
        transparent
        animationType="none"
        onRequestClose={handleRequestClose}
      >
        <SlideInScreen>
        <View style={[s.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity accessibilityRole="button"
              style={s.closeButton}
              onPress={handleHeaderClose}
              disabled={isProcessing}
              accessibilityLabel={steppedIn ? 'Back to previous step' : 'Close'}
              accessibilityState={{ disabled: isProcessing }}
            >
              <MaterialIcons
                name={steppedIn ? 'arrow-back' : 'close'}
                size={24}
                color={theme.text}
              />
            </TouchableOpacity>
            <Text style={s.headerTitle} accessibilityRole="header">
              {showRevisionForm
                ? 'Request Changes'
                : showRatingForm || startOnRating
                  ? 'Leave a review'
                  : 'Review the work'}
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
          ) : submission.status !== 'pending' ? (
            // Only pending work can be approved. Reopening on work that was
            // already approved, sent back or turned down says where it stands
            // and offers no payment.
            <View style={s.emptyContainer} testID="review-not-pending">
              <MaterialIcons
                name={submission.status === 'approved' ? 'check-circle' : 'history'}
                size={64}
                color={submission.status === 'approved' ? theme.success : theme.textSecondary}
              />
              <Text style={s.emptyText}>
                {submission.status === 'approved'
                  ? 'You already approved this work'
                  : submission.status === 'revision_requested'
                    ? `You asked ${helperFirst} for a change`
                    : 'This work was turned down'}
              </Text>
              <Text style={s.emptySubtext}>
                {submission.status === 'revision_requested'
                  ? `${helperFirst} will send the work again when it's done.`
                  : "There's nothing to approve here."}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.focusApprove} testID="approve-consequences">
                <FlowTitle title="Is the job finished?" />
                {submission.message?.trim() ? (
                  <NoteBox
                    tone="n"
                    title={`${helperFirst}'s note`}
                    text={`“${submission.message.trim()}”`}
                    testID="review-note"
                  />
                ) : null}
                {proofPhotos.length > 0 ? (
                  <ProofPhotos items={proofPhotos} cols={2} height={120} testID="review-proof-photos" />
                ) : null}
                {proofFiles.length > 0 ? (
                  <View style={s.proofList}>
                    {proofFiles.map((item) => (
                      <React.Fragment key={item.id}>{renderProofItem({ item })}</React.Fragment>
                    ))}
                  </View>
                ) : null}
                {proofPhotos.length === 0 && proofFiles.length === 0 ? (
                  <Text style={s.noProofText}>No photos or files were attached.</Text>
                ) : null}
                <ConsequenceList
                  label="IF YOU APPROVE"
                  items={
                    isForHonor
                      ? [
                          { icon: 'check-circle', title: 'The job is marked finished', detail: 'It was for honor, so no money moves.' },
                          { icon: 'block', title: "This can't be undone", detail: 'Only approve if the job is finished.' },
                        ]
                      : [
                          {
                            icon: 'lock-open',
                            title: `Your ${shortAmount} is released to ${helperFirst}`,
                            detail: `It goes to ${helperFirst}'s Bounty balance.`,
                          },
                          { icon: 'block', title: "This can't be undone", detail: 'Only approve if the job is finished.' },
                        ]
                  }
                />
              </View>

              {/* Two steps, both plain buttons: "Approve and pay $X" only opens
                  the confirmation; "Yes, pay $X" is the one tap that releases.
                  A screen reader completes it with two double taps, no drag. */}
              {!showPayConfirm ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[s.payPrimaryButton, isProcessing && s.buttonDisabled]}
                  onPress={() => { if (!isProcessing) setShowPayConfirm(true); }}
                  disabled={isProcessing}
                  accessibilityLabel={payPrimaryLabel}
                  accessibilityHint="Asks you to confirm first."
                  accessibilityState={{ disabled: isProcessing }}
                  testID="approve-pay-button"
                >
                  <MaterialIcons name="check-circle" size={20} color="#fff" />
                  <Text style={s.buttonText}>{payPrimaryLabel}</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.payConfirmCard} testID="approve-pay-confirm">
                  <Text
                    ref={payConfirmQuestionRef}
                    style={s.payConfirmQuestion}
                    accessibilityRole="header"
                  >
                    {payConfirmQuestion}
                  </Text>
                  <Text style={s.payConfirmBody}>{"Only approve if the job is finished. This can't be undone."}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[s.payPrimaryButton, isProcessing && s.buttonDisabled]}
                    onPress={() => { void handleApprove(); }}
                    disabled={isProcessing}
                    accessibilityLabel={isProcessing ? payBusyLabel : payYesLabel}
                    accessibilityHint={isProcessing ? undefined : "This can't be undone."}
                    accessibilityState={{ disabled: isProcessing, busy: isProcessing }}
                    testID="approve-pay-yes"
                  >
                    {isProcessing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.buttonText}>{payYesLabel}</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[s.payNotYetButton, isProcessing && s.buttonDisabled]}
                    onPress={() => setShowPayConfirm(false)}
                    disabled={isProcessing}
                    accessibilityLabel="Go back"
                    accessibilityHint="Goes back without paying anything."
                    accessibilityState={{ disabled: isProcessing }}
                    testID="approve-pay-not-yet"
                  >
                    <Text style={s.payNotYetText}>Go back</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={s.warningActions}>
                <TouchableOpacity accessibilityRole="button"
                  style={[s.warningCancelButton, isProcessing && s.buttonDisabled]}
                  onPress={() => { setShowPayConfirm(false); setShowRevisionForm(true); }}
                  disabled={isProcessing}
                  accessibilityLabel="Something isn't finished"
                  accessibilityHint="Ask for a change instead of approving."
                  testID="approve-something-unfinished"
                >
                  <MaterialIcons name="edit-note" size={18} color={theme.textSecondary} />
                  <Text style={s.warningCancelText}>{"Something isn't finished"}</Text>
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
        </SlideInScreen>
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
    noProofText: {
      color: t.textSecondary,
      fontSize: 14,
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
    // Approve-and-pay, step 1 and the "Yes, pay" in step 2. 56px tall: a
    // large, unmistakable target for the one tap that releases money.
    payPrimaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      alignSelf: 'stretch',
      minHeight: 56,
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 12,
      backgroundColor: t.primary,
      ...EMERALD_SHADOW,
    },
    focusApprove: { gap: 18, marginBottom: 20 },
    payConfirmCard: {
      alignSelf: 'stretch',
      gap: 12,
      padding: 20,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.primary,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.18) : t.surface,
    },
    payConfirmQuestion: {
      color: t.text,
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'center',
    },
    payConfirmBody: {
      color: t.text,
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 4,
    },
    payNotYetButton: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.35) : t.border,
      backgroundColor: t.isDark ? withAlpha(t.primary, 0.2) : t.surfaceSecondary,
    },
    payNotYetText: {
      color: t.text,
      fontSize: 16,
      fontWeight: '600',
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
