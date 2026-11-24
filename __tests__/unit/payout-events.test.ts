/**
 * Server-side payout outcome events (PostHog audit 2026-11-23). PostHog had no
 * event for a payout that landed, and the app's payout_failed counted taps:
 * on 2026-11-13, 2 real failures showed as 4.
 *
 * Pins the payloads, the deterministic uuid + timestamp (PostHog merges a
 * redelivery only when both match), that no account or bank detail leaves,
 * and that nothing is sent on a no-op delivery. The Deno handler can't be
 * imported by jest, so its call sites are pinned by source contract below.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildPayoutCompletedEvent,
  buildPayoutFailedEvent,
  PAYOUT_EVENT_SOURCE,
  sendPayoutEvent,
} from '../../supabase/functions/_shared/payout-events';
import { deterministicEventUuid } from '../../supabase/functions/_shared/web-marketplace-events';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

const HUNTER = '78c972ad-0000-4000-8000-000000000001';
const TX = 'a83b5db2-06be-4bab-ba13-aeb75d4030b0';

const payout = {
  id: 'po_1TestPayout',
  amount: 50000,
  currency: 'usd',
  method: 'standard',
  failure_code: null as string | null,
};

const completedRow = {
  id: TX,
  amount: -500,
  status: 'completed',
  payout_method: 'standard',
  completed_at: '2026-11-20T15:04:05.000Z',
  metadata: { idempotency_key: 'withdraw_x', destination_bank_last4: '6828', destination_bank_name: 'LEAD BANK' },
};

describe('buildPayoutCompletedEvent', () => {
  test('payload: hunter distinct_id, ledger amount, source stripe_webhook, fixed uuid and timestamp', async () => {
    const e = await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: completedRow });
    expect(e).toEqual({
      event: 'payout_completed',
      distinct_id: HUNTER,
      uuid: await deterministicEventUuid('payout_completed:po_1TestPayout'),
      timestamp: '2026-11-20T15:04:05.000Z',
      properties: {
        role: 'hunter',
        amount: 500,
        currency: 'usd',
        method: 'standard',
        payout_architecture: 'legacy_transfer',
        stripe_payout_id: 'po_1TestPayout',
        transaction_id: TX,
        platform: 'server',
        source: 'stripe_webhook',
        failure_code: null,
      },
    });
    expect(PAYOUT_EVENT_SOURCE).toBe('stripe_webhook');
  });

  test('a redelivery builds the identical event (PostHog keeps one)', async () => {
    const a = await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: completedRow });
    const b = await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: { ...completedRow } });
    expect(b).toEqual(a);
  });

  test('never carries bank name, last4, idempotency key or account id', async () => {
    const e = await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: completedRow });
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/6828|LEAD BANK|withdraw_x|acct_|ba_/);
  });

  test('connect-native rows and instant payouts are labelled', async () => {
    const e = await buildPayoutCompletedEvent({
      userId: HUNTER,
      payout: { ...payout, method: 'instant' },
      row: { ...completedRow, metadata: { connect_native: true } },
    });
    expect(e?.properties).toMatchObject({ method: 'instant', payout_architecture: 'connect_native' });
  });

  test('nothing unless the row is completed, matched and attributable', async () => {
    expect(await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: null })).toBeNull();
    expect(await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: { ...completedRow, status: 'pending' } })).toBeNull();
    expect(await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: { ...completedRow, status: 'failed' } })).toBeNull();
    expect(await buildPayoutCompletedEvent({ userId: HUNTER, payout, row: { ...completedRow, status: 'manually_paid' } })).toBeNull();
    expect(await buildPayoutCompletedEvent({ userId: null, payout, row: completedRow })).toBeNull();
  });
});

describe('buildPayoutFailedEvent', () => {
  const failedRow = { ...completedRow, status: 'pending', completed_at: null };

  test('payload carries Stripe failure_code and outcome; timestamp is Stripe event.created', async () => {
    const e = await buildPayoutFailedEvent({
      userId: HUNTER,
      payout: { ...payout, failure_code: 'account_closed' },
      row: failedRow,
      outcome: 'failed',
      failedByThisCall: true,
      stripeEventCreated: 1795000000,
    });
    expect(e).toMatchObject({
      event: 'payout_failed',
      distinct_id: HUNTER,
      uuid: await deterministicEventUuid('payout_failed:po_1TestPayout'),
      timestamp: new Date(1795000000 * 1000).toISOString(),
      properties: {
        amount: 500,
        method: 'standard',
        outcome: 'failed',
        failure_code: 'account_closed',
        source: 'stripe_webhook',
        stripe_payout_id: 'po_1TestPayout',
        transaction_id: TX,
      },
    });
  });

  test('payout.failed and a later payout.closed for one payout share one uuid', async () => {
    const failed = await buildPayoutFailedEvent({ userId: HUNTER, payout, row: failedRow, outcome: 'failed', failedByThisCall: true });
    const canceled = await buildPayoutFailedEvent({ userId: HUNTER, payout, row: failedRow, outcome: 'canceled', failedByThisCall: true });
    expect(canceled?.uuid).toBe(failed?.uuid);
  });

  test('nothing when this delivery did not move the row (duplicate, already refunded, foreign payout)', async () => {
    expect(
      await buildPayoutFailedEvent({ userId: HUNTER, payout, row: failedRow, outcome: 'failed', failedByThisCall: false })
    ).toBeNull();
    expect(
      await buildPayoutFailedEvent({ userId: HUNTER, payout, row: null, outcome: 'failed', failedByThisCall: true })
    ).toBeNull();
  });
});

describe('sendPayoutEvent', () => {
  test('sends a built event, skips null, and never throws', async () => {
    const send = jest.fn();
    expect(await sendPayoutEvent(() => buildPayoutCompletedEvent({ userId: HUNTER, payout, row: completedRow }), send)).toBe('sent');
    expect(await sendPayoutEvent(async () => null, send)).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(1);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendPayoutEvent(async () => { throw new Error('boom'); }, send)).toBe('error');
    expect(await sendPayoutEvent(async () => ({ event: 'x', distinct_id: HUNTER, uuid: 'u', properties: {} }), () => { throw new Error('send'); })).toBe('error');
    warn.mockRestore();
  });
});

describe('webhooks call sites (source contract)', () => {
  const src = read('supabase/functions/webhooks/index.ts');

  test('payout.paid sends payout_completed from the completed row', () => {
    expect(src).toContain('buildPayoutCompletedEvent({');
    expect(src).toContain('completedRow = promoted;');
    expect(src).toContain('completedRow = stamped;');
    expect(src).toContain("if (candidateTx?.status === 'completed') completedRow = candidateTx;");
  });

  test('payout.failed/canceled/closed send payout_failed only when this delivery failed the row', () => {
    expect(src).toContain('buildPayoutFailedEvent({');
    expect(src.match(/failedByThisCall = true;/g)?.length).toBe(2);
    expect(src.match(/handleUndeliveredPayout\(supabase, payout, \w+, '(failed|canceled)', event\.created\)/g)?.length).toBe(3);
  });
});
