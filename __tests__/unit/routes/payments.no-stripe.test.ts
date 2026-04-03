/**
 * Ensure payment routes register 501 fallbacks when Stripe is not configured
 */
export { };

jest.resetModules();

// Ensure Stripe env vars are not set for this isolated module load
const prevStripeKey = process.env.STRIPE_SECRET_KEY;
const prevPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PUBLISHABLE_KEY = '';

// Mock consolidated payment service to avoid loading config that expects STRIPE envs
jest.mock('../../../services/api/src/services/consolidated-payment-service', () => ({
  getOrCreateStripeCustomer: jest.fn(async () => null),
  getStripeCustomerId: jest.fn(async () => null),
}));

// Additional mocks to avoid loading other services that may read REQUIRED env vars
const mockCreateDeposit = jest.fn();
const mockGetTxByPI = jest.fn();
const mockUpdateBalance = jest.fn();

jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  createDeposit: (...args: any[]) => mockCreateDeposit(...args),
  getTransactionByPaymentIntent: (...args: any[]) => mockGetTxByPI(...args),
  updateBalance: (...args: any[]) => mockUpdateBalance(...args),
}));

// Mock auth middleware to avoid Supabase dependency in unit tests
jest.mock('../../../services/api/src/middleware/auth', () => ({
  authMiddleware: async (request: any, reply: any) => {
    request.userId = 'test-user-id';
    return;
  },
}));

const mockStripeInstance = {
  paymentIntents: { retrieve: jest.fn(), create: jest.fn(), capture: jest.fn(), confirm: jest.fn() },
  paymentMethods: { retrieve: jest.fn(), list: jest.fn(), attach: jest.fn(), detach: jest.fn() },
  transfers: { create: jest.fn() },
  webhooks: { constructEvent: jest.fn((body: any) => JSON.parse(body)) },
  tokens: { create: jest.fn() },
  customers: { create: jest.fn(), createSource: jest.fn() },
};

jest.mock('stripe', () => {
  const m = jest.fn(() => mockStripeInstance);
  return { __esModule: true, default: m, Stripe: m };
});

jest.mock('../../../services/api/src/services/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

// Minimal mock idempotency service used by the route
jest.mock('../../../services/api/src/services/idempotency-service', () => ({
  checkIdempotencyKey: jest.fn(async () => false),
  storeIdempotencyKey: jest.fn(async () => {}),
  removeIdempotencyKey: jest.fn(async () => {}),
}));

// Mock Supabase admin client used by webhook handlers
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (s?: string) => ({
        eq: (_col: string, _val: any) => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));

jest.mock('../../../services/api/src/services/notification-service', () => ({ notificationService: { createNotification: jest.fn() } }));

jest.mock('../../../services/api/src/services/stripe-connect-service', () => ({ stripeConnectService: { getConnectStatus: jest.fn(async () => ({ stripeAccountId: 'acct_test', payoutsEnabled: true })) } }));

jest.mock('../../../services/api/src/services/wallet-service', () => ({ walletService: { createTransaction: jest.fn(async () => ({})) } }));

// Minimal Fastify mock to capture registered handlers
class MockFastify {
  routes: Record<string, any> = {};

  post(path: string, handlerOrOpts: any, maybeHandler?: any) {
    const handler = typeof maybeHandler === 'function' ? maybeHandler : handlerOrOpts;
    this.routes[path] = handler;
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

describe('payments routes when Stripe not configured', () => {
  let registerPaymentRoutes: any;

  beforeAll(() => {
    // Import the module fresh so the STRIPE_* env absence is observed
    jest.resetModules();
    registerPaymentRoutes = require('../../../services/api/src/routes/payments').registerPaymentRoutes;
  });

  afterAll(() => {
    // Restore env
    if (prevStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = prevStripeKey;
    if (prevPublishable !== undefined) process.env.STRIPE_PUBLISHABLE_KEY = prevPublishable;
  });

  it('registers fallback endpoints returning 501', async () => {
    const fastify = new MockFastify();
    await registerPaymentRoutes(fastify as any);

    // Paths that should be registered with 501 handlers
    const paths = [
      '/payments/create-payment-intent',
      '/payments/create-setup-intent',
      '/payments/methods',
      '/payments/methods/:paymentMethodId',
      '/payments/confirm',
    ];

    for (const p of paths) {
      expect(typeof fastify.routes[p]).toBe('function');
      const reply = makeReply();
      // Call handler with minimal req/reply
      await fastify.routes[p]({ body: {}, headers: {} }, reply);
      expect(reply.status).toBe(501);
      expect(reply.payload).toHaveProperty('error');
      expect(String(reply.payload.error)).toMatch(/Stripe not configured/i);
    }
  });
});
