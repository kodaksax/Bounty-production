/**
 * Bottom sheet a hunter opens from the "You're hired" / "Changes requested"
 * card to send their work back — the thread's reply move.
 *
 * Same backend sequence the old Work-in-progress → Review & Verify panels ran,
 * just in one step: markReady (if not already ready) then submitCompletion,
 * with the same duplicate-submission and open-dispute guards.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completionService } from 'lib/services/completion-service';
import { useAttachmentUpload } from '../../hooks/use-attachment-upload';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { KeyboardAvoidingScreen } from '../ui/keyboard-avoiding';

type ProofItem = {
  id: string;
  type: 'image' | 'file';
  name: string;
  size?: number;
  uri?: string;
  remoteUri?: string;
  mimeType?: string;
};

interface Props {
  visible: boolean;
  bountyId: string;
  bountyTitle: string;
  hunterId: string | null;
  /** A ready record already exists, so markReady can be skipped. */
  alreadyReady: boolean;
  hasDispute: boolean;
  /** Prefill from the previous submission when resubmitting after a revision. */
  initialMessage?: string;
  initialProofs?: ProofItem[];
  isResubmission?: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export function SubmitWorkSheet({
  visible,
  bountyId,
  bountyTitle,
  hunterId,
  alreadyReady,
  hasDispute,
  initialMessage,
  initialProofs,
  isResubmission,
  onClose,
  onSubmitted,
}: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [proofs, setProofs] = useState<ProofItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMessage(initialMessage ?? '');
    setProofs(initialProofs ?? []);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const { pickAttachment, isUploading, isPicking } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: `bounties/${bountyId}/proofs`,
    maxSizeMB: 20,
    allowsMultiple: true,
  });

  const addProof = async () => {
    try {
      const uploaded = await pickAttachment();
      if (!uploaded) return;
      const list = Array.isArray(uploaded) ? uploaded : [uploaded];
      setProofs(prev => [
        ...prev,
        ...list.map(u => ({
          id: u.id,
          type: u.mimeType?.startsWith('image/') ? ('image' as const) : ('file' as const),
          name: u.name,
          size: u.size,
          remoteUri: u.remoteUri,
          uri: u.uri,
          mimeType: u.mimeType,
        })),
      ]);
    } catch {
      Alert.alert('Upload failed', 'Could not add proof. Please try again.');
    }
  };

  const submit = async () => {
    if (!hunterId) {
      Alert.alert('Sign In Required', 'Your session is missing. Please sign in again and retry.');
      return;
    }
    if (hasDispute) {
      Alert.alert(
        'Submission Locked',
        'A dispute is currently open for this bounty. Submissions are paused until the dispute is resolved by an admin.'
      );
      return;
    }
    if (!message.trim()) {
      Alert.alert('Completion Message Required', 'Please add a message describing your completed work.');
      return;
    }

    const perform = async () => {
      setSubmitting(true);
      try {
        const existing = await completionService.getSubmission(bountyId);
        if (existing && existing.status === 'pending' && existing.hunter_id === String(hunterId)) {
          Alert.alert(
            'Submission Pending',
            'You already have a pending submission. Please wait for the poster to review it.'
          );
          onClose();
          onSubmitted();
          return;
        }
        if (!alreadyReady) {
          const ok = await completionService.markReady(bountyId, hunterId);
          if (!ok) throw new Error('Failed to mark ready');
        }
        const resp = await completionService.submitCompletion({
          bounty_id: bountyId,
          hunter_id: hunterId,
          message: message.trim(),
          proof_items: proofs as any,
        });
        if (!resp) throw new Error('Submission failed');
        onClose();
        onSubmitted();
      } catch (err) {
        console.error('[SubmitWorkSheet] submit failed', err);
        Alert.alert('Error', 'Failed to submit your work. Please try again.');
      } finally {
        setSubmitting(false);
      }
    };

    if (proofs.length === 0) {
      Alert.alert(
        'No Proof Attached',
        'You are submitting without any proof of completion. The poster may request revisions. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: perform },
        ]
      );
    } else {
      perform();
    }
  };

  const busyUploading = isUploading || isPicking;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop} pointerEvents="none" />
      <KeyboardAvoidingScreen style={s.sheetWrap} offset={0}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.grabber} />
          <View style={s.headerRow}>
            <View style={s.headerIcon}>
              <MaterialIcons name="upload" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{isResubmission ? 'Resubmit your work' : 'Submit your work'}</Text>
              <Text style={s.subtitle} numberOfLines={1}>
                {bountyTitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <MaterialIcons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
            <View>
              <Text style={s.fieldLabel}>What did you do?</Text>
              <TextInput
                style={s.input}
                value={message}
                onChangeText={setMessage}
                placeholder="Describe your completed work…"
                placeholderTextColor={theme.textDisabled}
                multiline
                maxLength={1000}
                textAlignVertical="top"
                accessibilityLabel="Completion message"
              />
            </View>

            <View>
              <Text style={s.fieldLabel}>Proof</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {proofs.map(p => (
                  <View key={p.id} style={s.proofTile}>
                    {p.type === 'image' && (p.remoteUri || p.uri) ? (
                      <Image source={{ uri: p.uri || p.remoteUri }} style={s.proofImage} contentFit="cover" />
                    ) : (
                      <View style={s.proofFile}>
                        <MaterialIcons name="insert-drive-file" size={26} color={theme.textSecondary} />
                        <Text style={s.proofName} numberOfLines={2}>
                          {p.name}
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={s.proofRemove}
                      onPress={() => setProofs(prev => prev.filter(x => x.id !== p.id))}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${p.name}`}
                    >
                      <MaterialIcons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  style={s.addTile}
                  onPress={addProof}
                  disabled={busyUploading}
                  accessibilityRole="button"
                  accessibilityLabel="Add proof"
                >
                  {busyUploading ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : (
                    <>
                      <MaterialIcons name="add-photo-alternate" size={26} color={theme.primary} />
                      <Text style={s.addTileText}>Add</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>

            <TouchableOpacity
              style={[s.submitBtn, (submitting || hasDispute) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting || hasDispute}
              accessibilityRole="button"
              accessibilityLabel="Send for review"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={s.submitText}>{hasDispute ? 'Locked (dispute open)' : 'Send for review'}</Text>
                  <MaterialIcons name={hasDispute ? 'lock' : 'send'} size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingScreen>
    </Modal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheetWrap: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 18,
      paddingTop: 10,
      maxHeight: '88%',
      borderWidth: 1,
      borderColor: t.border,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.border,
      marginBottom: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    headerIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: t.text, fontSize: 18, fontWeight: '800' },
    subtitle: { color: t.textSecondary, fontSize: 13, marginTop: 2 },
    fieldLabel: {
      color: t.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    input: {
      minHeight: 110,
      maxHeight: 200,
      borderRadius: 16,
      padding: 12,
      fontSize: 15,
      color: t.text,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    proofTile: {
      width: 84,
      height: 84,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    proofImage: { width: '100%', height: '100%' },
    proofFile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 },
    proofName: { color: t.textSecondary, fontSize: 10, textAlign: 'center' },
    proofRemove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addTile: {
      width: 84,
      height: 84,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    addTileText: { color: t.primary, fontSize: 12, fontWeight: '700' },
    submitBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 56,
      borderRadius: t.radius.xl,
      backgroundColor: t.primary,
      borderWidth: 1,
      borderColor: 'rgba(0,142,42,0.6)',
      ...t.shadows.brand,
      marginTop: 4,
      marginBottom: 6,
    },
    submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  });
}
