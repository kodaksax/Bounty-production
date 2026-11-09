import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useCountdown } from '../../hooks/useCountdown';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

/**
 * Sits on a photo in both themes, so it can't follow theme.error: the dark
 * theme's lighter red drops white text below AA. Card chip styles share it.
 */
export const URGENT_CHIP_FILL = 'rgba(163,58,51,0.92)';

export interface CountdownBadgeProps {
  endDate?: string | null;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/**
 * Small ticking "time left" pill. Renders nothing unless the deadline is
 * within 24 hours and hasn't passed — callers don't need to gate on that
 * themselves.
 */
export function CountdownBadge({ endDate, size = 'sm', style }: CountdownBadgeProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { isWithin24h, isExpired, label } = useCountdown(endDate);
  if (!isWithin24h || isExpired) return null;

  return (
    <View
      style={[styles.badge, size === 'md' && styles.badgeMd, style]}
      accessibilityLabel={`Deadline in ${label}`}
    >
      <MaterialIcons name="timer" size={size === 'md' ? 12 : 10} color={theme.onPrimary} />
      <Text style={[styles.text, size === 'md' && styles.textMd]}>{label}</Text>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    backgroundColor: URGENT_CHIP_FILL,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeMd: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.onPrimary,
    fontVariant: ['tabular-nums'],
  },
  textMd: {
    fontSize: 12,
  },
});
}
