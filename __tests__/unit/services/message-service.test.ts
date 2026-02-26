/**
 * Unit tests for Message Service - Conversation Deduplication
 */

// Mock dependencies before imports
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../../../lib/services/messaging', () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  createConversation: jest.fn(),
  markAsRead: jest.fn(),
  getOrCreateConversation: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
}));

jest.mock('../../../lib/services/supabase-messaging', () => ({
  fetchConversations: jest.fn(),
  getOrCreateConversation: jest.fn(),
  createConversation: jest.fn(),
}));

jest.mock('../../../lib/services/monitoring', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
    incrementUserProperty: jest.fn(),
  },
}));

jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: {
    enqueue: jest.fn(),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn().mockReturnValue('current-user-id'),
}));

// Mock E2E encryption modules so tests don't need native crypto deps
jest.mock('../../../lib/security/encryption-utils', () => ({
  encryptMessage: jest.fn(),
  decryptMessage: jest.fn(),
}));

jest.mock('../../../lib/services/e2e-key-service', () => ({
  e2eKeyService: {
    getOrGenerateKeyPair: jest.fn().mockResolvedValue(null),
    getRecipientPublicKey: jest.fn().mockResolvedValue(null),
    publishPublicKey: jest.fn().mockResolvedValue(undefined),
    clearCachedPublicKey: jest.fn().mockResolvedValue(undefined),
    deleteLocalKeyPair: jest.fn().mockResolvedValue(undefined),
  },
}));

import { messageService } from '../../../lib/services/message-service';
import * as supabaseMessaging from '../../../lib/services/supabase-messaging';
import * as localMessaging from '../../../lib/services/messaging';
import * as encryptionUtils from '../../../lib/security/encryption-utils';
import { e2eKeyService } from '../../../lib/services/e2e-key-service';

const mockSupabaseMessaging = supabaseMessaging as jest.Mocked<typeof supabaseMessaging>;
const mockLocalMessaging = localMessaging as jest.Mocked<typeof localMessaging>;
const mockEncryption = encryptionUtils as jest.Mocked<typeof encryptionUtils>;
const mockKeyService = e2eKeyService as jest.Mocked<typeof e2eKeyService>;

describe('Message Service - Conversation Deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateConversation', () => {
    it('should use Supabase getOrCreateConversation for 1:1 chats to prevent duplicates', async () => {
      const existingConversation = {
        id: 'existing-conv-id',
        name: 'Test User',
        isGroup: false,
        participantIds: ['current-user-id', 'other-user-id'],
        updatedAt: new Date().toISOString(),
      };

      mockSupabaseMessaging.getOrCreateConversation.mockResolvedValue(existingConversation);

      const result = await messageService.getOrCreateConversation(
        ['other-user-id'],
        'Test User'
      );

      // Verify Supabase getOrCreateConversation was called (which checks for existing convos)
      expect(mockSupabaseMessaging.getOrCreateConversation).toHaveBeenCalledWith(
        'current-user-id',
        'other-user-id',
        undefined
      );

      // Verify the existing conversation was returned
      expect(result.id).toBe('existing-conv-id');
    });

    it('should return existing conversation when one already exists between users', async () => {
      const existingConversation = {
        id: 'existing-1:1-conversation',
        name: 'Other User',
        isGroup: false,
        participantIds: ['current-user-id', 'other-user-id'],
        updatedAt: new Date().toISOString(),
      };

      mockSupabaseMessaging.getOrCreateConversation.mockResolvedValue(existingConversation);

      // Call getOrCreateConversation multiple times with same participants
      const result1 = await messageService.getOrCreateConversation(
        ['other-user-id'],
        'Other User'
      );
      
      const result2 = await messageService.getOrCreateConversation(
        ['other-user-id'],
        'Other User'
      );

      // Both calls should return the same conversation ID
      expect(result1.id).toBe('existing-1:1-conversation');
      expect(result2.id).toBe('existing-1:1-conversation');
    });

    it('should pass bountyId to supabase getOrCreateConversation', async () => {
      const conversation = {
        id: 'conv-with-bounty',
        name: 'Poster',
        isGroup: false,
        bountyId: 'bounty-123',
        participantIds: ['current-user-id', 'poster-id'],
        updatedAt: new Date().toISOString(),
      };

      mockSupabaseMessaging.getOrCreateConversation.mockResolvedValue(conversation);

      await messageService.getOrCreateConversation(
        ['poster-id'],
        'Poster',
        'bounty-123'
      );

      expect(mockSupabaseMessaging.getOrCreateConversation).toHaveBeenCalledWith(
        'current-user-id',
        'poster-id',
        'bounty-123'
      );
    });

    it('should fall back to local messaging when Supabase fails', async () => {
      mockSupabaseMessaging.getOrCreateConversation.mockRejectedValue(
        new Error('Supabase error')
      );

      const localConversation = {
        id: 'local-conv-id',
        name: 'User',
        isGroup: false,
        participantIds: ['current-user-id', 'other-user-id'],
        updatedAt: new Date().toISOString(),
      };

      mockLocalMessaging.getOrCreateConversation.mockResolvedValue(localConversation);

      const result = await messageService.getOrCreateConversation(
        ['other-user-id'],
        'User'
      );

      // Verify local fallback was used
      expect(mockLocalMessaging.getOrCreateConversation).toHaveBeenCalled();
      expect(result.id).toBe('local-conv-id');
    });

    it('should use local messaging for group conversations (more than 2 participants)', async () => {
      const groupConversation = {
        id: 'group-conv-id',
        name: 'Group Chat',
        isGroup: true,
        participantIds: ['current-user-id', 'user-1', 'user-2'],
        updatedAt: new Date().toISOString(),
      };

      mockLocalMessaging.getOrCreateConversation.mockResolvedValue(groupConversation);

      const result = await messageService.getOrCreateConversation(
        ['user-1', 'user-2'],
        'Group Chat'
      );

      // For group chats, should use local messaging directly
      expect(mockLocalMessaging.getOrCreateConversation).toHaveBeenCalled();
      // Supabase should not be called for group chats
      expect(mockSupabaseMessaging.getOrCreateConversation).not.toHaveBeenCalled();
      expect(result.id).toBe('group-conv-id');
    });
  });
});

describe('Message Service - E2E Encryption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should encrypt message when recipient public key is available', async () => {
      const conversation = {
        id: 'conv-1',
        name: 'Chat',
        isGroup: false,
        participantIds: ['current-user-id', 'recipient-id'],
        updatedAt: new Date().toISOString(),
      };
      const sentMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'current-user-id',
        text: '{"ciphertext":"abc","nonce":"def","senderPublicKey":"ghi","version":"2.0"}',
        createdAt: new Date().toISOString(),
        status: 'sent' as const,
      };

      mockLocalMessaging.getConversation.mockResolvedValue(conversation);
      mockLocalMessaging.sendMessage.mockResolvedValue(sentMessage);
      (mockKeyService.getRecipientPublicKey as jest.Mock).mockResolvedValue('recipient-pub-key');
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue({
        publicKey: 'sender-pub-key',
        privateKey: 'sender-priv-key',
      });
      mockEncryption.encryptMessage.mockResolvedValue({
        ciphertext: 'abc',
        nonce: 'def',
        senderPublicKey: 'sender-pub-key',
        recipientPublicKey: 'recipient-pub-key',
        version: '2.0',
      });

      const result = await messageService.sendMessage('conv-1', 'Hello');

      expect(mockEncryption.encryptMessage).toHaveBeenCalledWith(
        'Hello',
        'recipient-pub-key',
        'sender-priv-key'
      );
      expect(result.message.isEncrypted).toBe(true);
      // Caller receives plaintext, not ciphertext
      expect(result.message.text).toBe('Hello');
      expect(result.encryptionWarning).toBeUndefined();
    });

    it('should fall back to plaintext and set encryptionWarning when recipient key is missing', async () => {
      const conversation = {
        id: 'conv-1',
        name: 'Chat',
        isGroup: false,
        participantIds: ['current-user-id', 'recipient-id'],
        updatedAt: new Date().toISOString(),
      };
      const sentMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'current-user-id',
        text: 'Hello',
        createdAt: new Date().toISOString(),
        status: 'sent' as const,
      };

      mockLocalMessaging.getConversation.mockResolvedValue(conversation);
      mockLocalMessaging.sendMessage.mockResolvedValue(sentMessage);
      // No recipient key published yet
      (mockKeyService.getRecipientPublicKey as jest.Mock).mockResolvedValue(null);
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue({
        publicKey: 'sender-pub-key',
        privateKey: 'sender-priv-key',
      });

      const result = await messageService.sendMessage('conv-1', 'Hello');

      expect(mockEncryption.encryptMessage).not.toHaveBeenCalled();
      expect(result.message.isEncrypted).toBe(false);
      expect(result.encryptionWarning).toContain('plaintext');
    });

    it('should use getCurrentUserId() as senderId when not provided', async () => {
      const conversation = {
        id: 'conv-1',
        name: 'Chat',
        isGroup: false,
        participantIds: ['current-user-id', 'recipient-id'],
        updatedAt: new Date().toISOString(),
      };
      const sentMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'current-user-id',
        text: 'Hello',
        createdAt: new Date().toISOString(),
        status: 'sent' as const,
      };

      mockLocalMessaging.getConversation.mockResolvedValue(conversation);
      mockLocalMessaging.sendMessage.mockResolvedValue(sentMessage);
      (mockKeyService.getRecipientPublicKey as jest.Mock).mockResolvedValue(null);
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue(null);

      await messageService.sendMessage('conv-1', 'Hello');

      // sendMessage to the storage layer should be called with the current user ID
      expect(mockLocalMessaging.sendMessage).toHaveBeenCalledWith(
        'conv-1',
        'Hello',
        'current-user-id'
      );
    });
  });

  describe('getMessages', () => {
    it('should decrypt encrypted messages detected by payload shape', async () => {
      const encryptedPayload = JSON.stringify({
        ciphertext: 'abc',
        nonce: 'def',
        senderPublicKey: 'sender-pub',
        recipientPublicKey: 'my-pub',
        version: '2.0',
      });
      const messages = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'other-user-id',
          text: encryptedPayload,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          senderId: 'other-user-id',
          text: 'Plain text message',
          createdAt: new Date().toISOString(),
        },
      ];

      mockLocalMessaging.getMessages.mockResolvedValue(messages as any);
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue({
        publicKey: 'my-pub',
        privateKey: 'my-priv',
      });
      mockEncryption.decryptMessage.mockResolvedValue('Decrypted text');

      const result = await messageService.getMessages('conv-1');

      expect(result[0].text).toBe('Decrypted text');
      expect(result[0].isEncrypted).toBe(true);
      // Plain message should be unchanged
      expect(result[1].text).toBe('Plain text message');
    });

    it('should show placeholder when decryption fails', async () => {
      const encryptedPayload = JSON.stringify({
        ciphertext: 'bad-data',
        nonce: 'def',
        senderPublicKey: 'sender-pub',
        version: '2.0',
      });
      const messages = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'other-user-id',
          text: encryptedPayload,
          createdAt: new Date().toISOString(),
        },
      ];

      mockLocalMessaging.getMessages.mockResolvedValue(messages as any);
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue({
        publicKey: 'my-pub',
        privateKey: 'my-priv',
      });
      mockEncryption.decryptMessage.mockRejectedValue(new Error('Decryption failed'));

      const result = await messageService.getMessages('conv-1');

      expect(result[0].text).toBe('[Encrypted message]');
      expect(result[0].isEncrypted).toBe(true);
    });

    it('should use recipientPublicKey (not senderPublicKey) when decrypting own sent messages', async () => {
      const encryptedPayload = JSON.stringify({
        ciphertext: 'abc',
        nonce: 'def',
        senderPublicKey: 'my-pub',          // current user is sender
        recipientPublicKey: 'recipient-pub', // peer key needed for own-message decryption
        version: '2.0',
      });
      const messages = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'current-user-id', // same as getCurrentUserId()
          text: encryptedPayload,
          createdAt: new Date().toISOString(),
        },
      ];

      mockLocalMessaging.getMessages.mockResolvedValue(messages as any);
      (mockKeyService.getOrGenerateKeyPair as jest.Mock).mockResolvedValue({
        publicKey: 'my-pub',
        privateKey: 'my-priv',
      });
      mockEncryption.decryptMessage.mockResolvedValue('My sent message');

      await messageService.getMessages('conv-1');

      // decryptMessage should be called with recipientPublicKey as senderPublicKey
      expect(mockEncryption.decryptMessage).toHaveBeenCalledWith(
        expect.objectContaining({ senderPublicKey: 'recipient-pub' }),
        'my-priv'
      );
    });
  });
});
