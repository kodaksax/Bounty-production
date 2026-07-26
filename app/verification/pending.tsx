/**
 * Identity Verification — Pending/Reviewing Screen (Step 3 of 4)
 * Polls identity-status on focus and on an interval while `processing`.
 * This is the reconciliation mechanism: re-entering this screen (app
 * backgrounded/reopened, sheet dismissed and returned to) always re-fetches
 * fresh status from the server rather than trusting any cached client state,
 * since Stripe's VerificationSession is the source of truth, not the client.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { useAuthContext } from '../../hooks/use-auth-context';
import { SPACING } from '../../lib/constants/accessibility';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

type IdentityStatus = 'unstarted' | 'requires_input' | 'processing' | 'verified' | 'canceled';

const POLL_INTERVAL_MS = 4000;

export default function VerificationPendingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const accessToken = session?.access_token;
    const { data, error } = await supabase.functions.invoke('identity-status', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (error || !data?.status) {
      setCheckFailed(true);
      return;
    }
    setCheckFailed(false);
    setStatus(data.status as IdentityStatus);
    if (data.status === 'verified') {
      router.replace('/verification/verified');
    } else if (data.status === 'requires_input' || data.status === 'canceled') {
      router.replace('/verification/rejected');
    }
  }, [session?.access_token, router]);

  useFocusEffect(
    useCallback(() => {
      fetchStatus();
      pollTimer.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
      return () => {
        if (pollTimer.current) clearInterval(pollTimer.current);
      };
    }, [fetchStatus])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        <OnboardingProgressDots total={4} activeIndex={2} style={styles.progressDots} />

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            {checkFailed ? (
              <MaterialIcons name="cloud-off" size={40} color={theme.textSecondary} accessibilityElementsHidden />
            ) : (
              <ActivityIndicator size="large" color={theme.primary} />
            )}
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {checkFailed ? "You're offline" : 'Reviewing your verification'}
          </Text>
          <Text style={styles.subtitle}>
            {checkFailed
              ? "We couldn't reach Bounty to check your status. We'll keep your progress and retry automatically."
              : status === 'processing'
                ? "Stripe is finishing up your document and selfie checks. This usually takes less than a minute."
                : "We're confirming your submission. Hang tight — this screen updates automatically."}
          </Text>
        </View>

        {checkFailed && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchStatus}
            accessibilityRole="button"
            accessibilityLabel="Check status again"
          >
            <MaterialIcons name="refresh" size={20} color={theme.primary} accessibilityElementsHidden />
            <Text style={styles.retryButtonText}>Check again</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scrollContent: { flexGrow: 1, paddingHorizontal: SPACING.SCREEN_HORIZONTAL },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: SPACING.COMPACT_GAP,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    progressDots: { marginBottom: SPACING.SECTION_GAP },
    content: { alignItems: 'center', marginTop: 40 },
    iconCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: theme.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.border,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginTop: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    },
    retryButton: {
      flexDirection: 'row',
      alignSelf: 'center',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: theme.primary,
      marginTop: SPACING.SECTION_GAP,
      gap: 8,
    },
    retryButtonText: { color: theme.primary, fontSize: 15, fontWeight: '600' },
  });
}
