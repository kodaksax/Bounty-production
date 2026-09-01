// lib/admin/commandCenterClient.ts — Founder Command Center data client
//
// Reads the canonical event ledger (public.bounty_events) and the admin_* RPCs
// added in 20260828130000_bounty_events_command_center.sql. Every one of those
// functions re-checks `app_metadata.role === 'admin'` server-side, so this
// client is a convenience layer, not the authorization boundary.
//
// The one rule this file exists to enforce on the UI side: our own ledger
// saying money moved is NOT Stripe saying money moved. Anything derived from
// `source === 'app'` is labelled as recorded/asserted; only `source ===
// 'webhook'` is labelled confirmed. See `eventLabel` and `financialStatusMeta`.
import { supabase } from '../supabase';
import {
  ADMIN_EVENT_SOURCES,
  type AdminAnomaly,
  type AdminAnomalySeverity,
  type AdminBountyFinancialSummary,
  type AdminBountyStatus,
  type AdminCommandBountyDetail,
  type AdminEventSource,
  type AdminFeedFilters,
  type AdminFinancialStatus,
  type AdminLedgerEvent,
  type AdminMarketplaceOverview,
  type AdminSuspiciousApplication,
  type AdminSuspiciousListing,
} from '../types-admin';

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Unknown provenance is treated as `inferred`, never as `webhook`. Failing
 * open here would let an unrecognised row render as "Stripe confirmed".
 */
export function normalizeSource(value: unknown): AdminEventSource {
  return (ADMIN_EVENT_SOURCES as readonly string[]).includes(value as string)
    ? (value as AdminEventSource)
    : 'inferred';
}

/** Only a signature-verified Stripe webhook counts as confirmation. */
export function isStripeConfirmation(event: { source: AdminEventSource }): boolean {
  return event.source === 'webhook';
}

// ─── Event vocabulary ─────────────────────────────────────────────────────
// Wording is deliberately different for app-recorded money events and
// Stripe-confirmed ones. "Release initiated" and "Transfer created" are not
// interchangeable, and a founder skimming a feed must not have to check a
// badge to tell them apart.
const EVENT_LABELS: Record<string, string> = {
  'bounty.posted': 'Bounty posted',
  'bounty.accepted': 'Bounty accepted',
  'bounty.in_progress': 'Work started',
  'bounty.completed': 'Bounty completed',
  'bounty.cancelled': 'Bounty cancelled',
  'bounty.status_changed': 'Bounty status changed',
  'bounty.flagged_stale': 'Bounty flagged stale',
  'application.submitted': 'Application received',
  'application.accepted': 'Application accepted',
  'application.rejected': 'Application rejected',
  'completion.submitted': 'Work submitted',
  'completion.approved': 'Work approved',
  'completion.rejected': 'Work rejected',
  'completion.revision_requested': 'Revision requested',
  'payment.escrow_funded': 'Escrow funded (recorded)',
  'payment.released': 'Release initiated (recorded)',
  'payment.refunded': 'Refund recorded',
  'payment.deposit': 'Deposit recorded',
  'payment.dispute_loss': 'Dispute loss booked',
  'payment.adjustment': 'Manual adjustment',
  'payout.pending': 'Payout requested',
  'payout.completed': 'Payout marked complete (recorded)',
  'payout.failed': 'Payout failed',
  'payout.manually_paid': 'Payout settled manually',
  'dispute.opened': 'Dispute opened',
  'moderation.report_filed': 'Report filed',
  'stripe.payment_intent.succeeded': 'Payment succeeded',
  'stripe.payment_intent.payment_failed': 'Payment failed',
  'stripe.charge.succeeded': 'Charge succeeded',
  'stripe.charge.refunded': 'Charge refunded',
  'stripe.transfer.created': 'Transfer created',
  'stripe.transfer.paid': 'Transfer paid',
  'stripe.transfer.failed': 'Transfer failed',
  'stripe.payout.created': 'Payout created',
  'stripe.payout.paid': 'Payout confirmed',
  'stripe.payout.failed': 'Payout failed',
  'stripe.checkout.session.completed': 'Checkout completed',
  'stripe.charge.dispute.created': 'Stripe dispute opened',
};

/** Sentence-cases an unmapped event type rather than showing a raw key. */
function humanizeEventType(eventType: string): string {
  const tail = eventType.startsWith('stripe.') ? eventType.slice('stripe.'.length) : eventType;
  const words = tail.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function eventLabel(event: { eventType: string; source: AdminEventSource }): string {
  return EVENT_LABELS[event.eventType] ?? humanizeEventType(event.eventType);
}

/**
 * The four-way classification the brief asks the timeline to make explicit.
 * `payment.released` from our own ledger is an APP EVENT, not a Stripe one —
 * the source column decides, never the event name.
 */
export function eventClassification(event: { source: AdminEventSource }): {
  source: AdminEventSource;
  label: string;
  confirmed: boolean;
} {
  const source = normalizeSource(event.source);
  const label =
    source === 'webhook'
      ? 'WEBHOOK CONFIRMATION'
      : source === 'stripe'
        ? 'STRIPE EVENT'
        : source === 'inferred'
          ? 'INFERRED STATE'
          : source === 'system'
            ? 'SYSTEM EVENT'
            : 'APP EVENT';
  return { source, label, confirmed: source === 'webhook' };
}

// ─── Financial status presentation ────────────────────────────────────────
const FINANCIAL_STATUS_META: Record<
  AdminFinancialStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'error'; explanation: string }
> = {
  not_applicable: {
    label: 'No money involved',
    tone: 'neutral',
    explanation: 'Honor bounty or zero amount — there is nothing to settle.',
  },
  unfunded: {
    label: 'Unfunded',
    tone: 'neutral',
    explanation: 'No escrow has been taken for this bounty yet.',
  },
  escrow_held: {
    label: 'Escrow held',
    tone: 'warning',
    explanation: 'Funds are held against this bounty and have not been released or refunded.',
  },
  release_pending: {
    label: 'Release pending',
    tone: 'warning',
    explanation: 'The bounty is complete and escrow is still held — the release has not been booked.',
  },
  released_unverified: {
    label: 'Released — verification pending',
    tone: 'warning',
    explanation:
      'Our ledger records the release, but Stripe has never confirmed it. Do not treat this as a settled payment.',
  },
  released_verified: {
    label: 'Released — Stripe confirmed',
    tone: 'success',
    explanation: 'A signature-verified Stripe event confirms the money moved.',
  },
  refunded: {
    label: 'Refunded',
    tone: 'neutral',
    explanation: 'Escrow was returned to the poster.',
  },
  completed_unfunded: {
    label: 'Completed with no financial record',
    tone: 'error',
    explanation: 'The bounty is marked complete but no escrow, release or payment record exists.',
  },
};

export function financialStatusMeta(status: AdminFinancialStatus | string) {
  return (
    FINANCIAL_STATUS_META[status as AdminFinancialStatus] ?? {
      label: humanizeEventType(String(status)),
      tone: 'neutral' as const,
      explanation: 'Unrecognised financial status.',
    }
  );
}

/**
 * True when the marketplace says "done" but the money has not been confirmed.
 * This is the headline state the brief calls out: COMPLETED + FINANCIAL
 * VERIFICATION PENDING.
 */
export function isCompletedButUnverified(
  financial: Pick<AdminBountyFinancialSummary, 'marketplaceStatus' | 'financialStatus' | 'stripeConfirmed'> | null
): boolean {
  if (!financial) return false;
  return financial.marketplaceStatus === 'completed' && !financial.stripeConfirmed;
}

const SEVERITY_ORDER: Record<AdminAnomalySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function compareSeverity(a: AdminAnomalySeverity, b: AdminAnomalySeverity): number {
  return (SEVERITY_ORDER[a] ?? 9) - (SEVERITY_ORDER[b] ?? 9);
}

function normalizeSeverity(value: unknown): AdminAnomalySeverity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

// ─── Row mappers (exported for tests) ─────────────────────────────────────

export function mapOverview(row: any): AdminMarketplaceOverview {
  const r = row ?? {};
  return {
    since: r.since ?? new Date(0).toISOString(),
    generatedAt: r.generated_at ?? new Date().toISOString(),
    newBounties: toNumber(r.new_bounties),
    newPosters: toNumber(r.new_posters),
    newHunters: toNumber(r.new_hunters),
    newSignups: toNumber(r.new_signups),
    applications: toNumber(r.applications),
    accepts: toNumber(r.accepts),
    completions: toNumber(r.completions),
    completedGmv: toNumber(r.completed_gmv),
    verifiedGmv: toNumber(r.verified_gmv),
    completedGmvLifetime: toNumber(r.completed_gmv_lifetime),
    verifiedGmvLifetime: toNumber(r.verified_gmv_lifetime),
    escrowHeld: toNumber(r.escrow_held),
    pendingFinancialEvents: toNumber(r.pending_financial_events),
    unverifiedCompletions: toNumber(r.unverified_completions),
    payoutFailures: toNumber(r.payout_failures),
    payoutFailuresLifetime: toNumber(r.payout_failures_lifetime),
    suspiciousListings: toNumber(r.suspicious_listings),
    suspiciousApplications: toNumber(r.suspicious_applications),
    openDisputes: toNumber(r.open_disputes),
    pendingReports: toNumber(r.pending_reports),
    pendingWithdrawals: toNumber(r.pending_withdrawals),
    unprocessedWebhooks: toNumber(r.unprocessed_webhooks),
    failedWebhooks: toNumber(r.failed_webhooks),
    openAnomalies: toNumber(r.open_anomalies),
  };
}

export function mapEvent(row: any): AdminLedgerEvent {
  return {
    id: row.id,
    eventKey: row.event_key ?? '',
    eventType: row.event_type ?? 'unknown',
    source: normalizeSource(row.source),
    bountyId: row.bounty_id ?? undefined,
    bountyTitle: row.bounty_title ?? undefined,
    actorId: row.actor_id ?? undefined,
    actorUsername: row.actor_username ?? undefined,
    amount: optionalNumber(row.amount),
    correlationId: row.correlation_id ?? undefined,
    occurredAt: row.occurred_at ?? new Date().toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

export function mapAnomaly(row: any): AdminAnomaly {
  return {
    anomalyType: row.anomaly_type ?? 'unknown',
    severity: normalizeSeverity(row.severity),
    entityType: row.entity_type ?? 'unknown',
    entityId: row.entity_id != null ? String(row.entity_id) : '',
    bountyId: row.bounty_id ?? undefined,
    userId: row.user_id ?? undefined,
    amount: optionalNumber(row.amount),
    detectedAt: row.detected_at ?? new Date().toISOString(),
    summary: row.summary ?? '',
    detail: (row.detail ?? {}) as Record<string, unknown>,
  };
}

export function mapFinancialSummary(row: any): AdminBountyFinancialSummary | null {
  if (!row) return null;
  return {
    bountyId: row.bounty_id,
    marketplaceStatus: (row.marketplace_status ?? 'open') as AdminBountyStatus,
    financialStatus: (row.financial_status ?? 'unfunded') as AdminFinancialStatus,
    // Defaults to false: an absent flag must never read as "Stripe confirmed".
    stripeConfirmed: row.stripe_confirmed === true,
    amount: optionalNumber(row.amount),
    escrowAmount: toNumber(row.escrow_amount),
    releaseAmount: toNumber(row.release_amount),
    refundAmount: toNumber(row.refund_amount),
    pendingLedgerCount: toNumber(row.pending_ledger_count),
    paymentRecords: toNumber(row.payment_records),
    webhookEvents: toNumber(row.webhook_events),
  };
}

function mapParty(raw: any) {
  if (!raw?.id) return undefined;
  return {
    id: raw.id,
    username: raw.username ?? undefined,
    accountStatus: raw.account_status ?? undefined,
    riskLevel: raw.risk_level ?? undefined,
  };
}

export function mapBountyDetail(json: any): AdminCommandBountyDetail | null {
  if (!json?.bounty?.id) return null;
  const b = json.bounty;
  const m = json.marketplace ?? {};
  const mod = json.moderation ?? {};
  return {
    id: b.id,
    title: b.title ?? '',
    description: b.description ?? undefined,
    amount: optionalNumber(b.amount),
    isForHonor: b.is_for_honor === true,
    category: b.category ?? undefined,
    location: b.location ?? b.neighborhood ?? b.zip_code ?? undefined,
    createdAt: b.created_at ?? new Date().toISOString(),
    updatedAt: b.updated_at ?? undefined,
    deadline: b.deadline ?? undefined,
    completedAt: b.completed_at ?? undefined,
    isStale: b.is_stale === true,
    poster: mapParty(json.poster),
    hunter: mapParty(json.hunter),
    marketplaceStatus: (m.status ?? 'open') as AdminBountyStatus,
    applications: toNumber(m.applications),
    applicationsPending: toNumber(m.applications_pending),
    completionSubmissions: toNumber(m.completion_submissions),
    financial: mapFinancialSummary(json.financial),
    moderation: {
      reports: toNumber(mod.reports),
      reportsOpen: toNumber(mod.reports_open),
      disputes: toNumber(mod.disputes),
      warnings: toNumber(mod.warnings),
      suspiciousReasons: Array.isArray(mod.suspicious_reasons)
        ? mod.suspicious_reasons.filter((x: unknown): x is string => typeof x === 'string')
        : [],
    },
  };
}

// ─── Client ───────────────────────────────────────────────────────────────

function unwrap<T>({ data, error }: { data: T; error: { message?: string } | null }): T {
  if (error) throw new Error(error.message ?? 'Command Center query failed');
  return data;
}

export const commandCenterClient = {
  /** Headline numbers for a rolling window. Defaults to the last 24 hours. */
  async fetchOverview(since?: Date | string): Promise<AdminMarketplaceOverview> {
    const p_since =
      since instanceof Date
        ? since.toISOString()
        : (since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const data = unwrap(await supabase.rpc('admin_marketplace_overview', { p_since }));
    return mapOverview(data);
  },

  /** Chronological activity feed, newest first, keyset-paginated. */
  async fetchFeed(filters: AdminFeedFilters = {}): Promise<AdminLedgerEvent[]> {
    const data = unwrap(
      await supabase.rpc('admin_activity_feed', {
        p_limit: filters.limit ?? 50,
        p_before: filters.before ?? null,
        p_before_id: filters.beforeId ?? null,
        p_sources: filters.sources ?? null,
        p_types: filters.types ?? null,
        p_bounty_id: filters.bountyId ?? null,
        p_actor_id: filters.actorId ?? null,
      })
    );
    return ((data ?? []) as any[]).map(mapEvent);
  },

  async fetchAnomalies(limit = 200): Promise<AdminAnomaly[]> {
    const data = unwrap(await supabase.rpc('admin_financial_anomalies', { p_limit: limit }));
    return ((data ?? []) as any[]).map(mapAnomaly);
  },

  async fetchBountyDetail(bountyId: string): Promise<AdminCommandBountyDetail | null> {
    const data = unwrap(await supabase.rpc('admin_bounty_detail', { p_bounty_id: bountyId }));
    return mapBountyDetail(data);
  },

  /** Oldest-first lifecycle timeline for one bounty. */
  async fetchBountyTimeline(bountyId: string, limit = 300): Promise<AdminLedgerEvent[]> {
    const data = unwrap(
      await supabase.rpc('admin_bounty_timeline', { p_bounty_id: bountyId, p_limit: limit })
    );
    return ((data ?? []) as any[]).map(mapEvent);
  },

  async fetchSuspiciousListings(): Promise<AdminSuspiciousListing[]> {
    const data = unwrap(await supabase.rpc('admin_suspicious_listings', {}));
    return ((data ?? []) as any[]).map((row) => ({
      bountyId: row.bounty_id,
      posterId: row.poster_id ?? undefined,
      title: row.title ?? undefined,
      amount: optionalNumber(row.amount),
      status: row.status ?? undefined,
      reason: row.reason ?? 'unknown',
      severity: normalizeSeverity(row.severity),
      detectedAt: row.detected_at ?? new Date().toISOString(),
    }));
  },

  async fetchSuspiciousApplications(): Promise<AdminSuspiciousApplication[]> {
    const data = unwrap(await supabase.rpc('admin_suspicious_applications', {}));
    return ((data ?? []) as any[]).map((row) => ({
      requestId: row.request_id,
      bountyId: row.bounty_id ?? undefined,
      hunterId: row.hunter_id ?? undefined,
      status: row.status ?? undefined,
      reason: row.reason ?? 'unknown',
      severity: normalizeSeverity(row.severity),
      detectedAt: row.detected_at ?? new Date().toISOString(),
    }));
  },
};

// Exported for unit tests: the pure logic that decides what the operator reads.
export const __commandCenterInternals = {
  mapOverview,
  mapEvent,
  mapAnomaly,
  mapFinancialSummary,
  mapBountyDetail,
  eventLabel,
  eventClassification,
  financialStatusMeta,
  isCompletedButUnverified,
  isStripeConfirmation,
  normalizeSource,
  compareSeverity,
};
