/**
 * Unit Tests for Dispute Service
 *
 * Tests cover core dispute resolution functionality including:
 * - Dispute creation and retrieval
 * - Evidence management
 * - Comment system
 * - Resolution decisions
 * - Appeal mechanism
 * - Automation features
 */

// Mock Supabase with proper method chaining - must be defined before import
const mockFrom = jest.fn();
const mockRpc = jest.fn();

// Mock dependencies before importing the service
jest.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: {
          session: {
            user: {
              id: 'admin-user-id',
              app_metadata: { role: 'admin' },
            },
          },
        },
      }),
    },
  },
}));

// Mock logger to avoid errors
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock bounty service
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    getById: jest.fn(),
  },
}));

// Mock cancellation service
jest.mock('../../lib/services/cancellation-service', () => ({
  cancellationService: {
    getCancellationById: jest.fn(),
  },
}));

// Mock payment service
jest.mock('../../lib/services/payment-service', () => ({
  paymentService: {
    releaseEscrow: jest.fn().mockResolvedValue({ success: true }),
    refundEscrow: jest.fn().mockResolvedValue({ success: true }),
  },
}));

// Import after mocking
import { disputeService } from '../../lib/services/dispute-service';

describe('DisputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all RPC calls succeed (fn_open_dispute_hold, fn_close_dispute_hold, etc.)
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  describe('createDispute', () => {
    it('should create a dispute with evidence', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Work was completed but poster disputes quality',
        evidence_json: null, // Evidence is now uploaded separately
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Mock cancellationService.getCancellationById
      const {
        cancellationService: mockCancellationService,
      } = require('../../lib/services/cancellation-service');
      (mockCancellationService.getCancellationById as jest.Mock).mockResolvedValue({
        id: 'cancel-123',
        bountyId: 'bounty-123',
        requesterId: 'hunter-123',
      });

      mockFrom.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockDispute,
              error: null,
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      const dispute = await disputeService.createDispute(
        'cancel-123',
        'user-123',
        'Work was completed but poster disputes quality',
        [
          {
            id: 'ev-1',
            type: 'text',
            content: 'I completed all requirements',
            uploadedAt: new Date().toISOString(),
            description: undefined,
          },
        ]
      );

      expect(dispute).toBeDefined();
      expect(dispute?.id).toBe('dispute-123');
      expect(dispute?.status).toBe('open');
      // Evidence is now uploaded separately via uploadEvidence, not stored during creation
      expect(dispute?.evidence).toHaveLength(0);
      // Verify the hold RPC was called
      expect(mockRpc).toHaveBeenCalledWith('fn_open_dispute_hold', { p_dispute_id: 'dispute-123' });
    });

    it('should roll back the dispute when hold placement fails', async () => {
      const mockDispute = {
        id: 'dispute-456',
        cancellation_id: 'cancel-456',
        bounty_id: 'bounty-456',
        initiator_id: 'user-123',
        reason: 'Hold test',
        evidence_json: null,
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const {
        cancellationService: mockCancellationService,
      } = require('../../lib/services/cancellation-service');
      (mockCancellationService.getCancellationById as jest.Mock).mockResolvedValue({
        id: 'cancel-456',
        bountyId: 'bounty-456',
        requesterId: 'hunter-456',
      });

      const mockDelete = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      mockFrom.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockDispute,
              error: null,
            }),
          }),
        }),
        delete: mockDelete,
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      // Simulate hold failure
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC error', code: 'P0001' } });

      const dispute = await disputeService.createDispute('cancel-456', 'user-123', 'Hold test');

      expect(dispute).toBeNull();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Mock cancellationService.getCancellationById
      const {
        cancellationService: mockCancellationService,
      } = require('../../lib/services/cancellation-service');
      (mockCancellationService.getCancellationById as jest.Mock).mockResolvedValue({
        id: 'cancel-123',
        bountyId: 'bounty-123',
        requesterId: 'hunter-123',
      });

      mockFrom.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      const dispute = await disputeService.createDispute(
        'cancel-123',
        'user-123',
        'Dispute reason'
      );

      expect(dispute).toBeNull();
    });
  });

  describe('uploadEvidence', () => {
    it('should upload evidence to a dispute', async () => {
      mockFrom.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await disputeService.uploadEvidence('dispute-123', 'user-123', {
        type: 'image',
        content: 'https://cdn.example.com/proof.jpg',
        description: 'Screenshot of completed work',
        mimeType: 'image/jpeg',
        fileSize: 245678,
      });

      expect(result).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('dispute_evidence');
    });
  });

  describe('addComment', () => {
    it('should add a public comment', async () => {
      mockFrom.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await disputeService.addComment(
        'dispute-123',
        'user-123',
        'I have additional context to share',
        false
      );

      expect(result).toBe(true);
    });

    it('should add an internal admin comment', async () => {
      mockFrom.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await disputeService.addComment(
        'dispute-123',
        'admin-123',
        'Internal note: Hunter provided better evidence',
        true
      );

      expect(result).toBe(true);
    });
  });

  describe('resolveDispute', () => {
    it('should resolve a dispute with winner=hunter and store winner in DB', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Test dispute',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-123',
        user_id: 'poster-123',
        title: 'Test Bounty',
        amount: 50000,
        payment_intent_id: 'escrow-123',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      (mockPaymentService.releaseEscrow as jest.Mock).mockResolvedValue({ success: true });

      const result = await disputeService.resolveDispute(
        'dispute-123',
        'Hunter completed work successfully',
        'hunter'
      );

      expect(result).toBe(true);
      expect(mockPaymentService.releaseEscrow).toHaveBeenCalledWith('escrow-123');
    });

    it('should resolve a dispute with winner=poster and refund escrow', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Test dispute',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-123',
        user_id: 'poster-123',
        title: 'Test Bounty',
        amount: 50000,
        payment_intent_id: 'escrow-123',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      (mockPaymentService.refundEscrow as jest.Mock).mockResolvedValue({ success: true });

      const result = await disputeService.resolveDispute(
        'dispute-123',
        'Poster was right, refunding',
        'poster'
      );

      expect(result).toBe(true);
      expect(mockPaymentService.refundEscrow).toHaveBeenCalledWith('escrow-123');
    });

    it('should resolve without escrow action for honor bounties', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Test dispute',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-123',
        user_id: 'poster-123',
        title: 'Honor Bounty',
        amount: 0,
        is_for_honor: true,
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');

      const result = await disputeService.resolveDispute(
        'dispute-123',
        'Resolved for honor bounty',
        'hunter'
      );

      expect(result).toBe(true);
      // No escrow action for honor bounties
      expect(mockPaymentService.releaseEscrow).not.toHaveBeenCalled();
      expect(mockPaymentService.refundEscrow).not.toHaveBeenCalled();
    });

    it('should resolve without escrow action for monetary bounties missing payment_intent_id', async () => {
      const mockDispute = {
        id: 'dispute-456',
        cancellation_id: 'cancel-456',
        bounty_id: 'bounty-456',
        initiator_id: 'user-456',
        reason: 'Test dispute - no payment intent',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-456',
        user_id: 'poster-456',
        title: 'Monetary Bounty Without Payment Intent',
        amount: 50000,
        // intentionally no payment_intent_id
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      const { logger } = require('../../lib/utils/error-logger');

      const result = await disputeService.resolveDispute(
        'dispute-456',
        'Resolved for monetary bounty without payment intent',
        'hunter'
      );

      expect(result).toBe(true);
      // No escrow action should be attempted when payment_intent_id is missing
      expect(mockPaymentService.releaseEscrow).not.toHaveBeenCalled();
      expect(mockPaymentService.refundEscrow).not.toHaveBeenCalled();
      // Should log a warning about missing payment_intent_id
      expect(logger.warning).toHaveBeenCalled();
    });

    it('should still resolve when releaseEscrow returns failure', async () => {
      const mockDispute = {
        id: 'dispute-789',
        cancellation_id: 'cancel-789',
        bounty_id: 'bounty-789',
        initiator_id: 'user-789',
        reason: 'Test dispute - release fails',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-789',
        user_id: 'poster-789',
        title: 'Bounty With Failed Release',
        amount: 50000,
        payment_intent_id: 'escrow-789',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      (mockPaymentService.releaseEscrow as jest.Mock).mockResolvedValue({
        success: false,
        error: { message: 'Escrow release failed' },
      });

      const { logger } = require('../../lib/utils/error-logger');

      const result = await disputeService.resolveDispute(
        'dispute-789',
        'Hunter wins but release fails',
        'hunter'
      );

      expect(result).toBe(true);
      expect(mockPaymentService.releaseEscrow).toHaveBeenCalledWith('escrow-789');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to release escrow to hunter during dispute resolution',
        expect.objectContaining({ disputeId: 'dispute-789' })
      );
    });

    it('should still resolve when refundEscrow returns failure', async () => {
      const mockDispute = {
        id: 'dispute-790',
        cancellation_id: 'cancel-790',
        bounty_id: 'bounty-790',
        initiator_id: 'user-790',
        reason: 'Test dispute - refund fails',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-790',
        user_id: 'poster-790',
        title: 'Bounty With Failed Refund',
        amount: 50000,
        payment_intent_id: 'escrow-790',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      (mockPaymentService.refundEscrow as jest.Mock).mockResolvedValue({
        success: false,
        error: { message: 'Escrow refund failed' },
      });

      const { logger } = require('../../lib/utils/error-logger');

      const result = await disputeService.resolveDispute(
        'dispute-790',
        'Poster wins but refund fails',
        'poster'
      );

      expect(result).toBe(true);
      expect(mockPaymentService.refundEscrow).toHaveBeenCalledWith('escrow-790');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to refund escrow to poster during dispute resolution',
        expect.objectContaining({ disputeId: 'dispute-790' })
      );
    });

    it('should still resolve when escrow action throws an exception', async () => {
      const mockDispute = {
        id: 'dispute-791',
        cancellation_id: 'cancel-791',
        bounty_id: 'bounty-791',
        initiator_id: 'user-791',
        reason: 'Test dispute - escrow throws',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-791',
        user_id: 'poster-791',
        title: 'Bounty With Escrow Exception',
        amount: 50000,
        payment_intent_id: 'escrow-791',
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const { paymentService: mockPaymentService } = require('../../lib/services/payment-service');
      (mockPaymentService.releaseEscrow as jest.Mock).mockRejectedValue(
        new Error('Network timeout')
      );

      const { logger } = require('../../lib/utils/error-logger');

      const result = await disputeService.resolveDispute(
        'dispute-791',
        'Hunter wins but escrow throws',
        'hunter'
      );

      // Resolution should still succeed even if escrow action throws
      expect(result).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        'Error executing escrow action during dispute resolution',
        expect.objectContaining({ disputeId: 'dispute-791', winner: 'hunter' })
      );
    });
  });

  describe('getDisputeById', () => {
    it('returns a dispute when found', async () => {
      const mockDispute = {
        id: 'dispute-get-1',
        cancellation_id: 'cancel-get-1',
        bounty_id: 'bounty-get-1',
        initiator_id: 'user-get-1',
        reason: 'Test reason',
        status: 'open',
        created_at: new Date().toISOString(),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockDispute, error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputeById('dispute-get-1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('dispute-get-1');
    });

    it('returns null when dispute not found', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest
              .fn()
              .mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
          }),
        }),
      });

      const result = await disputeService.getDisputeById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null on DB error', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      // Service swallows errors and returns null
      const result = await disputeService.getDisputeById('dispute-err');
      expect(result).toBeNull();
    });
  });

  describe('getDisputeByCancellationId', () => {
    it('returns a dispute when found', async () => {
      const mockDispute = {
        id: 'dispute-by-cancel',
        cancellation_id: 'cancel-lookup',
        bounty_id: 'bounty-lookup',
        initiator_id: 'user-lookup',
        reason: 'Test',
        status: 'open',
        created_at: new Date().toISOString(),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: mockDispute, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await disputeService.getDisputeByCancellationId('cancel-lookup');
      expect(result?.id).toBe('dispute-by-cancel');
    });

    it('returns null when not found', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await disputeService.getDisputeByCancellationId('no-match');
      expect(result).toBeNull();
    });
  });

  describe('updateDisputeStatus', () => {
    it('updates dispute status successfully (admin user)', async () => {
      mockFrom.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      const result = await disputeService.updateDisputeStatus('dispute-upd', 'under_review');
      expect(result).toBe(true);
    });

    it('returns false when DB update fails (non-terminal status)', async () => {
      // The service catches all errors and returns false
      mockFrom.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: { message: 'update failed' } }),
        }),
      });

      const result = await disputeService.updateDisputeStatus('dispute-upd', 'under_review');
      expect(result).toBe(false);
    });

    it('calls fn_close_dispute_hold for resolved status', async () => {
      mockRpc.mockResolvedValueOnce({ error: null });

      const result = await disputeService.updateDisputeStatus('dispute-upd', 'resolved');
      expect(mockRpc).toHaveBeenCalledWith(
        'fn_close_dispute_hold',
        expect.objectContaining({ p_new_status: 'resolved' })
      );
      expect(result).toBe(true);
    });
  });

  describe('escalateDispute', () => {
    it('escalates the dispute successfully', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'bounty_disputes') {
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      });

      const result = await disputeService.escalateDispute('dispute-esc-1', 'Needs admin review');
      expect(result).toBe(true);
    });
  });

  describe('getDisputesByUserId', () => {
    it('returns disputes for a user', async () => {
      const disputes = [
        {
          id: 'd1',
          initiator_id: 'user-abc',
          bounty_id: 'b1',
          status: 'open',
          created_at: new Date().toISOString(),
        },
        {
          id: 'd2',
          initiator_id: 'user-abc',
          bounty_id: 'b2',
          status: 'resolved',
          created_at: new Date().toISOString(),
        },
      ];

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: disputes, error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputesByUserId('user-abc');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('returns empty array when no disputes found', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await disputeService.getDisputesByUserId('user-no-disputes');
      expect(result).toEqual([]);
    });
  });

  describe('getAllActiveDisputes', () => {
    it('returns all open and under_review disputes', async () => {
      const activeDisputes = [
        {
          id: 'da1',
          bounty_id: 'b1',
          initiator_id: 'u1',
          status: 'open',
          created_at: new Date().toISOString(),
        },
        {
          id: 'da2',
          bounty_id: 'b2',
          initiator_id: 'u2',
          status: 'under_review',
          created_at: new Date().toISOString(),
        },
      ];

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: activeDisputes, error: null }),
          }),
        }),
      });

      const result = await disputeService.getAllActiveDisputes();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('returns empty array when no active disputes', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await disputeService.getAllActiveDisputes();
      expect(result).toEqual([]);
    });
  });

  describe('getDisputeEvidence', () => {
    it('returns evidence for a dispute', async () => {
      const evidence = [
        {
          id: 'ev1',
          dispute_id: 'dispute-ev-1',
          type: 'image',
          url: 'https://example.com/img.png',
        },
      ];

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: evidence, error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputeEvidence('dispute-ev-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('returns empty array when no evidence', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputeEvidence('dispute-no-ev');
      expect(result).toEqual([]);
    });
  });

  describe('getDisputeComments', () => {
    it('returns public comments (no internal)', async () => {
      const comments = [
        { id: 'c1', dispute_id: 'dispute-c1', user_id: 'u1', comment: 'Test', is_internal: false },
      ];

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: comments, error: null }),
            }),
            order: jest.fn().mockResolvedValue({ data: comments, error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputeComments('dispute-c1', false);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns all comments including internal', async () => {
      const comments = [
        {
          id: 'c2',
          dispute_id: 'dispute-c2',
          user_id: 'u1',
          comment: 'Internal note',
          is_internal: true,
        },
      ];

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: comments, error: null }),
          }),
        }),
      });

      const result = await disputeService.getDisputeComments('dispute-c2', true);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('makeResolutionDecision', () => {
    it('should create a resolution with fund distribution', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Test dispute',
        status: 'under_review',
        created_at: new Date().toISOString(),
      };

      const mockBounty = {
        id: 'bounty-123',
        user_id: 'poster-123',
        hunter_id: 'hunter-123',
        title: 'Test Bounty',
        amount: 50000, // $500
      };

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'dispute_resolutions') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'resolution-123',
                    dispute_id: 'dispute-123',
                    admin_id: 'admin-123',
                    outcome: 'split',
                    amount_to_hunter: 30000,
                    amount_to_poster: 20000,
                    rationale: 'Fair split based on evidence',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      // Update the mock for this test
      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const result = await disputeService.makeResolutionDecision('dispute-123', 'admin-123', {
        outcome: 'split',
        amountToHunter: 30000,
        amountToPoster: 20000,
        rationale: 'Fair split based on evidence',
      });

      expect(result).toBe(true);
    });
  });

  describe('calculateSuggestedResolution', () => {
    it('should suggest release when hunter has more evidence', async () => {
      const mockEvidence = [
        { id: '1', uploaded_by: 'hunter-123', type: 'image' },
        { id: '2', uploaded_by: 'hunter-123', type: 'document' },
        { id: '3', uploaded_by: 'hunter-123', type: 'text' },
        { id: '4', uploaded_by: 'poster-123', type: 'text' },
      ];

      const mockDispute = {
        id: 'dispute-123',
        bounty_id: 'bounty-123',
      };

      const mockBounty = {
        id: 'bounty-123',
        hunter_id: 'hunter-123',
        poster_id: 'poster-123',
      };

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_evidence') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: mockEvidence,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_comments') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          };
        }
      });

      // Update the mock for this test
      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const suggestion = await disputeService.calculateSuggestedResolution('dispute-123');

      expect(suggestion.suggestedOutcome).toBe('release');
      expect(suggestion.confidence).toBeGreaterThan(0.5);
      expect(suggestion.reasoning).toContain('Hunter');
    });

    it('should suggest split when evidence is balanced', async () => {
      const mockEvidence = [
        { id: '1', uploaded_by: 'hunter-123', type: 'image' },
        { id: '2', uploaded_by: 'poster-123', type: 'image' },
      ];

      const mockDispute = {
        id: 'dispute-123',
        bounty_id: 'bounty-123',
      };

      const mockBounty = {
        id: 'bounty-123',
        hunter_id: 'hunter-123',
        poster_id: 'poster-123',
      };

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_evidence') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: mockEvidence,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_comments') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          };
        }
      });

      // Update the mock for this test
      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue(mockBounty);

      const suggestion = await disputeService.calculateSuggestedResolution('dispute-123');

      expect(suggestion.suggestedOutcome).toBe('split');
    });
  });

  describe('autoCloseStaleDisputes', () => {
    it('should close disputes past auto_close_at date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 8);

      const staleDisputes = [
        {
          id: 'dispute-1',
          status: 'open',
          auto_close_at: pastDate.toISOString(),
          initiator_id: 'user-1',
          bounty_id: 'bounty-1',
        },
        {
          id: 'dispute-2',
          status: 'under_review',
          auto_close_at: pastDate.toISOString(),
          initiator_id: 'user-2',
          bounty_id: 'bounty-2',
        },
      ];

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                lte: jest.fn().mockResolvedValue({
                  data: staleDisputes,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const closedCount = await disputeService.autoCloseStaleDisputes();

      expect(closedCount).toBe(2);
    });
  });

  describe('escalateUnresolvedDisputes', () => {
    it('should escalate disputes older than 14 days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);

      const unresolvedDisputes = [
        {
          id: 'dispute-1',
          status: 'open',
          escalated: false,
          created_at: oldDate.toISOString(),
        },
      ];

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  lte: jest.fn().mockResolvedValue({
                    data: unresolvedDisputes,
                    error: null,
                  }),
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const escalatedCount = await disputeService.escalateUnresolvedDisputes();

      expect(escalatedCount).toBe(1);
    });
  });

  describe('createAppeal', () => {
    it('should create an appeal for a resolved dispute', async () => {
      const mockDispute = {
        id: 'dispute-123',
        status: 'resolved',
        bounty_id: 'bounty-123',
      };

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: mockDispute,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_appeals') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      const result = await disputeService.createAppeal(
        'dispute-123',
        'user-123',
        'The resolution was unfair because...'
      );

      expect(result).toBe(true);
    });

    it('should fail for non-resolved disputes', async () => {
      const mockDispute = {
        id: 'dispute-123',
        status: 'open',
        bounty_id: 'bounty-123',
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockDispute,
              error: null,
            }),
          }),
        }),
      });

      const result = await disputeService.createAppeal('dispute-123', 'user-123', 'Appeal reason');

      expect(result).toBe(false);
    });
  });

  describe('Workflow Disputes', () => {
    it('should create a workflow dispute with disputeStage = in_progress and null cancellation', async () => {
      const mockInsert = jest.fn().mockResolvedValue({
        data: {
          id: 'wd-123',
          bounty_id: 'bounty-123',
          initiator_id: 'user-1',
          respondent_id: 'user-2',
          reason: 'Test reason',
          dispute_stage: 'in_progress',
          status: 'open',
          cancellation_id: null,
          evidence_json: null,
          created_at: '2026-03-17T00:00:00Z',
        },
        error: null,
      });

      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: mockInsert,
              }),
            }),
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'dispute_audit_log') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
      });

      const { bountyService: mockBountyService } = require('../../lib/services/bounty-service');
      (mockBountyService.getById as jest.Mock).mockResolvedValue({
        id: 'bounty-123',
        title: 'Test',
      });

      const dispute = await disputeService.createWorkflowDispute(
        'bounty-123',
        'user-1',
        'user-2',
        'in_progress',
        'Test reason'
      );

      expect(dispute).toBeDefined();
      expect(dispute?.id).toBe('wd-123');
      expect(dispute?.disputeStage).toBe('in_progress');
      expect(dispute?.cancellationId).toBeUndefined();
      expect(dispute?.respondentId).toBe('user-2');
    });

    it('should block creating a workflow dispute if one is already active', async () => {
      // Mock getDisputeByBountyId returning an active dispute
      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                      maybeSingle: jest.fn().mockResolvedValue({
                        data: { id: 'existing-dispute', status: 'open' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
      });

      const dispute = await disputeService.createWorkflowDispute(
        'bounty-123',
        'user-1',
        'user-2',
        'in_progress',
        'Test reason'
      );

      expect(dispute).toBeNull();
    });

    it('should return disputes where user is either initiator or respondent', async () => {
      mockFrom.mockImplementation(table => {
        if (table === 'bounty_disputes') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [
                    { id: 'd1', initiator_id: 'user-1', respondent_id: 'user-2' },
                    { id: 'd2', initiator_id: 'user-3', respondent_id: 'user-1' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
      });

      const disputes = await disputeService.getDisputesForUser('user-1');
      expect(disputes).toHaveLength(2);
      expect(disputes[0].id).toBe('d1');
      expect(disputes[1].id).toBe('d2');
    });
  });
});
