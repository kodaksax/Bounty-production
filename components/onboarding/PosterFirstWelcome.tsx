/**
 * poster_first variant of the onboarding welcome screen — see
 * app/onboarding/welcome.tsx (which resolves the first_screen_variant flag
 * and picks between this component and the original control layout) and
 * lib/experiments/first-screen-variant.ts.
 *
 * Brand green lives on the Poster CTA here (inverted from the control
 * screen, where it's on the Hunter CTA) — that inversion is the point of
 * this variant.
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
      </View>
    </View>
  );
}

// size="large" matches what the control screen renders — the spec keeps the
// wordmark unchanged and only respaces it (48px gap below, per §1).
//
// accessibilityRole overridden to "image" — BrandingLogo defaults to "header",
// which would collide with the headline text below being the real page header.
function BrandingLogoRow() {
  return <BrandingLogo size="large" accessibilityRole="image" containerStyle={{ marginBottom: 48 }} />;
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
      // Spec calls for rgba(255,255,255,0.25) — a hairline of the foreground,
      // not theme.border (#374151), which reads as a solid slab next to the
      // filled primary and flattens the visual hierarchy the inversion depends
      // on. Mirrored for light mode so the outline survives a theme toggle.
      borderColor: theme.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
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
  });
}
