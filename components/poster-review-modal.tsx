// components/poster-review-modal.tsx - Modal for poster to review hunter's submission
import { MaterialIcons } from '@expo/vector-icons';
import { userProfileService } from 'lib/services/userProfile';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useHapticFeedback } from '../lib/haptic-feedback';
import { approveAndRelease } from '../lib/services/completion-approval';
import { completionService, type CompletionSubmission, type ProofItem } from '../lib/services/completion-service';
import { supabase } from '../lib/supabase';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import type { Attachment } from '../lib/types';
import { useWallet } from '../lib/wallet-context';
import { AttachmentViewerModal } from './attachment-viewer-modal';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { RatingStars } from './ui/rating-stars';

const EMERALD_SHADOW = {
  shadowColor: '#059669',
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
  onClose: () => void;
  onComplete: () => void;
}

const SLIDER_HANDLE_WIDTH = 56;

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
  const handleOffset = useRef(new Animated.Value(SLIDER_HANDLE_WIDTH));
  const accessibilityLabelText = isProcessing ? 'Processing payout' : label;

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

  const maxTranslate = Math.max(trackWidth - SLIDER_HANDLE_WIDTH, 0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !isProcessing,
        onMoveShouldSetPanResponder: () => !disabled && !isProcessing,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_evt, gestureState) => {
          const newX = Math.max(0, Math.min(gestureState.dx, maxTranslate));
          translateX.setValue(newX);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const releaseX = Math.max(0, Math.min(gestureState.dx, maxTranslate));
          if (releaseX >= maxTranslate * 0.92 && !hasConfirmedRef.current) {
            hasConfirmedRef.current = true;
            Animated.timing(translateX, {
              toValue: maxTranslate,
              duration: 180,
              useNativeDriver: false,
            }).start(() => { onConfirmed(); });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: false,
              bounciness: 8,
              speed: 12,
            }).start(() => { hasConfirmedRef.current = false; });
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            bounciness: 8,
            speed: 12,
          }).start(() => { hasConfirmedRef.current = false; });
        },
      }),
    [disabled, isProcessing, maxTranslate, onConfirmed, translateX]
  );

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
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabelText}
          accessibilityHint="Double tap then drag to the end to confirm payout"
          accessibilityActions={[{ name: 'activate', label: 'Confirm payout' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate' && !disabled && !isProcessing && !hasConfirmedRef.current) {
              hasConfirmedRef.current = true;
              if (maxTranslate <= 0) { onConfirmed(); return; }
              Animated.timing(translateX, {
                toValue: maxTranslate,
                duration: 180,
                useNativeDriver: false,
              }).start(() => { onConfirmed(); });
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
  onClose,
  onComplete,
}: PosterReviewModalProps) {
  const insets = useSafeAreaInsets();
  const { releaseFunds } = useWallet();
  const { triggerHaptic } = useHapticFeedback();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const accentColor = theme.isDark ? '#6ee7b7' : theme.primary;

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
    }
  }, [visible]);

  const loadSubmission = async () => {
    try {
      setIsLoading(true);
      const data = await completionService.getSubmission(bountyId);
      setSubmission(data);
    } catch (err) {
      console.error('Error loading submission:', err);
      Alert.alert('Error', 'Failed to load submission');
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
        releaseFn: releaseFunds,
        approveFn: async (id: string) => {
          await completionService.approveSubmission(id);
          return true;
        },
        notifyFn: async (userId: string, payload?: Record<string, any>) => {
          try {
            const notificationBody = payload?.bountyTitle
              ? `Please rate your experience for "${String(payload.bountyTitle)}".`
              : 'Please rate your experience for this bounty.';
            // Enqueue via notifications_outbox so process-notification delivers
            // BOTH an in-app bell entry and a push notification.
            await supabase.from('notifications_outbox').insert({
              recipients: [userId],
              title: 'Please rate the poster',
              body: notificationBody,
              data: { bountyId: String(bountyId), type: 'completion', subtype: 'rating_prompt', ...payload },
              bounty_id: String(bountyId),
            });
          } catch (e) {
            console.warn('Failed to enqueue rating prompt notification', e);
          }
        },
      });

      if (!ok) {
        Alert.alert('Payment Issue', 'Work approved but payment release failed. Please contact support.');
        setShowPayoutWarning(true);
        return false;
      }

      triggerHaptic('success');
      setShowPayoutWarning(false);
      setShowRatingForm(true);
      return true;
    } catch (err) {
      console.error('Error approving completion:', err);
      Alert.alert('Error', 'Failed to approve completion. Please try again.');
      setShowPayoutWarning(true);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!submission) return;
    if (!revisionFeedback.trim()) {
      Alert.alert('Add Feedback', 'Please provide feedback for the revision request.');
      return;
    }
    try {
      setIsProcessing(true);
      await completionService.requestRevision(submission.id!, revisionFeedback.trim());
      Alert.alert('Revision Requested', 'The hunter has been notified of your feedback and can resubmit.', [
        { text: 'OK', onPress: () => { onClose(); onComplete(); } },
      ]);
    } catch (err) {
      console.error('Error requesting revision:', err);
      Alert.alert('Error', 'Failed to request revision. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHeaderClose = () => {
    if (showRevisionForm) { setShowRevisionForm(false); return; }
    if (showPayoutWarning) { setShowPayoutWarning(false); return; }
    onClose();
  };

  const handleSubmitRating = async () => {
    if (rating === 0) { Alert.alert('Add Rating', 'Please provide a star rating.'); return; }
    const targetHunterId = hunterId || submission?.hunter_id || '';
    if (!targetHunterId) {
      Alert.alert('Missing Hunter', 'Could not determine who to rate. Please try again.');
      return;
    }
    try {
      setIsProcessing(true);
      await completionService.submitRating({
        bounty_id: bountyId,
        from_user_id: '',
        to_user_id: targetHunterId,
        rating,
        comment: ratingComment.trim() || undefined,
      });
      Alert.alert(
        'Bounty Complete!',
        `${displayHunterName} has been rated ${rating} stars. ${!isForHonor ? 'Payment has been released.' : 'Thank you for your feedback!'}`,
        [{ text: 'OK', onPress: () => { onClose(); onComplete(); } }]
      );
    } catch (err) {
      console.error('Error submitting rating:', err);
      Alert.alert('Rating Error', 'Failed to submit rating, but the bounty has been completed successfully.', [
        { text: 'OK', onPress: () => { onClose(); onComplete(); } },
      ]);
    } finally {
      setIsProcessing(false);
    }
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

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <View style={[s.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity
              style={s.closeButton}
              onPress={handleHeaderClose}
              accessibilityLabel={showRevisionForm || showPayoutWarning ? 'Back to previous step' : 'Close review modal'}
            >
              <MaterialIcons
                name={(showRevisionForm || showPayoutWarning) ? 'arrow-back' : 'close'}
                size={24}
                color={theme.text}
              />
            </TouchableOpacity>
            <Text style={s.headerTitle}>
              {showRevisionForm ? 'Request Changes' : showPayoutWarning ? 'Confirm Payout' : 'Review Submission'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {isLoading ? (
            <View style={s.loadingContainer}>
              <ActivityIndicator size="large" color="#059669" />
              <Text style={s.loadingText}>Loading submission...</Text>
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
            >
              <View style={s.payoutWarningContainer}>
                <View style={s.warningIcon}>
                  <MaterialIcons name="warning" size={28} color="#fbbf24" />
                </View>
                <Text style={s.warningTitle}>Complete and release payment?</Text>
                <Text style={s.warningDescription}>
                  {isForHonor
                    ? 'Completing this bounty will mark the work as finished for honor and alert the hunter.'
                    : `This will mark the bounty as completed and release ${formattedPayoutAmount} to ${displayHunterName}.`}
                </Text>
                {!isForHonor && bountyAmount > 0 && (
                  <View style={s.warningAmountChip}>
                    <MaterialIcons name="account-balance-wallet" size={16} color="#fbbf24" />
                    <Text style={s.warningAmountText}>{formattedPayoutAmount} escrow release</Text>
                  </View>
                )}
                <Text style={s.warningFootnote}>Once you continue, this action cannot be undone.</Text>
              </View>

              <SlideToConfirm
                label={isProcessing ? 'Processing payout…' : 'Slide to confirm payout'}
                onConfirmed={() => { handleApprove(); }}
                disabled={isProcessing}
                isProcessing={isProcessing}
              />

              <View style={s.warningActions}>
                <TouchableOpacity
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
            <ScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
            >
              <View style={s.ratingFormContainer}>
                <MaterialIcons name="star" size={64} color="#fbbf24" />
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
                <TouchableOpacity
                  style={[s.primaryButton, isProcessing && s.buttonDisabled]}
                  onPress={handleSubmitRating}
                  disabled={isProcessing || rating === 0}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.buttonText}>Complete Bounty & Rate Hunter</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : showRevisionForm ? (
            <ScrollView
              style={s.scrollView}
              contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 20 }]}
            >
              <View style={s.revisionFormContainer}>
                <MaterialIcons name="feedback" size={64} color="#fbbf24" />
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
                  <TouchableOpacity style={s.secondaryButton} onPress={() => setShowRevisionForm(false)}>
                    <Text style={s.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
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
            </ScrollView>
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
                  <Text style={s.hunterName}>{hunterProfile?.username || displayHunterName}</Text>
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
                <TouchableOpacity
                  style={s.rejectButton}
                  onPress={() => setShowRevisionForm(true)}
                  disabled={isProcessing}
                >
                  <MaterialIcons name="feedback" size={20} color="#fff" />
                  <Text style={s.rejectButtonText}>Request Changes</Text>
                </TouchableOpacity>

                <TouchableOpacity
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

function makeSliderStyles(t: AppTheme) {
  return StyleSheet.create({
    sliderWrapper: {
      marginTop: 24,
      marginBottom: 16,
      width: '100%',
    },
    sliderTrack: {
      position: 'relative',
      backgroundColor: t.isDark ? 'rgba(4,120,87,0.4)' : 'rgba(5,150,105,0.15)',
      borderRadius: 999,
      height: 60,
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.25)' : 'rgba(5,150,105,0.3)',
    },
    sliderFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.45)' : 'rgba(16,185,129,0.35)',
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
      backgroundColor: '#059669',
      justifyContent: 'center',
      alignItems: 'center',
      top: 2,
      left: 0,
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
      borderBottomColor: t.isDark ? 'rgba(110,231,183,0.1)' : t.border,
    },
    closeButton: {
      padding: 4,
    },
    headerTitle: {
      color: t.text,
      fontSize: 18,
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
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : 'rgba(5,150,105,0.07)',
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.3)' : 'rgba(5,150,105,0.2)',
    },
    hunterAvatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.3)' : 'rgba(5,150,105,0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarFallbackText: {
      fontSize: 20,
      fontWeight: '600',
      color: t.primary,
    },
    hunterDetails: {
      flex: 1,
    },
    hunterName: {
      color: t.text,
      fontSize: 18,
      fontWeight: '600',
    },
    submittedText: {
      color: t.isDark ? '#6ee7b7' : t.primary,
      fontSize: 13,
      marginTop: 4,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      color: t.isDark ? '#6ee7b7' : t.primary,
      fontSize: 14,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    messageBox: {
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : t.surfaceSecondary,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
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
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : t.surfaceSecondary,
      borderRadius: 12,
      padding: 12,
      gap: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
    },
    proofIcon: {
      width: 48,
      height: 48,
      borderRadius: 8,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.3)' : 'rgba(5,150,105,0.1)',
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
      color: t.isDark ? '#6ee7b7' : t.primary,
      fontSize: 12,
    },
    emptyProof: {
      padding: 24,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.1)' : t.surfaceSecondary,
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
      backgroundColor: '#ef4444',
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
      backgroundColor: '#059669',
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
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : t.surfaceSecondary,
      borderRadius: 12,
      padding: 16,
      color: t.text,
      fontSize: 15,
      minHeight: 120,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
      width: '100%',
    },
    primaryButton: {
      backgroundColor: '#059669',
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
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : t.surfaceSecondary,
      borderRadius: 12,
      padding: 16,
      color: t.text,
      fontSize: 15,
      minHeight: 150,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
      width: '100%',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: t.isDark ? '#374151' : t.surfaceSecondary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.primary,
    },
    secondaryButtonText: {
      color: t.primary,
      fontSize: 16,
      fontWeight: '600',
    },
    payoutWarningContainer: {
      gap: 16,
      padding: 20,
      borderRadius: 16,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.18)' : 'rgba(5,150,105,0.07)',
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.35)' : 'rgba(5,150,105,0.2)',
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    warningIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(251,191,36,0.15)',
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
      backgroundColor: 'rgba(251,191,36,0.18)',
    },
    warningAmountText: {
      color: '#fbbf24',
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    warningFootnote: {
      color: t.textSecondary,
      fontSize: 12,
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
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.35)' : t.border,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.2)' : t.surfaceSecondary,
    },
    warningCancelText: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
  });
}
