// app/postings/[bountyId]/payout.tsx - Payout Screen
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessAnimation, ConfettiAnimation } from '../../../components/ui/success-animation';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';
import { useWallet } from '../../../lib/wallet-context';

import { colors } from '../../../lib/theme';
export default function PayoutScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();
  const { releaseFunds, logTransaction, balance } = useWallet();

  // guard against undefined wallet values to avoid runtime crashes
  const displayBalance = typeof balance === 'number' && Number.isFinite(balance) ? balance : 0;

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    loadBounty();
  }, [bountyId]);

  const loadBounty = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const id = Array.isArray(bountyId) ? bountyId[0] : bountyId
      if (!id) {
        throw new Error('Invalid bounty id')
      }
      const data = await bountyService.getById(id);

      if (!data) {
        throw new Error('Bounty not found');
      }

      // Check ownership
      if (data.user_id !== currentUserId) {
        Alert.alert('Access Denied', 'You can only manage payout for your own bounties.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
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

  const handleReleasePayout = async () => {
    if (!bounty || bounty.is_for_honor) {
      Alert.alert('Error', 'Cannot release payout for honor bounties.');
      return;
    }

    if (!confirmRelease) {
      Alert.alert('Confirmation Required', 'Please confirm payout release by toggling the switch.');
      return;
    }

    try {
      setIsProcessing(true);

      // Release escrowed funds (this updates escrow transaction and logs release)
      const released = await releaseFunds(
        Number(bounty.id),
        bounty.accepted_by || 'hunter', // In production, get actual hunter ID
        bounty.title
      );

      if (!released) {
        throw new Error('Failed to release escrowed funds - no active escrow found');
      }

      // Update bounty status to completed
      const updated = await bountyService.update(Number(bounty?.id), {
        status: 'completed',
      });

      if (!updated) {
        throw new Error('Failed to update bounty status');
      }

      // Show success animation with confetti
      setShowSuccessAnimation(true);
      setShowConfetti(true);
      
      // After animations, show alert and navigate
      setTimeout(() => {
        setShowSuccessAnimation(false);
        setShowConfetti(false);
        Alert.alert(
          'Success',
          `Payout of $${bounty.amount.toFixed(2)} has been released successfully! The funds have been transferred to the hunter. The bounty is now completed and will be archived.`,
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate back to postings screen
                router.replace('/tabs/bounty-app');
              },
            },
          ]
        );
      }, 2000);
    } catch (err) {
      console.error('Error releasing payout:', err);
      Alert.alert('Error', 'Failed to release payout. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!bounty) return;

    Alert.alert(
      'Mark as Complete',
      bounty.is_for_honor
        ? 'This will mark the bounty as complete and archive it for all parties.'
        : 'Are you sure you want to mark this bounty as complete without releasing funds?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsProcessing(true);

              const updated = await bountyService.update(Number(bountyId), {
                status: 'completed',
              });

              if (!updated) {
                throw new Error('Failed to update bounty status');
              }

              // For honor bounties or manual completion
              if (bounty.is_for_honor) {
                if (typeof logTransaction === 'function') {
                  await logTransaction({
                    type: 'bounty_completed',
                    amount: 0,
                    details: {
                      title: bounty.title,
                      status: 'completed_for_honor',
                      bounty_id: bounty.id,
                    },
                  });
                } else {
                  console.warn('logTransaction not available from wallet context');
                }
              }

              // Show success animation
              setShowSuccessAnimation(true);
              
              // After animation, show alert and navigate
              setTimeout(() => {
                setShowSuccessAnimation(false);
                Alert.alert('Success', 'Bounty marked as complete and archived.', [
                  {
                    text: 'OK',
                    onPress: () => {
                      router.replace('/tabs/bounty-app');
                    },
                  },
                ]);
              }, 1500);
            } catch (err) {
              console.error('Error marking as complete:', err);
              Alert.alert('Error', 'Failed to complete bounty. Please try again.');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteBounty = async () => {
    if (!bounty) return;

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

              Alert.alert('Deleted', 'Bounty has been removed from your postings. You can still view it in your history.', [
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text style={styles.loadingText}>Loading payout...</Text>
      </View>
    );
  }

  if (error || !bounty) {
    return (
      <View style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error || 'Bounty not found'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadBounty}>
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
        <Text style={styles.headerTitle}>Payout</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bounty Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Bounty Summary</Text>
          <Text style={styles.bountyTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Status:</Text>
            <Text style={styles.summaryValue}>
              {bounty.status === 'completed' ? 'Completed' : 'In Progress'}
            </Text>
          </View>
        </View>

        {/* Payout Amount Card */}
        <View style={styles.payoutCard}>
          <View style={styles.payoutHeader}>
            <MaterialIcons name="account-balance-wallet" size={32} color={colors.primary[500]} />
            <Text style={styles.payoutTitle}>Payout Amount</Text>
          </View>

          {bounty.is_for_honor ? (
            <View style={styles.honorContainer}>
              <MaterialIcons name="favorite" size={48} color={colors.primary[500]} />
              <Text style={styles.honorLabel}>For Honor</Text>
              <Text style={styles.honorSubtext}>
                This bounty was created for honor, no payout amount.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.payoutAmount}>${bounty.amount.toFixed(2)}</Text>
              <View style={styles.balanceInfo}>
                <Text style={styles.balanceLabel}>Current Balance:</Text>
                <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
              </View>
            </>
          )}
        </View>

        {/* Confirmation Section (Only for paid bounties) */}
        {!bounty.is_for_honor && bounty.status !== 'completed' && (
          <View style={styles.confirmationCard}>
            <Text style={styles.confirmationTitle}>Confirm Payout Release</Text>
            <Text style={styles.confirmationSubtext}>
              By confirming, you agree that the work has been completed satisfactorily and the hunter
              will receive the payout amount.
            </Text>
            <View style={styles.switchContainer}>
              <Text style={styles.switchLabel}>I confirm payout release</Text>
              <Switch
                value={confirmRelease}
                onValueChange={setConfirmRelease}
                trackColor={{ false: '#6b7280', true: colors.primary[500] }}
                thumbColor={confirmRelease ? '#fff' : '#f4f4f5'}
              />
            </View>
          </View>
        )}

        {/* Already Completed Notice */}
        {bounty.status === 'completed' && (
          <>
            <View style={styles.completedCard}>
              <MaterialIcons name="check-circle" size={48} color={colors.primary[500]} />
              <Text style={styles.completedTitle}>Bounty Completed</Text>
              <Text style={styles.completedSubtext}>
                This bounty has already been completed and archived.
              </Text>
            </View>

            {/* Receipt Download */}
            <TouchableOpacity
              style={styles.receiptButton}
              onPress={() => {
                // TODO (Post-Launch): Implement actual receipt generation and download
                Alert.alert(
                  'Receipt',
                  `Transaction Receipt\n\nBounty: ${bounty.title}\nAmount: ${bounty.is_for_honor ? 'For Honor' : '$' + bounty.amount.toFixed(2)}\nStatus: Completed\nDate: ${bounty.created_at}\n\nReceipt download feature coming soon!`
                );
              }}
            >
              <MaterialIcons name="receipt" size={20} color={colors.primary[500]} />
              <Text style={styles.receiptButtonText}>Download Receipt</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Action Buttons */}
        {bounty.status !== 'completed' && (
          <View style={styles.actionButtons}>
            {!bounty.is_for_honor && (
              <TouchableOpacity
                style={[styles.releaseButton, (!confirmRelease || isProcessing) && styles.buttonDisabled]}
                onPress={handleReleasePayout}
                disabled={!confirmRelease || isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="attach-money" size={24} color="#fff" />
                    <Text style={styles.releaseButtonText}>Release Payout</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.completeButton, isProcessing && styles.buttonDisabled]}
              onPress={handleMarkComplete}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="check" size={24} color="#fff" />
                  <Text style={styles.completeButtonText}>Mark as Complete</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteButton, isProcessing && styles.buttonDisabled]}
              onPress={handleDeleteBounty}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="delete" size={24} color="#fff" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Info Section */}
        <View style={styles.infoCard}>
          <MaterialIcons name="info-outline" size={24} color="#6ee7b7" />
          <Text style={styles.infoText}>
            {bounty.status === 'completed'
              ? 'This bounty has been archived and is accessible in your bounty history.'
              : 'Once you release the payout or mark as complete, the bounty will be archived for all parties.'}
          </Text>
        </View>
      </ScrollView>

      {/* Success Animations */}
      <SuccessAnimation
        visible={showSuccessAnimation}
        icon="check-circle"
        size={80}
        color={colors.primary[500]}
      />
      <ConfettiAnimation visible={showConfetti} />
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
    backgroundColor: colors.primary[500],
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
  summaryCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  summaryTitle: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  bountyTitle: {
    color: '#fff',
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
    color: '#6ee7b7',
    fontSize: 14,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  payoutCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  payoutAmount: {
    color: colors.primary[500],
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
    color: '#6ee7b7',
    fontSize: 14,
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  honorContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  honorLabel: {
    color: colors.primary[500],
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  honorSubtext: {
    color: '#6ee7b7',
    fontSize: 12,
    textAlign: 'center',
  },
  confirmationCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  confirmationTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  confirmationSubtext: {
    color: '#6ee7b7',
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
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  completedCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.primary[500],
    marginBottom: 16,
    alignItems: 'center',
  },
  completedTitle: {
    color: colors.primary[500],
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  completedSubtext: {
    color: '#6ee7b7',
    fontSize: 14,
    textAlign: 'center',
  },
  receiptButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary[500],
  },
  receiptButtonText: {
    color: colors.primary[500],
    fontSize: 15,
    fontWeight: '600',
  },
  actionButtons: {
    gap: 12,
    marginBottom: 16,
  },
  releaseButton: {
    backgroundColor: colors.primary[500],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  releaseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  completeButton: {
    backgroundColor: colors.background.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: '#6ee7b7',
    fontSize: 13,
    lineHeight: 18,
  },
});
