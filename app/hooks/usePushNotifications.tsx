import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';

/**
 * Hook: usePushNotifications
 * - Registers the device for Expo push notifications on mount
 * - Returns the Expo push token (or null) and a manual `register` function
 *
 * Usage:
 * const { expoPushToken, register } = usePushNotifications();
 */
export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  // Register function (memoized)
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

      if (finalStatus !== 'granted') {
        console.warn('Failed to get push token for push notifications');
        return;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync();
      setExpoPushToken(tokenResponse.data);

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: 'rgba(255,35,31,0.486)'
        });
      }
    } catch (e) {
      console.warn('usePushNotifications: register failed', (e as any)?.message || e);
    }
  }, []);

  // Register once on mount. `register` is memoized so it can be
  // safely added to the dependency array without causing re-renders.
  useEffect(() => {
    register();
  }, [register]);

  return { expoPushToken, register };
}

export default usePushNotifications;
