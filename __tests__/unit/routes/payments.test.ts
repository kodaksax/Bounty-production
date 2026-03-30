/**
 * Tests for payments route handlers (confirm + webhook deposit paths)
 */
export { };

// Mocks and helpers follow the project's existing test style
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
  paymentIntents: {
    retrieve: jest.fn(),
    capture: jest.fn(),
  },
  paymentMethods: {
    retrieve: jest.fn(),
  },
  transfers: {
    create: jest.fn(),
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

jest.mock('../../../services/api/src/services/notification-service', () => ({
  notificationService: { createNotification: jest.fn(async () => {}) },
}));

// Minimal mock idempotency service used by the route
jest.mock('../../../services/api/src/services/idempotency-service', () => ({
  checkIdempotencyKey: jest.fn(async () => false),
  storeIdempotencyKey: jest.fn(async () => {}),
  removeIdempotencyKey: jest.fn(async () => {}),
}));

// Mock Supabase admin client used by webhook handlers
// Mock Notification service
const mockCreateNotification = jest.fn();
jest.mock('../../../services/api/src/services/notification-service', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

const adminData: any = {
  // Filled by tests as needed
  originalTx: null,
  txFetchError: null,
  processedRefunds: [],
  upsertError: null,
  insertError: null,
  updateError: null,
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      return (() => {
        const ctx: any = { _select: undefined, _eq: undefined, _in: undefined };

        const obj: any = {
          select(selectStr?: string) {
            ctx._select = selectStr;
            return obj;
          },
          eq(col: string, val: any) {
            ctx._eq = ctx._eq || [];
            ctx._eq.push([col, val]);

            // Return the chainable query object so callers can call .maybeSingle() directly
            return obj;
          },
          in(field: string, vals: any[]) {
            ctx._in = [field, vals];
            return {
              maybeSingle: async () => {
                if (table === 'wallet_transactions' && ctx._eq?.some((e: any) => e[0] === 'stripe_payment_intent_id')) {
                  return { data: adminData.originalTx, error: adminData.txFetchError };
                }
                return { data: null };
              }
            };
          },
          maybeSingle: async () => {
            // If fetching processed refund metadata for a charge
            if (table === 'wallet_transactions' && ctx._select === 'metadata' && ctx._eq?.some((e: any) => e[0] === 'stripe_charge_id')) {
              return { data: adminData.processedRefunds };
            }

            // If fetching original transaction by payment intent
            if (table === 'wallet_transactions' && ctx._eq?.some((e: any) => e[0] === 'stripe_payment_intent_id')) {
              return { data: adminData.originalTx, error: adminData.txFetchError };
            }

            // Profiles lookup uses the same maybeSingle path in tests; return adminData.originalTx when appropriate
            if (table === 'profiles') {
              return { data: adminData.originalTx, error: adminData.txFetchError };
            }

            return { data: null };
          },
          upsert: async () => ({ error: adminData.upsertError }),
          insert: async () => ({ error: adminData.insertError }),
          update: (_obj: any) => ({
            eq: (_col: string, _val: any) => ({
              eq: (_col2: string, _val2: any) => Promise.resolve({ error: adminData.updateError }),
            }),
          }),
        };

        return obj;
      })();
    }
  })
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

  it('POST /payments/webhook: handles setup_intent.succeeded and saves payment method', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_setup_1',
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'si_1',
          metadata: { user_id: 'test-user-id' },
          payment_method: 'pm_1',
        }
      }
    };

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));
    mockStripeInstance.paymentMethods.retrieve.mockResolvedValueOnce({
      id: 'pm_1',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2026 }
    });

    // Ensure Supabase upsert returns no error
    adminData.upsertError = null;

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    expect(mockStripeInstance.paymentMethods.retrieve).toHaveBeenCalledWith('pm_1');
  });

  it('POST /payments/webhook: handles charge.refunded and records refund + updates balance', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_ref_1',
          refunds: { data: [ { id: 're_1', amount: 200, reason: 'requested_by_customer' } ] }
        }
      }
    };

    // Setup admin data for original transaction lookup
    adminData.originalTx = { id: 'orig_tx_1', user_id: 'user_123', amount: 5, type: 'deposit' };
    adminData.processedRefunds = [];
    adminData.insertError = null;
    adminData.txFetchError = null;

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));
    mockUpdateBalance.mockResolvedValueOnce(undefined);

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    // Refund amount is 200 cents => $2.00; updateBalance receives negative dollars
    expect(mockUpdateBalance).toHaveBeenCalledWith('user_123', -2);
  });

  it('POST /payments/webhook: handles payout.paid and sends notification', async () => {
    const fastify = new MockFastify();

    const event: any = {
      id: 'evt_payout_paid_1',
      type: 'payout.paid',
      data: { object: { id: 'po_1', amount: 2500 } },
      account: 'acct_connect_1',
    };

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    // Make profile lookup return a profile id
    adminData.originalTx = { id: 'profile_abc' };
    adminData.txFetchError = null;

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    const notif = require('../../../services/api/src/services/notification-service').notificationService;
    expect(notif.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'profile_abc',
      type: 'payment',
      title: expect.stringContaining('Payout Successful'),
    }));
  });

  it('POST /payments/webhook: handles payout.failed and notifies & flags account', async () => {
    const fastify = new MockFastify();

    const event: any = {
      id: 'evt_payout_failed_1',
      type: 'payout.failed',
      data: { object: { id: 'po_fail_1', amount: 4000, failure_code: 'acct_invalid', failure_message: 'Bank account invalid' } },
      account: 'acct_connect_2',
    };

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    adminData.originalTx = { id: 'profile_def' };
    adminData.txFetchError = null;
    adminData.updateError = null;

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    const notif2 = require('../../../services/api/src/services/notification-service').notificationService;
    expect(notif2.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'profile_def',
      type: 'payment',
      title: expect.stringContaining('Payout Failed'),
    }));
  });

  it('POST /payments/webhook: handles account.updated and syncs profile and sends notification when requirements changed', async () => {
    const fastify = new MockFastify();

    const account = {
      id: 'acct_test_777',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: ['id_document'] },
    };

    const profile = {
      id: 'profile_user_1',
      stripe_connect_onboarded_at: null,
      stripe_connect_requirements: { currently_due: [] },
    };

    const prevOriginal = adminData.originalTx;
    adminData.originalTx = profile;
    adminData.updateError = null;

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    const event = {
      id: 'evt_account_1',
      type: 'account.updated',
      data: { object: account },
    };

    const { notificationService } = require('../../../services/api/src/services/notification-service');

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: profile.id,
      type: 'payment',
      data: { currentlyDue: account.requirements.currently_due, accountId: account.id },
    }));

    adminData.originalTx = prevOriginal;
  });

  it('POST /payments/webhook: handles account.updated with no profile found', async () => {
    const fastify = new MockFastify();

    const account = {
      id: 'acct_no_profile',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: [] },
    };

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    const prevOriginal = adminData.originalTx;
    adminData.originalTx = null;

    const event = { id: 'evt_account_2', type: 'account.updated', data: { object: account } };

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});
    expect(result).toEqual({ received: true });

    adminData.originalTx = prevOriginal;
  });
});
