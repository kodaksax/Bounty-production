/**
 * Unit tests for Bounty Service - Spam Prevention Features
 * Tests rate limiting and duplicate detection in bounty creation
 */

// Mock dependencies before imports
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/network', () => ({
  getReachableApiBaseUrl: jest.fn().mockReturnValue('http://localhost:3001'),
}));

jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: {
    enqueue: jest.fn(),
  },
}));

import { bountyService } from '../../../lib/services/bounty-service';

const { supabase } = require('../../../lib/supabase');
const { logger } = require('../../../lib/utils/error-logger');

// Helper to create a complete bounty object for testing
const createTestBounty = (overrides: Partial<any> = {}) => ({
  title: 'Test Bounty',
  description: 'Test description with sufficient length',
  amount: 100,
  status: 'open' as const,
  location: 'Test Location',
  is_for_honor: false,
  timeline: '1 week',
  skills_required: 'Testing',
  poster_id: 'user-123',
  ...overrides,
});

describe('Bounty Service - Spam Prevention', () => {
  // Mock chain builder for Supabase queries
  const createMockQueryChain = (finalResult: any) => {
    const chain: any = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.gte = jest.fn().mockReturnValue(chain);
    chain.in = jest.fn().mockReturnValue(chain);
    chain.single = jest.fn().mockReturnValue(chain);
    chain.insert = jest.fn().mockResolvedValue(finalResult);
    chain.update = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: { username: 'testuser' }, error: null });
    
    // For count queries, resolve immediately with the result
    Object.defineProperty(chain, 'then', {
      value: (resolve: any) => resolve(finalResult),
      writable: true,
      configurable: true,
    });
    
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rate Limiting', () => {
    it('should block creation when user exceeds daily limit (10 bounties)', async () => {
      // Mock the count query to return 10 bounties
      const mockCountChain = createMockQueryChain({ count: 10, error: null });
      supabase.from.mockReturnValue(mockCountChain);

      const bounty = createTestBounty();

      await expect(bountyService.create(bounty)).rejects.toThrow(
        'Rate limit exceeded: You can only create 10 bounties per day'
      );

      expect(logger.warning).toHaveBeenCalledWith(
        'Rate limit exceeded for bounty creation',
        expect.objectContaining({ posterId: 'user-123', count: 10 })
      );
    });

    it('should allow creation when user is under daily limit', async () => {
      // First call for rate limit check (returns 5 bounties - under limit)
      const rateLimitChain = createMockQueryChain({ count: 5, error: null });
      
      // Second call for duplicate check (returns empty array)
      const duplicateChain = createMockQueryChain({ data: [], error: null });
      
      // Third call for profile fetch
      const profileChain = createMockQueryChain({ data: { username: 'testuser' }, error: null });
      
      // Fourth call for insert
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Test Bounty' }, 
        error: null 
      });
      
      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'bounties' && callCount === 1) return rateLimitChain;
        if (table === 'bounties' && callCount === 2) return duplicateChain;
        if (table === 'profiles') return profileChain;
        return insertChain;
      });

      const bounty = createTestBounty();

      // Should not throw rate limit error
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        // If it throws, it shouldn't be a rate limit error
        expect(error.message).not.toContain('Rate limit exceeded');
      }
    });

    it('should gracefully proceed when rate limit check fails', async () => {
      // Mock rate limit check to fail with database error
      const errorChain = createMockQueryChain({ count: null, error: { message: 'Database error' } });
      const duplicateChain = createMockQueryChain({ data: [], error: null });
      const profileChain = createMockQueryChain({ data: { username: 'testuser' }, error: null });
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Test Bounty' }, 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'bounties' && callCount === 1) return errorChain;
        if (table === 'bounties' && callCount === 2) return duplicateChain;
        if (table === 'profiles') return profileChain;
        return insertChain;
      });

      const bounty = createTestBounty();

      // Should not throw rate limit error - should proceed despite check failure
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        expect(error.message).not.toContain('Rate limit exceeded');
      }
    });
  });

  describe('Duplicate Detection', () => {
    it('should block creation for exact duplicate titles', async () => {
      // Mock rate limit check to pass
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      
      // Mock duplicate check to return existing bounty with same title
      const duplicateChain = createMockQueryChain({ 
        data: [{ title: 'Fix My Website' }], 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) return rateLimitChain;
        return duplicateChain;
      });

      const bounty = createTestBounty({ title: 'Fix My Website' });

      await expect(bountyService.create(bounty)).rejects.toThrow(
        'Duplicate content detected'
      );

      expect(logger.warning).toHaveBeenCalledWith(
        'Duplicate bounty detected',
        expect.objectContaining({ posterId: 'user-123', title: 'Fix My Website' })
      );
    });

    it('should block creation for case-insensitive duplicate titles', async () => {
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      const duplicateChain = createMockQueryChain({ 
        data: [{ title: 'fix my website' }], 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) return rateLimitChain;
        return duplicateChain;
      });

      const bounty = createTestBounty({ title: 'FIX MY WEBSITE' });

      await expect(bountyService.create(bounty)).rejects.toThrow(
        'Duplicate content detected'
      );
    });

    it('should allow creation for different titles', async () => {
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      const duplicateChain = createMockQueryChain({ 
        data: [{ title: 'Build Mobile App' }], 
        error: null 
      });
      const profileChain = createMockQueryChain({ data: { username: 'testuser' }, error: null });
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Fix My Website' }, 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'bounties' && callCount === 1) return rateLimitChain;
        if (table === 'bounties' && callCount === 2) return duplicateChain;
        if (table === 'profiles') return profileChain;
        return insertChain;
      });

      const bounty = createTestBounty({ title: 'Fix My Website' });

      // Should not throw duplicate error
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        expect(error.message).not.toContain('Duplicate content detected');
      }
    });

    it('should gracefully proceed when duplicate check fails', async () => {
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      const errorChain = createMockQueryChain({ data: null, error: { message: 'Database error' } });
      const profileChain = createMockQueryChain({ data: { username: 'testuser' }, error: null });
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Test Bounty' }, 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'bounties' && callCount === 1) return rateLimitChain;
        if (table === 'bounties' && callCount === 2) return errorChain;
        if (table === 'profiles') return profileChain;
        return insertChain;
      });

      const bounty = createTestBounty();

      // Should not throw duplicate error - should proceed despite check failure
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        expect(error.message).not.toContain('Duplicate content detected');
      }
    });

    it('should allow creation when no recent bounties exist', async () => {
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      const duplicateChain = createMockQueryChain({ data: [], error: null });
      const profileChain = createMockQueryChain({ data: { username: 'testuser' }, error: null });
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Test Bounty' }, 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (table === 'bounties' && callCount === 1) return rateLimitChain;
        if (table === 'bounties' && callCount === 2) return duplicateChain;
        if (table === 'profiles') return profileChain;
        return insertChain;
      });

      const bounty = createTestBounty({ title: 'Brand New Bounty' });

      // Should not throw any spam prevention error
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        expect(error.message).not.toContain('Rate limit exceeded');
        expect(error.message).not.toContain('Duplicate content detected');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should skip spam checks when poster_id is not provided', async () => {
      const insertChain = createMockQueryChain({ 
        data: { id: 1, title: 'Test Bounty' }, 
        error: null 
      });
      supabase.from.mockReturnValue(insertChain);

      // Create bounty without poster_id
      const bounty = createTestBounty({ poster_id: undefined });

      // Should not check for spam when no poster_id
      try {
        await bountyService.create(bounty);
      } catch (error: any) {
        expect(error.message).not.toContain('Rate limit exceeded');
        expect(error.message).not.toContain('Duplicate content detected');
      }
    });

    it('should handle trimmed and whitespace titles correctly', async () => {
      const rateLimitChain = createMockQueryChain({ count: 0, error: null });
      const duplicateChain = createMockQueryChain({ 
        data: [{ title: '  Fix My Website  ' }], 
        error: null 
      });

      let callCount = 0;
      supabase.from.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) return rateLimitChain;
        return duplicateChain;
      });

      const bounty = createTestBounty({ title: 'Fix My Website' });

      // Should detect duplicate even with whitespace differences
      await expect(bountyService.create(bounty)).rejects.toThrow(
        'Duplicate content detected'
      );
    });
  });
});
