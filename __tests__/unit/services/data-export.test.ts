/**
 * Unit tests for Data Export Service
 * Tests GDPR compliance features for data portability
 */

import { jest } from '@jest/globals';

// Mock expo modules
jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
  writeAsStringAsync: jest.fn(),
  EncodingType: {
    UTF8: 'utf8',
  },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

// Mock supabase
const mockSupabaseClient: any = {
  auth: {
    getSession: jest.fn(),
    getUser: jest.fn(),
  },
  from: jest.fn(),
};

jest.mock('../../../lib/supabase', () => ({
  supabase: mockSupabaseClient,
}));

describe('Data Export Service', () => {
  let exportUserData: any;
  let exportAndShareUserData: any;
  let FileSystem: any;
  let Sharing: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Import after mocks are set up
    FileSystem = require('expo-file-system/legacy');
    Sharing = require('expo-sharing');
    const service = require('../../../lib/services/data-export-service');
    exportUserData = service.exportUserData;
    exportAndShareUserData = service.exportAndShareUserData;
  });

  describe('exportUserData', () => {
    const mockUserId = 'user-123';
    const mockSession = {
      user: { id: mockUserId },
      access_token: 'mock-token',
    };

    it('should return error if user is not authenticated', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication required');
    });

    it('should return error if session user does not match requested user', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: { user: { id: 'different-user' }, access_token: 'token' } as any },
        error: null,
      } as any);

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication required');
    });

    it('should collect user data from multiple tables', async () => {
      // Mock successful authentication
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      } as any);

      // Mock database queries with proper tracking
      // For queries with .single() (e.g., profiles)
      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: { id: mockUserId, username: 'testuser', email: 'test@example.com', balance: 100 },
        error: null,
      } as any);

      // For queries without .single() (e.g., bounties, messages)
      const mockArrayResult = jest.fn<any>().mockResolvedValue({
        data: [],
        error: null,
      } as any);

      // For queries with .in() (e.g., conversations)
      const mockInResult = jest.fn<any>().mockResolvedValue({
        data: [],
        error: null,
      } as any);

      // Create eq mock that returns an object with single method
      const mockEq = jest.fn().mockImplementation(() => {
        // Return a promise-like object that also has .single() method
        const promise = mockArrayResult() as any;
        promise.single = mockSingleResult;
        return promise;
      });

      const mockSelect = jest.fn().mockReturnValue({
        eq: mockEq,
        in: mockInResult,
      });

      mockSupabaseClient.from.mockImplementation(() => ({
        select: mockSelect,
      }));

      // Mock file write
      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.exportDate).toBeDefined();
      expect(result.data?.profile).toBeDefined();
      expect(result.filePath).toContain('bounty_data_export');
      expect(result.filePath).toContain('.json');
      
      // Verify correct queries are being made
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('profiles');
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('messages');
      expect(mockEq).toHaveBeenCalledWith('user_id', mockUserId);
    });

    it('should export data structure with all required sections', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      } as any);

      // Mock all queries to return empty arrays or null
      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Check all expected data sections exist
      expect(result.data).toHaveProperty('exportDate');
      expect(result.data).toHaveProperty('profile');
      expect(result.data).toHaveProperty('bounties');
      expect(result.data?.bounties).toHaveProperty('created');
      expect(result.data?.bounties).toHaveProperty('accepted');
      expect(result.data?.bounties).toHaveProperty('applications');
      expect(result.data).toHaveProperty('conversations');
      expect(result.data?.conversations).toHaveProperty('conversations');
      expect(result.data?.conversations).toHaveProperty('participants');
      expect(result.data).toHaveProperty('messages');
      expect(result.data).toHaveProperty('wallet');
      expect(result.data?.wallet).toHaveProperty('transactions');
      expect(result.data?.wallet).toHaveProperty('currentBalance');
      expect(result.data).toHaveProperty('skills');
      expect(result.data).toHaveProperty('reports');
      expect(result.data).toHaveProperty('blockedUsers');
      expect(result.data).toHaveProperty('cancellations');
      expect(result.data).toHaveProperty('disputes');
      expect(result.data).toHaveProperty('completionReady');
      expect(result.data).toHaveProperty('notifications');
      expect(result.data).toHaveProperty('completions');
    });

    it('should not include userId in filename for privacy protection', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      } as any);

      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();
      // Filename should NOT contain the userId
      expect(result.filePath).not.toContain(mockUserId);
      expect(result.filePath).toContain('bounty_data_export');
    });

    it('should still succeed if file write fails but return data', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      } as any);

      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockRejectedValue(new Error('File write failed'));

      const result = await exportUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Data collected');
      expect(result.data).toBeDefined();
      expect(result.filePath).toBeUndefined();
    });
  });

  describe('exportAndShareUserData', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
      // Mock successful data export
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { 
          session: { 
            user: { id: mockUserId },
            access_token: 'mock-token',
          } 
        },
        error: null,
      } as any);

      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    });

    it('should share file if sharing is available', async () => {
      Sharing.isAvailableAsync.mockResolvedValue(true);
      Sharing.shareAsync.mockResolvedValue(undefined);

      const result = await exportAndShareUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(Sharing.isAvailableAsync).toHaveBeenCalled();
      expect(Sharing.shareAsync).toHaveBeenCalled();
      expect(result.message).toContain('shared successfully');
    });

    it('should handle sharing not available on device', async () => {
      Sharing.isAvailableAsync.mockResolvedValue(false);

      const result = await exportAndShareUserData(mockUserId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Sharing is not available');
      expect(Sharing.shareAsync).not.toHaveBeenCalled();
    });

    it('should return error if data export fails', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      const result = await exportAndShareUserData(mockUserId);

      expect(result.success).toBe(false);
      expect(Sharing.shareAsync).not.toHaveBeenCalled();
    });

    it('should handle sharing errors gracefully', async () => {
      Sharing.isAvailableAsync.mockResolvedValue(true);
      Sharing.shareAsync.mockRejectedValue(new Error('Share failed'));

      const result = await exportAndShareUserData(mockUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Share failed');
    });
  });

  describe('GDPR Compliance', () => {
    it('should export data in machine-readable format (JSON)', async () => {
      const mockUserId = 'user-123';
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { 
          session: { 
            user: { id: mockUserId },
            access_token: 'mock-token',
          } 
        },
        error: null,
      } as any);

      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);

      const result = await exportUserData(mockUserId);

      // Verify JSON format
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Verify data can be stringified (valid JSON structure)
      expect(() => JSON.stringify(result.data)).not.toThrow();
    });

    it('should include export timestamp for audit purposes', async () => {
      const mockUserId = 'user-123';
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { 
          session: { 
            user: { id: mockUserId },
            access_token: 'mock-token',
          } 
        },
        error: null,
      } as any);

      const mockArrayResult = {
        data: [],
        error: null,
      } as any;

      const mockSingleResult = jest.fn<any>().mockResolvedValue({
        data: null,
        error: null,
      } as any);

      mockSupabaseClient.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            // Return a promise that also has .single() method
            const promise = Promise.resolve(mockArrayResult) as any;
            promise.single = mockSingleResult;
            return promise;
          }),
          in: jest.fn<any>().mockResolvedValue(mockArrayResult),
        }),
      }));

      FileSystem.writeAsStringAsync.mockResolvedValue(undefined);

      const beforeExport = new Date();
      const result = await exportUserData(mockUserId);
      const afterExport = new Date();

      expect(result.data?.exportDate).toBeDefined();
      
      const exportDate = new Date(result.data!.exportDate);
      expect(exportDate.getTime()).toBeGreaterThanOrEqual(beforeExport.getTime());
      expect(exportDate.getTime()).toBeLessThanOrEqual(afterExport.getTime());
    });
  });
});
