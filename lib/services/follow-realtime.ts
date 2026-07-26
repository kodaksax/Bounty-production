import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';

/**
 * Reference-counted realtime subscription for a user's follower/following
 * relationships, following the exact pattern proven in
 * lib/services/notification-realtime.ts. Notifies listeners on any new or
 * removed row in user_follows where the given user is the one being
 * followed (following_id) -- i.e. their follower count just changed.
 */

interface SubscriptionEntry {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
}

const subscriptions: Map<string, SubscriptionEntry> = new Map();

export function subscribeToFollowChanges(userId: string, onChange: () => void): () => void {
  const channelName = `follows:${userId}`;

  let entry = subscriptions.get(channelName);
  if (!entry) {
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(fn => fn());

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_follows', filter: `following_id=eq.${userId}` },
        notify
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'user_follows', filter: `following_id=eq.${userId}` },
        notify
      )
      .subscribe();

    entry = { channel, listeners };
    subscriptions.set(channelName, entry);
  }

  entry.listeners.add(onChange);

  return () => {
    const current = subscriptions.get(channelName);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      supabase.removeChannel(current.channel).catch(() => {});
      subscriptions.delete(channelName);
    }
  };
}
