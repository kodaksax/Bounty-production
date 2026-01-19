/**
 * Audit Log Service
 * Provides comprehensive audit trail for admin and compliance purposes
 * Follows Apple Human Interface Guidelines for data presentation
 */

import type { AuditLogEntry, AuditLogFilters } from '../types-admin';

// Mock data for development - simulates various system events
const mockAuditLogs: AuditLogEntry[] = [
  {
    id: 'log-001',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    category: 'moderation',
    action: 'report_resolved',
    actorId: 'admin-001',
    actorName: 'Admin User',
    targetId: 'report-123',
    targetType: 'report',
    description: 'Report #123 resolved - Content removed for harassment',
    severity: 'warning',
    metadata: { reason: 'harassment', resolution: 'content_removed' },
  },
  {
    id: 'log-002',
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    category: 'user',
    action: 'suspended',
    actorId: 'admin-001',
    actorName: 'Admin User',
    targetId: 'user-456',
    targetType: 'user',
    description: 'User @spammer suspended for policy violations',
    severity: 'critical',
    metadata: { suspensionDuration: '7 days', reason: 'spam' },
  },
  {
    id: 'log-003',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    category: 'payment',
    action: 'payment_completed',
    actorId: 'system',
    actorName: 'System',
    targetId: 'tx-789',
    targetType: 'transaction',
    description: 'Escrow released for bounty completion: $250.00',
    severity: 'info',
    metadata: { amount: 250, bountyId: 'bounty-001' },
  },
  {
    id: 'log-004',
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    category: 'security',
    action: 'login',
    actorId: 'user-123',
    actorName: '@techguru',
    description: 'Successful login from new device',
    severity: 'info',
    ipAddress: '192.168.1.100',
    metadata: { device: 'iPhone 15 Pro', location: 'San Francisco, CA' },
  },
  {
    id: 'log-005',
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    category: 'bounty',
    action: 'created',
    actorId: 'user-789',
    actorName: '@designpro',
    targetId: 'bounty-002',
    targetType: 'bounty',
    description: 'New bounty created: "Build Mobile App UI"',
    severity: 'info',
    metadata: { amount: 500, category: 'design' },
  },
  {
    id: 'log-006',
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    category: 'moderation',
    action: 'content_flagged',
    actorId: 'system',
    actorName: 'Auto-Moderation',
    targetId: 'message-456',
    targetType: 'message',
    description: 'Message flagged by automated content filter',
    severity: 'warning',
    metadata: { flagType: 'profanity', confidence: 0.92 },
  },
  {
    id: 'log-007',
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    category: 'payment',
    action: 'refund_issued',
    actorId: 'admin-002',
    actorName: 'Finance Admin',
    targetId: 'tx-456',
    targetType: 'transaction',
    description: 'Refund issued for disputed bounty: $150.00',
    severity: 'warning',
    metadata: { amount: 150, disputeId: 'dispute-001' },
  },
  {
    id: 'log-008',
    timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
    category: 'user',
    action: 'email_verified',
    actorId: 'user-999',
    actorName: '@newuser',
    description: 'Email verification completed',
    severity: 'info',
  },
  {
    id: 'log-009',
    timestamp: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    category: 'system',
    action: 'updated',
    actorId: 'system',
    actorName: 'System',
    description: 'Database maintenance completed successfully',
    severity: 'info',
    metadata: { duration: '5 minutes', tablesOptimized: 12 },
  },
  {
    id: 'log-010',
    timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    category: 'security',
    action: 'password_change',
    actorId: 'user-555',
    actorName: '@safeguard',
    description: 'Password changed successfully',
    severity: 'info',
    ipAddress: '10.0.0.50',
  },
  {
    id: 'log-011',
    timestamp: new Date(Date.now() - 1000 * 60 * 400).toISOString(),
    category: 'moderation',
    action: 'user_blocked',
    actorId: 'user-111',
    actorName: '@safeuser',
    targetId: 'user-222',
    targetType: 'user',
    description: 'User blocked @problematic',
    severity: 'info',
  },
  {
    id: 'log-012',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    category: 'bounty',
    action: 'deleted',
    actorId: 'admin-001',
    actorName: 'Admin User',
    targetId: 'bounty-spam-001',
    targetType: 'bounty',
    description: 'Bounty removed for violating community guidelines',
    severity: 'critical',
    metadata: { reason: 'spam', reportCount: 5 },
  },
];

/**
 * Simulates network delay for development/testing purposes.
 * This function wraps data with a configurable delay to mimic real API calls.
 * Should be replaced with actual API calls in production.
 * @param data - The data to return after delay
 * @param delayMs - Delay in milliseconds (default: 400ms)
 */
function simulateNetwork<T>(data: T, delayMs = 400): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), delayMs);
  });
}

export const auditLogService = {
  /**
   * Fetch audit logs with filtering and pagination
   */
  async getAuditLogs(filters?: AuditLogFilters): Promise<{
    success: boolean;
    logs?: AuditLogEntry[];
    totalCount?: number;
    error?: string;
  }> {
    try {
      let filtered = [...mockAuditLogs];

      // Apply category filter
      if (filters?.category && filters.category !== 'all') {
        filtered = filtered.filter((log) => log.category === filters.category);
      }

      // Apply severity filter
      if (filters?.severity && filters.severity !== 'all') {
        filtered = filtered.filter((log) => log.severity === filters.severity);
      }

      // Apply date range filter
      if (filters?.startDate) {
        const startDate = new Date(filters.startDate).getTime();
        filtered = filtered.filter((log) => new Date(log.timestamp).getTime() >= startDate);
      }

      if (filters?.endDate) {
        const endDate = new Date(filters.endDate).getTime();
        filtered = filtered.filter((log) => new Date(log.timestamp).getTime() <= endDate);
      }

      // Apply search query
      if (filters?.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        filtered = filtered.filter(
          (log) =>
            log.description.toLowerCase().includes(query) ||
            log.actorName?.toLowerCase().includes(query) ||
            log.action.toLowerCase().includes(query)
        );
      }

      // Apply actor filter
      if (filters?.actorId) {
        filtered = filtered.filter((log) => log.actorId === filters.actorId);
      }

      // Sort by timestamp (most recent first)
      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return simulateNetwork({
        success: true,
        logs: filtered,
        totalCount: filtered.length,
      });
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit logs',
      };
    }
  },

  /**
   * Get a single audit log entry by ID
   */
  async getAuditLogById(id: string): Promise<{
    success: boolean;
    log?: AuditLogEntry;
    error?: string;
  }> {
    try {
      const log = mockAuditLogs.find((l) => l.id === id);

      if (!log) {
        return { success: false, error: 'Audit log entry not found' };
      }

      return simulateNetwork({ success: true, log });
    } catch (error) {
      console.error('Error fetching audit log:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit log',
      };
    }
  },

  /**
   * Get audit log statistics for dashboard
   */
  async getAuditLogStats(): Promise<{
    success: boolean;
    stats?: {
      totalLogs: number;
      bySeverity: Record<string, number>;
      byCategory: Record<string, number>;
      recentCritical: number;
    };
    error?: string;
  }> {
    try {
      const stats = {
        totalLogs: mockAuditLogs.length,
        bySeverity: {
          info: mockAuditLogs.filter((l) => l.severity === 'info').length,
          warning: mockAuditLogs.filter((l) => l.severity === 'warning').length,
          critical: mockAuditLogs.filter((l) => l.severity === 'critical').length,
        },
        byCategory: {
          user: mockAuditLogs.filter((l) => l.category === 'user').length,
          bounty: mockAuditLogs.filter((l) => l.category === 'bounty').length,
          payment: mockAuditLogs.filter((l) => l.category === 'payment').length,
          moderation: mockAuditLogs.filter((l) => l.category === 'moderation').length,
          system: mockAuditLogs.filter((l) => l.category === 'system').length,
          security: mockAuditLogs.filter((l) => l.category === 'security').length,
        },
        recentCritical: mockAuditLogs.filter(
          (l) =>
            l.severity === 'critical' &&
            new Date(l.timestamp).getTime() > Date.now() - 1000 * 60 * 60 * 24
        ).length,
      };

      return simulateNetwork({ success: true, stats });
    } catch (error) {
      console.error('Error fetching audit log stats:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit log stats',
      };
    }
  },

  /**
   * Export audit logs (for compliance/download)
   */
  async exportAuditLogs(
    filters?: AuditLogFilters,
    format: 'json' | 'csv' = 'json'
  ): Promise<{
    success: boolean;
    data?: string;
    error?: string;
  }> {
    try {
      const result = await this.getAuditLogs(filters);

      if (!result.success || !result.logs) {
        return { success: false, error: result.error };
      }

      if (format === 'json') {
        return simulateNetwork({
          success: true,
          data: JSON.stringify(result.logs, null, 2),
        });
      }

      // CSV format
      const headers = [
        'ID',
        'Timestamp',
        'Category',
        'Action',
        'Actor',
        'Description',
        'Severity',
      ].join(',');
      const rows = result.logs.map((log) =>
        [
          log.id,
          log.timestamp,
          log.category,
          log.action,
          log.actorName || '',
          `"${log.description.replace(/"/g, '""')}"`,
          log.severity,
        ].join(',')
      );

      return simulateNetwork({
        success: true,
        data: [headers, ...rows].join('\n'),
      });
    } catch (error) {
      console.error('Error exporting audit logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export audit logs',
      };
    }
  },
};
