/**
 * The onboarding welcome screen — see app/onboarding/welcome.tsx, which
 * renders this unconditionally. Originally the 'poster_first' arm of the
 * 'welcome-page-redesign' PostHog experiment (the control layout it won
 * against was deleted 2026-08-24 once the flag rolled out to 100% test).
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ProofCard, type ProofCardActiveItem } from './ProofCard';
import { BrandingLogo } from '../ui/branding-logo';
import { firstScreenStrings } from '../../lib/strings/firstScreen';
import type { AppTheme } from '../../lib/themes/types';

interface PosterFirstWelcomeProps {
  theme: AppTheme;
  insets: { top: number; bottom: number };
  stopped: boolean;
  onProofActiveChange: (item: ProofCardActiveItem) => void;
  onProofImpression: (item: ProofCardActiveItem) => void;
  onPosterPress: () => void;
  onHunterPress: () => void;
  onLoginPress: () => void;
  onHowItWorksPress: () => void;
}

export function PosterFirstWelcome({
  theme,
  insets,
  stopped,
  onProofActiveChange,
  onProofImpression,
  onPosterPress,
  onHunterPress,
  onLoginPress,
  onHowItWorksPress,
}: PosterFirstWelcomeProps) {
  const styles = makeStyles(theme);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.top}>
        <BrandingLogoRow />

        <Text style={styles.headline} accessibilityRole="header">
          {firstScreenStrings.headline}
        </Text>

        <View style={styles.proofCardWrap}>
          <ProofCard
            theme={theme}
            stopped={stopped}
            onActiveChange={onProofActiveChange}
            onImpression={onProofImpression}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primary }]}
          onPress={onPosterPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${firstScreenStrings.primaryCta} — post a task and hire someone nearby`}
        >
          <Text style={styles.primaryButtonText}>{firstScreenStrings.primaryCta}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onHunterPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${firstScreenStrings.secondaryCta} — browse and accept paid tasks`}
        >
          <Text style={styles.secondaryButtonText}>{firstScreenStrings.secondaryCta}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginButton}
          onPress={onLoginPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Log in to an existing account"
        >
          <Text style={styles.loginButtonText}>Log In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.howItWorksButton}
          onPress={onHowItWorksPress}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="How Bounty works — fees, escrow and disputes"
        >
          <Text style={styles.howItWorksText}>How it works — fees, escrow &amp; disputes</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// accessibilityRole overridden to "image" — BrandingLogo defaults to "header",
// which would collide with the headline text below being the real page header.
function BrandingLogoRow() {
  return <BrandingLogo size="medium" accessibilityRole="image" containerStyle={{ marginBottom: 48 }} />;
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    top: {
      alignItems: 'center',
      paddingTop: 24,
    },
    headline: {
      fontSize: 32,
      lineHeight: 38,
      fontWeight: '700',
      color: theme.text,
      letterSpacing: -0.5,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    proofCardWrap: {
      width: '100%',
      marginTop: 32,
    },
    actions: {
      flex: 1,
      justifyContent: 'flex-end',
      gap: 12,
    },
    primaryButton: {
      height: 60,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 24,
    },
    primaryButtonText: {
      fontSize: 18,
      fontWeight: '700',
      color: '#08120C',
    },
    secondaryButton: {
      height: 60,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 24,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: 'transparent',
    },
    secondaryButtonText: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
    },
    loginButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      marginHorizontal: 24,
      borderRadius: theme.radius.full,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    loginButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
    howItWorksButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      marginHorizontal: 24,
    },
    howItWorksText: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
  });
}
