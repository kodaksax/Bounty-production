// app/dispute/create.tsx - User creates a dispute for a cancellation
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { disputeService } from '../../lib/services/dispute-service';
import { useAuthContext } from '../../hooks/use-auth-context';
import { generateEvidenceId } from '../../lib/utils/dispute-helpers';
import { KeyboardAwareScrollView } from '../../components/ui/keyboard-avoiding';
import { withReplayMask } from '../../components/replay-mask';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { withAlpha } from '../../lib/utils';
import { showToast } from '../../lib/toast';

type LocalEvidenceItem = {
  id: string;
  type: 'text' | 'image' | 'document' | 'link';
  content: string;
  description?: string;
  uploadedAt: string;
};

function CreateDisputeScreen() {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { cancellationId } = useLocalSearchParams<{
    cancellationId: string;
    bountyId?: string;
  }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;

  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<LocalEvidenceItem[]>([]);
  const [newEvidenceType, setNewEvidenceType] = useState<'text' | 'link'>('text');
  const [newEvidenceContent, setNewEvidenceContent] = useState('');
  const [newEvidenceDescription, setNewEvidenceDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  // Web-only: inline confirmation step replaces Alert.alert confirmation dialog
  const [showWebConfirm, setShowWebConfirm] = useState(false);
  const [showEvidenceError, setShowEvidenceError] = useState(false);

  const handleAddEvidence = () => {
    if (!newEvidenceContent.trim()) {
      setShowEvidenceError(true);
      if (Platform.OS !== 'web') {
        Alert.alert("Something went wrong", 'Please provide evidence content');
      }
      return;
    }
    setShowEvidenceError(false);

    const newEvidence: LocalEvidenceItem = {
      id: generateEvidenceId(),
      type: newEvidenceType,
      content: newEvidenceContent,
      description: newEvidenceDescription || undefined,
      uploadedAt: new Date().toISOString(),
    };

    setEvidence([...evidence, newEvidence]);
    setNewEvidenceContent('');
    setNewEvidenceDescription('');
    setShowAddEvidence(false);
    // Native-only success alert — web sees the evidence count update as confirmation
    if (Platform.OS !== 'web') {
      showToast({ message: 'Evidence added' });
    }
  };

  const handleRemoveEvidence = (id: string) => {
    setEvidence(evidence.filter((e) => e.id !== id));
  };

  const executeSubmit = async () => {
    setIsSubmitting(true);
    setShowWebConfirm(false);
    try {
      const dispute = await disputeService.createDispute(
        cancellationId,
        userId!,
        reason,
        evidence
      );

      if (dispute) {
        for (const ev of evidence) {
          await disputeService.uploadEvidence(dispute.id, userId!, {
            type: ev.type,
            content: ev.content,
            description: ev.description,
          });
        }

        if (Platform.OS === 'web') {
          // Navigate directly — no Alert.alert on web
          router.back();
        } else {
          Alert.alert(
            'Success',
            'Dispute created successfully. An admin will review it shortly.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      } else {
        if (Platform.OS !== 'web') {
          Alert.alert("Couldn't create dispute", "Please try again.");
        }
      }
    } catch (error) {
      console.error('Error creating dispute:', error);
      if (Platform.OS !== 'web') {
        Alert.alert("Something went wrong", 'An unexpected error occurred');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!userId) {
      if (Platform.OS !== 'web') Alert.alert("Something went wrong", 'You must be logged in to create a dispute');
      return;
    }
    if (!reason.trim()) {
      if (Platform.OS !== 'web') Alert.alert("Something went wrong", 'Please provide a reason for the dispute');
      return;
    }
    if (reason.trim().length < 20) {
      if (Platform.OS !== 'web') Alert.alert("Something went wrong", 'Please provide a more detailed reason (at least 20 characters)');
      return;
    }
    if (!cancellationId) {
      if (Platform.OS !== 'web') Alert.alert("Something went wrong", 'Missing cancellation information');
      return;
    }

    if (Platform.OS === 'web') {
      // Show inline confirmation instead of Alert.alert (which is a no-op on web)
      setShowWebConfirm(true);
    } else {
      Alert.alert(
        'Confirm Dispute',
        'Are you sure you want to create a dispute? This will notify all involved parties.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Create Dispute', style: 'destructive', onPress: executeSubmit },
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Open a dispute</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAwareScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={20} color={theme.infoText} />
          <Text style={styles.infoBannerText}>
            Disputes are reviewed by admins who will make a fair decision based on the evidence
            provided.
          </Text>
        </View>

        {/* Reason Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason for dispute *</Text>
          <Text style={styles.sectionHint}>
            Explain why you are disputing this cancellation and what you believe the fair outcome
            should be.
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Describe your dispute..."
            placeholderTextColor={withAlpha(theme.text, 0.4)}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={styles.reasonInput}
            editable={!isSubmitting}
          />
          {/* Web: inline validation hint */}
          {Platform.OS === 'web' && reason.trim().length > 0 && reason.trim().length < 20 && (
            <Text style={styles.validationHint}>Please provide at least 20 characters ({reason.trim().length}/20)</Text>
          )}
        </View>

        {/* Evidence Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Evidence ({evidence.length})</Text>
            {!showAddEvidence && (
              <TouchableOpacity accessibilityRole="button"
                onPress={() => setShowAddEvidence(true)}
                style={styles.addButton}
                disabled={isSubmitting}
              >
                <MaterialIcons name="add" size={20} color={theme.primaryLight} />
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.sectionHint}>
            Provide links or written descriptions to support your case. Image and document uploads
            coming soon.
          </Text>

          {/* Evidence List */}
          {evidence.length > 0 && (
            <View style={styles.evidenceList}>
              {evidence.map((item) => (
                <View key={item.id} style={styles.evidenceItem}>
                  <View style={styles.evidenceHeader}>
                    <MaterialIcons
                      name={
                        item.type === 'image'
                          ? 'image'
                          : item.type === 'document'
                          ? 'description'
                          : item.type === 'link'
                          ? 'link'
                          : 'text-fields'
                      }
                      size={18}
                      color={theme.primaryLight}
                    />
                    <Text style={styles.evidenceType}>{item.type.toUpperCase()}</Text>
                    <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button"
                      onPress={() => handleRemoveEvidence(item.id)}
                      style={styles.removeButton}
                      disabled={isSubmitting}
                    >
                      <MaterialIcons name="close" size={16} color={theme.errorText} />
                    </TouchableOpacity>
                  </View>
                  {item.description && (
                    <Text style={styles.evidenceDescription}>{item.description}</Text>
                  )}
                  <Text style={styles.evidenceContent} numberOfLines={2}>
                    {item.content}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Add Evidence Form */}
          {showAddEvidence && (
            <View style={styles.addEvidenceForm}>
              <Text style={styles.formLabel}>Type</Text>
              <View style={styles.typeSelector}>
                {(['text', 'link'] as const).map((type) => (
                  <TouchableOpacity accessibilityRole="button"
                    key={type}
                    onPress={() => setNewEvidenceType(type)}
                    style={[
                      styles.typeButton,
                      newEvidenceType === type && styles.typeButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        newEvidenceType === type && styles.typeButtonTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>
                {newEvidenceType === 'link' ? 'URL' : 'Description'}
              </Text>
              <TextInput
                value={newEvidenceContent}
                onChangeText={setNewEvidenceContent}
                placeholder={
                  newEvidenceType === 'link'
                    ? 'https://example.com/proof'
                    : 'Describe the evidence...'
                }
                placeholderTextColor={withAlpha(theme.text, 0.4)}
                multiline={newEvidenceType === 'text'}
                numberOfLines={newEvidenceType === 'text' ? 4 : 1}
                style={styles.evidenceInput}
              />

              {newEvidenceContent && (
                <>
                  <Text style={styles.formLabel}>Description (Optional)</Text>
                  <TextInput
                    value={newEvidenceDescription}
                    onChangeText={setNewEvidenceDescription}
                    placeholder="Add a description..."
                    placeholderTextColor={withAlpha(theme.text, 0.4)}
                    style={styles.evidenceInput}
                  />
                </>
              )}

              {/* Show inline error when user attempts to add with empty content */}
              {showEvidenceError && !newEvidenceContent.trim() && (
                <Text style={styles.validationHint}>Evidence content is required</Text>
              )}

              <View style={styles.formActions}>
                <TouchableOpacity accessibilityRole="button" onPress={handleAddEvidence} style={styles.formActionButton}>
                  <MaterialIcons name="check" size={18} color={theme.onPrimary} />
                  <Text style={styles.formActionButtonText}>Add evidence</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  onPress={() => {
                    setShowAddEvidence(false);
                    setNewEvidenceContent('');
                    setNewEvidenceDescription('');
                    setShowEvidenceError(false);
                  }}
                  style={[styles.formActionButton, styles.formActionButtonCancel]}
                >
                  <Text style={styles.formActionButtonTextCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Web: inline confirmation card replaces Alert.alert confirm dialog */}
        {Platform.OS === 'web' && showWebConfirm && (
          <View style={styles.webConfirmCard}>
            <MaterialIcons name="report-problem" size={20} color={theme.warningText} />
            <Text style={styles.webConfirmText}>
              Are you sure you want to create this dispute? This will notify all involved parties.
            </Text>
            <View style={styles.webConfirmActions}>
              <TouchableOpacity accessibilityRole="button"
                onPress={executeSubmit}
                style={styles.webConfirmYes}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={theme.onPrimary} size="small" />
                ) : (
                  <Text style={styles.webConfirmYesText}>Yes, open dispute</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                onPress={() => setShowWebConfirm(false)}
                style={styles.webConfirmNo}
                disabled={isSubmitting}
              >
                <Text style={styles.webConfirmNoText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Submit Button */}
        {!showWebConfirm && (
          <TouchableOpacity accessibilityRole="button"
            onPress={handleSubmit}
            disabled={isSubmitting || !reason.trim() || (Platform.OS === 'web' && reason.trim().length < 20)}
            style={[
              styles.submitButton,
              (isSubmitting || !reason.trim()) && styles.submitButtonDisabled,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <>
                <MaterialIcons name="report-problem" size={20} color={theme.onPrimary} />
                <Text style={styles.submitButtonText}>Open a dispute</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 48,
    backgroundColor: theme.background,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: withAlpha(theme.info, 0.15),
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: withAlpha(theme.info, 0.3),
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    color: theme.infoText,
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
  },
  sectionHint: {
    fontSize: 13,
    color: withAlpha(theme.text, 0.6),
    marginBottom: 12,
    lineHeight: 18,
  },
  validationHint: {
    fontSize: 12,
    color: theme.warningText,
    marginTop: 6,
  },
  reasonInput: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    color: theme.text,
    fontSize: 14,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.primaryLight,
  },
  evidenceList: {
    gap: 12,
    marginTop: 12,
  },
  evidenceItem: {
    backgroundColor: withAlpha(theme.primary, 0.1),
    borderRadius: 8,
    padding: 12,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  evidenceType: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.primaryLight,
    flex: 1,
  },
  removeButton: {
    padding: 4,
  },
  evidenceDescription: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 4,
  },
  evidenceContent: {
    fontSize: 12,
    color: withAlpha(theme.text, 0.8),
  },
  addEvidenceForm: {
    backgroundColor: withAlpha(theme.primary, 0.1),
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: withAlpha(theme.text, 0.8),
    marginBottom: 8,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: withAlpha(theme.primary, 0.15),
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: theme.primary,
  },
  typeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: withAlpha(theme.onPrimary, 0.6),
    textTransform: 'capitalize',
  },
  typeButtonTextActive: {
    color: theme.onPrimary,
  },
  evidenceInput: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 8,
    padding: 10,
    color: theme.text,
    fontSize: 13,
    marginBottom: 12,
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
  },
  formActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary,
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  formActionButtonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: withAlpha(theme.text, 0.3),
  },
  formActionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.onPrimary,
  },
  formActionButtonTextCancel: {
    fontSize: 13,
    fontWeight: '600',
    color: withAlpha(theme.onPrimary, 0.8),
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.error,
    padding: 16,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: withAlpha(theme.error, 0.5),
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.onPrimary,
  },
  webConfirmCard: {
    backgroundColor: withAlpha(theme.warning, 0.1),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: withAlpha(theme.warning, 0.4),
    padding: 16,
    marginBottom: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  webConfirmText: {
    color: theme.onPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  webConfirmActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  webConfirmYes: {
    flex: 1,
    backgroundColor: theme.error,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  webConfirmYesText: {
    color: theme.onPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  webConfirmNo: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: withAlpha(theme.text, 0.3),
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  webConfirmNoText: {
    color: withAlpha(theme.text, 0.8),
    fontSize: 14,
  },
});
}

export default withReplayMask(CreateDisputeScreen);
