import { sanitizeErrorMessage } from '../../../../lib/utils/error-messages';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FEED_FALLBACK, useSafeBack } from '../../../../hooks/useSafeBack';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DisputeFrozenBanner } from '../../../../components/ui/dispute-frozen-banner';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { WorkflowDisputeModal } from '../../../../components/workflow-dispute-modal';
import { useAttachmentUpload } from '../../../../hooks/use-attachment-upload';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import { completionService, type ProofItem } from '../../../../lib/services/completion-service';
import type { Bounty, BountyRequest } from '../../../../lib/services/database.types';
import { disputeService } from '../../../../lib/services/dispute-service';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { withAlpha } from '../../../../lib/utils';
import { ConsequenceList, FlowNav, FlowTitle, OtherOptions, PinnedFooter, PosterButton, ProofPhotos, WorkspaceLayout } from '../../../../components/poster';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { useBountyLifecycle } from '../../../../hooks/useBountyLifecycle';
import { firstName } from '../../../../lib/my-jobs/format';
import { hunterMoney } from '../../../../lib/utils/hunter-stage-copy';

export default function HunterReviewAndVerifyScreen() {
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
  const [messageText, setMessageText] = useState('');
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0); // in seconds
  const [startTime] = useState(Date.now());
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [hasActiveDispute, setHasActiveDispute] = useState(false);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);

  // Attachment upload hook
  const {
    pickAttachment,
    isUploading: isUploadingProof,
    isPicking: isPickingProof,
  } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: 'proofs',
    maxSizeMB: 10,
    allowsMultiple: true,
    onUploaded: (attachment) => {
      const proofItem: ProofItem = {
        id: attachment.id,
        type: attachment.mimeType?.startsWith('image/') ? 'image' : 'file',
        name: attachment.name,
        url: attachment.remoteUri,
        uri: attachment.uri,
        size: attachment.size,
        mimeType: attachment.mimeType,
      };
      setProofItems((prev) => [...prev, proofItem]);
    },
    onError: (error) => {
      Alert.alert("Couldn't upload that file", sanitizeErrorMessage(error));
    },
  });

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  // For the poster's name in the copy (the same lifecycle every job screen reads).
  const { session } = useAuthContext();
  const lifecycle = useBountyLifecycle(routeBountyId, session?.user?.id ?? currentUserId ?? null);

  // Sending again after a requested change (M.3 → H.8): start from the
  // submission that was sent back, the same contract the job thread's
  // SubmitWorkSheet uses (its message and proof_items).
  const prefilledRef = React.useRef(false);
  useEffect(() => {
    if (!routeBountyId || prefilledRef.current) return;
    let active = true;
    completionService
      .getSubmission(routeBountyId)
      .then((sub) => {
        if (!active || !sub || prefilledRef.current) return;
        if (sub.status !== 'revision_requested' || String(sub.hunter_id) !== String(currentUserId)) return;
        prefilledRef.current = true;
        setMessageText((current) => (current.trim() ? current : sub.message ?? ''));
        setProofItems((current) => (current.length > 0 ? current : (Array.isArray(sub.proof_items) ? (sub.proof_items as ProofItem[]) : [])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [routeBountyId, currentUserId]);

  useEffect(() => {
    if (!routeBountyId) {
      setError('Invalid bounty id');
      setIsLoading(false);
      return;
    }
    loadData(routeBountyId);
    loadProofItems();
    loadActiveDispute(routeBountyId);

    // Start timer
    const interval = setInterval(() => {
      setTimeElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [routeBountyId, startTime]);

  const loadActiveDispute = async (id: string) => {
    // Always reset first so this works correctly if the screen is reused
    // for a different bountyId or refreshed after an admin resolved the dispute.
    setHasActiveDispute(false);
    setActiveDisputeId(null);
    try {
      const workflowDispute = await disputeService.getDisputeByBountyId(id);
      if (workflowDispute && (workflowDispute.status === 'open' || workflowDispute.status === 'under_review')) {
        setHasActiveDispute(true);
        setActiveDisputeId(workflowDispute.id);
      }
    } catch (err) {
      console.error('Error loading active dispute:', err);
    }
  };

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

  const loadProofItems = async () => {
    try {
      // If bounty includes attachments_json, parse and populate
      const attachmentsJson = (bounty as any)?.attachments_json
      if (attachmentsJson) {
        let parsed: any[] = []
        try { parsed = JSON.parse(attachmentsJson) } catch { parsed = [] }
        const items: ProofItem[] = parsed.map((a: any) => ({
          id: a.id || String(Date.now()),
          type: a.mimeType?.startsWith('image/') ? 'image' : 'file',
          name: a.name || (a.remoteUri ? a.remoteUri.split('/').pop() : 'attachment'),
          url: a.remoteUri,
          uri: a.uri,
          size: a.size,
          mimeType: a.mimeType,
        }))
        setProofItems(items)
        return
      }

      // Default to empty
      setProofItems([])
    } catch (err) {
      console.error('Error loading proof items:', err);
      setProofItems([])
    }
  };

  const handleAddProof = async () => {
    await pickAttachment();
  };

  const handleRemoveProof = (id: string) => {
    setProofItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRequestReview = async () => {
    if (hasActiveDispute) {
      Alert.alert(
        'Submission Locked',
        'A dispute is currently open for this bounty. Submissions are paused until the dispute is resolved by an admin.'
      );
      return;
    }

    // `proofItems` is only appended to inside the upload hook's `onUploaded`
    // callback, which fires after the file finishes uploading. Without this
    // guard, tapping Submit right after picking a photo would submit the
    // completion before that callback ran — the just-picked proof file
    // would silently be left out, with no error and no indication anything
    // was wrong.
    if (isUploadingProof || isPickingProof) {
      Alert.alert(
        'Upload in Progress',
        'Please wait for your proof file to finish uploading before submitting.'
      );
      return;
    }

    if (!messageText.trim()) {
      Alert.alert(
        'Completion Message Required',
        'Please add a message describing your completed work.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Helper for pluralization
    const proofCount = proofItems.length;
    const proofLabel = proofCount === 1 ? '1 proof item' : `${proofCount} proof items`;

    // Define the actual submission logic
    const performSubmission = async () => {
      try {
        setIsSubmitting(true);
        
        // Submit completion via service
        await completionService.submitCompletion({
          bounty_id: String(bounty?.id),
          hunter_id: currentUserId,
          message: messageText.trim(),
          proof_items: proofItems,
        });

        // Update bounty status to indicate submission pending review
        // (In real implementation, backend should handle this)

        // Straight to the waiting step (H.9), which says "Sent to {Poster}."
        if (routeBountyId) {
          router.replace({
            pathname: '/in-progress/[bountyId]/hunter/payout',
            params: { bountyId: routeBountyId, sent: 'work' },
          });
        }
      } catch (err) {
        console.error('Error requesting review:', err);
        Alert.alert("Couldn't request review", "Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    };

    // Show different confirmation dialogs based on whether proof is attached
    if (proofItems.length === 0) {
      // No proof attached - show warning
      Alert.alert(
        'No Proof Attached',
        'You are submitting without any proof of completion. The poster may request revisions. Are you sure you want to continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: performSubmission },
        ]
      );
    } else {
      // Proof attached - show confirmation
      Alert.alert(
        'Confirm Submission',
        `You have attached ${proofLabel}. Are you ready to submit your work for review?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: performSubmission },
        ]
      );
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const posterFirst = firstName(lifecycle.otherParty.name);
  // Start of a sentence vs inside one; only the fallback changes case.
  const Poster = posterFirst ?? 'The poster';
  const poster = posterFirst ?? 'the poster';
  const uploading = isUploadingProof || isPickingProof;
  const money = bounty ? hunterMoney(bounty.amount) : null;

  const askRemoveProof = (item: ProofItem) => {
    Alert.alert('Remove this photo?', item.name || 'This attachment will not be sent.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => handleRemoveProof(item.id) },
    ]);
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

  const primaryLabel = hasActiveDispute
    ? 'Locked (dispute open)'
    : uploading
      ? 'Uploading photo…'
      : `Send to ${poster} for approval`;

  return (
    <WorkspaceLayout
      background="card"
      testID="hunter-send-work"
      footer={
        <PinnedFooter>
          <PosterButton
            label={primaryLabel}
            loading={isSubmitting}
            loadingLabel="Sending your work"
            disabled={hasActiveDispute || uploading}
            onPress={handleRequestReview}
            testID="send-work"
          />
        </PinnedFooter>
      }
    >
      <FlowNav label="Back to the job" onBack={goBack} />
      <FlowTitle title={`Tell ${poster} it's done`} />

      <View style={styles.focusField}>
        <Text style={styles.focusLabel}>{`Note for ${poster}`}</Text>
        <TextInput
          style={styles.messageTextArea}
          placeholder="What you did, and anything they should check"
          placeholderTextColor={withAlpha(theme.text, 0.4)}
          value={messageText}
          onChangeText={setMessageText}
          multiline
          numberOfLines={4}
          maxLength={1000}
          textAlignVertical="top"
          accessibilityLabel={`Note for ${poster}`}
        />
      </View>

      <ProofPhotos
        label={`Photos (${proofItems.length})`}
        cols={3}
        height={96}
        items={proofItems.map((item) => ({
          key: item.id,
          uri: item.type === 'image' ? item.uri || item.url || null : null,
          label: item.name || 'Attachment',
          icon: item.type === 'image' ? 'photo' : 'insert-drive-file',
          onPress: () => askRemoveProof(item),
        }))}
        addTile={{ label: uploading ? 'Uploading…' : 'Add photo', onPress: handleAddProof, disabled: hasActiveDispute || uploading }}
      />

      {hasActiveDispute && (
        <DisputeFrozenBanner message="A dispute has been opened for this bounty. Submitting evidence is paused until an admin resolves the dispute." />
      )}

      <ConsequenceList
        label="WHAT HAPPENS NEXT"
        items={[
          { icon: 'rate-review', title: `${Poster} checks your work`, detail: 'They can approve it or ask for a change.' },
          ...(bounty.is_for_honor || !money
            ? []
            : [
                { icon: 'lock' as const, title: `${money.gross} stays held until then`, detail: 'Nobody is paid yet.' },
                { icon: 'account-balance-wallet' as const, title: `You get ${money.net} when ${poster} approves` },
              ]),
        ]}
      />

      <OtherOptions
        label="More"
        items={[
          {
            key: 'message',
            label: `Message ${poster}`,
            icon: 'chat-bubble-outline',
            onPress: () => {
              if (!routeBountyId) return;
              router.push({ pathname: '/tabs/bounty-thread/[bountyId]', params: { bountyId: routeBountyId, role: 'hunter' } } as never);
            },
          },
          hasActiveDispute
            ? { key: 'view_dispute', label: 'View dispute', icon: 'gavel', onPress: () => (router as any).push(`/dispute/${activeDisputeId}`) }
            : { key: 'open_dispute', label: 'Open a dispute', icon: 'gavel', onPress: () => setShowDisputeModal(true) },
        ]}
      />
      {/* The task timer, off the main path. */}
      <Text style={styles.timerHint} accessibilityLabel={`Time on this task: ${formatTime(timeElapsed)}`}>
        {`Time on this task: ${formatTime(timeElapsed)}`}
      </Text>

      {/* Workflow Dispute Modal */}
      {bounty && routeBountyId && (
        <WorkflowDisputeModal
          visible={showDisputeModal}
          bountyId={routeBountyId}
          bountyTitle={bounty.title}
          initiatorId={currentUserId}
          respondentId={String(bounty.poster_id || bounty.user_id)}
          stage="review_verify"
          onClose={() => setShowDisputeModal(false)}
          onDisputeCreated={(disputeId) => {
            setShowDisputeModal(false);
            setHasActiveDispute(true);
            setActiveDisputeId(disputeId);
            Alert.alert('Dispute Filed', 'Your dispute has been submitted.', [
              { text: 'View Dispute', onPress: () => (router as any).push(`/dispute/${disputeId}`) },
              { text: 'OK' },
            ]);
          }}
        />
      )}
    </WorkspaceLayout>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  focusField: { gap: 6 },
  focusLabel: { color: theme.poster.ink2, fontSize: 15, fontWeight: '700' },
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
    gap: 12,
  },
  bountyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  timerLabel: {
    color: theme.primaryLight,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: theme.text,
    fontSize: 48,
    fontWeight: '700',
  },
  timerHint: {
    color: withAlpha(theme.text, 0.6),
    fontSize: 12,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  section: {
    gap: 12,
  },
  sectionSubtitle: {
    color: withAlpha(theme.text, 0.7),
    fontSize: 13,
  },
  messageTextArea: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    color: theme.text,
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
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
  proofList: {
    gap: 12,
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.borderSubtle,
  },
  proofIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: withAlpha(theme.primary, 0.3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofInfo: {
    flex: 1,
    gap: 4,
  },
  proofName: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
  },
  proofSize: {
    color: theme.primaryLight,
    fontSize: 12,
  },
  removeButton: {
    padding: 8,
  },
  emptyProof: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.borderSubtle,
    borderStyle: 'dashed',
  },
  emptyProofText: {
    color: withAlpha(theme.text, 0.6),
    fontSize: 14,
  },
  addProofButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: withAlpha(theme.text, 0.1),
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  addProofText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
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
  submitButtonDisabled: {
    backgroundColor: withAlpha(theme.primary, 0.5),
  },
  submitButtonText: {
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
