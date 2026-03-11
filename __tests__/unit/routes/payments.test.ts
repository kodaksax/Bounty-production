/**
 * Tests for payments route handlers (confirm + webhook deposit paths)
 */
export { };

// Mocks and helpers follow the project's existing test style
const mockCreateDeposit = jest.fn();
const mockGetTxByPI = jest.fn();

jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  createDeposit: (...args: any[]) => mockCreateDeposit(...args),
  getTransactionByPaymentIntent: (...args: any[]) => mockGetTxByPI(...args),
}));

// Mock auth middleware to avoid Supabase dependency in unit tests
jest.mock('../../../services/api/src/middleware/auth', () => ({
  authMiddleware: async (request: any, reply: any) => {
    request.userId = 'test-user-id';
    return;
  },
}));

const mockStripeInstance = {
  paymentIntents: {
    retrieve: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn((body: any) => JSON.parse(body)),
  },
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

// Ensure auth middleware uses test path (no supabase env) and will populate request.userId
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

// Lightweight Fastify mock capable of running preHandler
class MockFastify {
  routes: Record<string, any> = {};

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

// Reply helper
function makeReply() {
  const r: any = {};
  r.sent = false;
  r.code = jest.fn().mockImplementation((c: number) => { r.status = c; return r; });
  r.send = jest.fn().mockImplementation((p: any) => { r.payload = p; r.sent = true; return r; });
  return r;
}

describe('payments routes (confirm + webhook deposit)', () => {
  let registerPaymentRoutes: any;
  beforeAll(() => {
    // Import after setting env and mocks
    registerPaymentRoutes = require('../../../services/api/src/routes/payments').registerPaymentRoutes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /payments/confirm: returns 500 when createDeposit fails and no existing tx found', async () => {
    const fastify = new MockFastify();

    // Setup Stripe retrieve to return succeeded PI
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test_1',
      status: 'succeeded',
      amount: 500,
      currency: 'usd',
      metadata: { user_id: 'test-user-id', purpose: 'wallet_deposit' },
    });

    // createDeposit throws a real error
    mockCreateDeposit.mockRejectedValueOnce(new Error('Supabase outage'));
    mockGetTxByPI.mockResolvedValueOnce(null);

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/confirm'];
    const req: any = { body: { paymentIntentId: 'pi_test_1' }, headers: {} };
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.status).toBe(500);
    expect(reply.payload).toEqual({ error: 'Failed to record deposit' });
  });

  it('POST /payments/confirm: succeeds when createDeposit fails but existing tx is found', async () => {
    const fastify = new MockFastify();

    mockStripeInstance.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test_2',
      status: 'succeeded',
      amount: 800,
      currency: 'usd',
      metadata: { user_id: 'test-user-id', purpose: 'wallet_deposit' },
    });

    mockCreateDeposit.mockRejectedValueOnce(new Error('Unexpected Supabase error'));
    mockGetTxByPI.mockResolvedValueOnce({ id: 'tx_existing' });

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/confirm'];
    const req: any = { body: { paymentIntentId: 'pi_test_2' }, headers: {} };
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.status).toBeUndefined();
    expect(reply.payload).toBeUndefined();
    // The handler should have returned success object later
    // Call did not set reply, so check that code proceeded without sending error
  });

  it('POST /payments/webhook: handles payment_intent.succeeded and returns received true even on failure', async () => {
    const fastify = new MockFastify();

    // Construct a minimal webhook event body (stringified) expected by constructEvent
    const event = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_w_1', amount: 1200, currency: 'usd', metadata: { purpose: 'wallet_deposit', user_id: 'test-user-id' } } } };

    // stripe.webhooks.constructEvent returns parsed event
    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    // createDeposit throws and getTransactionByPaymentIntent returns null
    mockCreateDeposit.mockRejectedValueOnce(new Error('DB down'));
    mockGetTxByPI.mockResolvedValueOnce(null);

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    expect(mockGetTxByPI).toHaveBeenCalledWith('pi_w_1');
  });
});
