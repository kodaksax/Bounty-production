import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';

/**
 * Reference-counted realtime subscription for a user's notifications feed,
 * following the exact pattern proven in lib/services/supabase-messaging.ts
 * (subscribeToConversations/subscribeToMessages). Needed because both the
 * notification bell (badge count) and the Notification Center screen
 * subscribe to the same `notifications:${userId}` feed simultaneously — a
 * naive per-consumer channel would open two duplicate realtime channels.
 */

interface SubscriptionEntry {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
}

const subscriptions: Map<string, SubscriptionEntry> = new Map();

export function subscribeToNotifications(userId: string, onInsertOrUpdate: () => void): () => void {
  const channelName = `notifications:${userId}`;

  let entry = subscriptions.get(channelName);
  if (!entry) {
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(fn => fn());

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        notify
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        notify
      )
      .subscribe();

    entry = { channel, listeners };
    subscriptions.set(channelName, entry);
  }

  entry.listeners.add(onInsertOrUpdate);

  return () => {
    const current = subscriptions.get(channelName);
    if (!current) return;
    current.listeners.delete(onInsertOrUpdate);
    if (current.listeners.size === 0) {
      supabase.removeChannel(current.channel).catch(() => {});
      subscriptions.delete(channelName);
    }
  };
}

/** Whether the shared channel for this user is currently subscribed (SUBSCRIBED state). */
export function isNotificationsChannelConnected(userId: string): boolean {
  const entry = subscriptions.get(`notifications:${userId}`);
  return entry?.channel.state === 'joined';
}
