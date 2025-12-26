import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { API_BASE_URL } from 'lib/config/api';
import { API_TIMEOUTS, ERROR_LOG_THROTTLE } from 'lib/config/network';
import { LOG_KEYS, shouldLog } from 'lib/utils/log-throttle';
import { supabase } from '../supabase';
import type { Notification } from '../types';

const NOTIFICATION_CACHE_KEY = 'notifications:cache';
const LAST_FETCH_KEY = 'notifications:last_fetch';
const PERMISSION_STATUS_KEY = 'notifications:permission_status';

// Helper to safely read response text without throwing further errors
async function safeReadResponseText(response: Response): Promise<string> {
  try {
    // clone the response so reading here doesn't consume it for callers
    const text = await response.clone().text()
    return text
  } catch (e) {
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
}

// Try fetching the given path, but if the server responds with a 404 HTML page
// (common when the wrong server is bound to the port), attempt a fallback
// by prefixing the path with `/api` and retrying once. Accepts either relative
// paths (preferred) or absolute URLs without double-prefixing the API base.
async function fetchWithApiFallback(path: string, init?: RequestInit): Promise<Response> {
  const isAbsolute = /^https?:\/\//i.test(path)
  const normalizedPath = isAbsolute ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`

  try {
    const res = await fetch(normalizedPath, init)

    // If primary returned 404 with an HTML body like "Cannot GET /..." it's likely
    // the wrong server. In that case, try the /api prefixed path as a fallback.
    if (!isAbsolute && res.status === 404) {
      const text = await safeReadResponseText(res)
      if (typeof text === 'string' && /<html|Cannot GET|Cannot POST/i.test(text)) {
        const fallback = `${API_BASE_URL}/api${path.startsWith('/') ? path : `/${path}`}`
        try {
          const res2 = await fetch(fallback, init)
          // Return the fallback response regardless of status so callers can handle it
          return res2
        } catch (e) {
          // If fallback failed, return original response so original error is preserved
          return res
        }
      }
    }
    return res
  } catch (e) {
    // network-level failure; rethrow so callers can handle
    throw e
  }
}

// Small helper to add an explicit timeout to fetches so we fail fast on unreachable
// dev machines or when a physical device isn’t on the same LAN. React Native’s
// default fetch can take a long time before surfacing a network timeout.
function withTimeout(signal: AbortSignal | undefined, ms = 8000) {
  if (signal) return signal
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  // @ts-ignore attach for cleanup by callers if needed
  controller.__timeoutId = id
  const wrapped = controller.signal
  // Ensure we clear the timer on end consumers that await fetch
  wrapped.addEventListener('abort', () => clearTimeout(id), { once: true })
  return wrapped
}

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
   * Validate and normalize permission status to known values
   */
  private normalizePermissionStatus(status: string | null): 'granted' | 'denied' | 'undetermined' {
    const validStatuses = ['granted', 'denied', 'undetermined'] as const;
    if (status && validStatuses.includes(status as typeof validStatuses[number])) {
      return status as typeof validStatuses[number];
    }
    // Map unexpected values (like 'restricted' on iOS) to 'undetermined'
    return 'undetermined';
  }

  /**
   * Get the current notification permission status without requesting
   */
  async getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      // Store the status for offline access
      await AsyncStorage.setItem(PERMISSION_STATUS_KEY, status);
      return this.normalizePermissionStatus(status);
    } catch (error) {
      console.error('Error getting permission status:', error);
      // Try to get cached status
      try {
        const cached = await AsyncStorage.getItem(PERMISSION_STATUS_KEY);
        return this.normalizePermissionStatus(cached);
      } catch {
        return 'undetermined';
      }
    }
  }

  /**
   * Get stored permission status from cache (async but faster than checking system permissions)
   */
  async getStoredPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | null> {
    try {
      const status = await AsyncStorage.getItem(PERMISSION_STATUS_KEY);
      if (status === null) return null;
      return this.normalizePermissionStatus(status);
    } catch {
      return null;
    }
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

      // Store the permission status
      await AsyncStorage.setItem(PERMISSION_STATUS_KEY, finalStatus);

      if (finalStatus !== 'granted') {
        return null;
      }

      // Get the Expo push token
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      
      // Register token with backend
      await this.registerPushToken(token);

      // Also try to flush any tokens we cached from previous failed attempts
      try { await this.flushPendingPushTokens(); } catch {}

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
        if (__DEV__) {
          console.log('[NotificationService] No active session - skipping push token registration');
        }
        return;
      }

      const url = `${API_BASE_URL}/notifications/register-token`
      const controller = new AbortController()
      const response = await fetchWithApiFallback(url.replace(API_BASE_URL, ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token, deviceId }),
        // add an 8s timeout so we don't hang forever on mobile when the dev API isn't reachable
        signal: withTimeout(controller.signal, 8000),
      });

      if (!response.ok) {
        const text = await safeReadResponseText(response)
        
        // Log different levels based on status code
        if (response.status === 404) {
          // User profile doesn't exist yet - retained for backward compatibility with older backend versions
          // With the current backend fix, this should not occur as profiles are auto-created
          if (__DEV__) {
            console.log(`[NotificationService] User profile not yet created. Backend will create it on next attempt.`)
          }
        } else if (response.status === 409) {
          // Conflict - token already registered, which is fine
          if (__DEV__) {
            console.log(`[NotificationService] Push token already registered (${response.status}).`)
          }
          return; // Don't throw for 409, it means the token is already registered
        } else if (response.status >= 500) {
          console.error(`Failed to register push token. URL=${url} status=${response.status} body=${text}`)
        } else {
          console.warn(`Failed to register push token. URL=${url} status=${response.status} body=${text}`)
        }
        
        throw new Error(`Failed to register push token (${response.status})`)
      } else {
        if (__DEV__) {
          console.log('[NotificationService] Successfully registered push token with backend');
        }
      }

    } catch (error) {
      // Only log actual errors (not expected failures like missing profile)
      // Prefer structured status information on the error object over parsing strings
      let statusCode: number | undefined;

      const anyError = error as any;
      if (anyError && typeof anyError.statusCode === 'number') {
        statusCode = anyError.statusCode;
      } else if (anyError && typeof anyError.status === 'number') {
        statusCode = anyError.status;
      } else if (anyError && anyError.response && typeof anyError.response.status === 'number') {
        statusCode = anyError.response.status;
      } else if (anyError instanceof Error) {
        // Fallback to parsing status code from error message if no structured property exists
        const statusMatch = anyError.message.match(/\((\d{3})\)/);
        if (statusMatch) {
          statusCode = parseInt(statusMatch[1], 10);
        }
      }
      
      const isExpectedError = statusCode === 404 || statusCode === 409;
      
      if (!isExpectedError) {
        console.error('Error registering push token:', error);
      }
      
      // Fallback: try saving directly to Supabase if available (RLS should allow inserting own token)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id
        if (userId) {
          const { error: sbErr } = await supabase.from('push_tokens').upsert({ user_id: userId, token, device_id: deviceId }).select('id').single()
          if (!sbErr) {
            if (__DEV__) {
              console.log('[NotificationService] Successfully registered push token via Supabase fallback');
            }
            return
          }
        }
      } catch {}
      // As a last resort, cache and retry later so the user isn't blocked
      try {
        const pendingStr = await AsyncStorage.getItem('notifications:pending_tokens')
        const pending = pendingStr ? JSON.parse(pendingStr) as Array<{token:string, deviceId?:string}> : []
        pending.push({ token, deviceId })
        await AsyncStorage.setItem('notifications:pending_tokens', JSON.stringify(pending))
        if (__DEV__) {
          console.log('[NotificationService] Cached push token for later registration');
        }
      } catch {}
    }
  }

  /**
   * Fetch notifications from the backend
   */
  async fetchNotifications(limit: number = 50, offset: number = 0): Promise<Notification[]> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return [];
      }

      // First try Supabase directly (more reliable for development)
      const userId = session.user?.id;
      if (userId) {
        try {
          const { data, error: sbErr } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          
          if (!sbErr && data) {
            this.cachedNotifications = data as any;
            await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
            await AsyncStorage.setItem(LAST_FETCH_KEY, new Date().toISOString());
            return this.cachedNotifications;
          }
        } catch (supabaseError) {
          // If Supabase fails, try API as fallback
          if (__DEV__) {
            console.log('[NotificationService] Supabase query failed, trying API fallback');
          }
        }
      }

      // Fallback to API endpoint (with longer timeout for development)
      const url = `${API_BASE_URL}/notifications?limit=${limit}&offset=${offset}`;
      const controller = new AbortController();
      const response = await fetchWithApiFallback(url.replace(API_BASE_URL, ''), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        signal: withTimeout(controller.signal, API_TIMEOUTS.DEFAULT),
      });

      if (!response.ok) {
        // Don't spam console with errors in development when backend is unreachable
        if (__DEV__) {
          if (shouldLog(LOG_KEYS.NOTIF_FETCH_ERROR, ERROR_LOG_THROTTLE.MODERATE)) {
            console.log('[NotificationService] API unreachable, using cached notifications');
          }
        } else {
          const text = await safeReadResponseText(response);
          console.error(`Failed to fetch notifications. URL=${url} status=${response.status} body=${text}`);
        }
        // Return cached notifications instead of throwing
        return this.getCachedNotifications();
      }

      const data = await response.json();
      this.cachedNotifications = data.notifications || [];
      
      // Cache notifications locally
      await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
      await AsyncStorage.setItem(LAST_FETCH_KEY, new Date().toISOString());

      return this.cachedNotifications;
    } catch (error) {
      // Silent failure in development when backend is unreachable
      if (__DEV__) {
        if (shouldLog(LOG_KEYS.NOTIF_FETCH_ERROR, ERROR_LOG_THROTTLE.MODERATE)) {
          console.log('[NotificationService] Backend unreachable - using cached notifications');
        }
      } else {
        console.error('Error fetching notifications:', error);
      }
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

      // First try Supabase directly (more reliable for development)
      const userId = session.user?.id;
      if (userId) {
        try {
          const { count, error: sbErr } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('read', false);
          
          if (!sbErr && typeof count === 'number') {
            this.unreadCount = count;
            return this.unreadCount;
          }
        } catch (supabaseError) {
          // If Supabase fails, try API as fallback
          if (__DEV__) {
            console.log('[NotificationService] Supabase query failed, trying API fallback');
          }
        }
      }

      // Fallback to API endpoint (with longer timeout for development)
      const url = `${API_BASE_URL}/notifications/unread-count`;
      const controller = new AbortController();
      const response = await fetchWithApiFallback(url.replace(API_BASE_URL, ''), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        signal: withTimeout(controller.signal, API_TIMEOUTS.DEFAULT),
      });

      if (!response.ok) {
        // Don't spam console with errors in development when backend is unreachable
        if (__DEV__) {
          if (shouldLog(LOG_KEYS.NOTIF_UNREAD_ERROR, ERROR_LOG_THROTTLE.MODERATE)) {
            console.log('[NotificationService] API unreachable, using cached count');
          }
        } else {
          const text = await safeReadResponseText(response);
          console.error(`Failed to fetch unread count. URL=${url} status=${response.status} body=${text}`);
        }
        return this.unreadCount; // Return cached value instead of throwing
      }

      const data = await response.json();
      this.unreadCount = data.count || 0;
      return this.unreadCount;
    } catch (error) {
      // Silent failure in development when backend is unreachable
      if (__DEV__) {
        if (shouldLog(LOG_KEYS.NOTIF_UNREAD_ERROR, ERROR_LOG_THROTTLE.MODERATE)) {
          console.log('[NotificationService] Backend unreachable - using cached unread count');
        }
      } else {
        console.error('Error fetching unread count:', error);
      }
      return this.unreadCount; // Return cached value
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

      const url = `${API_BASE_URL}/notifications/mark-read`
      const response = await fetchWithApiFallback(url.replace(API_BASE_URL, ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notificationIds }),
      });

      if (!response.ok) {
        const text = await safeReadResponseText(response)
        console.error(`Failed to mark notifications as read. URL=${url} status=${response.status} body=${text}`)
        throw new Error('Failed to mark notifications as read')
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

      const url = `${API_BASE_URL}/notifications/mark-all-read`
      const controller = new AbortController()
      const response = await fetchWithApiFallback(url.replace(API_BASE_URL, ''), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        signal: withTimeout(controller.signal, 8000),
      });

      if (!response.ok) {
        const text = await safeReadResponseText(response)
        console.error(`Failed to mark all notifications as read. URL=${url} status=${response.status} body=${text}`)
        throw new Error('Failed to mark all notifications as read')
      }

      // Update local cache
      this.cachedNotifications = this.cachedNotifications.map(notif => ({ ...notif, read: true }));
      await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
      this.unreadCount = 0;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      // Best-effort Supabase fallback
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id
        if (userId) {
          await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
          this.cachedNotifications = this.cachedNotifications.map(n => ({ ...n, read: true }))
          await AsyncStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(this.cachedNotifications));
          this.unreadCount = 0
        }
      } catch {}
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
      if (onNotificationReceived) {
        onNotificationReceived(notification);
      }
      // Refresh notifications
      this.fetchNotifications();
    });

    // Listener for when user taps on a notification
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
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

  /**
   * Flush any push tokens cached due to earlier network failures.
   */
  private async flushPendingPushTokens() {
    try {
      const str = await AsyncStorage.getItem('notifications:pending_tokens')
      if (!str) return
      const pending = JSON.parse(str) as Array<{token:string, deviceId?:string}>
      await AsyncStorage.removeItem('notifications:pending_tokens')
      for (const p of pending) {
        try { await this.registerPushToken(p.token, p.deviceId) } catch {}
      }
    } catch {}
  }

  /**
   * Send cancellation request notification
   */
  async sendCancellationRequestNotification(
    recipientId: string,
    bountyId: string,
    bountyTitle: string,
    requesterType: 'poster' | 'hunter'
  ): Promise<boolean> {
    try {
      const notification: Omit<Notification, 'id'> = {
        user_id: recipientId,
        type: 'cancellation_request',
        title: 'Cancellation Request',
        body: `The ${requesterType} has requested to cancel the bounty "${bountyTitle}"`,
        data: {
          bountyId,
        },
        read: false,
        created_at: new Date().toISOString(),
      };

      // Insert notification directly into Supabase
      const { error } = await supabase
        .from('notifications')
        .insert(notification);

      if (error) {
        console.error('Error creating cancellation request notification:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error sending cancellation request notification:', error);
      return false;
    }
  }

  /**
   * Send cancellation accepted notification
   */
  async sendCancellationAcceptedNotification(
    recipientId: string,
    bountyId: string,
    bountyTitle: string,
    refundAmount: number
  ): Promise<boolean> {
    try {
      const notification: Omit<Notification, 'id'> = {
        user_id: recipientId,
        type: 'cancellation_accepted',
        title: 'Cancellation Accepted',
        body: `Your cancellation request for "${bountyTitle}" has been accepted. Refund: $${refundAmount.toFixed(2)}`,
        data: {
          bountyId,
          amount: refundAmount,
        },
        read: false,
        created_at: new Date().toISOString(),
      };

      // Insert notification directly into Supabase
      const { error } = await supabase
        .from('notifications')
        .insert(notification);

      if (error) {
        console.error('Error creating cancellation accepted notification:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error sending cancellation accepted notification:', error);
      return false;
    }
  }

  /**
   * Send cancellation rejected notification
   */
  async sendCancellationRejectedNotification(
    recipientId: string,
    bountyId: string,
    bountyTitle: string,
    reason: string
  ): Promise<boolean> {
    try {
      const notification: Omit<Notification, 'id'> = {
        user_id: recipientId,
        type: 'cancellation_rejected',
        title: 'Cancellation Rejected',
        body: `Your cancellation request for "${bountyTitle}" has been rejected. Reason: ${reason}`,
        data: {
          bountyId,
        },
        read: false,
        created_at: new Date().toISOString(),
      };

      // Insert notification directly into Supabase
      const { error } = await supabase
        .from('notifications')
        .insert(notification);

      if (error) {
        console.error('Error creating cancellation rejected notification:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error sending cancellation rejected notification:', error);
      return false;
    }
  }
}

export const notificationService = NotificationService.getInstance();
