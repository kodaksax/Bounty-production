import { MaterialIcons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { EMAIL_SUBJECTS, SUPPORT_EMAIL, SUPPORT_RESPONSE_TIMES } from '../../lib/constants/support';

/**
 * Shown when providers/auth-provider.tsx sets AuthContext.environmentError —
 * i.e. lib/config/env-guard.ts refused to connect because this bundle's
 * Supabase URL doesn't match its immutable build channel (typically a stale
 * or misconfigured OTA update). The persisted session was left untouched, so
 * this is deliberately NOT the sign-in screen: telling the user to log in
 * again here would be both misleading and pointless, since any auth attempt
 * against a blocked client would just fail the same way.
 *
 * "Try Again" reloads the app so it re-evaluates whichever bundle is current
 * (expo-updates may have already fetched a corrected one in the background
 * per the app's "check on launch" policy) without requiring a full reinstall.
 */
export default function EnvironmentErrorScreen() {
  const [isReloading, setIsReloading] = useState(false);

  const handleRetry = async () => {
    setIsReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // expo-updates unavailable (e.g. Expo Go) — nothing more we can do
      // client-side; leave the screen up so the user can contact support.
      setIsReloading(false);
    }
  };

  const handleContactSupport = () => {
    Linking.openURL(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECTS.general + ': App unable to connect')}`
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="cloud-off" size={40} color="#f59e0b" />
        </View>
        <Text style={styles.title}>Unable to Connect</Text>
        <Text style={styles.body}>
          BOUNTY couldn&apos;t verify it&apos;s talking to the right server. Your account and any
          saved session are safe — this is just a temporary update issue on this device.
        </Text>
        <Text style={styles.body}>Typical fix time: {SUPPORT_RESPONSE_TIMES.email}.</Text>

        <TouchableOpacity
          style={[styles.primaryButton, isReloading && styles.buttonDisabled]}
          onPress={handleRetry}
          disabled={isReloading}
        >
          <MaterialIcons name="refresh" size={18} color="#0B0F14" />
          <Text style={styles.primaryButtonText}>{isReloading ? 'Reloading…' : 'Try Again'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleContactSupport}>
          <Text style={styles.secondaryButtonText}>Contact Support</Text>
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
  buttonDisabled: {
    opacity: 0.6,
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
