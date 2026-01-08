// app/in-progress/[bountyId]/hunter/payout.tsx - Payout stage for hunter
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { useWallet } from '../../../../lib/wallet-context';
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

export default function HunterPayoutScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();
  const { balance, deposit } = useWallet();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('payout');
  const [isPaidOut, setIsPaidOut] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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

      // Check if bounty is completed (poster released payout)
      setIsPaidOut(bountyData.status === 'completed');

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

  const handleArchive = async () => {
    if (!bounty || !routeBountyId) return;

    Alert.alert(
      'Archive Bounty',
      'Archive this completed bounty? You can view it later in your archived bounties and history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            try {
              setIsProcessing(true);
              
              // Update bounty status to archived
              const updated = await bountyService.update(routeBountyId, {
                status: 'archived',
              });

              if (!updated) {
                throw new Error('Failed to archive bounty');
              }

              Alert.alert('Archived', 'Bounty archived successfully. You can find it in your archives and history.', [
                {
                  text: 'OK',
                  onPress: () => {
                    router.replace('/tabs/bounty-app');
                  },
                },
              ]);
            } catch (err) {
              console.error('Error archiving bounty:', err);
              Alert.alert('Error', 'Failed to archive bounty. Please try again.');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = async () => {
    if (!bounty || !routeBountyId) return;

    Alert.alert(
      'Delete Bounty',
      'Permanently delete this bounty from your in-progress list? You can still see it in your history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsProcessing(true);
              
              // Update bounty status to deleted
              const updated = await bountyService.update(routeBountyId, {
                status: 'deleted',
              });

              if (!updated) {
                throw new Error('Failed to delete bounty');
              }

              Alert.alert('Deleted', 'Bounty removed from your in-progress list. You can still view it in your history.', [
                {
                  text: 'OK',
                  onPress: () => {
                    router.replace('/tabs/bounty-app');
                  },
                },
              ]);
            } catch (err) {
              console.error('Error deleting bounty:', err);
              Alert.alert('Error', 'Failed to delete bounty. Please try again.');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
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
        <Text style={styles.headerTitle}>Payout</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Info Card */}
        <View style={styles.bountyInfoCard}>
          <Text style={styles.bountyTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          <Text style={styles.bountyAmount}>
            {bounty.is_for_honor ? 'For Honor' : `$${bounty.amount}`}
          </Text>
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

        {/* Payout Status */}
        {!isPaidOut ? (
          <View style={styles.waitingPanel}>
            <MaterialIcons name="hourglass-empty" size={32} color="#fbbf24" />
            <Text style={styles.waitingTitle}>Waiting for Payout Release</Text>
            <Text style={styles.waitingText}>
              Your work has been submitted for review. The poster will verify your work and release
              the payment. You'll be notified when the payout is ready.
            </Text>
            <View style={styles.statusBadge}>
              <MaterialIcons name="pending" size={16} color="#fbbf24" />
              <Text style={styles.statusText}>Payout Pending</Text>
            </View>
          </View>
        ) : (
          <>
            {/* Success Panel */}
            <View style={styles.successPanel}>
              <MaterialIcons name="check-circle" size={48} color="#10b981" />
              <Text style={styles.successTitle}>Payout Released!</Text>
              <Text style={styles.successText}>
                Congratulations! The poster has approved your work and released the payment.
              </Text>
              {!bounty.is_for_honor && (
                <View style={styles.payoutAmountCard}>
                  <Text style={styles.payoutLabel}>Payout Amount</Text>
                  <Text style={styles.payoutAmount}>${bounty.amount}</Text>
                  <Text style={styles.payoutSubtext}>Added to your wallet balance</Text>
                </View>
              )}
              {bounty.is_for_honor && (
                <View style={styles.honorCard}>
                  <MaterialIcons name="favorite" size={32} color="#ec4899" />
                  <Text style={styles.honorTitle}>Completed for Honor</Text>
                  <Text style={styles.honorText}>
                    Thank you for contributing to the community!
                  </Text>
                </View>
              )}
            </View>

            {/* Current Balance */}
            {!bounty.is_for_honor && (
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Current Wallet Balance</Text>
                <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
              </View>
            )}

            {/* Receipt */}
            {!bounty.is_for_honor && (
              <View style={styles.receiptCard}>
                <View style={styles.receiptHeader}>
                  <MaterialIcons name="receipt" size={24} color="#6ee7b7" />
                  <Text style={styles.receiptTitle}>Transaction Receipt</Text>
                </View>
                <View style={styles.receiptDivider} />
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Bounty</Text>
                  <Text style={styles.receiptValue}>{bounty.title}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Amount</Text>
                  <Text style={styles.receiptValue}>${bounty.amount}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Date</Text>
                  <Text style={styles.receiptValue}>{new Date().toLocaleDateString()}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Status</Text>
                  <View style={styles.statusPill}>
                    <MaterialIcons name="check-circle" size={16} color="#10b981" />
                    <Text style={styles.statusPillText}>Completed</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actionsContainer}>
              <TouchableOpacity accessibilityRole="button"
                style={[styles.actionButton, styles.archiveButton]}
                onPress={handleArchive}
                disabled={isProcessing}
              >
                <MaterialIcons name="archive" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Archive</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleDelete}
                disabled={isProcessing}
              >
                <MaterialIcons name="delete" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </>
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
    gap: 8,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  bountyAmount: {
    color: '#10b981',
    fontSize: 20,
    fontWeight: '700',
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
  waitingPanel: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
  },
  waitingTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  waitingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
  },
  statusText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
  },
  successPanel: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  successTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  successText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  payoutAmountCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  payoutLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payoutAmount: {
    color: '#10b981',
    fontSize: 32,
    fontWeight: '700',
  },
  payoutSubtext: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 12,
  },
  honorCard: {
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  honorTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  honorText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
  },
  balanceCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  balanceLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceAmount: {
    color: '#10b981',
    fontSize: 24,
    fontWeight: '700',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  archiveButton: {
    backgroundColor: '#059669',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  receiptCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptTitle: {
    color: '#6ee7b7',
    fontSize: 16,
    fontWeight: '600',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
  },
  receiptValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
});
