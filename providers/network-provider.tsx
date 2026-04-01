/**
 * NetworkProvider
 *
 * Centralized React context that provides a single, shared NetInfo subscription
 * for the entire app. Components access network state via the useNetworkContext()
 * hook, avoiding redundant NetInfo subscriptions across individual hooks and screens.
 *
 * This provider should wrap the app at the top level (before auth, websocket, etc.)
 * so that all downstream providers and screens can react to network changes.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface NetworkContextValue {
  /** Whether the device has a network connection */
  isConnected: boolean;
  /** Whether the internet is actually reachable (may be null while unknown) */
  isInternetReachable: boolean | null;
  /** Connection type (wifi, cellular, none, etc.) */
  connectionType: string | null;
  /** Whether a manual connectivity check is in progress */
  isChecking: boolean;
  /** Manually trigger a connectivity check */
  checkConnection: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState<boolean | null>(null);
  const [connectionType, setConnectionType] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const prevConnectedRef = useRef(true);

  // Apply state from a NetInfo snapshot
  const applyNetState = useCallback((state: NetInfoState) => {
    const connected = !!state.isConnected;
    const reachable = state.isInternetReachable ?? null;
    const type = state.type ?? null;

    prevConnectedRef.current = connected;
    setIsConnected(connected);
    setIsInternetReachable(reachable);
    setConnectionType(type);
  }, []);

  // Subscribe once on mount
  useEffect(() => {
    // Fetch initial state
    NetInfo.fetch().then(applyNetState).catch(() => {
      // If initial fetch fails, assume connected to avoid blocking
    });

    // Subscribe to ongoing changes
    const unsubscribe = NetInfo.addEventListener(applyNetState);

    return () => {
      unsubscribe();
    };
  }, [applyNetState]);

  // Manual connectivity check
  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      applyNetState(state);
    } catch (error) {
      console.error('[NetworkProvider] Failed to check connection:', error);
    } finally {
      setIsChecking(false);
    }
  }, [applyNetState]);

  const value: NetworkContextValue = React.useMemo(
    () => ({
      isConnected,
      isInternetReachable,
      connectionType,
      isChecking,
      checkConnection,
    }),
    [isConnected, isInternetReachable, connectionType, isChecking, checkConnection],
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

/**
 * Hook to access the centralized network state.
 * Must be used within a NetworkProvider.
 */
export function useNetworkContext(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetworkContext must be used within a NetworkProvider');
  }
  return context;
}

/**
 * Optional hook that returns the context if available, or undefined if not
 * wrapped in a provider (useful for gradual adoption or standalone components).
 */
export function useOptionalNetworkContext(): NetworkContextValue | undefined {
  return useContext(NetworkContext);
}
