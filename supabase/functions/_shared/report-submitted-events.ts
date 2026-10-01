/**
 * Server-side `report_submitted` analytics event.
 *
 * Reports are inserted straight from the client through PostgREST, and the
 * client emitted nothing (trust-spine audit 2026-09-30, T21). The database
 * keeps a watermark (`reports.analytics_captured_at`, migration
 * 20261001140000) and moderation-sweep forwards every uncaptured report to
 * PostHog on each run, then marks it captured.
 *
 * The properties are server-derived: what the report targeted, the poster's
 * account age, and whether the report moved the listing to review. The
 * canonical ledger row for the same fact is `bounty_events`
 * 'moderation.report_filed' (written by trg_bounty_events_from_reports); this
 * is its product-analytics counterpart, not a second concept.
 *
 * Rows are marked captured only after PostHog accepted the batch, so a
 * PostHog outage or a missing key delays events instead of dropping them.
 * The report id doubles as the PostHog event uuid, so a retry after a
 * partial failure cannot double count.
 */

export interface ReportEventRow {
  report_id: string;
  reporter_id: string | null;
  content_type: string;
  content_id: string | null;
  reason: string | null;
  reported_at: string | null;
  bounty_id: string | null;
  poster_id: string | null;
  poster_account_age_days: number | null;
  moderation_state: string | null;
  moved_to_review: boolean | null;
}

export interface PostHogEvent {
  event: string;
  distinct_id: string;
  uuid: string;
  timestamp?: string;
  properties: Record<string, unknown>;
}

export interface ReportEventsClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/** Sends a batch; resolves true only if PostHog accepted it. */
export type PostHogBatchSender = (events: PostHogEvent[]) => Promise<boolean>;

export const REPORT_SUBMITTED_EVENT = 'report_submitted';

export function toReportSubmittedEvent(row: ReportEventRow): PostHogEvent | null {
  // A report whose reporter account was deleted has nobody to attribute it to.
  if (!row.reporter_id) return null;
  return {
    event: REPORT_SUBMITTED_EVENT,
    distinct_id: row.reporter_id,
    uuid: row.report_id,
    ...(row.reported_at ? { timestamp: row.reported_at } : {}),
    properties: {
      report_id: row.report_id,
      content_type: row.content_type,
      reason: row.reason,
      bounty_id: row.bounty_id,
      reported_user_id: row.poster_id,
      poster_account_age_days: row.poster_account_age_days,
      moderation_state: row.moderation_state,
      moved_to_review: row.moved_to_review === true,
      source: 'moderation-sweep',
    },
  };
}

export async function forwardReportSubmittedEvents(
  client: ReportEventsClient,
  send: PostHogBatchSender,
  limit = 200
): Promise<{ pending: number; sent: number; marked: number; error?: string }> {
  const { data, error } = await client.rpc('moderation_report_events_pending', { p_limit: limit });
  if (error) return { pending: 0, sent: 0, marked: 0, error: error.message ?? 'pending_rpc_failed' };

  const rows = (data as ReportEventRow[] | null) ?? [];
  if (rows.length === 0) return { pending: 0, sent: 0, marked: 0 };

  const events = rows.map(toReportSubmittedEvent).filter((e): e is PostHogEvent => e !== null);
  if (events.length > 0 && !(await send(events))) {
    return { pending: rows.length, sent: 0, marked: 0, error: 'posthog_rejected' };
  }

  const mark = await client.rpc('moderation_mark_report_events_captured', {
    p_report_ids: rows.map((r) => r.report_id),
  });
  if (mark.error) {
    return { pending: rows.length, sent: events.length, marked: 0, error: mark.error.message ?? 'mark_rpc_failed' };
  }
  return { pending: rows.length, sent: events.length, marked: Number(mark.data ?? 0) };
}
