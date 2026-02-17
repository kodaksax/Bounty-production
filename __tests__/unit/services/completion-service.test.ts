/**
 * Unit tests for Completion Service
 * Tests bounty completion workflow including submission, approval, revision, and rating
 */

import { completionService } from '../../../lib/services/completion-service';
import type { CompletionSubmission, ProofItem, Rating } from '../../../lib/services/completion-service';

// Mock Supabase
jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: jest.fn(),
    removeChannel: jest.fn(),
    channel: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

// Mock data utils
jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn(() => 'user123'),
}));

// Mock bounty service
jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    update: jest.fn().mockResolvedValue(true),
  },
}));

// Mock message service
jest.mock('../../../lib/services/message-service', () => ({
  messageService: {
    getConversations: jest.fn().mockResolvedValue([]),
    getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv123' }),
    sendMessage: jest.fn().mockResolvedValue(true),
  },
}));

describe('CompletionService', () => {
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    const { supabase } = require('../../../lib/supabase');
    mockSupabase = supabase;
  });

  describe('submitCompletion', () => {
    const mockProofItems: ProofItem[] = [
      {
        id: 'proof1',
        type: 'image',
        name: 'screenshot.png',
        url: 'https://example.com/proof.png',
        size: 12345,
        mimeType: 'image/png',
      },
    ];

    const mockSubmission: Omit<CompletionSubmission, 'id' | 'submitted_at' | 'status'> = {
      bounty_id: 'bounty123',
      hunter_id: 'hunter123',
      message: 'Work completed as requested',
      proof_items: mockProofItems,
    };

    it('should submit completion successfully', async () => {
      const mockData = {
        id: 'submission123',
        ...mockSubmission,
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
        proof_items: JSON.stringify(mockProofItems),
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
          }),
        }),
      });

      const result = await completionService.submitCompletion(mockSubmission);

      expect(result).toBeDefined();
      expect(result?.id).toBe('submission123');
      expect(result?.status).toBe('pending');
      expect(result?.proof_items).toEqual(mockProofItems);
    });

    it('should prevent duplicate pending submissions', async () => {
      const existingSubmission = {
        id: 'existing123',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        message: 'Previous submission',
        proof_items: JSON.stringify(mockProofItems),
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ 
                      data: existingSubmission, 
                      error: null 
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await completionService.submitCompletion(mockSubmission);

      expect(result).toBeDefined();
      expect(result?.id).toBe('existing123');
      // Should not call insert since duplicate exists
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });

    it('should handle submission errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ 
              data: null, 
              error: { message: 'Database error' } 
            }),
          }),
        }),
      });

      await expect(completionService.submitCompletion(mockSubmission))
        .rejects.toThrow('Database error');
    });
  });

  describe('getSubmission', () => {
    it('should retrieve submission successfully', async () => {
      const mockData = {
        id: 'submission123',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        message: 'Work completed',
        proof_items: JSON.stringify([{ id: 'proof1', type: 'image', name: 'test.png' }]),
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await completionService.getSubmission('bounty123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('submission123');
      expect(result?.proof_items).toEqual([{ id: 'proof1', type: 'image', name: 'test.png' }]);
    });

    it('should return null when no submission exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ 
                  data: null, 
                  error: { code: 'PGRST116' } 
                }),
              }),
            }),
          }),
        }),
      });

      const result = await completionService.getSubmission('bounty123');

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ 
                  data: null, 
                  error: { message: 'Connection failed' } 
                }),
              }),
            }),
          }),
        }),
      });

      const result = await completionService.getSubmission('bounty123');

      expect(result).toBeNull();
    });
  });

  describe('markReady and getReady', () => {
    it('should mark bounty as ready for submission', async () => {
      mockSupabase.from.mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await completionService.markReady('bounty123', 'hunter123');

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('completion_ready');
    });

    it('should retrieve ready state', async () => {
      const mockData = {
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        ready_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: mockData, error: null }),
            }),
          }),
        }),
      });

      const result = await completionService.getReady('bounty123');

      expect(result).toEqual(mockData);
    });

    it('should return null when ready state does not exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const result = await completionService.getReady('bounty123');

      expect(result).toBeNull();
    });
  });

  describe('approveCompletion', () => {
    it('should approve completion successfully', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      const result = await completionService.approveCompletion('submission123');

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('completion_submissions');
    });

    it('should throw error on approval failure', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ 
            error: new Error('Update failed') 
          }),
        }),
      });

      await expect(completionService.approveCompletion('submission123'))
        .rejects.toThrow();
    });
  });

  describe('approveSubmission', () => {
    it('should approve submission and complete bounty', async () => {
      const mockSubmission = {
        id: 'submission123',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        message: 'Work done',
        proof_items: [],
        status: 'pending' as const,
      };

      // Mock getSubmission
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ 
                  data: { ...mockSubmission, proof_items: '[]' }, 
                  error: null 
                }),
              }),
            }),
          }),
        }),
      });

      // Mock approveCompletion
      mockSupabase.from.mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      const result = await completionService.approveSubmission('bounty123');

      expect(result).toBe(true);
      
      const { bountyService } = require('../../../lib/services/bounty-service');
      expect(bountyService.update).toHaveBeenCalledWith('bounty123', { status: 'completed' });
    });

    it('should throw error if no submission exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
          }),
        }),
      });

      await expect(completionService.approveSubmission('bounty123'))
        .rejects.toThrow('No submission found for bounty');
    });
  });

  describe('requestRevision', () => {
    it('should request revision with feedback', async () => {
      const mockSubmissionData = {
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        bounties: { title: 'Test Bounty' },
      };

      // Mock fetch submission details
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ 
              data: mockSubmissionData, 
              error: null 
            }),
          }),
        }),
      });

      // Mock update submission
      mockSupabase.from.mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      // Mock notification insert
      mockSupabase.from.mockReturnValueOnce({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await completionService.requestRevision(
        'submission123',
        'Please update the color scheme'
      );

      expect(result).toBe(true);
    });

    it('should handle revision request errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ 
              data: null, 
              error: new Error('Not found') 
            }),
          }),
        }),
      });

      await expect(completionService.requestRevision('submission123', 'feedback'))
        .rejects.toThrow();
    });
  });

  describe('submitRating', () => {
    const mockRating: Omit<Rating, 'id' | 'created_at'> = {
      bounty_id: 'bounty123',
      from_user_id: 'user123',
      to_user_id: 'hunter123',
      rating: 5,
      comment: 'Excellent work!',
    };

    it('should submit rating successfully', async () => {
      const mockData = {
        ...mockRating,
        id: 'rating123',
        created_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
          }),
        }),
      });

      const result = await completionService.submitRating(mockRating);

      expect(result).toBeDefined();
      expect(result?.id).toBe('rating123');
      expect(result?.rating).toBe(5);
      expect(result?.comment).toBe('Excellent work!');
    });

    it('should throw error if from_user_id is missing', async () => {
      const invalidRating = {
        ...mockRating,
        from_user_id: '',
      };

      // Mock getCurrentUserId to return null
      const { getCurrentUserId } = require('../../../lib/utils/data-utils');
      getCurrentUserId.mockReturnValueOnce(null);

      await expect(completionService.submitRating(invalidRating))
        .rejects.toThrow('Missing required rating fields');
    });

    it('should handle rating submission errors', async () => {
      mockSupabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ 
              data: null, 
              error: { message: 'Constraint violation' } 
            }),
          }),
        }),
      });

      await expect(completionService.submitRating(mockRating))
        .rejects.toThrow('Constraint violation');
    });
  });

  describe('getUserRatings', () => {
    it('should retrieve user ratings', async () => {
      const mockRatings = [
        {
          id: 'rating1',
          user_id: 'user123',
          from_user_id: 'rater1',
          to_user_id: 'user123',
          bounty_id: 'bounty123',
          rating: 5,
          comment: 'Great work!',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rating2',
          user_id: 'user123',
          from_user_id: 'rater2',
          to_user_id: 'user123',
          bounty_id: 'bounty456',
          rating: 4,
          comment: 'Good job',
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: mockRatings, error: null }),
          }),
        }),
      });

      const result = await completionService.getUserRatings('user123');

      expect(result).toHaveLength(2);
      expect(result[0].rating).toBe(5);
      expect(result[1].rating).toBe(4);
    });

    it('should return empty array on error', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ 
              data: null, 
              error: { message: 'Query failed' } 
            }),
          }),
        }),
      });

      const result = await completionService.getUserRatings('user123');

      expect(result).toEqual([]);
    });

    it('should handle empty ratings list', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await completionService.getUserRatings('user123');

      expect(result).toEqual([]);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle malformed proof_items JSON gracefully', async () => {
      const mockData = {
        id: 'submission123',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        message: 'Work completed',
        proof_items: 'invalid json{',
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
              }),
            }),
          }),
        }),
      });

      // getSubmission handles JSON parse errors and returns null
      const result = await completionService.getSubmission('bounty123');
      expect(result).toBeNull();
    });

    it('should handle empty proof_items array', async () => {
      const mockSubmission: Omit<CompletionSubmission, 'id' | 'submitted_at' | 'status'> = {
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        message: 'Work completed',
        proof_items: [],
      };

      const mockData = {
        id: 'submission123',
        ...mockSubmission,
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
        proof_items: JSON.stringify([]),
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockData, error: null }),
          }),
        }),
      });

      const result = await completionService.submitCompletion(mockSubmission);

      expect(result).toBeDefined();
      expect(result?.proof_items).toEqual([]);
    });

    it('should handle rating with boundary values', async () => {
      const mockRatings = [
        {
          ...{ bounty_id: 'bounty123', from_user_id: 'user1', to_user_id: 'user2' },
          rating: 1, // Minimum rating
          id: 'rating1',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          ...{ bounty_id: 'bounty456', from_user_id: 'user3', to_user_id: 'user2' },
          rating: 5, // Maximum rating
          id: 'rating2',
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: mockRatings, error: null }),
          }),
        }),
      });

      const result = await completionService.getUserRatings('user2');

      expect(result).toHaveLength(2);
      expect(result[0].rating).toBe(1);
      expect(result[1].rating).toBe(5);
    });
  });
});
