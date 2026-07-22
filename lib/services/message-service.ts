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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// Short-lived de-dupe cache for getConversations(). List screens that render
// one row per item (e.g. my-posting-expandable.tsx, one row per bounty) each
// independently call getConversations() on mount, which otherwise triggers N
// redundant AsyncStorage reads + JSON.parse of the same data within a single
// render pass. Coalescing calls within a short window into one underlying
// fetch removes that redundant work without changing data freshness in any
// way a user would notice (conversations rarely change within 2s).
const CONVERSATIONS_CACHE_TTL_MS = 2000;
let conversationsCache: { userId: string; promise: Promise<Conversation[]>; timestamp: number } | null = null;

export const messageService = {
  getConversations: async (): Promise<Conversation[]> => {
    const userId = getCurrentUserId();
    const now = Date.now();
    if (
      conversationsCache &&
      conversationsCache.userId === userId &&
      now - conversationsCache.timestamp < CONVERSATIONS_CACHE_TTL_MS
    ) {
      return conversationsCache.promise;
    }
    const promise = messagingService.listConversations(userId);
    conversationsCache = { userId, promise, timestamp: now };
    return promise;
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
      const convoParticipantIds = conversation?.participantIds ?? participantIds ?? [];
      const recipientId = convoParticipantIds.find(id => id !== userId);

      if (recipientId && convoParticipantIds.length === 2) {
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

    const isUuidConversation = UUID_RE.test(conversationId);

    let message: Message;
    try {
      if (!isUuidConversation) {
        // Local/fallback conversation IDs (e.g. "conv-*", "local-*") — use AsyncStorage-backed messaging
        const localMessage = await messagingService.sendMessage(
          conversationId,
          finalText,
          effectiveSenderId
        );
        message = { ...localMessage, isEncrypted };
      } else {
        // UUID conversations — persist to Supabase via supabaseMessaging to avoid duplicate logic
        const sentMessage = await supabaseMessaging.sendMessage(
          conversationId,
          finalText,
          effectiveSenderId
        );
        message = {
          ...sentMessage,
          status: sentMessage.status ?? 'sent',
          isEncrypted,
        };

        // Update the conversation's last_message in Supabase
        const {
          data: updatedConversation,
          error: conversationUpdateError,
        } = await supabase
          .from('conversations')
          .update({
            last_message: sanitizedText,
            updated_at: message.createdAt,
          })
          .eq('id', conversationId)
          .select('id')
          .maybeSingle();

        if (conversationUpdateError) {
          console.error('[sendMessage] Failed to update conversation last_message:', {
            conversationId,
            messageId: message.id,
            error: conversationUpdateError,
          });
        } else if (!updatedConversation) {
          console.error('[sendMessage] Conversation last_message update affected no rows:', {
            conversationId,
            messageId: message.id,
          });
        }
      }
    } catch (err) {
      console.error('[sendMessage] Send FAILED:', err);
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
            const supMsg = String(
              (supabaseErr && (supabaseErr as any).message) || supabaseErr || ''
            );
            const supCode = (supabaseErr && (supabaseErr as any).code) || null;
            // If the RPC is missing (PGRST202 / "Could not find the function"),
            // fallback is already implemented below — avoid logging as an error
            // so it doesn't spam monitoring while migrations are applied.
            if (!supMsg.includes('Could not find the function') && supCode !== 'PGRST202') {
              logClientError('Supabase getOrCreateConversation failed', { err: supabaseErr });
            }
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

  /**
   * Process a queued message (called by offline queue service).
   *
   * Guards against the offline queue's retry-with-backoff wrapper creating a
   * duplicate message when a previous attempt's insert actually succeeded
   * server-side but the client never saw the response (dropped connection,
   * app killed mid-request) — the queue item then stays 'pending' and gets
   * retried with the identical payload. Mirrors the same guard already
   * applied to processQueuedBounty() in bounty-service.ts. Since this method
   * has no other caller besides the queue's own retry loop, it's safe to
   * treat "an identical message from this sender in this conversation was
   * created moments ago" as "this is that same attempt" rather than a
   * deliberate resend.
   */
  processQueuedMessage: async (
    conversationId: string,
    text: string,
    senderId: string
  ): Promise<Message> => {
    try {
      const dedupeCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('sender_id', senderId)
        .gte('created_at', dedupeCutoff)
        .order('created_at', { ascending: false })
        .limit(5);

      const match = (recent || []).find((row: any) => {
        const rowText = row.text ?? row.body ?? row.message ?? row.content ?? '';
        return rowText === text;
      });

      if (match) {
        logClientInfo('Skipped re-sending queued message — an identical one from this sender was created within the last 2 minutes (likely a retry of an attempt whose response was lost)', {
          conversationId,
          messageId: match.id,
        });
        return {
          id: match.id,
          conversationId: match.conversation_id,
          senderId: match.sender_id,
          text,
          createdAt: match.created_at,
          status: 'sent',
        } as Message;
      }
    } catch (dedupeCheckError) {
      // If the dedupe check itself fails (network, RLS, etc.), fall through
      // to the normal send rather than blocking queue processing entirely.
    }

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

      // Only consider non-group (1:1) conversations between the two users.
      // If we don't filter here, a shared group chat could be selected
      // and become the `realConversationId`, causing direct messages to
      // be sent into the group by mistake.
      const { data: nonGroupConvs, error: convsError } = await supabase
        .from('conversations')
        .select('id, updated_at')
        .in('id', sharedConversationIds)
        .eq('is_group', false)
        .order('updated_at', { ascending: false });

      if (convsError) throw convsError;
      if (!nonGroupConvs?.length) return null;

      const nonGroupIds = nonGroupConvs.map((c: any) => c.id);

      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', nonGroupIds)
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

      // Choose the most recently-updated non-group conversation as the real target
      const realConversationId = nonGroupConvs[0].id;

      const fullConversation: FullConversation = {
        id: `full-${currentUserId}-${otherUserId}`,
        realConversationId,
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
