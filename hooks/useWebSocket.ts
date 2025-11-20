import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { logClientError, logClientInfo } from '../lib/services/monitoring';
import { wsAdapter } from '../lib/services/websocket-adapter';
import { supabase } from '../lib/supabase';

export interface WebSocketState {
  isConnected: boolean;
  connectionState: string;
  reconnectAttempts: number;
}

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
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    connectionState: 'CLOSED',
    reconnectAttempts: 0,
  });

  const updateState = useCallback(() => {
    setState({
      isConnected: wsAdapter.isConnected(),
      connectionState: wsAdapter.getConnectionState(),
      reconnectAttempts: 0, // We don't expose this from wsAdapter currently
    });
  }, []);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    try {
      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        logClientInfo('WebSocket connect skipped - no active session');
        return;
      }

      logClientInfo('Initiating WebSocket connection');
      await wsAdapter.connect();
    } catch (error) {
      logClientError('Error connecting to WebSocket', { error });
    }
  }, []);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    logClientInfo('Disconnecting WebSocket');
    wsAdapter.disconnect();
    updateState();
  }, [updateState]);

  // Reconnect WebSocket
  const reconnect = useCallback(() => {
    logClientInfo('Reconnecting WebSocket');
    wsAdapter.reconnect();
  }, []);

  useEffect(() => {
    // Set up event listeners
    const verboseClient = process.env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE === '1';
    const unsubscribeConnect = wsAdapter.on('connect', () => {
      if (verboseClient) logClientInfo('WebSocket connected');
      updateState();
    });

    const unsubscribeDisconnect = wsAdapter.on('disconnect', () => {
      if (verboseClient) logClientInfo('WebSocket disconnected');
      updateState();
    });

    const unsubscribeError = wsAdapter.on('error', (error) => {
      logClientError('WebSocket error', { error });
      updateState();
    });

    // Initial connect handled by provider based on auth state to avoid double connect spam

    // Handle app state changes (reconnect when app comes to foreground)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        logClientInfo('App became active, checking WebSocket connection');
        if (!wsAdapter.isConnected()) {
          connect();
        }
      } else if (nextAppState === 'background') {
        logClientInfo('App went to background');
        // Keep connection alive in background for notifications
        // Could disconnect here if you want to save battery
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Handle network state changes
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && !wsAdapter.isConnected()) {
        logClientInfo('Network reconnected, reconnecting WebSocket');
        connect();
      } else if (!state.isConnected) {
        logClientInfo('Network disconnected');
      }
    });

    // Cleanup on unmount
    return () => {
      unsubscribeConnect();
      unsubscribeDisconnect();
      unsubscribeError();
      appStateSubscription.remove();
      unsubscribeNetInfo();
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
    const unsubscribeTypingStart = wsAdapter.on('typing.start', (data) => {
      if (data.conversationId === conversationId) {
        setIsTyping((prev) => ({ ...prev, [data.senderId]: true }));
      }
    });

    const unsubscribeTypingStop = wsAdapter.on('typing.stop', (data) => {
      if (data.conversationId === conversationId) {
        setIsTyping((prev) => ({ ...prev, [data.senderId]: false }));
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
