/**
 * WebSocket Adapter for Real-Time Messaging
 * 
 * Connects to the BountyExpo WebSocket server for real-time messaging,
 * presence tracking, and typing indicators.
 */

import NetInfo from '@react-native-community/netinfo';
import { calculateRetryDelay, ERROR_LOG_THROTTLE, isVerboseLogging, WEBSOCKET_CONFIG } from 'lib/config/network';
import getApiBaseFallback from 'lib/utils/dev-host';
import { LOG_KEYS, shouldLog } from 'lib/utils/log-throttle';
import { waitForAuthEvent } from 'lib/utils/supabase-auth';
import { Platform } from 'react-native';
import { getApiBaseUrl } from '../config/api';
import { supabase } from '../supabase';

type EventHandler = (data: any) => void;

interface MessageEvent {
  type: 'message.new' | 'message.delivered' | 'message.read' | 'typing.start' | 'typing.stop' | 'presence.update' | 'connected' | 'error' | 'pong';
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
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = WEBSOCKET_CONFIG.MAX_RECONNECT_ATTEMPTS;
  private reconnectDelay: number = WEBSOCKET_CONFIG.INITIAL_RECONNECT_DELAY;
  private token: string | null = null;
  private url: string = '';
  private intentionalDisconnect: boolean = false;
  private lastOpenTime: number = 0;
  private minStableConnectionMs: number = WEBSOCKET_CONFIG.MIN_STABLE_CONNECTION_MS;
  private verbose: boolean = isVerboseLogging();
  private pingIntervalMs: number = WEBSOCKET_CONFIG.PING_INTERVAL_MS;
  private pingTimer?: ReturnType<typeof setInterval>;
  private lastPongTime: number = 0;

  /**
   * Connect to WebSocket server
   */
  async connect(url?: string): Promise<void> {
    // Get auth token (try immediate, then fall back to brief onAuthStateChange wait)
    try {
      const { data } = await supabase.auth.getSession();
      const session = data?.session ?? null;
      const token = session?.access_token ?? null;

      if (!token) {
        console.error('[WebSocket] No auth token available immediately; waiting briefly for auth state change');

        // Wait up to 5s for auth state change that provides a session/token
        const awaitedSession = await waitForAuthEvent(5000)
        const awaitedToken: string | null = awaitedSession?.access_token ?? null

        if (!awaitedToken) {
          console.error('[WebSocket] No auth token available after waiting, cannot connect');
          return;
        }

        this.token = awaitedToken;
      } else {
        // Use immediate token
        // Mask token length in logs to avoid leaking secrets
        if (this.verbose) console.log('[WebSocket] Auth token available, length=', token.length);
        this.token = token;
      }
    } catch (e) {
      console.error('[WebSocket] Error while retrieving session/token:', e);
      return;
    }
    
    // Determine WebSocket URL (robustly resolve reachable host for devices)
    const preferredApi =
      (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ||
      (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
      undefined;

    const directWs = (process.env.EXPO_PUBLIC_WS_URL as string | undefined)?.trim();
    const apiUrl = getApiBaseUrl(3001);
    let baseForWs = directWs && directWs.length > 0 ? directWs : apiUrl;
    const wsBase = baseForWs
      .replace('http://', 'ws://')
      .replace('https://', 'wss://');

    // Before opening a WebSocket, probe the HTTP(S) base to detect unreachable
    // dev-machine host bindings (common when the backend isn't bound to the
    // LAN interface). If the preferred host is unreachable, try the dev-host
    // fallback which derives the host from Expo debug manifest / emulator
    // defaults.
    try {
      const httpProbe = wsBase.replace(/^wss?:/, 'https:').replace(/^https:/, 'https:').replace(/^ws:/, 'http:');
      const reachable = await this.probeHost(httpProbe, 1500);
      if (!reachable) {
        const fallback = getApiBaseFallback();
        if (fallback && fallback !== apiUrl) {
          const fallbackWs = fallback.replace('http://', 'ws://').replace('https://', 'wss://');
          baseForWs = fallbackWs;
        }
      }
    } catch (e) {
      // ignore probing errors and continue with original host
      if (this.verbose) console.error('[WebSocket] Host probe failed:', e);
    }

    // Ensure the final WebSocket URL includes a ws:// or wss:// scheme.
    // `wsBase` is derived from `baseForWs` (which should include http/https or ws/wss),
    // so prefer using `wsBase` directly. The previous replace removed the scheme
    // and produced URLs like "192.168.0.59:3001/..." which cause readyState=3 errors.
    const resolvedBase = wsBase && wsBase.length > 0 ? wsBase : baseForWs;
    this.url = url || `${resolvedBase.replace(/\/+$/,'')}/messages/subscribe?token=${this.token}`;

    // If the resolved URL doesn't include a scheme, warn to help diagnose dev host issues
    if (!/^wss?:\/\//i.test(this.url)) {
      console.error('[WebSocket] Constructed URL missing ws/wss scheme:', this.url);
    }

    if (this.verbose || this.reconnectAttempts === 0 || this.reconnectAttempts % 3 === 0) {
    }
    this.intentionalDisconnect = false;

    try {
      // Check network connectivity
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        console.error('[WebSocket] No network connection, delaying connect');
        this.scheduleReconnect();
        return;
      }

      // Create WebSocket connection
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.lastOpenTime = Date.now();
        this.lastPongTime = Date.now();
        if (this.verbose || this.reconnectAttempts === 0) {
        }
        this.connected = true;

        // start heartbeat pings
        try {
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => {
            try {
              if (!this.ws || !this.connected) return;
              // send a lightweight ping message; server should respond with 'pong'
              this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
              // if we haven't received a pong in 2 intervals, consider connection stale
              const now = Date.now();
              if (this.lastPongTime && now - this.lastPongTime > this.pingIntervalMs * 2) {
                if (this.verbose) console.error('[WebSocket] No pong received - closing stale socket');
                try { this.ws?.close(); } catch {};
              }
            } catch (e) { /* ignore ping errors */ }
          }, this.pingIntervalMs);
        } catch (e) {}

        // Do NOT reset attempts immediately; only after a stable connection duration.
        this.emit('connect', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data: MessageEvent = JSON.parse(event.data);
          if (data.type === 'pong') {
            this.lastPongTime = Date.now();
            return;
          }

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
          
          // Reduce error spam in development - only log connection errors periodically
          if (__DEV__) {
            if (shouldLog(LOG_KEYS.WS_ERROR, ERROR_LOG_THROTTLE.FREQUENT)) {
              console.log('[WebSocket] Connection unavailable - retrying in background');
            }
          } else {
            console.error('[WebSocket] Error event', info);
          }
          
          this.emit('error', info);
        } catch (e) {
          if (!__DEV__) {
            console.error('[WebSocket] Error (unserializable):', error);
          }
          this.emit('error', { error });
        }
      };

      this.ws.onclose = (event) => {
        const uptime = this.lastOpenTime ? Date.now() - this.lastOpenTime : 0;
        
        // Reduce close event spam in development
        if (__DEV__) {
          // Only log disconnects if we were actually connected for a meaningful duration
          if (uptime > this.minStableConnectionMs && (this.verbose || this.reconnectAttempts === 0)) {
            console.log('[WebSocket] Disconnected after', Math.round(uptime / 1000), 'seconds');
          }
        } else if (this.verbose || this.reconnectAttempts === 0 || uptime < this.minStableConnectionMs) {
          console.log('[WebSocket] Connection closed');
        }
        
        this.connected = false;
        this.emit('disconnect', { code: event.code, reason: event.reason, uptime });
        // clear heartbeat timer
        try { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; } } catch {}
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
      // Reduce error spam in development
      if (__DEV__) {
        if (shouldLog(LOG_KEYS.WS_CONNECT_ERROR, ERROR_LOG_THROTTLE.FREQUENT)) {
          console.log('[WebSocket] Connection failed - will retry automatically');
        }
      } else {
        console.error('[WebSocket] Connection error:', error);
      }
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
      // Don't spam console in development when backend is unreachable
      if (__DEV__) {
        if (shouldLog(LOG_KEYS.WS_MAX_ATTEMPTS, ERROR_LOG_THROTTLE.RARE)) {
          console.log('[WebSocket] Backend unreachable - will retry when network changes');
        }
      } else {
        console.error('[WebSocket] Max reconnect attempts reached');
      }
      this.emit('max_reconnect_attempts', { attempts: this.reconnectAttempts });
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = calculateRetryDelay(this.reconnectAttempts, this.reconnectDelay);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * Probe a host by performing a short HTTP fetch to detect quick failures.
   * Returns true if the host responded (any status), false if unreachable.
   */
  private async probeHost(url: string, timeoutMs = 1500): Promise<boolean> {
    try {
      // Normalize to http(s) URL - many servers will respond to GET /
      const probeUrl = url.startsWith('http') ? url : (`${url}`);
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(probeUrl, { method: 'GET', signal: controller.signal as any });
        clearTimeout(id);
        // If we got any response (even 404) consider host reachable
        return !!res;
      } catch (e) {
        clearTimeout(id);
        return false;
      }
    } catch (e) {
      return false;
    }
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
  }

  /**
   * Send a message through WebSocket
   */
  send(type: string, data: any): void {
    if (!this.connected || !this.ws) {
      console.error('[WebSocket] Not connected, message queued:', type);
      // TODO (Post-Launch): Queue messages for sending when reconnected
      return;
    }

    try {
      const message = JSON.stringify({ type, ...data });
      this.ws.send(message);
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
