import { useEffect, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import type { Conversation } from '../lib/types';
import { messageService } from '../lib/services/message-service';
import * as supabaseMessaging from '../lib/services/supabase-messaging';
import { getCurrentUserId } from '../lib/utils/data-utils';

interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = getCurrentUserId();
  
  // Check if we have a valid authenticated user (not the fallback ID)
  const hasValidUser = currentUserId && currentUserId !== '00000000-0000-0000-0000-000000000001';

  const fetchConversations = async () => {
    // Guard: don't fetch if no valid user
    if (!hasValidUser) {
      setConversations([]);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      const data = await supabaseMessaging.fetchConversations(currentUserId);
      setConversations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (conversationId: string) => {
    // Optimistic update
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, unread: 0 } 
          : conv
      )
    );

    try {
      await supabaseMessaging.markAsRead(conversationId, currentUserId);
    } catch (err) {
      // Revert on error
      await fetchConversations();
    }
  };

  const deleteConversation = async (conversationId: string) => {
    // Optimistic update
    setConversations(prev => prev.filter(conv => conv.id !== conversationId));

    try {
      await supabaseMessaging.softDeleteConversation(conversationId, currentUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
      // Revert on error
      await fetchConversations();
    }
  };

  const refresh = async () => {
    await fetchConversations();
  };

  useEffect(() => {
    let subscription: RealtimeChannel | null = null;

    const init = async () => {
      // Only initialize if we have a valid user
      if (!hasValidUser) {
        setConversations([]); // Clear conversations when no user
        setLoading(false);
        return;
      }
      
      // Initial fetch
      await fetchConversations();

      // Subscribe to Realtime updates
      subscription = supabaseMessaging.subscribeToConversations(
        currentUserId,
        () => {
          // Refetch conversations on any update
          fetchConversations();
        }
      );
    };

    init();

    return () => {
      // Cleanup subscription
      if (subscription) {
        supabaseMessaging.unsubscribe(`conversations:${currentUserId}`);
      }
    };
  }, [currentUserId]); // Only depend on currentUserId to avoid re-subscriptions

  return {
    conversations,
    loading,
    error,
    refresh,
    markAsRead,
    deleteConversation,
  };
}
