import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
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

    if (reconnectAttempts >= maxAttempts) {
      logClientError('Max reconnection attempts reached', { attempts: reconnectAttempts });
      setConnectionQuality('disconnected');
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
    
    logClientInfo(`Reconnecting (attempt ${reconnectAttempts + 1}/${maxAttempts}) in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await webSocketState.reconnect();
        setReconnectAttempts(0); // Reset on successful reconnect
        setConnectionQuality('good');
        setLastConnectedAt(new Date());
      } catch (error) {
        logClientError('Reconnection failed', { error, attempts: reconnectAttempts + 1 });
        setReconnectAttempts((prev) => prev + 1);
        setConnectionQuality('poor');
      }
    }, delay);
  }, [isLoggedIn, reconnectAttempts, webSocketState]);

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
  }, [webSocketState.isConnected, lastConnectedAt, enhancedReconnect]);

  /**
   * Manage connection based on auth state
   */
  useEffect(() => {
    if (isLoggedIn && !webSocketState.isConnected) {
      logClientInfo('User logged in, connecting WebSocket');
      webSocketState.connect().catch((error) => {
        logClientError('Failed to connect WebSocket on login', { error });
      });
    } else if (!isLoggedIn && webSocketState.isConnected) {
      logClientInfo('User logged out, disconnecting WebSocket');
      webSocketState.disconnect();
      setConnectionQuality('disconnected');
      setLastConnectedAt(null);
      setReconnectAttempts(0);
    }
  }, [isLoggedIn, webSocketState.isConnected]);

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
