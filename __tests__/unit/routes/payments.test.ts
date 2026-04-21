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

// Track RPC calls so tests can assert dispute handlers invoked the right ones
const mockRpc = jest.fn(async (_fn: string, _args: any) => ({ data: null, error: null }));
// Track recorded dispute row inserts so tests can assert metadata was logged
const recordedDisputeInserts: any[] = [];
const recordedNotificationInserts: any[] = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: any) => mockRpc(fn, args),
    from: (table: string) => {
      return (() => {
        const ctx: any = { _select: undefined, _eq: undefined, _in: undefined, _update: undefined };

        const obj: any = {
          select(selectStr?: string, _opts?: any) {
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

            // Dispute closed: .update().eq(stripe_dispute_id).select(initiator_id).maybeSingle()
            if (table === 'bounty_disputes' && ctx._update) {
              return { data: adminData.resolvedDispute ?? null, error: adminData.updateError };
            }

            // Bounty disputes lookup by stripe_dispute_id (charge.dispute.created)
            if (table === 'bounty_disputes' && ctx._eq?.some((e: any) => e[0] === 'stripe_dispute_id')) {
              return { data: adminData.existingDispute ?? null, error: null };
            }

            // Dispute closed: idempotency lookup for existing dispute_loss tx
            if (table === 'wallet_transactions' && ctx._eq?.some((e: any) => e[0] === 'type' && e[1] === 'dispute_loss')) {
              return { data: adminData.existingDisputeLossTx ?? null, error: null };
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
          // Support `await .eq().eq(...)` returning a terminal {count,error} for count queries
          then(resolve: any) {
            // Counting open stripe disputes (charge.dispute.closed won branch)
            if (table === 'bounty_disputes' && ctx._select === 'id') {
              return resolve({ count: adminData.remainingOpenCount ?? 0, error: null });
            }
            // Default: the update chain (e.g. profiles.update().eq()) — resolves to {error}
            if (ctx._update) {
              return resolve({ error: adminData.updateError });
            }
            return resolve({ data: null, error: null });
          },
          upsert: async () => ({ error: adminData.upsertError }),
          insert: async (row: any) => {
            if (table === 'bounty_disputes') recordedDisputeInserts.push(row);
            if (table === 'notifications') recordedNotificationInserts.push(row);
            return { error: adminData.insertError };
          },
          update: (updateObj: any) => {
            ctx._update = updateObj;
            return obj;
          },
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

    // Preserve previous admin mock and set profile for this test
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

    // Restore admin mock
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

    // Ensure no profile found
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

  it('POST /payments/webhook: handles charge.dispute.created by recording dispute, freezing wallet, and notifying user', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_dispute_created_1',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_1',
          charge: 'ch_disp_1',
          payment_intent: 'pi_disp_1',
          amount: 5000,
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    };

    // wallet_transaction lookup returns the originating poster
    const prevOriginal = adminData.originalTx;
    adminData.originalTx = { user_id: 'poster_user_1' };
    adminData.existingDispute = null;
    adminData.insertError = null;
    adminData.updateError = null;
    recordedDisputeInserts.length = 0;
    recordedNotificationInserts.length = 0;

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });

    // Dispute metadata logged for manual review
    expect(recordedDisputeInserts).toHaveLength(1);
    expect(recordedDisputeInserts[0]).toMatchObject({
      initiator_id: 'poster_user_1',
      status: 'stripe_dispute',
      stripe_dispute_id: 'dp_1',
      stripe_payment_intent_id: 'pi_disp_1',
      dispute_stage: 'cancellation',
    });

    // Poster notified of the freeze
    expect(recordedNotificationInserts).toHaveLength(1);
    expect(recordedNotificationInserts[0]).toMatchObject({
      user_id: 'poster_user_1',
      type: 'payment',
      title: 'Payment Dispute Opened',
      data: { stripeDisputeId: 'dp_1' },
    });

    adminData.originalTx = prevOriginal;
  });

  it('POST /payments/webhook: charge.dispute.created with no matching wallet_transaction is a no-op', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_dispute_created_orphan',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_orphan',
          charge: 'ch_orphan',
          payment_intent: 'pi_orphan',
          amount: 1000,
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    };

    const prevOriginal = adminData.originalTx;
    adminData.originalTx = null;
    recordedDisputeInserts.length = 0;
    recordedNotificationInserts.length = 0;

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    // Should not have created a bounty_disputes row or notification
    expect(recordedDisputeInserts).toHaveLength(0);
    expect(recordedNotificationInserts).toHaveLength(0);

    adminData.originalTx = prevOriginal;
  });

  it('POST /payments/webhook: handles charge.dispute.closed (won) by unfreezing wallet when no other open disputes', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_dispute_closed_won',
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_won_1',
          charge: 'ch_won_1',
          payment_intent: 'pi_won_1',
          amount: 2500,
          status: 'won',
        },
      },
    };

    adminData.resolvedDispute = { initiator_id: 'poster_user_2' };
    adminData.remainingOpenCount = 0;
    recordedNotificationInserts.length = 0;
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'unfreeze_profile_if_no_open_disputes') return { data: true, error: null };
      return { data: null, error: null };
    });

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    expect(mockRpc).toHaveBeenCalledWith('unfreeze_profile_if_no_open_disputes', {
      p_user_id: 'poster_user_2',
    });
    expect(recordedNotificationInserts).toHaveLength(1);
    expect(recordedNotificationInserts[0]).toMatchObject({
      user_id: 'poster_user_2',
      title: 'Dispute Resolved — Won',
    });
  });

  it('POST /payments/webhook: handles charge.dispute.closed (lost) by applying dispute loss RPC and notifying user', async () => {
    const fastify = new MockFastify();

    const event = {
      id: 'evt_dispute_closed_lost',
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_lost_1',
          charge: 'ch_lost_1',
          payment_intent: 'pi_lost_1',
          amount: 7500,
          status: 'lost',
        },
      },
    };

    adminData.resolvedDispute = { initiator_id: 'poster_user_3' };
    adminData.existingDisputeLossTx = null;
    recordedNotificationInserts.length = 0;
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'apply_dispute_loss_transaction') return { data: null, error: null };
      return { data: null, error: null };
    });

    mockStripeInstance.webhooks.constructEvent.mockImplementation((body: any) => JSON.parse(body));

    await registerPaymentRoutes(fastify as any);

    const handler = fastify.routes['/payments/webhook'];
    const req: any = { headers: { 'stripe-signature': 'sig' }, rawBody: JSON.stringify(event) };

    const result = await handler(req, {});

    expect(result).toEqual({ received: true });
    expect(mockRpc).toHaveBeenCalledWith(
      'apply_dispute_loss_transaction',
      expect.objectContaining({
        p_user_id: 'poster_user_3',
        p_amount: -75,
        p_stripe_dispute_id: 'dp_lost_1',
        p_stripe_payment_intent_id: 'pi_lost_1',
      })
    );
    expect(recordedNotificationInserts).toHaveLength(1);
    expect(recordedNotificationInserts[0]).toMatchObject({
      user_id: 'poster_user_3',
      title: 'Dispute Resolved — Lost',
    });
  });
});
