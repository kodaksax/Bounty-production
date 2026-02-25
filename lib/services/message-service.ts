import NetInfo from '@react-native-community/netinfo';
import type { Conversation, Message } from '../types';
import { getCurrentUserId } from '../utils/data-utils';
import { sanitizeMessage } from '../utils/sanitization';
import * as messagingService from './messaging';
import { logClientError, logClientInfo } from './monitoring';
import { offlineQueueService } from './offline-queue-service';
import * as supabaseMessaging from './supabase-messaging';
import { analyticsService } from './analytics-service';
import { encryptMessage, decryptMessage, type EncryptedMessage } from '../security/encryption-utils';
import { e2eKeyService } from './e2e-key-service';

/**
 * Attempt to parse `text` as an EncryptedMessage payload (version 2.x).
 * Returns the parsed payload if the shape matches, or null for plaintext messages.
 */
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
   * Get messages for a conversation, decrypting any E2E-encrypted messages.
   * Encrypted messages are detected by their JSON payload shape (version 2.x)
   * so this works even when the `isEncrypted` flag wasn't persisted by the
   * storage layer.
   */
  getMessages: async (conversationId: string): Promise<Message[]> => {
    const messages = await messagingService.getMessages(conversationId);
    const userId = getCurrentUserId();

    // Lazily load key pair only when there are potentially encrypted messages
    let keys: { publicKey: string; privateKey: string } | null = null;
    const getKeys = async () => {
      if (keys === null) {
        keys = await e2eKeyService.getOrGenerateKeyPair(userId).catch(() => null);
      }
      return keys;
    };

    return Promise.all(
      messages.map(async (msg) => {
        // Detect encrypted messages by payload shape (not just the isEncrypted flag,
        // since the flag may not be persisted by the local/Supabase storage layer).
        const payload = tryParseEncryptedPayload(msg.text);
        if (!payload) return msg;

        try {
          const localKeys = await getKeys();
          if (!localKeys) throw new Error('No local key pair');

          // nacl.box uses the shared secret ECDH(senderPriv, recipientPub).
          // The sender and recipient derive the same secret but with swapped keys:
          //   - Recipient decrypts: box.open(cipher, nonce, senderPublicKey, recipientPrivateKey)
          //   - Sender decrypts own msg: box.open(cipher, nonce, recipientPublicKey, senderPrivateKey)
          // We stored recipientPublicKey in the payload for exactly this case.
          const isFromCurrentUser = msg.senderId === userId;
          const peerPublicKey =
            isFromCurrentUser && payload.recipientPublicKey
              ? payload.recipientPublicKey
              : payload.senderPublicKey;

          const adjustedPayload: EncryptedMessage = { ...payload, senderPublicKey: peerPublicKey };
          const plaintext = await decryptMessage(adjustedPayload, localKeys.privateKey);
          return { ...msg, text: plaintext, isEncrypted: true };
        } catch {
          // If decryption fails, show a placeholder rather than crashing
          return { ...msg, text: '[Encrypted message]', isEncrypted: true };
        }
      })
    );
  },

  /**
   * Send a message (optimistic update with offline support).
   * For 1:1 conversations the message is E2E-encrypted if the recipient's
   * public key is available; otherwise it falls back to plaintext and the
   * returned `encryptionWarning` field will be set.
   */
  sendMessage: async (
    conversationId: string,
    text: string,
    senderId?: string
  ): Promise<{ message: Message; error?: string; encryptionWarning?: string }> => {
    // Use the authenticated user ID if no explicit senderId was provided
    const userId = getCurrentUserId();
    const effectiveSenderId = senderId ?? userId;

    // Sanitize message text to prevent XSS attacks
    let sanitizedText: string;
    try {
      sanitizedText = sanitizeMessage(text);
    } catch (error) {
      return {
        message: {} as Message,
        error: error instanceof Error ? error.message : 'Invalid message',
      };
    }

    // Attempt E2E encryption for 1:1 conversations
    let finalText = sanitizedText;
    let isEncrypted = false;
    let encryptionWarning: string | undefined;

    try {
      const conversation = await messagingService.getConversation(conversationId);
      const participantIds = conversation?.participantIds ?? [];
      const recipientId = participantIds.find((id) => id !== userId);

      if (recipientId && participantIds.length === 2) {
        const [recipientPublicKey, senderKeys] = await Promise.all([
          e2eKeyService.getRecipientPublicKey(recipientId),
          e2eKeyService.getOrGenerateKeyPair(userId),
        ]);

        if (recipientPublicKey && senderKeys) {
          const encrypted = await encryptMessage(sanitizedText, recipientPublicKey, senderKeys.privateKey);
          finalText = JSON.stringify(encrypted);
          isEncrypted = true;
        } else {
          encryptionWarning = recipientPublicKey
            ? 'Sender keys unavailable — message sent as plaintext'
            : 'Recipient has no published E2E key — message sent as plaintext';
        }
      }
    } catch (encErr) {
      // Non-fatal: fall back to plaintext but surface a warning
      encryptionWarning = 'Encryption failed — message sent as plaintext';
      try { logClientError('E2E encryption failed, falling back to plaintext', { err: encErr }); } catch { /* ignore */ }
    }

    // Check network connectivity
    const netState = await NetInfo.fetch();
    const isOnline = !!netState.isConnected;

    if (!isOnline) {
      // Queue for later if offline.
      // The tempMessage shows plaintext to the local UI so the user sees their own
      // message immediately; the queued payload contains the encrypted finalText
      // that will be sent once the device reconnects.
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderId: effectiveSenderId,
        text: sanitizedText, // show original text locally while pending
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

    // Send message using persistent storage.
    // Note: this currently routes through the local AsyncStorage messaging layer.
    // Encrypted ciphertext (finalText) is what gets persisted; the caller receives
    // plaintext (sanitizedText) via the returned message object.
    const message = await messagingService.sendMessage(conversationId, finalText, effectiveSenderId);

    // Track message sent event
    await analyticsService.trackEvent('message_sent', {
      conversationId,
      messageLength: text.length,
      isOnline,
      isEncrypted,
    });

    // Increment user property for messages sent
    await analyticsService.incrementUserProperty('messages_sent');

    // Return plaintext to the caller (the UI) while the DB stores ciphertext.
    // The `isEncrypted` flag signals that the persisted copy is encrypted.
    return { message: { ...message, isEncrypted, text: sanitizedText }, encryptionWarning };
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

    // For 1:1 conversations, use Supabase's getOrCreateConversation which properly
    // checks for existing conversations before creating new ones
    if (allParticipants.length === 2) {
      const otherUserId = allParticipants.find(id => id !== userId);
      if (otherUserId) {
        try {
          // Use supabaseMessaging.getOrCreateConversation which checks for existing
          // 1:1 conversations before creating a new one
          const conversation = await supabaseMessaging.getOrCreateConversation(
            userId,
            otherUserId,
            bountyId
          );
          
          logClientInfo('Got/created 1:1 conversation via Supabase', { 
            conversationId: conversation.id, 
            otherUserId,
            bountyId 
          });

          // Track conversation started event
          await analyticsService.trackEvent('conversation_started', {
            conversationId: conversation.id,
            participantCount: 2,
            isGroup: false,
            hasBounty: !!bountyId,
          });

          return conversation;
        } catch (supabaseErr) {
          // Log and fall back to local messaging layer
          // Ignore logging errors to prevent breaking the fallback flow
          try { logClientError('Supabase getOrCreateConversation failed', { err: supabaseErr }) } catch { /* ignore logging errors */ }
        }
      }
    }

    // Fallback: create in local persistent layer (also handles group conversations)
    const conversation = await messagingService.getOrCreateConversation(allParticipants, name, bountyId);

    // Track conversation started event (may be a new or existing conversation)
    await analyticsService.trackEvent('conversation_started', {
      conversationId: conversation.id,
      participantCount: allParticipants.length,
      isGroup: allParticipants.length > 2,
      hasBounty: !!bountyId,
    });

    return conversation;
  },

  /**
   * Pin a message (only one pinned message per conversation)
   */
  pinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    // Note: Pinning functionality would require extending the persistent storage
    // For now, we'll keep this as a no-op that returns success
    // This maintains backward compatibility
    return { success: true };
  },

  /**
   * Unpin a message
   */
  unpinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
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
