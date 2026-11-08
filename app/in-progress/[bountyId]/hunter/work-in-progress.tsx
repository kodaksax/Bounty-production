// app/in-progress/[bountyId]/hunter/work-in-progress.tsx - Work in progress stage
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../../hooks/useSafeBack';
import React, { useEffect, useRef, useState } from 'react';
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
import { WorkflowDisputeModal } from '../../../../components/workflow-dispute-modal';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { disputeService } from '../../../../lib/services/dispute-service';
import { messageService } from '../../../../lib/services/message-service';
import type { Conversation } from '../../../../lib/types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';
import { formatPublicLocation } from '../../../../lib/utils/public-location';
import { formatExactAddress, useBountyExactLocation } from '../../../../hooks/useBountyExactLocation';
import { KeyboardAwareScrollView } from '../../../../components/ui/keyboard-avoiding';
import { TrustSafetyNotice } from '../../../../components/ui/trust-safety-notice';
import { getApplicationSafetyMessage } from '../../../../lib/utils/bounty-lifecycle';
import { useChatSendProtection, useChatSendScope } from '../../../../hooks/use-chat-send-protection';
import { ChatSafetyWarning } from '../../../../components/chat-safety-warning';
import { detectOffPlatformRisk } from '../../../../lib/utils/off-platform-risk';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { withAlpha } from '../../../../lib/utils';
import { showToast } from '../../../../lib/toast';
import { HunterStageTimeline, type HunterStage } from '../../../../components/hunter-stage-timeline';

export default function HunterWorkInProgressScreen() {
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
  const [currentStage] = useState<HunterStage>('work_in_progress');
  const [messageText, setMessageText] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const confirmSend = useChatSendProtection(conversation?.id);
  const sendInFlightRef = useRef(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [progressUpdate, setProgressUpdate] = useState('');
  const [isPostingUpdate, setIsPostingUpdate] = useState(false);
  const [showProgressForm, setShowProgressForm] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [hasActiveDispute, setHasActiveDispute] = useState(false);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);
  // bounty.location is only a "City, ST" label; the accepted hunter gets the
  // street address from the access-checked RPC.
  const { exact: exactLocation } = useBountyExactLocation(
    bounty?.id,
    !!bounty && !!currentUserId && String(bounty.accepted_by ?? '') === String(currentUserId)
  );
  const locationText =
    formatExactAddress(exactLocation) || (bounty ? formatPublicLocation(bounty) : null);

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);
  const captureSendScope = useChatSendScope(routeBountyId ?? undefined);

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
        // No application on this bounty: send them to the read-only view where
        // they can actually apply. The old alert + router.back() dead-ended
        // anyone who arrived from a notification or a shared link.
        router.replace({ pathname: '/bounty/[id]/public', params: { id } });
        return;
      }

      const hunterRequest = requests[0];
      setRequest(hunterRequest);

      // If not accepted yet, go back to apply screen
      if (hunterRequest.status !== 'accepted' || !currentUserId ||
        String(bountyData.accepted_by ?? '') !== String(currentUserId) ||
        bountyData.status !== 'in_progress') {
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

  const handleSendMessage = async () => {
    const text = messageText.trim();
    if (!text || isSendingMessage || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const isCurrentSend = captureSendScope();
    let started = false;

    let conv = conversation;
    try {
      if (!(await confirmSend(text)) || !isCurrentSend()) return;
      started = true;
      setIsSendingMessage(true);

      // If no existing conversation, create or get one for this bounty and participants
      if (!conv) {
        if (!bounty || !bounty.user_id) {
          Alert.alert('No Conversation', 'No active conversation found for this bounty.');
          setIsSendingMessage(false);
          return;
        }

        conv = await messageService.getOrCreateConversation([String(bounty.user_id)], '', routeBountyId || undefined);
        if (!isCurrentSend()) return;
        setConversation(conv);
      }

      // conv will be set by getOrCreateConversation above; no further null-check required

      await messageService.sendMessage(conv.id, text);
      if (!isCurrentSend()) return;
      setMessageText('');
      showToast({ message: 'Message sent successfully!' });
    } catch (err) {
      console.error('Error sending message:', err);
      Alert.alert("Couldn't send message", "Please try again.");
    } finally {
      sendInFlightRef.current = false;
      if (started && isCurrentSend()) setIsSendingMessage(false);
    }
  };

  const handlePostProgressUpdate = async () => {
    if (isPostingUpdate || sendInFlightRef.current) return;
    const text = progressUpdate.trim();
    if (!text) {
      Alert.alert('Empty Update', 'Please enter a progress update.');
      return;
    }
    sendInFlightRef.current = true;
    const isCurrentSend = captureSendScope();
    let started = false;

    try {
      if (!(await confirmSend(text)) || !isCurrentSend()) return;
      started = true;
      setIsPostingUpdate(true);
      
      // Send progress update via message
      if (conversation) {
        await messageService.sendMessage(
          conversation.id,
          `📋 Progress Update: ${text}`,
          currentUserId
        );
      }

      if (!isCurrentSend()) return;
      setProgressUpdate('');
      setShowProgressForm(false);
      showToast({ message: 'Progress update posted successfully!' });
    } catch (err) {
      console.error('Error posting progress update:', err);
      Alert.alert("Couldn't post progress update", "Please try again.");
    } finally {
      sendInFlightRef.current = false;
      if (started && isCurrentSend()) setIsPostingUpdate(false);
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

  if (request.status !== 'accepted' || !currentUserId ||
    String(bounty.accepted_by ?? '') !== String(currentUserId) ||
    bounty.status !== 'in_progress') {
    return <HunterDashboardSkeleton />;
  }

  // Guard every access: `description` is optional on the two-step posting flow
  // and null on some older/API-created rows — an unguarded `.length` here
  // white-screens the hunter's active-job screen.
  const description = bounty.description ?? '';
  const descriptionPreview =
    description.length > 150 ? description.substring(0, 150) + '...' : description;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Go back" accessibilityRole="button" style={styles.backIcon} onPress={goBack}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your work</Text>
      </View>

      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Header Card */}
        <View style={styles.bountyCard}>
          <View style={styles.bountyHeader}>
            <View style={styles.avatarPlaceholder}>
              <MaterialIcons name="person" size={32} color={theme.primaryLight} />
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
                <MaterialIcons name="favorite" size={16} color={theme.text} />
                <Text style={styles.honorText}>For Honor</Text>
              </View>
            ) : (
              <Text style={styles.amount}>${bounty.amount}</Text>
            )}
          </View>
        </View>

        <TrustSafetyNotice message={getApplicationSafetyMessage({
          bounty, viewerId: currentUserId, requestStatus: request.status,
        })} />

        {/* Timeline */}
        <HunterStageTimeline currentStage={currentStage} />

        {/* Quick Messaging */}
        {conversation && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick message</Text>
            <View style={styles.messageInputContainer}>
              <TextInput
                style={styles.messageInput}
                placeholder="Type a message to the poster..."
                placeholderTextColor={withAlpha(theme.text, 0.4)}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendButton, !messageText.trim() && styles.sendButtonDisabled]}
                onPress={handleSendMessage}
                disabled={!messageText.trim() || isSendingMessage}
                accessibilityRole="button"
                accessibilityLabel="Send message to poster"
              >
                {isSendingMessage ? (
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                ) : (
                  <MaterialIcons name="send" size={20} color={theme.onPrimary} />
                )}
              </TouchableOpacity>
            </View>
            <ChatSafetyWarning risk={detectOffPlatformRisk(messageText)} />
          </View>
        )}

        {/* Progress Updates Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Updates</Text>
            <TouchableOpacity accessibilityRole="button"
              style={styles.addUpdateButton}
              onPress={() => setShowProgressForm(!showProgressForm)}
            >
              <MaterialIcons
                name={showProgressForm ? 'remove' : 'add'}
                size={20}
                color={theme.primaryLight}
              />
              <Text style={styles.addUpdateText}>
                {showProgressForm ? 'Hide' : 'Add update'}
              </Text>
            </TouchableOpacity>
          </View>

          {showProgressForm && (
            <View style={styles.progressFormContainer}>
              <TextInput
                style={styles.progressInput}
                placeholder="Describe your progress..."
                placeholderTextColor={withAlpha(theme.text, 0.4)}
                value={progressUpdate}
                onChangeText={setProgressUpdate}
                multiline
                numberOfLines={4}
                maxLength={500}
              />
              <ChatSafetyWarning risk={detectOffPlatformRisk(progressUpdate)} />
              <TouchableOpacity accessibilityRole="button"
                style={[
                  styles.postUpdateButton,
                  (!progressUpdate.trim() || isPostingUpdate) && styles.postUpdateButtonDisabled,
                ]}
                onPress={handlePostProgressUpdate}
                disabled={!progressUpdate.trim() || isPostingUpdate}
              >
                {isPostingUpdate ? (
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                ) : (
                  <>
                    <MaterialIcons name="send" size={18} color={theme.onPrimary} />
                    <Text style={styles.postUpdateButtonText}>Post update</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.progressHint}>
            <MaterialIcons name="info-outline" size={16} color={theme.primaryLight} />
            <Text style={styles.progressHintText}>
              Share progress updates with the poster to keep them informed
            </Text>
          </View>
        </View>

        {/* Context Panel - Description */}
        <View style={styles.contextPanel}>
          <Text style={styles.contextTitle}>Description</Text>
          <Text style={styles.contextText}>
            {descriptionExpanded ? description : descriptionPreview}
          </Text>
          {description.length > 150 && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setDescriptionExpanded(!descriptionExpanded)}>
              <Text style={styles.expandText}>
                {descriptionExpanded ? 'Show Less' : 'Show More'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Timeline & Location Info */}
        <View style={styles.infoRow}>
          {locationText && (
            <View style={styles.infoItem}>
              <MaterialIcons name="location-on" size={16} color={theme.primaryLight} />
              <Text style={styles.infoText}>{locationText}</Text>
            </View>
          )}
          {bounty.timeline && (
            <View style={styles.infoItem}>
              <MaterialIcons name="schedule" size={16} color={theme.primaryLight} />
              <Text style={styles.infoText}>{bounty.timeline}</Text>
            </View>
          )}
        </View>

        {/* Mark as Complete Button */}
        <TouchableOpacity accessibilityRole="button" style={styles.completeButton} onPress={handleMarkAsComplete}>
          <MaterialIcons name="check-circle" size={20} color={theme.onPrimary} />
          <Text style={styles.completeButtonText}>Mark as complete</Text>
        </TouchableOpacity>

        {/* Raise Dispute / View Dispute Button */}
        {hasActiveDispute ? (
          <TouchableOpacity accessibilityRole="button"
            style={styles.disputeButton}
            onPress={() => (router as any).push(`/dispute/${activeDisputeId}`)}
          >
            <MaterialIcons name="gavel" size={20} color={theme.warningText} />
            <Text style={styles.disputeButtonText}>View dispute</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity accessibilityRole="button"
            style={styles.disputeButton}
            onPress={() => setShowDisputeModal(true)}
          >
            <MaterialIcons name="gavel" size={20} color={theme.warningText} />
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
            stage="in_progress"
            onClose={() => setShowDisputeModal(false)}
            onDisputeCreated={(disputeId) => {
              setShowDisputeModal(false);
              setHasActiveDispute(true);
              setActiveDisputeId(disputeId);
              Alert.alert('Dispute Filed', 'Your dispute has been submitted and the other party has been notified.', [
                { text: 'View Dispute', onPress: () => (router as any).push(`/dispute/${disputeId}`) },
                { text: 'OK' },
              ]);
            }}
          />
        )}

        {/* Next Button */}
        <TouchableOpacity accessibilityRole="button" style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>Next</Text>
          <MaterialIcons name="arrow-forward" size={20} color={theme.onPrimary} />
        </TouchableOpacity>
      </KeyboardAwareScrollView>
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
  bountyCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
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
    backgroundColor: withAlpha(theme.primary, 0.3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  bountyInfo: {
    flex: 1,
  },
  bountyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  postedTime: {
    color: theme.primaryLight,
    fontSize: 12,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    color: theme.primaryLight,
    fontSize: 24,
    fontWeight: '700',
  },
  honorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  honorText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '600',
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
    backgroundColor: theme.surfaceSecondary,
  },
  addUpdateText: {
    color: theme.primaryLight,
    fontSize: 13,
    fontWeight: '600',
  },
  progressFormContainer: {
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  progressInput: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    color: theme.text,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  postUpdateButton: {
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  postUpdateButtonDisabled: {
    backgroundColor: withAlpha(theme.primary, 0.5),
  },
  postUpdateButtonText: {
    color: theme.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  progressHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: withAlpha(theme.primary, 0.1),
    borderRadius: 8,
  },
  progressHintText: {
    color: theme.primaryLight,
    fontSize: 12,
    flex: 1,
  },
  completeButton: {
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
    marginBottom: 12,
  },
  completeButtonText: {
    color: theme.onPrimary,
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
  contextPanel: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  contextTitle: {
    color: theme.primaryLight,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextText: {
    color: withAlpha(theme.text, 0.9),
    fontSize: 14,
    lineHeight: 20,
  },
  expandText: {
    color: theme.primaryLight,
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
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
  },
  nextButton: {
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
  nextButtonText: {
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
