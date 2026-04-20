import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';

interface Props {
  /** @deprecated Not required for embedded onboarding; retained for API compatibility. */
  userId?: string;
  /** @deprecated Not required for embedded onboarding; retained for API compatibility. */
  email?: string;
  /** @deprecated Not required for embedded onboarding; retained for API compatibility. */
  authToken?: string;
  /** @deprecated Not invoked in embedded mode; exit is handled by the onboarding screen itself. */
  onSuccess?: (accountId: string) => void;
  onError?: (error: Error) => void;
  label?: string;
}

export const ConnectOnboardingButton: React.FC<Props> = ({ onError, label = 'Set up payouts' }) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const startOnboarding = () => {
    try {
      setLoading(true);
      // Embedded onboarding runs inside the app; no browser redirect.
      router.push('/wallet/connect/embedded-onboarding');
    } catch (error: unknown) {
      console.error('[ConnectOnboardingButton] Onboarding error:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
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
          backgroundColor: '#059669', // emerald-600
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
