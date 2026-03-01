import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  profile_complete: '#10b981', // emerald-500
  trusted: '#f59e0b',          // amber-500
};

const HEADER_ICON_COLOR = '#6ee7b7'; // emerald-200

interface VerificationBadgeChipsProps {
  input: VerificationBadgeInput;
}

/**
 * Renders a row of verification badge chips.
 * Earned badges display in full color; unearned badges are muted/outlined
 * with a lock icon overlay.
 */
export function VerificationBadgeChips({ input }: VerificationBadgeChipsProps) {
  const badges = getVerificationBadges(input);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="verified-user" size={16} color={HEADER_ICON_COLOR} />
        <Text style={styles.title}>Verification</Text>
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
  const color = BADGE_COLORS[badge.id] ?? '#9ca3af';
  const iconName: MaterialIconName = BADGE_ICONS[badge.id] ?? 'help-outline';

  if (badge.earned) {
    return (
      <View
        style={[styles.chip, { backgroundColor: `${color}22`, borderColor: color }]}
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
      accessibilityLabel={`${badge.label} not yet earned`}
    >
      <MaterialIcons name={iconName} size={14} color="#6b7280" />
      <Text style={styles.chipLabelUnearned}>{badge.label}</Text>
      <MaterialIcons name="lock" size={11} color="#6b7280" style={styles.lockIcon} />
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: '#ffffff',
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
    borderColor: '#374151',
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  chipLabelUnearned: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
  },
  lockIcon: {
    marginLeft: 1,
  },
});
