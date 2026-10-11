import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BountyDisplayStatus } from 'lib/utils/bounty-display-status';

/**
 * Solid status tag for the inbox cards ("Active", "Completed", "Expired"…).
 * Colours are fixed semantic hues with white text, so they read the same on
 * light and dark surfaces; muted states use an AA-safe neutral.
 */
const BADGES: Partial<Record<BountyDisplayStatus, { label: string; color: string | null }>> = {
  open: { label: 'Open', color: '#00701F' },
  applied: { label: 'Applied', color: '#0369a1' },
  in_progress: { label: 'Active', color: '#2563eb' },
  submitted_for_review: { label: 'In review', color: '#7c3aed' },
  review_needed: { label: 'Review', color: '#b45309' },
  completed: { label: 'Completed', color: '#00701F' },
  cancellation_requested: { label: 'Cancelling', color: '#c2410c' },
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
  const badge = BADGES[status] ?? { label: 'Bounty', color: null };
  const bg = badge.color ?? '#61656B';
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
