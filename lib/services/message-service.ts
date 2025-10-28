import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../supabase';
import type { Conversation, Message } from '../types';
import { getCurrentUserId } from '../utils/data-utils';
import * as messagingService from './messaging';
import { logClientError, logClientInfo } from './monitoring';
import { offlineQueueService } from './offline-queue-service';
import * as supabaseMessaging from './supabase-messaging';

export const messageService = {
  /**
   * Get all conversations for current user
   */
  getConversations: async (): Promise<Conversation[]> => {
    const userId = getCurrentUserId();
    return messagingService.listConversations(userId);
  },

  /**
   * Get a specific conversation
   */
  getConversation: async (id: string): Promise<Conversation | null> => {
    return messagingService.getConversation(id);
  },

  /**
   * Get messages for a conversation
   */
  getMessages: async (conversationId: string): Promise<Message[]> => {
    return messagingService.getMessages(conversationId);
  },

  /**
   * Send a message (optimistic update with offline support)
   */
  sendMessage: async (conversationId: string, text: string, senderId: string = 'current-user'): Promise<{ message: Message; error?: string }> => {
    // Check network connectivity
    const netState = await NetInfo.fetch();
    const isOnline = !!netState.isConnected;

    if (!isOnline) {
      // Queue for later if offline
      console.log('📴 Offline: queueing message for later delivery');
      
      // Create a temporary message
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderId,
        text,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      
      await offlineQueueService.enqueue('message', {
        conversationId,
        text,
        senderId,
        tempId: tempMessage.id,
      });
      
      return { message: tempMessage };
    }

    // Send message using persistent storage
    const message = await messagingService.sendMessage(conversationId, text, senderId);
    return { message };
  },

  /**
   * Retry a failed message
   */
  retryMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    // In the new persistent layer, we don't store failed messages
    // Instead, this would re-send the message
    // For now, just return success
    return { success: true };
  },

  /**
   * Mark conversation as read
   */
  markAsRead: async (conversationId: string): Promise<void> => {
    const userId = getCurrentUserId();
    await messagingService.markAsRead(conversationId, userId);
  },

  /**
   * Create a new conversation
   */
  createConversation: async (participantIds: string[], name: string, isGroup: boolean = false, bountyId?: string): Promise<Conversation> => {
    const userId = getCurrentUserId();
    // Ensure current user is in the participant list
    const allParticipants = participantIds.includes(userId) 
      ? participantIds 
      : [...participantIds, userId];
    
    return messagingService.createConversation(allParticipants, name, isGroup, bountyId);
  },

  /**
   * Get or create a conversation (prevents duplicates for 1:1 chats)
   */
  getOrCreateConversation: async (participantIds: string[], name: string, bountyId?: string): Promise<Conversation> => {
    const userId = getCurrentUserId();
    // Ensure current user is in the participant list
    const allParticipants = participantIds.includes(userId) 
      ? participantIds 
      : [...participantIds, userId];
    
    // Try to create via Supabase RPC if available (preferred) so the canonical
    // backend stores the conversation and other clients can see it.
    try {
      // Convert to array of uuids (strings)
      const pids = allParticipants.map(String)
  const { data, error } = await supabase.rpc('rpc_create_conversation', { p_participant_ids: pids, p_bounty_id: bountyId ? String(bountyId) : null, p_name: name })
      if (error) {
        throw error
      }

      const convId = (data as any) ?? null
      if (convId) {
        // Refresh conversations from Supabase and return the created one
        try {
          const list = await supabaseMessaging.fetchConversations(userId)
          const found = list.find(c => String(c.id) === String(convId))
          if (found) {
            logClientInfo('Created conversation via RPC', { convId, participantIds: pids })
            return found
          }
          } catch (fetchErr) {
          // Fall through to local fallback
          logClientError('Created conversation but failed to fetch from supabase', { err: fetchErr, convId })
        }
      }
    } catch (rpcErr) {
      // Log and fall back to local messaging layer
      try { logClientError('rpc_create_conversation failed', { err: rpcErr }) } catch {}
    }

    // Fallback: create in local persistent layer
    return messagingService.getOrCreateConversation(allParticipants, name, bountyId);
  },

  /**
   * Pin a message (only one pinned message per conversation)
   */
  pinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    // Note: Pinning functionality would require extending the persistent storage
    // For now, we'll keep this as a no-op that returns success
    // This maintains backward compatibility
    console.log('Pin message:', messageId);
    return { success: true };
  },

  /**
   * Unpin a message
   */
  unpinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    console.log('Unpin message:', messageId);
    return { success: true };
  },

  /**
   * Get pinned message for a conversation
   */
  getPinnedMessage: async (conversationId: string): Promise<Message | null> => {
    // Note: Pinning functionality would require extending the persistent storage
    // For now, return null (no pinned messages)
    return null;
  },

  /**
   * Report a message
   */
  reportMessage: async (messageId: string, reason?: string): Promise<{ success: boolean; error?: string }> => {
    // Load current messages from messaging service storage
    const allMessages = await messagingService.getMessages('')
      .catch(() => [] as any[]);

    const message = allMessages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // In a real app, this would send to a moderation queue
    console.log(`Message ${messageId} reported${reason ? `: ${reason}` : ''}`);
    
    return { success: true };
  },

  /**
   * Update message status
   */
  updateMessageStatus: async (messageId: string, status: 'delivered' | 'read'): Promise<void> => {
    const allMessages = await messagingService.getMessages('')
      .catch(() => [] as any[]);
    const message = allMessages.find((m: any) => m.id === messageId);
    if (message) {
      message.status = status;
      await messagingService.sendMessage(message.conversationId, message.text, message.senderId).catch(() => {});
    }
  },

  /**
   * Process a queued message (called by offline queue service)
   */
  processQueuedMessage: async (conversationId: string, text: string, senderId: string): Promise<Message> => {
    return messagingService.sendMessage(conversationId, text, senderId);
  },
};
