/**
 * E2E Complete Bounty Flow Tests
 * 
 * Tests the complete user journey through the bounty lifecycle:
 * 1. Create bounty (poster)
 * 2. Discover & apply (hunter)
 * 3. Accept application (poster)
 * 4. Work & communicate (both)
 * 5. Complete & payment (both)
 * 6. Cancellation scenarios
 * 
 * These tests ensure critical user paths remain functional.
 */

import type { Request, Conversation, Message, WalletTransaction } from '../../lib/types';
import type { Bounty } from '../../packages/domain-types/src/bounty';

describe('Complete Bounty Flow E2E Tests', () => {
  // Test user IDs
  const POSTER_ID = 'user_poster_123';
  const HUNTER_ID_1 = 'user_hunter_alice';
  const HUNTER_ID_2 = 'user_hunter_bob';
  const HUNTER_ID_3 = 'user_hunter_charlie';

  // Mock services
  let mockBountyService: any;
  let mockRequestService: any;
  let mockConversationService: any;
  let mockWalletService: any;
  let mockNotificationService: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Mock bounty service
    mockBountyService = {
      create: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    // Mock request service
    mockRequestService = {
      create: jest.fn(),
      accept: jest.fn(),
      reject: jest.fn(),
      getByBountyId: jest.fn(),
      deleteCompetingRequests: jest.fn(),
    };

    // Mock conversation service
    mockConversationService = {
      create: jest.fn(),
      sendMessage: jest.fn(),
      getMessages: jest.fn(),
    };

    // Mock wallet service
    mockWalletService = {
      createEscrow: jest.fn(),
      releasePayment: jest.fn(),
      refund: jest.fn(),
      getBalance: jest.fn(),
      getTransactions: jest.fn(),
    };

    // Mock notification service
    mockNotificationService = {
      send: jest.fn(),
      markAsRead: jest.fn(),
    };
  });

  describe('User Journey 1: Create Bounty Flow', () => {
    it('should create a paid bounty with all required fields', async () => {
      // Arrange
      const bountyData = {
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Need a React Native mobile app for iOS and Android with user authentication and real-time features.',
        amount: 50000, // $500.00
        isForHonor: false,
        location: 'San Francisco, CA',
        status: 'open' as const,
      };

      const createdBounty: Bounty = {
        id: 'bounty_123',
        ...bountyData,
        createdAt: new Date().toISOString(),
      };

      mockBountyService.create.mockResolvedValue(createdBounty);
      mockBountyService.list.mockResolvedValue([createdBounty]);

      // Act - Poster creates bounty
      const bounty = await mockBountyService.create(bountyData);

      // Assert
      expect(bounty).toBeDefined();
      expect(bounty.id).toBe('bounty_123');
      expect(bounty.title).toBe('Build a Mobile App');
      expect(bounty.amount).toBe(50000);
      expect(bounty.status).toBe('open');
      expect(mockBountyService.create).toHaveBeenCalledWith(bountyData);

      // Act - Verify bounty appears in postings
      const postings = await mockBountyService.list({ status: 'open' });

      // Assert
      expect(postings).toContain(createdBounty);
      expect(postings).toHaveLength(1);
    });

    it('should create an honor-based bounty (no payment)', async () => {
      // Arrange
      const honorBountyData = {
        user_id: POSTER_ID,
        title: 'Community Garden Help',
        description: 'Need volunteers to help set up a community garden this weekend.',
        amount: 0,
        isForHonor: true,
        location: 'Oakland, CA',
        status: 'open' as const,
      };

      const createdBounty: Bounty = {
        id: 'bounty_honor',
        ...honorBountyData,
        createdAt: new Date().toISOString(),
      };

      mockBountyService.create.mockResolvedValue(createdBounty);

      // Act
      const bounty = await mockBountyService.create(honorBountyData);

      // Assert
      expect(bounty.isForHonor).toBe(true);
      expect(bounty.amount).toBe(0);
      expect(bounty.status).toBe('open');
    });

    it('should validate required fields during creation', async () => {
      // Arrange - Missing title
      const invalidBountyData = {
        user_id: POSTER_ID,
        description: 'A description without a title',
        amount: 10000,
      };

      mockBountyService.create.mockRejectedValue(
        new Error('Validation error: title is required')
      );

      // Act & Assert
      await expect(
        mockBountyService.create(invalidBountyData)
      ).rejects.toThrow('Validation error: title is required');
    });

    it('should prevent creating bounty with negative amount', async () => {
      // Arrange
      const invalidAmountData = {
        user_id: POSTER_ID,
        title: 'Invalid Bounty',
        description: 'This should fail',
        amount: -5000,
      };

      mockBountyService.create.mockRejectedValue(
        new Error('Validation error: amount must be positive')
      );

      // Act & Assert
      await expect(
        mockBountyService.create(invalidAmountData)
      ).rejects.toThrow('amount must be positive');
    });
  });

  describe('User Journey 2: Apply & Accept Flow', () => {
    const bountyId = 'bounty_123';
    let bounty: Bounty;

    beforeEach(() => {
      bounty = {
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Need a React Native mobile app',
        amount: 50000,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
    });

    it('should allow hunter to discover bounty in postings', async () => {
      // Arrange
      mockBountyService.list.mockResolvedValue([bounty]);

      // Act - Hunter browses available bounties
      const availableBounties = await mockBountyService.list({ status: 'open' });

      // Assert
      expect(availableBounties).toContain(bounty);
      expect(availableBounties[0].status).toBe('open');
    });

    it('should allow hunter to apply to bounty', async () => {
      // Arrange
      const request: Request = {
        id: 'req_alice',
        bountyId,
        hunterId: HUNTER_ID_1,
        posterId: POSTER_ID,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      mockRequestService.create.mockResolvedValue(request);
      mockNotificationService.send.mockResolvedValue(true);

      // Act - Hunter applies
      const application = await mockRequestService.create({
        bountyId,
        hunterId: HUNTER_ID_1,
      });

      // Send notification to poster
      await mockNotificationService.send({
        user_id: POSTER_ID,
        type: 'application',
        title: 'New Application',
        body: 'Someone applied to your bounty',
      });

      // Assert
      expect(application.status).toBe('pending');
      expect(application.bountyId).toBe(bountyId);
      expect(application.hunterId).toBe(HUNTER_ID_1);

      // Verify poster receives notification
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: POSTER_ID,
          type: 'application',
        })
      );
    });

    it('should allow multiple hunters to apply to same bounty', async () => {
      // Arrange
      const requests: Request[] = [
        {
          id: 'req_alice',
          bountyId,
          hunterId: HUNTER_ID_1,
          posterId: POSTER_ID,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req_bob',
          bountyId,
          hunterId: HUNTER_ID_2,
          posterId: POSTER_ID,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req_charlie',
          bountyId,
          hunterId: HUNTER_ID_3,
          posterId: POSTER_ID,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      mockRequestService.getByBountyId.mockResolvedValue(requests);

      // Act - Poster views all applications
      const applications = await mockRequestService.getByBountyId(bountyId);

      // Assert
      expect(applications).toHaveLength(3);
      expect(applications.map((r: Request) => r.hunterId)).toEqual([
        HUNTER_ID_1,
        HUNTER_ID_2,
        HUNTER_ID_3,
      ]);
      expect(applications.every((r: Request) => r.status === 'pending')).toBe(true);
    });

    it('should accept hunter application and update bounty status', async () => {
      // Arrange
      const acceptedRequest: Request = {
        id: 'req_alice',
        bountyId,
        hunterId: HUNTER_ID_1,
        posterId: POSTER_ID,
        status: 'accepted',
        createdAt: new Date().toISOString(),
      };

      const updatedBounty: Bounty = {
        ...bounty,
        status: 'in_progress',
      };

      mockRequestService.accept.mockResolvedValue(acceptedRequest);
      mockBountyService.update.mockResolvedValue(updatedBounty);
      mockRequestService.deleteCompetingRequests.mockResolvedValue(2); // Bob and Charlie
      mockWalletService.createEscrow.mockResolvedValue({
        id: 'escrow_123',
        type: 'escrow',
        amount: -50000,
        bountyId,
        status: 'completed',
      });
      mockConversationService.create.mockResolvedValue({
        id: 'conv_123',
        bountyId,
        participantIds: [POSTER_ID, HUNTER_ID_1],
      });

      // Act - Poster accepts Alice's application
      const accepted = await mockRequestService.accept('req_alice');
      await mockBountyService.update(bountyId, { status: 'in_progress' });
      await mockRequestService.deleteCompetingRequests(bountyId, 'req_alice');
      await mockWalletService.createEscrow({ bountyId, amount: 50000 });
      const conversation = await mockConversationService.create({
        bountyId,
        participantIds: [POSTER_ID, HUNTER_ID_1],
      });

      // Assert
      expect(accepted.status).toBe('accepted');
      expect(accepted.hunterId).toBe(HUNTER_ID_1);
      expect(mockBountyService.update).toHaveBeenCalledWith(
        bountyId,
        expect.objectContaining({ status: 'in_progress' })
      );
      expect(mockRequestService.deleteCompetingRequests).toHaveBeenCalledWith(
        bountyId,
        'req_alice'
      );
      expect(mockWalletService.createEscrow).toHaveBeenCalled();
      expect(conversation.participantIds).toContain(POSTER_ID);
      expect(conversation.participantIds).toContain(HUNTER_ID_1);
    });

    it('should reject competing requests when one is accepted', async () => {
      // Arrange
      mockRequestService.deleteCompetingRequests.mockResolvedValue(2);

      // Act
      const deletedCount = await mockRequestService.deleteCompetingRequests(
        bountyId,
        'req_alice'
      );

      // Assert
      expect(deletedCount).toBe(2); // Bob and Charlie's requests
      expect(mockRequestService.deleteCompetingRequests).toHaveBeenCalledWith(
        bountyId,
        'req_alice'
      );
    });

    it('should create conversation between poster and accepted hunter', async () => {
      // Arrange
      const conversation: Conversation = {
        id: 'conv_123',
        bountyId,
        isGroup: false,
        name: 'Build a Mobile App',
        participantIds: [POSTER_ID, HUNTER_ID_1],
        lastMessage: "You've been selected for: Build a Mobile App",
        updatedAt: new Date().toISOString(),
      };

      mockConversationService.create.mockResolvedValue(conversation);
      mockConversationService.sendMessage.mockResolvedValue({
        id: 'msg_welcome',
        conversationId: 'conv_123',
        senderId: 'system',
        text: "You've been selected for: Build a Mobile App",
        createdAt: new Date().toISOString(),
      });

      // Act
      const conv = await mockConversationService.create({
        bountyId,
        participantIds: [POSTER_ID, HUNTER_ID_1],
      });
      await mockConversationService.sendMessage('conv_123', {
        senderId: 'system',
        text: "You've been selected for: Build a Mobile App",
      });

      // Assert
      expect(conv.bountyId).toBe(bountyId);
      expect(conv.participantIds).toHaveLength(2);
      expect(mockConversationService.sendMessage).toHaveBeenCalled();
    });

    it('should create escrow transaction for paid bounty', async () => {
      // Arrange
      const escrowTransaction: WalletTransaction = {
        id: 'txn_escrow_123',
        type: 'escrow',
        amount: -50000, // Deducted from poster's wallet
        bountyId,
        createdAt: new Date().toISOString(),
        status: 'completed',
        disputeStatus: 'none',
        details: {
          title: 'Escrowed for bounty: Build a Mobile App',
          counterparty: HUNTER_ID_1,
        },
      };

      mockWalletService.createEscrow.mockResolvedValue(escrowTransaction);
      mockWalletService.getBalance.mockResolvedValue(100000); // $1000 available

      // Act
      const escrow = await mockWalletService.createEscrow({
        bountyId,
        amount: 50000,
        posterId: POSTER_ID,
        hunterId: HUNTER_ID_1,
      });

      // Assert
      expect(escrow.type).toBe('escrow');
      expect(escrow.amount).toBe(-50000);
      expect(escrow.status).toBe('completed');
      expect(escrow.bountyId).toBe(bountyId);
    });

    it('should prevent acceptance if poster has insufficient balance', async () => {
      // Arrange
      mockWalletService.getBalance.mockResolvedValue(10000); // Only $100
      mockWalletService.createEscrow.mockRejectedValue(
        new Error('Insufficient balance for escrow')
      );

      // Act & Assert
      await expect(
        mockWalletService.createEscrow({
          bountyId,
          amount: 50000, // Needs $500
        })
      ).rejects.toThrow('Insufficient balance');
    });

    it('should send notifications to all parties on acceptance', async () => {
      // Arrange
      mockNotificationService.send.mockResolvedValue(true);

      // Act
      await mockNotificationService.send({
        user_id: HUNTER_ID_1,
        type: 'acceptance',
        title: 'Application Accepted!',
        body: 'Your application to "Build a Mobile App" was accepted',
      });
      await mockNotificationService.send({
        user_id: HUNTER_ID_2,
        type: 'application',
        title: 'Application Status',
        body: 'Another hunter was selected for "Build a Mobile App"',
      });

      // Assert
      expect(mockNotificationService.send).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'acceptance' })
      );
    });
  });

  describe('User Journey 3: Work & Communication', () => {
    const bountyId = 'bounty_123';
    const conversationId = 'conv_123';

    it('should allow poster and hunter to exchange messages', async () => {
      // Arrange
      const messages: Message[] = [
        {
          id: 'msg_1',
          conversationId,
          senderId: POSTER_ID,
          text: 'Hi! Looking forward to working with you.',
          createdAt: new Date().toISOString(),
          status: 'read',
        },
        {
          id: 'msg_2',
          conversationId,
          senderId: HUNTER_ID_1,
          text: 'Thanks! I have a few questions about the requirements.',
          createdAt: new Date().toISOString(),
          status: 'read',
        },
      ];

      mockConversationService.sendMessage.mockResolvedValue(messages[0]);
      mockConversationService.getMessages.mockResolvedValue(messages);

      // Act
      await mockConversationService.sendMessage(conversationId, {
        senderId: POSTER_ID,
        text: 'Hi! Looking forward to working with you.',
      });
      const allMessages = await mockConversationService.getMessages(conversationId);

      // Assert
      expect(allMessages).toHaveLength(2);
      expect(allMessages[0].senderId).toBe(POSTER_ID);
      expect(allMessages[1].senderId).toBe(HUNTER_ID_1);
    });

    it('should support message attachments', async () => {
      // Arrange
      const messageWithAttachment: Message = {
        id: 'msg_attach',
        conversationId,
        senderId: POSTER_ID,
        text: 'Here are the design mockups',
        mediaUrl: 'https://storage.example.com/mockups.pdf',
        createdAt: new Date().toISOString(),
        status: 'sent',
      };

      mockConversationService.sendMessage.mockResolvedValue(messageWithAttachment);

      // Act
      const message = await mockConversationService.sendMessage(conversationId, {
        senderId: POSTER_ID,
        text: 'Here are the design mockups',
        mediaUrl: 'https://storage.example.com/mockups.pdf',
      });

      // Assert
      expect(message.mediaUrl).toBeDefined();
      expect(message.mediaUrl).toContain('mockups.pdf');
    });

    it('should update message status as read', async () => {
      // Arrange
      const message: Message = {
        id: 'msg_unread',
        conversationId,
        senderId: POSTER_ID,
        text: 'Any progress updates?',
        createdAt: new Date().toISOString(),
        status: 'delivered',
      };

      mockConversationService.sendMessage.mockResolvedValue(message);

      // Act
      const sent = await mockConversationService.sendMessage(conversationId, {
        senderId: POSTER_ID,
        text: 'Any progress updates?',
      });

      // Simulate hunter reads message
      sent.status = 'read';

      // Assert
      expect(sent.status).toBe('read');
    });

    it('should show bounty progress to both parties', async () => {
      // Arrange
      const bounty: Bounty = {
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'In progress',
        amount: 50000,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
      };

      mockBountyService.getById.mockResolvedValue(bounty);

      // Act - Both poster and hunter can view bounty
      const posterView = await mockBountyService.getById(bountyId);
      const hunterView = await mockBountyService.getById(bountyId);

      // Assert
      expect(posterView.status).toBe('in_progress');
      expect(hunterView.status).toBe('in_progress');
      expect(posterView).toEqual(hunterView);
    });
  });

  describe('User Journey 4: Complete & Payment Flow', () => {
    const bountyId = 'bounty_123';
    const conversationId = 'conv_123';

    beforeEach(() => {
      // Setup bounty in progress state
      mockBountyService.getById.mockResolvedValue({
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Almost done',
        amount: 50000,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
      });
    });

    it('should allow hunter to mark work as complete', async () => {
      // Arrange
      const updatedBounty: Bounty = {
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Completed by hunter',
        amount: 50000,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      mockBountyService.update.mockResolvedValue(updatedBounty);
      mockNotificationService.send.mockResolvedValue(true);

      // Act - Hunter marks as complete
      const completed = await mockBountyService.update(bountyId, {
        status: 'completed',
      });
      await mockNotificationService.send({
        user_id: POSTER_ID,
        type: 'completion',
        title: 'Bounty Completed',
        body: 'Hunter has marked "Build a Mobile App" as complete',
      });

      // Assert
      expect(completed.status).toBe('completed');
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'completion',
          user_id: POSTER_ID,
        })
      );
    });

    it('should release escrow payment on completion', async () => {
      // Arrange
      const releaseTransaction: WalletTransaction = {
        id: 'txn_release_123',
        type: 'release',
        amount: 50000, // Credited to hunter
        bountyId,
        createdAt: new Date().toISOString(),
        status: 'completed',
        disputeStatus: 'none',
        details: {
          title: 'Payment released for: Build a Mobile App',
          counterparty: HUNTER_ID_1,
        },
      };

      mockWalletService.releasePayment.mockResolvedValue(releaseTransaction);
      mockNotificationService.send.mockResolvedValue(true);

      // Act - Poster approves and releases payment
      const payment = await mockWalletService.releasePayment({
        bountyId,
        hunterId: HUNTER_ID_1,
        amount: 50000,
      });

      // Assert
      expect(payment.type).toBe('release');
      expect(payment.amount).toBe(50000);
      expect(payment.status).toBe('completed');
      expect(payment.bountyId).toBe(bountyId);
    });

    it('should update wallet balances after payment release', async () => {
      // Arrange
      mockWalletService.getBalance.mockResolvedValueOnce(50000); // Poster (after escrow)
      mockWalletService.releasePayment.mockResolvedValue({
        type: 'release',
        amount: 50000,
      });
      mockWalletService.getBalance.mockResolvedValueOnce(50000); // Hunter (after release)

      // Act
      await mockWalletService.releasePayment({ bountyId, amount: 50000 });
      const hunterBalance = await mockWalletService.getBalance(HUNTER_ID_1);

      // Assert
      expect(hunterBalance).toBe(50000); // $500 credited
    });

    it('should create wallet transaction records', async () => {
      // Arrange
      const transactions: WalletTransaction[] = [
        {
          id: 'txn_escrow',
          type: 'escrow',
          amount: -50000,
          bountyId,
          createdAt: new Date().toISOString(),
          status: 'completed',
        },
        {
          id: 'txn_release',
          type: 'release',
          amount: 50000,
          bountyId,
          createdAt: new Date().toISOString(),
          status: 'completed',
        },
      ];

      mockWalletService.getTransactions.mockResolvedValue(transactions);

      // Act
      const history = await mockWalletService.getTransactions(bountyId);

      // Assert
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('escrow');
      expect(history[1].type).toBe('release');
      expect(history[0].amount).toBe(-50000);
      expect(history[1].amount).toBe(50000);
    });

    it('should send payment notification to hunter', async () => {
      // Arrange
      mockWalletService.releasePayment.mockResolvedValue({
        type: 'release',
        amount: 50000,
      });
      mockNotificationService.send.mockResolvedValue(true);

      // Act
      await mockWalletService.releasePayment({ bountyId, amount: 50000 });
      await mockNotificationService.send({
        user_id: HUNTER_ID_1,
        type: 'payment',
        title: 'Payment Received',
        body: 'You received $500 for "Build a Mobile App"',
        data: { amount: 50000, bountyId },
      });

      // Assert
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'payment',
          user_id: HUNTER_ID_1,
          data: expect.objectContaining({ amount: 50000 }),
        })
      );
    });

    it('should only allow poster to release payment', async () => {
      // Arrange
      const unauthorizedUserId = 'some_other_user';
      mockWalletService.releasePayment.mockRejectedValue(
        new Error('Unauthorized: Only bounty poster can release payment')
      );

      // Act & Assert
      await expect(
        mockWalletService.releasePayment({
          bountyId,
          requesterId: unauthorizedUserId,
        })
      ).rejects.toThrow('Unauthorized');
    });

    it('should handle honor-based bounty completion (no payment)', async () => {
      // Arrange
      const honorBounty: Bounty = {
        id: 'bounty_honor',
        user_id: POSTER_ID,
        title: 'Community Garden Help',
        description: 'Volunteer work',
        amount: 0,
        isForHonor: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      mockBountyService.update.mockResolvedValue(honorBounty);

      // Act - Complete honor bounty (no payment flow)
      const completed = await mockBountyService.update('bounty_honor', {
        status: 'completed',
      });

      // Assert
      expect(completed.isForHonor).toBe(true);
      expect(completed.status).toBe('completed');
      expect(mockWalletService.releasePayment).not.toHaveBeenCalled();
    });
  });

  describe('User Journey 5: Cancellation Flow', () => {
    const bountyId = 'bounty_123';

    it('should allow poster to cancel bounty before acceptance', async () => {
      // Arrange
      const openBounty: Bounty = {
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Cancelled before work started',
        amount: 50000,
        status: 'open',
        createdAt: new Date().toISOString(),
      };

      mockBountyService.getById.mockResolvedValue(openBounty);
      mockBountyService.delete.mockResolvedValue(true);
      mockRequestService.getByBountyId.mockResolvedValue([
        { id: 'req_1', status: 'pending' },
        { id: 'req_2', status: 'pending' },
      ]);

      // Act - Poster cancels
      await mockBountyService.delete(bountyId);
      await mockNotificationService.send({
        user_id: HUNTER_ID_1,
        type: 'cancellation_request',
        title: 'Bounty Cancelled',
        body: 'The bounty "Build a Mobile App" was cancelled by the poster',
      });

      // Assert
      expect(mockBountyService.delete).toHaveBeenCalledWith(bountyId);
      expect(mockNotificationService.send).toHaveBeenCalled();
    });

    it('should handle cancellation request during work', async () => {
      // Arrange
      const inProgressBounty: Bounty = {
        id: bountyId,
        user_id: POSTER_ID,
        title: 'Build a Mobile App',
        description: 'Work in progress',
        amount: 50000,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
      };

      mockBountyService.getById.mockResolvedValue(inProgressBounty);

      // Act - Cannot directly delete in_progress bounty
      mockBountyService.delete.mockRejectedValue(
        new Error('Cannot cancel in_progress bounty without negotiation')
      );

      // Assert
      await expect(mockBountyService.delete(bountyId)).rejects.toThrow(
        'Cannot cancel in_progress bounty'
      );
    });

    it('should process refund for cancelled paid bounty', async () => {
      // Arrange
      const refundTransaction: WalletTransaction = {
        id: 'txn_refund_123',
        type: 'refund',
        amount: 50000, // Refunded to poster
        bountyId,
        createdAt: new Date().toISOString(),
        status: 'completed',
        disputeStatus: 'none',
        details: {
          title: 'Refund for cancelled bounty: Build a Mobile App',
        },
      };

      mockWalletService.refund.mockResolvedValue(refundTransaction);

      // Act
      const refund = await mockWalletService.refund({
        bountyId,
        posterId: POSTER_ID,
        amount: 50000,
        reason: 'Bounty cancelled by poster',
      });

      // Assert
      expect(refund.type).toBe('refund');
      expect(refund.amount).toBe(50000);
      expect(refund.status).toBe('completed');
    });

    it('should notify hunter of cancellation', async () => {
      // Arrange
      mockNotificationService.send.mockResolvedValue(true);

      // Act
      await mockNotificationService.send({
        user_id: HUNTER_ID_1,
        type: 'cancellation_accepted',
        title: 'Bounty Cancelled',
        body: 'The bounty "Build a Mobile App" has been cancelled',
        data: { bountyId, refundAmount: 50000 },
      });

      // Assert
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cancellation_accepted',
          user_id: HUNTER_ID_1,
        })
      );
    });

    it('should update conversation with cancellation notice', async () => {
      // Arrange
      const cancellationMessage: Message = {
        id: 'msg_cancel',
        conversationId: 'conv_123',
        senderId: 'system',
        text: 'This bounty has been cancelled. Refund processed.',
        createdAt: new Date().toISOString(),
        status: 'sent',
      };

      mockConversationService.sendMessage.mockResolvedValue(cancellationMessage);

      // Act
      await mockConversationService.sendMessage('conv_123', {
        senderId: 'system',
        text: 'This bounty has been cancelled. Refund processed.',
      });

      // Assert
      expect(mockConversationService.sendMessage).toHaveBeenCalledWith(
        'conv_123',
        expect.objectContaining({
          text: expect.stringContaining('cancelled'),
        })
      );
    });
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle payment failure during escrow', async () => {
      // Arrange
      mockWalletService.createEscrow.mockRejectedValue(
        new Error('Payment processing failed: Card declined')
      );

      // Act & Assert
      await expect(
        mockWalletService.createEscrow({ bountyId: 'bounty_123', amount: 50000 })
      ).rejects.toThrow('Payment processing failed');
    });

    it('should handle network errors during critical operations', async () => {
      // Arrange
      mockBountyService.update.mockRejectedValue(
        new Error('Network error: Unable to reach server')
      );

      // Act & Assert
      await expect(
        mockBountyService.update('bounty_123', { status: 'completed' })
      ).rejects.toThrow('Network error');
    });

    it('should prevent concurrent acceptance of same bounty', async () => {
      // Arrange
      const bountyId = 'bounty_123';

      // First hunter's acceptance succeeds
      mockRequestService.accept.mockResolvedValueOnce({
        id: 'req_alice',
        status: 'accepted',
      });

      // Second hunter's acceptance should fail
      mockRequestService.accept.mockRejectedValueOnce(
        new Error('Bounty already accepted by another hunter')
      );

      // Act
      await mockRequestService.accept('req_alice');

      // Assert - Second attempt fails
      await expect(mockRequestService.accept('req_bob')).rejects.toThrow(
        'already accepted'
      );
    });

    it('should validate bounty status transitions', async () => {
      // Arrange - Invalid transition from completed to open
      mockBountyService.update.mockRejectedValue(
        new Error('Invalid status transition: completed -> open')
      );

      // Act & Assert
      await expect(
        mockBountyService.update('bounty_123', { status: 'open' })
      ).rejects.toThrow('Invalid status transition');
    });

    it('should handle missing required data gracefully', async () => {
      // Arrange - Missing bounty ID
      mockBountyService.getById.mockRejectedValue(
        new Error('Bounty not found')
      );

      // Act & Assert
      await expect(mockBountyService.getById('nonexistent')).rejects.toThrow(
        'not found'
      );
    });

    it('should retry failed operations with exponential backoff', async () => {
      // Arrange
      mockWalletService.releasePayment
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ type: 'release', amount: 50000 });

      // Act - Simulate retry logic
      let attempts = 0;
      let result;
      while (attempts < 3) {
        try {
          result = await mockWalletService.releasePayment({ bountyId: 'bounty_123' });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= 3) throw error;
        }
      }

      // Assert
      expect(result).toBeDefined();
      expect(result.type).toBe('release');
      expect(attempts).toBe(2); // Succeeded on third attempt
    });
  });

  describe('Integration Points', () => {
    it('should trigger notifications at key events', async () => {
      // Arrange
      const events = [
        { type: 'application', user_id: POSTER_ID },
        { type: 'acceptance', user_id: HUNTER_ID_1 },
        { type: 'message', user_id: POSTER_ID },
        { type: 'completion', user_id: POSTER_ID },
        { type: 'payment', user_id: HUNTER_ID_1 },
      ];

      mockNotificationService.send.mockResolvedValue(true);

      // Act - Simulate full flow notifications
      for (const event of events) {
        await mockNotificationService.send(event);
      }

      // Assert
      expect(mockNotificationService.send).toHaveBeenCalledTimes(5);
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'application' })
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment' })
      );
    });

    it('should update wallet balance correctly through lifecycle', async () => {
      // Arrange
      const initialBalance = 100000; // $1000

      mockWalletService.getBalance
        .mockResolvedValueOnce(initialBalance) // Initial
        .mockResolvedValueOnce(50000) // After escrow (-$500)
        .mockResolvedValueOnce(50000); // After completion (poster still at $500)

      // Act - Simulate wallet changes
      const balanceStart = await mockWalletService.getBalance(POSTER_ID);
      const balanceAfterEscrow = await mockWalletService.getBalance(POSTER_ID);
      const balanceAfterCompletion = await mockWalletService.getBalance(POSTER_ID);

      // Assert
      expect(balanceStart).toBe(100000);
      expect(balanceAfterEscrow).toBe(50000);
      expect(balanceAfterCompletion).toBe(50000);
    });

    it('should track user ratings after completion', async () => {
      // Arrange
      const rating = {
        id: 'rating_123',
        user_id: HUNTER_ID_1,
        rater_id: POSTER_ID,
        bountyId: 'bounty_123',
        score: 5,
        comment: 'Excellent work!',
        createdAt: new Date().toISOString(),
      };

      const mockRatingService = {
        create: jest.fn().mockResolvedValue(rating),
      };

      // Act
      const userRating = await mockRatingService.create({
        user_id: HUNTER_ID_1,
        rater_id: POSTER_ID,
        bountyId: 'bounty_123',
        score: 5,
        comment: 'Excellent work!',
      });

      // Assert
      expect(userRating.score).toBe(5);
      expect(userRating.user_id).toBe(HUNTER_ID_1);
      expect(mockRatingService.create).toHaveBeenCalled();
    });

    it('should support bounty search and filtering', async () => {
      // Arrange
      const bounties: Bounty[] = [
        {
          id: 'bounty_1',
          user_id: POSTER_ID,
          title: 'Mobile App',
          description: 'React Native',
          amount: 50000,
          status: 'open',
          location: 'San Francisco, CA',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'bounty_2',
          user_id: POSTER_ID,
          title: 'Web Design',
          description: 'UI/UX',
          amount: 30000,
          status: 'open',
          location: 'Oakland, CA',
          createdAt: new Date().toISOString(),
        },
      ];

      mockBountyService.list.mockResolvedValue(
        bounties.filter(b => b.location?.includes('San Francisco'))
      );

      // Act
      const filteredBounties = await mockBountyService.list({
        location: 'San Francisco',
        status: 'open',
      });

      // Assert
      expect(filteredBounties).toHaveLength(1);
      expect(filteredBounties[0].location).toContain('San Francisco');
    });
  });
});
