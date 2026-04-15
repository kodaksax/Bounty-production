/**
 * Unit tests for the transfer.failed webhook handler in server/index.js
 *
 * Specifically verifies that the user's balance is ALWAYS refunded when a
 * Stripe transfer fails — including the permanently-failed case (retry_count
 * >= MAX_TRANSFER_RETRIES). Previously the permanently-failed branch skipped
 * the refund, causing a permanent loss of user funds.
 *
 * Sending notes
 * -------------
 * The server registers a global bodyParser.json() middleware which parses the
 * request body before the route-specific bodyParser.raw() runs. As a result,
 * req.body is always a plain JS object by the time the webhook handler sees it.
 * We therefore send the request body as a plain JSON string (not a Buffer);
 * sending a Buffer causes supertest to JSON-serialise it to {"type":"Buffer",
 * "data":[…]}, which yields event.type = "Buffer" and the switch falls through
 * to the default case.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
export { };

// ---------------------------------------------------------------------------
// Self-contained Supabase mock.
//
// All mutable state lives INSIDE the factory closure so there are no
// jest-hoisting / TDZ issues with variables declared in the outer scope.
// `jest` is a global available in all jest factory contexts.
// ---------------------------------------------------------------------------
jest.mock('@supabase/supabase-js', () => {
  const rpcMock = jest.fn().mockResolvedValue({ error: null });
  const fromQueue: any[] = [];

  const client: any = {
    from: (_table: string) => {
      const resp: any = fromQueue.shift() ?? {};
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        contains: () => chain,
        insert: () => Promise.resolve({ error: null }),
        upsert: () => Promise.resolve({ error: null }),
        update: (_data: any) => ({
          eq: (_c: string, _v: any) => ({
            eq: (_c2: string, _v2: any) => ({
              select: () => ({
                single: () => Promise.resolve(resp.update ?? { data: null, error: null }),
              }),
            }),
          }),
        }),
        maybeSingle: () => Promise.resolve(resp.maybeSingle ?? { data: null, error: null }),
        single: () => Promise.resolve(resp.single ?? { data: null, error: null }),
      };
      return chain;
    },
    rpc: rpcMock,
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
    // Test helpers
    __getFromQueue: () => fromQueue,
    __getRpcMock: () => rpcMock,
    __resetState: () => {
      fromQueue.length = 0;
      rpcMock.mockClear();
      rpcMock.mockResolvedValue({ error: null });
    },
  };

  return {
    createClient: () => client,
    __getClient: () => client,
  };
});

// ---------------------------------------------------------------------------
// Stripe mock — self-contained, handles body that may already be a parsed
// object (because global bodyParser.json() pre-parses it).
// ---------------------------------------------------------------------------
jest.mock('stripe', () =>
  jest.fn(() => ({
    webhooks: {
      constructEvent: (
        body: Buffer | string | Record<string, unknown>,
        _sig: string,
        _secret: string
      ) => {
        if (Buffer.isBuffer(body)) return JSON.parse(body.toString());
        if (typeof body === 'string') return JSON.parse(body);
        return body; // already a parsed object
      },
    },
    transfers: {},
    paymentIntents: {},
    accounts: { retrieve: () => Promise.resolve({}) },
  }))
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const request = require('supertest');

function buildTransferFailedEvent(transferId: string) {
  return {
    id: `evt_${transferId}`,
    type: 'transfer.failed',
    data: {
      object: {
        id: transferId,
        amount: 5000, // cents ($50.00)
        failure_code: 'no_account',
      },
    },
  };
}

/** Fire a POST /webhooks/stripe with the given event payload. */
async function postWebhook(app: any, event: object) {
  return (
    request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      // Send a plain JSON string, NOT a Buffer. Sending Buffer.from(json) via
      // supertest causes it to be serialised as {"type":"Buffer","data":[…]},
      // which makes event.type = "Buffer" and the switch falls through.
      .send(JSON.stringify(event))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('transfer.failed webhook — balance refund behaviour', () => {
  let app: any;
  let supabaseMock: any;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_fake';

    // Require the server AFTER jest.mock() calls have registered the mocks.
    app = require('../../../server/index').app;
    supabaseMock = require('@supabase/supabase-js').__getClient();
  });

  beforeEach(() => {
    supabaseMock.__resetState();
  });

  /**
   * Non-permanent failure (retry_count = 1 < MAX_TRANSFER_RETRIES):
   * Refund must be issued.
   */
  it('issues increment_balance refund for a non-permanent failure', async () => {
    const event = buildTransferFailedEvent('tr_nonperm');
    const queue = supabaseMock.__getFromQueue();

    queue.push({ single: { data: null, error: { code: 'PGRST116' } } }); // stripe_events SELECT
    queue.push({}); // stripe_events upsert
    queue.push({
      maybeSingle: { data: { id: 'wt_1', metadata: { retry_count: 1 }, amount: -50 }, error: null },
    }); // wallet_transactions SELECT
    queue.push({
      update: {
        data: { id: 'wt_1', user_id: 'user_1', amount: -50, metadata: { retry_count: 1 } },
        error: null,
      },
    }); // wallet_transactions UPDATE
    queue.push({}); // stripe_events mark processed

    const res = await postWebhook(app, event);
    expect(res.status).toBe(200);

    const mockRpc = supabaseMock.__getRpcMock();
    expect(mockRpc).toHaveBeenCalledWith('increment_balance', {
      p_user_id: 'user_1',
      p_amount: 50,
    });
  });

  /**
   * Permanent failure (retry_count = 3 >= MAX_TRANSFER_RETRIES):
   * Refund MUST still be issued. This was the bug — the old branch skipped the
   * increment_balance call when permanently failed, causing fund loss.
   */
  it('issues increment_balance refund even when permanently failed (retry_count >= 3)', async () => {
    const event = buildTransferFailedEvent('tr_perm');
    const queue = supabaseMock.__getFromQueue();

    queue.push({ single: { data: null, error: { code: 'PGRST116' } } }); // stripe_events SELECT
    queue.push({}); // stripe_events upsert
    queue.push({
      maybeSingle: { data: { id: 'wt_2', metadata: { retry_count: 3 }, amount: -50 }, error: null },
    }); // wallet_transactions SELECT
    queue.push({
      update: {
        data: { id: 'wt_2', user_id: 'user_2', amount: -50, metadata: { retry_count: 3 } },
        error: null,
      },
    }); // wallet_transactions UPDATE
    queue.push({ maybeSingle: { data: null, error: null } }); // notifications SELECT (no existing)
    queue.push({}); // notifications INSERT
    queue.push({}); // stripe_events mark processed

    const res = await postWebhook(app, event);
    expect(res.status).toBe(200);

    const mockRpc = supabaseMock.__getRpcMock();
    // Critical assertion: refund must be issued regardless of retry count.
    expect(mockRpc).toHaveBeenCalledWith('increment_balance', {
      p_user_id: 'user_2',
      p_amount: 50,
    });
  });

  /**
   * Permanent failure idempotency: if the notification already exists, the
   * handler must skip the INSERT but STILL issue the refund.
   */
  it('does not re-insert a notification on duplicate permanently-failed event', async () => {
    const event = buildTransferFailedEvent('tr_perm_dup');
    const queue = supabaseMock.__getFromQueue();

    queue.push({ single: { data: null, error: { code: 'PGRST116' } } }); // stripe_events SELECT
    queue.push({}); // stripe_events upsert
    queue.push({
      maybeSingle: { data: { id: 'wt_3', metadata: { retry_count: 3 }, amount: -75 }, error: null },
    }); // wallet_transactions SELECT
    queue.push({
      update: {
        data: { id: 'wt_3', user_id: 'user_3', amount: -75, metadata: { retry_count: 3 } },
        error: null,
      },
    }); // wallet_transactions UPDATE
    queue.push({ maybeSingle: { data: { id: 'notif_existing' }, error: null } }); // notifications SELECT — already exists
    queue.push({}); // stripe_events mark processed

    const res = await postWebhook(app, event);
    expect(res.status).toBe(200);

    const mockRpc = supabaseMock.__getRpcMock();
    // Refund still issued even on duplicate delivery.
    expect(mockRpc).toHaveBeenCalledWith('increment_balance', {
      p_user_id: 'user_3',
      p_amount: 75,
    });
    // Only the refund RPC — no extra calls (idempotency guard skips INSERT).
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
