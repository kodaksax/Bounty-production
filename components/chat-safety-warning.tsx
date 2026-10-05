import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { messagingStrings } from '../lib/strings/messaging';
import { trustSafetyStrings } from '../lib/strings/trust-safety';
import type { OffPlatformRisk } from '../lib/utils/off-platform-risk';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import { TrustSafetyNotice } from './ui/trust-safety-notice';

export function ChatSafetyWarning({ risk, onReport }: {
  risk: OffPlatformRisk | null;
  onReport?: () => void;
}) {
  const { theme } = useAppThemeContext();
  if (!risk) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <TrustSafetyNotice urgent message={
        onReport ? trustSafetyStrings.incomingRequest :
          risk === 'payment' ? trustSafetyStrings.paymentRequest : trustSafetyStrings.contactRequest
      } />
      {onReport && (
        <TouchableOpacity
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel={messagingStrings.reportMessage}
          style={{ padding: 12, minHeight: 44 }}
        >
          <Text style={{ color: theme.isDark ? theme.primaryLight : theme.primary, fontWeight: '600' }}>{messagingStrings.reportMessage}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
