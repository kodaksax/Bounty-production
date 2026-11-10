import { DisputeSubmissionForm } from 'components/dispute-submission-form';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthContext } from 'hooks/use-auth-context';
import { EMAIL_SUBJECTS, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_RESPONSE_TIMES, createSupportTel } from 'lib/constants/support';
import { attachmentService } from 'lib/services/attachment-service';
import { bountyService } from 'lib/services/bounty-service';
import { cancellationService } from 'lib/services/cancellation-service';
import { completionService } from 'lib/services/completion-service';
import type { Bounty } from 'lib/services/database.types';
import { disputeService, type DisputeReasonCode } from 'lib/services/dispute-service';
import { getDisputeReasonOptions } from 'lib/utils/dispute-reasons';
import type { BountyCancellation, BountyDispute, LocalDisputeEvidence } from 'lib/types';
import { AlertCircle, ArrowLeft, HelpCircle, Mail, Phone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ROUTES } from '../../../lib/routes';
import { KeyboardAwareScrollView } from '../../../components/ui/keyboard-avoiding';
import { withReplayMask } from '../../../components/replay-mask';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { withAlpha } from '../../../lib/utils';
import type { AppTheme } from '../../../lib/themes/types';
import { useMemo } from 'react';
import { showToast } from '../../../lib/toast';

function DisputeScreen() {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { id, from, reason: reasonParam } = useLocalSearchParams<{
    id: string;
    from?: string;
    /** Preselects a reason, e.g. `hunter_unresponsive`. */
    reason?: string;
  }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;
  
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [cancellation, setCancellation] = useState<BountyCancellation | null>(null);
  const [dispute, setDispute] = useState<BountyDispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceInput, setEvidenceInput] = useState('');
  // Work is waiting on the poster's review (workflow dispute stage + reasons).
  const [workSubmitted, setWorkSubmitted] = useState(false);
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode | null>(null);
    
  useEffect(() => {
    loadData();
  }, [id]);
  
  const loadData = async () => {
    try {
      setLoading(true);
      const [bountyData, cancellationData, latestSubmission] = await Promise.all([
        bountyService.getById(id),
        cancellationService.getCancellationByBountyId(id),
        completionService.getSubmission(id).catch(() => null),
      ]);

      if (bountyData) {
        setBounty(bountyData);
      }
      setWorkSubmitted(latestSubmission?.status === 'pending');

      let existingDispute: BountyDispute | null = null;
      if (cancellationData) {
        setCancellation(cancellationData);
        existingDispute = await disputeService.getDisputeByCancellationId(cancellationData.id);
      }
      // Workflow disputes (no cancellation) are the only kind a poster can
      // open since cancellation requests became hunter-only (20260908020000).
      if (!existingDispute) {
        existingDispute = await disputeService.getDisputeByBountyId(id);
      }
      setDispute(existingDispute);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert("Couldn't load dispute information", "Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  const isPoster =
    !!userId && !!bounty && (bounty.poster_id === userId || bounty.user_id === userId);
  const isAcceptedHunter = !!userId && !!bounty?.accepted_by && bounty.accepted_by === userId;
  // The database accepts a workflow dispute only from a participant of a
  // bounty a hunter is committed to (fn_bounty_disputes_guard).
  const canOpenWorkflowDispute =
    !!bounty &&
    !!bounty.accepted_by &&
    (bounty.status === 'in_progress' || bounty.status === 'cancellation_requested') &&
    (isPoster || isAcceptedHunter);
  const reasonOptions = canOpenWorkflowDispute
    ? getDisputeReasonOptions(isPoster ? 'poster' : 'hunter', { workSubmitted })
    : [];
  const selectedReason = reasonOptions.find((o) => o.code === reasonCode) ?? null;

  useEffect(() => {
    if (reasonCode || reasonOptions.length === 0) return;
    const preset = reasonOptions.find((o) => o.code === reasonParam);
    if (preset) setReasonCode(preset.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonParam, reasonOptions.length]);

  const handleCreateDispute = async (reason: string, evidence: LocalDisputeEvidence[]) => {
    if (!userId || !bounty) {
      throw new Error('Unable to create dispute');
    }

    setSubmitting(true);
    try {
      let result: BountyDispute | null;
      if (cancellation && cancellation.status === 'pending') {
        result = await disputeService.createDispute(cancellation.id, userId, reason, evidence);
      } else {
        if (!canOpenWorkflowDispute) {
          throw new Error('You can report a problem only on a bounty you are working on or posted.');
        }
        const respondentId = isPoster
          ? String(bounty.accepted_by)
          : String(bounty.poster_id ?? bounty.user_id);
        result = await disputeService.createWorkflowDispute(
          String(bounty.id),
          userId,
          respondentId,
          workSubmitted ? 'review_verify' : 'in_progress',
          reason,
          // Evidence is uploaded below: picker items are local file:// URIs
          // that must reach storage first.
          undefined,
          reasonCode ?? undefined
        );
      }

      if (!result) {
        throw new Error('Failed to create dispute');
      }

      // `createDispute` deliberately does not persist the `evidence` array —
      // it only uses it for an analytics count. Each item must be synced
      // individually afterward, and image/document items are still local
      // file:// URIs from the picker at this point. Without this loop, any
      // evidence attached on the create-dispute form was silently discarded:
      // the dispute was created, "Success" was shown, and the files the user
      // picked never reached storage or the dispute_evidence table.
      let evidenceFailures = 0;
      if (evidence && evidence.length > 0) {
        for (const item of evidence) {
          try {
            let content = item.content;

            if (item.type === 'image' || item.type === 'document') {
              const uploaded = await attachmentService.upload({
                id: item.id,
                name: item.description || item.id,
                uri: item.content,
                mimeType: item.mimeType,
                size: item.fileSize,
              });

              if (uploaded.status !== 'uploaded' || !uploaded.remoteUri) {
                evidenceFailures += 1;
                continue;
              }
              content = uploaded.remoteUri;
            }

            const success = await disputeService.uploadEvidence(result.id, userId, {
              type: item.type,
              content,
              description: item.description,
              mimeType: item.mimeType,
              fileSize: item.fileSize,
            });

            if (!success) evidenceFailures += 1;
          } catch (evidenceError) {
            console.error('Error syncing dispute evidence:', evidenceError);
            evidenceFailures += 1;
          }
        }
      }

      Alert.alert(
        'Success',
        evidenceFailures > 0
          ? `Dispute created successfully, but ${evidenceFailures} piece${evidenceFailures === 1 ? '' : 's'} of evidence failed to upload. You can add it again from the dispute details screen.`
          : `Bounty support has your report and usually responds within ${SUPPORT_RESPONSE_TIMES.dispute}.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setDispute(result);
            },
          },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };
  
  const handleAddEvidence = async (evidenceText: string) => {
    if (!dispute) {
      throw new Error('No dispute found');
    }
    
    setSubmitting(true);
    try {
      const newEvidence: LocalDisputeEvidence = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        type: 'text',
        content: evidenceText,
        uploadedAt: new Date().toISOString(),
      };

      // Use uploadEvidence for user-submitted items so the server assigns
      // persisted fields (`uploaded_by`, timestamps) and stores them in the
      // `dispute_evidence` table.
      const success = await disputeService.uploadEvidence(dispute.id, String(userId), {
        type: newEvidence.type,
        content: newEvidence.content,
        description: newEvidence.description,
        mimeType: (newEvidence as any).mimeType,
        fileSize: (newEvidence as any).fileSize,
      });
      
      if (success) {
        // Close first: a toast can't draw above an open native Modal.
        setShowEvidenceModal(false);
        setEvidenceInput('');
        showToast({ message: 'Evidence added successfully' });
        await loadData(); // Reload to show new evidence
      } else {
        // handleSubmitEvidence below calls this without awaiting/catching,
        // so throwing here would only produce an unhandled promise
        // rejection — the modal would stay open with no feedback and the
        // user would have no idea their evidence wasn't saved. Surface it
        // directly instead.
        Alert.alert("Couldn't add evidence", "Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEvidence = () => {
    if (evidenceInput.trim()) {
      handleAddEvidence(evidenceInput.trim());
    }
  };

  const handleContactSupport = () => {
    const subject = bounty ? EMAIL_SUBJECTS.dispute(bounty.title) : EMAIL_SUBJECTS.general;
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`);
  };

  const handleCallSupport = () => {
    Linking.openURL(createSupportTel());
  };
  
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
      </View>
    );
  }
  
  const handleGoBack = () => {
    // If the dispute screen was opened from the hunter in-progress flow,
    // return to the Postings tab's In Progress view so the hunter tools
    // context is visible. Otherwise fall back to history back.
    try {
        if (from === 'in-progress') {
          // Use a full href with query string and replace to ensure the tab
          // wrapper (`/tabs/bounty-app`) mounts and receives the `tab`
          // and `initialTab` params so BottomNav is shown.
          router.replace(`${ROUTES.TABS.BOUNTY_APP}?tab=messages&initialTab=inProgress`)
        return;
      }
    } catch (e) {
      // ignore and fallback to back
    }

    router.back();
  };

  if (!bounty || (!dispute && !cancellation && !canOpenWorkflowDispute)) {
    return (
      <View className="flex-1 items-center justify-center p-6" style={{ backgroundColor: theme.background }}>
        <AlertCircle size={48} color={theme.errorText} />
        <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>
          {bounty ? 'Nothing to report here' : 'Bounty not found'}
        </Text>
        <Text className="text-center mt-2" style={{ color: theme.textSecondary }}>
          {bounty
            ? 'You can report a problem once a hunter is working on this bounty. For anything else, contact support.'
            : 'We could not load this bounty. Contact support and we will look into it.'}
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          <TouchableOpacity accessibilityRole="button"
            onPress={handleContactSupport}
            className="bg-[#008E2A] px-6 py-3 rounded-lg flex-row items-center justify-center"
          >
            <Mail size={18} color="white" />
            <Text className="font-semibold ml-2" style={{ color: theme.onPrimary }}>Contact support</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            onPress={handleGoBack}
            className="px-6 py-3 rounded-lg mt-3"
          >
            <Text className="font-medium text-center" style={{ color: theme.textSecondary }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <KeyboardAwareScrollView className="flex-1">
        {/* Header */}
        <View className="px-4 py-6 pt-12" style={{ backgroundColor: theme.surface }}>
          <TouchableOpacity accessibilityRole="button"
            onPress={handleGoBack}
            className="mb-4"
          >
            <ArrowLeft size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="text-2xl font-bold" style={{ color: theme.text }}>
            {dispute ? 'Dispute Details' : 'Report a problem'}
          </Text>
          <Text className="mt-1" style={{ color: theme.textSecondary }}>
            {bounty.title}
          </Text>
        </View>
        
        {/* Content */}
        <View className="p-6">
          {dispute ? (
            /* Existing Dispute View */
            <>
              {/* Status Banner */}
              <View
                className="rounded-lg p-4 mb-6 border"
                style={{
                  backgroundColor: dispute.status === 'resolved' ? theme.successTint : theme.warningTint,
                  borderColor: withAlpha(dispute.status === 'resolved' ? theme.success : theme.warning, 0.4),
                }}
              >
                <View className="flex-row items-start">
                  <AlertCircle 
                    size={20} 
                    color={dispute.status === 'resolved' ? theme.primaryLight : theme.warningText} 
                  />
                  <View className="flex-1 ml-3">
                    <Text className="font-semibold mb-1" style={{ color: dispute.status === 'resolved' ? theme.successText : theme.warningText }}>
                      Dispute Status: {dispute.status.replace('_', ' ').toUpperCase()}
                    </Text>
                    <Text style={{ color: dispute.status === 'resolved' ? theme.successText : theme.warningText }}>
                      {dispute.status === 'resolved'
                        ? 'This dispute has been resolved.'
                        : 'Your dispute is being reviewed by our team.'}
                    </Text>
                  </View>
                </View>
              </View>
              
              {/* Dispute Details */}
              <View className="rounded-lg p-4 mb-6" style={{ backgroundColor: theme.surface }}>
                <Text className="text-sm mb-1" style={{ color: theme.textSecondary }}>Reason</Text>
                <Text className="text-base mb-4" style={{ color: theme.text }}>
                  {dispute.reason}
                </Text>
                
                {dispute.evidence && dispute.evidence.length > 0 && (
                  <>
                    <Text className="text-sm mb-2" style={{ color: theme.textSecondary }}>Evidence</Text>
                    {dispute.evidence.map((ev, idx) => (
                      <View key={ev.id} className="rounded p-3 mb-2" style={{ backgroundColor: theme.surfaceSecondary }}>
                        <Text className="text-sm" style={{ color: theme.text }}>{ev.content}</Text>
                        <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                          {new Date(ev.uploadedAt).toLocaleString()}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
                
                {dispute.resolution && (
                  <>
                    <Text className="text-sm mb-1 mt-4" style={{ color: theme.textSecondary }}>Resolution</Text>
                    <Text className="text-base" style={{ color: theme.text }}>
                      {dispute.resolution}
                    </Text>
                  </>
                )}
              </View>
              
              {/* Add More Evidence */}
              {dispute.status === 'open' || dispute.status === 'under_review' ? (
                <View className="mb-6">
                  <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
                    Add More Evidence
                  </Text>
                  <Text className="text-sm mb-3" style={{ color: theme.textSecondary }}>
                    Provide additional text evidence to support your dispute. For images or documents, please contact support.
                  </Text>
                  <TouchableOpacity accessibilityRole="button"
                    onPress={() => setShowEvidenceModal(true)}
                    className="flex-row items-center justify-center rounded-lg py-3 bg-[#008E2A]"
                  >
                    <Text className="font-medium" style={{ color: theme.onPrimary }}>
                      + Add Evidence
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : (
            /* Create Dispute Form - Using DisputeSubmissionForm component */
            <View className="flex-1">
              {reasonOptions.length > 0 && (
                <View className="mb-6">
                  <Text className="text-base font-semibold mb-3" style={{ color: theme.text }}>
                    {"What's going on?"}
                  </Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {reasonOptions.map((option) => {
                      const selected = option.code === reasonCode;
                      return (
                        <TouchableOpacity
                          key={option.code}
                          onPress={() => setReasonCode(option.code)}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          className="px-3 py-2 rounded-full border"
                          style={{
                            backgroundColor: selected ? theme.primary : 'transparent',
                            borderColor: selected ? theme.primary : theme.border,
                          }}
                        >
                          <Text className={selected ? 'font-medium' : ''} style={{ color: selected ? theme.onPrimary : theme.text }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {selectedReason && (
                    <Text className="text-sm mt-3" style={{ color: theme.textSecondary }}>{selectedReason.help}</Text>
                  )}
                </View>
              )}
              <DisputeSubmissionForm
                // Remount so the reason text starts from the chosen category.
                key={reasonCode ?? 'none'}
                bountyTitle={bounty.title}
                onSubmit={handleCreateDispute}
                isSubmitting={submitting}
                showGuidance={true}
                initialReason={selectedReason ? `${selectedReason.label}: ` : ''}
              />
            </View>
          )}
          
          {/* Support Contact Section - Always visible */}
          <View className="border rounded-lg p-4 mt-6" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <View className="flex-row items-start">
              <HelpCircle size={20} color={theme.primaryLight} />
              <View className="flex-1 ml-3">
                <Text className="font-semibold mb-1" style={{ color: theme.text }}>
                  Dispute Mediation Support
                </Text>
                <Text className="text-sm mb-2" style={{ color: theme.textSecondary }}>
                  Our support team typically responds within {SUPPORT_RESPONSE_TIMES.dispute}. For urgent matters, please call us directly.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <TouchableOpacity accessibilityRole="button"
                    onPress={handleContactSupport}
                    className="flex-row items-center bg-[#008E2A] px-3 py-2 rounded-lg"
                  >
                    <Mail size={14} color="white" />
                    <Text className="text-sm font-medium ml-1" style={{ color: theme.onPrimary }}>{SUPPORT_EMAIL}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button"
                    onPress={handleCallSupport}
                    className="flex-row items-center bg-[#008E2A] px-3 py-2 rounded-lg"
                  >
                    <Phone size={14} color="white" />
                    <Text className="text-sm font-medium ml-1" style={{ color: theme.onPrimary }}>{SUPPORT_PHONE}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
          
          <TouchableOpacity accessibilityRole="button"
            onPress={handleGoBack}
            disabled={submitting}
            className="mt-4 py-4"
          >
            <Text className="text-center font-medium" style={{ color: theme.textSecondary }}>
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>

      {/* Evidence Modal */}
      <Modal
        visible={showEvidenceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEvidenceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add evidence</Text>
            <Text style={styles.modalSubtitle}>
              Describe the additional evidence
            </Text>
            <TextInput
              value={evidenceInput}
              onChangeText={setEvidenceInput}
              placeholder="Enter evidence details..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={styles.modalInput}
              editable={!submitting}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity accessibilityRole="button"
                onPress={handleSubmitEvidence}
                disabled={submitting || !evidenceInput.trim()}
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  (submitting || !evidenceInput.trim()) && styles.modalButtonDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.textSecondary} size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, !evidenceInput.trim() && { color: theme.textSecondary }]}>Submit</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                onPress={() => {
                  setShowEvidenceModal(false);
                  setEvidenceInput('');
                }}
                disabled={submitting}
                style={[styles.modalButton, styles.modalButtonSecondary]}
              >
                <Text style={styles.modalButtonTextSecondary}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: theme.text,
    minHeight: 100,
    marginBottom: 16,
  },
  modalButtons: {
    gap: 12,
  },
  modalButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonPrimary: {
    backgroundColor: theme.primary,
  },
  modalButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalButtonDisabled: {
    backgroundColor: theme.surfaceSecondary,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextSecondary: {
    color: theme.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
});
}

export default withReplayMask(DisputeScreen);
