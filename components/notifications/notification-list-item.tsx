import { MaterialIcons } from '@expo/vector-icons';
import { Avatar, AvatarFallback, AvatarImage } from 'components/ui/avatar';
import { useNormalizedProfile } from 'hooks/useNormalizedProfile';
import { categoryForNotificationType } from 'lib/config/notification-taxonomy';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import type { Notification, NotificationCategory } from 'lib/types';
import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
// The plain `Swipeable` exported from the package root is the deprecated,
// RN-Animated-based implementation. Import the Reanimated-driven version
// directly (matches this codebase's existing Reanimated stack, and its
// `progress` is a real SharedValue usable with useAnimatedStyle).
import Swipeable, { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

const CATEGORY_ICON: Record<NotificationCategory, keyof typeof MaterialIcons.glyphMap> = {
  marketplace: 'storefront',
  messages: 'chat',
  payments: 'attach-money',
  security: 'shield',
  verification: 'verified-user',
  followers: 'favorite',
  marketing: 'campaign',
};

// Categories with a real personal "sender" whose identity is worth showing —
// payments/security/verification/marketing notifications have no individual
// actor, so they keep the generic category icon.
const CATEGORIES_WITH_ACTOR: NotificationCategory[] = ['messages', 'marketplace', 'followers'];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

interface NotificationListItemProps {
  notification: Notification;
  onPress: (notification: Notification) => void;
  onLongPress: (notification: Notification) => void;
  onToggleRead: (notification: Notification) => void;
  onArchive: (notification: Notification) => void;
}

export function NotificationListItem({ notification, onPress, onLongPress, onToggleRead, onArchive }: NotificationListItemProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const swipeableRef = useRef<SwipeableMethods>(null);
  const category = notification.category ?? categoryForNotificationType(notification.type);
  const unread = !notification.read;
  const count = notification.count ?? 1;

  const actorId =
    notification.data?.senderId ?? notification.data?.userId ?? notification.data?.followerId;
  const showActorAvatar = CATEGORIES_WITH_ACTOR.includes(category) && !!actorId;
  const { profile: actorProfile } = useNormalizedProfile(actorId, { enabled: showActorAvatar });

  const renderLeftActions = (progress: SharedValue<number>) => {
    const style = useAnimatedStyleFromProgress(progress);
    return (
      <TouchableOpacity
        style={[s.swipeAction, s.readAction]}
        onPress={() => {
          swipeableRef.current?.close();
          onToggleRead(notification);
        }}
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Mark as read' : 'Mark as unread'}
      >
        <Animated.View style={style}>
          <MaterialIcons name={unread ? 'mark-email-read' : 'mark-email-unread'} size={22} color="#fff" />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderRightActions = (progress: SharedValue<number>) => {
    const style = useAnimatedStyleFromProgress(progress);
    return (
      <TouchableOpacity
        style={[s.swipeAction, s.archiveAction]}
        onPress={() => {
          swipeableRef.current?.close();
          onArchive(notification);
        }}
        accessibilityRole="button"
        accessibilityLabel="Archive"
      >
        <Animated.View style={style}>
          <MaterialIcons name="archive" size={22} color="#fff" />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      overshootLeft={false}
      overshootRight={false}
    >
      <TouchableOpacity
        style={[s.row, unread && s.rowUnread]}
        onPress={() => onPress(notification)}
        onLongPress={() => onLongPress(notification)}
        activeOpacity={0.7}
      >
        {showActorAvatar && actorProfile?.avatar ? (
          <Avatar style={s.actorAvatar}>
            <AvatarImage src={actorProfile.avatar} alt={actorProfile.username || actorProfile.display_name || 'User'} />
            <AvatarFallback style={s.actorAvatarFallback}>
              <MaterialIcons name={CATEGORY_ICON[category]} size={16} color={theme.primaryLight ?? theme.primary} />
            </AvatarFallback>
          </Avatar>
        ) : (
          <View style={s.iconBadge}>
            <MaterialIcons name={CATEGORY_ICON[category]} size={18} color={theme.primaryLight ?? theme.primary} />
          </View>
        )}
        <View style={s.textBlock}>
          <View style={s.titleRow}>
            <Text style={[s.title, unread && s.titleUnread]} numberOfLines={1}>
              {notification.title}
              {count > 1 ? ` (${count})` : ''}
            </Text>
            <Text style={s.time}>{timeAgo(notification.created_at)}</Text>
          </View>
          <Text style={s.body} numberOfLines={2}>{notification.body}</Text>
        </View>
        {unread && <View style={s.unreadDot} />}
      </TouchableOpacity>
    </Swipeable>
  );
}

// Reanimated hooks can't be called conditionally per-render inside a
// non-component render prop safely across re-renders in the same way a
// component can — wrapping in a small helper keeps the hook call stable
// since renderLeftActions/renderRightActions are re-invoked by Swipeable
// on every gesture frame with a fresh `progress` value, not remounted.
function useAnimatedStyleFromProgress(progress: SharedValue<number>) {
  return useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + Math.min(Math.max(progress.value, 0), 1) * 0.4 }],
  }));
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: t.surface,
    },
    rowUnread: {
      backgroundColor: t.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    },
    iconBadge: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      marginRight: 12,
      marginTop: 2,
    },
    actorAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      marginRight: 12,
      marginTop: 2,
    },
    actorAvatarFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
    },
    textBlock: { flex: 1 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      color: t.textSecondary,
      marginRight: 8,
    },
    titleUnread: {
      color: t.text,
      fontWeight: '700',
    },
    time: {
      fontSize: 11,
      color: t.textDisabled,
    },
    body: {
      fontSize: 13,
      lineHeight: 18,
      color: t.textSecondary,
      marginTop: 2,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.primary,
      marginLeft: 8,
      marginTop: 6,
    },
    swipeAction: {
      width: 76,
      alignItems: 'center',
      justifyContent: 'center',
    },
    readAction: { backgroundColor: '#3B82F6' },
    archiveAction: { backgroundColor: '#6B7280' },
  });
}
