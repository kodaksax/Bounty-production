// Tests for the founder Command Center client.
//
// The DB-side behaviour of the ledger (triggers, idempotency, RLS, the admin
// guard, anomaly SQL) is exercised against the real schema by
// scripts/verify-command-center-migration.js, which applies the migration
// inside a transaction and rolls it back. This suite covers the layer above
// it: the mapping and labelling decisions that determine what an operator
// actually reads, and in particular the rule that our own ledger must never be
// presented as a Stripe confirmation.

const rpc = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
  isSupabaseConfigured: true,
}));

import {
  commandCenterClient,
  __commandCenterInternals,
} from '../../lib/admin/commandCenterClient';

const {
  mapOverview,
  mapEvent,
  mapAnomaly,
  mapFinancialSummary,
  mapBountyDetail,
  eventLabel,
  eventClassification,
  financialStatusMeta,
  isCompletedButUnverified,
  normalizeSource,
  compareSeverity,
} = __commandCenterInternals;

beforeEach(() => {
  rpc.mockReset();
});

function ok(data: unknown) {
  return Promise.resolve({ data, error: null });
}

// ─── Marketplace lifecycle events ────────────────────────────────────────

describe('marketplace lifecycle events', () => {
  test('a bounty creation event maps to an app-sourced posting', () => {
    const event = mapEvent({
      id: 'e1',
      event_key: 'bounty.posted:b1',
      event_type: 'bounty.posted',
      source: 'app',
      bounty_id: 'b1',
      actor_id: 'u1',
      amount: '25.00',
      occurred_at: '2026-08-28T10:00:00Z',
    });
    expect(event.eventType).toBe('bounty.posted');
    expect(event.amount).toBe(25);
    expect(eventLabel(event)).toBe('Bounty posted');
    expect(eventClassification(event)).toEqual({ source: 'app', label: 'APP EVENT', confirmed: false });
  });

  test('an application event names the hunter as the actor', () => {
    const event = mapEvent({
      id: 'e2',
      event_type: 'application.submitted',
      source: 'app',
      bounty_id: 'b1',
      actor_id: 'hunter-1',
      actor_username: 'sam',
      occurred_at: '2026-08-28T10:05:00Z',
    });
    expect(eventLabel(event)).toBe('Application received');
    expect(event.actorUsername).toBe('sam');
  });

  test('acceptance and completion have their own labels, not a generic status change', () => {
    expect(eventLabel({ eventType: 'bounty.accepted', source: 'app' })).toBe('Bounty accepted');
    expect(eventLabel({ eventType: 'application.accepted', source: 'app' })).toBe('Application accepted');
    expect(eventLabel({ eventType: 'bounty.completed', source: 'app' })).toBe('Bounty completed');
    expect(eventLabel({ eventType: 'completion.submitted', source: 'app' })).toBe('Work submitted');
    expect(eventLabel({ eventType: 'completion.approved', source: 'app' })).toBe('Work approved');
  });

  test('an unmapped event type is humanised rather than shown as a raw key', () => {
    expect(eventLabel({ eventType: 'stripe.invoice.upcoming', source: 'webhook' })).toBe(
      'Invoice upcoming'
    );
  });
});

// ─── Financial events and provenance ─────────────────────────────────────

describe('financial events never claim a confirmation they do not have', () => {
  test('a release written by our own ledger is labelled as recorded, not confirmed', () => {
    const label = eventLabel({ eventType: 'payment.released', source: 'app' });
    expect(label).toBe('Release initiated (recorded)');
    expect(label.toLowerCase()).not.toContain('confirm');
    expect(label.toLowerCase()).not.toContain('succeed');
  });

  test('escrow and payout ledger rows are equally hedged', () => {
    expect(eventLabel({ eventType: 'payment.escrow_funded', source: 'app' })).toBe(
      'Escrow funded (recorded)'
    );
    expect(eventLabel({ eventType: 'payout.completed', source: 'app' })).toBe(
      'Payout marked complete (recorded)'
    );
  });

  test('only a webhook-sourced event is classified as a Stripe confirmation', () => {
    expect(eventClassification({ source: 'webhook' })).toEqual({
      source: 'webhook',
      label: 'WEBHOOK CONFIRMATION',
      confirmed: true,
    });
    for (const source of ['app', 'system', 'stripe', 'inferred'] as const) {
      expect(eventClassification({ source }).confirmed).toBe(false);
    }
  });

  test('inferred state is labelled as inferred, never as an observed event', () => {
    expect(eventClassification({ source: 'inferred' }).label).toBe('INFERRED STATE');
  });

  test('an unrecognised provenance degrades to inferred, never to webhook', () => {
    // Failing open here would render an unknown row as "Stripe confirmed".
    expect(normalizeSource('totally-new')).toBe('inferred');
    expect(normalizeSource(undefined)).toBe('inferred');
    expect(normalizeSource(null)).toBe('inferred');
    expect(eventClassification({ source: 'nonsense' as never }).confirmed).toBe(false);
  });

  test('a payout failure is surfaced as a failure regardless of source', () => {
    expect(eventLabel({ eventType: 'payout.failed', source: 'app' })).toBe('Payout failed');
    expect(eventLabel({ eventType: 'stripe.payout.failed', source: 'webhook' })).toBe('Payout failed');
  });
});

// ─── Marketplace status vs financial status ──────────────────────────────

describe('marketplace status is kept separate from financial status', () => {
  const completedUnverified = {
    bounty_id: 'b1',
    marketplace_status: 'completed',
    financial_status: 'released_unverified',
    stripe_confirmed: false,
    amount: '25.00',
    escrow_amount: '25.00',
    release_amount: '25.00',
    refund_amount: '0',
    pending_ledger_count: 0,
    payment_records: 0,
    webhook_events: 0,
  };

  test('COMPLETED + verification pending is representable and detected', () => {
    const financial = mapFinancialSummary(completedUnverified)!;
    expect(financial.marketplaceStatus).toBe('completed');
    expect(financial.financialStatus).toBe('released_unverified');
    expect(isCompletedButUnverified(financial)).toBe(true);
  });

  test('the copy for an unverified release warns against treating it as settled', () => {
    const meta = financialStatusMeta('released_unverified');
    expect(meta.tone).toBe('warning');
    expect(meta.explanation).toMatch(/Stripe has never confirmed/i);
  });

  test('a Stripe-confirmed release is the only success tone', () => {
    expect(financialStatusMeta('released_verified').tone).toBe('success');
    expect(financialStatusMeta('released_unverified').tone).not.toBe('success');
  });

  test('a completed bounty with no financial record reads as an error, not a blank', () => {
    const meta = financialStatusMeta('completed_unfunded');
    expect(meta.tone).toBe('error');
    expect(meta.label).toMatch(/no financial record/i);
  });

  test('a missing stripe_confirmed flag is treated as unconfirmed', () => {
    const financial = mapFinancialSummary({ ...completedUnverified, stripe_confirmed: undefined })!;
    expect(financial.stripeConfirmed).toBe(false);
    expect(isCompletedButUnverified(financial)).toBe(true);
  });

  test('a confirmed completion is not flagged', () => {
    const financial = mapFinancialSummary({
      ...completedUnverified,
      financial_status: 'released_verified',
      stripe_confirmed: true,
      webhook_events: 2,
    })!;
    expect(isCompletedButUnverified(financial)).toBe(false);
  });

  test('a bounty with no financial row at all does not read as verified', () => {
    expect(mapFinancialSummary(null)).toBeNull();
    expect(isCompletedButUnverified(null)).toBe(false);
  });
});

// ─── Anomalies ───────────────────────────────────────────────────────────

describe('anomaly mapping', () => {
  test('maps a missing-payment-record finding', () => {
    const anomaly = mapAnomaly({
      anomaly_type: 'completed_without_financial_record',
      severity: 'critical',
      entity_type: 'bounty',
      entity_id: 'b1',
      bounty_id: 'b1',
      amount: '25.00',
      detected_at: '2026-08-28T10:00:00Z',
      summary: 'Bounty is marked completed but no escrow, release or payment record exists.',
      detail: { financial_status: 'completed_unfunded' },
    });
    expect(anomaly.anomalyType).toBe('completed_without_financial_record');
    expect(anomaly.severity).toBe('critical');
    expect(anomaly.amount).toBe(25);
  });

  test('maps a payout failure finding without inventing an amount', () => {
    const anomaly = mapAnomaly({
      anomaly_type: 'stripe_payout_failure',
      severity: 'critical',
      entity_type: 'bounty_event',
      entity_id: 'e9',
      amount: null,
      summary: 'Stripe reported a failed payout or transfer.',
    });
    expect(anomaly.amount).toBeUndefined();
    expect(anomaly.detail).toEqual({});
  });

  test('an unknown severity is not silently promoted to critical', () => {
    expect(mapAnomaly({ anomaly_type: 'x', severity: 'catastrophic' }).severity).toBe('medium');
  });

  test('severities sort worst-first', () => {
    const order = (['medium', 'critical', 'low', 'high'] as const).slice().sort(compareSeverity);
    expect(order).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

// ─── Overview ────────────────────────────────────────────────────────────

describe('marketplace overview', () => {
  test('maps every headline number the founder screen renders', () => {
    const overview = mapOverview({
      since: '2026-08-27T12:00:00Z',
      generated_at: '2026-08-28T12:00:00Z',
      new_bounties: 4,
      new_posters: 2,
      new_hunters: 3,
      applications: 11,
      accepts: 5,
      completions: 2,
      completed_gmv: '120.50',
      verified_gmv: '20.00',
      escrow_held: '75.00',
      pending_financial_events: 6,
      payout_failures: 1,
      suspicious_listings: 3,
      suspicious_applications: 2,
      open_anomalies: 61,
    });
    expect(overview).toMatchObject({
      newBounties: 4,
      newPosters: 2,
      newHunters: 3,
      applications: 11,
      accepts: 5,
      completions: 2,
      completedGmv: 120.5,
      verifiedGmv: 20,
      escrowHeld: 75,
      pendingFinancialEvents: 6,
      payoutFailures: 1,
      suspiciousListings: 3,
      suspiciousApplications: 2,
      openAnomalies: 61,
    });
  });

  test('an absent number is zero, never NaN or undefined', () => {
    const overview = mapOverview({});
    expect(overview.completedGmv).toBe(0);
    expect(overview.verifiedGmv).toBe(0);
    expect(Number.isNaN(overview.payoutFailures)).toBe(false);
  });

  test('verified GMV is never inflated to match completed GMV', () => {
    const overview = mapOverview({ completed_gmv: '500', verified_gmv: null });
    expect(overview.completedGmv).toBe(500);
    expect(overview.verifiedGmv).toBe(0);
  });
});

// ─── Bounty detail ───────────────────────────────────────────────────────

describe('bounty detail', () => {
  const json = {
    bounty: {
      id: 'b1',
      title: 'Move a couch',
      amount: '25.00',
      is_for_honor: false,
      location: 'Brooklyn',
      created_at: '2026-08-20T10:00:00Z',
      completed_at: '2026-08-25T10:00:00Z',
    },
    poster: { id: 'u1', username: 'ada', account_status: 'active' },
    hunter: { id: 'u2', username: 'sam', account_status: 'suspended' },
    marketplace: { status: 'completed', applications: 3, applications_pending: 1, completion_submissions: 1 },
    financial: {
      bounty_id: 'b1',
      marketplace_status: 'completed',
      financial_status: 'released_unverified',
      stripe_confirmed: false,
    },
    moderation: { reports: 1, reports_open: 1, disputes: 0, warnings: 0, suspicious_reasons: ['open_report'] },
  };

  test('carries both statuses and the moderation state', () => {
    const detail = mapBountyDetail(json)!;
    expect(detail.marketplaceStatus).toBe('completed');
    expect(detail.financial?.financialStatus).toBe('released_unverified');
    expect(detail.financial?.stripeConfirmed).toBe(false);
    expect(detail.moderation.suspiciousReasons).toEqual(['open_report']);
    expect(detail.hunter?.accountStatus).toBe('suspended');
    expect(detail.applications).toBe(3);
  });

  test('a missing bounty maps to null rather than an empty shell', () => {
    expect(mapBountyDetail(null)).toBeNull();
    expect(mapBountyDetail({})).toBeNull();
  });

  test('non-string suspicious reasons are dropped rather than rendered', () => {
    const detail = mapBountyDetail({ ...json, moderation: { suspicious_reasons: ['a', 42, null] } })!;
    expect(detail.moderation.suspiciousReasons).toEqual(['a']);
  });
});

// ─── RPC wiring and authorization ────────────────────────────────────────

describe('client wiring', () => {
  test('the feed passes its keyset cursor and filters through to the RPC', async () => {
    rpc.mockReturnValue(ok([]));
    await commandCenterClient.fetchFeed({
      limit: 10,
      before: '2026-08-28T10:00:00Z',
      beforeId: 'e5',
      sources: ['webhook'],
      types: ['stripe.payout.paid'],
      bountyId: 'b1',
    });
    expect(rpc).toHaveBeenCalledWith('admin_activity_feed', {
      p_limit: 10,
      p_before: '2026-08-28T10:00:00Z',
      p_before_id: 'e5',
      p_sources: ['webhook'],
      p_types: ['stripe.payout.paid'],
      p_bounty_id: 'b1',
      p_actor_id: null,
    });
  });

  test('an unfiltered feed sends explicit nulls rather than omitting arguments', async () => {
    rpc.mockReturnValue(ok([]));
    await commandCenterClient.fetchFeed();
    const [, args] = rpc.mock.calls[0];
    expect(args).toMatchObject({ p_sources: null, p_types: null, p_bounty_id: null });
  });

  test('a webhook replay that reached the ledger once is read back once', async () => {
    // The DB dedupes on event_key (see claim_stripe_event / record_bounty_event);
    // this pins the client half -- the same delivery read twice is one event.
    const row = {
      id: 'e7',
      event_key: 'stripe:evt_1',
      event_type: 'stripe.payment_intent.succeeded',
      source: 'webhook',
      bounty_id: 'b1',
      amount: '25.00',
    };
    rpc.mockReturnValue(ok([row]));
    const events = await commandCenterClient.fetchFeed();
    expect(events).toHaveLength(1);
    expect(events[0].eventKey).toBe('stripe:evt_1');
    expect(eventClassification(events[0]).confirmed).toBe(true);
  });

  test('an unauthorized admin call surfaces the server error instead of empty data', async () => {
    // admin_assert_role() raises 42501 for a non-admin JWT. The client must
    // not swallow that into a plausible-looking empty dashboard.
    rpc.mockReturnValue(Promise.resolve({ data: null, error: { message: 'admin role required' } }));
    await expect(commandCenterClient.fetchOverview()).rejects.toThrow('admin role required');
    await expect(commandCenterClient.fetchAnomalies()).rejects.toThrow('admin role required');
    await expect(commandCenterClient.fetchFeed()).rejects.toThrow('admin role required');
    await expect(commandCenterClient.fetchBountyDetail('b1')).rejects.toThrow('admin role required');
    await expect(commandCenterClient.fetchBountyTimeline('b1')).rejects.toThrow('admin role required');
  });

  test('a null overview payload does not crash the screen', async () => {
    rpc.mockReturnValue(ok(null));
    await expect(commandCenterClient.fetchOverview()).resolves.toMatchObject({ newBounties: 0 });
  });

  test('the overview window is sent as an ISO timestamp', async () => {
    rpc.mockReturnValue(ok({}));
    await commandCenterClient.fetchOverview(new Date('2026-08-27T00:00:00Z'));
    expect(rpc).toHaveBeenCalledWith('admin_marketplace_overview', {
      p_since: '2026-08-27T00:00:00.000Z',
    });
  });
});
