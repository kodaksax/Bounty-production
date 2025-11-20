/**
 * WebSocket Adapter for Real-Time Messaging
 * 
 * Connects to the BountyExpo WebSocket server for real-time messaging,
 * presence tracking, and typing indicators.
 */

import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../supabase';

type EventHandler = (data: any) => void;

interface MessageEvent {
  type: 'message.new' | 'message.delivered' | 'message.read' | 'typing.start' | 'typing.stop' | 'presence.update' | 'connected' | 'error';
  conversationId?: string;
  messageId?: string;
  senderId?: string;
  text?: string;
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  userId?: string;
  isOnline?: boolean;
  message?: string;
}

class WebSocketAdapter {
  private ws: WebSocket | null = null;
  private listeners: Map<string, EventHandler[]> = new Map();
  private connected: boolean = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000; // Start with 1 second
  private token: string | null = null;
  private url: string = '';
  private intentionalDisconnect: boolean = false;

  /**
   * Connect to WebSocket server
   */
  async connect(url?: string): Promise<void> {
    // Get auth token
    const session = await supabase.auth.getSession();
    if (!session?.data?.session?.access_token) {
      console.warn('[WebSocket] No auth token available, cannot connect');
      return;
    }

    this.token = session.data.session.access_token;
    
    // Determine WebSocket URL
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
    const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    this.url = url || `${wsUrl}/messages/subscribe?token=${this.token}`;

    console.log('[WebSocket] Connecting to:', this.url);
    this.intentionalDisconnect = false;

    try {
      // Check network connectivity
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        console.warn('[WebSocket] No network connection, delaying connect');
        this.scheduleReconnect();
        return;
      }

      // Create WebSocket connection
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.emit('connect', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data: MessageEvent = JSON.parse(event.data);
          console.log('[WebSocket] Received:', data.type);
          
          // Emit specific event type
          this.emit(data.type, data);
          
          // Also emit generic 'message' event
          this.emit('message', data);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        this.emit('error', error);
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed:', event.code, event.reason);
        this.connected = false;
        this.emit('disconnect', { code: event.code, reason: event.reason });
        
        // Attempt to reconnect unless intentionally disconnected
        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      this.emit('max_reconnect_attempts', { attempts: this.reconnectAttempts });
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WebSocket] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.emit('disconnect', {});
    console.log('[WebSocket] Disconnected');
  }

  /**
   * Send a message through WebSocket
   */
  send(type: string, data: any): void {
    if (!this.connected || !this.ws) {
      console.warn('[WebSocket] Not connected, message queued:', type);
      // TODO: Queue messages for sending when reconnected
      return;
    }

    try {
      const message = JSON.stringify({ type, ...data });
      this.ws.send(message);
      console.log('[WebSocket] Sent:', type);
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
    }
  }

  /**
   * Join a conversation room
   */
  joinConversation(conversationId: string): void {
    this.send('join', { conversationId });
  }

  /**
   * Leave a conversation room
   */
  leaveConversation(conversationId: string): void {
    this.send('leave', { conversationId });
  }

  /**
   * Send typing indicator
   */
  sendTyping(conversationId: string, isTyping: boolean): void {
    this.send('typing', { conversationId, isTyping });
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
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getConnectionState(): string {
    if (!this.ws) return 'CLOSED';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING';
      case WebSocket.OPEN:
        return 'OPEN';
      case WebSocket.CLOSING:
        return 'CLOSING';
      case WebSocket.CLOSED:
        return 'CLOSED';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Force reconnect
   */
  reconnect(): void {
    console.log('[WebSocket] Manual reconnect requested');
    this.disconnect();
    setTimeout(() => {
      this.reconnectAttempts = 0;
      this.connect();
    }, 100);
  }
}

// Singleton instance
export const wsAdapter = new WebSocketAdapter();

/**
 * Hook into message events for real-time updates
 * 
 * Example usage:
 * ```
 * useEffect(() => {
 *   const unsubscribe = wsAdapter.on('message.new', (data) => {
 *     console.log('New message received:', data);
 *   });
 *   return unsubscribe;
 * }, []);
 * ```
 */
