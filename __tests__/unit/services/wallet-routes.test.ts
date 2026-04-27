/**
 * Unit tests for wallet route handlers (services/api/src/routes/wallet.ts)
 *
 * Uses a lightweight mock-Fastify pattern: `registerWalletRoutes` is called
 * with a mock object that captures handler functions by route path+method.
 * Each handler is then invoked directly with mock request/reply objects.
 * All service dependencies are fully mocked so no network / DB calls are made.
 */

export { };

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports
// ---------------------------------------------------------------------------

jest.mock('../../../services/api/src/db/connection', () => ({ db: {} }));
jest.mock('../../../services/api/src/db/schema', () => ({ bounties: 'bounties' }));

jest.mock('../../../services/api/src/middleware/auth', () => ({
  authMiddleware: jest.fn(),
}));

jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ValidationError: class ValidationError extends Error {
    statusCode = 400;
    constructor(m: string) {
      super(m);
      this.name = 'ValidationError';
    }
  },
  ConflictError: class ConflictError extends Error {
    statusCode = 409;
    constructor(m: string) {
      super(m);
      this.name = 'ConflictError';
    }
  },
}));

jest.mock('../../../services/api/src/middleware/request-context', () => ({
  getRequestContext: jest.fn(() => ({ requestId: 'test-req-id' })),
  logErrorWithContext: jest.fn(),
}));

jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  getBalance: jest.fn(),
  getTransactions: jest.fn(),
  createDeposit: jest.fn(),
  createWithdrawal: jest.fn(),
  createEscrow: jest.fn(),
  releaseEscrow: jest.fn(),
  refundEscrow: jest.fn(),
}));

jest.mock('../../../services/api/src/services/idempotency-service', () => ({
  checkIdempotencyKey: jest.fn(),
  storeIdempotencyKey: jest.fn(),
  removeIdempotencyKey: jest.fn(),
}));

jest.mock('../../../services/api/src/services/stripe-connect-service', () => ({
  stripeConnectService: {
    getConnectStatus: jest.fn(),
    createOnboardingLink: jest.fn(),
  },
}));

jest.mock('../../../services/api/src/services/consolidated-stripe-connect-service', () => ({
  consolidatedStripeConnectService: {
    addBankAccount: jest.fn(),
    listBankAccounts: jest.fn(),
    removeBankAccount: jest.fn(),
    setDefaultBankAccount: jest.fn(),
  },
}));

// drizzle-orm eq — used in release/refund to query bounty creator
jest.mock('drizzle-orm', () => ({ eq: jest.fn((field: any, val: any) => ({ field, val })) }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerWalletRoutes } from '../../../services/api/src/routes/wallet';
import * as WalletService from '../../../services/api/src/services/consolidated-wallet-service';
import {
  checkIdempotencyKey,
  removeIdempotencyKey,
  storeIdempotencyKey,
} from '../../../services/api/src/services/idempotency-service';
import { stripeConnectService } from '../../../services/api/src/services/stripe-connect-service';

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Fastify instance and register routes
// ---------------------------------------------------------------------------

type RouteHandler = (req: any, reply: any) => Promise<any>;
type HandlerMap = Record<string, RouteHandler>;

async function buildHandlers(): Promise<HandlerMap> {
  const handlers: HandlerMap = {};

  const registerRoute =
    (method: string) => (path: string, _optsOrHandler: any, handlerArg?: any) => {
      // fastify.get(path, opts, handler) OR fastify.get(path, handler)
      const handler = typeof _optsOrHandler === 'function' ? _optsOrHandler : handlerArg;
      handlers[`${method.toUpperCase()}:${path}`] = handler;
    };

  const mockFastify: any = {
    get: registerRoute('GET'),
    post: registerRoute('POST'),
    delete: registerRoute('DELETE'),
    put: registerRoute('PUT'),
  };

  await registerWalletRoutes(mockFastify);
  return handlers;
}

/** Build a minimal mock reply object. Fluent: `.code(n)` and `.header(...)` return itself. */
function mockReply() {
  const reply: any = {
    _code: 200,
    _body: undefined,
    _headers: {} as Record<string, string>,
    header(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
    code(n: number) {
      this._code = n;
      return this;
    },
    send(body: any) {
      this._body = body;
      return this;
    },
  };
  return reply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let handlers: HandlerMap;

beforeAll(async () => {
  handlers = await buildHandlers();
});

beforeEach(() => {
  jest.clearAllMocks();
  (checkIdempotencyKey as jest.Mock).mockResolvedValue(false);
  (storeIdempotencyKey as jest.Mock).mockResolvedValue(undefined);
  (removeIdempotencyKey as jest.Mock).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
describe('GET /wallet/balance', () => {
  it('returns balance and currency', async () => {
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 100.5, currency: 'usd' });
    const req = { userId: 'user-1' };
    const reply = mockReply();
    const result = await handlers['GET:/wallet/balance'](req, reply);
    expect(result).toEqual({ balance: 100.5, balanceCents: 10050, currency: 'usd' });
  });

  it('returns 401 when userId is missing', async () => {
    const req = { userId: undefined };
    const reply = mockReply();
    await handlers['GET:/wallet/balance'](req, reply);
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    (WalletService.getBalance as jest.Mock).mockRejectedValue(new Error('DB error'));
    const req = { userId: 'user-1' };
    const reply = mockReply();
    await handlers['GET:/wallet/balance'](req, reply);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('GET /wallet/transactions', () => {
  it('returns paginated transactions', async () => {
    (WalletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          type: 'deposit',
          amount: 50,
          created_at: '2024-01-01',
          description: 'Deposit',
          bounty_id: null,
          status: 'completed',
          stripe_transfer_id: null,
          metadata: {},
        },
      ],
      total: 1,
    });

    const req = { userId: 'user-1', query: { page: '1', limit: '10' } };
    const reply = mockReply();
    const result = await handlers['GET:/wallet/transactions'](req, reply);

    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(WalletService.getTransactions).toHaveBeenCalledWith('user-1', {
      type: undefined,
      limit: 10,
      offset: 0,
    });
  });

  it('applies type filter from query params', async () => {
    (WalletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [],
      total: 0,
    });
    const req = { userId: 'user-1', query: { type: 'withdrawal' } };
    const reply = mockReply();
    await handlers['GET:/wallet/transactions'](req, reply);
    expect(WalletService.getTransactions).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'withdrawal' })
    );
  });

  it('returns 401 when userId missing', async () => {
    const req = { userId: undefined, query: {} };
    const reply = mockReply();
    await handlers['GET:/wallet/transactions'](req, reply);
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    (WalletService.getTransactions as jest.Mock).mockRejectedValue(new Error('fail'));
    const req = { userId: 'user-1', query: {} };
    const reply = mockReply();
    await handlers['GET:/wallet/transactions'](req, reply);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /wallet/deposit', () => {
  const makeReq = (overrides = {}) => ({
    userId: 'user-1',
    body: { amount: 50, paymentIntentId: 'pi_test', idempotencyKey: 'idem-key-1', ...overrides },
  });

  it('creates a deposit successfully', async () => {
    const tx = { id: 'tx-1', amount: 50, type: 'deposit' };
    (WalletService.createDeposit as jest.Mock).mockResolvedValue(tx);

    const result = await handlers['POST:/wallet/deposit'](makeReq(), mockReply());
    expect(result).toEqual({ success: true, transaction: tx });
    expect(storeIdempotencyKey).toHaveBeenCalledWith('idem-key-1');
  });

  it('returns 409 on duplicate idempotency key', async () => {
    (checkIdempotencyKey as jest.Mock).mockResolvedValue(true);
    const reply = mockReply();
    await handlers['POST:/wallet/deposit'](makeReq(), reply);
    expect(reply._code).toBe(409);
    expect(WalletService.createDeposit).not.toHaveBeenCalled();
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/deposit']({ userId: undefined, body: { amount: 50 } }, reply);
    expect(reply._code).toBe(401);
  });

  it('removes idempotency key and returns 500 on service error', async () => {
    (WalletService.createDeposit as jest.Mock).mockRejectedValue(new Error('DB fail'));
    const reply = mockReply();
    await handlers['POST:/wallet/deposit'](makeReq(), reply);
    expect(removeIdempotencyKey).toHaveBeenCalledWith('idem-key-1');
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /wallet/withdraw', () => {
  const connectReady = {
    hasStripeAccount: true,
    payoutsEnabled: true,
    stripeAccountId: 'acct_test',
  };

  const makeReq = (overrides = {}) => ({
    userId: 'user-1',
    body: { amount: 15, destination: 'acct_test', ...overrides },
  });

  it('creates a withdrawal successfully', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue(connectReady);
    (WalletService.createWithdrawal as jest.Mock).mockResolvedValue({ id: 'tx-w1', amount: -15 });
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 85 });

    const result = await handlers['POST:/wallet/withdraw'](makeReq(), mockReply());
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(85);
  });

  it('returns 400 when Connect account not ready', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue({
      hasStripeAccount: false,
      payoutsEnabled: false,
    });
    const reply = mockReply();
    await handlers['POST:/wallet/withdraw'](makeReq(), reply);
    expect(reply._code).toBe(400);
    expect(reply._body).toMatchObject({ requiresOnboarding: true });
  });

  it('returns 400 when no destination available', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue({
      hasStripeAccount: true,
      payoutsEnabled: true,
      stripeAccountId: null,
    });
    const reply = mockReply();
    await handlers['POST:/wallet/withdraw']({ userId: 'user-1', body: { amount: 15 } }, reply);
    expect(reply._code).toBe(400);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/withdraw']({ userId: undefined, body: { amount: 15 } }, reply);
    expect(reply._code).toBe(401);
  });

  it('surfaces statusCode from thrown errors', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue(connectReady);
    const err: any = new Error('Insufficient balance');
    err.statusCode = 422;
    (WalletService.createWithdrawal as jest.Mock).mockRejectedValue(err);
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 0 });

    const reply = mockReply();
    await handlers['POST:/wallet/withdraw'](makeReq(), reply);
    expect(reply._code).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('POST /connect/verify-onboarding', () => {
  it('returns onboarding status', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue({
      hasStripeAccount: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
      chargesEnabled: true,
      stripeAccountId: 'acct_test',
      requiresAction: false,
      currentlyDue: [],
    });
    const req = { userId: 'user-1' };
    const result = await handlers['POST:/connect/verify-onboarding'](req, mockReply());
    expect(result.onboarded).toBe(true);
    expect(result.accountId).toBe('acct_test');
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/verify-onboarding']({ userId: undefined }, reply);
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockRejectedValue(new Error('down'));
    const reply = mockReply();
    await handlers['POST:/connect/verify-onboarding']({ userId: 'user-1' }, reply);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /connect/create-account-link', () => {
  it('returns onboarding link', async () => {
    (stripeConnectService.createOnboardingLink as jest.Mock).mockResolvedValue({
      url: 'https://connect.stripe.com/setup/e/...',
      expiresAt: '2024-12-31T00:00:00Z',
    });
    const req = {
      userId: 'user-1',
      body: { returnUrl: 'https://app/return', refreshUrl: 'https://app/refresh' },
    };
    const result = await handlers['POST:/connect/create-account-link'](req, mockReply());
    expect(result.url).toContain('stripe.com');
    expect(result.expiresAt).toBeDefined();
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/create-account-link']({ userId: undefined, body: {} }, reply);
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    (stripeConnectService.createOnboardingLink as jest.Mock).mockRejectedValue(
      new Error('Stripe error')
    );
    const reply = mockReply();
    await handlers['POST:/connect/create-account-link']({ userId: 'user-1', body: {} }, reply);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /connect/transfer', () => {
  const connectReady = {
    hasStripeAccount: true,
    payoutsEnabled: true,
    stripeAccountId: 'acct_transfer',
  };

  const makeReq = (overrides = {}) => ({
    userId: 'user-1',
    body: { amount: 20, ...overrides },
  });

  it('creates a transfer successfully', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue(connectReady);
    (WalletService.createWithdrawal as jest.Mock).mockResolvedValue({
      id: 'tx-t1',
      stripe_transfer_id: 'tr_test',
      amount: -20,
    });
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 80 });

    const result = await handlers['POST:/connect/transfer'](makeReq(), mockReply());
    expect(result.success).toBe(true);
    expect(result.transferId).toBe('tr_test');
    expect(result.newBalance).toBe(80);
  });

  it('returns 409 on duplicate idempotency key', async () => {
    (checkIdempotencyKey as jest.Mock).mockResolvedValue(true);
    const reply = mockReply();
    await handlers['POST:/connect/transfer'](makeReq({ idempotencyKey: 'k1' }), reply);
    expect(reply._code).toBe(409);
  });

  it('returns 400 when Connect not ready', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue({
      hasStripeAccount: false,
      payoutsEnabled: false,
    });
    const reply = mockReply();
    await handlers['POST:/connect/transfer'](makeReq(), reply);
    expect(reply._code).toBe(400);
  });

  it('returns 400 on ValidationError', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue(connectReady);
    const { ValidationError } = require('../../../services/api/src/middleware/error-handler');
    (WalletService.createWithdrawal as jest.Mock).mockRejectedValue(
      new ValidationError('Invalid amount')
    );
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 0 });

    const reply = mockReply();
    await handlers['POST:/connect/transfer'](makeReq(), reply);
    expect(reply._code).toBe(400);
    expect(reply._body).toMatchObject({ error: 'Invalid amount' });
  });

  it('returns 409 on ConflictError', async () => {
    (stripeConnectService.getConnectStatus as jest.Mock).mockResolvedValue(connectReady);
    const { ConflictError } = require('../../../services/api/src/middleware/error-handler');
    (WalletService.createWithdrawal as jest.Mock).mockRejectedValue(
      new ConflictError('Duplicate withdrawal')
    );
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 0 });

    const reply = mockReply();
    await handlers['POST:/connect/transfer'](makeReq(), reply);
    expect(reply._code).toBe(409);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/transfer']({ userId: undefined, body: { amount: 20 } }, reply);
    expect(reply._code).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /wallet/escrow', () => {
  const makeReq = (overrides = {}) => ({
    userId: 'user-1',
    body: {
      bountyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      amount: 25,
      ...overrides,
    },
  });

  it('creates escrow successfully', async () => {
    (WalletService.createEscrow as jest.Mock).mockResolvedValue({ id: 'tx-esc', amount: 25 });
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 75 });

    const result = await handlers['POST:/wallet/escrow'](makeReq(), mockReply());
    expect(result.success).toBe(true);
    expect(result.amount).toBe(25);
    expect(result.newBalance).toBe(75);
  });

  it('returns 409 on duplicate idempotency key', async () => {
    (checkIdempotencyKey as jest.Mock).mockResolvedValue(true);
    const reply = mockReply();
    await handlers['POST:/wallet/escrow'](makeReq({ idempotencyKey: 'k2' }), reply);
    expect(reply._code).toBe(409);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/escrow'](
      { userId: undefined, body: { bountyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', amount: 25 } },
      reply
    );
    expect(reply._code).toBe(401);
  });

  it('propagates statusCode from service error', async () => {
    const err: any = new Error('Insufficient funds');
    err.statusCode = 402;
    (WalletService.createEscrow as jest.Mock).mockRejectedValue(err);
    (WalletService.getBalance as jest.Mock).mockResolvedValue({ balance: 0 });
    const reply = mockReply();
    await handlers['POST:/wallet/escrow'](makeReq(), reply);
    expect(reply._code).toBe(402);
    expect(reply._body).toMatchObject({ error: 'Insufficient funds' });
  });
});

// ---------------------------------------------------------------------------
describe('POST /wallet/release', () => {
  // db.select().from(bounties).where(...).limit(1)
  function mockDbSelect(rows: any[]) {
    const { db } = require('../../../services/api/src/db/connection');
    db.select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    });
  }

  const makeReq = (overrides = {}) => ({
    userId: 'creator-1',
    body: { bountyId: 'bounty-abc', hunterId: 'hunter-1', ...overrides },
  });

  it('releases escrow when requester is bounty creator', async () => {
    mockDbSelect([{ id: 'bounty-abc', creator_id: 'creator-1' }]);
    (WalletService.releaseEscrow as jest.Mock).mockResolvedValue({ id: 'tx-rel', amount: 30 });

    const result = await handlers['POST:/wallet/release'](makeReq(), mockReply());
    expect(result.success).toBe(true);
    expect(result.releaseAmount).toBe(30);
  });

  it('returns 403 when requester is not bounty creator', async () => {
    mockDbSelect([{ id: 'bounty-abc', creator_id: 'other-user' }]);
    const reply = mockReply();
    await handlers['POST:/wallet/release'](makeReq(), reply);
    expect(reply._code).toBe(403);
  });

  it('returns 403 when bounty not found', async () => {
    mockDbSelect([]);
    const reply = mockReply();
    await handlers['POST:/wallet/release'](makeReq(), reply);
    expect(reply._code).toBe(403);
  });

  it('returns 400 when bountyId or hunterId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/release'](
      { userId: 'creator-1', body: { bountyId: 'b', hunterId: '' } },
      reply
    );
    expect(reply._code).toBe(400);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/release'](
      { userId: undefined, body: { bountyId: 'b', hunterId: 'h' } },
      reply
    );
    expect(reply._code).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /wallet/refund', () => {
  function mockDbSelect(rows: any[]) {
    const { db } = require('../../../services/api/src/db/connection');
    db.select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    });
  }

  const makeReq = (overrides = {}) => ({
    userId: 'creator-1',
    body: { bountyId: 'bounty-xyz', reason: 'Testing', ...overrides },
  });

  it('refunds escrow when requester is bounty creator', async () => {
    mockDbSelect([{ id: 'bounty-xyz', creator_id: 'creator-1' }]);
    (WalletService.refundEscrow as jest.Mock).mockResolvedValue({ id: 'tx-ref', amount: 20 });

    const result = await handlers['POST:/wallet/refund'](makeReq(), mockReply());
    expect(result.success).toBe(true);
    expect(result.amount).toBe(20);
  });

  it('returns 403 when requester is not creator', async () => {
    mockDbSelect([{ id: 'bounty-xyz', creator_id: 'another-user' }]);
    const reply = mockReply();
    await handlers['POST:/wallet/refund'](makeReq(), reply);
    expect(reply._code).toBe(403);
  });

  it('returns 400 when bountyId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/refund']({ userId: 'creator-1', body: { bountyId: '' } }, reply);
    expect(reply._code).toBe(400);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/wallet/refund']({ userId: undefined, body: { bountyId: 'b' } }, reply);
    expect(reply._code).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /connect/bank-accounts (deprecated — manual bank entry removed)', () => {
  const sampleBody = {
    accountHolderName: 'Jane Doe',
    routingNumber: '110000000',
    accountNumber: '000123456789',
    accountType: 'checking' as const,
  };

  it('returns 410 Gone with a migration hint, regardless of the body', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/bank-accounts'](
      { userId: 'user-1', body: sampleBody },
      reply
    );
    expect(reply._code).toBe(410);
    expect(reply._body).toMatchObject({
      code: 'manual_bank_entry_deprecated',
      migrate_to: '/functions/v1/payments/create-financial-connections-session',
    });
  });

  it('does NOT call the legacy consolidatedStripeConnectService.addBankAccount', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.addBankAccount.mockClear();
    await handlers['POST:/connect/bank-accounts'](
      { userId: 'user-1', body: sampleBody },
      mockReply()
    );
    expect(consolidatedStripeConnectService.addBankAccount).not.toHaveBeenCalled();
  });

  it('still returns 410 even when userId is missing (route is fully removed for clients)', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/bank-accounts']({ userId: undefined, body: sampleBody }, reply);
    expect(reply._code).toBe(410);
  });
});

// ---------------------------------------------------------------------------
describe('GET /connect/bank-accounts', () => {
  it('lists bank accounts', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.listBankAccounts.mockResolvedValue([
      { id: 'ba_1', last4: '1111' },
      { id: 'ba_2', last4: '2222' },
    ]);

    const result = await handlers['GET:/connect/bank-accounts']({ userId: 'user-1' }, mockReply());
    expect(result.bankAccounts).toHaveLength(2);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['GET:/connect/bank-accounts']({ userId: undefined }, reply);
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.listBankAccounts.mockRejectedValue(new Error('fail'));
    const reply = mockReply();
    await handlers['GET:/connect/bank-accounts']({ userId: 'user-1' }, reply);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /connect/bank-accounts/:bankAccountId', () => {
  it('removes a bank account', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.removeBankAccount.mockResolvedValue({ success: true });

    const result = await handlers['DELETE:/connect/bank-accounts/:bankAccountId'](
      { userId: 'user-1', params: { bankAccountId: 'ba_del' } },
      mockReply()
    );
    expect(result.success).toBe(true);
  });

  it('returns 400 when bankAccountId missing', async () => {
    const reply = mockReply();
    await handlers['DELETE:/connect/bank-accounts/:bankAccountId'](
      { userId: 'user-1', params: { bankAccountId: '' } },
      reply
    );
    expect(reply._code).toBe(400);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['DELETE:/connect/bank-accounts/:bankAccountId'](
      { userId: undefined, params: { bankAccountId: 'ba_1' } },
      reply
    );
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.removeBankAccount.mockRejectedValue(new Error('fail'));
    const reply = mockReply();
    await handlers['DELETE:/connect/bank-accounts/:bankAccountId'](
      { userId: 'user-1', params: { bankAccountId: 'ba_1' } },
      reply
    );
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /connect/bank-accounts/:bankAccountId/default', () => {
  it('sets default bank account', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.setDefaultBankAccount.mockResolvedValue({
      id: 'ba_def',
      isDefault: true,
    });

    const result = await handlers['POST:/connect/bank-accounts/:bankAccountId/default'](
      { userId: 'user-1', params: { bankAccountId: 'ba_def' } },
      mockReply()
    );
    expect(result.success).toBe(true);
    expect(result.bankAccount.isDefault).toBe(true);
  });

  it('returns 400 when bankAccountId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/bank-accounts/:bankAccountId/default'](
      { userId: 'user-1', params: { bankAccountId: '' } },
      reply
    );
    expect(reply._code).toBe(400);
  });

  it('returns 401 when userId missing', async () => {
    const reply = mockReply();
    await handlers['POST:/connect/bank-accounts/:bankAccountId/default'](
      { userId: undefined, params: { bankAccountId: 'ba_1' } },
      reply
    );
    expect(reply._code).toBe(401);
  });

  it('returns 500 on service error', async () => {
    const {
      consolidatedStripeConnectService,
    } = require('../../../services/api/src/services/consolidated-stripe-connect-service');
    consolidatedStripeConnectService.setDefaultBankAccount.mockRejectedValue(new Error('fail'));
    const reply = mockReply();
    await handlers['POST:/connect/bank-accounts/:bankAccountId/default'](
      { userId: 'user-1', params: { bankAccountId: 'ba_1' } },
      reply
    );
    expect(reply._code).toBe(500);
  });
});
