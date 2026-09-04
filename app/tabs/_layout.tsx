// app/tabs/_layout.tsx - Layout for the authenticated app route group with gating
//
// Before this file existed the only auth gate lived in app/index.tsx, which
// runs solely when a visitor lands on "/". Deep-linking straight to a route in
// this group (/tabs/wallet-screen, /tabs/postings-screen, …) bypassed it
// entirely and painted the signed-in shell to a visitor with no session — a
// wallet reading $0.00, an empty postings list, a profile shell. No data
// leaked (every request is anonymous and RLS returns 401 / zero rows), but the
// screen is misleading and non-functional.
//
// This mirrors app/(admin)/_layout.tsx: a UX guard only. It keeps a
// session-less visitor off a screen whose every query would fail anyway and
// hands them back to the root auth gate, which knows whether to show
// onboarding, the sign-in form, or an account-blocked / environment-error
// screen. It is NOT the authorization boundary — that is RLS plus the
// service-role Edge Functions, all of which re-verify the JWT server-side.
//
// Why Stack and not Tabs: this segment is not an expo-router tab navigator.
// The bottom tab bar is a custom <BottomNav> rendered inside
// app/tabs/bounty-app.tsx that switches the visible screen via local state
// without changing the route (see the ScreenTracker note in app/_layout.tsx).
// With no _layout here expo-router was already synthesising a Stack for the
// segment; this file makes that explicit and adds the guard, matching
// app/(admin)/_layout.tsx. Rendering <Tabs> instead would inject a second,
// real tab bar.
import type { Href } from 'expo-router';
import { Redirect, Stack, usePathname } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAuthContext } from '../../hooks/use-auth-context';
import useScreenBackground from '../../lib/hooks/useScreenBackground';

export default function TabsLayout() {
  const {
    isLoading,
    isLoggedIn,
    isPasswordRecovery,
    accountBlockedReason,
    environmentError,
  } = useAuthContext();
  const { theme } = useAppTheme();
  const pathname = usePathname();

  // Match the safe-area background to the themed screen background.
  useScreenBackground(theme.background);

  // Still resolving the persisted session — hold on a spinner rather than
  // flashing either the shell or a redirect.
  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading…</Text>
      </View>
    );
  }

  // A recovery session or a blocked/misconfigured client must never render the
  // tab shell, and there is no meaningful screen to return to afterwards —
  // bounce straight to the root gate, which routes to update-password /
  // account-banned / account-suspended / environment-error.
  if (isPasswordRecovery || accountBlockedReason || environmentError) {
    return <Redirect href="/" />;
  }

  // Plain logged-out visitor: hand back to the root gate (app/index.tsx) but
  // carry the path they were trying to reach, so it can send them there once
  // they finish signing in instead of dumping everyone on the home feed. Only
  // in-app "/tabs/…" paths are ever produced here and index.tsx re-validates
  // before using it.
  if (!isLoggedIn) {
    const target =
      pathname && pathname.startsWith('/tabs/')
        ? (`/?redirect_to=${encodeURIComponent(pathname)}` as Href)
        : '/';
    return <Redirect href={target} />;
  }

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
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
});
