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
import { ArrowLeft, AlertCircle, Phone, Mail, HelpCircle } from 'lucide-react-native';
import { cancellationService } from 'lib/services/cancellation-service';
import { bountyService } from 'lib/services/bounty-service';
import { useAuthContext } from 'hooks/use-auth-context';
import type { Bounty } from 'lib/services/database.types';
import { SUPPORT_EMAIL, SUPPORT_PHONE, EMAIL_SUBJECTS, createSupportTel } from 'lib/constants/support';

export default function CancellationRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;
  
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [requesterType, setRequesterType] = useState<'poster' | 'hunter'>('poster');
  
  useEffect(() => {
    loadBounty();
  }, [id]);
  
  const loadBounty = async () => {
    try {
      setLoading(true);
      const bountyData = await bountyService.getById(id);
      if (bountyData) {
        setBounty(bountyData);
        // Determine if user is poster or hunter
        if (bountyData.poster_id === userId) {
          setRequesterType('poster');
        } else if (bountyData.accepted_by === userId) {
          setRequesterType('hunter');
        }
      }
    } catch (error) {
      console.error('Error loading bounty:', error);
      Alert.alert('Error', 'Failed to load bounty details');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSubmitCancellation = async () => {
    if (!reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for cancellation');
      return;
    }
    
    if (!userId || !bounty) {
      Alert.alert('Error', 'Unable to submit cancellation request');
      return;
    }
    
    try {
      setSubmitting(true);
      
      // Calculate recommended refund percentage
      const hasAcceptedHunter = !!bounty.accepted_by;
      const recommendedRefund = cancellationService.calculateRecommendedRefund(
        bounty.status,
        hasAcceptedHunter
      );
      
      const result = await cancellationService.createCancellationRequest(
        id,
        userId,
        requesterType,
        reason,
        recommendedRefund
      );
      
      if (result) {
        Alert.alert(
          'Success',
          'Cancellation request submitted successfully',
          [
            {
              text: 'OK',
              onPress: () => router.back(),
            },
          ]
        );
      } else {
        Alert.alert('Error', 'Failed to submit cancellation request');
      }
    } catch (error) {
      console.error('Error submitting cancellation:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };
  
  const handleContactSupport = () => {
    const subject = bounty ? EMAIL_SUBJECTS.cancellation(bounty.title) : EMAIL_SUBJECTS.general;
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
  
  if (!bounty) {
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        <AlertCircle size={48} color="#dc2626" />
        <Text className="text-lg font-semibold text-gray-900 mt-4">Bounty not found</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-6 bg-emerald-600 px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Edge case: Bounty already completed - cannot cancel
  if (bounty.status === 'completed') {
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        <AlertCircle size={48} color="#f59e0b" />
        <Text className="text-lg font-semibold text-gray-900 mt-4">Cannot Cancel</Text>
        <Text className="text-gray-600 text-center mt-2">
          This bounty has already been completed. If you have an issue, please contact support for dispute resolution.
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          <TouchableOpacity
            onPress={handleContactSupport}
            className="bg-emerald-600 px-6 py-3 rounded-lg flex-row items-center justify-center"
          >
            <Mail size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Email Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCallSupport}
            className="bg-emerald-500 px-6 py-3 rounded-lg flex-row items-center justify-center"
          >
            <Phone size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Call Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            className="px-6 py-3 rounded-lg"
          >
            <Text className="text-gray-600 font-medium text-center">Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Edge case: Bounty already cancelled
  if (bounty.status === 'cancelled') {
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        <AlertCircle size={48} color="#9ca3af" />
        <Text className="text-lg font-semibold text-gray-900 mt-4">Already Cancelled</Text>
        <Text className="text-gray-600 text-center mt-2">
          This bounty has already been cancelled.
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

  // Edge case: Bounty already has pending cancellation request
  if (bounty.status === 'cancellation_requested') {
    return (
      <View className="flex-1 bg-white items-center justify-center p-6">
        <AlertCircle size={48} color="#f59e0b" />
        <Text className="text-lg font-semibold text-gray-900 mt-4">Cancellation Pending</Text>
        <Text className="text-gray-600 text-center mt-2">
          A cancellation request is already pending for this bounty. Please wait for the other party to respond.
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          <TouchableOpacity
            onPress={handleContactSupport}
            className="bg-emerald-600 px-6 py-3 rounded-lg flex-row items-center justify-center"
          >
            <HelpCircle size={18} color="white" />
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
  
  const hasAcceptedHunter = !!bounty.accepted_by;
  const recommendedRefund = cancellationService.calculateRecommendedRefund(
    bounty.status,
    hasAcceptedHunter
  );
  
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
            Request Cancellation
          </Text>
          <Text className="text-emerald-100 mt-1">
            {bounty.title}
          </Text>
        </View>
        
        {/* Content */}
        <View className="p-6">
          {/* Info Box */}
          <View className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <View className="flex-row items-start">
              <AlertCircle size={20} color="#f59e0b" />
              <View className="flex-1 ml-3">
                <Text className="text-amber-900 font-semibold mb-1">
                  Cancellation Policy
                </Text>
                <Text className="text-amber-800 text-sm">
                  {bounty.status === 'open'
                    ? 'Full refund available as no hunter has accepted this bounty yet.'
                    : hasAcceptedHunter
                    ? `Estimated refund: ${recommendedRefund}% of bounty amount ($${(bounty.amount * recommendedRefund / 100).toFixed(2)}). The other party can accept or dispute this request.`
                    : 'This request will be reviewed and the other party will be notified.'}
                </Text>
              </View>
            </View>
          </View>
          
          {/* Bounty Details */}
          <View className="bg-gray-50 rounded-lg p-4 mb-6">
            <Text className="text-sm text-gray-500 mb-1">Bounty Amount</Text>
            <Text className="text-2xl font-bold text-gray-900 mb-3">
              ${bounty.amount.toFixed(2)}
            </Text>
            <Text className="text-sm text-gray-500 mb-1">Status</Text>
            <Text className="text-base font-medium text-gray-900 capitalize">
              {bounty.status.replace('_', ' ')}
            </Text>
          </View>
          
          {/* Reason Input */}
          <View className="mb-6">
            <Text className="text-base font-semibold text-gray-900 mb-2">
              Reason for Cancellation *
            </Text>
            <Text className="text-sm text-gray-600 mb-3">
              Please explain why you want to cancel this bounty. This will be shared with the other party.
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
          
          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmitCancellation}
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
                Submit Cancellation Request
              </Text>
            )}
          </TouchableOpacity>
          
          {/* Support Contact Section */}
          <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
            <View className="flex-row items-start">
              <HelpCircle size={20} color="#3b82f6" />
              <View className="flex-1 ml-3">
                <Text className="text-blue-900 font-semibold mb-1">
                  Need Help?
                </Text>
                <Text className="text-blue-800 text-sm mb-3">
                  If you have questions about the cancellation process or need assistance with a dispute, our support team is here to help.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <TouchableOpacity
                    onPress={handleContactSupport}
                    className="flex-row items-center bg-blue-600 px-3 py-2 rounded-lg"
                  >
                    <Mail size={14} color="white" />
                    <Text className="text-white text-sm font-medium ml-1">Email</Text>
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
          
          <TouchableOpacity
            onPress={() => router.back()}
            disabled={submitting}
            className="mt-4 py-4"
          >
            <Text className="text-gray-600 text-center font-medium">
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
