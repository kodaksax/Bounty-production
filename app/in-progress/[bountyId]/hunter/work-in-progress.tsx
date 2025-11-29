// app/in-progress/[bountyId]/hunter/work-in-progress.tsx - Work in progress stage
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
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

export default function HunterWorkInProgressScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('work_in_progress');
  const [messageText, setMessageText] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [progressUpdate, setProgressUpdate] = useState('');
  const [isPostingUpdate, setIsPostingUpdate] = useState(false);
  const [showProgressForm, setShowProgressForm] = useState(false);

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
  }, [routeBountyId]);

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

  const handlePostProgressUpdate = async () => {
    if (!progressUpdate.trim()) {
      Alert.alert('Empty Update', 'Please enter a progress update.');
      return;
    }

    try {
      setIsPostingUpdate(true);
      
      // Send progress update via message
      if (conversation) {
        await messageService.sendMessage(
          conversation.id,
          `📋 Progress Update: ${progressUpdate.trim()}`,
          currentUserId
        );
      }

      setProgressUpdate('');
      setShowProgressForm(false);
      Alert.alert('Success', 'Progress update posted successfully!');
    } catch (err) {
      console.error('Error posting progress update:', err);
      Alert.alert('Error', 'Failed to post progress update. Please try again.');
    } finally {
      setIsPostingUpdate(false);
    }
  };

  const handleMarkAsComplete = () => {
    Alert.alert(
      'Mark as Complete',
      'Are you ready to submit your work for review? You can add proof of completion on the next screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            if (routeBountyId) {
              router.push({
                pathname: '/in-progress/[bountyId]/hunter/review-and-verify',
                params: { bountyId: routeBountyId },
              });
            }
          },
        },
      ]
    );
  };

  const handleNext = () => {
    if (routeBountyId) {
      router.push({
        pathname: '/in-progress/[bountyId]/hunter/review-and-verify',
        params: { bountyId: routeBountyId },
      });
    }
  };

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
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => routeBountyId && loadData(routeBountyId)}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const descriptionPreview =
    bounty.description.length > 150
      ? bounty.description.substring(0, 150) + '...'
      : bounty.description;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hunter Dashboard</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Header Card */}
        <View style={styles.bountyCard}>
          <View style={styles.bountyHeader}>
            <View style={styles.avatarPlaceholder}>
              <MaterialIcons name="person" size={32} color="#6ee7b7" />
            </View>
            <View style={styles.bountyInfo}>
              <Text style={styles.bountyTitle} numberOfLines={2}>
                {bounty.title}
              </Text>
              <Text style={styles.postedTime}>
                Posted {formatTimeAgo(bounty.created_at)}
              </Text>
            </View>
          </View>
          <View style={styles.amountContainer}>
            {bounty.is_for_honor ? (
              <View style={styles.honorBadge}>
                <MaterialIcons name="favorite" size={16} color="#fff" />
                <Text style={styles.honorText}>For Honor</Text>
              </View>
            ) : (
              <Text style={styles.amount}>${bounty.amount}</Text>
            )}
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

        {/* Quick Messaging */}
        {conversation && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Message</Text>
            <View style={styles.messageInputContainer}>
              <TextInput
                style={styles.messageInput}
                placeholder="Type a message to the poster..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendButton, !messageText.trim() && styles.sendButtonDisabled]}
                onPress={handleSendMessage}
                disabled={!messageText.trim() || isSendingMessage}
              >
                {isSendingMessage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Progress Updates Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Progress Updates</Text>
            <TouchableOpacity
              style={styles.addUpdateButton}
              onPress={() => setShowProgressForm(!showProgressForm)}
            >
              <MaterialIcons
                name={showProgressForm ? 'remove' : 'add'}
                size={20}
                color="#10b981"
              />
              <Text style={styles.addUpdateText}>
                {showProgressForm ? 'Hide' : 'Add Update'}
              </Text>
            </TouchableOpacity>
          </View>

          {showProgressForm && (
            <View style={styles.progressFormContainer}>
              <TextInput
                style={styles.progressInput}
                placeholder="Describe your progress..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={progressUpdate}
                onChangeText={setProgressUpdate}
                multiline
                numberOfLines={4}
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.postUpdateButton,
                  (!progressUpdate.trim() || isPostingUpdate) && styles.postUpdateButtonDisabled,
                ]}
                onPress={handlePostProgressUpdate}
                disabled={!progressUpdate.trim() || isPostingUpdate}
              >
                {isPostingUpdate ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="send" size={18} color="#fff" />
                    <Text style={styles.postUpdateButtonText}>Post Update</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.progressHint}>
            <MaterialIcons name="info-outline" size={16} color="#6ee7b7" />
            <Text style={styles.progressHintText}>
              Share progress updates with the poster to keep them informed
            </Text>
          </View>
        </View>

        {/* Context Panel - Description */}
        <View style={styles.contextPanel}>
          <Text style={styles.contextTitle}>Description</Text>
          <Text style={styles.contextText}>
            {descriptionExpanded ? bounty.description : descriptionPreview}
          </Text>
          {bounty.description.length > 150 && (
            <TouchableOpacity onPress={() => setDescriptionExpanded(!descriptionExpanded)}>
              <Text style={styles.expandText}>
                {descriptionExpanded ? 'Show Less' : 'Show More'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Timeline & Location Info */}
        <View style={styles.infoRow}>
          {bounty.location && (
            <View style={styles.infoItem}>
              <MaterialIcons name="location-on" size={16} color="#6ee7b7" />
              <Text style={styles.infoText}>{bounty.location}</Text>
            </View>
          )}
          {bounty.timeline && (
            <View style={styles.infoItem}>
              <MaterialIcons name="schedule" size={16} color="#6ee7b7" />
              <Text style={styles.infoText}>{bounty.timeline}</Text>
            </View>
          )}
        </View>

        {/* Mark as Complete Button */}
        <TouchableOpacity style={styles.completeButton} onPress={handleMarkAsComplete}>
          <MaterialIcons name="check-circle" size={20} color="#fff" />
          <Text style={styles.completeButtonText}>Mark as Complete</Text>
        </TouchableOpacity>

        {/* Next Button */}
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>Next</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#fff" />
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
  bountyCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  bountyHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bountyInfo: {
    flex: 1,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  postedTime: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    color: '#10b981',
    fontSize: 24,
    fontWeight: '700',
  },
  honorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ec4899',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  honorText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addUpdateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  addUpdateText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '600',
  },
  progressFormContainer: {
    gap: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  progressInput: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  postUpdateButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  postUpdateButtonDisabled: {
    backgroundColor: 'rgba(16, 185, 129, 0.5)',
  },
  postUpdateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  progressHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 8,
  },
  progressHintText: {
    color: '#6ee7b7',
    fontSize: 12,
    flex: 1,
  },
  completeButton: {
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
    marginBottom: 12,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  contextPanel: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  contextTitle: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextText: {
    color: 'rgba(255,254,245,0.9)',
    fontSize: 14,
    lineHeight: 20,
  },
  expandText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
  nextButton: {
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
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
