// app/in-progress/[bountyId]/hunter/payout.tsx - Payout stage for hunter
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../../hooks/useSafeBack';
import React, { useEffect, useState } from 'react';
import {
  Alert,
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
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { withAlpha } from '../../../../lib/utils';
import { HunterStageScreen } from '../../../../components/hunter/hunter-stage-view';
import { useHunterHelp } from '../../../../components/hunter/use-hunter-help';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { useBountyLifecycle } from '../../../../hooks/useBountyLifecycle';
import { usePayingSlow } from '../../../../hooks/usePayingSlow';
import { firstName, formatJobAmount } from '../../../../lib/my-jobs/format';
import { useWorksBothSides } from '../../../../lib/my-jobs/side-labels-store';
import { bountyAppTabPath } from '../../../../lib/navigation/bounty-app-tab';
import { trackWorkspacePrimaryTapped } from '../../../../lib/services/focus-analytics';
import { describeHunterStage, hunterReceiptRows, type HunterActionKey } from '../../../../lib/utils/hunter-stage-copy';

export default function HunterPayoutScreen() {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { bountyId, sent } = useLocalSearchParams<{ bountyId?: string; sent?: string }>();
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
  const [isPaidOut, setIsPaidOut] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // submitted_at of this hunter's submission while it waits on the poster.
  const [pendingSubmittedAt, setPendingSubmittedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const worksBothSides = useWorksBothSides(currentUserId);

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  // The resolved lifecycle (shared with the poster and My Jobs) drives the copy.
  const { session } = useAuthContext();
  const lifecycle = useBountyLifecycle(routeBountyId, session?.user?.id ?? currentUserId ?? null);

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
      setIsPaidOut(
        bountyData.status === 'completed' ||
          (bountyData.status === 'archived' && !!(bountyData as any).completed_at)
      );

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

  // "Jordan has until Tuesday at 12:40 pm to approve…" (trust-spine T6).
  // getReviewDeadlineStatus returns nothing while REVIEW_WINDOW_ENABLED is off.
  const reviewDeadline = isPaidOut ? null : getReviewDeadlineStatus(pendingSubmittedAt, 'hunter');

  const posterFirst = firstName(lifecycle.otherParty.name);
  // Approved and paying: "We're confirming the payment" after PAYING_SLOW_AFTER_MS.
  const payingSlow = usePayingSlow(!!lifecycle.state?.paying, routeBountyId);
  const view = React.useMemo(() => {
    if (!bounty || !lifecycle.state) return null;
    return describeHunterStage({
      payingSlow,
      bounty: bounty as any,
      lifecycle: lifecycle.state,
      posterName: lifecycle.otherParty.name,
      requestStatus: request?.status ?? null,
      submission: lifecycle.submission,
      hasDispute: lifecycle.hasDispute,
      reviewDeadline: reviewDeadline ? reviewDeadline.deadline : null,
    });
  }, [bounty, lifecycle.state, lifecycle.otherParty.name, lifecycle.submission, lifecycle.hasDispute, request?.status, reviewDeadline, payingSlow]);

  // H.9: "Sent to Jordan." straight after sending the work.
  React.useEffect(() => {
    if (sent === 'work' && view?.screenId === 'H.9') setToast(`Sent to ${posterFirst ?? 'the poster'}.`);
  }, [sent, view?.screenId, posterFirst]);

  const openThread = React.useCallback(() => {
    if (!routeBountyId) return;
    router.push({ pathname: '/tabs/bounty-thread/[bountyId]', params: { bountyId: routeBountyId, role: 'hunter' } } as never);
  }, [routeBountyId, router]);

  const contactSupport = React.useCallback(() => {
    if (!routeBountyId) return;
    router.push({ pathname: '/support/contact', params: { bountyId: routeBountyId, bountyTitle: bounty?.title ?? '' } } as never);
  }, [routeBountyId, bounty?.title, router]);

  const help = useHunterHelp({
    bountyId: routeBountyId,
    posterName: posterFirst,
    working: view?.screenId === 'H.9',
    workSubmitted: true,
    disputeOpen: lifecycle.hasDispute,
    heldAmount: bounty && !bounty.is_for_honor ? formatJobAmount(bounty.amount) : null,
    openThread,
    requestCancellation: () => {},
    contactSupport,
  });

  const onAction = React.useCallback(
    (key: HunterActionKey) => {
      if (!routeBountyId || !view) return;
      if (view.primary?.key === key) trackWorkspacePrimaryTapped({ bountyId: routeBountyId, side: 'doing', screenId: view.screenId, action: key });
      switch (key) {
        case 'back_to_jobs':
          router.replace(bountyAppTabPath('messages', 'inProgress') as never);
          return;
        case 'message':
          openThread();
          return;
        case 'see_wallet':
          router.push(bountyAppTabPath('wallet') as never);
          return;
        case 'find_work':
          router.replace(bountyAppTabPath('bounty') as never);
          return;
        case 'see_report':
        case 'add_info':
          if (lifecycle.disputeId) router.push(`/dispute/${lifecycle.disputeId}` as never);
          else router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId, from: 'in-progress' } } as never);
          return;
        default:
          return;
      }
    },
    [routeBountyId, view, openThread, router, lifecycle.disputeId]
  );

  if (isLoading || lifecycle.isLoading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <HunterDashboardSkeleton />
      </View>
    );
  }

  if (error || !bounty || !request || !view) {
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
    <HunterStageScreen
      view={view}
      bounty={bounty as any}
      posterName={lifecycle.otherParty.name}
      worksBothSides={worksBothSides}
      onBack={goBack}
      onAction={onAction}
      toast={toast}
      onToastHide={() => setToast(null)}
      receipt={bounty.is_for_honor ? null : hunterReceiptRows(lifecycle.otherParty.name, bounty.amount)}
      // Hunter -> poster rating. Where the "Please rate the poster"
      // notification lands; renders only when the server says this hunter
      // can still rate (completed transaction, not yet rated).
      rating={isPaidOut && routeBountyId ? <RateCounterpartyCard bountyId={routeBountyId} /> : null}
      help={help}
      moreExtra={
        isPaidOut && bounty.status !== 'archived'
          ? [
              { key: 'archive', label: 'Archive', icon: 'archive', busy: isProcessing, onPress: handleArchive },
              { key: 'delete', label: 'Delete', icon: 'delete', danger: true, busy: isProcessing, onPress: handleDelete },
            ]
          : []
      }
    >
      {/* Payout Status */}
      {!bounty.is_for_honor && (
        <TrustSafetyNotice message={trustSafetyStrings.paymentProtection} />
      )}
    </HunterStageScreen>
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
