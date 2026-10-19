import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { NOT_NEARBY_LABEL } from '../lib/utils/applicant-distance';

export interface NotNearbyToggleProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The "Not nearby (N)" divider in a poster's applicant list (SBA-02).
 * Applications the server flagged is_far (over 50 miles from an in-person
 * job) sit under it, closed by default: they are still applications, just
 * not the ones a poster should read first.
 */
export function NotNearbyToggle({ count, expanded, onToggle }: NotNearbyToggleProps) {
  const { theme } = useAppThemeContext();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={s.row}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${NOT_NEARBY_LABEL}, ${count} application${count === 1 ? '' : 's'} more than 50 miles away`}
      accessibilityHint={expanded ? 'Hides them' : 'Shows them'}
      testID="not-nearby-toggle"
    >
      <View style={s.rule} />
      <Text style={s.label}>
        {NOT_NEARBY_LABEL} ({count})
      </Text>
      <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={18} color={theme.textSecondary} />
      <View style={s.rule} />
    </TouchableOpacity>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 44,
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.border,
    },
    label: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
