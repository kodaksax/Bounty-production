/**
 * Unit tests for Report Service - Admin Notifications and Statistics
 * Tests admin notification creation and report statistics aggregation
 */

// Mock supabase before importing the service
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// Mock data-utils
jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn(),
}));

import { reportService, REPORT_REASONS } from '../../../lib/services/report-service';

const { supabase } = require('../../../lib/supabase');
const { getCurrentUserId } = require('../../../lib/utils/data-utils');

describe('Report Service', () => {
  // Mock chain builder for Supabase queries
  const createMockQueryChain = (finalResult: any) => {
    const chain: any = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.in = jest.fn().mockReturnValue(chain);
    chain.insert = jest.fn().mockResolvedValue(finalResult);
    chain.update = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockReturnValue(chain);
    
    // For queries that resolve immediately
    Object.defineProperty(chain, 'then', {
      value: (resolve: any) => resolve(finalResult),
      writable: true,
      configurable: true,
    });
    
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentUserId.mockReturnValue('reporter-123');
  });

  describe('REPORT_REASONS', () => {
    it('should have correct report reason definitions', () => {
      expect(REPORT_REASONS).toHaveLength(4);
      expect(REPORT_REASONS).toContainEqual({ id: 'spam', label: 'Spam or misleading' });
      expect(REPORT_REASONS).toContainEqual({ id: 'harassment', label: 'Harassment or bullying' });
      expect(REPORT_REASONS).toContainEqual({ id: 'inappropriate', label: 'Inappropriate content' });
      expect(REPORT_REASONS).toContainEqual({ id: 'fraud', label: 'Scam or fraud' });
    });
  });

  describe('Admin Notification Creation', () => {
    it('should create admin notification when reporting a bounty', async () => {
      const reportChain = createMockQueryChain({ error: null });
      const notificationChain = createMockQueryChain({ error: null });

      let tableCallOrder: string[] = [];
      supabase.from.mockImplementation((table: string) => {
        tableCallOrder.push(table);
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      const result = await reportService.reportBounty('bounty-123', 'fraud', 'This is a scam');

      expect(result.success).toBe(true);
      expect(tableCallOrder).toContain('reports');
      expect(tableCallOrder).toContain('admin_notifications');
    });

    it('should create admin notification when reporting a user', async () => {
      const reportChain = createMockQueryChain({ error: null });
      const notificationChain = createMockQueryChain({ error: null });

      let tableCallOrder: string[] = [];
      supabase.from.mockImplementation((table: string) => {
        tableCallOrder.push(table);
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      const result = await reportService.reportUser('user-456', 'harassment', 'Threatening messages');

      expect(result.success).toBe(true);
      expect(tableCallOrder).toContain('reports');
      expect(tableCallOrder).toContain('admin_notifications');
    });

    it('should create admin notification when reporting a message', async () => {
      const reportChain = createMockQueryChain({ error: null });
      const notificationChain = createMockQueryChain({ error: null });

      let tableCallOrder: string[] = [];
      supabase.from.mockImplementation((table: string) => {
        tableCallOrder.push(table);
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      const result = await reportService.reportMessage('msg-789', 'spam', 'Promotional spam');

      expect(result.success).toBe(true);
      expect(tableCallOrder).toContain('reports');
      expect(tableCallOrder).toContain('admin_notifications');
    });

    it('should set high priority for fraud reports', async () => {
      const reportChain = createMockQueryChain({ error: null });
      let capturedNotification: any = null;
      const notificationChain = {
        insert: jest.fn().mockImplementation((data: any) => {
          capturedNotification = data;
          return Promise.resolve({ error: null });
        }),
      };

      supabase.from.mockImplementation((table: string) => {
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      await reportService.reportBounty('bounty-123', 'fraud', 'Scam detected');

      expect(capturedNotification).toBeTruthy();
      expect(capturedNotification.priority).toBe('high');
    });

    it('should set high priority for harassment reports', async () => {
      const reportChain = createMockQueryChain({ error: null });
      let capturedNotification: any = null;
      const notificationChain = {
        insert: jest.fn().mockImplementation((data: any) => {
          capturedNotification = data;
          return Promise.resolve({ error: null });
        }),
      };

      supabase.from.mockImplementation((table: string) => {
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      await reportService.reportUser('user-123', 'harassment', 'Bullying behavior');

      expect(capturedNotification).toBeTruthy();
      expect(capturedNotification.priority).toBe('high');
    });

    it('should set normal priority for spam reports', async () => {
      const reportChain = createMockQueryChain({ error: null });
      let capturedNotification: any = null;
      const notificationChain = {
        insert: jest.fn().mockImplementation((data: any) => {
          capturedNotification = data;
          return Promise.resolve({ error: null });
        }),
      };

      supabase.from.mockImplementation((table: string) => {
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      await reportService.reportBounty('bounty-123', 'spam', 'Promotional content');

      expect(capturedNotification).toBeTruthy();
      expect(capturedNotification.priority).toBe('normal');
    });

    it('should not block report submission if notification creation fails', async () => {
      const reportChain = createMockQueryChain({ error: null });
      const notificationChain = createMockQueryChain({ error: { message: 'Notification table error' } });

      supabase.from.mockImplementation((table: string) => {
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      // Console warn should be called but report should still succeed
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = await reportService.reportBounty('bounty-123', 'fraud', 'Test');

      expect(result.success).toBe(true);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Report Statistics Aggregation', () => {
    it('should aggregate report statistics correctly', async () => {
      // Mock parallel count queries
      const mockCountResults = [
        { count: 5, error: null },  // pending
        { count: 3, error: null },  // reviewed
        { count: 10, error: null }, // resolved
        { count: 2, error: null },  // dismissed
        { count: 4, error: null },  // highPriority
      ];

      let queryIndex = 0;
      supabase.from.mockImplementation(() => {
        const result = mockCountResults[queryIndex];
        queryIndex = Math.min(queryIndex + 1, mockCountResults.length - 1);
        return createMockQueryChain(result);
      });

      const result = await reportService.getReportStats();

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats?.pending).toBe(5);
      expect(result.stats?.reviewed).toBe(3);
      expect(result.stats?.resolved).toBe(10);
      expect(result.stats?.dismissed).toBe(2);
      expect(result.stats?.highPriority).toBe(4);
    });

    it('should handle database errors in statistics query', async () => {
      const errorChain = createMockQueryChain({ count: null, error: { message: 'Database connection failed' } });
      supabase.from.mockReturnValue(errorChain);

      const result = await reportService.getReportStats();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    it('should return zero counts when no reports exist', async () => {
      const mockCountResults = [
        { count: 0, error: null },
        { count: 0, error: null },
        { count: 0, error: null },
        { count: 0, error: null },
        { count: 0, error: null },
      ];

      let queryIndex = 0;
      supabase.from.mockImplementation(() => {
        const result = mockCountResults[queryIndex];
        queryIndex = Math.min(queryIndex + 1, mockCountResults.length - 1);
        return createMockQueryChain(result);
      });

      const result = await reportService.getReportStats();

      expect(result.success).toBe(true);
      expect(result.stats?.pending).toBe(0);
      expect(result.stats?.reviewed).toBe(0);
      expect(result.stats?.resolved).toBe(0);
      expect(result.stats?.dismissed).toBe(0);
      expect(result.stats?.highPriority).toBe(0);
    });

    it('should handle null counts gracefully', async () => {
      const mockCountResults = [
        { count: null, error: null },
        { count: null, error: null },
        { count: null, error: null },
        { count: null, error: null },
        { count: null, error: null },
      ];

      let queryIndex = 0;
      supabase.from.mockImplementation(() => {
        const result = mockCountResults[queryIndex];
        queryIndex = Math.min(queryIndex + 1, mockCountResults.length - 1);
        return createMockQueryChain(result);
      });

      const result = await reportService.getReportStats();

      expect(result.success).toBe(true);
      expect(result.stats?.pending).toBe(0);
      expect(result.stats?.reviewed).toBe(0);
      expect(result.stats?.resolved).toBe(0);
      expect(result.stats?.dismissed).toBe(0);
      expect(result.stats?.highPriority).toBe(0);
    });
  });

  describe('Report Submission', () => {
    it('should require authentication for reporting', async () => {
      getCurrentUserId.mockReturnValue(null);

      const result = await reportService.reportBounty('bounty-123', 'spam', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not authenticated');
    });

    it('should successfully submit a bounty report', async () => {
      const reportChain = createMockQueryChain({ error: null });
      const notificationChain = createMockQueryChain({ error: null });

      supabase.from.mockImplementation((table: string) => {
        if (table === 'reports') return reportChain;
        if (table === 'admin_notifications') return notificationChain;
        return reportChain;
      });

      const result = await reportService.reportBounty('bounty-123', 'fraud', 'Suspicious activity');

      expect(result.success).toBe(true);
      expect(reportChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_type: 'bounty',
          content_id: 'bounty-123',
          reason: 'fraud',
          details: 'Suspicious activity',
          status: 'pending',
        })
      );
    });

    it('should handle report submission errors', async () => {
      const reportChain = createMockQueryChain({ error: { message: 'Database error' } });
      supabase.from.mockReturnValue(reportChain);

      const result = await reportService.reportBounty('bounty-123', 'spam', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('Report Status Update', () => {
    it('should successfully update report status', async () => {
      const updateChain = createMockQueryChain({ error: null });
      supabase.from.mockReturnValue(updateChain);

      const result = await reportService.updateReportStatus('report-123', 'resolved');

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'resolved',
        })
      );
    });

    it('should include resolution notes when provided', async () => {
      const updateChain = createMockQueryChain({ error: null });
      supabase.from.mockReturnValue(updateChain);

      const result = await reportService.updateReportStatus('report-123', 'resolved', 'User banned');

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'resolved',
          resolution_notes: 'User banned',
        })
      );
    });

    it('should handle update errors', async () => {
      const updateChain = createMockQueryChain({ error: { message: 'Update failed' } });
      supabase.from.mockReturnValue(updateChain);

      const result = await reportService.updateReportStatus('report-123', 'dismissed');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });
});
