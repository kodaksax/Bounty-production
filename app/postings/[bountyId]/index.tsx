import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NotFoundScreen } from '../../../components/not-found-screen';
import WorkInProgressBanner from '../../../components/work-in-progress-banner';
import { useBackgroundColor } from '../../../lib/context/BackgroundColorContext';
import { bountyService } from '../../../lib/services/bounty-service';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import type { Bounty } from '../../../lib/services/database.types';
import { messageService } from '../../../lib/services/message-service';
import type { Conversation } from '../../../lib/types';
import { formatCategoryLabel, getCurrentUserId } from '../../../lib/utils/data-utils';

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
  const currentUserId = getCurrentUserId();
  const { pushColor, popColor } = useBackgroundColor();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<BountyStage>('apply_work');
  const [messageText, setMessageText] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const glowAnim = useRef(new Animated.Value(0)).current;

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
    // Ensure the app-level safe area color matches this screen's dark background
    pushColor(theme.background);
    loadBounty(routeBountyId)
    loadConversation(routeBountyId)
    return () => {
      popColor(theme.background);
    }
  }, [routeBountyId]);

  // Start pulsing glow when a bounty is in progress
  useEffect(() => {
    if (bounty?.status === 'in_progress') {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [bounty?.status, glowAnim]);

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
    if (!messageText.trim()) return;

    let conv = conversation;
    try {
      setIsSendingMessage(true);

      if (!conv) {
        if (!bounty || !bounty.user_id) {
          Alert.alert('No Conversation', 'No active conversation found for this bounty.');
          return;
        }

        conv = await messageService.getOrCreateConversation([String(bounty.user_id)], '', routeBountyId || undefined);
        setConversation(conv);
      }

      await messageService.sendMessage(conv.id, messageText.trim());
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
      // Legacy full-screen review route removed — keep modal-only flow.
      // Previously: router.push('/postings/[bountyId]/review-and-verify')
      // No-op to prevent navigation to deprecated screen.
    } else if (currentIndex < STAGES.length - 1) {
      const nextStage = STAGES[currentIndex + 1];
      setCurrentStage(nextStage.id);
    }
  };

  const getStatusBadgeColor = (status?: string) => {
    switch (status) {
      case 'open':
        return '#059669'; // emerald-500
      case 'in_progress':
        return '#fbbf24'; // amber-400
      case 'completed':
        return '#6366f1'; // indigo-500
      case 'archived':
        return '#6b7280'; // gray-500
      default:
        return '#059669';
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
      <SafeAreaView style={s.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.loadingText}>Loading bounty...</Text>
      </SafeAreaView>
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
      <SafeAreaView style={s.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={s.errorText}>{error || 'Failed to load bounty'}</Text>
        <TouchableOpacity style={s.retryButton} onPress={() => routeBountyId && loadBounty(routeBountyId)}>
          <Text style={s.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
          <Text style={s.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const descriptionPreview = bounty.description.length > 150 
    ? bounty.description.substring(0, 150) + '...' 
    : bounty.description;

  

  return (
    <SafeAreaView style={[s.container, { width: '100%', alignSelf: 'stretch' }]} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backIcon} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Bounty Dashboard</Text>
      </View>

      <ScrollView
        style={[s.scrollView, { width: '100%' }]}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 18 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Header Card */}
        <View style={s.bountyCard}>
          <View style={s.bountyHeader}>
            <View style={s.avatarPlaceholder}>
              <MaterialIcons name="person" size={32} color={theme.text} />
            </View>
            <View style={s.bountyHeaderInfo}>
              <Text style={s.bountyTitle} numberOfLines={2}>
                {bounty.title}
              </Text>
                  <Text style={s.bountyAge}>{formatTimeAgo(bounty.created_at)}</Text>
                  {((bounty as any)?.category) && (
                    <View style={s.categoryPill}>
                      <Text style={s.categoryPillText}>{formatCategoryLabel((bounty as any).category)}</Text>
                    </View>
                  )}
            </View>
          </View>

          <View style={s.bountyMeta}>
            <View style={[s.statusBadge, { backgroundColor: getStatusBadgeColor(bounty.status) }]}>
              <Text style={s.statusBadgeText}>{getStatusLabel(bounty.status)}</Text>
            </View>
            {bounty.is_for_honor ? (
              <View style={s.honorBadge}>
                <MaterialIcons name="favorite" size={16} color="#ffffff" />
                <Text style={s.honorText}>For Honor</Text>
              </View>
            ) : (
              <Text style={s.amount}>${bounty.amount}</Text>
            )}
          </View>
        </View>

        {/* Work in progress banner for posters */}
        {bounty.status === 'in_progress' && (
          <WorkInProgressBanner message="Your hunter is actively working on this. You’ll be notified when it’s ready for review." />
        )}

        {/* Timeline */}
        {bounty.status === 'open' && (
          <View style={s.preAcceptancePanel}>
            <MaterialIcons name="hourglass-empty" size={24} color={theme.primaryLight} />
            <Text style={s.preAcceptanceTitle}>Awaiting a hunter</Text>
            <Text style={s.preAcceptanceText}>
              This posting is visible in the feed. You’ll receive requests from hunters and can review them from the Postings screen.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity style={s.secondaryBtn} onPress={() => router.back()}>
                <Text style={s.secondaryBtnText}>Back to My Postings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={s.timelineContainer}>
          <Text style={s.sectionTitle}>Progress Timeline</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.timeline}>
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
                    s.stageItem,
                    isActive && s.stageItemActive,
                    isCompleted && s.stageItemCompleted,
                    !isAccessible && s.stageItemLocked,
                  ]}
                  onPress={() => handleStagePress(stage.id)}
                  disabled={!isAccessible}
                >
                  <View style={{ position: 'relative', width: 48, height: 48, marginBottom: 8 }}>
                    {bounty?.status === 'in_progress' && stage.id === 'working_progress' && isActive && (
                      <Animated.View
                        style={[
                          s.stageIconGlow,
                          {
                            transform: [
                              {
                                scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }),
                              },
                            ],
                            opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.12] }),
                          },
                        ]}
                      />
                    )}

                    <View
                      style={[
                        s.stageIcon,
                        isActive && s.stageIconActive,
                        isCompleted && s.stageIconCompleted,
                      ]}
                    >
                      <MaterialIcons
                        name={stage.icon as any}
                        size={24}
                        color={isActive || isCompleted ? '#ffffff' : theme.primaryLight}
                      />
                    </View>
                  </View>
                  <Text
                    style={[
                      s.stageLabel,
                      isActive && s.stageLabelActive,
                      isCompleted && s.stageLabelCompleted,
                    ]}
                    numberOfLines={2}
                  >
                    {stage.label}
                  </Text>
                  {isCompleted && (
                    <View style={s.completedCheckmark}>
                      <MaterialIcons name="check-circle" size={16} color={theme.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Quick Message */}
        <View style={s.messageContainer}>
          <Text style={s.sectionTitle}>Quick Message</Text>
          {conversation ? (
            <View style={s.messageInputContainer}>
              <TextInput
                style={s.messageInput}
                placeholder="Type a message to the hunter..."
                placeholderTextColor={theme.textDisabled}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity
                style={[s.sendButton, (!messageText.trim() || isSendingMessage) && s.sendButtonDisabled]}
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
            <View style={s.noConversation}>
              <MaterialIcons name="chat-bubble-outline" size={32} color={theme.primaryLight} />
              <Text style={s.noConversationText}>No active conversation yet</Text>
              <Text style={s.noConversationSubtext}>
                A conversation will be created when a hunter accepts this bounty
              </Text>
            </View>
          )}
        </View>

        {/* Context Panel - Description */}
        <View style={s.contextPanel}>
          <Text style={s.sectionTitle}>Description</Text>
          <Text style={s.description}>
            {descriptionExpanded ? bounty.description : descriptionPreview}
          </Text>
          {bounty.description.length > 150 && (
            <TouchableOpacity
              style={s.expandButton}
              onPress={() => setDescriptionExpanded(!descriptionExpanded)}
            >
              <Text style={s.expandButtonText}>
                {descriptionExpanded ? 'Show Less' : 'Show More'}
              </Text>
              <MaterialIcons
                name={descriptionExpanded ? 'expand-less' : 'expand-more'}
                size={16}
                color={theme.primaryLight}
              />
            </TouchableOpacity>
          )}

          {/* Additional info */}
          {bounty.location && (
            <View style={s.infoRow}>
              <MaterialIcons name="place" size={16} color={theme.primaryLight} />
              <Text style={s.infoText}>{bounty.location}</Text>
            </View>
          )}
          {bounty.timeline && (
            <View style={s.infoRow}>
              <MaterialIcons name="schedule" size={16} color={theme.primaryLight} />
              <Text style={s.infoText}>{bounty.timeline}</Text>
            </View>
          )}
          {bounty.skills_required && (
            <View style={s.infoRow}>
              <MaterialIcons name="build" size={16} color={theme.primaryLight} />
              <Text style={s.infoText}>{bounty.skills_required}</Text>
            </View>
          )}
        </View>

        {/* Next Button */}
        {currentStage !== 'payout' && (
          <TouchableOpacity style={s.nextButton} onPress={handleNext}>
            <Text style={s.nextButtonText}>
              {currentStage === 'review_verify' ? 'Go to Review & Verify' : 'Next Stage'}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#ffffff" />
          </TouchableOpacity>
        )}

        {currentStage === 'payout' && (
          <TouchableOpacity
            style={s.nextButton}
            onPress={() => routeBountyId && router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: routeBountyId } })}
          >
            <Text style={s.nextButtonText}>Go to Payout</Text>
            <MaterialIcons name="arrow-forward" size={20} color="#ffffff" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
      width: '100%',
      alignSelf: 'stretch',
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: t.background,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
    },
    loadingText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    errorContainer: {
      flex: 1,
      backgroundColor: t.background,
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
      backgroundColor: t.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
      marginTop: 16,
    },
    retryButtonText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '600',
    },
    backButton: {
      paddingHorizontal: 24,
      paddingVertical: 12,
    },
    backButtonText: {
      color: t.primaryLight,
      fontSize: 14,
      fontWeight: '600',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: t.background,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    backIcon: {
      padding: 8,
      marginRight: 8,
    },
    headerTitle: {
      color: t.text,
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
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
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
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    bountyHeaderInfo: {
      flex: 1,
    },
    bountyTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    bountyAge: {
      color: t.primaryLight,
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
      color: '#ffffff',
      fontSize: 10,
      fontWeight: '700',
    },
    amount: {
      color: t.text,
      fontSize: 20,
      fontWeight: '700',
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    honorText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
    },
    categoryPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      marginTop: 6,
    },
    categoryPillText: {
      color: t.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    timelineContainer: {
      marginBottom: 16,
    },
    sectionTitle: {
      color: t.text,
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
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    stageItemActive: {
      backgroundColor: t.surface,
      borderColor: t.primary,
      borderWidth: 2,
    },
    stageItemCompleted: {
      backgroundColor: t.surfaceSecondary,
      borderColor: t.primary,
    },
    stageItemLocked: {
      opacity: 0.5,
    },
    stageIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    // Glow effect: always green — semantic for active in-progress state
    stageIconGlow: {
      position: 'absolute',
      top: -8,
      left: -8,
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: '#059669',
      opacity: 0.25,
      shadowColor: '#059669',
      shadowOpacity: 0.9,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 10,
    },
    stageIconActive: {
      backgroundColor: t.primary,
    },
    stageIconCompleted: {
      backgroundColor: t.primary,
    },
    stageLabel: {
      color: t.primaryLight,
      fontSize: 12,
      textAlign: 'center',
    },
    stageLabelActive: {
      color: t.text,
      fontWeight: '600',
    },
    stageLabelCompleted: {
      color: t.primaryLight,
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
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      padding: 12,
      color: t.text,
      fontSize: 14,
      borderWidth: 1,
      borderColor: t.border,
      minHeight: 80,
      textAlignVertical: 'top',
    },
    sendButton: {
      backgroundColor: t.primary,
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      backgroundColor: t.overlay,
    },
    noConversation: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    noConversationText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 12,
      marginBottom: 4,
    },
    noConversationSubtext: {
      color: t.primaryLight,
      fontSize: 12,
      textAlign: 'center',
    },
    contextPanel: {
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 16,
    },
    description: {
      color: t.text,
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
      color: t.primaryLight,
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
      color: t.textSecondary,
      fontSize: 13,
    },
    nextButton: {
      backgroundColor: t.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 12,
      gap: 8,
      marginTop: 8,
    },
    nextButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '600',
    },
    preAcceptancePanel: {
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 16,
    },
    preAcceptanceTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 4,
    },
    preAcceptanceText: {
      color: t.textSecondary,
      fontSize: 13,
    },
    secondaryBtn: {
      backgroundColor: 'transparent',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    secondaryBtnText: {
      color: t.primaryLight,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
