import { useEffect, useState, useCallback } from 'react';
import { Clipboard } from 'react-native';
import type { Message } from '../lib/types';
import { messageService } from '../lib/services/message-service';
import { socketStub, useMessageStatus } from './useSocketStub';

interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: string | null;
  pinnedMessage: Message | null;
  sendMessage: (text: string) => Promise<void>;
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

  const fetchMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await messageService.getMessages(conversationId);
      setMessages(data);

      // Fetch pinned message
      const pinned = await messageService.getPinnedMessage(conversationId);
      setPinnedMessage(pinned);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  // Handle message status updates from socket
  const handleStatusUpdate = useCallback((messageId: string, status: 'delivered' | 'read') => {
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId ? { ...m, status } : m
      )
    );
    messageService.updateMessageStatus(messageId, status);
  }, []);

  useMessageStatus(handleStatusUpdate);

  const sendMessage = async (text: string) => {
    try {
      setError(null);
      
      // Optimistic update - add message immediately
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderId: 'current-user',
        text,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      
      setMessages(prev => [...prev, tempMessage]);

      // Send to server
      const { message, error: sendError } = await messageService.sendMessage(conversationId, text);
      
      if (sendError) {
        setError(sendError);
      }

      // Replace temp message with real one
      setMessages(prev => 
        prev.map(m => m.id === tempMessage.id ? message : m)
      );

      // Simulate status transitions using socket stub
      socketStub.simulateMessageStatusTransition(message.id);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  const retryMessage = async (messageId: string) => {
    try {
      // Update status to sending
      setMessages(prev => 
        prev.map(m => 
          m.id === messageId 
            ? { ...m, status: 'sending' as const }
            : m
        )
      );

      const { success } = await messageService.retryMessage(messageId);
      
      if (success) {
        // Poll for updated status
        setTimeout(async () => {
          const updatedMessages = await messageService.getMessages(conversationId);
          setMessages(updatedMessages);
        }, 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry message');
    }
  };

  const pinMessage = async (messageId: string) => {
    try {
      // Optimistic update
      setMessages(prev =>
        prev.map(m => ({
          ...m,
          isPinned: m.conversationId === conversationId ? m.id === messageId : m.isPinned,
        }))
      );

      const message = messages.find(m => m.id === messageId);
      if (message) {
        setPinnedMessage(message);
      }

      const { success, error: pinError } = await messageService.pinMessage(messageId);
      if (!success && pinError) {
        setError(pinError);
        // Rollback on error
        await fetchMessages();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pin message');
      await fetchMessages();
    }
  };

  const unpinMessage = async (messageId: string) => {
    try {
      // Optimistic update
      setMessages(prev =>
        prev.map(m => m.id === messageId ? { ...m, isPinned: false } : m)
      );
      setPinnedMessage(null);

      const { success, error: unpinError } = await messageService.unpinMessage(messageId);
      if (!success && unpinError) {
        setError(unpinError);
        await fetchMessages();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unpin message');
      await fetchMessages();
    }
  };

  const copyMessage = async (messageId: string) => {
    try {
      const message = messages.find(m => m.id === messageId);
      if (message) {
        Clipboard.setString(message.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy message');
    }
  };

  const reportMessage = async (messageId: string) => {
    try {
      const { success, error: reportError } = await messageService.reportMessage(messageId);
      if (!success && reportError) {
        setError(reportError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to report message');
    }
  };

  const refresh = async () => {
    await fetchMessages();
  };

  useEffect(() => {
    fetchMessages();

    // Set up polling for new messages (replace with WebSocket later)
    const interval = setInterval(fetchMessages, 5000); // Poll every 5s
    
    return () => clearInterval(interval);
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
