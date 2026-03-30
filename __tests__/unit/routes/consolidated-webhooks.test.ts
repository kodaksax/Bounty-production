/**
 * Unit tests for consolidated-webhooks route
 *
 * Covers payout.paid / payout.failed webhook events routed through
 * POST /webhooks/stripe in consolidated-webhooks.ts.
 *
 * config.stripe.webhookSecret MUST be set before the route module is
 * required so the guard at the top of the handler doesn't throw.
 * We satisfy this with jest.mock on the config module (Option 2 from
 * the issue analysis).
 */
export { };

// ---------------------------------------------------------------------------
// 1. Mock config — must be declared before any require of the route module
// ---------------------------------------------------------------------------
jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: {
      webhookSecret: 'test_webhook_secret',
      secretKey: 'sk_test_mock',
      connectClientId: '',
      platformFeePercent: 5,
    },
    supabase: {
      url: 'https://test.supabase.co',
      anonKey: 'test-anon-key',
      serviceRoleKey: 'test-service-role-key',
      jwtSecret: '',
    },
  },
}));

// ---------------------------------------------------------------------------
// 2. Mock Stripe — constructEvent just deserialises the raw body
// ---------------------------------------------------------------------------
jest.mock('../../../services/api/src/services/consolidated-payment-service', () => ({
  stripe: {
    webhooks: {
      constructEvent: (body: any) => JSON.parse(body),
    },
  },
}));

// ---------------------------------------------------------------------------
// 3. Mock the notification service
// ---------------------------------------------------------------------------
const mockCreateNotification = jest.fn();
jest.mock('../../../services/api/src/services/notification-service', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

// ---------------------------------------------------------------------------
// 4. Mock logger
// ---------------------------------------------------------------------------
jest.mock('../../../services/api/src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// ---------------------------------------------------------------------------
// 5. Mock wallet service (not used by payout handlers but imported by module)
// ---------------------------------------------------------------------------
jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  createDeposit: jest.fn(),
  getTransactionByPaymentIntent: jest.fn(),
  updateBalance: jest.fn(),
}));

// ---------------------------------------------------------------------------
// 6. Supabase mock
//    - stripe_events: always "not found" (PGRST116) so events are processed
//    - profiles:      returns adminData.profile when queried
// ---------------------------------------------------------------------------
const adminData: { profile: any } = { profile: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const ctx: any = {};

      const chain: any = {
        select(_s?: string) { return chain; },
        eq(col: string, val: any) {
          ctx.col = col;
          ctx.val = val;
          return chain;
        },
        upsert(_data: any, _opts?: any) { return Promise.resolve({ error: null }); },
        update(_data: any) {
          return {
            eq: (_c: string, _v: any) => Promise.resolve({ error: null }),
          };
        },
        // stripe_events single() — returns PGRST116 "not found" so event is always new
        single: async () => {
          if (table === 'stripe_events') {
            return { data: null, error: { code: 'PGRST116', message: 'not found' } };
          }
          return { data: null, error: null };
        },
        // profiles maybeSingle() — returns profile when queried by stripe_connect_account_id
        maybeSingle: async () => {
          if (table === 'profiles' && ctx.col === 'stripe_connect_account_id') {
            return { data: adminData.profile, error: null };
          }
          return { data: null, error: null };
        },
      };

      return chain;
    },
  }),
}));

// ---------------------------------------------------------------------------
// 7. Lightweight Fastify mock that captures the POST handler
//    (preParsing is ignored — tests supply rawBody directly on the request)
// ---------------------------------------------------------------------------
class MockFastify {
  routes: Record<string, (req: any, reply: any) => any> = {};
  log = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

  post(path: string, _optsOrHandler: any, maybeHandler?: any) {
    const handler = typeof maybeHandler === 'function' ? maybeHandler : _optsOrHandler;
    this.routes[path] = handler;
  }
}

function makeReply() {
  const r: any = { sent: false };
  r.code = jest.fn().mockReturnValue(r);
  r.send = jest.fn().mockImplementation((p: any) => { r.payload = p; r.sent = true; return r; });
  return r;
}

// ---------------------------------------------------------------------------
// 8. Tests
// ---------------------------------------------------------------------------
describe('POST /webhooks/stripe', () => {
  let registerConsolidatedWebhookRoutes: any;

  beforeAll(() => {
    // Route module is required AFTER all jest.mock declarations above
    registerConsolidatedWebhookRoutes =
      require('../../../services/api/src/routes/consolidated-webhooks')
        .registerConsolidatedWebhookRoutes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adminData.profile = null;
  });

  it('payout.paid sends notification to hunter', async () => {
    const fastify = new MockFastify();

    // Profile that will be returned for the connected account
    adminData.profile = { id: 'profile_hunter_1' };

    const event = {
      id: 'evt_payout_paid_1',
      type: 'payout.paid',
      account: 'acct_connect_1',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'po_paid_1',
          amount: 5000, // $50.00
          destination: 'ba_test_1',
          failure_code: null,
          failure_message: null,
        },
      },
    };

    await registerConsolidatedWebhookRoutes(fastify as any);

    const handler = fastify.routes['/webhooks/stripe'];
    const req: any = {
      headers: { 'stripe-signature': 'sig_test' },
      rawBody: JSON.stringify(event),
    };
    const reply = makeReply();

    const result = await handler(req, reply);

    // Route should reply with { received: true }
    expect(reply.payload).toMatchObject({ received: true });

    // Notification must be sent to the hunter
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'profile_hunter_1',
        type: 'payment',
        title: expect.stringContaining('Payout Successful'),
      }),
    );
  });

  it('payout.failed notifies hunter and flags event', async () => {
    const fastify = new MockFastify();

    adminData.profile = { id: 'profile_hunter_2' };

    const event = {
      id: 'evt_payout_failed_1',
      type: 'payout.failed',
      account: 'acct_connect_2',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'po_fail_1',
          amount: 4000, // $40.00
          destination: 'ba_test_2',
          failure_code: 'acct_invalid',
          failure_message: 'Bank account invalid',
        },
      },
    };

    await registerConsolidatedWebhookRoutes(fastify as any);

    const handler = fastify.routes['/webhooks/stripe'];
    const req: any = {
      headers: { 'stripe-signature': 'sig_test' },
      rawBody: JSON.stringify(event),
    };
    const reply = makeReply();

    const result = await handler(req, reply);

    expect(reply.payload).toMatchObject({ received: true });

    // Notification must be sent to the hunter
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'profile_hunter_2',
        type: 'payment',
        title: expect.stringContaining('Payout Failed'),
      }),
    );
  });
});
