import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNotifications } from 'lib/context/notification-context';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * Themed replacement for the dead components/notifications-bell.tsx (which
 * used hardcoded emerald colors + an inline Modal list). This bell only
 * shows an icon + unread badge and navigates to the routable /notifications
 * screen — it doesn't render the list itself, so it works identically from
 * cold-start deep links and from being tapped live.
 */
export function NotificationBell() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { unreadCount } = useNotifications();

  return (
    <TouchableOpacity
      style={s.button}
      onPress={() => router.push('/notifications' as any)}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
    >
      <MaterialIcons name="notifications-none" size={22} color={theme.text} />
      {unreadCount > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText} numberOfLines={1}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    button: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    badge: {
      position: 'absolute',
      top: 4,
      right: 4,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.error,
      borderWidth: 1.5,
      borderColor: t.surfaceSecondary,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: 9,
      fontWeight: '700',
    },
  });
}
