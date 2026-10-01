import {
  forwardReportSubmittedEvents,
  toReportSubmittedEvent,
  type PostHogEvent,
  type ReportEventRow,
  type ReportEventsClient,
} from '../../supabase/functions/_shared/report-submitted-events';

const REPORT = 'cb2d086c-892f-4ecc-94b6-4827d8419922';
const REPORTER = '8d8f9a7f-5b23-45e3-848e-8c349c3caf3b';
const BOUNTY = '029a6c3c-19c9-4bac-a822-6ba5c51c5bc5';
const POSTER = 'e2d46fc3-30e2-4b9e-94f8-f332ca28c3b8';

function row(overrides: Partial<ReportEventRow> = {}): ReportEventRow {
  return {
    report_id: REPORT,
    reporter_id: REPORTER,
    content_type: 'bounty',
    content_id: BOUNTY,
    reason: 'fraud',
    reported_at: '2026-10-01T22:10:22.568Z',
    bounty_id: BOUNTY,
    poster_id: POSTER,
    poster_account_age_days: 1,
    moderation_state: 'under_review',
    moved_to_review: true,
    ...overrides,
  };
}

function client(pending: { data?: unknown; error?: { message?: string } | null }, mark = { data: 1 as unknown, error: null as { message?: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const c: ReportEventsClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === 'moderation_report_events_pending') {
        return Promise.resolve({ data: pending.data ?? null, error: pending.error ?? null });
      }
      return Promise.resolve(mark);
    },
  };
  return { c, calls };
}

describe('toReportSubmittedEvent', () => {
  it('maps a report to a server-side report_submitted event keyed by the report id', () => {
    expect(toReportSubmittedEvent(row())).toEqual({
      event: 'report_submitted',
      distinct_id: REPORTER,
      uuid: REPORT,
      timestamp: '2026-10-01T22:10:22.568Z',
      properties: {
        report_id: REPORT,
        content_type: 'bounty',
        reason: 'fraud',
        bounty_id: BOUNTY,
        reported_user_id: POSTER,
        poster_account_age_days: 1,
        moderation_state: 'under_review',
        moved_to_review: true,
        source: 'moderation-sweep',
      },
    });
  });

  it('skips a report whose reporter account no longer exists', () => {
    expect(toReportSubmittedEvent(row({ reporter_id: null }))).toBeNull();
  });

  it('reports moved_to_review=false when the server took no action', () => {
    expect(toReportSubmittedEvent(row({ moved_to_review: null }))?.properties.moved_to_review).toBe(false);
  });
});

describe('forwardReportSubmittedEvents', () => {
  it('sends pending reports and marks exactly those captured', async () => {
    const { c, calls } = client({ data: [row(), row({ report_id: 'r2', reporter_id: null })] }, { data: 2, error: null });
    const sent: PostHogEvent[][] = [];
    const result = await forwardReportSubmittedEvents(c, async (e) => (sent.push(e), true));

    expect(sent).toHaveLength(1);
    expect(sent[0].map((e) => e.uuid)).toEqual([REPORT]);
    expect(calls).toEqual([
      { fn: 'moderation_report_events_pending', args: { p_limit: 200 } },
      { fn: 'moderation_mark_report_events_captured', args: { p_report_ids: [REPORT, 'r2'] } },
    ]);
    expect(result).toEqual({ pending: 2, sent: 1, marked: 2 });
  });

  it('leaves reports uncaptured when PostHog does not accept the batch', async () => {
    const { c, calls } = client({ data: [row()] });
    const result = await forwardReportSubmittedEvents(c, async () => false);
    expect(calls.map((x) => x.fn)).toEqual(['moderation_report_events_pending']);
    expect(result).toEqual({ pending: 1, sent: 0, marked: 0, error: 'posthog_rejected' });
  });

  it('does nothing when there is nothing pending', async () => {
    const { c, calls } = client({ data: [] });
    const send = jest.fn();
    expect(await forwardReportSubmittedEvents(c, send)).toEqual({ pending: 0, sent: 0, marked: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('surfaces a pending-RPC error without sending', async () => {
    const { c } = client({ error: { message: 'function does not exist' } });
    const send = jest.fn();
    const result = await forwardReportSubmittedEvents(c, send);
    expect(result.error).toBe('function does not exist');
    expect(send).not.toHaveBeenCalled();
  });

  it('surfaces a mark-RPC error after sending (uuid dedupes the retry)', async () => {
    const { c } = client({ data: [row()] }, { data: null, error: { message: 'mark failed' } });
    const result = await forwardReportSubmittedEvents(c, async () => true);
    expect(result).toEqual({ pending: 1, sent: 1, marked: 0, error: 'mark failed' });
  });
});
