/**
 * Tests that the deprecated Fastify wallet routes emit the X-Deprecated: true header
 * for all routes patched in the consolidation PR.
 *
 * Strategy: capture each route handler when registerWalletRoutes() registers them on a
 * mock Fastify instance, then invoke the handlers directly with a minimal mock
 * request/reply pair.  The handlers set reply.header(...) before any async DB work, so
 * the assertion holds even when underlying service calls fail (they are mocked).
 */

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../db/connection', () => ({ db: {} }));
jest.mock('../db/schema', () => ({ bounties: {} }));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));

jest.mock('../middleware/auth', () => ({
  authMiddleware: jest.fn(),
}));

jest.mock('../middleware/error-handler', () => ({
  ValidationError: class ValidationError extends Error {
    statusCode = 400;
  },
  ConflictError: class ConflictError extends Error {
    statusCode = 409;
  },
}));

jest.mock('../middleware/request-context', () => ({
  getRequestContext: jest.fn(() => ({ requestId: 'test-req-id' })),
  logErrorWithContext: jest.fn(),
}));

jest.mock('../services/consolidated-wallet-service', () => ({
  getBalance: jest.fn().mockResolvedValue({ balance: 100, currency: 'usd' }),
  getTransactions: jest.fn().mockResolvedValue({ transactions: [], total: 0 }),
  createDeposit: jest.fn().mockResolvedValue({ id: 'tx_dep_01', type: 'deposit', amount: 10 }),
  createWithdrawal: jest.fn().mockResolvedValue({
    id: 'tx_wd_01',
    stripe_transfer_id: 'tr_test',
  }),
  createEscrow: jest.fn().mockResolvedValue({ id: 'tx_esc_01' }),
  releaseEscrow: jest.fn().mockResolvedValue({ id: 'tx_rel_01' }),
}));

jest.mock('../services/idempotency-service', () => ({
  checkIdempotencyKey: jest.fn().mockResolvedValue(false),
  storeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
  removeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/stripe-connect-service', () => ({
  stripeConnectService: {
    getConnectStatus: jest.fn().mockResolvedValue({
      hasStripeAccount: true,
      payoutsEnabled: true,
      chargesEnabled: true,
      detailsSubmitted: true,
      stripeAccountId: 'acct_test',
      requiresAction: false,
      currentlyDue: [],
    }),
    createOnboardingLink: jest.fn().mockResolvedValue({
      url: 'https://connect.stripe.com/test',
      expiresAt: Date.now() + 3600000,
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type Handler = (req: any, reply: any) => Promise<void>;

/** Build a minimal chainable reply mock. */
function makeMockReply() {
  const reply: Record<string, jest.Mock> = {} as any;
  reply.header = jest.fn().mockReturnValue(reply);
  reply.code = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

/** Build a minimal authenticated request mock. */
function makeMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-test-123',
    user: { id: 'user-test-123' },
    query: {},
    body: {},
    log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('wallet routes — X-Deprecated header (PR consolidation patch)', () => {
  /** Handlers captured from registerWalletRoutes() */
  const handlers: Record<string, Handler> = {};
  let mockFastify: any;

  beforeAll(async () => {
    mockFastify = {
      get: jest.fn((path: string, _opts: unknown, handler: Handler) => {
        handlers[`GET:${path}`] = handler;
      }),
      post: jest.fn((path: string, _opts: unknown, handler: Handler) => {
        handlers[`POST:${path}`] = handler;
      }),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
    };

    // Load the module under test (dependencies are already mocked above)
    const { registerWalletRoutes } = require('../routes/wallet');
    await registerWalletRoutes(mockFastify);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to successful defaults so handlers complete normally
    const ws = require('../services/consolidated-wallet-service');
    ws.getBalance.mockResolvedValue({ balance: 100, currency: 'usd' });
    ws.getTransactions.mockResolvedValue({ transactions: [], total: 0 });
    ws.createDeposit.mockResolvedValue({ id: 'tx_dep_01', type: 'deposit', amount: 10 });
  });

  it('GET /wallet/balance sets reply.header("X-Deprecated", "true")', async () => {
    const handler = handlers['GET:/wallet/balance'];
    expect(handler).toBeDefined();

    const reply = makeMockReply();
    await handler(makeMockRequest(), reply);

    expect(reply.header).toHaveBeenCalledWith('X-Deprecated', 'true');
  });

  it('GET /wallet/transactions sets reply.header("X-Deprecated", "true")', async () => {
    const handler = handlers['GET:/wallet/transactions'];
    expect(handler).toBeDefined();

    const reply = makeMockReply();
    await handler(makeMockRequest({ query: {} }), reply);

    expect(reply.header).toHaveBeenCalledWith('X-Deprecated', 'true');
  });

  it('POST /wallet/deposit sets reply.header("X-Deprecated", "true")', async () => {
    const handler = handlers['POST:/wallet/deposit'];
    expect(handler).toBeDefined();

    const reply = makeMockReply();
    await handler(makeMockRequest({ body: { amount: 20, paymentIntentId: 'pi_test_123' } }), reply);

    expect(reply.header).toHaveBeenCalledWith('X-Deprecated', 'true');
  });
});
