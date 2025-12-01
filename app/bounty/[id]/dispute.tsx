import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, AlertCircle, Upload } from 'lucide-react-native';
import { disputeService } from 'lib/services/dispute-service';
import { cancellationService } from 'lib/services/cancellation-service';
import { bountyService } from 'lib/services/bounty-service';
import { useAuthContext } from 'hooks/use-auth-context';
import type { BountyDispute, DisputeEvidence, BountyCancellation } from 'lib/types';
import type { Bounty } from 'lib/services/database.types';

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
  const [reason, setReason] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  
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
  
  const handleCreateDispute = async () => {
    if (!reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for the dispute');
      return;
    }
    
    if (!userId || !cancellation) {
      Alert.alert('Error', 'Unable to create dispute');
      return;
    }
    
    try {
      setSubmitting(true);
      
      const evidence: DisputeEvidence[] = evidenceText.trim()
        ? [{
            id: Date.now().toString(),
            type: 'text',
            content: evidenceText,
            uploadedAt: new Date().toISOString(),
          }]
        : [];
      
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
                setReason('');
                setEvidenceText('');
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
      setSubmitting(false);
    }
  };
  
  const handleAddEvidence = async () => {
    if (!evidenceText.trim() || !dispute) {
      Alert.alert('Error', 'Please provide evidence details');
      return;
    }
    
    try {
      setSubmitting(true);
      
      const newEvidence: DisputeEvidence = {
        id: Date.now().toString(),
        type: 'text',
        content: evidenceText,
        uploadedAt: new Date().toISOString(),
      };
      
      const success = await disputeService.addEvidence(dispute.id, newEvidence);
      
      if (success) {
        Alert.alert('Success', 'Evidence added successfully');
        setEvidenceText('');
        await loadData(); // Reload to show new evidence
      } else {
        Alert.alert('Error', 'Failed to add evidence');
      }
    } catch (error) {
      console.error('Error adding evidence:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };
  
  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#008e2a" />
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
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-6 bg-emerald-600 px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Go Back</Text>
        </TouchableOpacity>
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
                    color={dispute.status === 'resolved' ? '#008e2a' : '#f59e0b'} 
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
                  <TextInput
                    value={evidenceText}
                    onChangeText={setEvidenceText}
                    placeholder="Provide additional evidence..."
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    className="border border-gray-300 rounded-lg p-3 text-base text-gray-900 mb-3"
                    style={{ minHeight: 100 }}
                  />
                  <TouchableOpacity
                    onPress={handleAddEvidence}
                    disabled={submitting || !evidenceText.trim()}
                    className={`flex-row items-center justify-center rounded-lg py-3 ${
                      submitting || !evidenceText.trim()
                        ? 'bg-gray-300'
                        : 'bg-emerald-600'
                    }`}
                  >
                    {submitting ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Upload size={18} color="white" />
                        <Text className="text-white font-medium ml-2">
                          Submit Evidence
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : (
            /* Create Dispute Form */
            <>
              {/* Info Box */}
              <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <View className="flex-row items-start">
                  <AlertCircle size={20} color="#3b82f6" />
                  <View className="flex-1 ml-3">
                    <Text className="text-blue-900 font-semibold mb-1">
                      Dispute Process
                    </Text>
                    <Text className="text-blue-800 text-sm">
                      If you believe the cancellation decision is unfair, you can create a dispute. 
                      Our team will review the evidence and make a final decision.
                    </Text>
                  </View>
                </View>
              </View>
              
              {/* Reason Input */}
              <View className="mb-6">
                <Text className="text-base font-semibold text-gray-900 mb-2">
                  Reason for Dispute *
                </Text>
                <Text className="text-sm text-gray-600 mb-3">
                  Explain why you believe the cancellation decision should be reviewed.
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Enter your reason..."
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  className="border border-gray-300 rounded-lg p-3 text-base text-gray-900"
                  style={{ minHeight: 120 }}
                />
              </View>
              
              {/* Evidence Input */}
              <View className="mb-6">
                <Text className="text-base font-semibold text-gray-900 mb-2">
                  Supporting Evidence
                </Text>
                <Text className="text-sm text-gray-600 mb-3">
                  Provide any evidence that supports your case (optional but recommended).
                </Text>
                <TextInput
                  value={evidenceText}
                  onChangeText={setEvidenceText}
                  placeholder="Describe your evidence..."
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  className="border border-gray-300 rounded-lg p-3 text-base text-gray-900"
                  style={{ minHeight: 120 }}
                />
              </View>
              
              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleCreateDispute}
                disabled={submitting || !reason.trim()}
                className={`rounded-lg py-4 ${
                  submitting || !reason.trim()
                    ? 'bg-gray-300'
                    : 'bg-emerald-600'
                }`}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white text-center font-semibold text-base">
                    Submit Dispute
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
          
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
    </View>
  );
}
