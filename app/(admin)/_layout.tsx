// app/(admin)/_layout.tsx - Layout for admin route group with gating
//
// The admin group used to paint itself `#1a3d2e` (a legacy dark green) while
// AdminHeader had already moved to the canonical dark surface, so every admin
// screen rendered a navy header on a green body. Both now come from the app
// theme, which also means the console follows light mode like the rest of the
// product instead of being permanently dark green.
import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdmin } from '../../lib/admin-context';
import useScreenBackground from '../../lib/hooks/useScreenBackground';

export default function AdminLayout() {
  const { isAdmin, isLoading } = useAdmin();
  const { theme } = useAppTheme();

  // Match the safe-area background to the themed screen background.
  useScreenBackground(theme.background);

  // Show loading while checking admin status
  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
          Checking permissions…
        </Text>
      </View>
    );
  }

  // Redirect if not admin.
  //
  // This is a UX guard only: it keeps a non-admin from landing on a screen
  // that would fail every query anyway. It is NOT the authorization boundary.
  // Every admin read goes through RLS or the service-role Edge Functions
  // (admin-profiles / admin-withdrawals / admin-review-id), each of which
  // re-verifies `app_metadata.role === 'admin'` on the JWT server-side, so
  // removing this redirect would not grant anyone data access.
  if (!isAdmin) {
    return <Redirect href="/tabs/bounty-app" />;
  }

  // Render admin screens if authorized
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
        animation: 'slide_from_right',
      }}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
  },
});
