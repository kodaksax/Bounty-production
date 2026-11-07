import NetInfo from '@react-native-community/netinfo';
import { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { logClientError, logClientVerbose } from '../lib/services/monitoring';
import { wsAdapter } from '../lib/services/websocket-adapter';
import { supabase } from '../lib/supabase';
import { safeCleanup } from '../lib/utils/lifecycle';
import { waitForAuthEvent as waitForAuthEventShared } from '../lib/utils/supabase-auth';

export interface WebSocketState {
  isConnected: boolean;
  connectionState: string;
  reconnectAttempts: number;
}

const verboseClient = process.env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE === '1';

/**
 * Hook to manage WebSocket connection lifecycle
 *
 * Features:
 * - Auto-connect on mount (when authenticated)
 * - Auto-reconnect on network changes
 * - Auto-reconnect on app foreground
 * - Clean disconnect on unmount
 */
export function useWebSocket() {
  const mountedRef = useRef(true);
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    connectionState: 'CLOSED',
    reconnectAttempts: 0,
  });

  const updateState = useCallback(() => {
    if (!mountedRef.current) return;
    setState({
      isConnected: wsAdapter.isConnected(),
      connectionState: wsAdapter.getConnectionState(),
      reconnectAttempts: 0, // We don't expose this from wsAdapter currently
    });
  }, []);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    try {
      // Check if user is authenticated. If no session, wait briefly for auth state to change.
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        logClientVerbose('WebSocket connect skipped - no active session; waiting briefly for auth');

        // Wait up to 5s for a SIGNED_IN event that provides a session
        const awaited = await waitForAuthEvent(5000);

        if (!awaited) {
          logClientVerbose('No session after waiting, aborting WebSocket connect');
          return;
        }

        // Update the local session variable so subsequent logic sees the signed-in session
        session = awaited;
      }

      logClientVerbose('Initiating WebSocket connection');
      await wsAdapter.connect();
    } catch (error) {
      logClientError('Error connecting to WebSocket', { error });
    }
  }, []);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    logClientVerbose('Disconnecting WebSocket');
    wsAdapter.disconnect();
    updateState();
  }, [updateState]);

  // Reconnect WebSocket
  const reconnect = useCallback(() => {
    logClientVerbose('Reconnecting WebSocket');
    wsAdapter.reconnect();
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Set up event listeners
    const unsubscribeConnect = wsAdapter.on('connect', () => {
      logClientVerbose('WebSocket connected');
      updateState();
    });

    const unsubscribeDisconnect = wsAdapter.on('disconnect', () => {
      logClientVerbose('WebSocket disconnected');
      updateState();
    });

    const unsubscribeError = wsAdapter.on('error', error => {
      // Don't spam error logs in development when backend is unreachable
      if (!__DEV__ || verboseClient) {
        logClientError('WebSocket error', { error });
      }
      updateState();
    });

    // Initial connect handled by provider based on auth state to avoid double connect spam

    // Handle app state changes (reconnect when app comes to foreground)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        logClientVerbose('App became active, checking WebSocket connection');
        if (!wsAdapter.isConnected()) {
          connect();
        }
      } else if (nextAppState === 'background') {
        logClientVerbose('App went to background');
        // Keep connection alive in background for notifications
        // Could disconnect here if you want to save battery
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Handle network state changes
    const unsubscribeNetInfo = NetInfo.addEventListener(state => {
      if (state.isConnected && !wsAdapter.isConnected()) {
        logClientVerbose('Network reconnected, reconnecting WebSocket');
        connect();
      } else if (!state.isConnected) {
        logClientVerbose('Network disconnected');
      }
    });

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      unsubscribeConnect();
      unsubscribeDisconnect();
      unsubscribeError();
      safeCleanup(appStateSubscription);
      safeCleanup(unsubscribeNetInfo);
      disconnect();
    };
  }, [connect, disconnect, updateState]);

  return {
    ...state,
    connect,
    disconnect,
    reconnect,
  };
}

// Helper to wait for auth state change that provides a session.
// Exported for unit testing the timing-dependent behavior.
export async function waitForAuthEvent(timeoutMs = 5000): Promise<Session | null> {
  return waitForAuthEventShared(timeoutMs);
}

/**
 * Hook to listen for specific WebSocket events
 *
 * Example:
 * ```
 * useWebSocketEvent('message.new', (data) => {
 *   console.log('New message:', data);
 * });
 * ```
 */
export function useWebSocketEvent(event: string, handler: (data: any) => void) {
  useEffect(() => {
    const unsubscribe = wsAdapter.on(event, handler);
    return unsubscribe;
  }, [event, handler]);
}

/**
 * Hook to manage conversation subscriptions
 *
 * Automatically joins conversations and handles typing indicators
 */
export function useConversationWebSocket(conversationId: string | null) {
  const [isTyping, setIsTyping] = useState<{ [userId: string]: boolean }>({});

  useEffect(() => {
    if (!conversationId) return;

    // Join conversation room
    wsAdapter.joinConversation(conversationId);

    // Listen for typing events
    const unsubscribeTypingStart = wsAdapter.on('typing.start', data => {
      if (data.conversationId === conversationId) {
        setIsTyping(prev => ({ ...prev, [data.senderId]: true }));
      }
    });

    const unsubscribeTypingStop = wsAdapter.on('typing.stop', data => {
      if (data.conversationId === conversationId) {
        setIsTyping(prev => ({ ...prev, [data.senderId]: false }));
      }
    });

    // Cleanup
    return () => {
      wsAdapter.leaveConversation(conversationId);
      unsubscribeTypingStart();
      unsubscribeTypingStop();
    };
  }, [conversationId]);

  // Send typing indicator
  const sendTyping = useCallback(
    (typing: boolean) => {
      if (conversationId) {
        wsAdapter.sendTyping(conversationId, typing);
      }
    },
    [conversationId]
  );

  return {
    isTyping,
    sendTyping,
  };
}
