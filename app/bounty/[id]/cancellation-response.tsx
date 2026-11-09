import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, AlertCircle, CheckCircle, XCircle, HelpCircle, Phone, Mail, Flag } from 'lucide-react-native';
import { cancellationService } from 'lib/services/cancellation-service';
import { analyticsService } from 'lib/services/analytics-service';
import { failureEventProps } from 'lib/utils/stripe-error';
import { bountyPaymentsService } from 'lib/services/bounty-payments-service';
import { bountyService } from 'lib/services/bounty-service';
import { useAuthContext } from 'hooks/use-auth-context';
import { useWallet } from 'lib/wallet-context';
import { isPhase2Bounty, isStripeNativeBounty, isV3Bounty } from 'lib/utils/payment-architecture';
import type { BountyCancellation } from 'lib/types';
import type { Bounty } from 'lib/services/database.types';
import { SUPPORT_EMAIL, SUPPORT_RESPONSE_TIMES, EMAIL_SUBJECTS, createSupportTel } from 'lib/constants/support';
import { KeyboardAwareScrollView } from '../../../components/ui/keyboard-avoiding';
import { withReplayMask } from '../../../components/replay-mask';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { withAlpha } from '../../../lib/utils';

function CancellationResponseScreen() {
  const { theme } = useAppThemeContext();
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
      Alert.alert("Couldn't load cancellation request", "Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  const handleAccept = async () => {
    if (!userId || !cancellation) {
      Alert.alert("Couldn't accept cancellation", "Please try again.");
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
                  const useV2 = isPhase2Bounty(bounty);
                  const useV3 = isV3Bounty(bounty);
                  const useStripeNative = isStripeNativeBounty(bounty);
                  try {
                    await analyticsService.trackEvent('payment_architecture_routed', {
                      bountyId: String(bountyId),
                      version: useV3 ? 3 : useV2 ? 2 : 1,
                      context: 'cancel',
                    });
                  } catch {
                    /* analytics is best-effort */
                  }
                  try {
                    let result: boolean;
                    if (useStripeNative) {
                      // Stripe-native Phase 2 escrow only supports a full
                      // cancel/refund server-side; the v1-only partial
                      // refundPercentage isn't applicable here. Require a
                      // terminal v2 status before treating the cancellation as
                      // complete — refund_pending is not a settled refund.
                      const cancelResult = await bountyPaymentsService.cancelBountyPayment(String(bountyId));
                      result = cancelResult.status === 'canceled' || cancelResult.status === 'refunded';
                    } else {
                      // refundEscrow returns false on failure instead of
                      // throwing, so escrow_refunded must be gated on the result.
                      result = await refundEscrow(bountyId, title, refundPercentage);
                    }
                    try {
                      await analyticsService.trackEvent(
                        result ? 'escrow_refunded' : 'payment_failed',
                        {
                          bountyId: String(bountyId),
                          architecture: useV3 ? 'v3' : useV2 ? 'v2' : 'v1',
                          ...(result
                            ? {}
                            : { stage: 'cancel', ...failureEventProps(undefined, 'refund_incomplete') }),
                        }
                      );
                    } catch {
                      /* analytics is best-effort */
                    }
                    return result;
                  } catch (refundError) {
                    try {
                      await analyticsService.trackEvent('payment_failed', {
                        bountyId: String(bountyId),
                        architecture: useV3 ? 'v3' : useV2 ? 'v2' : 'v1',
                        stage: 'cancel',
                        ...failureEventProps(refundError),
                      });
                    } catch {
                      /* analytics is best-effort */
                    }
                    throw refundError;
                  }
                }
              );
              
              if (success) {
                Alert.alert(
                  'Success',
                  'Cancellation accepted. The bounty has been cancelled.',
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              } else {
                Alert.alert("Couldn't accept cancellation", "Please try again.");
              }
            } catch (error) {
              console.error('Error accepting cancellation:', error);
              Alert.alert("Something went wrong", 'An unexpected error occurred');
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
      Alert.alert("Something went wrong", 'Please provide a reason for rejection');
      return;
    }
    
    if (!userId || !cancellation) {
      Alert.alert("Couldn't reject cancellation", "Please try again.");
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
                Alert.alert("Couldn't reject cancellation", "Please try again.");
              }
            } catch (error) {
              console.error('Error rejecting cancellation:', error);
              Alert.alert("Something went wrong", 'An unexpected error occurred');
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
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
      </View>
    );
  }
  
  if (!bounty || !cancellation) {
    return (
      <View className="flex-1 items-center justify-center p-6" style={{ backgroundColor: theme.background }}>
        <AlertCircle size={48} color={theme.errorText} />
        <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>
          Cancellation request not found
        </Text>
        <Text className="text-center mt-2" style={{ color: theme.textSecondary }}>
          The cancellation request could not be loaded. Please contact support if you believe this is an error.
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
            onPress={() => router.back()}
            className="px-6 py-3 rounded-lg mt-3"
          >
            <Text className="font-medium text-center" style={{ color: theme.textSecondary }}>Go back</Text>
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
      <View className="flex-1 items-center justify-center p-6" style={{ backgroundColor: theme.background }}>
        {isAccepted && <CheckCircle size={48} color={theme.primaryLight} />}
        {isRejected && <XCircle size={48} color={theme.errorText} />}
        {isDisputed && <Flag size={48} color={theme.warningText} />}
        <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>
          {isAccepted && 'Cancellation Accepted'}
          {isRejected && 'Cancellation Rejected'}
          {isDisputed && 'Under Dispute'}
        </Text>
        <Text className="text-center mt-2" style={{ color: theme.textSecondary }}>
          {isAccepted && 'This cancellation request has already been accepted and the bounty has been cancelled.'}
          {isRejected && 'This cancellation request was rejected. If you disagree with this decision, you can open a dispute.'}
          {isDisputed && 'This cancellation is currently under dispute. Our support team will review and resolve it.'}
        </Text>
        <View className="mt-6 space-y-3 w-full max-w-xs">
          {isRejected && (
            <TouchableOpacity accessibilityRole="button"
              onPress={handleOpenDispute}
              className="px-6 py-3 rounded-lg flex-row items-center justify-center"
              style={{ backgroundColor: theme.warningTint }}
            >
              <Flag size={18} color={theme.warningText} />
              <Text className="font-semibold ml-2" style={{ color: theme.warningText }}>Open Dispute</Text>
            </TouchableOpacity>
          )}
          {isDisputed && (
            <TouchableOpacity accessibilityRole="button"
              onPress={handleContactSupport}
              className="bg-[#008E2A] px-6 py-3 rounded-lg flex-row items-center justify-center"
            >
              <Mail size={18} color="white" />
              <Text className="font-semibold ml-2" style={{ color: theme.onPrimary }}>Contact support</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityRole="button"
            onPress={() => router.back()}
            className="px-6 py-3 rounded-lg mt-3"
          >
            <Text className="font-medium text-center" style={{ color: theme.textSecondary }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  const refundAmount = cancellation.refundAmount ?? 
    (bounty.amount * (cancellation.refundPercentage ?? 100)) / 100;
  const acceptForeground = submitting ? theme.textSecondary : theme.onPrimary;
  
  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <KeyboardAwareScrollView className="flex-1">
        {/* Header */}
        <View className="px-4 py-6 pt-12" style={{ backgroundColor: theme.surface }}>
          <TouchableOpacity accessibilityRole="button"
            onPress={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="text-2xl font-bold" style={{ color: theme.text }}>
            Cancellation Request
          </Text>
          <Text className="mt-1" style={{ color: theme.textSecondary }}>
            {bounty.title}
          </Text>
        </View>
        
        {/* Content */}
        <View className="p-6">
          {/* Status Banner */}
          <View className="border rounded-lg p-4 mb-6" style={{ backgroundColor: theme.warningTint, borderColor: withAlpha(theme.warning, 0.4) }}>
            <View className="flex-row items-start">
              <AlertCircle size={20} color={theme.warningText} />
              <View className="flex-1 ml-3">
                <Text className="font-semibold mb-1" style={{ color: theme.warningText }}>
                  Action Required
                </Text>
                <Text className="text-sm" style={{ color: theme.warningText }}>
                  The {cancellation.requesterType} has requested to cancel this bounty. 
                  Please review the request and decide whether to accept or reject it.
                </Text>
              </View>
            </View>
          </View>
          
          {/* Cancellation Details */}
          <View className="rounded-lg p-4 mb-6" style={{ backgroundColor: theme.surface }}>
            <Text className="text-sm mb-1" style={{ color: theme.textSecondary }}>Requested By</Text>
            <Text className="text-base font-medium capitalize mb-3" style={{ color: theme.text }}>
              {cancellation.requesterType}
            </Text>
            
            <Text className="text-sm mb-1" style={{ color: theme.textSecondary }}>Reason</Text>
            <Text className="text-base mb-3" style={{ color: theme.text }}>
              {cancellation.reason}
            </Text>
            
            <Text className="text-sm mb-1" style={{ color: theme.textSecondary }}>Proposed Refund</Text>
            <Text className="text-2xl font-bold" style={{ color: theme.text }}>
              ${refundAmount.toFixed(2)}
            </Text>
            <Text className="text-sm mt-1" style={{ color: theme.textSecondary }}>
              ({cancellation.refundPercentage ?? 100}% of ${bounty.amount.toFixed(2)})
            </Text>
            {isPhase2Bounty(bounty) && (
              <Text className="text-sm mt-2" style={{ color: theme.textSecondary }}>
                Refunded automatically to the original payment method via Stripe-backed payment processing.
              </Text>
            )}
          </View>
          
          {/* Response Message */}
          <View className="mb-6">
            <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
              Your Response {action === 'reject' && '*'}
            </Text>
            <Text className="text-sm mb-3" style={{ color: theme.textSecondary }}>
              {action === 'reject' 
                ? 'Please explain why you are rejecting this request (required).'
                : 'Optional: Add a message to the requester.'}
            </Text>
            <TextInput
              value={responseMessage}
              onChangeText={setResponseMessage}
              placeholder="Enter your message..."
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              className="border rounded-lg p-3 text-base"
              style={{ color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, minHeight: 100 }}
            />
          </View>
          
          {/* Action Buttons */}
          <View className="space-y-3">
            <TouchableOpacity accessibilityRole="button"
              onPress={handleAccept}
              disabled={submitting}
              className="flex-row items-center justify-center rounded-lg py-4"
              style={{ backgroundColor: submitting ? theme.surfaceSecondary : theme.primary }}
            >
              {submitting && action === 'accept' ? (
                <ActivityIndicator color={acceptForeground} />
              ) : (
                <>
                  <CheckCircle size={20} color={acceptForeground} />
                  <Text className="text-center font-semibold text-base ml-2" style={{ color: acceptForeground }}>
                    Accept Cancellation
                  </Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity accessibilityRole="button"
              onPress={handleReject}
              disabled={submitting}
              className="flex-row items-center justify-center rounded-lg py-4 border-2"
              style={{
                backgroundColor: submitting ? theme.surfaceSecondary : theme.surface,
                borderColor: submitting ? theme.border : theme.error,
              }}
            >
              {submitting && action === 'reject' ? (
                <ActivityIndicator color={theme.errorText} />
              ) : (
                <>
                  <XCircle size={20} color={theme.errorText} />
                  <Text className="text-center font-semibold text-base ml-2" style={{ color: theme.errorText }}>
                    Reject Cancellation
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity accessibilityRole="button"
            onPress={() => router.back()}
            disabled={submitting}
            className="mt-4 py-4"
          >
            <Text className="text-center font-medium" style={{ color: theme.textSecondary }}>
              Back to Bounty
            </Text>
          </TouchableOpacity>
          
          {/* Support & Dispute Section */}
          <View className="border rounded-lg p-4 mt-4" style={{ backgroundColor: theme.infoTint, borderColor: withAlpha(theme.info, 0.4) }}>
            <View className="flex-row items-start">
              <HelpCircle size={20} color={theme.infoText} />
              <View className="flex-1 ml-3">
                <Text className="font-semibold mb-1" style={{ color: theme.infoText }}>
                  Need Help Deciding?
                </Text>
                <Text className="text-sm mb-3" style={{ color: theme.infoText }}>
                  If you
                  {"'"}
                  re unsure about your decision or feel the refund amount is unfair, contact our support team for guidance. Response time: {SUPPORT_RESPONSE_TIMES.email}.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <TouchableOpacity accessibilityRole="button"
                    onPress={handleContactSupport}
                    className="flex-row items-center bg-[#008E2A] px-3 py-2 rounded-lg"
                  >
                    <Mail size={14} color="white" />
                    <Text className="text-sm font-medium ml-1" style={{ color: theme.onPrimary }}>Email support</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button"
                    onPress={handleCallSupport}
                    className="flex-row items-center bg-[#008E2A] px-3 py-2 rounded-lg"
                  >
                    <Phone size={14} color="white" />
                    <Text className="text-sm font-medium ml-1" style={{ color: theme.onPrimary }}>Call</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

export default withReplayMask(CancellationResponseScreen);
