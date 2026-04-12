import NetInfo from '@react-native-community/netinfo';
import {
  decryptMessage,
  encryptMessage,
  type EncryptedMessage,
} from '../security/encryption-utils';
import { supabase } from '../supabase';
import type { Conversation, FullConversation, Message } from '../types';
import { getCurrentUserId } from '../utils/data-utils';
import { sanitizeMessage } from '../utils/sanitization';
import { analyticsService } from './analytics-service';
import { e2eKeyService } from './e2e-key-service';
import * as messagingService from './messaging';
import { logClientError, logClientInfo } from './monitoring';
import { offlineQueueService } from './offline-queue-service';
import * as supabaseMessaging from './supabase-messaging';

function tryParseEncryptedPayload(text: string): EncryptedMessage | null {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.ciphertext === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.senderPublicKey === 'string' &&
      typeof parsed.version === 'string' &&
      parsed.version.startsWith('2.')
    ) {
      return parsed as EncryptedMessage;
    }
  } catch {
    // Not JSON or doesn't match the encrypted payload shape
  }
  return null;
}

export const messageService = {
  getConversations: async (): Promise<Conversation[]> => {
    const userId = getCurrentUserId();
    return messagingService.listConversations(userId);
  },

  getConversation: async (id: string): Promise<Conversation | null> => {
    return messagingService.getConversation(id);
  },

  getMessages: async (conversationId: string): Promise<Message[]> => {
    const messages = await messagingService.getMessages(conversationId);
    const userId = getCurrentUserId();

    let keys: { publicKey: string; privateKey: string } | null = null;
    const getKeys = async () => {
      if (keys === null) {
        keys = await e2eKeyService.getOrGenerateKeyPair(userId).catch(() => null);
      }
      return keys;
    };

    return Promise.all(
      messages.map(async msg => {
        const payload = tryParseEncryptedPayload(msg.text);
        if (!payload) return msg;

        try {
          const localKeys = await getKeys();
          if (!localKeys) throw new Error('No local key pair');

          const isFromCurrentUser = msg.senderId === userId;
          const peerPublicKey =
            isFromCurrentUser && payload.recipientPublicKey
              ? payload.recipientPublicKey
              : payload.senderPublicKey;

          const adjustedPayload: EncryptedMessage = { ...payload, senderPublicKey: peerPublicKey };
          const plaintext = await decryptMessage(adjustedPayload, localKeys.privateKey);
          return { ...msg, text: plaintext, isEncrypted: true };
        } catch {
          return { ...msg, text: '[Encrypted message]', isEncrypted: true };
        }
      })
    );
  },

  sendMessage: async (
    conversationId: string,
    text: string,
    senderId?: string,
    participantIds?: string[]
  ): Promise<{ message: Message; error?: string; encryptionWarning?: string }> => {
    const userId = getCurrentUserId();
    const effectiveSenderId = senderId ?? userId;

    let sanitizedText: string;
    try {
      sanitizedText = sanitizeMessage(text);
    } catch (error) {
      console.error('[sendMessage] sanitizeMessage failed:', error);
      return {
        message: {} as Message,
        error: error instanceof Error ? error.message : 'Invalid message',
      };
    }

    let finalText = sanitizedText;
    let isEncrypted = false;
    let encryptionWarning: string | undefined;

    try {
      const conversation = await messagingService.getConversation(conversationId);
      const participantIds = conversation?.participantIds ?? [];
      const recipientId = participantIds.find(id => id !== userId);

      if (recipientId && participantIds.length === 2) {
        const [recipientPublicKey, senderKeys] = await Promise.all([
          e2eKeyService.getRecipientPublicKey(recipientId),
          e2eKeyService.getOrGenerateKeyPair(userId),
        ]);

        if (recipientPublicKey && senderKeys) {
          const encrypted = await encryptMessage(
            sanitizedText,
            recipientPublicKey,
            senderKeys.privateKey
          );
          finalText = JSON.stringify(encrypted);
          isEncrypted = true;
          console.log('[sendMessage] Message encrypted successfully');
        } else {
          encryptionWarning = recipientPublicKey
            ? 'Sender keys unavailable — message sent as plaintext'
            : 'Recipient has no published E2E key — message sent as plaintext';
          console.warn('[sendMessage] Encryption skipped:', encryptionWarning);
        }
      }
    } catch (encErr) {
      encryptionWarning = 'Encryption failed — message sent as plaintext';
      console.error('[sendMessage] Encryption error:', encErr);
      try {
        logClientError('E2E encryption failed, falling back to plaintext', { err: encErr });
      } catch {
        /* ignore */
      }
    }

    const netState = await NetInfo.fetch();
    const isOnline = !!netState.isConnected;
    console.log('[sendMessage] isOnline:', isOnline);

    if (!isOnline) {
      console.log('[sendMessage] Offline — queuing message instead of sending');
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId: conversationId,
        senderId: effectiveSenderId,
        text: sanitizedText,
        createdAt: new Date().toISOString(),
        status: 'sending',
        isEncrypted,
      };

      await offlineQueueService.enqueue('message', {
        conversationId,
        text: finalText,
        senderId: effectiveSenderId,
        tempId: tempMessage.id,
        isEncrypted,
      });

      return { message: tempMessage, encryptionWarning };
    }

    let message: Message;
    try {
      console.log('[sendMessage] Sending to Supabase:', {
        conversationId,
        text: finalText,
        sanitizedText,
        senderId: effectiveSenderId,
        isEncrypted,
      });

      message = await messagingService.sendMessage(conversationId, finalText, effectiveSenderId);

      console.log('[sendMessage] Supabase response:', message);
    } catch (err) {
      console.error('[sendMessage] Supabase call FAILED:', err);
      throw err;
    }

    await analyticsService.trackEvent('message_sent', {
      conversationId,
      messageLength: text.length,
      isOnline,
      isEncrypted,
    });

    await analyticsService.incrementUserProperty('messages_sent');

    return { message: { ...message, isEncrypted, text: sanitizedText }, encryptionWarning };
  },

  retryMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    return { success: true };
  },

  markAsRead: async (conversationId: string): Promise<void> => {
    const userId = getCurrentUserId();
    await messagingService.markAsRead(conversationId, userId);
  },

  createConversation: async (
    participantIds: string[],
    name: string,
    isGroup: boolean = false,
    bountyId?: string
  ): Promise<Conversation> => {
    const userId = getCurrentUserId();
    const allParticipants = participantIds.includes(userId)
      ? participantIds
      : [...participantIds, userId];
    return messagingService.createConversation(allParticipants, name, isGroup, bountyId);
  },

  getOrCreateConversation: async (
    participantIds: string[],
    name: string,
    bountyId?: string
  ): Promise<Conversation> => {
    const userId = getCurrentUserId();
    const allParticipants = participantIds.includes(userId)
      ? participantIds
      : [...participantIds, userId];

    if (allParticipants.length === 2) {
      const otherUserId = allParticipants.find(id => id !== userId);
      if (otherUserId) {
        try {
          const conversation = await supabaseMessaging.getOrCreateConversation(
            userId,
            otherUserId,
            bountyId
          );
          logClientInfo('Got/created 1:1 conversation via Supabase', {
            conversationId: conversation.id,
            otherUserId,
            bountyId,
          });
          await analyticsService.trackEvent('conversation_started', {
            conversationId: conversation.id,
            participantCount: 2,
            isGroup: false,
            hasBounty: !!bountyId,
          });
          return conversation;
        } catch (supabaseErr) {
          try {
            logClientError('Supabase getOrCreateConversation failed', { err: supabaseErr });
          } catch {
            /* ignore */
          }
        }
      }
    }

    const conversation = await messagingService.getOrCreateConversation(
      allParticipants,
      name,
      bountyId
    );
    await analyticsService.trackEvent('conversation_started', {
      conversationId: conversation.id,
      participantCount: allParticipants.length,
      isGroup: allParticipants.length > 2,
      hasBounty: !!bountyId,
    });
    return conversation;
  },

  pinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    return { success: true };
  },

  unpinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    return { success: true };
  },

  getPinnedMessage: async (conversationId: string): Promise<Message | null> => {
    return null;
  },

  reportMessage: async (
    messageId: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const allMessages = await messagingService.getMessages('').catch(() => [] as any[]);
    const message = allMessages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }
    return { success: true };
  },

  updateMessageStatus: async (messageId: string, status: 'delivered' | 'read'): Promise<void> => {
    const allMessages = await messagingService.getMessages('').catch(() => [] as any[]);
    const message = allMessages.find((m: any) => m.id === messageId);
    if (message) {
      message.status = status;
      await messagingService
        .sendMessage(message.conversationId, message.text, message.senderId)
        .catch(() => {});
    }
  },

  processQueuedMessage: async (
    conversationId: string,
    text: string,
    senderId: string
  ): Promise<Message> => {
    return messagingService.sendMessage(conversationId, text, senderId);
  },

  getAllConversationsWithUser: async (otherUserId: string): Promise<Conversation[]> => {
    const userId = getCurrentUserId();
    const allConversations = await messagingService.listConversations(userId);
    return allConversations.filter(convo => (convo.participantIds ?? []).includes(otherUserId));
  },

  getAllMessagesWithUser: async (otherUserId: string): Promise<Message[]> => {
    const conversations = await messageService.getAllConversationsWithUser(otherUserId);
    const allMessagesArrays: Message[][] = await Promise.all(
      conversations.map((convo: Conversation) => messageService.getMessages(convo.id))
    );
    return allMessagesArrays
      .flat()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  getConversationsWithUser: async (otherUserId: string): Promise<FullConversation[]> => {
    const userId = getCurrentUserId();
    if (!userId || !otherUserId) return [];

    try {
      const { data: myParticipations } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId)
        .is('deleted_at', null);

      if (!myParticipations?.length) return [];

      const myConversationIds = myParticipations.map(p => p.conversation_id);

      const { data: sharedParticipations } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', myConversationIds)
        .is('deleted_at', null);

      if (!sharedParticipations?.length) return [];

      const convIds = sharedParticipations.map(p => p.conversation_id);

      const { data: convs } = await supabase
        .from('conversations')
        .select('id, is_group, name, avatar, last_message, updated_at, unread_count, bounty_id')
        .in('id', convIds)
        .eq('is_group', false);

      if (!convs?.length) return [];

      return Promise.all(
        convs.map(async conv => ({
          id: conv.id,
          realConversationId: conv.id,
          bountyId: conv.bounty_id ?? undefined,
          isGroup: conv.is_group,
          name: conv.name,
          participantIds: [userId, otherUserId],
          avatar: conv.avatar ?? undefined,
          lastMessage: conv.last_message ?? undefined,
          updatedAt: conv.updated_at ?? undefined,
          unread: conv.unread_count ?? undefined,
          messages: await messageService.getMessages(conv.id),
        }))
      );
    } catch (err) {
      console.log('getConversationsWithUser failed:', err);
      return [];
    }
  },

  async getFullConversationWithUser(otherUserId: string): Promise<FullConversation | null> {
    const currentUserId = getCurrentUserId();
    if (!currentUserId || !otherUserId || currentUserId === otherUserId) return null;

    try {
      const { data: myParticipations, error: myError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUserId)
        .is('deleted_at', null);

      if (myError) throw myError;
      if (!myParticipations?.length) return null;

      const myConversationIds = myParticipations.map(p => p.conversation_id);

      const { data: sharedParticipations, error: sharedError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', myConversationIds)
        .is('deleted_at', null);

      if (sharedError) throw sharedError;
      if (!sharedParticipations?.length) return null;

      const sharedConversationIds = sharedParticipations.map(p => p.conversation_id);

      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', sharedConversationIds)
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;
      if (!messagesData?.length) return null;

      const allMessages: Message[] = messagesData.map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: msg.sender_id,
        text: msg.text,
        createdAt: msg.created_at,
        replyTo: msg.reply_to ?? undefined,
        mediaUrl: msg.attachment_url ?? undefined,
        status: msg.status ?? 'sent',
        isPinned: msg.is_pinned ?? false,
      }));

      const fullConversation: FullConversation = {
        id: `full-${currentUserId}-${otherUserId}`,
        realConversationId: sharedConversationIds[0],
        isGroup: false,
        name: 'Conversation',
        participantIds: [currentUserId, otherUserId],
        updatedAt: allMessages[allMessages.length - 1].createdAt,
        messages: allMessages,
      };

      return fullConversation;
    } catch (err) {
      console.error('getFullConversationWithUser failed:', err);
      return null;
    }
  },
};
