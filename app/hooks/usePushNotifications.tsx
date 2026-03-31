import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';

/**
 * Hook: usePushNotifications
 * - Does NOT request permissions automatically on mount (contextual opt-in).
 * - Checks current permission status on mount and obtains the token only when
 *   permissions are already granted.
 * - Exposes a `register` function that callers can invoke at contextual moments
 *   (e.g. after the user posts their first bounty) to trigger the OS prompt.
 * - Sets up categorised Android notification channels when permissions are granted.
 *
 * Usage:
 * const { expoPushToken, permissionStatus, register } = usePushNotifications();
 */
export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  // Setup Android notification channels for categorised delivery
  const setupAndroidChannels = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      await Promise.all([
        Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages',
          description: 'Chat message notifications',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#10B981',
        }),
        Notifications.setNotificationChannelAsync('bounties', {
          name: 'Bounties',
          description: 'Bounty applications, acceptances and updates',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#10B981',
        }),
        Notifications.setNotificationChannelAsync('payments', {
          name: 'Payments',
          description: 'Payment and payout notifications',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#10B981',
        }),
        Notifications.setNotificationChannelAsync('system', {
          name: 'System',
          description: 'System and account notifications',
          importance: Notifications.AndroidImportance.DEFAULT,
        }),
        // Keep a default channel as a fallback
        Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#10B981',
        }),
      ]);
    } catch (e) {
      console.warn('usePushNotifications: failed to set up Android channels', (e as any)?.message || e);
    }
  }, []);

  // Register function – requests the OS permission prompt and obtains the token.
  // Call this at a contextual moment rather than on startup.
  const register = useCallback(async () => {
    try {
      if (!Device.isDevice) {
        console.warn('Push notifications require a physical device.');
        return;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      setPermissionStatus(
        finalStatus === 'granted' ? 'granted' : finalStatus === 'denied' ? 'denied' : 'undetermined'
      );

      if (finalStatus !== 'granted') {
        console.warn('Failed to get push token for push notifications');
        return;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync();
      setExpoPushToken(tokenResponse.data);

      await setupAndroidChannels();
    } catch (e) {
      console.warn('usePushNotifications: register failed', (e as any)?.message || e);
    }
  }, [setupAndroidChannels]);

  // On mount, only check current status and obtain token if already granted.
  // Do NOT trigger the OS permission prompt (contextual opt-in).
  useEffect(() => {
    (async () => {
      try {
        if (!Device.isDevice) return;
        const { status } = await Notifications.getPermissionsAsync();
        setPermissionStatus(
          status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
        );

        if (status === 'granted') {
          const tokenResponse = await Notifications.getExpoPushTokenAsync();
          setExpoPushToken(tokenResponse.data);
          await setupAndroidChannels();
        }
      } catch (e) {
        console.warn('usePushNotifications: init check failed', (e as any)?.message || e);
      }
    })();
  }, [setupAndroidChannels]);

  return { expoPushToken, permissionStatus, register };
}

export default usePushNotifications;
