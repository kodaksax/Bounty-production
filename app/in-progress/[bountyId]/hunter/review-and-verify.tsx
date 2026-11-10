import { sanitizeErrorMessage } from '../../../../lib/utils/error-messages';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../../hooks/useSafeBack';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DisputeFrozenBanner } from '../../../../components/ui/dispute-frozen-banner';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { WorkflowDisputeModal } from '../../../../components/workflow-dispute-modal';
import { useAttachmentUpload } from '../../../../hooks/use-attachment-upload';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import { completionService, type ProofItem } from '../../../../lib/services/completion-service';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { disputeService } from '../../../../lib/services/dispute-service';
import { messageService } from '../../../../lib/services/message-service';
import type { Conversation } from '../../../../lib/types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';
// The completion-message field lives in this list's header, so the list is
// what has to inset for the keyboard.
import { keyboardAwareListProps } from '../../../../components/ui/keyboard-avoiding';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { withAlpha } from '../../../../lib/utils';
import { HunterStageTimeline, type HunterStage } from '../../../../components/hunter-stage-timeline';

export default function HunterReviewAndVerifyScreen() {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  // Push notifications can open this screen with nothing under it; fall
  // back to this bounty's hunter hub rather than leaving back dead.
  const goBack = useSafeBack(
    bountyId ? { pathname: '/in-progress/[bountyId]/hunter', params: { bountyId } } : FEED_FALLBACK
  );
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('review_verify');
  const [messageText, setMessageText] = useState('');
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0); // in seconds
  const [startTime] = useState(Date.now());
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [hasActiveDispute, setHasActiveDispute] = useState(false);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);

  // Attachment upload hook
  const {
    pickAttachment,
    isUploading: isUploadingProof,
    isPicking: isPickingProof,
  } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: 'proofs',
    maxSizeMB: 10,
    allowsMultiple: true,
    onUploaded: (attachment) => {
      const proofItem: ProofItem = {
        id: attachment.id,
        type: attachment.mimeType?.startsWith('image/') ? 'image' : 'file',
        name: attachment.name,
        url: attachment.remoteUri,
        uri: attachment.uri,
        size: attachment.size,
        mimeType: attachment.mimeType,
      };
      setProofItems((prev) => [...prev, proofItem]);
    },
    onError: (error) => {
      Alert.alert("Couldn't upload that file", sanitizeErrorMessage(error));
    },
  });

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  useEffect(() => {
    if (!routeBountyId) {
      setError('Invalid bounty id');
      setIsLoading(false);
      return;
    }
    loadData(routeBountyId);
    loadConversation(routeBountyId);
    loadProofItems();
    loadActiveDispute(routeBountyId);

    // Start timer
    const interval = setInterval(() => {
      setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [routeBountyId, startTime]);

  const loadActiveDispute = async (id: string) => {
    // Always reset first so this works correctly if the screen is reused
    // for a different bountyId or refreshed after an admin resolved the dispute.
    setHasActiveDispute(false);
    setActiveDisputeId(null);
    try {
      const workflowDispute = await disputeService.getDisputeByBountyId(id);
      if (workflowDispute && (workflowDispute.status === 'open' || workflowDispute.status === 'under_review')) {
        setHasActiveDispute(true);
        setActiveDisputeId(workflowDispute.id);
      }
    } catch (err) {
      console.error('Error loading active dispute:', err);
    }
  };

  const loadData = async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Load bounty
      const bountyData = await bountyService.getById(id);
      if (!bountyData) {
        throw new Error('Bounty not found');
      }

      setBounty(bountyData);

      // Check if hunter has an accepted request for this bounty
      const requests = await bountyRequestService.getAll({
        bountyId: id,
        userId: currentUserId,
      });

      if (requests.length === 0) {
        // No application on this bounty: send them to the read-only view where
        // they can actually apply. The old alert + router.back() dead-ended
        // anyone who arrived from a notification or a shared link.
        router.replace({ pathname: '/bounty/[id]/public', params: { id } });
        return;
      }

      const hunterRequest = requests[0];
      setRequest(hunterRequest);

      // If not accepted yet, go back to apply screen
      if (hunterRequest.status !== 'accepted') {
        router.replace({
          pathname: '/in-progress/[bountyId]/hunter',
          params: { bountyId: id },
        });
        return;
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const loadConversation = async (idStr: string) => {
    try {
      const conversations = await messageService.getConversations();
      const bountyConv = conversations.find((c) => String(c.bountyId) === idStr);
      setConversation(bountyConv || null);
    } catch (err) {
      console.error('Error loading conversation:', err);
    }
  };

  const loadProofItems = async () => {
    try {
      // If bounty includes attachments_json, parse and populate
      const attachmentsJson = (bounty as any)?.attachments_json
      if (attachmentsJson) {
        let parsed: any[] = []
        try { parsed = JSON.parse(attachmentsJson) } catch { parsed = [] }
        const items: ProofItem[] = parsed.map((a: any) => ({
          id: a.id || String(Date.now()),
          type: a.mimeType?.startsWith('image/') ? 'image' : 'file',
          name: a.name || (a.remoteUri ? a.remoteUri.split('/').pop() : 'attachment'),
          url: a.remoteUri,
          uri: a.uri,
          size: a.size,
          mimeType: a.mimeType,
        }))
        setProofItems(items)
        return
      }

      // Default to empty
      setProofItems([])
    } catch (err) {
      console.error('Error loading proof items:', err);
      setProofItems([])
    }
  };

  const handleAddProof = async () => {
    await pickAttachment();
  };

  const handleRemoveProof = (id: string) => {
    setProofItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRequestReview = async () => {
    if (hasActiveDispute) {
      Alert.alert(
        'Submission Locked',
        'A dispute is currently open for this bounty. Submissions are paused until the dispute is resolved by an admin.'
      );
      return;
    }

    // `proofItems` is only appended to inside the upload hook's `onUploaded`
    // callback, which fires after the file finishes uploading. Without this
    // guard, tapping Submit right after picking a photo would submit the
    // completion before that callback ran — the just-picked proof file
    // would silently be left out, with no error and no indication anything
    // was wrong.
    if (isUploadingProof || isPickingProof) {
      Alert.alert(
        'Upload in Progress',
        'Please wait for your proof file to finish uploading before submitting.'
      );
      return;
    }

    if (!messageText.trim()) {
      Alert.alert(
        'Completion Message Required',
        'Please add a message describing your completed work.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Helper for pluralization
    const proofCount = proofItems.length;
    const proofLabel = proofCount === 1 ? '1 proof item' : `${proofCount} proof items`;

    // Define the actual submission logic
    const performSubmission = async () => {
      try {
        setIsSubmitting(true);
        
        // Submit completion via service
        await completionService.submitCompletion({
          bounty_id: String(bounty?.id),
          hunter_id: currentUserId,
          message: messageText.trim(),
          proof_items: proofItems,
        });

        // Update bounty status to indicate submission pending review
        // (In real implementation, backend should handle this)

        Alert.alert(
          'Submission Successful',
          'Your work has been submitted for review. The poster will verify and release payment.',
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate to payout screen (waiting state)
                if (routeBountyId) {
                  router.push({
                    pathname: '/in-progress/[bountyId]/hunter/payout',
                    params: { bountyId: routeBountyId },
                  });
                }
              },
            },
          ]
        );
      } catch (err) {
        console.error('Error requesting review:', err);
        Alert.alert("Couldn't request review", "Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    };

    // Show different confirmation dialogs based on whether proof is attached
    if (proofItems.length === 0) {
      // No proof attached - show warning
      Alert.alert(
        'No Proof Attached',
        'You are submitting without any proof of completion. The poster may request revisions. Are you sure you want to continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: performSubmission },
        ]
      );
    } else {
      // Proof attached - show confirmation
      Alert.alert(
        'Confirm Submission',
        `You have attached ${proofLabel}. Are you ready to submit your work for review?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: performSubmission },
        ]
      );
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
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
          color={theme.primaryLight}
        />
      </View>
      <View style={styles.proofInfo}>
        <Text style={styles.proofName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button"
        style={styles.removeButton}
        onPress={() => handleRemoveProof(item.id)}
      >
        <MaterialIcons name="close" size={20} color={theme.errorText} />
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <HunterDashboardSkeleton />
      </View>
    );
  }

  if (error || !bounty || !request) {
    return (
      <View style={[styles.errorContainer, { paddingTop: insets.top }]}>
        <MaterialIcons name="error-outline" size={48} color={theme.errorText} />
        <Text style={styles.errorText}>{error || 'Data not found'}</Text>
        <TouchableOpacity accessibilityRole="button"
          style={styles.retryButton}
          onPress={() => routeBountyId && loadData(routeBountyId)}
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={goBack}>
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Go back" accessibilityRole="button" style={styles.backIcon} onPress={goBack}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Submit your work</Text>
      </View>

      <FlatList
        {...keyboardAwareListProps}
        style={styles.scrollView}
        data={proofItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <>
            {/* Bounty Info Card with Timer */}
            <View style={styles.bountyInfoCard}>
              <Text style={styles.bountyTitle} numberOfLines={2}>
                {bounty.title}
              </Text>
              <View style={styles.timerContainer}>
                <Text style={styles.timerLabel}>Time on this task</Text>
                <Text style={styles.timerValue}>{formatTime(timeElapsed)}</Text>
                <Text style={styles.timerHint}>Track your time on this task</Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.bountyAmount}>
                  {bounty.is_for_honor ? 'For Honor' : `$${bounty.amount}`}
                </Text>
              </View>
            </View>

            {/* Timeline */}
            <HunterStageTimeline currentStage={currentStage} />

            {/* Message Input */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes for the poster</Text>
              <TextInput
                style={styles.messageTextArea}
                placeholder="Describe your completed work..."
                placeholderTextColor={withAlpha(theme.text, 0.4)}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                numberOfLines={4}
                maxLength={1000}
                textAlignVertical="top"
              />
              {/* Conversation quick action: use loaded conversation if present */}
              <View style={{ marginTop: 12 }}>
                {conversation ? (
                  <TouchableOpacity accessibilityRole="button"
                    style={[styles.addProofButton, { alignSelf: 'flex-start' }]}
                    onPress={() => {
                      try {
                        (router as any).push(`/messages/${conversation.id}`);
                      } catch (e) {
                        console.warn('Unable to open conversation route', e);
                        Alert.alert('Unable to Open Conversation', 'We could not open the conversation. Please try again.');
                      }
                    }}
                  >
                    <MaterialIcons name="chat" size={18} color={theme.text} />
                    <Text style={styles.addProofText}>Open conversation</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity accessibilityRole="button"
                    style={[styles.addProofButton, { alignSelf: 'flex-start' }]}
                    onPress={async () => {
                      try {
                        if (!routeBountyId || !bounty?.user_id) return;
                        const conv = await messageService.getOrCreateConversation([String(bounty.user_id)], '', routeBountyId || undefined);
                        if (conv) {
                          (router as any).push(`/messages/${conv.id}`);
                        }
                      } catch (e) {
                        console.warn('Unable to open or create conversation route', e);
                        Alert.alert('Message Failed', 'We could not open or create a conversation. You can try again or compose a new message manually.');
                        try {
                          if (routeBountyId) (router as any).push(`/messages/new?bountyId=${routeBountyId}`);
                        } catch (err) {
                          console.warn('Fallback to new message route failed', err);
                          Alert.alert('Unable to Open Composer', 'Opening the message composer failed. Please try again later.');
                        }
                      }
                    }}
                  >
                    <MaterialIcons name="chat-bubble-outline" size={18} color={theme.text} />
                    <Text style={styles.addProofText}>Message the poster</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )}
        ListEmptyComponent={() => (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Proof of your work</Text>
              <Text style={styles.sectionSubtitle}>
                Attach images or files showing your completed work
              </Text>
              <View style={styles.emptyProof}>
                <MaterialIcons name="attachment" size={48} color={theme.primaryLight} />
                <Text style={styles.emptyProofText}>No proof attached yet</Text>
              </View>
            </View>
          </>
        )}
        renderItem={renderProofItem}
        ListFooterComponent={() => (
          <>
            {hasActiveDispute && (
              <DisputeFrozenBanner message="A dispute has been opened for this bounty. Submitting evidence is paused until an admin resolves the dispute." />
            )}
            <TouchableOpacity accessibilityRole="button"
              style={[styles.addProofButton, (hasActiveDispute || isUploadingProof || isPickingProof) && styles.submitButtonDisabled]}
              onPress={handleAddProof}
              disabled={hasActiveDispute || isUploadingProof || isPickingProof}
            >
              {isUploadingProof || isPickingProof ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <MaterialIcons name={hasActiveDispute ? 'lock' : 'add'} size={20} color={theme.text} />
              )}
              <Text style={styles.addProofText}>
                {hasActiveDispute
                  ? 'Locked (Dispute Open)'
                  : isUploadingProof
                    ? 'Uploading…'
                    : isPickingProof
                      ? 'Selecting…'
                      : 'Add Proof'}
              </Text>
            </TouchableOpacity>
            <View style={{ height: 12 }} />
            <TouchableOpacity accessibilityRole="button"
              style={[styles.submitButton, (isSubmitting || hasActiveDispute || isUploadingProof || isPickingProof) && styles.submitButtonDisabled]}
              onPress={handleRequestReview}
              disabled={isSubmitting || hasActiveDispute || isUploadingProof || isPickingProof}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <Text style={styles.submitButtonText}>
                  {hasActiveDispute
                    ? 'Locked (Dispute Open)'
                    : isUploadingProof || isPickingProof
                      ? 'Uploading proof…'
                      : 'Submit'}
                </Text>
              )}
            </TouchableOpacity>
            <View style={{ height: 12 }} />
            {/* Raise Dispute / View Dispute Button */}
            {hasActiveDispute ? (
              <TouchableOpacity accessibilityRole="button"
                style={styles.disputeButton}
                onPress={() => (router as any).push(`/dispute/${activeDisputeId}`)}
              >
                <MaterialIcons name="gavel" size={18} color={theme.warningText} />
                <Text style={styles.disputeButtonText}>View dispute</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity accessibilityRole="button"
                style={styles.disputeButton}
                onPress={() => setShowDisputeModal(true)}
              >
                <MaterialIcons name="gavel" size={18} color={theme.warningText} />
                <Text style={styles.disputeButtonText}>Open a dispute</Text>
              </TouchableOpacity>
            )}

            {/* Workflow Dispute Modal */}
            {bounty && routeBountyId && (
              <WorkflowDisputeModal
                visible={showDisputeModal}
                bountyId={routeBountyId}
                bountyTitle={bounty.title}
                initiatorId={currentUserId}
                respondentId={String(bounty.poster_id || bounty.user_id)}
                stage="review_verify"
                onClose={() => setShowDisputeModal(false)}
                onDisputeCreated={(disputeId) => {
                  setShowDisputeModal(false);
                  setHasActiveDispute(true);
                  setActiveDisputeId(disputeId);
                  Alert.alert('Dispute Filed', 'Your dispute has been submitted.', [
                    { text: 'View Dispute', onPress: () => (router as any).push(`/dispute/${disputeId}`) },
                    { text: 'OK' },
                  ]);
                }}
              />
            )}
          </>
        )}
      />
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.background,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  errorText: {
    color: theme.errorText,
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: theme.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: theme.primaryLight,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(theme.primary, 0.1),
  },
  backIcon: {
    padding: 4,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  bountyInfoCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
    gap: 12,
  },
  bountyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  timerLabel: {
    color: theme.primaryLight,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: theme.text,
    fontSize: 48,
    fontWeight: '700',
  },
  timerHint: {
    color: withAlpha(theme.text, 0.6),
    fontSize: 12,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bountyAmount: {
    color: theme.primaryLight,
    fontSize: 20,
    fontWeight: '700',
  },
  sectionTitle: {
    color: theme.primaryLight,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    gap: 12,
  },
  sectionSubtitle: {
    color: withAlpha(theme.text, 0.7),
    fontSize: 13,
  },
  messageTextArea: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    color: theme.text,
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  messageInputContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  messageInput: {
    flex: 1,
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    color: theme.text,
    fontSize: 14,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  sendButton: {
    backgroundColor: theme.primary,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: withAlpha(theme.primary, 0.5),
  },
  proofList: {
    gap: 12,
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  proofIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: withAlpha(theme.primary, 0.3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofInfo: {
    flex: 1,
    gap: 4,
  },
  proofName: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
  },
  proofSize: {
    color: theme.primaryLight,
    fontSize: 12,
  },
  removeButton: {
    padding: 8,
  },
  emptyProof: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.borderSubtle,
    borderStyle: 'dashed',
  },
  emptyProofText: {
    color: withAlpha(theme.text, 0.6),
    fontSize: 14,
  },
  addProofButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: withAlpha(theme.text, 0.1),
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  addProofText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  submitButtonDisabled: {
    backgroundColor: withAlpha(theme.primary, 0.5),
  },
  submitButtonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  disputeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: withAlpha(theme.warning, 0.15),
    borderWidth: 1,
    borderColor: withAlpha(theme.warning, 0.3),
  },
  disputeButtonText: {
    color: theme.warningText,
    fontSize: 14,
    fontWeight: '600',
  },
});
}
