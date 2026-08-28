/**
 * Unit tests for Completion Service
 * Tests bounty completion workflow including submission, approval, revision, and rating
 */

import type {
    CompletionSubmission,
    ProofItem,
    Rating,
} from '../../../lib/services/completion-service';
import { completionService } from '../../../lib/services/completion-service';

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

// Mock analytics — assert the canonical completion_submitted emit.
// trackEvent resolves (the real one is `async`) so the service's
// fire-and-forget `.catch()` has a promise to attach to.
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
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

      // Mock per-table behavior: completion_submissions, bounties, notifications_outbox
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'completion_submissions') {
          return {
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
          };
        }
        if (table === 'bounties') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { poster_id: 'poster123', title: 'Test Bounty' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'notifications_outbox') {
          return {
            insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      const result = await completionService.submitCompletion(mockSubmission);

      expect(result).toBeDefined();
      expect(result?.id).toBe('submission123');
      expect(result?.status).toBe('pending');
      expect(result?.proof_items).toEqual(mockProofItems);

      // Canonical marketplace-lifecycle event fires for a genuinely new
      // submission row.
      const { analyticsService } = require('../../../lib/services/analytics-service');
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(
        'completion_submitted',
        expect.objectContaining({
          role: 'hunter',
          bounty_id: 'bounty123',
          hunter_id: 'hunter123',
          proof_item_count: 1,
          has_message: true,
        })
      );

      // The poster's review-needed notification is owned by the
      // trg_completion_submission_notification DB trigger, not this service.
      // Asserting the client never touches notifications_outbox guards against
      // reintroducing the old client-side insert, which RLS always rejected
      // (and which would double-notify anywhere RLS were relaxed).
      const calls = mockSupabase.from.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain('notifications_outbox');
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
                      error: null,
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

      // The canonical event must NOT fire when an existing pending submission
      // is returned — it stays 1:1 with real new submissions.
      const { analyticsService } = require('../../../lib/services/analytics-service');
      expect(analyticsService.trackEvent).not.toHaveBeenCalledWith(
        'completion_submitted',
        expect.anything()
      );
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
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      await expect(completionService.submitCompletion(mockSubmission)).rejects.toThrow(
        'Database error'
      );
    });

    it('does not enqueue the poster notification from the client', async () => {
      // Regression guard for the bug where posters were never told a hunter had
      // finished: this service used to insert into notifications_outbox, a
      // service-role-only table with RLS enabled and no policies, so the insert
      // was always rejected and the failure swallowed as a warning. The
      // trg_completion_submission_notification trigger owns the enqueue now.
      const mockData = {
        id: 'submission123',
        ...mockSubmission,
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
        proof_items: JSON.stringify(mockProofItems),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'completion_submissions') {
          return {
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
          };
        }
        return {};
      });

      const { logger } = require('../../../lib/utils/error-logger');

      const result = await completionService.submitCompletion(mockSubmission);

      expect(result).toBeDefined();
      expect(result?.id).toBe('submission123');

      const calls = mockSupabase.from.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain('notifications_outbox');
      // No best-effort warnings either, since there is no longer a doomed call
      // whose failure needs swallowing.
      expect(logger.warning).not.toHaveBeenCalledWith(
        expect.stringContaining('review-needed notification'),
        expect.anything()
      );
    });
  });

  describe('getLatestSubmissionsForBounties', () => {
    const rowsNewestFirst = [
      {
        id: 'sub-b',
        bounty_id: 'bounty2',
        hunter_id: 'hunter2',
        message: 'Latest for bounty2',
        proof_items: '[]',
        status: 'pending',
        submitted_at: '2024-01-03T00:00:00Z',
      },
      {
        id: 'sub-a2',
        bounty_id: 'bounty1',
        hunter_id: 'hunter1',
        message: 'Latest for bounty1',
        proof_items: JSON.stringify([{ id: 'proof1', type: 'image', name: 'test.png' }]),
        status: 'revision_requested',
        submitted_at: '2024-01-02T00:00:00Z',
      },
      {
        id: 'sub-a1',
        bounty_id: 'bounty1',
        hunter_id: 'hunter1',
        message: 'Superseded',
        proof_items: '[]',
        status: 'pending',
        submitted_at: '2024-01-01T00:00:00Z',
      },
    ];

    function mockBatchQuery(result: { data: any; error: any }) {
      const order = jest.fn().mockResolvedValue(result);
      const inFn = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ in: inFn });
      mockSupabase.from.mockReturnValue({ select });
      return { select, inFn, order };
    }

    it('keeps only the newest submission per bounty', async () => {
      mockBatchQuery({ data: rowsNewestFirst, error: null });

      const result = await completionService.getLatestSubmissionsForBounties([
        'bounty1',
        'bounty2',
      ]);

      expect(result.size).toBe(2);
      expect(result.get('bounty1')?.id).toBe('sub-a2');
      expect(result.get('bounty1')?.status).toBe('revision_requested');
      expect(result.get('bounty1')?.proof_items).toEqual([
        { id: 'proof1', type: 'image', name: 'test.png' },
      ]);
      expect(result.get('bounty2')?.id).toBe('sub-b');
    });

    it('de-duplicates ids and skips the query when none are given', async () => {
      const { inFn } = mockBatchQuery({ data: [], error: null });

      await completionService.getLatestSubmissionsForBounties(['bounty1', 'bounty1']);
      expect(inFn).toHaveBeenCalledWith('bounty_id', ['bounty1']);

      mockSupabase.from.mockClear();
      const empty = await completionService.getLatestSubmissionsForBounties([]);
      expect(empty.size).toBe(0);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns an empty map when the query fails', async () => {
      mockBatchQuery({ data: null, error: { message: 'Connection failed' } });

      const result = await completionService.getLatestSubmissionsForBounties(['bounty1']);

      expect(result.size).toBe(0);
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
                  error: { code: 'PGRST116' },
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
                  error: { message: 'Connection failed' },
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

  describe('getSubmissionForReview', () => {
    it('loads the newest submission only for the requested bounty and accepted hunter', async () => {
      const latestSubmission = {
        id: 'submission-latest',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
        status: 'pending',
        proof_items: JSON.stringify([{ id: 'proof-1', type: 'image', name: 'after.jpg' }]),
      };
      const maybeSingle = jest.fn().mockResolvedValue({ data: latestSubmission, error: null });
      const limit = jest.fn().mockReturnValue({ maybeSingle });
      const order = jest.fn().mockReturnValue({ limit });
      const hunterFilter = jest.fn().mockReturnValue({ order });
      const bountyFilter = jest.fn().mockReturnValue({ eq: hunterFilter });

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({ eq: bountyFilter }),
      });

      const result = await completionService.getSubmissionForReview('bounty123', 'hunter123');

      expect(bountyFilter).toHaveBeenCalledWith('bounty_id', 'bounty123');
      expect(hunterFilter).toHaveBeenCalledWith('hunter_id', 'hunter123');
      expect(result).toMatchObject({
        id: 'submission-latest',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
      });
      expect(result?.proof_items).toEqual([{ id: 'proof-1', type: 'image', name: 'after.jpg' }]);
    });

    it('throws on proof loading failure instead of reporting an empty submission', async () => {
      const maybeSingle = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
      const limit = jest.fn().mockReturnValue({ maybeSingle });
      const order = jest.fn().mockReturnValue({ limit });
      const hunterFilter = jest.fn().mockReturnValue({ order });
      const bountyFilter = jest.fn().mockReturnValue({ eq: hunterFilter });
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({ eq: bountyFilter }),
      });

      await expect(
        completionService.getSubmissionForReview('bounty123', 'hunter123')
      ).rejects.toThrow('RLS denied');
    });

    it('rejects a response that belongs to a different hunter', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'submission-wrong',
          bounty_id: 'bounty123',
          hunter_id: 'hunter-other',
          proof_items: '[]',
        },
        error: null,
      });
      const limit = jest.fn().mockReturnValue({ maybeSingle });
      const order = jest.fn().mockReturnValue({ limit });
      const hunterFilter = jest.fn().mockReturnValue({ order });
      const bountyFilter = jest.fn().mockReturnValue({ eq: hunterFilter });
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({ eq: bountyFilter }),
      });

      await expect(
        completionService.getSubmissionForReview('bounty123', 'hunter123')
      ).rejects.toThrow('does not match the accepted hunter');
    });
  });

  describe('markReady and getReady', () => {
    it('should mark bounty as ready for submission', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const insert = jest.fn().mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle,
              }),
            }),
          }),
        }),
        insert,
      });

      const result = await completionService.markReady('bounty123', 'hunter123');

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('completion_ready');
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ bounty_id: 'bounty123', hunter_id: 'hunter123' })
      );
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
            error: new Error('Update failed'),
          }),
        }),
      });

      await expect(completionService.approveCompletion('submission123')).rejects.toThrow();
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
                  error: null,
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

      // Mock analytics bounties fetch (amount/is_for_honor)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { amount: 50, is_for_honor: false },
              error: null,
            }),
          }),
        }),
      });

      // Mock bounty_requests fetch (getHoursSinceClaimed)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await completionService.approveSubmission('bounty123');

      expect(result).toBe(true);

      const { bountyService } = require('../../../lib/services/bounty-service');
      expect(bountyService.update).toHaveBeenCalledWith('bounty123', {
        status: 'completed',
        completed_at: expect.any(String),
      });

      // The hunter's "Work Approved!" notification and rating prompt are
      // enqueued by the trg_completion_review_notification DB trigger off the
      // completion_submissions status change, not by this service. The client
      // insert this replaced was always rejected by RLS.
      const calls = mockSupabase.from.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain('notifications_outbox');
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

      await expect(completionService.approveSubmission('bounty123')).rejects.toThrow(
        'No submission found for bounty'
      );
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
              error: null,
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

      const result = await completionService.requestRevision(
        'submission123',
        'Please update the color scheme'
      );

      expect(result).toBe(true);

      // The hunter's "Revision Requested" alert is enqueued by the
      // trg_completion_review_notification DB trigger off the status change
      // above (it reads poster_feedback from the row). The client must not
      // touch notifications_outbox — RLS rejects it — nor write a direct
      // in-app-only `notifications` row.
      const calls = mockSupabase.from.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain('notifications_outbox');
      expect(calls).not.toContain('notifications');
    });

    it('should handle revision request errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: new Error('Not found'),
            }),
          }),
        }),
      });

      await expect(
        completionService.requestRevision('submission123', 'feedback')
      ).rejects.toThrow();
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

      await expect(completionService.submitRating(invalidRating)).rejects.toThrow(
        'Missing required rating fields'
      );
    });

    it('should handle rating submission errors', async () => {
      mockSupabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Constraint violation' },
            }),
          }),
        }),
      });

      await expect(completionService.submitRating(mockRating)).rejects.toThrow(
        'Constraint violation'
      );
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
              error: { message: 'Query failed' },
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

      // A corrupt proof payload must not hide the submission from the poster.
      const result = await completionService.getSubmission('bounty123');
      expect(result).toMatchObject({
        id: 'submission123',
        bounty_id: 'bounty123',
        hunter_id: 'hunter123',
      });
      expect(result?.proof_items).toEqual([]);
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
