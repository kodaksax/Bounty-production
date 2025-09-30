import { useEffect, useState } from 'react';
import type { Message } from '../lib/types';
import { messageService } from '../lib/services/message-service';

interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMessages(conversationId: string): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await messageService.getMessages(conversationId);
      setMessages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

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

      // Poll for status updates
      const checkStatus = setInterval(async () => {
        const updatedMessages = await messageService.getMessages(conversationId);
        const updatedMsg = updatedMessages.find(m => m.id === message.id);
        
        if (updatedMsg && updatedMsg.status !== 'sending') {
          setMessages(prev => 
            prev.map(m => m.id === message.id ? updatedMsg : m)
          );
          clearInterval(checkStatus);
        }
      }, 500);

      // Clear after 5 seconds
      setTimeout(() => clearInterval(checkStatus), 5000);

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
    sendMessage,
    retryMessage,
    refresh,
  };
}
