/**
 * Identity Verification — Onboarding Explainer (Step 1 of 4)
 * Explains why verification protects both posters and hunters before
 * launching Stripe Identity's verification sheet. Distinguishes this
 * ("Bounty Identity" trust badge) from Stripe Connect payout KYC, since a
 * hunter may have already gone through Connect onboarding separately.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { SPACING } from '../../lib/constants/accessibility';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const REASONS = [
  {
    icon: 'storefront' as const,
    title: 'For posters',
    body: 'Know that the hunter accepting your bounty is a real, verified person before you hand over payment.',
  },
  {
    icon: 'work' as const,
    title: 'For hunters',
    body: 'A verified badge builds trust with posters, helps your applications stand out, and unlocks faster payouts.',
  },
  {
    icon: 'shield' as const,
    title: 'For everyone',
    body: 'Verification makes it harder for scammers and fake accounts to operate on Bounty at all.',
  },
];

export default function VerificationOnboardingExplainerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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

        <OnboardingProgressDots total={4} activeIndex={0} style={styles.progressDots} />

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="verified-user" size={48} color={theme.primary} accessibilityElementsHidden />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Let&apos;s verify it&apos;s really you
          </Text>
          <Text style={styles.subtitle}>
            Bounty Identity protects everyone on the platform — posters and hunters alike.
          </Text>
        </View>

        <View style={styles.reasonsList}>
          {REASONS.map((reason) => (
            <View key={reason.title} style={styles.reasonCard}>
              <View style={styles.reasonIconCircle}>
                <MaterialIcons name={reason.icon} size={22} color={theme.primary} accessibilityElementsHidden />
              </View>
              <View style={styles.reasonText}>
                <Text style={styles.reasonTitle}>{reason.title}</Text>
                <Text style={styles.reasonBody}>{reason.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.differentiatorBox}>
          <MaterialIcons name="info-outline" size={18} color={theme.textSecondary} accessibilityElementsHidden />
          <Text style={styles.differentiatorText}>
            Already added a bank account for payouts? That&apos;s a separate Stripe check for receiving money.
            This one is about proving who you are, so it shows up as a trust badge other users can see.
          </Text>
        </View>

        <View style={styles.securityBox}>
          <MaterialIcons name="lock" size={20} color={theme.textSecondary} accessibilityElementsHidden />
          <View style={styles.securityContent}>
            <Text style={styles.securityTitle}>Your documents are protected</Text>
            <Text style={styles.securityText}>
              Your ID and selfie are encrypted, processed by Stripe (a certified identity verification
              provider), and never shown publicly. They&apos;re used only to confirm your identity — never
              for any other purpose.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/verification/launch')}
          accessibilityRole="button"
          accessibilityLabel="Continue to verification"
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#052e1b" accessibilityElementsHidden />
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
    reasonsList: { gap: SPACING.ELEMENT_GAP, marginBottom: SPACING.SECTION_GAP },
    reasonCard: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: SPACING.CARD_PADDING,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 12,
    },
    reasonIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    reasonText: { flex: 1 },
    reasonTitle: { fontSize: 15, fontWeight: '600', color: theme.text, marginBottom: 2 },
    reasonBody: { fontSize: 13, color: theme.textSecondary, lineHeight: 18 },
    differentiatorBox: {
      flexDirection: 'row',
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.ELEMENT_GAP,
      gap: 10,
      alignItems: 'flex-start',
    },
    differentiatorText: { flex: 1, fontSize: 12.5, color: theme.textSecondary, lineHeight: 18 },
    securityBox: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.SECTION_GAP,
      borderWidth: 1,
      borderColor: theme.border,
    },
    securityContent: { flex: 1, marginLeft: 12 },
    securityTitle: { fontSize: 14, fontWeight: '600', color: theme.textSecondary, marginBottom: 4 },
    securityText: { fontSize: 13, color: theme.textSecondary, lineHeight: 18 },
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
    primaryButtonText: { color: '#052e1b', fontSize: 18, fontWeight: 'bold' },
  });
}
