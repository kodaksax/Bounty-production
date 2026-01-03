import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useWebSocket, WebSocketState } from '../hooks/useWebSocket';
import { useAuthContext } from '../hooks/use-auth-context';
import { logClientInfo, logClientError } from '../lib/services/monitoring';

interface WebSocketContextValue extends WebSocketState {
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  lastConnectedAt: Date | null;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuthContext();
  const webSocketState = useWebSocket();
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor' | 'disconnected'>('disconnected');
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Enhanced reconnect with exponential backoff
   */
  const enhancedReconnect = useCallback(async () => {
    if (!isLoggedIn) {
      logClientInfo('Skipping reconnect - user not logged in');
      return;
    }

    const maxAttempts = 10;
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 60 seconds

    setReconnectAttempts((attempts) => {
      if (attempts >= maxAttempts) {
        logClientError('Max reconnection attempts reached', { attempts });
        setConnectionQuality('disconnected');
        return attempts;
      }

      // Clear any existing timeout to prevent race conditions
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
      
      logClientInfo(`Reconnecting (attempt ${attempts + 1}/${maxAttempts}) in ${delay}ms`);
      
      reconnectTimeoutRef.current = setTimeout(async () => {
        try {
          await webSocketState.reconnect();
          setReconnectAttempts(0); // Reset on successful reconnect
          setConnectionQuality('good');
          setLastConnectedAt(new Date());
          reconnectTimeoutRef.current = null;
        } catch (error) {
          logClientError('Reconnection failed', { error, attempts: attempts + 1 });
          setReconnectAttempts(attempts + 1);
          setConnectionQuality('poor');
          reconnectTimeoutRef.current = null;
        }
      }, delay);

      return attempts;
    });
  }, [isLoggedIn, webSocketState]);

  /**
   * Monitor connection state and update quality
   */
  useEffect(() => {
    if (webSocketState.isConnected) {
      setConnectionQuality('excellent');
      setLastConnectedAt(new Date());
      setReconnectAttempts(0);
    } else {
      // If we were previously connected, this is a disconnect
      if (lastConnectedAt) {
        setConnectionQuality('poor');
        // Attempt to reconnect
        enhancedReconnect();
      } else {
        setConnectionQuality('disconnected');
      }
    }
  }, [webSocketState.isConnected, lastConnectedAt]);

  /**
   * Manage connection based on auth state
   */
  useEffect(() => {
    const { isConnected, connect, disconnect } = webSocketState;
    
    if (isLoggedIn && !isConnected) {
      logClientInfo('User logged in, connecting WebSocket');
      connect().catch((error) => {
        logClientError('Failed to connect WebSocket on login', { error });
      });
    } else if (!isLoggedIn && isConnected) {
      logClientInfo('User logged out, disconnecting WebSocket');
      disconnect();
      setConnectionQuality('disconnected');
      setLastConnectedAt(null);
      setReconnectAttempts(0);
      
      // Clear any pending reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
  }, [isLoggedIn, webSocketState.isConnected, webSocketState.connect, webSocketState.disconnect]);

  const contextValue: WebSocketContextValue = {
    ...webSocketState,
    connectionQuality,
    lastConnectedAt,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}
