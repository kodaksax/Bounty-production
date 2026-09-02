/**
 * Audit Log Service
 *
 * Provides the audit trail behind app/(admin)/audit-logs.tsx.
 *
 * This file previously carried a `mockAuditLogs` array of eight fabricated
 * entries ("User @spammer suspended for policy violations", "Escrow released
 * for bounty completion: $250.00", a login from 192.168.1.100) and served them
 * for every category. A later change merged real account-status entries into
 * the `user` category but left the fabricated rows in place alongside them, so
 * the audit viewer showed real and invented history interleaved with no way to
 * tell them apart — the worst possible state for a compliance surface.
 *
 * Every entry now comes from a real table:
 *
 *   admin_action_log     -> user       (suspend / ban / restore, withdrawal ops)
 *   dispute_audit_log    -> moderation (dispute lifecycle)
 *   admin_warnings       -> moderation (guideline warnings issued)
 *   payout_audit_log     -> payment    (payout decisions and failures)
 *
 * Categories with no backing table return nothing rather than filler. A table
 * that cannot be read (RLS, or absent in a given environment) is reported via
 * `unavailableSources` so the screen can say so instead of implying the
 * platform had no activity.
 */

import { supabase } from '../supabase';
import type { AuditLogEntry, AuditLogFilters } from '../types-admin';

/** How many rows to pull per source. */
const PER_SOURCE_LIMIT = 200;

type Severity = AuditLogEntry['severity'];

interface SourceResult {
  entries: AuditLogEntry[];
  /** Set when the source could not be read at all. */
  unavailable?: string;
}

/* ─────────────────────────── Sources ─────────────────────────── */

type AdminActionLogRow = {
  id: string;
  admin_user_id: string | null;
  action_type: string | null;
  target_user_id: string | null;
  target_transaction_id: string | null;
  amount: number | string | null;
  reason: string | null;
  result: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * admin_action_log covers both account-status changes and the
 * withdrawal-recovery operations (force-retry, manual balance adjustment)
 * written by the admin-withdrawals Edge Function.
 */
async function fetchAdminActionLog(): Promise<SourceResult> {
  try {
    const { data, error } = await supabase
      .from('admin_action_log')
      .select(
        'id, admin_user_id, action_type, target_user_id, target_transaction_id, amount, reason, result, metadata, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT);
    if (error) throw error;

    const entries = ((data ?? []) as AdminActionLogRow[]).map((row): AuditLogEntry => {
      const failed = row.result === 'failure';
      const newStatus = row.metadata?.new_status as string | undefined;
      const oldStatus = (row.metadata?.old_status as string | undefined) ?? 'active';
      const isStatusChange = row.action_type === 'account_status_change';

      const action: AuditLogEntry['action'] = isStatusChange
        ? newStatus === 'active'
          ? 'restored'
          : newStatus === 'banned'
            ? 'banned'
            : 'suspended'
        : 'updated';

      let severity: Severity = 'info';
      if (failed) severity = 'critical';
      else if (newStatus === 'banned') severity = 'critical';
      else if (newStatus === 'suspended') severity = 'warning';
      else if (!isStatusChange) severity = 'warning';

      const description = isStatusChange
        ? failed
          ? `Failed attempt to change account status (${oldStatus} → ${newStatus}): ${row.reason ?? 'no reason given'}`
          : `Account status changed from ${oldStatus} to ${newStatus}: ${row.reason ?? 'no reason given'}`
        : `${(row.action_type ?? 'admin action').replace(/_/g, ' ')}${
            row.amount != null ? ` (${row.amount})` : ''
          }: ${row.reason ?? 'no reason given'}${failed ? ' — FAILED' : ''}`;

      return {
        id: `admin-action-${row.id}`,
        timestamp: row.created_at,
        category: 'user',
        action,
        actorId: row.admin_user_id ?? undefined,
        targetId: row.target_user_id ?? row.target_transaction_id ?? undefined,
        targetType: row.target_user_id ? 'user' : 'transaction',
        description,
        severity,
        metadata: { ...(row.metadata ?? {}), result: row.result, action_type: row.action_type },
      };
    });

    return { entries };
  } catch (error) {
    console.error('[audit-log] admin_action_log unavailable', error);
    return { entries: [], unavailable: 'admin_action_log' };
  }
}

type DisputeAuditRow = {
  id: string | number;
  dispute_id: string | number | null;
  action: string | null;
  actor_id: string | null;
  actor_type: string | null;
  details: unknown;
  created_at: string;
};

async function fetchDisputeAuditLog(): Promise<SourceResult> {
  try {
    const { data, error } = await supabase
      .from('dispute_audit_log')
      .select('id, dispute_id, action, actor_id, actor_type, details, created_at')
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT);
    if (error) throw error;

    const entries = ((data ?? []) as DisputeAuditRow[]).map((row): AuditLogEntry => {
      const action = row.action ?? 'updated';
      const severity: Severity =
        action.includes('escalat') || action.includes('reject')
          ? 'critical'
          : action.includes('resolv') || action.includes('close')
            ? 'info'
            : 'warning';
      return {
        id: `dispute-audit-${row.id}`,
        timestamp: row.created_at,
        category: 'moderation',
        action: 'updated',
        actorId: row.actor_id ?? undefined,
        actorName: row.actor_type ?? undefined,
        targetId: row.dispute_id != null ? String(row.dispute_id) : undefined,
        targetType: 'report',
        description: `Dispute ${row.dispute_id ?? ''}: ${action.replace(/_/g, ' ')}`.trim(),
        severity,
        metadata: typeof row.details === 'object' && row.details ? (row.details as Record<string, unknown>) : undefined,
      };
    });

    return { entries };
  } catch (error) {
    console.error('[audit-log] dispute_audit_log unavailable', error);
    return { entries: [], unavailable: 'dispute_audit_log' };
  }
}

type AdminWarningRow = {
  id: string;
  admin_id: string | null;
  user_id: string | null;
  bounty_id: string | null;
  violation_type: string | null;
  message: string | null;
  created_at: string;
};

async function fetchAdminWarnings(): Promise<SourceResult> {
  try {
    const { data, error } = await supabase
      .from('admin_warnings')
      .select('id, admin_id, user_id, bounty_id, violation_type, message, created_at')
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT);
    if (error) throw error;

    const entries = ((data ?? []) as AdminWarningRow[]).map((row): AuditLogEntry => ({
      id: `warning-${row.id}`,
      timestamp: row.created_at,
      category: 'moderation',
      action: 'content_flagged',
      actorId: row.admin_id ?? undefined,
      targetId: row.user_id ?? undefined,
      targetType: 'user',
      description: `Warning issued (${(row.violation_type ?? 'other').replace(/_/g, ' ')})`,
      severity: 'warning',
      metadata: { bountyId: row.bounty_id, message: row.message },
    }));

    return { entries };
  } catch (error) {
    console.error('[audit-log] admin_warnings unavailable', error);
    return { entries: [], unavailable: 'admin_warnings' };
  }
}

type PayoutAuditRow = {
  id: string;
  user_id: string | null;
  event: string | null;
  payout_method: string | null;
  amount_cents: number | null;
  currency: string | null;
  stripe_payout_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

async function fetchPayoutAuditLog(): Promise<SourceResult> {
  try {
    const { data, error } = await supabase
      .from('payout_audit_log')
      .select(
        'id, user_id, event, payout_method, amount_cents, currency, stripe_payout_id, error_code, error_message, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT);
    if (error) throw error;

    const entries = ((data ?? []) as PayoutAuditRow[]).map((row): AuditLogEntry => {
      const failed = !!row.error_code || (row.event ?? '').includes('fail');
      const amount =
        row.amount_cents != null
          ? `${(row.amount_cents / 100).toFixed(2)} ${(row.currency ?? 'usd').toUpperCase()}`
          : null;
      return {
        id: `payout-audit-${row.id}`,
        timestamp: row.created_at,
        category: 'payment',
        action: failed ? 'payment_failed' : 'payment_completed',
        actorId: row.user_id ?? undefined,
        targetId: row.stripe_payout_id ?? undefined,
        targetType: 'transaction',
        description: [
          (row.event ?? 'payout').replace(/_/g, ' '),
          amount,
          row.payout_method ? `via ${row.payout_method}` : null,
          row.error_message,
        ]
          .filter(Boolean)
          .join(' · '),
        severity: failed ? 'critical' : 'info',
        metadata: { errorCode: row.error_code, payoutMethod: row.payout_method },
      };
    });

    return { entries };
  } catch (error) {
    console.error('[audit-log] payout_audit_log unavailable', error);
    return { entries: [], unavailable: 'payout_audit_log' };
  }
}

/** Which sources contribute to which category, so a filtered read skips the rest. */
const SOURCES: { category: AuditLogEntry['category']; fetch: () => Promise<SourceResult> }[] = [
  { category: 'user', fetch: fetchAdminActionLog },
  { category: 'moderation', fetch: fetchDisputeAuditLog },
  { category: 'moderation', fetch: fetchAdminWarnings },
  { category: 'payment', fetch: fetchPayoutAuditLog },
];

async function loadEntries(
  category?: AuditLogFilters['category']
): Promise<{ entries: AuditLogEntry[]; unavailableSources: string[] }> {
  const wanted =
    !category || category === 'all' ? SOURCES : SOURCES.filter((s) => s.category === category);

  const results = await Promise.all(wanted.map((s) => s.fetch()));
  const entries = results.flatMap((r) => r.entries);
  const unavailableSources = results
    .map((r) => r.unavailable)
    .filter((s): s is string => typeof s === 'string');

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { entries, unavailableSources };
}

function applyFilters(entries: AuditLogEntry[], filters?: AuditLogFilters): AuditLogEntry[] {
  let out = entries;

  if (filters?.category && filters.category !== 'all') {
    out = out.filter((log) => log.category === filters.category);
  }
  if (filters?.severity && filters.severity !== 'all') {
    out = out.filter((log) => log.severity === filters.severity);
  }
  if (filters?.startDate) {
    const start = new Date(filters.startDate).getTime();
    out = out.filter((log) => new Date(log.timestamp).getTime() >= start);
  }
  if (filters?.endDate) {
    const end = new Date(filters.endDate).getTime();
    out = out.filter((log) => new Date(log.timestamp).getTime() <= end);
  }
  if (filters?.searchQuery) {
    const q = filters.searchQuery.toLowerCase();
    out = out.filter(
      (log) =>
        log.description.toLowerCase().includes(q) ||
        log.actorName?.toLowerCase().includes(q) ||
        log.actorId?.toLowerCase().includes(q) ||
        log.targetId?.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q)
    );
  }
  if (filters?.actorId) {
    out = out.filter((log) => log.actorId === filters.actorId);
  }

  return out;
}

export const auditLogService = {
  /**
   * Fetch audit logs with filtering.
   *
   * `unavailableSources` names any audit table that could not be read, so the
   * caller can distinguish "no activity" from "could not look".
   */
  async getAuditLogs(filters?: AuditLogFilters): Promise<{
    success: boolean;
    logs?: AuditLogEntry[];
    totalCount?: number;
    unavailableSources?: string[];
    error?: string;
  }> {
    try {
      const { entries, unavailableSources } = await loadEntries(filters?.category);
      const logs = applyFilters(entries, filters);
      return { success: true, logs, totalCount: logs.length, unavailableSources };
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit logs',
      };
    }
  },

  /**
   * Get a single audit log entry by ID.
   *
   * Entry ids are synthesised per source (`admin-action-<uuid>` etc.), so this
   * reloads and scans rather than hitting one table by primary key.
   */
  async getAuditLogById(id: string): Promise<{
    success: boolean;
    log?: AuditLogEntry;
    error?: string;
  }> {
    try {
      const { entries } = await loadEntries();
      const log = entries.find((l) => l.id === id);
      if (!log) return { success: false, error: 'Audit log entry not found' };
      return { success: true, log };
    } catch (error) {
      console.error('Error fetching audit log:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit log',
      };
    }
  },

  /** Aggregate counts for the audit screen's header. */
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
      const { entries } = await loadEntries();
      const dayAgo = Date.now() - 86_400_000;

      const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
      const byCategory: Record<string, number> = {
        user: 0,
        bounty: 0,
        payment: 0,
        moderation: 0,
        system: 0,
        security: 0,
      };
      let recentCritical = 0;

      for (const entry of entries) {
        bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
        byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
        if (entry.severity === 'critical' && new Date(entry.timestamp).getTime() > dayAgo) {
          recentCritical += 1;
        }
      }

      return {
        success: true,
        stats: { totalLogs: entries.length, bySeverity, byCategory, recentCritical },
      };
    } catch (error) {
      console.error('Error fetching audit log stats:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch audit log stats',
      };
    }
  },

  /** Export audit logs (for compliance/download). */
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
        return { success: true, data: JSON.stringify(result.logs, null, 2) };
      }

      const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const headers = ['ID', 'Timestamp', 'Category', 'Action', 'Actor', 'Target', 'Description', 'Severity'].join(',');
      const rows = result.logs.map((log) =>
        [
          log.id,
          log.timestamp,
          log.category,
          log.action,
          log.actorName || log.actorId || '',
          log.targetId || '',
          escape(log.description),
          log.severity,
        ].join(',')
      );

      return { success: true, data: [headers, ...rows].join('\n') };
    } catch (error) {
      console.error('Error exporting audit logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export audit logs',
      };
    }
  },
};
