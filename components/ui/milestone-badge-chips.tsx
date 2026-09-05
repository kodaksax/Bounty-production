import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import {
  type MilestoneBadge,
  type MilestoneBadgeInput,
  getMilestoneBadges,
} from '../../lib/utils/verification-badges';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

const BADGE_ICONS: Record<string, MaterialIconName> = {
  first_bounty_posted: 'flag',
  bounties_completed_5: 'workspace-premium',
  top_rated: 'star',
};

const BADGE_COLORS: Record<string, string> = {
  first_bounty_posted: '#059669', // emerald-600
  bounties_completed_5: '#d97706', // amber-600
  top_rated: '#eab308', // yellow-500
};

interface MilestoneBadgeChipsProps {
  input: MilestoneBadgeInput;
}

/**
 * Renders a row of marketplace-activity milestone badge chips — same
 * earned/muted-with-lock visual pattern as VerificationBadgeChips, but for a
 * conceptually distinct set (real deterministic activity, not identity/KYC).
 */
export function MilestoneBadgeChips({ input }: MilestoneBadgeChipsProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const badges = getMilestoneBadges(input);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="military-tech" size={16} color={theme.primaryLight} />
        <Text style={styles.title}>Milestones</Text>
      </View>
      <View style={styles.chips}>
        {badges.map((badge) => (
          <BadgeChip key={badge.id} badge={badge} />
        ))}
      </View>
    </View>
  );
}

function BadgeChip({ badge }: { badge: MilestoneBadge }) {
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
