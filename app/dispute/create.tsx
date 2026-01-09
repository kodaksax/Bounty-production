// app/dispute/create.tsx - User creates a dispute for a cancellation
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { disputeService } from '../../lib/services/dispute-service';
import { useAuthContext } from '../../hooks/use-auth-context';
import { generateEvidenceId } from '../../lib/utils/dispute-helpers';

type EvidenceItem = {
  id: string;
  type: 'text' | 'image' | 'document' | 'link';
  content: string;
  description?: string;
  uploadedAt: string;
};

export default function CreateDisputeScreen() {
  const { cancellationId, bountyId } = useLocalSearchParams<{
    cancellationId: string;
    bountyId: string;
  }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;

  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [newEvidenceType, setNewEvidenceType] = useState<'text' | 'image' | 'document' | 'link'>('text');
  const [newEvidenceContent, setNewEvidenceContent] = useState('');
  const [newEvidenceDescription, setNewEvidenceDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);

  const handleAddEvidence = () => {
    if (!newEvidenceContent.trim()) {
      Alert.alert('Error', 'Please provide evidence content');
      return;
    }

    const newEvidence: EvidenceItem = {
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
    Alert.alert('Success', 'Evidence added');
  };

  const handleRemoveEvidence = (id: string) => {
    setEvidence(evidence.filter((e) => e.id !== id));
  };

  const handleSubmit = async () => {
    if (!userId) {
      Alert.alert('Error', 'You must be logged in to create a dispute');
      return;
    }

    if (!reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for the dispute');
      return;
    }

    if (!cancellationId) {
      Alert.alert('Error', 'Missing cancellation information');
      return;
    }

    Alert.alert(
      'Confirm Dispute',
      'Are you sure you want to create a dispute? This will notify all involved parties.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Dispute',
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const dispute = await disputeService.createDispute(
                cancellationId,
                userId,
                reason,
                evidence
              );

              if (dispute) {
                // Upload evidence items to the new evidence table
                for (const ev of evidence) {
                  await disputeService.uploadEvidence(dispute.id, userId, {
                    type: ev.type,
                    content: ev.content,
                    description: ev.description,
                  });
                }

                Alert.alert(
                  'Success',
                  'Dispute created successfully. An admin will review it shortly.',
                  [
                    {
                      text: 'OK',
                      onPress: () => {
                        router.back();
                      },
                    },
                  ]
                );
              } else {
                Alert.alert('Error', 'Failed to create dispute');
              }
            } catch (error) {
              console.error('Error creating dispute:', error);
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Dispute</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={20} color="#3b82f6" />
          <Text style={styles.infoBannerText}>
            Disputes are reviewed by admins who will make a fair decision based on the evidence
            provided.
          </Text>
        </View>

        {/* Reason Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason for Dispute *</Text>
          <Text style={styles.sectionHint}>
            Explain why you're disputing this cancellation and what you believe the fair outcome
            should be.
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Describe your dispute..."
            placeholderTextColor="rgba(255,254,245,0.4)"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={styles.reasonInput}
            editable={!isSubmitting}
          />
        </View>

        {/* Evidence Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Evidence ({evidence.length})</Text>
            {!showAddEvidence && (
              <TouchableOpacity
                onPress={() => setShowAddEvidence(true)}
                style={styles.addButton}
                disabled={isSubmitting}
              >
                <MaterialIcons name="add" size={20} color="#00912C" />
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.sectionHint}>
            Provide screenshots, documents, links, or written descriptions to support your case.
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
                      color="#059669"
                    />
                    <Text style={styles.evidenceType}>{item.type.toUpperCase()}</Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveEvidence(item.id)}
                      style={styles.removeButton}
                      disabled={isSubmitting}
                    >
                      <MaterialIcons name="close" size={16} color="#ef4444" />
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
                  <TouchableOpacity
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
                placeholderTextColor="rgba(255,254,245,0.4)"
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
                    placeholderTextColor="rgba(255,254,245,0.4)"
                    style={styles.evidenceInput}
                  />
                </>
              )}

              <View style={styles.formActions}>
                <TouchableOpacity onPress={handleAddEvidence} style={styles.formActionButton}>
                  <MaterialIcons name="check" size={18} color="#fffef5" />
                  <Text style={styles.formActionButtonText}>Add Evidence</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowAddEvidence(false);
                    setNewEvidenceContent('');
                    setNewEvidenceDescription('');
                  }}
                  style={[styles.formActionButton, styles.formActionButtonCancel]}
                >
                  <Text style={styles.formActionButtonTextCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={isSubmitting || !reason.trim()}
          style={[
            styles.submitButton,
            (isSubmitting || !reason.trim()) && styles.submitButtonDisabled,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fffef5" />
          ) : (
            <>
              <MaterialIcons name="report-problem" size={20} color="#fffef5" />
              <Text style={styles.submitButtonText}>Create Dispute</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 48,
    backgroundColor: '#00912C',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fffef5',
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
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    color: '#3b82f6',
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
    color: '#fffef5',
  },
  sectionHint: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
    marginBottom: 12,
    lineHeight: 18,
  },
  reasonInput: {
    backgroundColor: 'rgba(0,145,44,0.15)',
    borderRadius: 8,
    padding: 12,
    color: '#fffef5',
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
    color: '#00912C',
  },
  evidenceList: {
    gap: 12,
    marginTop: 12,
  },
  evidenceItem: {
    backgroundColor: 'rgba(0,145,44,0.1)',
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
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    flex: 1,
  },
  removeButton: {
    padding: 4,
  },
  evidenceDescription: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 4,
  },
  evidenceContent: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.8)',
  },
  addEvidenceForm: {
    backgroundColor: 'rgba(0,145,44,0.1)',
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.8)',
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
    borderRadius: 6,
    backgroundColor: 'rgba(0,145,44,0.15)',
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#00912C',
  },
  typeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
    textTransform: 'capitalize',
  },
  typeButtonTextActive: {
    color: '#fffef5',
  },
  evidenceInput: {
    backgroundColor: 'rgba(0,145,44,0.2)',
    borderRadius: 6,
    padding: 10,
    color: '#fffef5',
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
    backgroundColor: '#00912C',
    padding: 10,
    borderRadius: 6,
    gap: 6,
  },
  formActionButtonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,254,245,0.3)',
  },
  formActionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fffef5',
  },
  formActionButtonTextCancel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.8)',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc2626',
    padding: 16,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(220,38,38,0.5)',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fffef5',
  },
});
