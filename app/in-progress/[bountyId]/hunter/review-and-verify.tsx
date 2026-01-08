import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { useAttachmentUpload } from '../../../../hooks/use-attachment-upload';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import { completionService, type ProofItem } from '../../../../lib/services/completion-service';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { messageService } from '../../../../lib/services/message-service';
import type { Conversation } from '../../../../lib/types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';

type HunterStage = 'apply' | 'work_in_progress' | 'review_verify' | 'payout';

interface StageInfo {
  id: HunterStage;
  label: string;
  icon: string;
}

const HUNTER_STAGES: StageInfo[] = [
  { id: 'apply', label: 'Apply for work', icon: 'work' },
  { id: 'work_in_progress', label: 'Work in progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
];

export default function HunterReviewAndVerifyScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('review_verify');
  const [messageText, setMessageText] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0); // in seconds
  const [startTime] = useState(Date.now());

  // Attachment upload hook
  const {
    isUploading,
    isPicking,
    progress,
    pickAttachment,
    error: uploadError,
    clearError,
  } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: 'proofs',
    maxSizeMB: 10,
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
      Alert.alert('Upload Error', error.message);
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

    // Start timer
    const interval = setInterval(() => {
      setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [routeBountyId, startTime]);

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
        Alert.alert('No Application', 'You have not applied to this bounty.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      const hunterRequest = requests[0];
      setRequest(hunterRequest);

      // If not accepted yet, go back to apply screen
      if (hunterRequest.status !== 'accepted') {
        router.replace({
          pathname: '/in-progress/[bountyId]/hunter/apply',
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
        try { parsed = JSON.parse(attachmentsJson) } catch (e) { parsed = [] }
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

  const handleSendMessage = async () => {
    if (!messageText.trim() || !conversation) {
      if (!conversation) {
        Alert.alert('No Conversation', 'No active conversation found for this bounty.');
      }
      return;
    }

    try {
      setIsSendingMessage(true);
      await messageService.sendMessage(conversation.id, messageText.trim());
      setMessageText('');
      Alert.alert('Success', 'Message sent successfully!');
    } catch (err) {
      console.error('Error sending message:', err);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleAddProof = async () => {
    await pickAttachment();
  };

  const handleRemoveProof = (id: string) => {
    setProofItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRequestReview = async () => {
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
        Alert.alert('Error', 'Failed to request review. Please try again.');
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
          color="#6ee7b7"
        />
      </View>
      <View style={styles.proofInfo}>
        <Text style={styles.proofName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button"
        style={styles.removeButton}
        onPress={() => handleRemoveProof(item.id)}
      >
        <MaterialIcons name="close" size={20} color="#ef4444" />
      </TouchableOpacity>
    </View>
  );

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

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
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error || 'Data not found'}</Text>
        <TouchableOpacity accessibilityRole="button"
          style={styles.retryButton}
          onPress={() => routeBountyId && loadData(routeBountyId)}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" style={styles.backIcon} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Verify</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Info Card with Timer */}
        <View style={styles.bountyInfoCard}>
          <Text style={styles.bountyTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          <View style={styles.timerContainer}>
            <Text style={styles.timerLabel}>Time Spent in Review</Text>
            <Text style={styles.timerValue}>{formatTime(timeElapsed)}</Text>
            <Text style={styles.timerHint}>Track your time on this task</Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.bountyAmount}>
              {bounty.is_for_honor ? 'For Honor' : `$${bounty.amount}`}
            </Text>
            <View style={styles.distanceInfo}>
              <MaterialIcons name="near-me" size={16} color="#6ee7b7" />
              <Text style={styles.distanceText}>0 mi</Text>
            </View>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.timelineContainer}>
          <Text style={styles.sectionTitle}>Progress Timeline</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timeline}
          >
            {HUNTER_STAGES.map((stage, index) => {
              const isActive = stage.id === currentStage;
              const stageIndex = HUNTER_STAGES.findIndex((s) => s.id === stage.id);
              const currentIndex = HUNTER_STAGES.findIndex((s) => s.id === currentStage);
              const isCompleted = stageIndex < currentIndex;
              const isAccessible = stageIndex <= currentIndex;

              return (
                <View
                  key={stage.id}
                  style={[
                    styles.stageItem,
                    isActive && styles.stageItemActive,
                    isCompleted && styles.stageItemCompleted,
                    !isAccessible && styles.stageItemLocked,
                  ]}
                >
                  <View
                    style={[
                      styles.stageIcon,
                      isActive && styles.stageIconActive,
                      isCompleted && styles.stageIconCompleted,
                    ]}
                  >
                    <MaterialIcons
                      name={stage.icon as any}
                      size={24}
                      color={isActive || isCompleted ? '#fff' : '#6ee7b7'}
                    />
                  </View>
                  <Text style={styles.stageLabel}>{stage.label}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Message Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Message (cont):</Text>
          <TextInput accessibilityLabel="Text input field"
            style={styles.messageTextArea}
            placeholder="Describe your completed work..."
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            numberOfLines={4}
            maxLength={1000}
            textAlignVertical="top"
          />
        </View>

        {/* Proof of Completion */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Proof of Completion</Text>
          <Text style={styles.sectionSubtitle}>
            Attach images or files showing your completed work
          </Text>
          {proofItems.length > 0 ? (
            <FlatList
              data={proofItems}
              renderItem={renderProofItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              contentContainerStyle={styles.proofList}
            />
          ) : (
            <View style={styles.emptyProof}>
              <MaterialIcons name="attachment" size={48} color="#6ee7b7" />
              <Text style={styles.emptyProofText}>No proof attached yet</Text>
            </View>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.addProofButton} onPress={handleAddProof}>
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={styles.addProofText}>Add Proof</Text>
          </TouchableOpacity>
        </View>

        {/* Submit Button */}
        <TouchableOpacity accessibilityRole="button"
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleRequestReview}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#6ee7b7',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
  },
  backIcon: {
    padding: 4,
  },
  headerTitle: {
    color: '#fff',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
    gap: 12,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  timerLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
  },
  timerHint: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 11,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bountyAmount: {
    color: '#10b981',
    fontSize: 20,
    fontWeight: '700',
  },
  distanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distanceText: {
    color: '#6ee7b7',
    fontSize: 14,
  },
  timelineContainer: {
    gap: 12,
  },
  sectionTitle: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timeline: {
    gap: 16,
    paddingVertical: 8,
  },
  stageItem: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 120,
  },
  stageItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    borderColor: '#10b981',
    borderWidth: 2,
  },
  stageItemCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10b981',
  },
  stageItemLocked: {
    opacity: 0.5,
  },
  stageIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  stageIconActive: {
    backgroundColor: '#10b981',
  },
  stageIconCompleted: {
    backgroundColor: '#059669',
  },
  stageLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    textAlign: 'center',
  },
  section: {
    gap: 12,
  },
  sectionSubtitle: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 13,
  },
  messageTextArea: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  messageInputContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  messageInput: {
    flex: 1,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  sendButton: {
    backgroundColor: '#10b981',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(16, 185, 129, 0.5)',
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
  removeButton: {
    padding: 8,
  },
  emptyProof: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    borderStyle: 'dashed',
  },
  emptyProofText: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 14,
  },
  addProofButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  addProofText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#10b981',
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
    backgroundColor: 'rgba(16, 185, 129, 0.5)',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
