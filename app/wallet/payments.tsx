/**
 * Embedded Stripe Connect payments dashboard.
 *
 * Renders the `payments` Connect Embedded Component, which gives connected
 * accounts a searchable, paginated view of their payments, refunds, and
 * disputes — all inside the app, no redirects.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectEmbeddedWebView } from '../../components/connect-embedded-webview';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function PaymentsDashboardScreen() {
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Please sign in</Text>
          <Text style={styles.muted}>You must be signed in to view payments.</Text>
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
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Payments</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.webviewHost}>
        <ConnectEmbeddedWebView authToken={session.access_token} component="payments" />
      </View>
    </SafeAreaView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
    },
    title: { color: t.text, fontSize: 17, fontWeight: '600' },
    closeBtn: { padding: 4 },
    webviewHost: { flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errorTitle: { color: t.text, fontSize: 18, fontWeight: '600' },
    muted: { color: t.textSecondary, marginTop: 8, fontSize: 14 },
  });
}
