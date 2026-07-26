/**
 * Identity Verification — Verified Screen (Step 4 of 4)
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { TrustIndicators } from '../../components/ui/trust-indicators';
import { useAuthContext } from '../../hooks/use-auth-context';
import { SPACING } from '../../lib/constants/accessibility';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function VerificationVerifiedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [verifiedSince, setVerifiedSince] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const accessToken = session?.access_token;
      supabase.functions
        .invoke('identity-status', {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
        .then(({ data }) => {
          if (data?.verifiedSince) setVerifiedSince(data.verifiedSince as string);
        });
    }, [session?.access_token])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        <OnboardingProgressDots total={4} activeIndex={3} style={styles.progressDots} />

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="verified" size={56} color="#059669" accessibilityElementsHidden />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            You&apos;re verified!
          </Text>
          <Text style={styles.subtitle}>
            Your identity badge is now visible to posters and hunters across Bounty.
          </Text>
        </View>

        <TrustIndicators verifiedSince={verifiedSince} />

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.primaryButtonText}>Done</Text>
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
    progressDots: { marginBottom: SPACING.SECTION_GAP },
    content: { alignItems: 'center', marginBottom: SPACING.SECTION_GAP },
    iconCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: 'rgba(5,150,105,0.12)',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.SCREEN_HORIZONTAL,
    },
    title: { fontSize: 26, fontWeight: 'bold', color: theme.text, marginBottom: SPACING.COMPACT_GAP, textAlign: 'center' },
    subtitle: { fontSize: 15, color: theme.textSecondary, textAlign: 'center', lineHeight: 22 },
    primaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: SPACING.CARD_PADDING,
      borderRadius: 999,
      marginTop: SPACING.SECTION_GAP,
    },
    primaryButtonText: { color: '#052e1b', fontSize: 18, fontWeight: 'bold' },
  });
}
