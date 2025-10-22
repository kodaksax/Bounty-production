// components/poster-review-modal.tsx - Modal for poster to review hunter's submission
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completionService, type CompletionSubmission, type ProofItem } from '../lib/services/completion-service';
import { useWallet } from '../lib/wallet-context';
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

  const [submission, setSubmission] = useState<CompletionSubmission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [showRevisionForm, setShowRevisionForm] = useState(false);

  useEffect(() => {
    if (visible) {
      loadSubmission();
    }
  }, [visible, bountyId]);

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

  const handleApprove = async () => {
    if (!submission) return;

    try {
      setIsProcessing(true);

      // Approve submission (handles completion approval + bounty status update)
      await completionService.approveSubmission(bountyId);

      // Release escrow if paid bounty
      if (!isForHonor && bountyAmount > 0) {
        try {
          await releaseFunds(Number(bountyId), hunterId, `Bounty ${bountyId}`);
          console.log('✅ Escrow released for bounty:', bountyId);
        } catch (escrowError) {
          console.error('Error releasing escrow:', escrowError);
          Alert.alert(
            'Payment Issue',
            'Work approved but payment release failed. Please contact support.',
            [{ text: 'OK' }]
          );
        }
      }

      // Show rating form
      setShowRatingForm(true);
    } catch (err) {
      console.error('Error approving completion:', err);
      Alert.alert('Error', 'Failed to approve completion. Please try again.');
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

  const renderProofItem = ({ item }: { item: ProofItem }) => (
    <View style={styles.proofItem}>
      <View style={styles.proofIcon}>
        <MaterialIcons
          name={item.type === 'image' ? 'image' : 'insert-drive-file'}
          size={32}
          color="#6ee7b7"
        />
      </View>
      <View style={styles.proofInfo}>
        <Text style={styles.proofName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
      </View>
    </View>
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review Submission</Text>
          <View style={{ width: 24 }} />
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10b981" />
            <Text style={styles.loadingText}>Loading submission...</Text>
          </View>
        ) : !submission ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="inbox" size={64} color="#6ee7b7" />
            <Text style={styles.emptyText}>No submission yet</Text>
            <Text style={styles.emptySubtext}>
              Waiting for {hunterName} to submit their work.
            </Text>
          </View>
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
                <MaterialIcons name="person" size={32} color="#6ee7b7" />
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
                onPress={handleApprove}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="check-circle" size={20} color="#fff" />
                    <Text style={styles.approveButtonText}>Approve & Release</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  hunterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
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
    color: '#6ee7b7',
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageBox: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  proofIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
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
    color: '#6ee7b7',
    fontSize: 12,
  },
  emptyProof: {
    padding: 24,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
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
    backgroundColor: '#10b981',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#10b981',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 150,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    width: '100%',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  secondaryButtonText: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '600',
  },
});
