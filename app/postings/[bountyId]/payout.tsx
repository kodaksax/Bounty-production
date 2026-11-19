// app/postings/[bountyId]/payout.tsx - Payout Screen
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../hooks/useSafeBack';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrustSafetyNotice } from '../../../components/ui/trust-safety-notice';
import { trustSafetyStrings } from '../../../lib/strings/trust-safety';
import { bountyService } from '../../../lib/services/bounty-service';
import { describeBountyUpdateError } from '../../../lib/services/bounty-update-error';
import type { Bounty } from '../../../lib/services/database.types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';
import { isBountyPoster } from '../../../lib/utils/poster-bounty-dashboard';
import { bountyHoldsUnreleasedEscrow } from '../../../lib/utils/payment-architecture';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { withAlpha } from '../../../lib/utils';
import { useMemo } from 'react';

export default function PayoutScreen() {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  // Fall back to the poster dashboard when there is no history to pop.
  const goBack = useSafeBack(
    bountyId ? { pathname: '/postings/[bountyId]', params: { bountyId } } : FEED_FALLBACK
  );
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadBounty();
  }, [bountyId]);

  const loadBounty = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const id = Array.isArray(bountyId) ? bountyId[0] : bountyId;
      if (!id) {
        throw new Error('Invalid bounty id');
      }
      const data = await bountyService.getById(id);

      if (!data) {
        throw new Error('Bounty not found');
      }

      // Ownership via the shared helper: this compared `user_id` alone, so a
      // bounty carrying a distinct `poster_id` locked its real poster out of
      // their own payout screen. Non-posters are routed to the surface that is
      // theirs rather than alerted and bounced backwards.
      if (!isBountyPoster(data, currentUserId)) {
        router.replace({ pathname: '/bounty/[id]', params: { id } });
        return;
      }

      // Paying for unfinished work happens in one place: the job page's
      // review (PosterReviewModal), which approves the submission, warns that
      // it can't be undone and asks for a deliberate slide. This screen used
      // to release money from a switch + button WITHOUT approving the
      // submission, so for anything not yet completed it now hands over.
      if (data.status !== 'completed') {
        router.replace({ pathname: '/postings/[bountyId]', params: { bountyId: id, openReview: 'work' } } as never);
        return;
      }

      setBounty(data);
    } catch (err) {
      console.error('Error loading bounty:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteBounty = async () => {
    if (!bounty) return;

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
      'Permanently delete this bounty from your postings? It will only be visible in your history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsProcessing(true);

              // Update bounty status to deleted
              const updated = await bountyService.update(Number(bountyId), {
                status: 'deleted',
              });

              if (!updated) {
                throw new Error('Failed to delete bounty');
              }

              Alert.alert(
                'Deleted',
                'Bounty has been removed from your postings. You can still view it in your history.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      router.replace('/tabs/bounty-app');
                    },
                  },
                ]
              );
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

  const handleArchiveBounty = async () => {
    if (!bounty) return;

    Alert.alert(
      'Archive Bounty',
      'Archive this bounty so it is hidden from active listings but retained in history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'default',
          onPress: async () => {
            try {
              setIsProcessing(true);

              const updated = await bountyService.update(Number(bountyId), {
                status: 'archived',
              });

              if (!updated) {
                throw new Error('Failed to archive bounty');
              }

              Alert.alert('Archived', 'Bounty archived successfully.', [
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (error || !bounty) {
    return (
      <View style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color={theme.errorText} />
        <Text style={styles.errorText}>{error || 'Bounty not found'}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={loadBounty}>
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
        <Text style={styles.headerTitle}>Payment details</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <Text style={styles.bountyTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Status:</Text>
            <Text style={styles.summaryValue}>
              {bounty.status === 'completed' ? 'Finished' : 'In progress'}
            </Text>
          </View>
        </View>

        {/* Payout Amount Card */}
        <View style={styles.payoutCard}>
          <View style={styles.payoutHeader}>
            <MaterialIcons name="account-balance-wallet" size={32} color={theme.primaryLight} />
            <Text style={styles.payoutTitle}>Job price</Text>
          </View>

          {bounty.is_for_honor ? (
            <View style={styles.honorContainer}>
              <MaterialIcons name="favorite" size={48} color={theme.primaryLight} />
              <Text style={styles.honorLabel}>For Honor</Text>
              <Text style={styles.honorSubtext}>
                This bounty was created for honor, no payout amount.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.payoutAmount}>${bounty.amount.toFixed(2)}</Text>
            </>
          )}
        </View>

        {/* Already Completed Notice */}
        {bounty.status === 'completed' && (
          <>
            <View style={styles.completedCard}>
              <MaterialIcons name="check-circle" size={48} color={theme.primaryLight} />
              <Text style={styles.completedTitle}>Job finished</Text>
              <Text style={styles.completedSubtext}>
                You approved this job. Your Wallet shows the payment.
              </Text>
            </View>
            <TrustSafetyNotice message={trustSafetyStrings.paymentProtection} />

            {/* Completed actions: allow archive or delete after completion */}
            {bounty.status === 'completed' && (
              <View style={styles.actionButtons}>
                <TouchableOpacity accessibilityRole="button"
                  style={[styles.completeButton, isProcessing && styles.buttonDisabled]}
                  onPress={handleArchiveBounty}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color={theme.onPrimary} />
                  ) : (
                    <>
                      <MaterialIcons name="archive" size={20} color={theme.onPrimary} />
                      <Text style={styles.completeButtonText}>Archive</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity accessibilityRole="button"
                  style={[styles.deleteButton, isProcessing && styles.buttonDisabled]}
                  onPress={handleDeleteBounty}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color={theme.onPrimary} />
                  ) : (
                    <>
                      <MaterialIcons name="delete" size={20} color={theme.onPrimary} />
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* Info Section */}
        <View style={styles.infoCard}>
          <MaterialIcons name="info-outline" size={24} color={theme.primaryLight} />
          <Text style={styles.infoText}>
            {bounty.status === 'completed'
              ? 'This job stays in your history. If something is wrong, use Get help on your job page.'
              : "This job isn't finished yet."}
          </Text>
        </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 24,
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
    marginTop: 16,
  },
  retryButtonText: {
    color: theme.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: theme.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: withAlpha(theme.primary, 0.3),
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backIcon: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    color: theme.text,
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
  summaryCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 16,
  },
  summaryTitle: {
    color: theme.primaryLight,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  bountyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryLabel: {
    color: theme.primaryLight,
    fontSize: 14,
  },
  summaryValue: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  payoutCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 16,
    alignItems: 'center',
  },
  payoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  payoutTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  payoutAmount: {
    color: theme.primaryLight,
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 12,
  },
  balanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  balanceLabel: {
    color: theme.primaryLight,
    fontSize: 14,
  },
  balanceAmount: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  honorContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  honorLabel: {
    color: theme.primaryLight,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  honorSubtext: {
    color: theme.primaryLight,
    fontSize: 12,
    textAlign: 'center',
  },
  confirmationCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 16,
  },
  confirmationTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  confirmationSubtext: {
    color: theme.primaryLight,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  switchLabel: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  completedCard: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.primary,
    marginBottom: 16,
    alignItems: 'center',
  },
  completedTitle: {
    color: theme.primaryLight,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  completedSubtext: {
    color: theme.primaryLight,
    fontSize: 14,
    textAlign: 'center',
  },
  receiptButton: {
    backgroundColor: theme.surfaceSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  receiptButtonText: {
    color: theme.primaryLight,
    fontSize: 15,
    fontWeight: '600',
  },
  actionButtons: {
    gap: 12,
    marginBottom: 16,
  },
  releaseButton: {
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  releaseButtonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  completeButton: {
    backgroundColor: theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  completeButtonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: theme.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  deleteButtonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: theme.primaryLight,
    fontSize: 13,
    lineHeight: 18,
  },
});
}
