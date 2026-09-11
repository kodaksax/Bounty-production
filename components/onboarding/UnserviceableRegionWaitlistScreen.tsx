import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';
import { KeyboardAvoidingScreen } from '../ui/keyboard-avoiding';

type Props = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  email: string;
  onChangeEmail: (value: string) => void;
  onJoinWaitlist: () => void;
  joining: boolean;
  joined: boolean;
  error: string | null;
  countryCode?: string;
  region?: string;
  onContinue: () => void;
};

export function UnserviceableRegionWaitlistScreen({
  theme,
  styles,
  insets,
  email,
  onChangeEmail,
  onJoinWaitlist,
  joining,
  joined,
  error,
  countryCode,
  region,
  onContinue,
}: Props) {
  return (
    // The waitlist email field sits in a vertically-centred block, so the
    // screen shrinks by the keyboard and the block re-centres above it.
    <KeyboardAvoidingScreen
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: 24 },
      ]}
      offset={insets.bottom}
    >
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={styles.title}>We are not live in your region yet</Text>
        <Text style={[styles.subtitle, { marginTop: 4, marginBottom: 20 }]}>
          BOUNTY currently supports US-only transactions and payouts. Join the waitlist and we will
          reach out when your region opens.
        </Text>

        <View
          style={{
            backgroundColor: theme.surface,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 4 }}>
            Detected region
          </Text>
          <Text style={{ color: theme.textSecondary }}>
            {countryCode || 'Unknown country'}
            {region ? ` • ${region}` : ''}
          </Text>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={onChangeEmail}
          editable={!joining && !joined}
          placeholder="name@example.com"
          placeholderTextColor={theme.textDisabled}
        />

        {error ? <Text style={{ color: '#ef4444', marginTop: 8 }}>{error}</Text> : null}

        {!joined ? (
          <TouchableOpacity
            style={[styles.nextButton, { marginTop: 18, opacity: joining ? 0.7 : 1 }]}
            onPress={onJoinWaitlist}
            disabled={joining}
            accessibilityRole="button"
            accessibilityLabel="Join the waitlist"
          >
            {joining ? (
              <ActivityIndicator color="#052e1b" />
            ) : (
              <Text style={styles.nextButtonText}>Join Waitlist</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View
            style={{
              marginTop: 18,
              backgroundColor: theme.surfaceSecondary,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>You are on the waitlist.</Text>
            <Text style={{ color: theme.textSecondary, marginTop: 4 }}>
              We will email you when BOUNTY launches in your region.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.skipLink}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue to app"
        >
          <Text style={styles.skipLinkText}>Continue to app</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingScreen>
  );
}
