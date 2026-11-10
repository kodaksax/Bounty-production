// app/in-progress/[bountyId]/hunter/payout.tsx - Payout stage for hunter
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../../hooks/useSafeBack';
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
import { RateCounterpartyCard } from '../../../../components/rate-counterparty-card';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { TrustSafetyNotice } from '../../../../components/ui/trust-safety-notice';
import { trustSafetyStrings } from '../../../../lib/strings/trust-safety';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import { completionService } from '../../../../lib/services/completion-service';
import { getReviewDeadlineStatus } from '../../../../lib/utils/review-deadline';
import { describeBountyUpdateError } from '../../../../lib/services/bounty-update-error';
import { bountyHoldsUnreleasedEscrow } from '../../../../lib/utils/payment-architecture';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';
import { PLATFORM_FEE_DISPLAY, calculateHunterEarnings } from '../../../../lib/constants/fees';
import { useWallet } from '../../../../lib/wallet-context';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { withAlpha } from '../../../../lib/utils';
import { HunterStageTimeline, type HunterStage } from '../../../../components/hunter-stage-timeline';

export default function HunterPayoutScreen() {
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
  const { balance } = useWallet();
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage] = useState<HunterStage>('payout');
  const [isPaidOut, setIsPaidOut] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // submitted_at of this hunter's submission while it waits on the poster.
  const [pendingSubmittedAt, setPendingSubmittedAt] = useState<string | null>(null);

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

      // The review deadline is informational: never block the screen on it.
      completionService
        .getSubmission(id)
        .then((submission) =>
          setPendingSubmittedAt(
            submission?.status === 'pending' && String(submission.hunter_id) === String(currentUserId)
              ? (submission.submitted_at ?? null)
              : null
          )
        )
        .catch(() => setPendingSubmittedAt(null));

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
              Alert.alert("Something went wrong", describeBountyUpdateError(err));
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

    // Do not delete a bounty that still holds escrowed funds — this path does
    // not refund, so deleting would strand the money. Route to cancellation.
    if (bountyHoldsUnreleasedEscrow(bounty)) {
      Alert.alert(
        'Cannot Delete',
        `This bounty still holds escrowed funds. Request cancellation before deleting it. ${trustSafetyStrings.escrowLimits}`,
        [{ text: 'OK' }]
      );
      return;
    }

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
              Alert.alert("Something went wrong", describeBountyUpdateError(err));
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  // "The poster has until Friday at 3:00 PM to approve…" (trust-spine T6).
  const reviewDeadline = isPaidOut ? null : getReviewDeadlineStatus(pendingSubmittedAt, 'hunter');

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
        <Text style={styles.headerTitle}>Payment</Text>
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
        <HunterStageTimeline currentStage={currentStage} />

        {/* Payout Status */}
        {!bounty.is_for_honor && (
          <TrustSafetyNotice message={trustSafetyStrings.paymentProtection} />
        )}
        {!isPaidOut ? (
          <View style={styles.waitingPanel}>
            <MaterialIcons name="hourglass-empty" size={32} color={theme.warningText} />
            <Text style={styles.waitingTitle}>Waiting for approval</Text>
            <Text style={styles.waitingText}>
              {bounty.is_for_honor
                ? "Your work is with the poster for review. You'll be notified as soon as they approve it — nothing to do until then."
                : `Your work is with the poster for review. When they approve it, $${calculateHunterEarnings(
                    bounty.amount
                  ).net.toFixed(
                    2
                  )} can be released through Bounty. Processing or dispute review may delay payment. You'll be notified of updates.`}
            </Text>
            {reviewDeadline && (
              <View style={styles.deadlineRow} accessibilityRole="text">
                <MaterialIcons
                  name={reviewDeadline.overdue ? 'support-agent' : 'schedule'}
                  size={16}
                  color={theme.warningText}
                />
                <Text style={styles.deadlineText}>{reviewDeadline.message}</Text>
              </View>
            )}
            <View style={styles.statusBadge}>
              <MaterialIcons name="pending" size={16} color={theme.warningText} />
              <Text style={styles.statusText}>Waiting on the poster</Text>
            </View>
          </View>
        ) : (
          <>
            {/* Success Panel */}
            <View style={styles.successPanel}>
              <MaterialIcons name="check-circle" size={48} color={theme.primaryLight} />
              <Text style={styles.successTitle}>
                {bounty.is_for_honor ? 'Completed for Honor' : 'Bounty Completed'}
              </Text>
              <Text style={styles.successText}>
                {bounty.is_for_honor
                  ? 'The poster has approved your work.'
                  : 'The bounty is marked complete. Check Wallet for payment status and available funds.'}
              </Text>
              {!bounty.is_for_honor && (
                <View style={styles.payoutAmountCard}>
                  <Text style={styles.payoutLabel}>Your earnings</Text>
                  <Text style={styles.payoutAmount}>
                    ${calculateHunterEarnings(bounty.amount).net.toFixed(2)}
                  </Text>
                  <Text style={styles.payoutSubtext}>Check Wallet for when it’s available</Text>
                </View>
              )}
              {bounty.is_for_honor && (
                <View style={styles.honorCard}>
                  <MaterialIcons name="favorite" size={32} color={theme.primaryLight} />
                  <Text style={styles.honorTitle}>Completed for Honor</Text>
                  <Text style={styles.honorText}>
                    Thank you for contributing to the community!
                  </Text>
                </View>
              )}
            </View>

            {/* Hunter -> poster rating. Where the "Please rate the poster"
                notification lands; renders only when the server says this
                hunter can still rate (completed transaction, not yet rated). */}
            {routeBountyId && <RateCounterpartyCard bountyId={routeBountyId} />}

            {/* Current Balance */}
            {!bounty.is_for_honor && (
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Wallet balance</Text>
                <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
              </View>
            )}

            {/* Receipt */}
            {!bounty.is_for_honor && (
              <View style={styles.receiptCard}>
                <View style={styles.receiptHeader}>
                  <MaterialIcons name="receipt" size={24} color={theme.primaryLight} />
                  <Text style={styles.receiptTitle}>Receipt</Text>
                </View>
                <View style={styles.receiptDivider} />
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Bounty</Text>
                  <Text style={styles.receiptValue}>{bounty.title}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Bounty amount</Text>
                  <Text style={styles.receiptValue}>
                    ${calculateHunterEarnings(bounty.amount).gross.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Service fee ({PLATFORM_FEE_DISPLAY})</Text>
                  <Text style={styles.receiptValue}>
                    −${calculateHunterEarnings(bounty.amount).fee.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Paid to you</Text>
                  <Text style={styles.receiptValue}>
                    ${calculateHunterEarnings(bounty.amount).net.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Date</Text>
                  <Text style={styles.receiptValue}>{new Date().toLocaleDateString()}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Status</Text>
                  <View style={styles.statusPill}>
                    <MaterialIcons name="check-circle" size={16} color={theme.primaryLight} />
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
                <MaterialIcons name="archive" size={20} color={theme.onPrimary} />
                <Text style={styles.actionButtonText}>Archive</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleDelete}
                disabled={isProcessing}
              >
                <MaterialIcons name="delete" size={20} color={theme.onPrimary} />
                <Text style={styles.actionButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
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
    gap: 8,
  },
  bountyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
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
  waitingPanel: {
    backgroundColor: withAlpha(theme.warning, 0.15),
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: withAlpha(theme.warning, 0.3),
  },
  waitingTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
  },
  waitingText: {
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: withAlpha(theme.warning, 0.1),
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deadlineText: {
    flex: 1,
    color: theme.warningText,
    fontSize: 13,
    lineHeight: 18,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: withAlpha(theme.warning, 0.2),
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
  },
  statusText: {
    color: theme.warningText,
    fontSize: 12,
    fontWeight: '600',
  },
  successPanel: {
    backgroundColor: withAlpha(theme.text, 0.05),
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: withAlpha(theme.text, 0.1),
  },
  successTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '600',
  },
  successText: {
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  payoutAmountCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  payoutLabel: {
    color: theme.primaryLight,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payoutAmount: {
    color: theme.primaryLight,
    fontSize: 32,
    fontWeight: '700',
  },
  payoutSubtext: {
    color: withAlpha(theme.text, 0.7),
    fontSize: 12,
  },
  honorCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  honorTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  honorText: {
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
    textAlign: 'center',
  },
  balanceCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  balanceLabel: {
    color: theme.primaryLight,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceAmount: {
    color: theme.primaryLight,
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
    backgroundColor: theme.primary,
  },
  deleteButton: {
    backgroundColor: theme.error,
  },
  actionButtonText: {
    color: theme.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  receiptCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptTitle: {
    color: theme.primaryLight,
    fontSize: 16,
    fontWeight: '600',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: theme.surface,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    color: withAlpha(theme.text, 0.7),
    fontSize: 14,
  },
  receiptValue: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    color: theme.primaryLight,
    fontSize: 12,
    fontWeight: '600',
  },
});
}
