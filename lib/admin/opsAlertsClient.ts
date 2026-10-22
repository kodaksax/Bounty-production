// Open operator alerts (job health, edge auth/5xx) and the two things a person
// does with them. Backed by public.ops_alerts and admin_ack_ops_alert() /
// admin_resolve_ops_alert() from
// supabase/migrations/20261021230000_admin_alert_routing.sql.
//
// An alert stays open until someone resolves it. Acknowledging silences the
// 24h reminder for 24h; resolving closes it, and if the cause is still there
// the next 5-minute check opens a new one.
import { supabase } from '../supabase';

export interface OpsAlert {
  id: string;
  alertKey: string;
  severity: string;
  summary: string;
  openedAt: string;
  lastSeenAt: string;
  /** Set while the condition is healthy again but nobody has resolved it. */
  clearedAt: string | null;
  acknowledgedAt: string | null;
  occurrences: number;
  /** `detail.cause.kind` for edge-auth-or-5xx: auth | 5xx | transport | mixed. */
  causeKind: string | null;
}

function toOpsAlert(row: Record<string, any>): OpsAlert {
  const cause = row.detail?.cause;
  return {
    id: row.id,
    alertKey: row.alert_key,
    severity: row.severity ?? 'critical',
    summary: row.summary ?? '',
    openedAt: row.opened_at,
    lastSeenAt: row.last_seen_at,
    clearedAt: row.cleared_at ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    occurrences: typeof row.occurrences === 'number' ? row.occurrences : 1,
    causeKind: typeof cause?.kind === 'string' ? cause.kind : null,
  };
}

export async function fetchOpenOpsAlerts(): Promise<OpsAlert[]> {
  const { data, error } = await supabase
    .from('ops_alerts')
    .select('*')
    .is('resolved_at', null)
    .order('opened_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toOpsAlert);
}

export async function acknowledgeOpsAlert(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_ack_ops_alert', { p_alert_id: id });
  if (error) throw new Error(error.message);
}

export async function resolveOpsAlert(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_ops_alert', { p_alert_id: id, p_note: note });
  if (error) throw new Error(error.message);
}
