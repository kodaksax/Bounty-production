import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useCountdown } from '../../hooks/useCountdown';

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
  const { isWithin24h, isExpired, label } = useCountdown(endDate);
  if (!isWithin24h || isExpired) return null;

  return (
    <View
      style={[styles.badge, size === 'md' && styles.badgeMd, style]}
      accessibilityLabel={`Deadline in ${label}`}
    >
      <MaterialIcons name="timer" size={size === 'md' ? 12 : 10} color="#fff" />
      <Text style={[styles.text, size === 'md' && styles.textMd]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    backgroundColor: 'rgba(220,38,38,0.92)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeMd: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  textMd: {
    fontSize: 11,
  },
});
