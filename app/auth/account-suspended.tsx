import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthContext } from '../../hooks/use-auth-context';
import { EMAIL_SUBJECTS, SUPPORT_EMAIL, SUPPORT_RESPONSE_TIMES } from '../../lib/constants/support';

/**
 * Shown when the client-side account-status gate in providers/auth-provider.tsx
 * detects a suspended account right after sign-in / session restore and
 * force-signs the user out. See 20260726000000_enforce_account_status.sql
 * for the server-side enforcement this screen is the UX counterpart to.
 */
export default function AccountSuspendedScreen() {
  const router = useRouter();
  const { clearAccountBlockedReason } = useAuthContext();

  const handleContactSupport = () => {
    Linking.openURL(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECTS.general + ': Suspension Appeal')}`
    );
  };

  const handleBackToSignIn = () => {
    clearAccountBlockedReason?.();
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="pause-circle-outline" size={40} color="#f59e0b" />
        </View>
        <Text style={styles.title}>Account Suspended</Text>
        <Text style={styles.body}>
          Your account is temporarily suspended pending review. This is not a permanent action —
          you can appeal by contacting support.
        </Text>
        <Text style={styles.body}>Typical response time: {SUPPORT_RESPONSE_TIMES.email}.</Text>

        <TouchableOpacity style={styles.primaryButton} onPress={handleContactSupport}>
          <MaterialIcons name="mail-outline" size={18} color="#0B0F14" />
          <Text style={styles.primaryButtonText}>Contact Support</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleBackToSignIn}>
          <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F14',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    marginTop: 20,
  },
  primaryButtonText: {
    color: '#0B0F14',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  secondaryButtonText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '500',
  },
});
