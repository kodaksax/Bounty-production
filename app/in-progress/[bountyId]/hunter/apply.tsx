// app/in-progress/[bountyId]/hunter/apply.tsx - Apply for work (waiting room)
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

export default function HunterApplyScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('apply');

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

      // Check if hunter has a request for this bounty
      const requests = await bountyRequestService.getAll({
        bountyId: id,
        userId: currentUserId,
      });

      if (requests.length === 0) {
        // No request found - redirect back
        Alert.alert('No Application', 'You have not applied to this bounty.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      const hunterRequest = requests[0];
      setRequest(hunterRequest);

      // If request is accepted, advance to work in progress
      if (hunterRequest.status === 'accepted') {
        router.replace({
          pathname: '/in-progress/[bountyId]/hunter/work-in-progress',
          params: { bountyId: id },
        });
        return;
      }

      // If rejected, notify and go back
      if (hunterRequest.status === 'rejected') {
        Alert.alert(
          'Application Not Selected',
          'The poster has selected another hunter for this bounty.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
        return;
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
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
              <MaterialIcons name="person" size={32} color="#80c795" />
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
                      color={isActive || isCompleted ? '#fff' : '#80c795'}
                    />
                  </View>
                  <Text style={styles.stageLabel}>{stage.label}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Waiting Room Panel */}
        <View style={styles.waitingPanel}>
          <MaterialIcons name="hourglass-empty" size={32} color="#80c795" />
          <Text style={styles.waitingTitle}>Waiting for Selection</Text>
          <Text style={styles.waitingText}>
            Your application has been submitted. The poster is reviewing applications and will
            select a hunter soon. You'll be notified when a decision is made.
          </Text>
          <View style={styles.statusBadge}>
            <MaterialIcons name="pending" size={16} color="#fbbf24" />
            <Text style={styles.statusText}>Application Pending</Text>
          </View>
        </View>

        {/* Bounty Details */}
        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>Bounty Details</Text>
          <Text style={styles.description}>{bounty.description}</Text>
          {bounty.location && (
            <View style={styles.detailRow}>
              <MaterialIcons name="location-on" size={16} color="#80c795" />
              <Text style={styles.detailText}>{bounty.location}</Text>
            </View>
          )}
          {bounty.timeline && (
            <View style={styles.detailRow}>
              <MaterialIcons name="schedule" size={16} color="#80c795" />
              <Text style={styles.detailText}>{bounty.timeline}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#008e2a',
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
    backgroundColor: '#008e2a',
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
    color: '#80c795',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 199, 149, 0.1)',
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
    backgroundColor: 'rgba(0, 117, 35, 0.2)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.3)',
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
    backgroundColor: 'rgba(0, 117, 35, 0.3)',
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
    color: '#80c795',
    fontSize: 12,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    color: '#008e2a',
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
    color: '#80c795',
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
    backgroundColor: 'rgba(0, 117, 35, 0.1)',
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 120,
  },
  stageItemActive: {
    backgroundColor: 'rgba(0, 142, 42, 0.3)',
    borderColor: '#008e2a',
    borderWidth: 2,
  },
  stageItemCompleted: {
    backgroundColor: 'rgba(0, 142, 42, 0.2)',
    borderColor: '#008e2a',
  },
  stageItemLocked: {
    opacity: 0.5,
  },
  stageIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 117, 35, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  stageIconActive: {
    backgroundColor: '#008e2a',
  },
  stageIconCompleted: {
    backgroundColor: '#008e2a',
  },
  stageLabel: {
    color: '#80c795',
    fontSize: 12,
    textAlign: 'center',
  },
  waitingPanel: {
    backgroundColor: 'rgba(0, 117, 35, 0.15)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.2)',
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
  detailsCard: {
    backgroundColor: 'rgba(0, 117, 35, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  detailsTitle: {
    color: '#80c795',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  description: {
    color: 'rgba(255,254,245,0.9)',
    fontSize: 14,
    lineHeight: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
});
