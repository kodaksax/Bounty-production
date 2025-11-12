import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  startSessionMonitoring,
  setupAuthStateListener,
  onSessionExpiration,
  checkSessionExpiration,
  type SessionState,
} from '../lib/utils/session-handler';
import { Alert } from 'react-native';

/**
 * Hook to monitor session expiration and handle auto-logout
 */
export function useSessionMonitor() {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>({
    isExpired: false,
    expiresAt: null,
    needsRefresh: false,
  });

  useEffect(() => {
    // Check session state immediately
    checkSessionExpiration().then(setSessionState);

    // Set up session expiration callback
    const unsubscribeExpiration = onSessionExpiration(() => {
      Alert.alert(
        'Session Expired',
        'Your session has expired. Please sign in again to continue.',
        [
          {
            text: 'Sign In',
            onPress: () => {
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
      unsubscribeExpiration();
      stopMonitoring();
      unsubscribeAuthState();
    };
  }, [router]);

  return sessionState;
}
