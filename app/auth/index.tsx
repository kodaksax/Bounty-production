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
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function AuthIndex() {
  const router = useRouter();
  // Use default typing so values are correctly typed as string | string[].
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  // Guard so we only redirect once, even if params reference changes on re-renders.
  const redirected = useRef(false);
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;

    // Normalize each param to a single non-empty string, then build the query
    // string so the callback screen receives the same tokens / type Supabase sent.
    const qs = Object.entries(params)
      .map(([k, v]): [string, string] => {
        // Pick the first element when the router hands us an array.
        const normalized = Array.isArray(v) ? v[0] : v;
        return [k, normalized ?? ''];
      })
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const target: Href = qs ? (`/auth/callback?${qs}` as Href) : '/auth/callback';

    // Use replace so the blank index screen doesn't sit in the back-stack.
    router.replace(target);
  }, [params, router]);

  // Show a minimal loading indicator while the redirect takes effect.
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
}
