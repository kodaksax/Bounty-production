/**
 * WebSocket Adapter for Real-Time Messaging
 * 
 * Connects to the BountyExpo WebSocket server for real-time messaging,
 * presence tracking, and typing indicators.
 */

import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import { getApiBaseUrl } from '../config/api';
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
  private lastOpenTime: number = 0;
  private minStableConnectionMs: number = 5000; // Consider connection stable after 5s
  private verbose: boolean = process.env.EXPO_PUBLIC_WS_VERBOSE === '1';
  private pingIntervalMs: number = 20000; // 20s
  private pingTimer?: NodeJS.Timeout;
  private lastPongTime: number = 0;

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
    
    // Determine WebSocket URL (robustly resolve reachable host for devices)
    const preferredApi =
      (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ||
      (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
      undefined;

    const directWs = (process.env.EXPO_PUBLIC_WS_URL as string | undefined)?.trim();
    const apiUrl = getApiBaseUrl(3001);
    const baseForWs = directWs && directWs.length > 0 ? directWs : apiUrl;
    const wsBase = baseForWs
      .replace('http://', 'ws://')
      .replace('https://', 'wss://');

    this.url = url || `${wsBase}/messages/subscribe?token=${this.token}`;

    if (this.verbose || this.reconnectAttempts === 0 || this.reconnectAttempts % 3 === 0) {
      console.log('[WebSocket] Connecting to:', this.url);
    }
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
        this.lastOpenTime = Date.now();
        this.lastPongTime = Date.now();
        if (this.verbose || this.reconnectAttempts === 0) {
          console.log('[WebSocket] Connected successfully');
        }
        this.connected = true;

        // start heartbeat pings
        try {
          if (this.pingTimer) clearInterval(this.pingTimer as any);
          this.pingTimer = setInterval(() => {
            try {
              if (!this.ws || !this.connected) return;
              // send a lightweight ping message; server should respond with 'pong'
              this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
              // if we haven't received a pong in 2 intervals, consider connection stale
              const now = Date.now();
              if (this.lastPongTime && now - this.lastPongTime > this.pingIntervalMs * 2) {
                if (this.verbose) console.warn('[WebSocket] No pong received - closing stale socket');
                try { this.ws?.close(); } catch {};
              }
            } catch (e) { /* ignore ping errors */ }
          }, this.pingIntervalMs) as unknown as NodeJS.Timeout;
        } catch (e) {}

        // Do NOT reset attempts immediately; only after a stable connection duration.
        this.emit('connect', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data: MessageEvent = JSON.parse(event.data);
          if (data.type === 'pong') {
            this.lastPongTime = Date.now();
            if (this.verbose) console.log('[WebSocket] Received pong');
            return;
          }

          if (this.verbose) console.log('[WebSocket] Received:', data.type);
          // Emit specific event type
          this.emit(data.type, data);
          // Also emit generic 'message' event
          this.emit('message', data);
        } catch (error) {
          if (this.verbose) console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        try {
          const info = {
            platform: Platform.OS,
            url: this.url,
            readyState: this.ws?.readyState,
            message: (error as any)?.message,
            type: (error as any)?.type,
          };
          console.error('[WebSocket] Error event', info);
          this.emit('error', info);
        } catch (e) {
          console.error('[WebSocket] Error (unserializable):', error);
          this.emit('error', { error });
        }
      };

      this.ws.onclose = (event) => {
        const uptime = this.lastOpenTime ? Date.now() - this.lastOpenTime : 0;
        if (this.verbose || this.reconnectAttempts === 0 || uptime < this.minStableConnectionMs) {
          console.log('[WebSocket] Connection closed:', event.code, event.reason, `uptime=${uptime}ms`);
        }
        this.connected = false;
        this.emit('disconnect', { code: event.code, reason: event.reason, uptime });
        // clear heartbeat timer
        try { if (this.pingTimer) { clearInterval(this.pingTimer as any); this.pingTimer = undefined; } } catch {}
        // Reset attempts only if connection lived long enough to be considered stable
        if (uptime >= this.minStableConnectionMs) {
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
        }
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
