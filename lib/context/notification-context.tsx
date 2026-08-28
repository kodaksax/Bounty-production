// Lazily require expo-notifications to avoid native import at module evaluation time
import { useRouter } from 'expo-router';
import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { navigationIntent } from '../services/navigation-intent';
import { resolveNotificationDeepLink } from '../services/notification-deep-links';
import { notificationService } from '../services/notification-service';
import { isNotificationsChannelConnected, subscribeToNotifications } from '../services/notification-realtime';
import { supabase } from '../supabase';
import type { Notification } from '../types';
import { safeCleanup } from '../utils/lifecycle';
import {
    resolveSupabaseAuthSubscription,
    safeUnsubscribe,
    SupabaseAuthSubscription,
} from '../utils/supabase-subscription';
let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

// Delay before navigating to ensure router is ready (milliseconds)
const ROUTER_READY_DELAY_MS = 100;

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
  const isMountedRef = useRef(true);
  // Tracks the signed-in user id so the realtime subscription below can
  // rebuild itself when the user changes (sign-out/sign-in without a full
  // app remount, e.g. on a shared device) instead of staying subscribed
  // to — or filtered on — the previous user.
  const [userId, setUserId] = useState<string | null>(null);
  // Whether the notifications realtime channel is currently SUBSCRIBED, so
  // the polling fallback below can skip redundant network calls once
  // realtime is actually delivering events.
  const realtimeConnectedRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const fetchedNotifications = await notificationService.fetchNotifications();
      if (!isMountedRef.current) return;
      setNotifications(fetchedNotifications);

      // Update unread count
      const count = fetchedNotifications.filter(n => !n.read).length;
      setUnreadCount(count);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await notificationService.getUnreadCount();
      // Skip the state update (and the re-render fan-out to every consumer)
      // when the poll returns the same count as last time.
      if (isMountedRef.current) setUnreadCount(prev => (prev === count ? prev : count));
    } catch {
      // Silent failure - getUnreadCount already handles logging appropriately
      // Don't spam console with additional error messages
    }
  }, []);

  const markAsRead = useCallback(async (notificationIds: string[]) => {
    try {
      await notificationService.markAsRead(notificationIds);

      // Update local state
      if (!isMountedRef.current) return;
      setNotifications(prev =>
        prev.map(notif => (notificationIds.includes(notif.id) ? { ...notif, read: true } : notif))
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

      if (!isMountedRef.current) return;
      // Update local state
      setNotifications(prev => prev.map(notif => ({ ...notif, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }, []);

  // Handle notification tap navigation. Delegates to the shared deep-link
  // registry (lib/services/notification-deep-links.ts) so cold-start and
  // warm-tap paths — and the Notification Center's own tap handling — all
  // resolve destinations identically instead of duplicating this logic.
  const handleNotificationTap = useCallback(
    async (response: any) => {
      const data = response.notification.request.content.data || {};
      const type = data.type || 'update';
      const action = resolveNotificationDeepLink({ type, data });

      if (action.kind === 'route') {
        router.push(action.path as any);
      } else if (action.kind === 'conversation') {
        await navigationIntent.setPendingConversationId(action.conversationId);
        router.push('/tabs/bounty-app?screen=messages');
      } else if (data.senderId) {
        // Legacy fallback for payloads that predate the `type` field.
        router.push(`/profile/${data.senderId}` as any);
      }
    },
    [router]
  );

  // Track whether initial notification has been handled to prevent duplicate navigation
  const initialNotificationHandled = useRef(false);

  // Check for notification that launched the app
  const checkInitialNotification = useCallback(async () => {
    // Prevent duplicate handling
    if (initialNotificationHandled.current) return;

    try {
      if (!Notifications) {
        // try to require at runtime if not already loaded
        try {
          Notifications = require('expo-notifications');
        } catch {
          /* ignore */
        }
      }
      const response = Notifications
        ? await Notifications.getLastNotificationResponseAsync()
        : null;
      if (response) {
        initialNotificationHandled.current = true;
        // Small delay to ensure router is ready
        setTimeout(() => {
          if (isMountedRef.current) {
            handleNotificationTap(response);
          }
        }, ROUTER_READY_DELAY_MS);
      }
    } catch (error) {
      console.error('Error checking initial notification:', error);
    }
  }, [handleNotificationTap]);

  // Re-attempt token registration whenever the app comes to the foreground.
  // This covers two cases that the mount-time call misses:
  //   1. Session wasn't ready at mount → registerPushToken skipped silently
  //   2. User enabled notifications in iOS Settings after denying at first prompt
  useEffect(() => {
    let lastAppState = AppState.currentState;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (lastAppState !== 'active' && nextState === 'active') {
        notificationService
          .requestPermissionsAndRegisterToken()
          .then(token => {
            if (__DEV__) {
              console.log(
                '[NotificationContext] foreground re-registration result:',
                token ?? 'no token (permissions denied or session missing)'
              );
            }
          })
          .catch(error => {
            if (__DEV__) {
              console.warn('[NotificationContext] foreground re-registration failed:', error);
            }
          });
      }
      lastAppState = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => safeCleanup(sub);
  }, []);

  // Setup notification listeners and request permissions on mount
  useEffect(() => {
    // Request permissions and register token
    notificationService
      .requestPermissionsAndRegisterToken()
      .then(token => {
        if (__DEV__) {
          console.log(
            '[NotificationContext] mount registration result:',
            token ?? 'no token (permissions denied or session missing)'
          );
        }
      })
      .catch(error => {
        if (__DEV__) {
          console.warn('[NotificationContext] mount registration failed:', error);
        }
      });

    // Check if app was opened from a notification
    checkInitialNotification();

    // Ensure Notifications is available when setting up listeners
    if (!Notifications) {
      try {
        Notifications = require('expo-notifications');
      } catch {
        /* ignore */
      }
    }

    // Setup listeners
    const listeners = notificationService.setupNotificationListeners(
      // On notification received (foreground)
      (notification: any) => {
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
      safeCleanup(listeners);
    };
  }, [fetchNotifications, refreshUnreadCount, handleNotificationTap, checkInitialNotification]);

  // Track the signed-in user id so the realtime subscription effect below
  // can rebuild when it changes.
  useEffect(() => {
    let cancelled = false;
    let cleanupRequested = false;
    let authSubscription: SupabaseAuthSubscription | undefined;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setUserId(session?.user?.id ?? null);
    });

    const ret = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserId(null);
      } else if (session?.user?.id) {
        setUserId(session.user.id);
      }
    });

    resolveSupabaseAuthSubscription(
      ret,
      resolvedSubscription => {
        authSubscription = resolvedSubscription;
        if (cleanupRequested) {
          safeUnsubscribe(authSubscription);
        }
      },
      error => {
        console.error('[NotificationContext] Failed to register auth listener:', error);
      }
    );

    return () => {
      cancelled = true;
      cleanupRequested = true;
      safeUnsubscribe(authSubscription);
    };
  }, []);

  // React to the signed-in user changing while the app stays foregrounded
  // (e.g. sign out then sign back in as a different account without
  // backgrounding). NotificationProvider lives at the app root and never
  // remounts on account switch, so without this the previous account's
  // notifications and badge stay on screen until a realtime insert or a
  // pull-to-refresh forces a fetch.
  useEffect(() => {
    // Drop the previous account's notifications and badge from state right
    // away, including on sign-out (userId → null).
    setNotifications([]);
    setUnreadCount(0);

    if (!userId) return;

    // Refetch for the newly signed-in user and re-register the push token so
    // the device's token isn't left associated with the previous user.
    fetchNotifications();
    notificationService.requestPermissionsAndRegisterToken().catch(error => {
      if (__DEV__) {
        console.warn('[NotificationContext] re-registration on user change failed:', error);
      }
    });
  }, [userId, fetchNotifications]);

  // Realtime subscription to notifications table so unread count and list
  // update immediately when a new notification is inserted for this user.
  // Rebuilds whenever `userId` changes so a sign-out/sign-in without a full
  // app remount doesn't leave the channel filtered on the previous user.
  useEffect(() => {
    realtimeConnectedRef.current = false;
    if (!userId) return;

    // Shared, reference-counted channel (lib/services/notification-realtime.ts)
    // — the bell badge and the Notification Center screen can both subscribe
    // to the same `notifications:${userId}` feed without opening duplicate
    // realtime channels.
    const unsubscribe = subscribeToNotifications(userId, () => {
      try {
        fetchNotifications();
        refreshUnreadCount();
      } catch (e) {
        console.error('notif realtime fetch failed', e);
      }
    });

    // isNotificationsChannelConnected reflects the shared channel's join
    // state; poll it briefly after subscribing so the fallback-poll gate
    // below reacts once the channel actually reaches SUBSCRIBED.
    const checkConnected = () => {
      realtimeConnectedRef.current = isNotificationsChannelConnected(userId);
    };
    checkConnected();
    const connectedCheckInterval = setInterval(checkConnected, 2000);

    return () => {
      realtimeConnectedRef.current = false;
      clearInterval(connectedCheckInterval);
      unsubscribe();
    };
  }, [userId, fetchNotifications, refreshUnreadCount]);

  // Track mounted state to prevent setState after unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fallback poll for unread count. Now that the realtime channel above is
  // actually wired to a published table, this should rarely fire — it skips
  // the network call entirely whenever the realtime channel is SUBSCRIBED,
  // and pauses while the app is backgrounded. It only does real work when
  // realtime hasn't (yet) connected.
  useEffect(() => {
    const tick = () => {
      if (realtimeConnectedRef.current) return;
      if (AppState.currentState !== 'active') return;
      refreshUnreadCount();
    };

    const interval = setInterval(tick, 30000); // 30 seconds

    // Register interval for test cleanup
    if (process.env.NODE_ENV === 'test') {
      const _i = interval as any;
      if (typeof _i?.unref === 'function') {
        try {
          _i.unref();
        } catch {
          /* ignore */
        }
      }
      (globalThis as any).__BACKGROUND_INTERVALS = (globalThis as any).__BACKGROUND_INTERVALS || [];
      (globalThis as any).__BACKGROUND_INTERVALS.push(interval);
    }

    return () => {
      clearInterval(interval);
    };
  }, [refreshUnreadCount]);

  // Memoized so consumers only re-render when notifications/unreadCount/loading
  // actually change, not on every 30s poll tick when the count is unchanged
  // (refreshUnreadCount above already skips the setState in that case, but
  // memoizing here also protects against re-renders from unrelated state in
  // this provider, e.g. AppState listener churn).
  const value: NotificationContextType = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      refreshUnreadCount,
    }),
    [
      notifications,
      unreadCount,
      loading,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      refreshUnreadCount,
    ]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
