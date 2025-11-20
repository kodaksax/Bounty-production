import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { useWebSocket, WebSocketState } from '../hooks/useWebSocket';
import { useAuthContext } from '../hooks/use-auth-context';

interface WebSocketContextValue extends WebSocketState {
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuthContext();
  const webSocketState = useWebSocket();

  // Only connect when user is logged in
  useEffect(() => {
    if (isLoggedIn && !webSocketState.isConnected) {
      webSocketState.connect();
    } else if (!isLoggedIn && webSocketState.isConnected) {
      webSocketState.disconnect();
    }
  }, [isLoggedIn]);

  return (
    <WebSocketContext.Provider value={webSocketState}>
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
