/**
 * Auth Index Route — Deep Link Entry Point
 *
 * Supabase magic links (and some other auth emails) redirect to
 * `bountyexpo-workspace://auth` (the bare `/auth` path) rather than
 * `bountyexpo-workspace://auth/callback`.
 *
 * This screen catches that unmatched route and immediately forwards the
 * user — with all incoming query / hash-fragment params preserved — to
 * the real auth-callback handler at `/auth/callback`.
 */

import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function AuthIndex() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  // Guard so we only redirect once, even if params reference changes on re-renders.
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;

    // Build a query string from every param that was supplied so the
    // callback screen receives the same tokens / type that Supabase sent.
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    const qs = entries
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v[0] : v)}`,
      )
      .join('&');

    const target: Href = qs ? (`/auth/callback?${qs}` as Href) : '/auth/callback';

    // Use replace so the blank index screen doesn't sit in the back-stack.
    router.replace(target);
  }, [params, router]);

  // Show a minimal loading indicator while the redirect takes effect.
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#a7f3d0" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
