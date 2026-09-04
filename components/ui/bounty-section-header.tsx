/**
 * Section header for the grouped Work / Posts lists.
 *
 * The lists used to be a flat, undifferentiated stack of cards sorted by
 * nothing in particular, so "three applications are waiting on me" looked
 * exactly like "a hunter is working on it, nothing to do". The group name plus
 * a count is the whole point: a poster should be able to open My Postings and
 * know in one glance which jobs need them.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import type { BountyAttentionGroup } from '../../lib/utils/bounty-lifecycle';

const GROUP_ICON: Record<BountyAttentionGroup, string> = {
  attention: 'pending-actions',
  active: 'autorenew',
  waiting: 'hourglass-empty',
  past: 'inventory-2',
};

export function BountySectionHeader({
  label,
  count,
  group,
}: {
  label: string;
  count: number;
  group: BountyAttentionGroup;
}) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const isUrgent = group === 'attention';
  const color = isUrgent ? theme.warning : theme.textSecondary;

  return (
    <View
      style={styles.row}
      accessibilityRole="header"
      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'bounty' : 'bounties'}`}
    >
      <MaterialIcons name={GROUP_ICON[group] as any} size={15} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
      <View style={[styles.countPill, isUrgent && { backgroundColor: theme.warning }]}>
        <Text style={[styles.countText, isUrgent && styles.countTextUrgent]}>{count}</Text>
      </View>
      <View style={styles.rule} />
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: 14,
      paddingBottom: 8,
    },
    label: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    countPill: {
      minWidth: 20,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
    },
    countText: { fontSize: 11, fontWeight: '800', color: t.textSecondary },
    countTextUrgent: { color: '#111827' },
    rule: { flex: 1, height: 1, backgroundColor: t.border, marginLeft: 4 },
  });
}

export default BountySectionHeader;
