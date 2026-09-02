// Tests for the admin audit log service.
//
// Context: this service used to carry a `mockAuditLogs` array of eight
// fabricated entries ("User @spammer suspended for policy violations",
// "Escrow released for bounty completion: $250.00", a login from
// 192.168.1.100) and serve them for every category. A later change merged real
// account-status rows into the `user` category but left the fabricated rows
// alongside them, so the audit viewer interleaved real and invented history
// with nothing to tell them apart.
//
// The properties pinned here: no entry is ever synthesised, and a source that
// cannot be read is reported rather than being indistinguishable from a source
// with nothing in it.

const tableData: Record<string, { data: unknown[] | null; error: unknown }> = {};

function chain(table: string) {
  const result = tableData[table] ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'gte', 'in']) {
    builder[method] = jest.fn(() => builder);
  }
  // Terminal: awaiting the builder resolves the query.
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => chain(table)),
    functions: { invoke: jest.fn() },
  },
  isSupabaseConfigured: true,
}));

import { auditLogService } from '../../lib/services/audit-log-service';

const NOW = new Date().toISOString();

beforeEach(() => {
  for (const key of Object.keys(tableData)) delete tableData[key];
  // Default: every source readable and empty.
  tableData.admin_action_log = { data: [], error: null };
  tableData.dispute_audit_log = { data: [], error: null };
  tableData.admin_warnings = { data: [], error: null };
  tableData.payout_audit_log = { data: [], error: null };
  jest.clearAllMocks();
});

describe('auditLogService.getAuditLogs', () => {
  test('returns nothing when every source is empty — no fabricated entries', async () => {
    // The regression this file exists for: the old implementation returned
    // eight invented rows here.
    const result = await auditLogService.getAuditLogs();
    expect(result.success).toBe(true);
    expect(result.logs).toEqual([]);
    expect(result.unavailableSources).toEqual([]);
  });

  test('maps a real account status change from admin_action_log', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'aal-1',
          admin_user_id: 'admin-1',
          action_type: 'account_status_change',
          target_user_id: 'user-1',
          reason: 'Spam',
          result: 'success',
          metadata: { old_status: 'active', new_status: 'banned' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    const { logs } = await auditLogService.getAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs![0]).toMatchObject({
      id: 'admin-action-aal-1',
      category: 'user',
      action: 'banned',
      severity: 'critical',
      actorId: 'admin-1',
      targetId: 'user-1',
    });
    expect(logs![0].description).toContain('active to banned');
    expect(logs![0].description).toContain('Spam');
  });

  test('a failed admin action is recorded as critical and labelled as failed', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'aal-2',
          admin_user_id: 'admin-1',
          action_type: 'account_status_change',
          target_user_id: 'user-1',
          reason: 'Fraud',
          result: 'failure',
          metadata: { old_status: 'active', new_status: 'suspended' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    const { logs } = await auditLogService.getAuditLogs();
    expect(logs![0].severity).toBe('critical');
    expect(logs![0].description).toContain('Failed attempt');
  });

  test('reports a source that could not be read instead of implying no activity', async () => {
    tableData.dispute_audit_log = { data: null, error: { message: 'permission denied' } };
    const result = await auditLogService.getAuditLogs();

    expect(result.success).toBe(true);
    expect(result.unavailableSources).toContain('dispute_audit_log');
  });

  test('merges sources and sorts newest first', async () => {
    const older = new Date(Date.now() - 3600_000).toISOString();
    tableData.admin_action_log = {
      data: [
        {
          id: 'a',
          admin_user_id: 'admin',
          action_type: 'account_status_change',
          target_user_id: 'u',
          reason: 'r',
          result: 'success',
          metadata: { new_status: 'suspended' },
          created_at: older,
        },
      ],
      error: null,
    };
    tableData.payout_audit_log = {
      data: [
        {
          id: 'p',
          user_id: 'u',
          event: 'payout_failed',
          amount_cents: 5000,
          currency: 'usd',
          error_code: 'card_declined',
          created_at: NOW,
        },
      ],
      error: null,
    };

    const { logs } = await auditLogService.getAuditLogs();
    expect(logs!.map((l) => l.id)).toEqual(['payout-audit-p', 'admin-action-a']);
    expect(logs![0]).toMatchObject({ category: 'payment', severity: 'critical' });
    expect(logs![0].description).toContain('50.00 USD');
  });

  test('a category filter restricts the result set', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'a',
          admin_user_id: 'admin',
          action_type: 'account_status_change',
          target_user_id: 'u',
          reason: 'r',
          result: 'success',
          metadata: { new_status: 'suspended' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    const userOnly = await auditLogService.getAuditLogs({ category: 'user' });
    expect(userOnly.logs).toHaveLength(1);

    const paymentOnly = await auditLogService.getAuditLogs({ category: 'payment' });
    expect(paymentOnly.logs).toEqual([]);
  });

  test('search matches the description, actor and target', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'a',
          admin_user_id: 'admin-abc',
          action_type: 'account_status_change',
          target_user_id: 'target-xyz',
          reason: 'Harassment',
          result: 'success',
          metadata: { new_status: 'banned' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    expect((await auditLogService.getAuditLogs({ searchQuery: 'harassment' })).logs).toHaveLength(1);
    expect((await auditLogService.getAuditLogs({ searchQuery: 'target-xyz' })).logs).toHaveLength(1);
    expect((await auditLogService.getAuditLogs({ searchQuery: 'nothing here' })).logs).toEqual([]);
  });
});

describe('auditLogService.getAuditLogStats', () => {
  test('counts nothing when there is nothing recorded', async () => {
    const { stats } = await auditLogService.getAuditLogStats();
    expect(stats).toMatchObject({
      totalLogs: 0,
      bySeverity: { info: 0, warning: 0, critical: 0 },
      recentCritical: 0,
    });
  });

  test('counts a real critical entry from the last day', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'a',
          admin_user_id: 'admin',
          action_type: 'account_status_change',
          target_user_id: 'u',
          reason: 'r',
          result: 'success',
          metadata: { new_status: 'banned' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    const { stats } = await auditLogService.getAuditLogStats();
    expect(stats!.totalLogs).toBe(1);
    expect(stats!.bySeverity.critical).toBe(1);
    expect(stats!.byCategory.user).toBe(1);
    expect(stats!.recentCritical).toBe(1);
  });
});

describe('auditLogService.exportAuditLogs', () => {
  test('CSV escapes a description containing a comma and a quote', async () => {
    tableData.admin_action_log = {
      data: [
        {
          id: 'a',
          admin_user_id: 'admin',
          action_type: 'account_status_change',
          target_user_id: 'u',
          reason: 'Spam, and "abuse"',
          result: 'success',
          metadata: { old_status: 'active', new_status: 'banned' },
          created_at: NOW,
        },
      ],
      error: null,
    };

    const { success, data } = await auditLogService.exportAuditLogs(undefined, 'csv');
    expect(success).toBe(true);
    // The description column must be quoted with doubled inner quotes, or the
    // export silently shifts every following column.
    expect(data).toContain('"Account status changed from active to banned: Spam, and ""abuse"""');
    expect(data!.split('\n')).toHaveLength(2);
  });
});
