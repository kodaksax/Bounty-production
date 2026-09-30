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

/** A shared conversation channel plus how many callers currently hold it. */
interface ConversationChannelEntry {
  /** null while a previous channel for this conversation is still closing. */
  channel: RealtimeChannel | null;
  refCount: number;
}

// supabase.channel(topic) hands back the channel still registered under that
// topic, and a removed channel stays registered until the server acks the
// leave. Re-creating a topic before then binds the new handlers onto the old
// channel: every event is delivered twice if it rejoins, and nothing at all
// once it closes. Broadcast topics can't be made unique the way the
// postgres_changes ones are (every client has to share the topic to hear each
// other), so instead a topic is only re-created once its removal has finished.
class WebSocketAdapter {
  private appChannel: RealtimeChannel | null = null;
  /** Pending removal of the previous app channel; connect() waits for it. */
  private appChannelRemoval: Promise<unknown> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting: boolean = false;
  private conversationChannels: Map<string, ConversationChannelEntry> = new Map();
  /** Pending removals of per-conversation channels, keyed by conversation id. */
  private conversationRemovals: Map<string, Promise<unknown>> = new Map();
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

    // Resolve current user id for typing payloads asynchronously so the
    // channel creation and subscription registration occur synchronously.
    // This avoids a microtask race in unit tests that mock `supabase.auth.getSession`
    // as a resolved promise but expect the channel.subscribe callback to be
    // registered immediately when `connect()` is called.
    supabase.auth.getSession()
      .then(({ data }: any) => {
        this.currentUserId = data?.session?.user?.id ?? null;
      })
      .catch((error: any) => {
        // Non-fatal — typing payloads will omit senderId.
        if (__DEV__) console.warn('[wsAdapter] Failed to fetch user session:', error);
      });

    if (this.appChannelRemoval) {
      await this.appChannelRemoval;
    }

    // If disconnect() was called while we were waiting, or a concurrent
    // connect() got there first, abort.
    if (this.intentionalDisconnect || this.appChannel) {
      this.connecting = false;
      return;
    }

    try {
      const channel = supabase.channel(APP_CHANNEL, {
        // Do not receive our own broadcasts on the app-wide channel to avoid
        // duplicate events (e.g. message.new, presence.update, bounty.status).
        config: { broadcast: { self: false } },
      });
      this.appChannel = channel;

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
          // A replaced or torn-down channel still reports CLOSED when its
          // removal finishes; only the current channel drives state.
          if (this.appChannel !== channel) return;
          if (status === 'SUBSCRIBED') {
            this.connected = true;
            this.emit('connect', {});
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this.connected = false;
            if (!this.intentionalDisconnect) {
              this.emit('disconnect', {});
              this.scheduleReconnect(channel);
            }
          }
        });
    } finally {
      // Always clear the in-flight flag so future connect() calls are not blocked.
      this.connecting = false;
    }
  }

  /** Rebuild the app channel after an unexpected error or close. */
  private scheduleReconnect(channel: RealtimeChannel): void {
    if (this.reconnectTimer) return;
    const _t = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || this.appChannel !== channel) return;
      // Realtime rejoins an errored channel by itself once the socket is
      // back; if it already has, keep it.
      if ((channel as any).state === 'joined') return;
      this.dropAppChannel();
      this.connect();
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer = _t;
    if (typeof (_t as any)?.unref === 'function') {
      try { (_t as any).unref(); } catch { /* ignore */ }
    }
  }

  private dropAppChannel(): void {
    const channel = this.appChannel;
    if (!channel) return;
    this.appChannel = null;
    const removal: Promise<unknown> = this.removeChannel(channel).finally(() => {
      if (this.appChannelRemoval === removal) this.appChannelRemoval = null;
    });
    this.appChannelRemoval = removal;
  }

  private dropConversationChannel(conversationId: string, channel: RealtimeChannel): void {
    const removal: Promise<unknown> = this.removeChannel(channel).finally(() => {
      if (this.conversationRemovals.get(conversationId) === removal) {
        this.conversationRemovals.delete(conversationId);
      }
    });
    this.conversationRemovals.set(conversationId, removal);
  }

  private removeChannel(channel: RealtimeChannel): Promise<unknown> {
    return (async () => {
      let removed = false;
      while (!removed) {
        try {
          const status = await supabase.removeChannel(channel);
          removed = status === 'ok';
          if (!removed && __DEV__) console.warn('[wsAdapter] removeChannel did not complete:', status);
        } catch (err) {
          if (__DEV__) console.warn('[wsAdapter] removeChannel failed:', err);
        }
        if (!removed) {
          await new Promise<void>((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
        }
      }
    })();
  }

  /** Disconnect from Supabase Realtime. */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.connecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.dropAppChannel();

    // Tear down all per-conversation channels.
    for (const [conversationId, entry] of this.conversationChannels) {
      if (entry.channel) this.dropConversationChannel(conversationId, entry.channel);
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

  /**
   * Subscribe to a per-conversation typing channel. Reference-counted: multiple
   * callers (e.g. two mounted screens showing the same conversation) can each
   * join/leave independently without one's cleanup tearing down the channel
   * out from under the other.
   */
  joinConversation(conversationId: string): void {
    const existing = this.conversationChannels.get(conversationId);
    if (existing) {
      existing.refCount += 1;
      return;
    }

    const entry: ConversationChannelEntry = { channel: null, refCount: 1 };
    this.conversationChannels.set(conversationId, entry);

    const pendingRemoval = this.conversationRemovals.get(conversationId);
    if (!pendingRemoval) {
      entry.channel = this.createConversationChannel(conversationId);
      return;
    }
    // Rejoined while the previous channel is still closing.
    pendingRemoval.then(() => {
      // Only if this join hasn't since been left (or cleared by disconnect()).
      if (this.conversationChannels.get(conversationId) === entry) {
        entry.channel = this.createConversationChannel(conversationId);
      }
    });
  }

  private createConversationChannel(conversationId: string): RealtimeChannel {
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

    return channel;
  }

  /** Release one reference to a per-conversation typing channel; only removes it once the last caller leaves. */
  leaveConversation(conversationId: string): void {
    const entry = this.conversationChannels.get(conversationId);
    if (!entry) return;

    entry.refCount -= 1;
    if (entry.refCount > 0) return;

    this.conversationChannels.delete(conversationId);
    if (entry.channel) this.dropConversationChannel(conversationId, entry.channel);
  }

  /** Broadcast a typing indicator to other participants in a conversation. */
  sendTyping(conversationId: string, isTyping: boolean): void {
    const entry = this.conversationChannels.get(conversationId);
    if (!entry?.channel) return;

    const event = isTyping ? 'typing.start' : 'typing.stop';
    entry.channel
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
    const _t = setTimeout(() => {
      this.intentionalDisconnect = false;
      this.connect();
    }, 100);
    if (typeof (_t as any)?.unref === 'function') {
      try { (_t as any).unref(); } catch { /* ignore */ }
    }
  }
}

// Singleton instance
export const wsAdapter = new WebSocketAdapter();
