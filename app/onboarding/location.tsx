/**
 * Onboarding Location Screen
 * Third step, sitting between the style step (app/onboarding/style.tsx) and
 * role select (app/onboarding/role-select.tsx): one ask for location, before
 * the flow branches, so distance is available to both roles — the hunter sees
 * how close the money is, the poster's task lands in front of nearby hunters.
 *
 * Two grades of yes, mirroring the OS's own choice:
 *   - "Allow location"      -> precise coords, reverse-geocoded to a display
 *                              address (same shape details.tsx writes).
 *   - "Only use approximate" -> the OS prompt still runs (there is no coarse-only
 *                              request on either platform), but we resolve and
 *                              keep nothing finer than a city/region label.
 *
 * Neither answer blocks the flow: a denial or a skip records the outcome and
 * moves on. The hunter branch in details.tsx keeps its own location prompt
 * (it also drives nearby-bounty discovery and the ZIP fallback); once
 * permission is granted here, pressing "Use my location" there resolves
 * without a second OS dialog.
 *
 * See app/onboarding/username.tsx's totalStepsFor for the step-count logic
 * this screen's dots participate in.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BountyCompassMark } from '../../components/onboarding/BountyCompassMark';
import {
  ONBOARDING_TOTAL_STEPS,
  OnboardingProgressDots,
} from '../../components/onboarding/OnboardingProgressDots';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { locationService } from '../../lib/services/location-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { palette } from '../../lib/themes/colors';
import type { AppTheme } from '../../lib/themes/types';

type LocationPrecision = 'precise' | 'approximate' | 'denied' | 'skipped';

export default function LocationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { data: onboardingData, updateData } = useOnboarding();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Which CTA is waiting on the OS prompt / geocoder, so only that button
  // shows a spinner while both stay disabled.
  const [pendingAction, setPendingAction] = useState<'precise' | 'approximate' | null>(null);

  useEffect(() => {
    analyticsService.trackEvent('onboarding_location_step_viewed', {
      intent: onboardingData.intent ?? 'none',
    });
    // Fire once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (precision: LocationPrecision, extra?: { location?: string }) => {
    // Always overwrite `location`, clearing it when this answer resolved none:
    // a user who stored a precise address, came back, then skipped/denied or
    // chose approximate must not have the old address written on completion.
    updateData({ locationPrecision: precision, location: extra?.location ?? '' });
    analyticsService.trackEvent('onboarding_location_step_answered', {
      precision,
      intent: onboardingData.intent ?? 'none',
    });
    router.push('/onboarding/role-select');
  };

  const requestAndResolve = async (requested: 'precise' | 'approximate') => {
    if (pendingAction) return;
    hapticFeedback.light();
    setPendingAction(requested);
    try {
      const permission = await locationService.requestPermission();
      if (!permission.granted) {
        analyticsService.trackEvent('onboarding_location_permission_denied', {
          source: 'onboarding_location_step',
          requested,
        });
        finish('denied');
        return;
      }
      analyticsService.trackEvent('onboarding_location_permission_granted', {
        source: 'onboarding_location_step',
        requested,
      });

      const coords = await locationService.getCurrentLocation();
      if (!coords) {
        // Permission is granted but the fix failed (airplane mode, indoors on
        // a cold start). Nothing to record beyond the grant; the hunter/poster
        // branches retry with their own UI.
        finish(requested);
        return;
      }

      if (requested === 'approximate') {
        // Coarse only: a city/region label, never the street-level address.
        const region = await locationService.reverseGeocodeRegion(coords);
        const label = [region?.city, region?.region].filter(Boolean).join(', ');
        finish('approximate', label ? { location: label } : undefined);
        return;
      }

      const address = await locationService.reverseGeocode(coords);
      finish('precise', address ? { location: address } : undefined);
    } catch (error) {
      console.error('[Onboarding] location step failed:', error);
      // Never trap someone on this screen over a geocoder failure.
      finish('skipped');
    } finally {
      setPendingAction(null);
    }
  };

  const handleSkip = () => {
    if (pendingAction) return;
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_step_skipped', { step: 'location' });
    finish('skipped');
  };

  const handleBack = () => {
    hapticFeedback.light();
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.backRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <OnboardingProgressDots
        total={ONBOARDING_TOTAL_STEPS}
        activeIndex={2}
        style={styles.dotsContainer}
      />

      <View style={styles.hero}>
        <BountyCompassMark theme={theme} size={168} />
      </View>

      <Text style={styles.heading}>Allow location to see the closest bounties</Text>
      <Text style={styles.subheading}>
        With your location we can show you the bounties closest to you, and put what you post in
        front of the people nearest to it.
      </Text>

      <View style={styles.spacer} />

      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[styles.primaryButton, pendingAction ? styles.buttonDisabled : null]}
          onPress={() => requestAndResolve('precise')}
          disabled={pendingAction !== null}
          accessibilityRole="button"
          accessibilityLabel="Allow location"
          accessibilityState={{ disabled: pendingAction !== null, busy: pendingAction === 'precise' }}
        >
          {pendingAction === 'precise' ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Allow location</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => requestAndResolve('approximate')}
          disabled={pendingAction !== null}
          accessibilityRole="button"
          accessibilityLabel="Only use approximate location"
          accessibilityHint="We keep your city and region, never your exact address"
          accessibilityState={{
            disabled: pendingAction !== null,
            busy: pendingAction === 'approximate',
          }}
        >
          {pendingAction === 'approximate' ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : (
            <Text style={styles.secondaryButtonText}>Only use approximate</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipLink}
          onPress={handleSkip}
          disabled={pendingAction !== null}
          accessibilityRole="button"
          accessibilityLabel="Not now - you will see online bounties only"
        >
          <Text style={styles.skipLinkText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 24,
    },
    backRow: {
      paddingTop: 8,
      flexDirection: 'row',
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    dotsContainer: {
      paddingTop: 8,
    },
    hero: {
      alignItems: 'center',
      marginTop: 48,
    },
    heading: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginTop: 32,
    },
    subheading: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 12,
      paddingHorizontal: 4,
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
      paddingVertical: 16,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 18,
      fontWeight: 'bold',
    },
    secondaryButton: {
      marginTop: 16,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    secondaryButtonText: {
      color: theme.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    skipLink: {
      marginTop: 4,
      paddingVertical: 10,
      alignItems: 'center',
    },
    skipLinkText: {
      color: theme.textDisabled,
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
