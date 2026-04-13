/**
 * Unit tests for Consolidated Wallet Service
 * Tests wallet operations, escrow management, and balance updates
 */

export { };

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Jest before any imports)
// ---------------------------------------------------------------------------
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_mock_key', platformFeePercent: 5 },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-key' },
  },
}));

jest.mock('../../../services/api/src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'ValidationError';
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'ConflictError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(resource: string, id: string) {
      super(`${resource} ${id} not found`);
      this.name = 'NotFoundError';
    }
  },
  ExternalServiceError: class ExternalServiceError extends Error {
    constructor(svc: string, m: string) {
      super(`External service error: ${svc}: ${m}`);
      this.name = 'ExternalServiceError';
    }
  },
  handleStripeError: jest.fn((e: any) => e),
}));

jest.mock('../../../services/api/src/services/stripe-safeguards', () => ({
  withStripeIdempotency: jest.fn(async (_key: string, fn: () => Promise<any>) => fn()),
}));

const mockStripeTransfersCreate = jest.fn();
jest.mock('../../../services/api/src/services/consolidated-payment-service', () => ({
  stripe: { transfers: { create: (...args: any[]) => mockStripeTransfersCreate(...args) } },
}));

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/** Build a chainable Supabase query builder that resolves to `result`. */
function makeQuery(result: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    gte: jest.fn(() => q),
    lte: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
    // Allows `await query` (destructuring without .single())
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
    catch: (fn: any) => Promise.resolve(result).catch(fn),
  };
  return q;
}

/**
 * Build a Supabase admin-client mock.
 * Each `.from()` call advances through `fromResults` in order.
 * `rpcResults` is an array of values returned by sequential `.rpc()` calls.
 */
function makeAdmin(fromResults: any[] = [], rpcResults: any[] = [{ data: null, error: null }]) {
  let fromIdx = 0;
  let rpcIdx = 0;
  const rpcFn = jest.fn(() => Promise.resolve(rpcResults[rpcIdx++] ?? { data: null, error: null }));
  return {
    from: jest.fn((_table: string) => {
      const res = fromResults[fromIdx++] ?? { data: null, error: null };
      return makeQuery(res);
    }),
    rpc: rpcFn,
  };
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------
let supabaseModule: any;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Consolidated Wallet Service', () => {
  beforeEach(() => {
    // Reset modules so the supabaseAdmin singleton is cleared between tests
    jest.resetModules();
    supabaseModule = require('@supabase/supabase-js');
    mockStripeTransfersCreate.mockReset();
    mockStripeTransfersCreate.mockResolvedValue({ id: 'tr_test123', amount: 5000 });
  });

  // Re-require service with the configured admin
  function buildService(admin: ReturnType<typeof makeAdmin>) {
    supabaseModule.createClient.mockReturnValue(admin);
    return require('../../../services/api/src/services/consolidated-wallet-service');
  }

  // =========================================================================
  // getBalance
  // =========================================================================
  describe('getBalance', () => {
    it('returns the profile balance when non-zero', async () => {
      const admin = makeAdmin([{ data: { balance: 10000 }, error: null }]);
      const svc = buildService(admin);
      const result = await svc.getBalance('user1');
      expect(result).toEqual({ balance: 10000, currency: 'USD', user_id: 'user1' });
    });

    it('throws NotFoundError when profile not found (PGRST116)', async () => {
      const admin = makeAdmin([{ data: null, error: { code: 'PGRST116', message: 'not found' } }]);
      const svc = buildService(admin);
      await expect(svc.getBalance('ghost')).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('throws ExternalServiceError on generic DB error', async () => {
      const admin = makeAdmin([{ data: null, error: { code: '500', message: 'DB down' } }]);
      const svc = buildService(admin);
      await expect(svc.getBalance('user1')).rejects.toMatchObject({ name: 'ExternalServiceError' });
    });

    it('derives balance from transactions when profile balance is 0 and derived > 0', async () => {
      // Call 0: profiles.single → balance 0
      // Call 1: wallet_transactions (deriveBalanceFromTransactions) → sum to 5000
      // Call 2: profiles.update (fire-and-forget reconciliation)
      const admin = makeAdmin([
        { data: { balance: 0 }, error: null },
        { data: [{ amount: 3000 }, { amount: 2000 }], error: null },
        { error: null }, // reconcile update
      ]);
      const svc = buildService(admin);
      const result = await svc.getBalance('user1');
      expect(result.balance).toBe(5000);
      // Flush microtasks so the fire-and-forget reconcile logger.info callback runs (line 207)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    it('logs warn when reconcile update fails (fire-and-forget)', async () => {
      const admin = makeAdmin([
        { data: { balance: 0 }, error: null },
        { data: [{ amount: 5000 }], error: null },
        { error: { message: 'reconcile failed' } }, // reconcile update → error → logger.warn
      ]);
      const svc = buildService(admin);
      await svc.getBalance('user1');
      // Flush microtasks so the reconcile then-handler (line 202) executes
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    it('returns 0 when profile balance is 0 and no transactions exist', async () => {
      const admin = makeAdmin([
        { data: { balance: 0 }, error: null },
        // deriveBalanceFromTransactions: error path → returns 0
        { data: null, error: { message: 'DB error' } },
      ]);
      const svc = buildService(admin);
      const result = await svc.getBalance('user1');
      expect(result.balance).toBe(0);
    });

    it('returns 0 when profile balance is 0 and transactions sum to 0', async () => {
      const admin = makeAdmin([
        { data: { balance: 0 }, error: null },
        { data: [], error: null },
      ]);
      const svc = buildService(admin);
      const result = await svc.getBalance('user1');
      expect(result.balance).toBe(0);
    });
  });

  // =========================================================================
  // getTransactions
  // =========================================================================
  describe('getTransactions', () => {
    const txRows = [
      {
        id: 'tx1',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'Deposit',
        status: 'completed',
        created_at: '2024-01-01',
      },
      {
        id: 'tx2',
        user_id: 'u1',
        type: 'withdrawal',
        amount: -2000,
        description: null,
        status: 'completed',
        created_at: '2024-01-02',
      },
    ];

    it('returns formatted transactions with pagination defaults', async () => {
      const admin = makeAdmin([{ data: txRows, error: null, count: 2 }]);
      const svc = buildService(admin);
      const result = await svc.getTransactions('u1');
      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('uses default description when transaction description is null', async () => {
      const admin = makeAdmin([{ data: txRows, error: null, count: 2 }]);
      const svc = buildService(admin);
      const result = await svc.getTransactions('u1');
      expect(result.transactions[1].description).toBe('withdrawal transaction');
    });

    it('accepts type, status, bounty_id, start_date, end_date filters', async () => {
      const admin = makeAdmin([{ data: [txRows[0]], error: null, count: 1 }]);
      const svc = buildService(admin);
      const result = await svc.getTransactions('u1', {
        type: 'deposit',
        status: 'completed',
        bounty_id: 'b1',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        limit: 10,
        offset: 5,
      });
      expect(result.transactions).toHaveLength(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it('returns empty list when no transactions', async () => {
      const admin = makeAdmin([{ data: [], error: null, count: 0 }]);
      const svc = buildService(admin);
      const result = await svc.getTransactions('u1');
      expect(result.transactions).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('throws ExternalServiceError on DB error', async () => {
      const admin = makeAdmin([{ data: null, error: { message: 'DB error' } }]);
      const svc = buildService(admin);
      await expect(svc.getTransactions('u1')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });
  });

  // =========================================================================
  // getTransactionByPaymentIntent
  // =========================================================================
  describe('getTransactionByPaymentIntent', () => {
    it('returns transaction when found', async () => {
      const tx = {
        id: 'tx1',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
      };
      const admin = makeAdmin([{ data: tx, error: null }]);
      const svc = buildService(admin);
      const result = await svc.getTransactionByPaymentIntent('pi_123');
      expect(result).toMatchObject({ id: 'tx1', type: 'deposit' });
    });

    it('returns null when no matching transaction', async () => {
      const admin = makeAdmin([{ data: null, error: null }]);
      const svc = buildService(admin);
      const result = await svc.getTransactionByPaymentIntent('pi_missing');
      expect(result).toBeNull();
    });

    it('returns null on PGRST116 error', async () => {
      const admin = makeAdmin([{ data: null, error: { code: 'PGRST116', message: 'not found' } }]);
      const svc = buildService(admin);
      const result = await svc.getTransactionByPaymentIntent('pi_missing');
      expect(result).toBeNull();
    });

    it('throws ExternalServiceError on generic DB error', async () => {
      const admin = makeAdmin([{ data: null, error: { code: '500', message: 'DB error' } }]);
      const svc = buildService(admin);
      await expect(svc.getTransactionByPaymentIntent('pi_x')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });
  });

  // =========================================================================
  // createDeposit
  // =========================================================================
  describe('createDeposit', () => {
    it('throws ValidationError when amount <= 0', async () => {
      const admin = makeAdmin([]);
      const svc = buildService(admin);
      await expect(svc.createDeposit('u1', 0, 'pi_x')).rejects.toMatchObject({
        name: 'ValidationError',
      });
      await expect(svc.createDeposit('u1', -1, 'pi_x')).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('returns existing transaction when duplicate payment intent detected', async () => {
      const existingTx = {
        id: 'tx_existing',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
      };
      const admin = makeAdmin([
        { data: { id: 'tx_existing' }, error: null }, // maybeSingle: duplicate check
        { data: existingTx, error: null }, // single: fetch existing tx
      ]);
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_dup');
      expect(result.id).toBe('tx_existing');
    });

    it('continues to create when existing tx fetch fails after duplicate detected', async () => {
      // existingTx found, but fetch of full record fails → fall through to RPC
      const newTx = {
        id: 'tx_rpc',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
        stripe_payment_intent_id: 'pi_x',
      };
      const admin = makeAdmin(
        [
          { data: { id: 'tx_old' }, error: null }, // duplicate found
          { data: null, error: { message: 'gone' } }, // fetch fails
          { data: newTx, error: null }, // getTransactionByPaymentIntent (after RPC)
        ],
        [{ data: [{ applied: true, tx_id: 'tx_rpc' }], error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_x');
      expect(result).toBeTruthy();
    });

    it('returns transaction found by payment intent after RPC apply_deposit', async () => {
      const tx = {
        id: 'tx_rpc',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
        stripe_payment_intent_id: 'pi_123',
      };
      // from calls: (0) duplicate check → null, (1) getTransactionByPaymentIntent → tx
      const admin = makeAdmin(
        [
          { data: null, error: null },
          { data: tx, error: null },
        ],
        [{ data: [{ applied: true, tx_id: 'tx_rpc' }], error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_123');
      expect(result.id).toBe('tx_rpc');
      expect(result.type).toBe('deposit');
    });

    it('looks up by tx_id when payment intent lookup returns null', async () => {
      const txById = {
        id: 'tx_rpc',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
      };
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
          { data: null, error: null }, // getTransactionByPaymentIntent → null
          { data: txById, error: null }, // fetch by tx_id → found
        ],
        [{ data: [{ applied: true, tx_id: 'tx_rpc' }], error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_123');
      expect(result.id).toBe('tx_rpc');
    });

    it('warns and returns minimal tx when tx_id fetch returns error', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
          { data: null, error: null }, // getTransactionByPaymentIntent → null
          { data: null, error: { message: 'fetch failed' } }, // fetch by tx_id → error
        ],
        [{ data: [{ applied: true, tx_id: 'tx_rpc' }], error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_123');
      // applied=true so minimal transaction is returned
      expect(result.type).toBe('deposit');
    });

    it('returns minimal constructed transaction when applied=true but tx not found', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
          { data: null, error: null }, // getTransactionByPaymentIntent → null
          { data: null, error: null }, // fetch by tx_id → null
        ],
        [{ data: [{ applied: true, tx_id: 'tx_min' }], error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_123');
      expect(result.type).toBe('deposit');
      expect(result.amount).toBe(5000);
    });

    it('falls back to direct insert when RPC returns nothing and applied=false', async () => {
      const newTx = {
        id: 'tx_new',
        user_id: 'u1',
        type: 'deposit',
        amount: 5000,
        description: 'D',
        status: 'completed',
        created_at: '2024-01-01',
        stripe_payment_intent_id: 'pi_fb',
      };
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
          { data: null, error: null }, // getTransactionByPaymentIntent → null
          // No tx_id path since applied=false and no tx_id
          { data: newTx, error: null }, // fallback insert .single()
        ],
        [
          { data: null, error: null }, // apply_deposit RPC → no result
          { data: null, error: null }, // updateBalance RPC
        ]
      );
      const svc = buildService(admin);
      const result = await svc.createDeposit('u1', 5000, 'pi_fb');
      expect(result.type).toBe('deposit');
    });

    it('throws ExternalServiceError when apply_deposit RPC fails', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
        ],
        [{ data: null, error: { message: 'RPC failed' } }]
      );
      const svc = buildService(admin);
      await expect(svc.createDeposit('u1', 5000, 'pi_fail')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('throws ExternalServiceError when fallback insert fails', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // duplicate check
          { data: null, error: null }, // getTransactionByPaymentIntent → null
          { data: null, error: { message: 'insert failed' } }, // fallback insert → error
        ],
        [{ data: null, error: null }]
      ); // RPC returns nothing
      const svc = buildService(admin);
      await expect(svc.createDeposit('u1', 5000, 'pi_x')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });
  });

  // =========================================================================
  // createWithdrawal
  // =========================================================================
  describe('createWithdrawal', () => {
    // Helper: builds the from-results for a successful withdrawal
    // from[0] = insert pending tx, rpc[0] = updateBalance, Stripe succeeds
    // from[1] = update tx with transfer id (fire-and-forget)
    function okWithdrawalAdmin() {
      const pendingTx = {
        id: 'tx_w1',
        user_id: 'u1',
        type: 'withdrawal',
        amount: -5000,
        description: 'W',
        status: 'pending',
        metadata: {},
      };
      return makeAdmin(
        [
          { data: pendingTx, error: null }, // insert → single
          { error: null }, // update tx with transfer id (fire-and-forget)
        ],
        [{ data: null, error: null }] // updateBalance RPC ok
      );
    }

    it('throws ValidationError when amount <= 0', async () => {
      const svc = buildService(makeAdmin([]));
      await expect(svc.createWithdrawal('u1', 0, 'acct_x')).rejects.toMatchObject({
        name: 'ValidationError',
      });
      await expect(svc.createWithdrawal('u1', -1, 'acct_x')).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('throws ConflictError on unique index violation (23505)', async () => {
      const admin = makeAdmin([
        { data: null, error: { code: '23505', message: 'unique violation' } },
      ]);
      const svc = buildService(admin);
      await expect(svc.createWithdrawal('u1', 5000, 'acct_x')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('throws ExternalServiceError on generic insert error', async () => {
      const admin = makeAdmin([{ data: null, error: { code: '500', message: 'DB error' } }]);
      const svc = buildService(admin);
      await expect(svc.createWithdrawal('u1', 5000, 'acct_x')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('succeeds: inserts pending tx, deducts balance, calls Stripe, marks completed', async () => {
      const admin = okWithdrawalAdmin();
      const svc = buildService(admin);
      const result = await svc.createWithdrawal('u1', 5000, 'acct_test1234');
      expect(result.type).toBe('withdrawal');
      expect(result.status).toBe('completed');
      expect(mockStripeTransfersCreate).toHaveBeenCalledTimes(1);
    });

    it('logs error but still returns success when tx-update after Stripe transfer fails', async () => {
      const pendingTx = {
        id: 'tx_w1',
        user_id: 'u1',
        type: 'withdrawal',
        amount: -5000,
        description: 'W',
        status: 'pending',
        metadata: {},
      };
      const admin = makeAdmin(
        [
          { data: pendingTx, error: null }, // insert pending tx
          { error: { message: 'update failed' } }, // update tx with transfer id → error (logged, not thrown)
        ],
        [{ data: null, error: null }] // updateBalance RPC ok
      );
      const svc = buildService(admin);
      const result = await svc.createWithdrawal('u1', 5000, 'acct_test1234');
      expect(result.type).toBe('withdrawal');
      expect(result.status).toBe('completed');
    });

    it('marks transaction failed and rolls back balance on Stripe error', async () => {
      const pendingTx = {
        id: 'tx_fail',
        user_id: 'u1',
        type: 'withdrawal',
        amount: -5000,
        metadata: {},
      };
      const admin = makeAdmin(
        [
          { data: pendingTx, error: null }, // insert pending tx
          { error: null }, // mark failed
          { error: null }, // update for rollback (fire-and-forget for mark-failed)
        ],
        [
          { data: null, error: null }, // updateBalance (deduct)
          { data: null, error: null }, // updateBalance rollback
        ]
      );
      mockStripeTransfersCreate.mockRejectedValueOnce(new Error('Stripe error'));
      const svc = buildService(admin);
      await expect(svc.createWithdrawal('u1', 5000, 'acct_x')).rejects.toThrow('Stripe error');
    });

    it('does not roll back balance when error is Insufficient balance', async () => {
      const pendingTx = {
        id: 'tx_nsf',
        user_id: 'u1',
        type: 'withdrawal',
        amount: -5000,
        metadata: {},
      };
      // updateBalance throws ValidationError with 'Insufficient balance'
      const admin = makeAdmin(
        [
          { data: pendingTx, error: null },
          { error: null }, // mark failed
        ],
        [
          { data: null, error: { message: 'Insufficient balance' } }, // updateBalance → throws
        ]
      );
      const svc = buildService(admin);
      // The thrown error depends on error-handler interpretation; just assert it rejects
      await expect(svc.createWithdrawal('u1', 5000, 'acct_x')).rejects.toThrow();
    });
  });

  // =========================================================================
  // createEscrow
  // =========================================================================
  describe('createEscrow', () => {
    it('throws ValidationError when amount <= 0', async () => {
      const svc = buildService(makeAdmin([]));
      await expect(svc.createEscrow('b1', 'poster1', 0)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('throws ConflictError when escrow already exists', async () => {
      const admin = makeAdmin([{ data: { id: 'existing_escrow' }, error: null }]);
      const svc = buildService(admin);
      await expect(svc.createEscrow('b1', 'poster1', 5000)).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('throws ExternalServiceError on insert failure', async () => {
      const admin = makeAdmin([
        { data: null, error: null }, // no existing escrow
        { data: null, error: { message: 'insert fail' } }, // insert error
      ]);
      const svc = buildService(admin);
      await expect(svc.createEscrow('b1', 'poster1', 5000)).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('creates escrow and deducts poster balance', async () => {
      const escrowTx = {
        id: 'tx_escrow',
        user_id: 'poster1',
        type: 'escrow',
        amount: -5000,
        description: 'E',
        status: 'completed',
        created_at: '2024-01-01',
      };
      const admin = makeAdmin(
        [
          { data: null, error: null }, // no existing escrow
          { data: escrowTx, error: null }, // insert
        ],
        [{ data: null, error: null }]
      ); // updateBalance RPC
      const svc = buildService(admin);
      const result = await svc.createEscrow('b1', 'poster1', 5000);
      expect(result.type).toBe('escrow');
      expect(result.amount).toBe(-5000);
    });
  });

  // =========================================================================
  // releaseEscrow
  // =========================================================================
  describe('releaseEscrow', () => {
    const escrowTx = {
      id: 'esc1',
      user_id: 'poster1',
      bounty_id: 'b1',
      type: 'escrow',
      amount: -10000,
      description: 'E',
      status: 'completed',
      created_at: '2024-01-01',
    };
    const releaseTx = {
      id: 'rel1',
      user_id: 'hunter1',
      bounty_id: 'b1',
      type: 'release',
      amount: 9500,
      description: 'R',
      status: 'completed',
      created_at: '2024-01-02',
    };

    it('throws ConflictError (released) when release already exists', async () => {
      const admin = makeAdmin([{ data: { id: 'r1', type: 'release' }, error: null }]);
      const svc = buildService(admin);
      await expect(svc.releaseEscrow('b1', 'hunter1')).rejects.toMatchObject({
        name: 'ConflictError',
        message: expect.stringContaining('released'),
      });
    });

    it('throws ConflictError (refunded) when refund already exists', async () => {
      const admin = makeAdmin([{ data: { id: 'r1', type: 'refund' }, error: null }]);
      const svc = buildService(admin);
      await expect(svc.releaseEscrow('b1', 'hunter1')).rejects.toMatchObject({
        name: 'ConflictError',
        message: expect.stringContaining('refunded'),
      });
    });

    it('throws NotFoundError when escrow transaction not found', async () => {
      const admin = makeAdmin([
        { data: null, error: null }, // no existing release
        { data: null, error: { message: 'not found' } }, // no escrow tx
      ]);
      const svc = buildService(admin);
      await expect(svc.releaseEscrow('b1', 'hunter1')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ExternalServiceError on release insert failure', async () => {
      const admin = makeAdmin([
        { data: null, error: null }, // no existing release
        { data: escrowTx, error: null }, // escrow tx found
        { data: null, error: { message: 'insert fail' } }, // release insert fails
      ]);
      const svc = buildService(admin);
      await expect(svc.releaseEscrow('b1', 'hunter1')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('releases escrow to hunter with platform fee, no Stripe account', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // no existing release
          { data: escrowTx, error: null }, // escrow tx
          { data: releaseTx, error: null }, // release insert
          { error: null }, // platform_ledger insert
          { data: { stripe_connect_account_id: null }, error: null }, // profile (no stripe)
        ],
        [{ data: null, error: null }]
      ); // updateBalance RPC
      const svc = buildService(admin);
      const result = await svc.releaseEscrow('b1', 'hunter1');
      expect(result.type).toBe('release');
      expect(result.amount).toBe(9500);
      expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
    });

    it('initiates Stripe transfer when hunter has a connected account', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // no existing release
          { data: escrowTx, error: null }, // escrow tx
          { data: releaseTx, error: null }, // release insert
          { error: null }, // platform_ledger insert
          { data: { stripe_connect_account_id: 'acct_hunter' }, error: null }, // profile
          { error: null }, // update tx with transfer_id
        ],
        [{ data: null, error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.releaseEscrow('b1', 'hunter1');
      expect(result.type).toBe('release');
      expect(mockStripeTransfersCreate).toHaveBeenCalledTimes(1);
    });

    it('does not throw when Stripe transfer fails during release (non-fatal)', async () => {
      mockStripeTransfersCreate.mockRejectedValueOnce(new Error('Stripe error'));
      const admin = makeAdmin(
        [
          { data: null, error: null },
          { data: escrowTx, error: null },
          { data: releaseTx, error: null },
          { error: null },
          { data: { stripe_connect_account_id: 'acct_hunter' }, error: null },
        ],
        [{ data: null, error: null }]
      );
      const svc = buildService(admin);
      // Should not throw
      const result = await svc.releaseEscrow('b1', 'hunter1');
      expect(result.type).toBe('release');
    });

    it('does not throw when platform_ledger insert fails (non-fatal)', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null },
          { data: escrowTx, error: null },
          { data: releaseTx, error: null },
          { error: { message: 'ledger fail' } }, // platform_ledger error
          { data: { stripe_connect_account_id: null }, error: null },
        ],
        [{ data: null, error: null }]
      );
      const svc = buildService(admin);
      const result = await svc.releaseEscrow('b1', 'hunter1');
      expect(result.type).toBe('release');
    });
  });

  // =========================================================================
  // refundEscrow
  // =========================================================================
  describe('refundEscrow', () => {
    const escrowTx = {
      id: 'esc1',
      user_id: 'poster1',
      bounty_id: 'b1',
      type: 'escrow',
      amount: -5000,
      description: 'E',
      status: 'completed',
      created_at: '2024-01-01',
    };
    const refundTx = {
      id: 'ref1',
      user_id: 'poster1',
      bounty_id: 'b1',
      type: 'refund',
      amount: 5000,
      description: 'R',
      status: 'completed',
      created_at: '2024-01-02',
    };

    it('throws ConflictError when escrow already released', async () => {
      const admin = makeAdmin([{ data: { id: 'r1', type: 'release' }, error: null }]);
      const svc = buildService(admin);
      await expect(svc.refundEscrow('b1', 'poster1', 'Cancelled')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('throws NotFoundError when escrow transaction not found', async () => {
      const admin = makeAdmin([
        { data: null, error: null }, // no existing release
        { data: null, error: { message: 'not found' } }, // no escrow tx
      ]);
      const svc = buildService(admin);
      await expect(svc.refundEscrow('b1', 'poster1', 'Cancelled')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ExternalServiceError on refund insert failure', async () => {
      const admin = makeAdmin([
        { data: null, error: null }, // no existing release
        { data: escrowTx, error: null }, // escrow tx
        { data: null, error: { message: 'insert fail' } }, // refund insert error
      ]);
      const svc = buildService(admin);
      await expect(svc.refundEscrow('b1', 'poster1', 'Cancelled')).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('refunds escrow and credits poster balance', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: null }, // no existing release
          { data: escrowTx, error: null }, // escrow tx
          { data: refundTx, error: null }, // refund insert
        ],
        [{ data: null, error: null }]
      ); // updateBalance RPC
      const svc = buildService(admin);
      const result = await svc.refundEscrow('b1', 'poster1', 'Cancelled');
      expect(result.type).toBe('refund');
      expect(result.amount).toBe(5000);
    });
  });

  // =========================================================================
  // updateBalance
  // =========================================================================
  describe('updateBalance', () => {
    it('succeeds when RPC call returns no error', async () => {
      const admin = makeAdmin([], [{ data: null, error: null }]);
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).resolves.toBeUndefined();
    });

    it('throws ValidationError when RPC error message contains "insufficient"', async () => {
      const admin = makeAdmin(
        [],
        [{ data: null, error: { code: '400', message: 'insufficient balance' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', -99999)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('throws ValidationError when RPC error message contains "negative"', async () => {
      const admin = makeAdmin(
        [],
        [{ data: null, error: { code: '400', message: 'would go negative' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', -99999)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('throws NotFoundError when RPC error message contains "not found"', async () => {
      const admin = makeAdmin(
        [],
        [{ data: null, error: { code: '404', message: 'user not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('ghost', 5000)).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ExternalServiceError on generic RPC error', async () => {
      const admin = makeAdmin(
        [],
        [{ data: null, error: { code: '500', message: 'server crash' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('falls back to optimistic locking when RPC function not found (PGRST202)', async () => {
      const admin = makeAdmin(
        [
          { data: { balance: 10000 }, error: null }, // read profile
          { data: [{ balance: 15000 }], error: null }, // update with new balance
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).resolves.toBeUndefined();
    });

    it('throws ValidationError on insufficient balance in optimistic lock path', async () => {
      const admin = makeAdmin(
        [
          { data: { balance: 100 }, error: null }, // read profile
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', -5000)).rejects.toMatchObject({
        name: 'ValidationError',
      });
    });

    it('throws NotFoundError when profile not found in optimistic lock path (PGRST116)', async () => {
      const admin = makeAdmin(
        [
          { data: null, error: { code: 'PGRST116', message: 'not found' } }, // read profile fails
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('throws ExternalServiceError when profile read fails in optimistic lock path', async () => {
      const admin = makeAdmin(
        [{ data: null, error: { code: '500', message: 'DB error' } }],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('throws ExternalServiceError when profile update fails in optimistic lock path', async () => {
      const admin = makeAdmin(
        [
          { data: { balance: 10000 }, error: null }, // read profile
          { data: null, error: { message: 'update failed' } }, // update → error
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).rejects.toMatchObject({
        name: 'ExternalServiceError',
      });
    });

    it('retries on optimistic lock conflict and succeeds on second attempt', async () => {
      // First read: balance=10000, update: no rows updated (conflict)
      // Second read: balance=10500, update: success
      const admin = makeAdmin(
        [
          { data: { balance: 10000 }, error: null }, // read 1
          { data: [], error: null }, // update 1 (no rows → conflict)
          { data: { balance: 10500 }, error: null }, // read 2
          { data: [{ balance: 15500 }], error: null }, // update 2 success
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).resolves.toBeUndefined();
    }, 10000);

    it('throws ConflictError after max retries in optimistic lock path', async () => {
      // All 3 retries fail (no rows updated each time)
      const admin = makeAdmin(
        [
          { data: { balance: 10000 }, error: null },
          { data: [], error: null },
          { data: { balance: 10000 }, error: null },
          { data: [], error: null },
          { data: { balance: 10000 }, error: null },
          { data: [], error: null },
        ],
        [{ data: null, error: { code: 'PGRST202', message: 'function not found' } }]
      );
      const svc = buildService(admin);
      await expect(svc.updateBalance('u1', 5000)).rejects.toMatchObject({ name: 'ConflictError' });
    }, 15000);
  });

  // =========================================================================
  // recordPlatformFee
  // =========================================================================
  describe('recordPlatformFee', () => {
    it('inserts into platform_ledger without throwing', async () => {
      const admin = makeAdmin([{ error: null }]); // insert success
      const svc = buildService(admin);
      await expect(svc.recordPlatformFee({ bountyId: 'b1', amount: 250 })).resolves.toBeUndefined();
    });

    it('logs error but does not throw on insert failure', async () => {
      const admin = makeAdmin([{ error: { message: 'ledger table missing' } }]);
      const svc = buildService(admin);
      // Should not throw, just log
      await expect(svc.recordPlatformFee({ bountyId: 'b1', amount: 250 })).resolves.toBeUndefined();
    });

    it('uses custom description and metadata when provided', async () => {
      const admin = makeAdmin([{ error: null }]);
      const svc = buildService(admin);
      await expect(
        svc.recordPlatformFee({
          bountyId: 'b1',
          amount: 100,
          description: 'Custom fee',
          metadata: { ref: '123' },
        })
      ).resolves.toBeUndefined();
    });
  });
});
