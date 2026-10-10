import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BountyDisplayStatus } from 'lib/utils/bounty-display-status';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

/**
 * Solid status tag for the inbox cards ("Active", "Completed", "Expired"…).
 * Colours are fixed semantic hues with white text, so they read the same on
 * light and dark surfaces; muted states use the theme's own neutral.
 */
const BADGES: Partial<Record<BountyDisplayStatus, { label: string; color: string | null }>> = {
  open: { label: 'Open', color: '#008E2A' },
  applied: { label: 'Applied', color: '#0284c7' },
  in_progress: { label: 'Active', color: '#2563eb' },
  submitted_for_review: { label: 'In review', color: '#7c3aed' },
  review_needed: { label: 'Review', color: '#d97706' },
  completed: { label: 'Completed', color: '#008E2A' },
  cancellation_requested: { label: 'Cancelling', color: '#ea580c' },
  rejected: { label: 'Not selected', color: null },
  cancelled: { label: 'Cancelled', color: null },
  deadline_passed: { label: 'Expired', color: null },
  archived: { label: 'Archived', color: null },
  deleted: { label: 'Removed', color: null },
};

export function statusBadgeLabel(status: BountyDisplayStatus): string {
  return BADGES[status]?.label ?? 'Bounty';
}

export function StatusBadge({ status }: { status: BountyDisplayStatus }) {
  const { theme } = useAppThemeContext();
  const badge = BADGES[status] ?? { label: 'Bounty', color: null };
  const bg = badge.color ?? (theme.isDark ? '#61656B' : '#929497');
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.text} numberOfLines={1}>
        {badge.label.toUpperCase()}
      </Text>
    </View>
  );
}

// Same metrics as BountyCard's status tag, so a bounty reads identically in
// the feed and in the inbox.
const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
