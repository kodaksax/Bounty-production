import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../hooks/use-auth-context';
import { useWebSocket, WebSocketState } from '../hooks/useWebSocket';
import { logClientError, logClientInfo } from '../lib/services/monitoring';
import { useOptionalNetworkContext } from './network-provider';

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
  const networkCtx = useOptionalNetworkContext();
  const webSocketState = useWebSocket();
  const { reconnect } = webSocketState;
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor' | 'disconnected'>('disconnected');
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const prevIsConnectedRef = useRef<boolean | null>(null);
  // Ref to always hold the latest enhancedReconnect without being a dep of itself.
  // Initialized to a dev-only warning stub; the sync effect below replaces it
  // before any async reconnect timer could fire.
  const enhancedReconnectRef = useRef<() => Promise<void>>(
    __DEV__
      ? async () => { console.warn('[WebSocketProvider] enhancedReconnectRef called before initialization'); }
      : async () => {}
  );

  /**
   * Enhanced reconnect with exponential backoff.
   * Depends on isLoggedIn and the destructured stable reconnect callback
   * (not the whole webSocketState object) to avoid a new function reference on
   * every render, which would cause the monitoring useEffect below to fire
   * continuously and produce a "Maximum update depth exceeded" error.
   */
  const enhancedReconnect = useCallback(async () => {
    if (!isLoggedIn) {
      logClientInfo('Skipping reconnect - user not logged in');
      return;
    }

    const maxAttempts = 10;
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 60 seconds

    const attempts = reconnectAttemptsRef.current;
    
    if (attempts >= maxAttempts) {
      logClientError('Max reconnection attempts reached', { attempts });
      setConnectionQuality('disconnected');
      return;
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
        await reconnect();
        reconnectAttemptsRef.current = 0; // Reset on successful reconnect
        setConnectionQuality('good');
        setLastConnectedAt(new Date());
        reconnectTimeoutRef.current = null;
      } catch (error) {
        logClientError('Reconnection failed', { error, attempts: attempts + 1 });
        reconnectAttemptsRef.current = attempts + 1;
        setConnectionQuality('poor');
        reconnectTimeoutRef.current = null;
        // Use ref to avoid stale-closure issues on self-recursive retry
        enhancedReconnectRef.current();
      }
    }, delay);
  // webSocketState.reconnect is a stable useCallback([]) — safe to destructure
  // and use as dep without referencing the whole webSocketState object.
  }, [isLoggedIn, reconnect]);

  // Keep the ref in sync so the self-recursive retry always calls the latest version
  useEffect(() => {
    enhancedReconnectRef.current = enhancedReconnect;
  }, [enhancedReconnect]);

  /**
   * Monitor connection state and update quality
   */
  useEffect(() => {
    const isConnected = webSocketState.isConnected;

    // Only treat transitions — avoid updating `lastConnectedAt` on every render
    // which would otherwise cause a state update loop when connected.
    const prev = prevIsConnectedRef.current;

    if (isConnected) {
      setConnectionQuality('excellent');
      // Update lastConnectedAt only when transitioning from non-connected -> connected
      if (prev !== true) {
        setLastConnectedAt(new Date());
      }
      reconnectAttemptsRef.current = 0;
    } else {
      // If we were previously connected, this is a disconnect
      if (prev === true) {
        setConnectionQuality('poor');
        // Attempt to reconnect
        enhancedReconnect();
      } else {
        setConnectionQuality('disconnected');
      }
    }

    prevIsConnectedRef.current = isConnected;

    // Clear any pending reconnect timeout on unmount to avoid state updates
    // on an unmounted component (e.g. during hot-reload or error-boundary recovery).
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [webSocketState.isConnected, enhancedReconnect]);

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
      reconnectAttemptsRef.current = 0;
      
      // Clear any pending reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
  }, [isLoggedIn, webSocketState.isConnected, webSocketState.connect, webSocketState.disconnect]);

  /**
   * React to device network state changes from the centralized NetworkProvider.
   * When the device loses network connectivity, proactively mark quality as
   * disconnected and reset reconnect attempts. When connectivity resumes,
   * trigger a reconnection attempt if the user is still logged in.
   */
  const prevDeviceConnectedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!networkCtx) return; // No provider — rely on WS connection monitoring

    const deviceConnected = networkCtx.isConnected;
    const prev = prevDeviceConnectedRef.current;
    prevDeviceConnectedRef.current = deviceConnected;

    // Skip the first render (initial state)
    if (prev === null) return;

    if (!deviceConnected && prev) {
      // Device went offline — proactively mark disconnected
      logClientInfo('Device network lost, marking WebSocket disconnected');
      setConnectionQuality('disconnected');
      reconnectAttemptsRef.current = 0;

      // Clear any pending reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    } else if (deviceConnected && !prev && isLoggedIn) {
      // Device came back online while user is logged in — reconnect
      logClientInfo('Device network restored, triggering WebSocket reconnect');
      reconnectAttemptsRef.current = 0;
      enhancedReconnectRef.current();
    }
  }, [networkCtx?.isConnected, isLoggedIn]);

  const contextValue: WebSocketContextValue = useMemo(() => ({
    ...webSocketState,
    connectionQuality,
    lastConnectedAt,
  }), [webSocketState, connectionQuality, lastConnectedAt]);

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
