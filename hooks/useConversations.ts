import { useEffect, useState } from 'react';
import type { Conversation } from '../lib/types';
import { messageService } from '../lib/services/message-service';
import * as messagingService from '../lib/services/messaging';

interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await messageService.getConversations();
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
      await messageService.markAsRead(conversationId);
    } catch (err) {
      // Revert on error
      await fetchConversations();
    }
  };

  const refresh = async () => {
    await fetchConversations();
  };

  useEffect(() => {
    fetchConversations();
    
    // Listen for real-time updates from the messaging service
    const handleConversationsUpdated = () => {
      fetchConversations();
    };
    
    messagingService.on('conversationsUpdated', handleConversationsUpdated);
    messagingService.on('messageSent', handleConversationsUpdated);
    
    return () => {
      messagingService.off('conversationsUpdated', handleConversationsUpdated);
      messagingService.off('messageSent', handleConversationsUpdated);
    };
  }, []);

  return {
    conversations,
    loading,
    error,
    refresh,
    markAsRead,
  };
}
