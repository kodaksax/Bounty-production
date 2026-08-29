import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RADIUS, SIZING, TYPOGRAPHY } from 'lib/constants/accessibility';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
} from 'lib/config/notification-taxonomy';
import { useNotifications } from 'lib/context/notification-context';
import { notificationService } from 'lib/services/notification-service';
import { offlineQueueService } from 'lib/services/offline-queue-service';
import { resolveNotificationDeepLink, supportsActionSheet } from 'lib/services/notification-deep-links';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import type { Notification, NotificationCategory } from 'lib/types';
import { useAuth } from 'providers/auth-provider';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppModal } from '../ui/app-modal';
import { NotificationActionSheet } from './notification-action-sheet';
import { NotificationListItem } from './notification-list-item';

type FilterKey = 'all' | 'unread' | NotificationCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  ...NOTIFICATION_CATEGORIES.map(c => ({ key: c as FilterKey, label: NOTIFICATION_CATEGORY_LABELS[c] })),
];

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

/**
 * Header metrics scale with the viewport so the "Mark all read" action stays
 * proportionate — a readable pill on a 320pt SE, without ballooning on a tablet.
 */
function getHeaderMetrics(width: number) {
  return {
    backIconSize: clamp(width * 0.06, SIZING.ICON_MEDIUM, SIZING.ICON_LARGE),
    titleFontSize: clamp(width * 0.05, TYPOGRAPHY.SIZE_HEADER, TYPOGRAPHY.SIZE_LARGE),
    actionHeight: clamp(width * 0.095, SIZING.BUTTON_HEIGHT_COMPACT, SIZING.COMFORTABLE_TOUCH_TARGET),
    actionPaddingH: clamp(width * 0.035, 10, 18),
    actionFontSize: clamp(width * 0.036, TYPOGRAPHY.SIZE_XSMALL, TYPOGRAPHY.SIZE_DEFAULT),
    actionIconSize: clamp(width * 0.045, SIZING.ICON_SMALL, SIZING.ICON_MEDIUM),
  };
}

type HeaderMetrics = ReturnType<typeof getHeaderMetrics>;

export function NotificationCenterScreen() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const metrics = useMemo(() => getHeaderMetrics(windowWidth), [windowWidth]);
  const s = useMemo(() => makeStyles(theme, metrics), [theme, metrics]);
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? null;

  const { notifications, unreadCount, loading, fetchNotifications, markAllAsRead } = useNotifications();
  const hasUnread = unreadCount > 0;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [contextMenuFor, setContextMenuFor] = useState<Notification | null>(null);
  const [actionSheetFor, setActionSheetFor] = useState<Notification | null>(null);

  const visibleNotifications = useMemo(() => {
    let list = notifications.filter(n => !n.archived);
    if (filter === 'unread') list = list.filter(n => !n.read);
    else if (filter !== 'all') list = list.filter(n => (n.category ?? filter) === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
    }
    return list;
  }, [notifications, filter, search]);

  const handlePress = useCallback((notification: Notification) => {
    if (supportsActionSheet({ type: notification.type, category: notification.category }, notification)) {
      setActionSheetFor(notification);
      return;
    }
    notificationService.markAsRead([notification.id]).catch(() => {});
    const action = resolveNotificationDeepLink({ type: notification.type, category: notification.category, data: notification.data });
    if (action.kind === 'route') {
      router.push(action.path as any);
    } else if (action.kind === 'conversation') {
      router.push(`/tabs/messenger/${encodeURIComponent(action.conversationId)}` as any);
    }
  }, [router]);

  const handleToggleRead = useCallback(async (notification: Notification) => {
    const nextRead = !notification.read;
    if (offlineQueueService.getOnlineStatus()) {
      try {
        if (nextRead) await notificationService.markAsRead([notification.id]);
        else await notificationService.markAsUnread([notification.id]);
        fetchNotifications();
      } catch {
        await offlineQueueService.enqueue('notification_action', {
          action: nextRead ? 'mark_read' : 'mark_unread',
          notificationIds: [notification.id],
        });
      }
    } else {
      await offlineQueueService.enqueue('notification_action', {
        action: nextRead ? 'mark_read' : 'mark_unread',
        notificationIds: [notification.id],
      });
    }
  }, [fetchNotifications]);

  const handleArchive = useCallback(async (notification: Notification) => {
    if (offlineQueueService.getOnlineStatus()) {
      try {
        await notificationService.archiveNotifications([notification.id]);
        fetchNotifications();
        return;
      } catch {
        // fall through to offline queue
      }
    }
    await offlineQueueService.enqueue('notification_action', {
      action: 'archive',
      notificationIds: [notification.id],
    });
  }, [fetchNotifications]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={s.backButton}>
          <MaterialIcons name="arrow-back" size={metrics.backIconSize} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Notifications</Text>
        <TouchableOpacity
          style={[s.markAllButton, !hasUnread && s.markAllButtonDisabled]}
          onPress={() => markAllAsRead()}
          disabled={!hasUnread}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasUnread }}
          accessibilityLabel={
            hasUnread ? `Mark all ${unreadCount} notifications as read` : 'Mark all as read'
          }
        >
          <MaterialIcons
            name="done-all"
            size={metrics.actionIconSize}
            color={hasUnread ? '#FFFFFF' : theme.textDisabled}
          />
          <Text style={[s.markAllText, !hasUnread && s.markAllTextDisabled]} numberOfLines={1}>
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchWrapper}>
        <MaterialIcons name="search" size={18} color={theme.textDisabled} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search notifications"
          placeholderTextColor={theme.textDisabled}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={s.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterList}
        >
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setFilter(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[s.chipLabel, active && s.chipLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading && notifications.length === 0 ? (
        <View style={s.centerFill}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : visibleNotifications.length === 0 ? (
        <View style={s.centerFill}>
          <MaterialIcons name="notifications-none" size={48} color={theme.textDisabled} />
          <Text style={s.emptyText}>
            {search.trim() ? 'No notifications match your search' : "You're all caught up"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleNotifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationListItem
              notification={item}
              onPress={handlePress}
              onLongPress={setContextMenuFor}
              onToggleRead={handleToggleRead}
              onArchive={handleArchive}
            />
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          refreshing={loading}
          onRefresh={fetchNotifications}
          style={s.list}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        />
      )}

      {/* Long-press context menu */}
      <AppModal visible={!!contextMenuFor} onRequestClose={() => setContextMenuFor(null)} variant="sheet">
        <View style={s.contextMenu}>
          <View style={s.handle} />
          {contextMenuFor && (
            <>
              <TouchableOpacity
                style={s.contextMenuRow}
                onPress={() => { handleToggleRead(contextMenuFor); setContextMenuFor(null); }}
              >
                <MaterialIcons name={contextMenuFor.read ? 'mark-email-unread' : 'mark-email-read'} size={20} color={theme.text} />
                <Text style={s.contextMenuLabel}>{contextMenuFor.read ? 'Mark as unread' : 'Mark as read'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.contextMenuRow}
                onPress={() => { handleArchive(contextMenuFor); setContextMenuFor(null); }}
              >
                <MaterialIcons name="archive" size={20} color={theme.text} />
                <Text style={s.contextMenuLabel}>Archive</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.contextMenuRow}
                onPress={() => { const n = contextMenuFor; setContextMenuFor(null); setActionSheetFor(n); }}
              >
                <MaterialIcons name="open-in-new" size={20} color={theme.text} />
                <Text style={s.contextMenuLabel}>Open</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </AppModal>

      <NotificationActionSheet
        notification={actionSheetFor}
        currentUserId={currentUserId}
        onClose={() => setActionSheetFor(null)}
        onActionComplete={fetchNotifications}
      />
    </View>
  );
}

function makeStyles(t: AppTheme, m: HeaderMetrics) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
    },
    backButton: { padding: 4 },
    headerTitle: { flex: 1, fontSize: m.titleFontSize, fontWeight: '700', color: t.text },
    markAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: m.actionHeight,
      paddingHorizontal: m.actionPaddingH,
      borderRadius: RADIUS.PILL,
      backgroundColor: t.primary,
      borderWidth: 1,
      borderColor: t.primary,
      ...t.shadows.sm,
    },
    markAllButtonDisabled: {
      backgroundColor: t.surfaceSecondary,
      borderColor: t.border,
      shadowOpacity: 0,
      elevation: 0,
    },
    markAllText: { fontSize: m.actionFontSize, fontWeight: '700', color: '#FFFFFF' },
    markAllTextDisabled: { color: t.textDisabled },
    searchWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    searchInput: { flex: 1, color: t.text, fontSize: 14, padding: 0 },
    // Wrapping View (default flexShrink: 0) keeps the row at its natural height —
    // a bare horizontal ScrollView/FlatList inherits flexShrink: 1 and gets
    // squeezed flat by the notification list below it, clipping the chips.
    filterRow: { flexGrow: 0, flexShrink: 0, marginBottom: 8 },
    filterList: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      minHeight: 34,
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    chipActive: { backgroundColor: t.primary, borderColor: t.primary },
    chipLabel: { fontSize: 13, fontWeight: '600', color: t.textSecondary },
    chipLabelActive: { color: '#fff' },
    list: { flex: 1 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 62 },
    centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    emptyText: { marginTop: 12, fontSize: 14, color: t.textSecondary, textAlign: 'center' },
    contextMenu: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 32,
      borderWidth: 1,
      borderColor: t.border,
      borderBottomWidth: 0,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.border,
      marginBottom: 8,
    },
    contextMenuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      gap: 14,
    },
    contextMenuLabel: { fontSize: 15, color: t.text, fontWeight: '500' },
  });
}
