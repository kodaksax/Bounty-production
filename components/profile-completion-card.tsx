/**
 * "Finish setting up your profile", as a card on the Profile tab.
 *
 * This used to be the complete_profile moment: a sheet that met returning
 * users at sign-in, before their jobs. Same rule (a bio or a location is
 * missing), same words, but it sits on Profile where finishing the profile is
 * what the user came to do, and it can be dismissed. A dismissal is
 * remembered on this device for LATER_RETURN_HOURS (a week), then the card
 * comes back if the profile is still unfinished.
 */
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LATER_RETURN_HOURS } from '../lib/moments/types';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { withAlpha } from '../lib/utils';

const DISMISSED_AT_KEY_PREFIX = '@bounty_profile_card_dismissed_at:';

export function profileNeedsCompleting(profile: {
  about?: string | null;
  location?: string | null;
}): boolean {
  return !profile.about?.trim() || !profile.location?.trim();
}

/** Was the card dismissed on this device less than a week ago? */
export function isProfileCardSnoozed(dismissedAt: string | null, now: number = Date.now()): boolean {
  if (!dismissedAt) return false;
  const at = new Date(dismissedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < LATER_RETURN_HOURS * 60 * 60 * 1000;
}

export function ProfileCompletionCard({
  userId,
  profile,
  isActive,
}: {
  userId: string;
  profile: { about?: string | null; location?: string | null };
  isActive: boolean;
}) {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // null until storage is read, so a dismissed card never flashes up.
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  const needed = profileNeedsCompleting(profile);

  useEffect(() => {
    let cancelled = false;
    setSnoozed(null);
    AsyncStorage.getItem(DISMISSED_AT_KEY_PREFIX + userId)
      .then(value => {
        if (!cancelled) setSnoozed(isProfileCardSnoozed(value));
      })
      .catch(() => {
        if (!cancelled) setSnoozed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const shown = isActive && needed && snoozed === false;
  useEffect(() => {
    if (shown) analyticsService.trackEvent('profile_completion_card_shown', {});
  }, [shown]);

  if (!shown) return null;

  const dismiss = () => {
    setSnoozed(true);
    AsyncStorage.setItem(DISMISSED_AT_KEY_PREFIX + userId, new Date().toISOString()).catch(() => {});
    analyticsService.trackEvent('profile_completion_card_dismissed', {
      returnsAfterHours: LATER_RETURN_HOURS,
    });
  };

  const open = () => {
    analyticsService.trackEvent('profile_completion_card_tapped', {});
    router.push('/profile/edit' as never);
  };

  return (
    <View style={s.card} testID="profile-completion-card">
      <MaterialIcons name="person-outline" size={22} color={theme.primary} style={s.icon} />
      <View style={s.textWrap}>
        <Text style={s.title} accessibilityRole="header">
          Finish setting up your profile
        </Text>
        <Text style={s.body}>
          A bio and location help us match you with the right bounties nearby, and help others
          trust who they’re dealing with.
        </Text>
        <TouchableOpacity
          style={s.button}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Complete profile"
        >
          <Text style={s.buttonText}>Complete profile</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={s.close}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Hide this for now"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="profile-completion-card-dismiss"
      >
        <MaterialIcons name="close" size={20} color={theme.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginTop: 12,
      paddingVertical: 14,
      paddingLeft: 14,
      paddingRight: 8,
      borderRadius: 12,
      backgroundColor: theme.isDark ? theme.primaryTint : withAlpha(theme.primary, 0.1),
      borderWidth: 1,
      borderColor: theme.isDark ? theme.primaryTint : theme.primary,
    },
    icon: { marginTop: 2 },
    textWrap: { flex: 1 },
    title: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 4 },
    body: { fontSize: 13, lineHeight: 18, color: theme.textSecondary, marginBottom: 10 },
    button: {
      alignSelf: 'flex-start',
      backgroundColor: theme.primary,
      borderRadius: 999,
      paddingVertical: 10,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
    },
    buttonText: { color: theme.onPrimary, fontSize: 14, fontWeight: '700' },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
}
