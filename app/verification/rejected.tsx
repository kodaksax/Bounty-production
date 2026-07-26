/**
 * Identity Verification — Rejected/Needs Input Screen
 * Surfaces the actionable reason from Stripe (id_verification_rejection_reason)
 * and routes back to launch.tsx to retry -- identity-create-session will
 * resume the same session if it's still in a resumable state, or start a
 * fresh one if Stripe marked it canceled.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { SPACING } from '../../lib/constants/accessibility';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const REASON_COPY: Record<string, string> = {
  document_unverified_other: "We couldn't verify your document. Please try again with a clear, well-lit photo.",
  document_expired: 'Your document appears to be expired. Please use a currently valid government-issued ID.',
  document_type_not_supported: "This document type isn't supported. Try a driver's license, passport, or national ID.",
  document_photo_mismatch: "The selfie didn't match the photo on your ID. Please try again in good lighting.",
  under_supported_age: "We couldn't verify you meet the minimum age requirement.",
  selfie_document_missing_consent_text: 'Please complete the full selfie step, including the consent screen.',
  selfie_face_mismatch: "Your selfie didn't match your ID photo. Please try again in good lighting.",
  selfie_manipulated: "Your selfie couldn't be verified as a live photo. Please try again.",
  abandoned: 'It looks like verification was closed before finishing.',
};

export default function VerificationRejectedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [reason, setReason] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const accessToken = session?.access_token;
      supabase.functions
        .invoke('identity-status', {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
        .then(({ data }) => {
          if (data?.rejectionReason) setReason(data.rejectionReason as string);
        });
    }, [session?.access_token])
  );

  const friendlyReason = (reason && REASON_COPY[reason]) || 'We were unable to complete your verification. Please try again.';

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

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="error-outline" size={48} color="#ef4444" accessibilityElementsHidden />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Let&apos;s try that again
          </Text>
          <Text style={styles.subtitle}>{friendlyReason}</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/verification/launch')}
          accessibilityRole="button"
          accessibilityLabel="Retry verification"
        >
          <MaterialIcons name="refresh" size={20} color="#052e1b" accessibilityElementsHidden />
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Do this later"
        >
          <Text style={styles.secondaryButtonText}>Not now</Text>
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
    content: { alignItems: 'center', marginTop: 40, marginBottom: SPACING.SECTION_GAP },
    iconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: 'rgba(239,68,68,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.SCREEN_HORIZONTAL,
    },
    title: { fontSize: 24, fontWeight: 'bold', color: theme.text, marginBottom: SPACING.COMPACT_GAP, textAlign: 'center' },
    subtitle: { fontSize: 15, color: theme.textSecondary, textAlign: 'center', lineHeight: 22 },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: SPACING.CARD_PADDING,
      borderRadius: 999,
      marginBottom: SPACING.ELEMENT_GAP,
      gap: SPACING.COMPACT_GAP,
    },
    primaryButtonText: { color: '#052e1b', fontSize: 18, fontWeight: 'bold' },
    secondaryButton: { alignItems: 'center', paddingVertical: SPACING.COMPACT_GAP },
    secondaryButtonText: { color: theme.textSecondary, fontSize: 15, fontWeight: '500' },
  });
}
