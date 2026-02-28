import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { stripeService } from '../lib/services/stripe-service';
import { openUrlInBrowser } from '../lib/utils/browser';
import { colors } from '../lib/theme';

interface Props {
  userId: string;
  email: string;
  authToken?: string;
  onSuccess?: (accountId: string) => void;
  onError?: (error: Error) => void;
  label?: string;
}

export const ConnectOnboardingButton: React.FC<Props> = ({
  userId,
  email,
  authToken,
  onSuccess,
  onError,
  label = 'Set up payouts',
}) => {
  const [loading, setLoading] = useState(false);

  const startOnboarding = async () => {
    try {
      setLoading(true);
      const { accountId } = await stripeService.createConnectAccount(userId, email, authToken);
      const url = await stripeService.createConnectAccountLink(accountId, authToken);
      const opened = await openUrlInBrowser(url);
      if (!opened.success) {
        throw new Error(opened.error || 'Failed to open onboarding URL');
      }
      onSuccess?.(accountId);
    } catch (error: any) {
      console.error('[ConnectOnboardingButton] Onboarding error:', error);
      onError?.(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ width: '100%' }}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={startOnboarding}
        disabled={loading}
        style={{
          backgroundColor: colors.background.secondary, // emerald-600
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 8,
          opacity: loading ? 0.7 : 1,
          alignItems: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '600' }}>{label}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default ConnectOnboardingButton;
