/**
 * Tests for consolidated-webhooks route handlers (payout.paid / payout.failed)
 */
export { };

jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  createDeposit: jest.fn(),
  updateBalance: jest.fn(),
}));

jest.mock('../../../services/api/src/services/consolidated-payment-service', () => ({
  stripe: { webhooks: { constructEvent: (body: any) => JSON.parse(body) } },
}));

jest.mock('../../../services/api/src/services/notification-service', () => ({
  notificationService: { createNotification: jest.fn(async () => {}) },
}));

jest.mock('../../../services/api/src/services/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

// Simplified Supabase mock for consolidated webhook tests
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (sel?: string) => ({
        eq: (_col: string, _val: any) => ({
          single: async () => {
            if (table === 'stripe_events' && sel === 'processed') {
              return { data: { processed: false }, error: null };
            }
            if (table === 'profiles') {
              return { data: { id: 'profile_cw_1' }, error: null };
            }
            return { data: null, error: null };
          },
          maybeSingle: async () => {
            if (table === 'profiles') {
              return { data: { id: 'profile_cw_1' }, error: null };
            }
            return { data: null, error: null };
          },
        }),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
      upsert: async () => ({ error: null }),
      update: (_obj: any) => ({ eq: (_col: string, _val: any) => Promise.resolve({ error: null }) }),
    }),
  }),
}));

// Lightweight Fastify mock (same pattern as payments tests)
class MockFastify {
  routes: Record<string, any> = {};
  log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  post(path: string, optsOrHandler: any, maybeHandler?: any) {
    let opts: any;
    let handler: any;
    if (typeof maybeHandler === 'function') {
      opts = optsOrHandler;
      handler = maybeHandler;
    } else {
      opts = {};
      handler = optsOrHandler;
    }

    const wrapped = async (req: any, reply: any) => {
      if (opts && opts.preHandler) {
        await opts.preHandler(req, reply);
        if ((reply as any).sent) return;
      }
      return handler(req, reply);
    };

    this.routes[path] = wrapped;
  }

  get(path: string, handler: any) {
    this.routes[path] = handler;
  }

  delete(path: string, handler: any) {
    this.routes[path] = handler;
  }
}

function makeReply() {
  const r: any = {};
  r.sent = false;
  r.code = jest.fn().mockImplementation((c: number) => { r.status = c; return r; });
  r.send = jest.fn().mockImplementation((p: any) => { r.payload = p; r.sent = true; return r; });
  return r;
}

describe('consolidated-webhooks routes (payout notifications)', () => {
  let registerConsolidatedWebhookRoutes: any;
  beforeAll(() => {
    registerConsolidatedWebhookRoutes = require('../../../services/api/src/routes/consolidated-webhooks').registerConsolidatedWebhookRoutes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /webhooks/stripe: payout.paid sends notification to hunter', async () => {
    const fastify = new MockFastify();
    await registerConsolidatedWebhookRoutes(fastify as any);

    const event: any = {
      id: 'evt_cw_payout_paid',
      type: 'payout.paid',
      data: { object: { id: 'po_cw_1', amount: 3000 } },
      created: 1620000000,
      account: 'acct_cw_1',
    };

    const handler = fastify.routes['/webhooks/stripe'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(result.payload).toEqual({ received: true });
    const notif = require('../../../services/api/src/services/notification-service').notificationService;
    expect(notif.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'profile_cw_1',
      type: 'payment',
      title: expect.stringContaining('Payout Successful'),
    }));
  });

  it('POST /webhooks/stripe: payout.failed notifies hunter and flags event', async () => {
    const fastify = new MockFastify();
    await registerConsolidatedWebhookRoutes(fastify as any);

    const event: any = {
      id: 'evt_cw_payout_failed',
      type: 'payout.failed',
      data: { object: { id: 'po_cw_fail', amount: 4000, failure_code: 'invalid', failure_message: 'bank error' } },
      created: 1620000000,
      account: 'acct_cw_1',
    };

    const handler = fastify.routes['/webhooks/stripe'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(result.payload).toEqual({ received: true });
    const notif = require('../../../services/api/src/services/notification-service').notificationService;
    expect(notif.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'profile_cw_1',
      type: 'payment',
      title: expect.stringContaining('Payout Failed'),
    }));
  });
});
