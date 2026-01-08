import { MaterialIcons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '../lib/context/notification-context';
import type { Notification } from '../lib/types';

/**
 * Memoized notification item component to prevent unnecessary re-renders in the list.
 */
const NotificationItem = React.memo<{
  item: Notification;
  onPress: (notification: Notification) => void;
  getIcon: (type: string) => keyof typeof MaterialIcons.glyphMap;
}>(function NotificationItem({ item, onPress, getIcon }) {
  // Memoize time formatting
  const timeAgo = useMemo(
    () => formatDistanceToNow(new Date(item.created_at), { addSuffix: true }),
    [item.created_at]
  );

  return (
    <TouchableOpacity accessibilityRole="button"
      onPress={() => onPress(item)}
      className={"border-b border-gray-200 p-4 bg-white"}
      activeOpacity={0.7}
    >
      <View className="flex-row items-start">
        <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${!item.read ? 'bg-emerald-600' : 'bg-gray-400'}`}>
          <MaterialIcons name={getIcon(item.type)} size={20} color="white" />
        </View>
        <View className="flex-1">
          <Text className="font-semibold text-gray-900 mb-1">{item.title}</Text>
          <Text className="text-gray-600 text-sm mb-1">{item.body}</Text>
          <Text className="text-gray-400 text-xs">{timeAgo}</Text>
        </View>
        {!item.read && (
          <View className="w-2 h-2 rounded-full bg-emerald-600 ml-2 mt-2" />
        )}
      </View>
    </TouchableOpacity>
  );
});

export function NotificationsBell() {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, fetchNotifications } = useNotifications();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleNotificationPress = useCallback(async (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      await markAsRead([notification.id]);
    }

    // Close dropdown
    setDropdownVisible(false);

    // Navigate based on notification type
    const data = notification.data || {};
    
    // Note: Using type assertion here because expo-router's push method
    // accepts dynamic routes but TypeScript can't infer them statically
    if (data.bountyId) {
      router.push(`/bounty/${data.bountyId}` as '/bounty/[id]');
    } else if (data.senderId) {
      // Navigate to messages
      router.push('/tabs/bounty-app?screen=create' as '/tabs/bounty-app');
    } else if (data.followerId) {
      router.push(`/profile/${data.followerId}` as '/profile/[id]');
    }
  }, [markAsRead, router]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllAsRead();
  }, [markAllAsRead]);

  // Memoize icon mapping function
  const getNotificationIcon = useCallback((type: string): keyof typeof MaterialIcons.glyphMap => {
    switch (type) {
      case 'application':
        return 'person-add';
      case 'acceptance':
        return 'check-circle';
      case 'completion':
        return 'task-alt';
      case 'payment':
        return 'attach-money';
      case 'message':
        return 'chat';
      case 'follow':
        return 'favorite';
      default:
        return 'notifications';
    }
  }, []);

  // Memoized render item function
  const renderNotification = useCallback(({ item }: { item: Notification }) => (
    <NotificationItem 
      item={item} 
      onPress={handleNotificationPress}
      getIcon={getNotificationIcon}
    />
  ), [handleNotificationPress, getNotificationIcon]);

  // Memoized key extractor
  const keyExtractor = useCallback((item: Notification) => item.id, []);

  // Memoized accessibility label
  const bellAccessibilityLabel = useMemo(
    () => `Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`,
    [unreadCount]
  );

  // Memoized badge count display
  const badgeCount = useMemo(
    () => unreadCount > 99 ? '99+' : unreadCount,
    [unreadCount]
  );

  return (
    <>
      <TouchableOpacity
        onPress={() => setDropdownVisible(true)}
        className="relative"
        accessibilityLabel={bellAccessibilityLabel}
        accessibilityRole="button"
      >
        <MaterialIcons name="notifications" size={24} color="#fff" />
        {unreadCount > 0 && (
          <View className="absolute -right-1 -top-1 bg-red-500 rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
            <Text className="text-white text-[10px] font-bold">
              {badgeCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={dropdownVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setDropdownVisible(false)}
      >
  {/* Root modal view: use the same emerald-600 as the header for cohesion */}
  <View className="flex-1 bg-emerald-600" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 bg-emerald-600">
            <View className="flex-row items-center">
              <MaterialIcons name="notifications" size={24} color="#fff" />
              <Text className="text-xl font-bold ml-2 text-white">Notifications</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" onPress={() => setDropdownVisible(false)}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Action bar — match emerald palette and use white text for contrast */}
          {notifications.length > 0 && (
            <View className="flex-row items-center justify-between px-4 py-2 bg-emerald-700 border-b border-emerald-700">
              <Text className="text-sm text-white">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
              </Text>
              {unreadCount > 0 && (
                <TouchableOpacity accessibilityRole="button" onPress={handleMarkAllRead}>
                  <Text className="text-sm font-semibold text-emerald-200">Mark all read</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Notifications list */}
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#ffffff" />
              <Text className="text-white mt-2">Loading notifications...</Text>
            </View>
          ) : notifications.length === 0 ? (
            <View className="flex-1 items-center justify-center px-4">
              <MaterialIcons name="notifications-none" size={64} color="#ffffff" />
              <Text className="text-white text-lg font-semibold mt-4">No notifications yet</Text>
              <Text className="text-emerald-100 text-center mt-2">
                When someone applies to your bounties or sends you a message, you'll see it here
              </Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              renderItem={renderNotification}
              keyExtractor={keyExtractor}
              contentContainerStyle={{ paddingBottom: insets.bottom }}
              onRefresh={fetchNotifications}
              refreshing={loading}
              removeClippedSubviews={true}
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
            />
          )}
        </View>
      </Modal>
    </>
  );
}
