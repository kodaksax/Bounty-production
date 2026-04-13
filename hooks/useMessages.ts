import { RealtimeChannel } from '@supabase/supabase-js';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { messageService } from '../lib/services/message-service';
import * as supabaseMessaging from '../lib/services/supabase-messaging';
import type { Message } from '../lib/types';
import { getCurrentUserId } from '../lib/utils/data-utils';

interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: string | null;
  pinnedMessage: Message | null;
  sendMessage: (text: string, mediaUrl?: string | null) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  pinMessage: (messageId: string) => Promise<void>;
  unpinMessage: (messageId: string) => Promise<void>;
  copyMessage: (messageId: string) => Promise<void>;
  reportMessage: (messageId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMessages(conversationId: string): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
  const currentUserId = getCurrentUserId();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const fetchMessages = async () => {
    // Skip Supabase for local/fake conversation IDs (e.g. "conv-*")
    if (!conversationId || !UUID_RE.test(conversationId)) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await supabaseMessaging.fetchMessages(conversationId);
      setMessages(data);

      // Find pinned message
      const pinned = data.find(m => m.isPinned);
      setPinnedMessage(pinned || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text: string, mediaUrl?: string | null) => {
    try {
      setError(null);

      // Optimistic update - add message immediately
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderId: currentUserId,
        text,
        mediaUrl: mediaUrl ?? undefined,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };

      setMessages(prev => [...prev, tempMessage]);

      // If this is a local/fallback conversation ID (e.g. "conv-..."),
      // avoid calling Supabase (which expects a UUID) and use the
      // local `messageService` instead to persist the message locally.
      if (!UUID_RE.test(conversationId)) {
        try {
          const result = await messageService.sendMessage(conversationId, text, currentUserId);
          // `messageService.sendMessage` returns an object with `message`
          // but also some call sites may return the Message directly; handle both.
          const sentMessage: Message =
            result && (result as any).message ? (result as any).message : (result as any);
          setMessages(prev => prev.map(m => (m.id === tempMessage.id ? sentMessage : m)));
          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to send message (local)');
          setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
          return;
        }
      }

      // Send to Supabase for canonical conversations (UUIDs)
      const message = await supabaseMessaging.sendMessage(
        conversationId,
        text,
        currentUserId,
        mediaUrl ?? null
      );

      // Replace temp message with real one
      setMessages(prev => prev.map(m => (m.id === tempMessage.id ? message : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove failed temp message
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
    }
  };

  const retryMessage = async (messageId: string) => {
    try {
      // For now, just refetch messages
      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry message');
    }
  };

  const pinMessage = async (messageId: string) => {
    // Pin/unpin is not implemented in Supabase service yet
    // For now, just show error
    setError('Pin message feature not yet implemented');
  };

  const unpinMessage = async (messageId: string) => {
    // Pin/unpin is not implemented in Supabase service yet
    // For now, just show error
    setError('Unpin message feature not yet implemented');
  };

  const copyMessage = async (messageId: string) => {
    try {
      const message = messages.find(m => m.id === messageId);
      if (message) {
        await Clipboard.setStringAsync(message.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy message');
    }
  };

  const reportMessage = async (messageId: string) => {
    try {
      // Report functionality would need backend implementation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to report message');
    }
  };

  const refresh = async () => {
    await fetchMessages();
  };

  useEffect(() => {
    let subscription: RealtimeChannel | null = null;

    const init = async () => {
      // Initial fetch
      await fetchMessages();

      // Subscribe to Realtime updates
      subscription = supabaseMessaging.subscribeToMessages(conversationId, newMessage => {
        if (newMessage) {
          // Add new message if it's not from current user (avoid duplicates from optimistic updates)
          if (newMessage.senderId !== currentUserId) {
            setMessages(prev => {
              // Check if message already exists
              if (prev.some(m => m.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          }
        } else {
          // Refetch on update
          fetchMessages();
        }
      });
    };

    init();

    return () => {
      // Cleanup subscription
      if (subscription) {
        supabaseMessaging.unsubscribe(`messages:${conversationId}`);
      }
    };
  }, [conversationId]);

  return {
    messages,
    loading,
    error,
    pinnedMessage,
    sendMessage,
    retryMessage,
    pinMessage,
    unpinMessage,
    copyMessage,
    reportMessage,
    refresh,
  };
}
