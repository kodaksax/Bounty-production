/**
 * WebSocket Adapter — backed by Supabase Realtime
 *
 * Previously this module connected to the local Node backend via a raw
 * WebSocket.  It has been migrated to use Supabase Realtime broadcast
 * channels so that real-time events work in every environment without
 * requiring a separately-deployed Node server.
 *
 * Public interface is unchanged so all existing callers (useWebSocket,
 * WebSocketProvider, useBounties, bounty-service, etc.) continue to work.
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';

type EventHandler = (data: any) => void;

/** Name of the app-wide broadcast channel for cross-client events. */
const APP_CHANNEL = 'realtime:app-events';
/** Prefix for per-conversation typing channels. */
const CONVERSATION_CHANNEL_PREFIX = 'realtime:typing:';
/** Delay in ms before attempting to reconnect after an unexpected channel closure. */
const RECONNECT_DELAY_MS = 3000;

class WebSocketAdapter {
  private appChannel: RealtimeChannel | null = null;
  private connecting: boolean = false;
  private conversationChannels: Map<string, RealtimeChannel> = new Map();
  private listeners: Map<string, EventHandler[]> = new Map();
  private connected: boolean = false;
  private intentionalDisconnect: boolean = false;
  private currentUserId: string | null = null;

  /** Connect to Supabase Realtime (replaces raw WebSocket connect). */
  async connect(_url?: string): Promise<void> {
    if (this.appChannel || this.connecting) {
      // Already connected or a connect is in-flight — no-op.
      return;
    }

    this.intentionalDisconnect = false;
    this.connecting = true;

    try {
      // Resolve current user id for typing payloads.
      const { data } = await supabase.auth.getSession();
      this.currentUserId = data?.session?.user?.id ?? null;
    } catch (error) {
      // Non-fatal — typing payloads will omit senderId.
      if (__DEV__) console.warn('[wsAdapter] Failed to fetch user session:', error);
    }

    // If disconnect() was called while we were awaiting getSession, abort.
    if (this.intentionalDisconnect) {
      this.connecting = false;
      return;
    }

    try {
      const channel = supabase.channel(APP_CHANNEL, {
        // Do not receive our own broadcasts on the app-wide channel to avoid
        // duplicate events (e.g. message.new, presence.update, bounty.status).
        config: { broadcast: { self: false } },
      });

      channel
        .on('broadcast', { event: 'bounty.status' }, ({ payload }) => {
          this.emit('bounty.status', payload);
        })
        .on('broadcast', { event: 'message.new' }, ({ payload }) => {
          this.emit('message.new', payload);
          this.emit('message', payload);
        })
        .on('broadcast', { event: 'message.delivered' }, ({ payload }) => {
          this.emit('message.delivered', payload);
        })
        .on('broadcast', { event: 'message.read' }, ({ payload }) => {
          this.emit('message.read', payload);
        })
        .on('broadcast', { event: 'presence.update' }, ({ payload }) => {
          this.emit('presence.update', payload);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.connected = true;
            this.emit('connect', {});
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this.connected = false;
            if (!this.intentionalDisconnect) {
              this.emit('disconnect', {});
              // Attempt automatic reconnect after a short delay.
              setTimeout(() => {
                if (!this.intentionalDisconnect) {
                  this.appChannel = null;
                  this.connect();
                }
              }, RECONNECT_DELAY_MS);
            }
          }
        });

      this.appChannel = channel;
    } finally {
      // Always clear the in-flight flag so future connect() calls are not blocked.
      this.connecting = false;
    }
  }

  /** Disconnect from Supabase Realtime. */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.connecting = false;

    if (this.appChannel) {
      supabase.removeChannel(this.appChannel).catch((err) => {
        if (__DEV__) console.warn('[wsAdapter] removeChannel failed:', err);
      });
      this.appChannel = null;
    }

    // Tear down all per-conversation channels.
    for (const [, ch] of this.conversationChannels) {
      supabase.removeChannel(ch).catch((err) => {
        if (__DEV__) console.warn('[wsAdapter] removeChannel failed:', err);
      });
    }
    this.conversationChannels.clear();

    this.connected = false;
    this.emit('disconnect', {});
  }

  /**
   * Send an app-wide broadcast event (e.g. 'bounty.status').
   * Replaces the old WebSocket.send() call.
   */
  send(type: string, data: any): void {
    if (!this.appChannel || !this.connected) {
      return;
    }
    this.appChannel
      .send({ type: 'broadcast', event: type, payload: data })
      .catch(() => {});
  }

  /** Subscribe to a per-conversation typing channel. */
  joinConversation(conversationId: string): void {
    if (this.conversationChannels.has(conversationId)) return;

    const channelName = `${CONVERSATION_CHANNEL_PREFIX}${conversationId}`;
    const channel = supabase.channel(channelName, {
      // self: false — typing indicators must NOT echo back to the sender,
      // otherwise the sender would see their own "typing…" indicator.
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'typing.start' }, ({ payload }) => {
        this.emit('typing.start', { ...payload, conversationId });
      })
      .on('broadcast', { event: 'typing.stop' }, ({ payload }) => {
        this.emit('typing.stop', { ...payload, conversationId });
      })
      .subscribe();

    this.conversationChannels.set(conversationId, channel);
  }

  /** Unsubscribe from a per-conversation typing channel. */
  leaveConversation(conversationId: string): void {
    const channel = this.conversationChannels.get(conversationId);
    if (channel) {
      supabase.removeChannel(channel).catch((err) => {
        if (__DEV__) console.warn('[wsAdapter] removeChannel failed:', err);
      });
      this.conversationChannels.delete(conversationId);
    }
  }

  /** Broadcast a typing indicator to other participants in a conversation. */
  sendTyping(conversationId: string, isTyping: boolean): void {
    const channel = this.conversationChannels.get(conversationId);
    if (!channel) return;

    const event = isTyping ? 'typing.start' : 'typing.stop';
    channel
      .send({
        type: 'broadcast',
        event,
        payload: {
          conversationId,
          senderId: this.currentUserId,
          timestamp: new Date().toISOString(),
        },
      })
      .catch(() => {});
  }

  /** Register an event listener. Returns an unsubscribe function. */
  on(event: string, handler: EventHandler): () => void {
    const handlers = this.listeners.get(event) || [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
    return () => this.off(event, handler);
  }

  /** Remove an event listener. */
  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event) || [];
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error('[wsAdapter] Error in event handler:', error);
      }
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionState(): string {
    if (!this.appChannel) return 'CLOSED';
    // NOTE: `.state` is not part of the public Supabase JS type for RealtimeChannel;
    // we access it via a type cast as a best-effort mapping to WebSocket-style states
    // that callers (WebSocketProvider, useWebSocket) expect.  If Supabase exposes a
    // typed accessor in a future release this cast should be removed.
    const state = (this.appChannel as any).state as string | undefined;
    if (state === 'joined') return 'OPEN';
    if (state === 'joining') return 'CONNECTING';
    if (state === 'leaving') return 'CLOSING';
    return 'CLOSED';
  }

  reconnect(): void {
    this.disconnect();
    setTimeout(() => {
      this.intentionalDisconnect = false;
      this.connect();
    }, 100);
  }
}

// Singleton instance
export const wsAdapter = new WebSocketAdapter();

