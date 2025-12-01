// components/poster-review-modal.tsx - Modal for poster to review hunter's submission
import { MaterialIcons } from '@expo/vector-icons';
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
import { completionService, type CompletionSubmission, type ProofItem } from '../lib/services/completion-service';
import type { Attachment } from '../lib/types';
import { useWallet } from '../lib/wallet-context';
import { AttachmentViewerModal } from './attachment-viewer-modal';
import { RatingStars } from './ui/rating-stars';

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
            }).start(() => {
              onConfirmed();
            });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: false,
              bounciness: 8,
              speed: 12,
            }).start(() => {
              hasConfirmedRef.current = false;
            });
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            bounciness: 8,
            speed: 12,
          }).start(() => {
            hasConfirmedRef.current = false;
          });
        },
      }),
    [disabled, isProcessing, maxTranslate, onConfirmed, translateX]
  );

  const fillWidth = useMemo(() => Animated.add(translateX, handleOffset.current), [handleOffset, translateX]);

  return (
    <View style={styles.sliderWrapper}>
      <View
        style={styles.sliderTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        <Animated.View style={[styles.sliderFill, { width: fillWidth }]} />
        <Text style={styles.sliderLabel}>{label}</Text>
        <Animated.View
          style={[styles.sliderHandle, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabelText}
          accessibilityHint="Double tap then drag to the end to confirm payout"
          accessibilityActions={[{ name: 'activate', label: 'Confirm payout' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate' && !disabled && !isProcessing && !hasConfirmedRef.current) {
              hasConfirmedRef.current = true;
              if (maxTranslate <= 0) {
                onConfirmed();
                return;
              }
              Animated.timing(translateX, {
                toValue: maxTranslate,
                duration: 180,
                useNativeDriver: false,
              }).start(() => {
                onConfirmed();
              });
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

  const [submission, setSubmission] = useState<CompletionSubmission | null>(null);
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

  useEffect(() => {
    if (visible) {
      loadSubmission();
    }
  }, [visible, bountyId]);

  useEffect(() => {
    if (!visible) {
      setViewerVisible(false);
      setSelectedAttachment(null);
      setShowPayoutWarning(false);
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

      // Approve submission (handles completion approval + bounty status update)
      await completionService.approveSubmission(bountyId);

      // Release escrow if paid bounty
        if (!isForHonor && bountyAmount > 0) {
          try {
            // Pass bountyId through as string (wallet now accepts string|number)
            await releaseFunds(bountyId, hunterId, `Bounty ${bountyId}`);
            console.log('✅ Escrow released for bounty:', bountyId);
            // Trigger success haptic for successful payment release
            triggerHaptic('success');
          } catch (escrowError) {
            console.error('Error releasing escrow:', escrowError);
            Alert.alert(
              'Payment Issue',
              'Work approved but payment release failed. Please contact support.',
              [{ text: 'OK' }]
            );
          }
        } else {
          // For honor bounties, still trigger success haptic for approval
          triggerHaptic('success');
        }

      // Show rating form
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

      Alert.alert(
        'Revision Requested',
        'The hunter has been notified of your feedback and can resubmit.',
        [
          {
            text: 'OK',
            onPress: () => {
              onClose();
              onComplete();
            },
          },
        ]
      );
    } catch (err) {
      console.error('Error requesting revision:', err);
      Alert.alert('Error', 'Failed to request revision. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHeaderClose = () => {
    if (showRevisionForm) {
      setShowRevisionForm(false);
      return;
    }
    if (showPayoutWarning) {
      setShowPayoutWarning(false);
      return;
    }
    onClose();
  };

  const handleSubmitRating = async () => {
    if (rating === 0) {
      Alert.alert('Add Rating', 'Please provide a star rating.');
      return;
    }

    try {
      setIsProcessing(true);

      // Submit rating
      await completionService.submitRating({
        bounty_id: bountyId,
        from_user_id: '',  // Will be set by service from session
        to_user_id: hunterId,
        rating,
        comment: ratingComment.trim() || undefined,
      });

      Alert.alert(
        'Bounty Complete!',
        `${hunterName} has been rated ${rating} stars. ${!isForHonor ? 'Payment has been released.' : 'Thank you for your feedback!'}`,
        [
          {
            text: 'OK',
            onPress: () => {
              onClose();
              onComplete();
            },
          },
        ]
      );
    } catch (err) {
      console.error('Error submitting rating:', err);
      // Even if rating fails, we should still complete since approval already happened
      Alert.alert(
        'Rating Error',
        'Failed to submit rating, but the bounty has been completed successfully.',
        [
          {
            text: 'OK',
            onPress: () => {
              onClose();
              onComplete();
            },
          },
        ]
      );
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
    const remoteUri = item.url && item.url.length > 0 ? item.url : undefined;
    const primaryUri = item.uri || remoteUri;

    if (!primaryUri) {
      Alert.alert('Unavailable', 'This attachment is missing a file reference.');
      return;
    }

    const attachment: Attachment = {
      id: item.id,
      name: item.name || 'Attachment',
      uri: primaryUri,
      remoteUri,
      mimeType: item.mimeType,
      mime: item.mimeType,
      size: item.size,
    };

    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  const renderProofItem = ({ item }: { item: ProofItem }) => {
    const displayName = item.name || 'Attachment';

    return (
      <TouchableOpacity
        style={styles.proofItem}
        onPress={() => handleAttachmentPress(item)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`View attachment ${displayName}`}
        accessibilityHint="Opens the attachment in a viewer"
      >
      <View style={styles.proofIcon}>
        <MaterialIcons
          name={item.type === 'image' ? 'image' : 'insert-drive-file'}
          size={32}
          color="#80c795"
        />
      </View>
      <View style={styles.proofInfo}>
        <Text style={styles.proofName} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
      </View>
      <MaterialIcons name="open-in-new" size={20} color="#aad9b8" />
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
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleHeaderClose}
              accessibilityLabel={showRevisionForm || showPayoutWarning ? 'Back to previous step' : 'Close review modal'}
            >
              <MaterialIcons name={(showRevisionForm || showPayoutWarning) ? 'arrow-back' : 'close'} size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{showRevisionForm ? 'Request Changes' : showPayoutWarning ? 'Confirm Payout' : 'Review Submission'}</Text>
            <View style={{ width: 24 }} />
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#008e2a" />
              <Text style={styles.loadingText}>Loading submission...</Text>
            </View>
          ) : !submission ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="inbox" size={64} color="#80c795" />
              <Text style={styles.emptyText}>No submission yet</Text>
              <Text style={styles.emptySubtext}>
                Waiting for {hunterName} to submit their work.
              </Text>
            </View>
          ) : showPayoutWarning ? (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
            >
              <View style={styles.payoutWarningContainer}>
                <View style={styles.warningIcon}>
                  <MaterialIcons name="warning" size={28} color="#fbbf24" />
                </View>
                <Text style={styles.warningTitle}>Complete and release payment?</Text>
                <Text style={styles.warningDescription}>
                  {isForHonor
                    ? 'Completing this bounty will mark the work as finished for honor and alert the hunter.'
                    : `This will mark the bounty as completed and release ${formattedPayoutAmount} to ${hunterName}.`}
                </Text>
                {!isForHonor && bountyAmount > 0 && (
                  <View style={styles.warningAmountChip}>
                    <MaterialIcons name="account-balance-wallet" size={16} color="#fbbf24" />
                    <Text style={styles.warningAmountText}>{formattedPayoutAmount} escrow release</Text>
                  </View>
                )}
                <Text style={styles.warningFootnote}>Once you continue, this action cannot be undone.</Text>
              </View>

              <SlideToConfirm
                label={isProcessing ? 'Processing payout…' : 'Slide to confirm payout'}
                onConfirmed={() => {
                  handleApprove();
                }}
                disabled={isProcessing}
                isProcessing={isProcessing}
              />

              <View style={styles.warningActions}>
                <TouchableOpacity
                  style={[styles.warningCancelButton, isProcessing && styles.buttonDisabled]}
                  onPress={() => setShowPayoutWarning(false)}
                  disabled={isProcessing}
                >
                  <MaterialIcons name="arrow-back" size={18} color="#aad9b8" />
                  <Text style={styles.warningCancelText}>Back to review</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : showRatingForm ? (
          /* Rating Form */
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
          >
            <View style={styles.ratingFormContainer}>
              <MaterialIcons name="star" size={64} color="#fbbf24" />
              <Text style={styles.ratingTitle}>Rate {hunterName}</Text>
              <Text style={styles.ratingSubtitle}>
                How would you rate their work on this bounty?
              </Text>

              <View style={styles.ratingStarsContainer}>
                <RatingStars
                  rating={rating}
                  onRatingChange={setRating}
                  size="large"
                />
              </View>

              <TextInput
                style={styles.commentInput}
                placeholder="Add an optional comment (visible to hunter)..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={ratingComment}
                onChangeText={setRatingComment}
                multiline
                numberOfLines={4}
                maxLength={500}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.primaryButton, isProcessing && styles.buttonDisabled]}
                onPress={handleSubmitRating}
                disabled={isProcessing || rating === 0}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Submit Rating & Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : showRevisionForm ? (
          /* Revision Request Form */
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
          >
            <View style={styles.revisionFormContainer}>
              <MaterialIcons name="feedback" size={64} color="#fbbf24" />
              <Text style={styles.revisionTitle}>Request Changes</Text>
              <Text style={styles.revisionSubtitle}>
                Explain what needs to be improved or changed.
              </Text>

              <TextInput
                style={styles.feedbackInput}
                placeholder="Describe the changes needed..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={revisionFeedback}
                onChangeText={setRevisionFeedback}
                multiline
                numberOfLines={6}
                maxLength={1000}
                textAlignVertical="top"
              />

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setShowRevisionForm(false)}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryButton, isProcessing && styles.buttonDisabled]}
                  onPress={handleRequestRevision}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Send Feedback</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        ) : (
          /* Submission Review */
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
          >
            <View style={styles.hunterInfo}>
              <View style={styles.hunterAvatar}>
                <MaterialIcons name="person" size={32} color="#80c795" />
              </View>
              <View style={styles.hunterDetails}>
                <Text style={styles.hunterName}>{hunterName}</Text>
                <Text style={styles.submittedText}>
                  Submitted {new Date(submission.submitted_at!).toLocaleDateString()}
                </Text>
              </View>
            </View>

            {/* Message */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Message from Hunter</Text>
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{submission.message}</Text>
              </View>
            </View>

            {/* Proof Items */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Proof of Completion</Text>
              {submission.proof_items && submission.proof_items.length > 0 ? (
                <FlatList
                  data={submission.proof_items}
                  renderItem={renderProofItem}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  contentContainerStyle={styles.proofList}
                />
              ) : (
                <View style={styles.emptyProof}>
                  <Text style={styles.emptyProofText}>No proof attached</Text>
                </View>
              )}
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => setShowRevisionForm(true)}
                disabled={isProcessing}
              >
                <MaterialIcons name="feedback" size={20} color="#fff" />
                <Text style={styles.rejectButtonText}>Request Changes</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.approveButton, isProcessing && styles.buttonDisabled]}
                onPress={() => setShowPayoutWarning(true)}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="check-circle" size={20} color="#fff" />
                    <Text style={styles.approveButtonText}>Proceed to Payout</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>

      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 199, 149, 0.1)',
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    color: '#fff',
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
    color: 'rgba(255,254,245,0.8)',
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
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtext: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
    textAlign: 'center',
  },
  hunterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.3)',
  },
  hunterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 117, 35, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hunterDetails: {
    flex: 1,
  },
  hunterName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  submittedText: {
    color: '#80c795',
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#80c795',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageBox: {
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.2)',
  },
  messageText: {
    color: 'rgba(255,254,245,0.9)',
    fontSize: 15,
    lineHeight: 22,
  },
  proofList: {
    gap: 12,
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.2)',
  },
  proofIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 117, 35, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofInfo: {
    flex: 1,
    gap: 4,
  },
  proofName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  proofSize: {
    color: '#80c795',
    fontSize: 12,
  },
  emptyProof: {
    padding: 24,
    backgroundColor: 'rgba(0, 117, 35, 0.1)',
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyProofText: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 14,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
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
    backgroundColor: '#008e2a',
    paddingVertical: 16,
    borderRadius: 12,
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
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  ratingSubtitle: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 15,
    textAlign: 'center',
  },
  ratingStarsContainer: {
    paddingVertical: 20,
  },
  commentInput: {
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.2)',
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#008e2a',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
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
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  revisionSubtitle: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 15,
    textAlign: 'center',
  },
  feedbackInput: {
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 150,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.2)',
    width: '100%',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(0, 142, 42, 0.2)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#008e2a',
  },
  secondaryButtonText: {
    color: '#008e2a',
    fontSize: 16,
    fontWeight: '600',
  },
  payoutWarningContainer: {
    gap: 16,
    padding: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 117, 35, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.35)',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  warningIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  warningDescription: {
    color: 'rgba(255,254,245,0.85)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  warningAmountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
  },
  warningAmountText: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  warningFootnote: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 12,
    textAlign: 'center',
  },
  sliderWrapper: {
    marginTop: 24,
    marginBottom: 16,
    width: '100%',
  },
  sliderTrack: {
    position: 'relative',
    backgroundColor: 'rgba(0, 92, 28, 0.4)',
    borderRadius: 999,
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.25)',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 142, 42, 0.45)',
  },
  sliderLabel: {
    color: 'rgba(255,254,245,0.85)',
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
    backgroundColor: '#008e2a',
    justifyContent: 'center',
    alignItems: 'center',
    top: 2,
    left: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
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
    borderColor: 'rgba(128, 199, 149, 0.35)',
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
  },
  warningCancelText: {
    color: '#aad9b8',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
