import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../supabase';
import type { Notification, NotificationType } from '../types';

const NOTIFICATION_CACHE_KEY = 'notifications:cache';
const LAST_FETCH_KEY = 'notifications:last_fetch';

// Configure how notifications should be handled when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export class NotificationService {
  private static instance: NotificationService;
  private cachedNotifications: Notification[] = [];
  private unreadCount: number = 0;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Request notification permissions and register for push notifications
   */
  async requestPermissionsAndRegisterToken(): Promise<string | null> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted');
        return null;
      }

      // Get the Expo push token
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      
      // Register token with backend
      await this.registerPushToken(token);

      return token;
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      return null;
    }
  }

  /**
   * Register push token with the backend
   */
  async registerPushToken(token: string, deviceId?: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.log('No active session, cannot register push token');
        return;
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/notifications/register-token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token, deviceId }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to register push token');
      }

      console.log('Push token registered successfully');
    } catch (error) {
      console.error('Error registering push token:', error);
    }
  }

  /**
   * Fetch notifications from the backend
   */
  async fetchNotifications(limit: number = 50, offset: number = 0): Promise<Notification[]> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.log('No active session, cannot fetch notifications');
        return [];
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/notifications?limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      this.cachedNotifications = data.notifications || [];
      
      // Cache notifications locally
      await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
      await AsyncStorage.setItem(LAST_FETCH_KEY, new Date().toISOString());

      return this.cachedNotifications;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      // Return cached notifications on error
      return this.getCachedNotifications();
    }
  }

  /**
   * Get cached notifications from AsyncStorage
   */
  async getCachedNotifications(): Promise<Notification[]> {
    try {
      const cached = await AsyncStorage.getItem(NOTIFICATION_CACHE_KEY);
      if (cached) {
        this.cachedNotifications = JSON.parse(cached);
        return this.cachedNotifications;
      }
      return [];
    } catch (error) {
      console.error('Error getting cached notifications:', error);
      return [];
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return 0;
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/notifications/unread-count`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch unread count');
      }

      const data = await response.json();
      this.unreadCount = data.count || 0;
      return this.unreadCount;
    } catch (error) {
      console.error('Error fetching unread count:', error);
      return 0;
    }
  }

  /**
   * Mark notification(s) as read
   */
  async markAsRead(notificationIds: string[]): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/notifications/mark-read`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ notificationIds }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to mark notifications as read');
      }

      // Update local cache
      this.cachedNotifications = this.cachedNotifications.map(notif =>
        notificationIds.includes(notif.id) ? { ...notif, read: true } : notif
      );
      await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/notifications/mark-all-read`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }

      // Update local cache
      this.cachedNotifications = this.cachedNotifications.map(notif => ({ ...notif, read: true }));
      await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
      this.unreadCount = 0;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }

  /**
   * Setup notification listeners
   */
  setupNotificationListeners(
    onNotificationReceived?: (notification: Notifications.Notification) => void,
    onNotificationTapped?: (response: Notifications.NotificationResponse) => void
  ) {
    // Listener for notifications received while app is in foreground
    const receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      if (onNotificationReceived) {
        onNotificationReceived(notification);
      }
      // Refresh notifications
      this.fetchNotifications();
    });

    // Listener for when user taps on a notification
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification tapped:', response);
      if (onNotificationTapped) {
        onNotificationTapped(response);
      }
    });

    return {
      receivedSubscription,
      responseSubscription,
      remove: () => {
        receivedSubscription.remove();
        responseSubscription.remove();
      },
    };
  }

  /**
   * Clear all cached notifications
   */
  async clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(NOTIFICATION_CACHE_KEY);
      await AsyncStorage.removeItem(LAST_FETCH_KEY);
      this.cachedNotifications = [];
      this.unreadCount = 0;
    } catch (error) {
      console.error('Error clearing notification cache:', error);
    }
  }
}

export const notificationService = NotificationService.getInstance();
