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
import { useAuthContext } from '../../../hooks/use-auth-context';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { messageService } from '../../../lib/services/message-service';
import type { Conversation } from '../../../lib/types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';
import { NotFoundScreen } from '../../../components/not-found-screen';

type BountyStage = 'apply_work' | 'working_progress' | 'review_verify' | 'payout';

interface StageInfo {
  id: BountyStage;
  label: string;
  icon: string;
}

const STAGES: StageInfo[] = [
  { id: 'apply_work', label: 'Apply & Work', icon: 'work' },
  { id: 'working_progress', label: 'Working Progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & Verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
];

export default function BountyDashboard() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<BountyStage>('apply_work');
  const [messageText, setMessageText] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Normalize route param to a string (supports UUIDs)
  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId
    return raw && String(raw).trim().length > 0 ? String(raw) : null
  }, [bountyId])

  useEffect(() => {
    if (!routeBountyId) {
      setError('Invalid bounty id')
      setIsLoading(false)
      return
    }
    loadBounty(routeBountyId)
    loadConversation(routeBountyId)
  }, [routeBountyId]);

  const loadBounty = async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await bountyService.getById(id);
      
      if (!data) {
        throw new Error('Bounty not found');
      }

      // Check ownership
      if (data.user_id !== currentUserId) {
        Alert.alert('Access Denied', 'You can only view your own bounty dashboards.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      setBounty(data);

      // Map bounty status to stage
      if (data.status === 'open') {
        setCurrentStage('apply_work');
      } else if (data.status === 'in_progress') {
        setCurrentStage('working_progress');
      } else if (data.status === 'completed') {
        setCurrentStage('payout');
      }
    } catch (err) {
      console.error('Error loading bounty:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
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

  const handleStagePress = (stage: BountyStage) => {
    const stageIndex = STAGES.findIndex((s) => s.id === stage);
    const currentIndex = STAGES.findIndex((s) => s.id === currentStage);

    // Can only navigate to current or previous stages
    if (stageIndex > currentIndex) {
      Alert.alert('Stage Locked', 'Complete current stage to unlock this stage.');
      return;
    }

    setCurrentStage(stage);
  };

  const handleNext = () => {
    const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
    
    if (currentIndex === STAGES.length - 2) {
      // Moving from review_verify to payout
      if (routeBountyId) {
        router.push({ pathname: '/postings/[bountyId]/review-and-verify', params: { bountyId: routeBountyId } })
      }
    } else if (currentIndex < STAGES.length - 1) {
      const nextStage = STAGES[currentIndex + 1];
      setCurrentStage(nextStage.id);
    }
  };

  const getStatusBadgeColor = (status?: string) => {
    switch (status) {
      case 'open':
        return '#10b981'; // emerald-500
      case 'in_progress':
        return '#fbbf24'; // amber-400
      case 'completed':
        return '#6366f1'; // indigo-500
      case 'archived':
        return '#6b7280'; // gray-500
      default:
        return '#10b981';
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'open':
        return 'OPEN';
      case 'in_progress':
        return 'IN PROGRESS';
      case 'completed':
        return 'COMPLETED';
      case 'archived':
        return 'ARCHIVED';
      default:
        return 'OPEN';
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Loading bounty...</Text>
      </View>
    );
  }

  if (error || !bounty) {
    // Check if it's a "not found" error
    const isNotFound = error?.includes('not found') || error?.includes('Not found') || !bounty;
    
    if (isNotFound) {
      return (
        <NotFoundScreen
          title="Bounty Not Found"
          message="The bounty you're looking for doesn't exist or has been removed."
          icon="search-off"
          actionText="Go Back"
          onAction={() => router.back()}
        />
      );
    }
    
    // Other errors - show error screen with retry
    return (
      <View style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error || 'Failed to load bounty'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => routeBountyId && loadBounty(routeBountyId)}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const descriptionPreview = bounty.description.length > 150 
    ? bounty.description.substring(0, 150) + '...' 
    : bounty.description;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bounty Dashboard</Text>
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
              <MaterialIcons name="person" size={32} color="#fff" />
            </View>
            <View style={styles.bountyHeaderInfo}>
              <Text style={styles.bountyTitle} numberOfLines={2}>
                {bounty.title}
              </Text>
              <Text style={styles.bountyAge}>{formatTimeAgo(bounty.created_at)}</Text>
            </View>
          </View>

          <View style={styles.bountyMeta}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusBadgeColor(bounty.status) }]}>
              <Text style={styles.statusBadgeText}>{getStatusLabel(bounty.status)}</Text>
            </View>
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
        {bounty.status === 'open' && (
          <View style={styles.preAcceptancePanel}>
            <MaterialIcons name="hourglass-empty" size={24} color="#6ee7b7" />
            <Text style={styles.preAcceptanceTitle}>Awaiting a hunter</Text>
            <Text style={styles.preAcceptanceText}>
              This posting is visible in the feed. You’ll receive requests from hunters and can review them from the Postings screen.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
                <Text style={styles.secondaryBtnText}>Back to My Postings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.timelineContainer}>
          <Text style={styles.sectionTitle}>Progress Timeline</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
            {STAGES.map((stage, index) => {
              const isActive = stage.id === currentStage;
              const stageIndex = STAGES.findIndex((s) => s.id === stage.id);
              const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
              const isCompleted = stageIndex < currentIndex;
              const isAccessible = stageIndex <= currentIndex;

              return (
                <TouchableOpacity
                  key={stage.id}
                  style={[
                    styles.stageItem,
                    isActive && styles.stageItemActive,
                    isCompleted && styles.stageItemCompleted,
                    !isAccessible && styles.stageItemLocked,
                  ]}
                  onPress={() => handleStagePress(stage.id)}
                  disabled={!isAccessible}
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
                  <Text
                    style={[
                      styles.stageLabel,
                      isActive && styles.stageLabelActive,
                      isCompleted && styles.stageLabelCompleted,
                    ]}
                    numberOfLines={2}
                  >
                    {stage.label}
                  </Text>
                  {isCompleted && (
                    <View style={styles.completedCheckmark}>
                      <MaterialIcons name="check-circle" size={16} color="#10b981" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Quick Message */}
        <View style={styles.messageContainer}>
          <Text style={styles.sectionTitle}>Quick Message</Text>
          {conversation ? (
            <View style={styles.messageInputContainer}>
              <TextInput
                style={styles.messageInput}
                placeholder="Type a message to the hunter..."
                placeholderTextColor="rgba(110, 231, 183, 0.4)"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity
                style={[styles.sendButton, (!messageText.trim() || isSendingMessage) && styles.sendButtonDisabled]}
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
          ) : (
            <View style={styles.noConversation}>
              <MaterialIcons name="chat-bubble-outline" size={32} color="#6ee7b7" />
              <Text style={styles.noConversationText}>No active conversation yet</Text>
              <Text style={styles.noConversationSubtext}>
                A conversation will be created when a hunter accepts this bounty
              </Text>
            </View>
          )}
        </View>

        {/* Context Panel - Description */}
        <View style={styles.contextPanel}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>
            {descriptionExpanded ? bounty.description : descriptionPreview}
          </Text>
          {bounty.description.length > 150 && (
            <TouchableOpacity
              style={styles.expandButton}
              onPress={() => setDescriptionExpanded(!descriptionExpanded)}
            >
              <Text style={styles.expandButtonText}>
                {descriptionExpanded ? 'Show Less' : 'Show More'}
              </Text>
              <MaterialIcons
                name={descriptionExpanded ? 'expand-less' : 'expand-more'}
                size={16}
                color="#6ee7b7"
              />
            </TouchableOpacity>
          )}

          {/* Additional info */}
          {bounty.location && (
            <View style={styles.infoRow}>
              <MaterialIcons name="place" size={16} color="#6ee7b7" />
              <Text style={styles.infoText}>{bounty.location}</Text>
            </View>
          )}
          {bounty.timeline && (
            <View style={styles.infoRow}>
              <MaterialIcons name="schedule" size={16} color="#6ee7b7" />
              <Text style={styles.infoText}>{bounty.timeline}</Text>
            </View>
          )}
          {bounty.skills_required && (
            <View style={styles.infoRow}>
              <MaterialIcons name="build" size={16} color="#6ee7b7" />
              <Text style={styles.infoText}>{bounty.skills_required}</Text>
            </View>
          )}
        </View>

        {/* Next Button */}
        {currentStage !== 'payout' && (
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Text style={styles.nextButtonText}>
              {currentStage === 'review_verify' ? 'Go to Review & Verify' : 'Next Stage'}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        {currentStage === 'payout' && (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() => routeBountyId && router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: routeBountyId } })}
          >
            <Text style={styles.nextButtonText}>Go to Payout</Text>
            <MaterialIcons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 24,
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
    marginTop: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  backIcon: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  bountyCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  bountyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bountyHeaderInfo: {
    flex: 1,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  bountyAge: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  bountyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  amount: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  honorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  honorText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  timelineContainer: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  timeline: {
    paddingVertical: 8,
    gap: 12,
  },
  stageItem: {
    alignItems: 'center',
    width: 100,
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
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
  stageLabelActive: {
    color: '#fff',
    fontWeight: '600',
  },
  stageLabelCompleted: {
    color: '#6ee7b7',
  },
  completedCheckmark: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  messageContainer: {
    marginBottom: 16,
  },
  messageInputContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  messageInput: {
    flex: 1,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    minHeight: 80,
    textAlignVertical: 'top',
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
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  noConversation: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  noConversationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  noConversationSubtext: {
    color: '#6ee7b7',
    fontSize: 12,
    textAlign: 'center',
  },
  contextPanel: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  description: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  expandButtonText: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  infoText: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  nextButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  preAcceptancePanel: {
    backgroundColor: 'rgba(5, 150, 105, 0.25)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  preAcceptanceTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  preAcceptanceText: {
    color: '#d1fae5',
    fontSize: 13,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(110,231,183,0.5)',
  },
  secondaryBtnText: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
  },
});
