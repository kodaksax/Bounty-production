import { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CACHE_KEYS } from '../lib/services/cached-data-service';
import * as supabaseMessaging from '../lib/services/supabase-messaging';
import type { Conversation } from '../lib/types';
import { getCurrentUserId } from '../lib/utils/data-utils';
import { logger } from '../lib/utils/error-logger';
import { useCachedData } from './useCachedData';

interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  isValidating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

export function useConversations(): UseConversationsResult {
  const currentUserId = getCurrentUserId();

  // Check if we have a valid authenticated user (not the fallback ID)
  const hasValidUser = !!(currentUserId && currentUserId !== '00000000-0000-0000-0000-000000000001');

  const cacheKey = useMemo(() =>
    hasValidUser ? CACHE_KEYS.CONVERSATIONS_LIST : 'conversations_guest',
    [hasValidUser]
  );

  const fetchFn = useCallback(async () => {
    if (!hasValidUser) return [];
    return supabaseMessaging.fetchConversations(currentUserId);
  }, [currentUserId, hasValidUser]);

  const {
    data: fetchedConversations,
    isLoading: loading,
    isValidating,
    error: fetchError,
    refetch
  } = useCachedData<Conversation[]>(cacheKey, fetchFn, { enabled: hasValidUser });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Sync state with cached data
  useEffect(() => {
    if (fetchedConversations) {
      setConversations(fetchedConversations);
    }
  }, [fetchedConversations]);

  useEffect(() => {
    if (fetchError) {
      setError(fetchError.message);
    }
  }, [fetchError]);

  const fetchConversations = useCallback(async () => {
    await refetch();
  }, [refetch]);

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

    // Check if we have a valid authenticated user (not the fallback ID)
    const isValidUser = currentUserId && currentUserId !== '00000000-0000-0000-0000-000000000001';

    const init = async () => {
      // Only initialize if we have a valid user
      if (!isValidUser) {
        setConversations([]); // Clear conversations when no user
        return;
      }

      // Subscribe to Realtime updates
      subscription = supabaseMessaging.subscribeToConversations(
        currentUserId,
        () => {
          // Refetch conversations on any update (SWR will update UI)
          refetch().catch(err => logger.error('Error refetching conversations on notification', { error: err }));
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
  }, [currentUserId, refetch]); // Only depend on currentUserId and refetch

  return {
    conversations,
    loading,
    isValidating,
    error,
    refresh,
    markAsRead,
    deleteConversation,
  };
}
