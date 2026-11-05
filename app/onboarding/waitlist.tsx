/**
 * Onboarding Waitlist Screen (unserviceable region)
 *
 * Pushed by the location step (app/onboarding/location.tsx) instead of role
 * select when the geocoder puts the user in a country outside
 * SERVICEABLE_COUNTRY_CODES (lib/utils/serviceable-region.ts). It asks for an
 * email so we can tell them when Bounty opens there, and is never a wall:
 * both "Continue anyway" and the post-submit "Continue" go on to role select.
 *
 * There is deliberately no backend. Submitting fires `waitlist_captured` with
 * the email as a PostHog-only person property (`waitlist_email`, via $set);
 * a PostHog destination on that event notifies the owner. The
 * region_waitlist_signups table (migration 20260808010000) is the place to
 * persist these if the list outgrows PostHog.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingScreen } from '../../components/ui/keyboard-avoiding';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { palette } from '../../lib/themes/colors';
import type { AppTheme } from '../../lib/themes/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidWaitlistEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** "GB" -> "the United Kingdom"-style display name, or null if unavailable. */
function countryDisplayName(countryCode: string): string | null {
  try {
    const DisplayNames = (Intl as unknown as { DisplayNames?: any }).DisplayNames;
    if (!DisplayNames) return null;
    const name = new DisplayNames(['en'], { type: 'region' }).of(countryCode);
    return typeof name === 'string' && name !== countryCode ? name : null;
  } catch {
    return null;
  }
}

export default function WaitlistScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { session } = useAuthContext();
  const { data: onboardingData } = useOnboarding();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const params = useLocalSearchParams<{ country_code?: string; region?: string }>();
  const countryCode = (params.country_code ?? '').toUpperCase() || undefined;
  const region = params.region || undefined;
  const countryName = countryCode ? countryDisplayName(countryCode) : null;
  const placeLabel = countryName ?? 'your area';

  const [email, setEmail] = useState<string>(session?.user?.email ?? '');
  const [showError, setShowError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const baseProps = {
    country_code: countryCode,
    region,
    intent: onboardingData.intent ?? 'none',
    source: 'onboarding_location',
  };

  useEffect(() => {
    analyticsService.trackEvent('unserviceable_region_shown', baseProps);
    // Fire once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    if (submitted) return;
    const trimmed = email.trim().toLowerCase();
    if (!isValidWaitlistEmail(trimmed)) {
      hapticFeedback.error();
      setShowError(true);
      return;
    }
    hapticFeedback.success();
    analyticsService.trackEvent(
      'waitlist_captured',
      {
        ...baseProps,
        is_signed_in: !!session?.user?.id,
        email_matches_account:
          !!session?.user?.email && session.user.email.toLowerCase() === trimmed,
      },
      {
        setPersonProperties: {
          waitlist_email: trimmed,
          waitlist_country_code: countryCode,
          waitlist_region: region,
          waitlist_captured_at: new Date().toISOString(),
        },
      }
    );
    setEmail(trimmed);
    setSubmitted(true);
  };

  const handleContinue = () => {
    hapticFeedback.light();
    if (!submitted) {
      analyticsService.trackEvent('unserviceable_region_continued', baseProps);
    }
    router.push('/onboarding/role-select');
  };

  const handleBack = () => {
    hapticFeedback.light();
    router.back();
  };

  return (
    <KeyboardAvoidingScreen style={styles.flex} offset={insets.bottom}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.backRow}>
          {router.canGoBack() && (
            <TouchableOpacity
              onPress={handleBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.hero}>
          <View style={styles.iconBadge}>
            <MaterialIcons
              name={submitted ? 'mark-email-read' : 'public'}
              size={44}
              color={theme.primary}
            />
          </View>
        </View>

        {submitted ? (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              You&apos;re on the list
            </Text>
            <Text style={styles.subheading}>
              We&apos;ll email {email} when Bounty opens in {placeLabel}. You can still look around
              in the meantime.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              Bounty isn&apos;t in {placeLabel} yet
            </Text>
            <Text style={styles.subheading}>
              We&apos;re live in the US for now. Leave your email and we&apos;ll let you know as
              soon as bounties open near you.
            </Text>

            <TextInput
              value={email}
              onChangeText={text => {
                setEmail(text);
                if (showError) setShowError(false);
              }}
              placeholder="you@example.com"
              placeholderTextColor={theme.textDisabled}
              style={[styles.input, showError && styles.inputError]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              accessibilityLabel="Email address"
            />
            {showError && (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                Enter a valid email address.
              </Text>
            )}
          </>
        )}

        <View style={styles.spacer} />

        <View style={styles.actionContainer}>
          {submitted ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleContinue}
              accessibilityRole="button"
              accessibilityLabel="Continue"
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSubmit}
                accessibilityRole="button"
                accessibilityLabel="Notify me"
              >
                <Text style={styles.primaryButtonText}>Notify me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipLink}
                onPress={handleContinue}
                accessibilityRole="button"
                accessibilityLabel="Continue anyway"
              >
                <Text style={styles.skipLinkText}>Continue anyway</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingScreen>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 24,
    },
    backRow: {
      paddingTop: 8,
      flexDirection: 'row',
      minHeight: 48,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    hero: {
      alignItems: 'center',
      marginTop: 32,
    },
    iconBadge: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    heading: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginTop: 28,
    },
    subheading: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 12,
      marginBottom: 24,
      paddingHorizontal: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.surface,
      color: theme.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    inputError: {
      borderColor: theme.error,
    },
    errorText: {
      color: theme.error,
      fontSize: 13,
      marginTop: 6,
    },
    spacer: {
      flex: 1,
      minHeight: 24,
    },
    actionContainer: {
      paddingBottom: 12,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderBottomWidth: 4,
      borderBottomColor: theme.primaryShade,
      paddingVertical: 16,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 18,
      fontWeight: 'bold',
    },
    skipLink: {
      marginTop: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    skipLinkText: {
      color: theme.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
}
