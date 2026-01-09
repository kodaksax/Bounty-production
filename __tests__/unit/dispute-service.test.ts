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

// Mock dependencies before importing the service
jest.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mockFrom,
  },
}));

// Mock logger to avoid errors
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
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
    getById: jest.fn(),
  },
}));

// Import after mocking
import { disputeService } from '../../lib/services/dispute-service';

describe('DisputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDispute', () => {
    it('should create a dispute with evidence', async () => {
      const mockDispute = {
        id: 'dispute-123',
        cancellation_id: 'cancel-123',
        bounty_id: 'bounty-123',
        initiator_id: 'user-123',
        reason: 'Work was completed but poster disputes quality',
        evidence_json: JSON.stringify([
          {
            id: 'ev-1',
            type: 'text',
            content: 'I completed all requirements',
            uploadedAt: new Date().toISOString(),
          },
        ]),
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

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
      expect(dispute?.evidence).toHaveLength(1);
    });

    it('should handle errors gracefully', async () => {
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
      expect(supabase.from).toHaveBeenCalledWith('dispute_evidence');
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

      mockFrom.mockImplementation((table) => {
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

      const result = await disputeService.makeResolutionDecision(
        'dispute-123',
        'admin-123',
        {
          outcome: 'split',
          amountToHunter: 30000,
          amountToPoster: 20000,
          rationale: 'Fair split based on evidence',
        }
      );

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

      mockFrom.mockImplementation((table) => {
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

      mockFrom.mockImplementation((table) => {
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

      mockFrom.mockImplementation((table) => {
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

      mockFrom.mockImplementation((table) => {
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

      mockFrom.mockImplementation((table) => {
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

      const result = await disputeService.createAppeal(
        'dispute-123',
        'user-123',
        'Appeal reason'
      );

      expect(result).toBe(false);
    });
  });
});
