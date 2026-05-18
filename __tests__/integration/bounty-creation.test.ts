/**
 * Integration test for Bounty Creation Flow
 * Tests the integration between bounty service and database layer
 */

import type { Bounty } from '../../lib/services/database.types';

// Mock supabase
jest.mock('../../lib/supabase', () => {
  const mockSupabase = {
    from: jest.fn(),
    auth: {
      getSession: jest.fn(),
    },
  };
  return {
    supabase: mockSupabase,
    isSupabaseConfigured: true,
  };
});

// Mock analytics
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
  },
}));

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn(),
}));

// Mock offline queue service
jest.mock('../../lib/services/offline-queue-service', () => ({
  offlineQueueService: {
    enqueue: jest.fn(),
  },
}));

// Import after mocks are set up
import { bountyService } from '../../lib/services/bounty-service';
import { supabase } from '../../lib/supabase';

describe('Bounty Creation Integration Tests', () => {
  const mockUserId = 'user_123';
  const mockBountyId = 123;
  const mockSupabase = supabase as any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock successful session
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: mockUserId,
            email: 'test@example.com',
          },
        },
      },
      error: null,
    });

    // Setup default mock responses for rate limiting checks
    const mockCount = jest.fn().mockResolvedValue({ count: 0, error: null });
    const mockGte = jest.fn().mockReturnValue({ count: mockCount });
    const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    
    mockSupabase.from.mockReturnValue({
      select: mockSelect,
    });
  });

  describe('Create Paid Bounty Flow', () => {
    it('should successfully create a paid bounty through the service', async () => {
      // Setup mock for rate limit check
      const mockCountResult = { count: 0, error: null };
      const mockGte = jest.fn().mockResolvedValue(mockCountResult);
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelectCount = jest.fn().mockReturnValue({ eq: mockEq });
      
      // Setup mock for duplicate check
      const mockDupCheck = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockGte2 = jest.fn().mockReturnValue(mockDupCheck);
      const mockEq2 = jest.fn().mockReturnValue({ gte: mockGte2 });
      const mockSelectDup = jest.fn().mockReturnValue({ eq: mockEq2 });

      // Setup mock for insert - chain is: from().insert().select().single()
      const mockInsertResult = {
        data: {
          id: mockBountyId,
          title: 'Fix website bug',
          description: 'Need help fixing a bug on my website',
          amount: 50,
          is_for_honor: false,
          poster_id: mockUserId,
          status: 'open',
          created_at: new Date().toISOString(),
          location: '',
          timeline: '',
          skills_required: '',
        } as Bounty,
        error: null,
      };
      const mockSingle = jest.fn().mockResolvedValue(mockInsertResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = jest.fn().mockReturnValue({ select: mockSelect });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: rate limit check
          return { select: mockSelectCount };
        } else if (callCount === 2) {
          // Second call: duplicate check
          return { select: mockSelectDup };
        } else {
          // Third call: insert - chain is from().insert().select().single()
          return { insert: mockInsert };
        }
      });

      // Call the actual bounty service
      const bountyData: Omit<Bounty, 'id' | 'created_at'> = {
        title: 'Fix website bug',
        description: 'Need help fixing a bug on my website',
        amount: 50,
        is_for_honor: false,
        poster_id: mockUserId,
        status: 'open',
        location: '',
        timeline: '',
        skills_required: '',
      };

      const result = await bountyService.create(bountyData);

      // Verify the service called the database correctly
      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockBountyId);
      expect(result?.title).toBe(bountyData.title);
      expect(result?.amount).toBe(bountyData.amount);
      expect(result?.status).toBe('open');
      
      // Verify rate limit check was performed
      expect(mockSupabase.from).toHaveBeenCalledWith('bounties');
      expect(mockEq).toHaveBeenCalledWith('poster_id', mockUserId);
    });

    it('should handle rate limit exceeded error', async () => {
      // Mock rate limit exceeded (10 bounties already posted today)
      const mockCountResult = { count: 10, error: null };
      const mockGte = jest.fn().mockResolvedValue(mockCountResult);
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelectCount = jest.fn().mockReturnValue({ eq: mockEq });
      
      mockSupabase.from.mockReturnValue({
        select: mockSelectCount,
      });

      const bountyData: Omit<Bounty, 'id' | 'created_at'> = {
        title: 'Test bounty',
        description: 'Test description',
        amount: 50,
        is_for_honor: false,
        poster_id: mockUserId,
        status: 'open',
        location: '',
        timeline: '',
        skills_required: '',
      };

      // Expect the service to throw rate limit error
      await expect(bountyService.create(bountyData)).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Create Honor Bounty Flow', () => {
    it('should successfully create an honor bounty through the service', async () => {
      // Setup mocks for rate limit and duplicate checks
      const mockCountResult = { count: 0, error: null };
      const mockDupResult = { data: [], error: null };
      const mockGte1 = jest.fn().mockResolvedValue(mockCountResult);
      const mockGte2 = jest.fn().mockResolvedValue(mockDupResult);
      const mockEq1 = jest.fn().mockReturnValue({ gte: mockGte1 });
      const mockEq2 = jest.fn().mockReturnValue({ gte: mockGte2 });
      const mockSelectCount = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockSelectDup = jest.fn().mockReturnValue({ eq: mockEq2 });

      // Setup mock for insert - chain is: from().insert().select().single()
      const mockInsertResult = {
        data: {
          id: mockBountyId,
          title: 'Help needed',
          description: 'Looking for volunteers',
          amount: 0,
          is_for_honor: true,
          poster_id: mockUserId,
          status: 'open',
          created_at: new Date().toISOString(),
          location: '',
          timeline: '',
          skills_required: '',
        } as Bounty,
        error: null,
      };
      const mockSingle = jest.fn().mockResolvedValue(mockInsertResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = jest.fn().mockReturnValue({ select: mockSelect });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { select: mockSelectCount };
        else if (callCount === 2) return { select: mockSelectDup };
        else return { insert: mockInsert };
      });

      const bountyData: Omit<Bounty, 'id' | 'created_at'> = {
        title: 'Help needed',
        description: 'Looking for volunteers',
        amount: 0,
        is_for_honor: true,
        poster_id: mockUserId,
        status: 'open',
        location: '',
        timeline: '',
        skills_required: '',
      };

      const result = await bountyService.create(bountyData);

      expect(result).not.toBeNull();
      expect(result?.is_for_honor).toBe(true);
    });
  });

  describe('Bounty Creation Error Handling', () => {
    it('should NOT throw a false-duplicate error when called twice with the same title (base service no longer does title-based duplicate detection)', async () => {
      // Regression test for the false "Duplicate Bounty" bug. The base service
      // must NEVER throw "Duplicate content detected" — idempotency is the
      // responsibility of the wrapper at app/services/bountyService.ts which
      // keys on a full-payload fingerprint and returns a `created` flag so
      // callers can avoid double-funding escrow. Here we just verify the base
      // create() succeeds for a payload identical to a recent one, with no
      // false-positive throw.
      const mockCountResult = { count: 0, error: null };
      const mockGte = jest.fn().mockResolvedValue(mockCountResult);
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelectCount = jest.fn().mockReturnValue({ eq: mockEq });

      const mockInsertResult = {
        data: {
          id: 999,
          title: 'Duplicate Title',
          description: 'Test description',
          amount: 50,
          is_for_honor: false,
          poster_id: mockUserId,
          status: 'open',
          location: '',
          timeline: '',
          skills_required: '',
          created_at: new Date().toISOString(),
        } as Bounty,
        error: null,
      };
      const mockSingle = jest.fn().mockResolvedValue(mockInsertResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockMaybeSingle = jest
        .fn()
        .mockResolvedValue({ data: { username: 'testuser' }, error: null });
      const mockProfileEq = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockProfileSelect = jest.fn().mockReturnValue({ eq: mockProfileEq });

      let callCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++;
        // 1: rate-limit count; 2: profiles lookup; 3: insert
        if (callCount === 1) return { select: mockSelectCount };
        if (table === 'profiles') return { select: mockProfileSelect };
        return { insert: mockInsert };
      });

      const bountyData: Omit<Bounty, 'id' | 'created_at'> = {
        title: 'Duplicate Title',
        description: 'Test description',
        amount: 50,
        is_for_honor: false,
        poster_id: mockUserId,
        status: 'open',
        location: '',
        timeline: '',
        skills_required: '',
      };

      const result = await bountyService.create(bountyData);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Duplicate Title');
    });
  });
});
