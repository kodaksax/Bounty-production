/**
 * WebSocket Adapter - Placeholder for real-time messaging
 * 
 * This is a mock implementation using an event emitter pattern.
 * Replace with actual WebSocket connection when backend is ready.
 */

type EventHandler = (data: any) => void;

class WebSocketAdapter {
  private listeners: Map<string, EventHandler[]> = new Map();
  private connected: boolean = false;
  private reconnectTimer?: NodeJS.Timeout;

  /**
   * Connect to WebSocket server
   */
  connect(url: string = 'ws://localhost:3000'): void {
    console.log('[WebSocket] Connecting to:', url);
    
    // Simulate connection
    setTimeout(() => {
      this.connected = true;
      this.emit('connect', {});
      console.log('[WebSocket] Connected');
    }, 500);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.connected = false;
    this.emit('disconnect', {});
    console.log('[WebSocket] Disconnected');
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }

  /**
   * Send a message through WebSocket
   */
  send(event: string, data: any): void {
    if (!this.connected) {
      console.warn('[WebSocket] Not connected, message queued:', event);
      return;
    }

    console.log('[WebSocket] Sending:', event, data);
    
    // In a real implementation, this would send to the server
    // For now, simulate echo back for testing
    setTimeout(() => {
      this.emit(event + '_ack', { ...data, acknowledged: true });
    }, 100);
  }

  /**
   * Listen for events
   */
  on(event: string, handler: EventHandler): () => void {
    const handlers = this.listeners.get(event) || [];
    handlers.push(handler);
    this.listeners.set(event, handlers);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Remove event listener
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error('[WebSocket] Error in event handler:', error);
      }
    });
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Simulate receiving a message (for testing)
   */
  simulateReceive(event: string, data: any): void {
    this.emit(event, data);
  }
}

// Singleton instance
export const wsAdapter = new WebSocketAdapter();

// Auto-connect on import (can be configured)
if (typeof window !== 'undefined') {
  // Only connect in browser environment
  // wsAdapter.connect(); // Uncomment when backend is ready
}

/**
 * Hook into message events for real-time updates
 * 
 * Example usage:
 * ```
 * useEffect(() => {
 *   const unsubscribe = wsAdapter.on('message:new', (data) => {
 *     console.log('New message received:', data);
 *   });
 *   return unsubscribe;
 * }, []);
 * ```
 */
