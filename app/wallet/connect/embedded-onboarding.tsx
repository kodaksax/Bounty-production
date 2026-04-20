/**
 * Embedded Stripe Connect onboarding screen.
 *
 * Hosts Stripe's `account-onboarding` Connect Embedded Component inside a
 * React Native WebView. The user completes KYC / bank account setup without
 * leaving the app. Authoritative state is synced from Stripe to
 * `profiles.stripe_connect_{charges,payouts}_enabled` via the
 * `account.updated` webhook. This screen also marks
 * `profiles.onboarding_complete = true` on exit as an optimistic local signal.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectEmbeddedWebView } from '../../../components/connect-embedded-webview';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { API_BASE_URL } from '../../../lib/config/api';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../lib/theme';

export default function EmbeddedOnboardingScreen() {
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthContext();
  const [verifying, setVerifying] = useState(false);

  const handleExit = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      router.replace('/tabs/wallet-screen');
      return;
    }
    try {
      setVerifying(true);
      // Optimistically mark onboarding_complete locally. The webhook will
      // confirm (or reset) this based on Stripe's authoritative state.
      const userId = session?.user?.id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({ onboarding_complete: true })
          .eq('id', userId)
          .then(() => undefined, () => undefined);
      }
      // Pull the latest status from Stripe so the wallet UI is accurate.
      await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    } finally {
      setVerifying(false);
      router.replace('/tabs/wallet-screen');
    }
  }, [router, session?.access_token, session?.user?.id]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  if (authLoading) return null;

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Please sign in</Text>
          <Text style={styles.muted}>You must be signed in to set up payouts.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeBtn}
        >
          <MaterialIcons name="close" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Set up payouts</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.webviewHost}>
        <ConnectEmbeddedWebView
          authToken={session.access_token}
          component="onboarding"
          onExit={handleExit}
        />
        {verifying ? (
          <View style={styles.overlay} pointerEvents="none">
            <Text style={styles.muted}>Finalizing…</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.muted,
    backgroundColor: colors.background.secondary,
  },
  title: { color: colors.text.primary, fontSize: 17, fontWeight: '600' },
  closeBtn: { padding: 4 },
  webviewHost: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { color: colors.text.primary, fontSize: 18, fontWeight: '600' },
  muted: { color: colors.text.secondary, marginTop: 8, fontSize: 14 },
});
