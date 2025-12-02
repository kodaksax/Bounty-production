import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, AlertCircle, CheckCircle, XCircle, HelpCircle, Phone, Mail, Flag } from 'lucide-react-native';
import { cancellationService } from 'lib/services/cancellation-service';
import { bountyService } from 'lib/services/bounty-service';
import { useAuthContext } from 'hooks/use-auth-context';
import { useWallet } from 'lib/wallet-context';
import type { BountyCancellation } from 'lib/types';
import type { Bounty } from 'lib/services/database.types';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_RESPONSE_TIMES, EMAIL_SUBJECTS, createSupportTel } from 'lib/constants/support';

export default function CancellationResponseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;
  const { refundEscrow } = useWallet();
  
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [cancellation, setCancellation] = useState<BountyCancellation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [responseMessage, setResponseMessage] = useState('');
  const [action, setAction] = useState<'accept' | 'reject' | null>(null);
  
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
      }
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load cancellation request');
    } finally {
      setLoading(false);
    }
  };
  
  const handleAccept = async () => {
    if (!userId || !cancellation) {
      Alert.alert('Error', 'Unable to accept cancellation');
      return;
    }
    
    Alert.alert(
      'Accept Cancellation',
      'Are you sure you want to accept this cancellation request? The bounty will be cancelled and refunds will be processed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              setSubmitting(true);
              setAction('accept');
              
              const success = await cancellationService.acceptCancellation(
                cancellation.id,
                userId,
                responseMessage || undefined,
                async (bountyId: string, title: string, refundPercentage: number) => {
                  // Process wallet refund
                  return await refundEscrow(bountyId, title, refundPercentage);
                }
              );
              
              if (success) {
                Alert.alert(
                  'Success',
                  'Cancellation accepted. The bounty has been cancelled.',
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              } else {
                Alert.alert('Error', 'Failed to accept cancellation');
              }
            } catch (error) {
              console.error('Error accepting cancellation:', error);
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
              setSubmitting(false);
              setAction(null);
            }
          },
        },
      ]
    );
  };
  
  const handleReject = async () => {
    if (!responseMessage.trim()) {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }
    
    if (!userId || !cancellation) {
      Alert.alert('Error', 'Unable to reject cancellation');
      return;
    }
    
    Alert.alert(
      'Reject Cancellation',
      'Are you sure you want to reject this cancellation request? The bounty will continue as normal.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              setSubmitting(true);
              setAction('reject');
              
              const success = await cancellationService.rejectCancellation(
                cancellation.id,
                userId,
                responseMessage
              );
              
              if (success) {
                Alert.alert(
                  'Success',
                  'Cancellation rejected. The bounty will continue.',
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              } else {
                Alert.alert('Error', 'Failed to reject cancellation');
              }
            } catch (error) {
              console.error('Error rejecting cancellation:', error);
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
              setSubmitting(false);
              setAction(null);
            }
          },
        },
      ]
    );
  };

  const handleContactSupport = () => {
    const subject = bounty ? EMAIL_SUBJECTS.cancellation(bounty.title) : EMAIL_SUBJECTS.general;
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`);
  };

  const handleCallSupport = () => {
    Linking.openURL(createSupportTel());
  };

  const handleOpenDispute = () => {
    router.push(`/bounty/${id}/dispute`);
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
          Cancellation request not found
        </Text>
        <Text className="text-gray-600 text-center mt-2">
          The cancellation request could not be loaded. Please contact support if you believe this is an error.
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

  // Edge case: Cancellation already resolved
  if (cancellation.status !== 'pending') {
    const isAccepted = cancellation.status === 'accepted';
    const isRejected = cancellation.status === 'rejected';
    const isDisputed = cancellation.status === 'disputed';
    
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        {isAccepted && <CheckCircle size={48} color="#059669" />}
        {isRejected && <XCircle size={48} color="#dc2626" />}
        {isDisputed && <Flag size={48} color="#f59e0b" />}
        <Text className="text-lg font-semibold text-gray-900 mt-4">
          {isAccepted && 'Cancellation Accepted'}
          {isRejected && 'Cancellation Rejected'}
          {isDisputed && 'Under Dispute'}
        </Text>
        <Text className="text-gray-600 text-center mt-2">
          {isAccepted && 'This cancellation request has already been accepted and the bounty has been cancelled.'}
          {isRejected && 'This cancellation request was rejected. If you disagree with this decision, you can open a dispute.'}
          {isDisputed && 'This cancellation is currently under dispute. Our support team will review and resolve it.'}
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          {isRejected && (
            <TouchableOpacity
              onPress={handleOpenDispute}
              className="bg-amber-600 px-6 py-3 rounded-lg flex-row items-center justify-center"
            >
              <Flag size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Open Dispute</Text>
            </TouchableOpacity>
          )}
          {isDisputed && (
            <TouchableOpacity
              onPress={handleContactSupport}
              className="bg-emerald-600 px-6 py-3 rounded-lg flex-row items-center justify-center"
            >
              <Mail size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Contact Support</Text>
            </TouchableOpacity>
          )}
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
  
  const refundAmount = cancellation.refundAmount ?? 
    (bounty.amount * (cancellation.refundPercentage ?? 100)) / 100;
  
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
            Cancellation Request
          </Text>
          <Text className="text-emerald-100 mt-1">
            {bounty.title}
          </Text>
        </View>
        
        {/* Content */}
        <View className="p-6">
          {/* Status Banner */}
          <View className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <View className="flex-row items-start">
              <AlertCircle size={20} color="#f59e0b" />
              <View className="flex-1 ml-3">
                <Text className="text-amber-900 font-semibold mb-1">
                  Action Required
                </Text>
                <Text className="text-amber-800 text-sm">
                  The {cancellation.requesterType} has requested to cancel this bounty. 
                  Please review the request and decide whether to accept or reject it.
                </Text>
              </View>
            </View>
          </View>
          
          {/* Cancellation Details */}
          <View className="bg-gray-50 rounded-lg p-4 mb-6">
            <Text className="text-sm text-gray-500 mb-1">Requested By</Text>
            <Text className="text-base font-medium text-gray-900 capitalize mb-3">
              {cancellation.requesterType}
            </Text>
            
            <Text className="text-sm text-gray-500 mb-1">Reason</Text>
            <Text className="text-base text-gray-900 mb-3">
              {cancellation.reason}
            </Text>
            
            <Text className="text-sm text-gray-500 mb-1">Proposed Refund</Text>
            <Text className="text-2xl font-bold text-gray-900">
              ${refundAmount.toFixed(2)}
            </Text>
            <Text className="text-sm text-gray-500 mt-1">
              ({cancellation.refundPercentage ?? 100}% of ${bounty.amount.toFixed(2)})
            </Text>
          </View>
          
          {/* Response Message */}
          <View className="mb-6">
            <Text className="text-base font-semibold text-gray-900 mb-2">
              Your Response {action === 'reject' && '*'}
            </Text>
            <Text className="text-sm text-gray-600 mb-3">
              {action === 'reject' 
                ? 'Please explain why you are rejecting this request (required).'
                : 'Optional: Add a message to the requester.'}
            </Text>
            <TextInput
              value={responseMessage}
              onChangeText={setResponseMessage}
              placeholder="Enter your message..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              className="border border-gray-300 rounded-lg p-3 text-base text-gray-900"
              style={{ minHeight: 100 }}
            />
          </View>
          
          {/* Action Buttons */}
          <View className="space-y-3">
            <TouchableOpacity
              onPress={handleAccept}
              disabled={submitting}
              className={`flex-row items-center justify-center rounded-lg py-4 ${
                submitting ? 'bg-gray-300' : 'bg-emerald-600'
              }`}
            >
              {submitting && action === 'accept' ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <CheckCircle size={20} color="white" />
                  <Text className="text-white text-center font-semibold text-base ml-2">
                    Accept Cancellation
                  </Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleReject}
              disabled={submitting}
              className={`flex-row items-center justify-center rounded-lg py-4 border-2 ${
                submitting ? 'bg-gray-100 border-gray-300' : 'bg-white border-red-600'
              }`}
            >
              {submitting && action === 'reject' ? (
                <ActivityIndicator color="#dc2626" />
              ) : (
                <>
                  <XCircle size={20} color="#dc2626" />
                  <Text className="text-red-600 text-center font-semibold text-base ml-2">
                    Reject Cancellation
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity
            onPress={() => router.back()}
            disabled={submitting}
            className="mt-4 py-4"
          >
            <Text className="text-gray-600 text-center font-medium">
              Back to Bounty
            </Text>
          </TouchableOpacity>
          
          {/* Support & Dispute Section */}
          <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <View className="flex-row items-start">
              <HelpCircle size={20} color="#3b82f6" />
              <View className="flex-1 ml-3">
                <Text className="text-blue-900 font-semibold mb-1">
                  Need Help Deciding?
                </Text>
                <Text className="text-blue-800 text-sm mb-3">
                  If you're unsure about your decision or feel the refund amount is unfair, contact our support team for guidance. Response time: {SUPPORT_RESPONSE_TIMES.email}.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <TouchableOpacity
                    onPress={handleContactSupport}
                    className="flex-row items-center bg-blue-600 px-3 py-2 rounded-lg"
                  >
                    <Mail size={14} color="white" />
                    <Text className="text-white text-sm font-medium ml-1">Email Support</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCallSupport}
                    className="flex-row items-center bg-blue-500 px-3 py-2 rounded-lg"
                  >
                    <Phone size={14} color="white" />
                    <Text className="text-white text-sm font-medium ml-1">Call</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
