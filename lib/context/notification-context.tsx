import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { notificationService } from '../services/notification-service';
import { supabase } from '../supabase';
import type { Notification } from '../types';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  markAsRead: (notificationIds: string[]) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const fetchedNotifications = await notificationService.fetchNotifications();
      setNotifications(fetchedNotifications);
      
      // Update unread count
      const count = fetchedNotifications.filter(n => !n.read).length;
      setUnreadCount(count);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count);
    } catch (error) {
      console.error('Error refreshing unread count:', error);
    }
  }, []);

  const markAsRead = useCallback(async (notificationIds: string[]) => {
    try {
      await notificationService.markAsRead(notificationIds);
      
      // Update local state
      setNotifications(prev =>
        prev.map(notif =>
          notificationIds.includes(notif.id) ? { ...notif, read: true } : notif
        )
      );
      
      // Update unread count
      setUnreadCount(prev => Math.max(0, prev - notificationIds.length));
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationService.markAllAsRead();
      
      // Update local state
      setNotifications(prev => prev.map(notif => ({ ...notif, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }, []);

  // Handle notification tap navigation
  const handleNotificationTap = useCallback((response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    
    // Navigate based on notification type and data
    if (data.bountyId) {
      router.push(`/bounty/${data.bountyId}`);
    } else if (data.conversationId) {
      // Navigate to messenger screen and open specific conversation
      router.push(`/tabs/messenger-screen?conversationId=${data.conversationId}`);
    } else if (data.senderId) {
      router.push(`/profile/${data.senderId}`);
    } else if (data.followerId) {
      router.push(`/profile/${data.followerId}`);
    }
  }, [router]);

  // Check for notification that launched the app
  const checkInitialNotification = useCallback(async () => {
    try {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response) {
        console.log('App opened from notification:', response);
        handleNotificationTap(response);
      }
    } catch (error) {
      console.warn('Error checking initial notification:', error);
    }
  }, [handleNotificationTap]);

  // Setup notification listeners and request permissions on mount
  useEffect(() => {
    // Request permissions and register token
    notificationService.requestPermissionsAndRegisterToken();

    // Check if app was opened from a notification
    checkInitialNotification();

    // Setup listeners
    const listeners = notificationService.setupNotificationListeners(
      // On notification received (foreground)
      (notification) => {
        console.log('Notification received in foreground:', notification);
        // Refresh notifications list
        fetchNotifications();
        refreshUnreadCount();
      },
      // On notification tapped
      handleNotificationTap
    );

    // Initial fetch
    fetchNotifications();

    return () => {
      listeners.remove();
    };
  }, [fetchNotifications, refreshUnreadCount, handleNotificationTap, checkInitialNotification]);

  // Realtime subscription to notifications table so unread count and list
  // update immediately when a new notification is inserted for this user.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;

        // Prefer channel API when available (supabase-js v2+)
        // @ts-ignore
        if (typeof (supabase as any).channel === 'function') {
          // @ts-ignore
          const channel = (supabase as any).channel(`notifications:${userId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload: any) => {
              // Refresh notifications immediately
              try { fetchNotifications(); refreshUnreadCount(); } catch (e) { console.warn('notif realtime fetch failed', e) }
            })
            .subscribe();

          return () => { try { (supabase as any).removeChannel(channel) } catch {} }
        }

        // Fallback: classic .from().on() subscription
        // @ts-ignore
        const sub = supabase.from(`notifications:user_id=eq.${userId}`).on('INSERT', (payload: any) => {
          try { fetchNotifications(); refreshUnreadCount(); } catch (e) { console.warn('notif realtime fetch failed', e) }
        }).subscribe();

        return () => { try { supabase.removeChannel && supabase.removeChannel(sub) } catch {} }
      } catch (e) {
        // Non-fatal: we'll still poll every 30s as a fallback
        console.warn('Failed to setup realtime notifications subscription', e);
      }
    })();

    return () => { mounted = false }
  }, [fetchNotifications, refreshUnreadCount]);

  // Poll for new notifications every 30 seconds when app is active
  useEffect(() => {
    // TODO: Optimize by using app state listener to pause when backgrounded
    // import { AppState } from 'react-native';
    // const subscription = AppState.addEventListener('change', nextAppState => {
    //   if (nextAppState === 'active') refreshUnreadCount();
    // });
    
    const interval = setInterval(() => {
      refreshUnreadCount();
    }, 30000); // 30 seconds

    return () => {
      clearInterval(interval);
      // subscription?.remove();
    };
  }, [refreshUnreadCount]);

  const value: NotificationContextType = {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    refreshUnreadCount,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
