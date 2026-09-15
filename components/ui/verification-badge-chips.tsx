import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import {
  type VerificationBadge,
  type VerificationBadgeInput,
  getVerificationBadges,
} from '../../lib/utils/verification-badges';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

const BADGE_ICONS: Record<string, MaterialIconName> = {
  email_confirmed: 'email',
  phone_verified: 'smartphone',
  id_verified: 'badge',
  profile_complete: 'person',
  trusted: 'verified-user',
};

const BADGE_COLORS: Record<string, string> = {
  email_confirmed: '#3b82f6',  // blue-500
  phone_verified: '#8b5cf6',   // violet-500
  id_verified: '#06b6d4',      // cyan-500
  profile_complete: '#059669', // emerald-500
  trusted: '#f59e0b',          // amber-500
};

const HEADER_ICON_COLOR = '#6ee7b7'; // emerald-200

interface VerificationBadgeChipsProps {
  input: VerificationBadgeInput;
  /**
   * Defaults to true (self-view: show all badges). When false, this is
   * someone else's profile — public_profiles never exposes
   * email_confirmed/phone_verified/age_verified (by design, to protect PII),
   * so those fields are always undefined here and their badges would always
   * render as permanently locked regardless of the real value. "Trusted"
   * requires all of them, so it's unearnable cross-user too. Only badges
   * this view can actually prove (id_verified, profile_complete) are shown.
   */
  isOwnProfile?: boolean;
}

// Badges that require fields only ever selected for the viewer's own profile
// (see the comment above) — never render these cross-user, earned or not.
const OWN_PROFILE_ONLY_BADGES: ReadonlySet<string> = new Set([
  'email_confirmed',
  'phone_verified',
  'age_verified',
  'trusted',
]);

/**
 * Renders a row of verification badge chips.
 * Earned badges display in full color; unearned badges are muted/outlined
 * with a lock icon overlay.
 */
export function VerificationBadgeChips({ input, isOwnProfile = true }: VerificationBadgeChipsProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const badges = getVerificationBadges(input).filter(
    (badge) => isOwnProfile || !OWN_PROFILE_ONLY_BADGES.has(badge.id)
  );

  if (badges.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="verified-user" size={16} color={theme.primaryLight} />
        <Text style={styles.title}>Verified by Bounty</Text>
      </View>
      <View style={styles.chips}>
        {badges.map((badge) => (
          <BadgeChip key={badge.id} badge={badge} />
        ))}
      </View>
    </View>
  );
}

function BadgeChip({ badge }: { badge: VerificationBadge }) {
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const color = BADGE_COLORS[badge.id] ?? '#9ca3af';
  const iconName: MaterialIconName = BADGE_ICONS[badge.id] ?? 'help-outline';

  if (badge.earned) {
    return (
      <View
        style={[styles.chip, { backgroundColor: `${color}22`, borderColor: color }]}
        accessible={true}
        accessibilityRole="text"
        accessibilityLabel={`${badge.label} earned`}
      >
        <MaterialIcons name={iconName} size={14} color={color} />
        <Text style={[styles.chipLabel, { color }]}>{badge.label}</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.chip, styles.chipUnearned]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${badge.label} not yet earned`}
    >
      <MaterialIcons name={iconName} size={14} color={theme.textSecondary} />
      <Text style={styles.chipLabelUnearned}>{badge.label}</Text>
      <MaterialIcons name="lock" size={11} color={theme.textSecondary} style={styles.lockIcon} />
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      marginBottom: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    title: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.text,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      gap: 5,
    },
    chipUnearned: {
      backgroundColor: 'rgba(107, 114, 128, 0.1)',
      borderColor: theme.border,
    },
    chipLabel: {
      fontSize: 11,
      fontWeight: '600',
    },
    chipLabelUnearned: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    lockIcon: {
      marginLeft: 1,
    },
  });
}
