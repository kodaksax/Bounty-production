// lib/admin/moderationClient.ts — Bounty Moderation Queue data client
//
// Reads/writes the moderation pipeline added in
// supabase/migrations/20260829120000_bounty_moderation_queue.sql. Every
// admin_moderation_* RPC re-checks `app_metadata.role === 'admin'` server-side
// (via admin_assert_role()), so this client is a convenience layer, not the
// authorization boundary.
//
// The state machine is enforced in Postgres (moderation_transition_allowed());
// `isTransitionAllowed` here only gates which action buttons render.
import { supabase } from '../supabase';
import {
  MODERATION_SIGNAL_LABEL,
  MODERATION_STATE_LABEL,
  MODERATION_TRANSITIONS,
  type AdminModerationAlert,
  type AdminModerationDetail,
  type AdminModerationEvent,
  type AdminModerationMetrics,
  type AdminModerationQueueFilters,
  type AdminModerationQueueRow,
  type AdminModerationRelatedListing,
  type AdminModerationSignal,
  type AdminModerationState,
  type AdminModerationThreshold,
  type ModerationSeverity,
} from '../types-admin';
import type { AdminBountyStatus, AdminUserStatus } from '../types-admin';

// ─── primitives ──────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalString(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value);
}

function unwrap<T>({ data, error }: { data: T; error: { message?: string } | null }): T {
  if (error) throw new Error(error.message ?? 'Moderation query failed');
  return data;
}

const KNOWN_STATES: readonly AdminModerationState[] = [
  'active',
  'flagged',
  'under_review',
  'hidden',
  'removed',
  'approved',
];

function normalizeState(value: unknown): AdminModerationState {
  return (KNOWN_STATES as readonly string[]).includes(value as string)
    ? (value as AdminModerationState)
    : 'active';
}

function normalizeSeverity(value: unknown): ModerationSeverity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

// ─── presentation helpers ────────────────────────────────────────────────

export function signalLabel(type: string): string {
  return MODERATION_SIGNAL_LABEL[type] ?? sentenceCase(type);
}

export function stateLabel(state: AdminModerationState): string {
  return MODERATION_STATE_LABEL[state] ?? sentenceCase(state);
}

function sentenceCase(raw: string): string {
  const s = raw.replace(/[._]/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function severityTone(
  severity: ModerationSeverity
): 'neutral' | 'success' | 'warning' | 'error' {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Whether an admin may move a listing from `from` to `to`. Mirrors
 * moderation_transition_allowed(from, to, 'admin') in the migration; the
 * database call is the real gate.
 */
export function isTransitionAllowed(
  from: AdminModerationState,
  to: AdminModerationState
): boolean {
  if (!KNOWN_STATES.includes(from) || !KNOWN_STATES.includes(to)) return false;
  return (MODERATION_TRANSITIONS[from] ?? []).includes(to);
}

/** The resolution a given target state records, matching the RPC. */
export function classifyResolution(
  to: AdminModerationState
): 'legitimate' | 'suspicious_confirmed' | undefined {
  if (to === 'approved') return 'legitimate';
  if (to === 'hidden' || to === 'removed') return 'suspicious_confirmed';
  return undefined;
}

// ─── row mappers (exported for tests) ────────────────────────────────────

export function mapSignal(raw: any): AdminModerationSignal {
  return {
    type: raw?.type ?? raw?.signal_type ?? 'unknown',
    severity: normalizeSeverity(raw?.severity),
    weight: toNumber(raw?.weight),
    source: raw?.source === 'sweep' || raw?.source === 'manual' ? raw.source : 'content',
    evidence: (raw?.evidence ?? {}) as Record<string, unknown>,
    detectedAt: raw?.detected_at ?? raw?.detectedAt ?? new Date().toISOString(),
  };
}

export function mapQueueRow(raw: any): AdminModerationQueueRow {
  return {
    bountyId: raw.bounty_id,
    title: raw.title ?? '',
    amount: optionalNumber(raw.amount),
    isForHonor: raw.is_for_honor === true,
    bountyStatus: (raw.bounty_status ?? 'open') as AdminBountyStatus,
    createdAt: raw.created_at ?? new Date().toISOString(),
    posterId: optionalString(raw.poster_id),
    posterUsername: optionalString(raw.poster_username),
    posterAccountAgeDays: optionalNumber(raw.poster_account_age_days),
    posterAccountStatus: (raw.poster_account_status ?? 'active') as AdminUserStatus,
    posterRiskLevel: raw.poster_risk_level ?? 'low',
    applications: toNumber(raw.applications),
    applicationVelocity: toNumber(raw.application_velocity),
    relatedListings: toNumber(raw.related_listings),
    state: normalizeState(raw.state),
    signalScore: toNumber(raw.signal_score),
    autoFlagged: raw.auto_flagged === true,
    flaggedAt: optionalString(raw.flagged_at),
    flaggedReason: optionalString(raw.flagged_reason),
    resolution:
      raw.resolution === 'legitimate' || raw.resolution === 'suspicious_confirmed'
        ? raw.resolution
        : undefined,
    updatedAt: raw.updated_at ?? new Date().toISOString(),
    signals: Array.isArray(raw.signals) ? raw.signals.map(mapSignal) : [],
  };
}

export function mapEvent(raw: any): AdminModerationEvent {
  return {
    id: raw.id,
    bountyId: raw.bounty_id,
    fromState: raw.from_state ? normalizeState(raw.from_state) : undefined,
    toState: normalizeState(raw.to_state),
    actor: raw.actor === 'admin' ? 'admin' : 'system',
    actorId: optionalString(raw.actor_id),
    reason: optionalString(raw.reason),
    notes: optionalString(raw.notes),
    createdAt: raw.created_at ?? new Date().toISOString(),
  };
}

function mapRelatedListing(raw: any): AdminModerationRelatedListing {
  return {
    id: raw.id,
    title: raw.title ?? '',
    amount: optionalNumber(raw.amount),
    status: (raw.status ?? 'open') as AdminBountyStatus,
    createdAt: raw.created_at ?? new Date().toISOString(),
  };
}

export function mapDetail(json: any): AdminModerationDetail | null {
  if (!json?.bounty?.id) return null;
  const b = json.bounty;
  const p = json.poster;
  const m = json.moderation ?? {};
  const apps = json.applications ?? {};
  return {
    bounty: {
      id: b.id,
      title: b.title ?? '',
      description: optionalString(b.description),
      amount: optionalNumber(b.amount),
      isForHonor: b.is_for_honor === true,
      category: optionalString(b.category),
      location: optionalString(b.location),
      status: (b.status ?? 'open') as AdminBountyStatus,
      createdAt: b.created_at ?? new Date().toISOString(),
      updatedAt: optionalString(b.updated_at),
      deadline: optionalString(b.deadline),
      hunterId: optionalString(b.hunter_id),
    },
    poster: p
      ? {
          id: p.id,
          username: optionalString(p.username),
          displayName: optionalString(p.display_name),
          accountStatus: (p.account_status ?? 'active') as AdminUserStatus,
          accountRestricted: p.account_restricted === true,
          riskLevel: p.risk_level ?? 'low',
          accountAgeDays: optionalNumber(p.account_age_days),
          createdAt: p.created_at ?? new Date().toISOString(),
        }
      : null,
    moderation: {
      state: normalizeState(m.state),
      signalScore: toNumber(m.signal_score),
      autoFlagged: m.auto_flagged === true,
      flaggedAt: optionalString(m.flagged_at),
      flaggedReason: optionalString(m.flagged_reason),
      reviewStartedAt: optionalString(m.review_started_at),
      reviewedBy: optionalString(m.reviewed_by),
      resolvedAt: optionalString(m.resolved_at),
      resolution:
        m.resolution === 'legitimate' || m.resolution === 'suspicious_confirmed'
          ? m.resolution
          : undefined,
      notes: optionalString(m.notes),
    },
    signals: Array.isArray(json.signals) ? json.signals.map(mapSignal) : [],
    events: Array.isArray(json.events) ? json.events.map(mapEvent) : [],
    applications: {
      total: toNumber(apps.total),
      recent: Array.isArray(apps.recent)
        ? apps.recent.map((r: any) => ({
            id: r.id,
            hunterId: optionalString(r.hunter_id),
            status: r.status ?? 'pending',
            createdAt: r.created_at ?? new Date().toISOString(),
          }))
        : [],
    },
    relatedListings: Array.isArray(json.related_listings)
      ? json.related_listings.map(mapRelatedListing)
      : [],
  };
}

export function mapAlert(raw: any): AdminModerationAlert {
  return {
    id: raw.id,
    alertKey: raw.alert_key ?? '',
    thresholdKey: raw.threshold_key ?? 'unknown',
    bountyId: optionalString(raw.bounty_id),
    posterId: optionalString(raw.poster_id),
    severity: normalizeSeverity(raw.severity),
    summary: raw.summary ?? '',
    detail: (raw.detail ?? {}) as Record<string, unknown>,
    createdAt: raw.created_at ?? new Date().toISOString(),
    acknowledgedAt: optionalString(raw.acknowledged_at),
    acknowledgedBy: optionalString(raw.acknowledged_by),
  };
}

export function mapThreshold(raw: any): AdminModerationThreshold {
  return {
    key: raw.key,
    description: raw.description ?? '',
    comparator: raw.comparator ?? 'gte',
    thresholdValue: toNumber(raw.threshold_value),
    windowMinutes: optionalNumber(raw.window_minutes),
    severity: normalizeSeverity(raw.severity),
    enabled: raw.enabled !== false,
    updatedBy: optionalString(raw.updated_by),
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  };
}

export function mapMetrics(raw: any): AdminModerationMetrics {
  const r = raw ?? {};
  return {
    generatedAt: r.generated_at ?? new Date().toISOString(),
    byState: (r.by_state ?? {}) as Partial<Record<AdminModerationState, number>>,
    openQueue: toNumber(r.open_queue),
    autoFlagged: toNumber(r.auto_flagged),
    resolvedLegitimate: toNumber(r.resolved_legitimate),
    resolvedSuspicious: toNumber(r.resolved_suspicious),
    legitimateDemand: toNumber(r.legitimate_demand),
    suspiciousDemand: toNumber(r.suspicious_demand),
    unacknowledgedAlerts: toNumber(r.unacknowledged_alerts),
    lastSweepAt: optionalString(r.last_sweep_at),
  };
}

// ─── client ──────────────────────────────────────────────────────────────

export interface ModerationQueuePage {
  rows: AdminModerationQueueRow[];
  total: number;
  hasMore: boolean;
}

export const moderationClient = {
  async fetchQueue(filters: AdminModerationQueueFilters = {}): Promise<ModerationQueuePage> {
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;
    const data = unwrap(
      await supabase.rpc('admin_moderation_queue', {
        p_state: filters.state ?? null,
        p_limit: limit,
        p_offset: offset,
      })
    );
    const raw = (data ?? []) as any[];
    const rows = raw.map(mapQueueRow);
    const total = raw.length > 0 ? toNumber(raw[0].total_count) : 0;
    return { rows, total, hasMore: offset + rows.length < total };
  },

  async fetchDetail(bountyId: string): Promise<AdminModerationDetail | null> {
    const data = unwrap(
      await supabase.rpc('admin_moderation_detail', { p_bounty_id: bountyId })
    );
    return mapDetail(data);
  },

  /** The only path to hide/remove/approve. `reason` is required by the RPC. */
  async transition(
    bountyId: string,
    newState: AdminModerationState,
    reason: string,
    notes?: string
  ): Promise<{ fromState: AdminModerationState; toState: AdminModerationState; bountyStatus: string }> {
    const data = unwrap(
      await supabase.rpc('admin_moderation_transition', {
        p_bounty_id: bountyId,
        p_new_state: newState,
        p_reason: reason,
        p_notes: notes ?? null,
      })
    ) as any;
    return {
      fromState: normalizeState(data?.from_state),
      toState: normalizeState(data?.to_state),
      bountyStatus: data?.bounty_status ?? 'unknown',
    };
  },

  async fetchAlerts(includeAcked = false, limit = 100): Promise<AdminModerationAlert[]> {
    const data = unwrap(
      await supabase.rpc('admin_moderation_alerts', {
        p_include_acked: includeAcked,
        p_limit: limit,
      })
    );
    return ((data ?? []) as any[]).map(mapAlert);
  },

  async acknowledgeAlert(id: string): Promise<AdminModerationAlert> {
    const data = unwrap(
      await supabase.rpc('admin_acknowledge_moderation_alert', { p_id: id })
    );
    return mapAlert(data);
  },

  async fetchThresholds(): Promise<AdminModerationThreshold[]> {
    const data = unwrap(await supabase.rpc('admin_moderation_thresholds', {}));
    return ((data ?? []) as any[]).map(mapThreshold);
  },

  async updateThreshold(
    key: string,
    patch: { thresholdValue?: number; windowMinutes?: number; enabled?: boolean }
  ): Promise<AdminModerationThreshold> {
    const data = unwrap(
      await supabase.rpc('admin_update_moderation_threshold', {
        p_key: key,
        p_threshold_value: patch.thresholdValue ?? null,
        p_window_minutes: patch.windowMinutes ?? null,
        p_enabled: patch.enabled ?? null,
      })
    );
    return mapThreshold(data);
  },

  async fetchMetrics(): Promise<AdminModerationMetrics> {
    const data = unwrap(await supabase.rpc('admin_moderation_metrics', {}));
    return mapMetrics(data);
  },
};

// Exported for unit tests: the pure logic that decides what the operator reads
// and which actions are offered.
export const __moderationInternals = {
  mapQueueRow,
  mapDetail,
  mapEvent,
  mapAlert,
  mapThreshold,
  mapMetrics,
  mapSignal,
  signalLabel,
  stateLabel,
  severityTone,
  isTransitionAllowed,
  classifyResolution,
  normalizeState,
  normalizeSeverity,
};
