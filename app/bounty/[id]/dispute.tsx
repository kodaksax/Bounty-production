import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Modal,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, AlertCircle, Phone, Mail, HelpCircle } from 'lucide-react-native';
import { disputeService } from 'lib/services/dispute-service';
import { cancellationService } from 'lib/services/cancellation-service';
import { bountyService } from 'lib/services/bounty-service';
import { useAuthContext } from 'hooks/use-auth-context';
import { DisputeSubmissionForm } from 'components/dispute-submission-form';
import type { BountyDispute, DisputeEvidence, BountyCancellation } from 'lib/types';
import type { Bounty } from 'lib/services/database.types';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_RESPONSE_TIMES, EMAIL_SUBJECTS, createSupportTel } from 'lib/constants/support';

export default function DisputeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  
  useEffect(() => {
    loadData();
  }, [id]);
  
  const loadData = async () => {
    try {
      setLoading(true);
      const [bountyData, cancellationData] = await Promise.all([
        bountyService.getById(id),
        cancellationService.getCancellationByBountyId(id),
      ]);
      
      if (bountyData) {
        setBounty(bountyData);
      }
      
      if (cancellationData) {
        setCancellation(cancellationData);
        // Check if dispute already exists
        const existingDispute = await disputeService.getDisputeByCancellationId(cancellationData.id);
        if (existingDispute) {
          setDispute(existingDispute);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load dispute information');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCreateDispute = async (reason: string, evidence: DisputeEvidence[]) => {
    if (!userId || !cancellation) {
      throw new Error('Unable to create dispute');
    }
    
    setSubmitting(true);
    try {
      const result = await disputeService.createDispute(
        cancellation.id,
        userId,
        reason,
        evidence
      );
      
      if (result) {
        Alert.alert(
          'Success',
          'Dispute created successfully. We will review your case.',
          [
            {
              text: 'OK',
              onPress: () => {
                setDispute(result);
              },
            },
          ]
        );
      } else {
        throw new Error('Failed to create dispute');
      }
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
      const newEvidence: DisputeEvidence = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        type: 'text',
        content: evidenceText,
        uploadedAt: new Date().toISOString(),
      };
      
      const success = await disputeService.addEvidence(dispute.id, newEvidence);
      
      if (success) {
        Alert.alert('Success', 'Evidence added successfully');
        await loadData(); // Reload to show new evidence
        setShowEvidenceModal(false);
        setEvidenceInput('');
      } else {
        throw new Error('Failed to add evidence');
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
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }
  
  if (!bounty || !cancellation) {
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        <AlertCircle size={48} color="#dc2626" />
        <Text className="text-lg font-semibold text-gray-900 mt-4">
          Dispute information not found
        </Text>
        <Text className="text-gray-600 text-center mt-2">
          Unable to load the dispute information. This may occur if the bounty was not found or no cancellation request exists.
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          <TouchableOpacity
            onPress={handleContactSupport}
            className="bg-emerald-600 px-6 py-3 rounded-lg flex-row items-center justify-center"
          >
            <Mail size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Contact Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            className="px-6 py-3 rounded-lg mt-3"
          >
            <Text className="text-gray-600 font-medium text-center">Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1">
        {/* Header */}
        <View className="bg-emerald-600 px-4 py-6 pt-12">
          <TouchableOpacity
            onPress={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft size={24} color="white" />
          </TouchableOpacity>
          <Text className="text-2xl font-bold text-white">
            {dispute ? 'Dispute Details' : 'Create Dispute'}
          </Text>
          <Text className="text-emerald-100 mt-1">
            {bounty.title}
          </Text>
        </View>
        
        {/* Content */}
        <View className="p-6">
          {dispute ? (
            /* Existing Dispute View */
            <>
              {/* Status Banner */}
              <View className={`rounded-lg p-4 mb-6 ${
                dispute.status === 'resolved' 
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-amber-50 border border-amber-200'
              }`}>
                <View className="flex-row items-start">
                  <AlertCircle 
                    size={20} 
                    color={dispute.status === 'resolved' ? '#059669' : '#f59e0b'} 
                  />
                  <View className="flex-1 ml-3">
                    <Text className={`font-semibold mb-1 ${
                      dispute.status === 'resolved' ? 'text-green-900' : 'text-amber-900'
                    }`}>
                      Dispute Status: {dispute.status.replace('_', ' ').toUpperCase()}
                    </Text>
                    <Text className={
                      dispute.status === 'resolved' ? 'text-green-800' : 'text-amber-800'
                    }>
                      {dispute.status === 'resolved'
                        ? 'This dispute has been resolved.'
                        : 'Your dispute is being reviewed by our team.'}
                    </Text>
                  </View>
                </View>
              </View>
              
              {/* Dispute Details */}
              <View className="bg-gray-50 rounded-lg p-4 mb-6">
                <Text className="text-sm text-gray-500 mb-1">Reason</Text>
                <Text className="text-base text-gray-900 mb-4">
                  {dispute.reason}
                </Text>
                
                {dispute.evidence && dispute.evidence.length > 0 && (
                  <>
                    <Text className="text-sm text-gray-500 mb-2">Evidence</Text>
                    {dispute.evidence.map((ev, idx) => (
                      <View key={ev.id} className="bg-white rounded p-3 mb-2">
                        <Text className="text-sm text-gray-900">{ev.content}</Text>
                        <Text className="text-xs text-gray-500 mt-1">
                          {new Date(ev.uploadedAt).toLocaleString()}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
                
                {dispute.resolution && (
                  <>
                    <Text className="text-sm text-gray-500 mb-1 mt-4">Resolution</Text>
                    <Text className="text-base text-gray-900">
                      {dispute.resolution}
                    </Text>
                  </>
                )}
              </View>
              
              {/* Add More Evidence */}
              {dispute.status === 'open' || dispute.status === 'under_review' ? (
                <View className="mb-6">
                  <Text className="text-base font-semibold text-gray-900 mb-2">
                    Add More Evidence
                  </Text>
                  <Text className="text-sm text-gray-600 mb-3">
                    Provide additional text evidence to support your dispute. For images or documents, please contact support.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowEvidenceModal(true)}
                    className="flex-row items-center justify-center rounded-lg py-3 bg-emerald-600"
                  >
                    <Text className="text-white font-medium">
                      + Add Evidence
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : (
            /* Create Dispute Form - Using DisputeSubmissionForm component */
            <View className="flex-1">
              <DisputeSubmissionForm
                bountyTitle={bounty.title}
                onSubmit={handleCreateDispute}
                isSubmitting={submitting}
                showGuidance={true}
              />
            </View>
          )}
          
          {/* Support Contact Section - Always visible */}
          <View className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mt-6">
            <View className="flex-row items-start">
              <HelpCircle size={20} color="#059669" />
              <View className="flex-1 ml-3">
                <Text className="text-emerald-900 font-semibold mb-1">
                  Dispute Mediation Support
                </Text>
                <Text className="text-emerald-800 text-sm mb-2">
                  Our support team typically responds within {SUPPORT_RESPONSE_TIMES.dispute}. For urgent matters, please call us directly.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <TouchableOpacity
                    onPress={handleContactSupport}
                    className="flex-row items-center bg-emerald-600 px-3 py-2 rounded-lg"
                  >
                    <Mail size={14} color="white" />
                    <Text className="text-white text-sm font-medium ml-1">{SUPPORT_EMAIL}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCallSupport}
                    className="flex-row items-center bg-emerald-500 px-3 py-2 rounded-lg"
                  >
                    <Phone size={14} color="white" />
                    <Text className="text-white text-sm font-medium ml-1">{SUPPORT_PHONE}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
          
          <TouchableOpacity
            onPress={() => router.back()}
            disabled={submitting}
            className="mt-4 py-4"
          >
            <Text className="text-gray-600 text-center font-medium">
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Evidence Modal */}
      <Modal
        visible={showEvidenceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEvidenceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Evidence</Text>
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
              <TouchableOpacity
                onPress={handleSubmitEvidence}
                disabled={submitting || !evidenceInput.trim()}
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  (submitting || !evidenceInput.trim()) && styles.modalButtonDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text style={styles.modalButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
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

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
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
    backgroundColor: '#059669',
  },
  modalButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  modalButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextSecondary: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
  },
});
