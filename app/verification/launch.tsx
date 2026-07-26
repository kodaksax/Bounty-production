/**
 * Identity Verification — Launch Screen (Step 2 of 4)
 * Creates/resumes a Stripe Identity VerificationSession and presents Stripe's
 * own themed verification sheet (@stripe/stripe-identity-react-native). The
 * actual document/liveness capture UI belongs to Stripe -- this screen only
 * themes it (brand logo) and handles the surrounding retry/offline/routing.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useStripeIdentity } from '@stripe/stripe-identity-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { useAuthContext } from '../../hooks/use-auth-context';
import { SPACING } from '../../lib/constants/accessibility';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { getNetworkErrorMessage } from '../../lib/utils/network-connectivity';

export default function VerificationLaunchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetches a session/ephemeral-key from identity-create-session. If an
  // in-flight session already exists for this user, the edge function
  // reuses it instead of creating a duplicate -- this is what lets re-entry
  // resume rather than restart.
  const optionsProvider = useCallback(async () => {
    const accessToken = session?.access_token;
    const { data, error } = await supabase.functions.invoke('identity-create-session', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (error || !data?.sessionId || !data?.ephemeralKeySecret) {
      throw new Error(error?.message ?? 'Failed to start verification');
    }
    return {
      sessionId: data.sessionId as string,
      ephemeralKeySecret: data.ephemeralKeySecret as string,
      brandLogo: Image.resolveAssetSource(require('../../assets/images/bounty-logo2.png')),
    };
  }, [session?.access_token]);

  const { present, loading } = useStripeIdentity(optionsProvider);

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    setStarting(true);
    try {
      await present();
      // present() resolves once the sheet is dismissed one way or another.
      // We don't trust its local status as authoritative -- Stripe's webhook
      // is the source of truth -- so always route to pending.tsx and let it
      // reconcile via identity-status. This also covers the "sheet errored"
      // and "user canceled" cases without special-casing them here: pending.tsx
      // shows a retry CTA if status comes back requires_input/canceled.
      router.replace('/verification/pending');
    } catch (err) {
      setErrorMessage(getNetworkErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }, [present, router]);

  const isBusy = starting || loading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} accessibilityElementsHidden />
          </TouchableOpacity>
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        <OnboardingProgressDots total={4} activeIndex={1} style={styles.progressDots} />

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="camera-alt" size={48} color={theme.primary} accessibilityElementsHidden />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Ready when you are
          </Text>
          <Text style={styles.subtitle}>
            You&apos;ll need a government-issued ID (driver&apos;s license, passport, or national ID) and
            good lighting for a quick selfie video.
          </Text>
        </View>

        <View style={styles.tipsList}>
          <View style={styles.tipRow}>
            <MaterialIcons name="wb-sunny" size={18} color="#fbbf24" accessibilityElementsHidden />
            <Text style={styles.tipText}>Find a well-lit spot without glare on your ID</Text>
          </View>
          <View style={styles.tipRow}>
            <MaterialIcons name="crop-free" size={18} color={theme.primary} accessibilityElementsHidden />
            <Text style={styles.tipText}>Hold your device steady — it captures automatically</Text>
          </View>
          <View style={styles.tipRow}>
            <MaterialIcons name="face" size={18} color={theme.primary} accessibilityElementsHidden />
            <Text style={styles.tipText}>Be ready to smile and turn your head for the selfie check</Text>
          </View>
        </View>

        {errorMessage && (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={18} color="#ef4444" accessibilityElementsHidden />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={isBusy ? 'Starting verification' : 'Start verification'}
          accessibilityState={{ disabled: isBusy }}
        >
          <Text style={styles.primaryButtonText}>
            {isBusy ? 'Starting…' : errorMessage ? 'Try again' : 'Start verification'}
          </Text>
          {!isBusy && <MaterialIcons name="arrow-forward" size={20} color="#052e1b" accessibilityElementsHidden />}
        </TouchableOpacity>
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
    backButton: { padding: SPACING.COMPACT_GAP },
    progressDots: { marginBottom: SPACING.SECTION_GAP },
    content: { alignItems: 'center', marginBottom: 24 },
    iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.border,
    },
    title: {
      fontSize: 26,
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
    tipsList: { gap: SPACING.ELEMENT_GAP, marginBottom: SPACING.SECTION_GAP },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 10,
    },
    tipText: { flex: 1, fontSize: 13.5, color: theme.text },
    errorBox: {
      flexDirection: 'row',
      backgroundColor: 'rgba(239,68,68,0.1)',
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.ELEMENT_GAP,
      gap: 10,
      alignItems: 'flex-start',
    },
    errorText: { flex: 1, fontSize: 13, color: '#ef4444', lineHeight: 18 },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: SPACING.CARD_PADDING,
      borderRadius: 999,
      marginBottom: SPACING.SCREEN_HORIZONTAL,
      gap: SPACING.COMPACT_GAP,
    },
    buttonDisabled: { opacity: 0.5 },
    primaryButtonText: { color: '#052e1b', fontSize: 18, fontWeight: 'bold' },
  });
}
