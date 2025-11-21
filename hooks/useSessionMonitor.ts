import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
    checkSessionExpiration,
    onSessionExpiration,
    setupAuthStateListener,
    startSessionMonitoring,
    type SessionState,
} from '../lib/utils/session-handler';

/**
 * Hook to monitor session expiration and handle auto-logout
 */
type SessionMonitorOptions = {
  enabled?: boolean;
};

const createDefaultState = (): SessionState => ({
  isExpired: false,
  expiresAt: null,
  needsRefresh: false,
});

export function useSessionMonitor(options: SessionMonitorOptions = {}) {
  const { enabled = true } = options;
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>(createDefaultState);

  useEffect(() => {
    if (!enabled) {
      setSessionState(createDefaultState());
      return;
    }

    let hasAlertShown = false;
    let isActive = true;

    // Check session state immediately
    checkSessionExpiration().then((state) => {
      if (isActive) {
        setSessionState(state);
      }
    });

    // Set up session expiration callback
    const unsubscribeExpiration = onSessionExpiration(() => {
      if (hasAlertShown) {
        return;
      }

      hasAlertShown = true;

      Alert.alert(
        'Session Expired',
        'Your session has expired. Please sign in again to continue.',
        [
          {
            text: 'Sign In',
            onPress: () => {
              hasAlertShown = false;
              router.replace('/auth/sign-in-form');
            },
          },
        ],
        { cancelable: false }
      );
    });

    // Start monitoring
    const stopMonitoring = startSessionMonitoring();

    // Set up auth state listener
    const unsubscribeAuthState = setupAuthStateListener();

    // Cleanup
    return () => {
      isActive = false;
      unsubscribeExpiration();
      stopMonitoring();
      unsubscribeAuthState();
    };
  }, [enabled, router]);

  return sessionState;
}
