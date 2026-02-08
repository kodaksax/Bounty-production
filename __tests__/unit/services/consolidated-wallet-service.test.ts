/**
 * Unit tests for Consolidated Wallet Service
 * Tests wallet operations, escrow management, and balance updates
 */

export { };

// Mock data and functions - must be prefixed with 'mock' for Jest hoisting
const mockStripeInstance = {
  transfers: {
    create: jest.fn(async () => ({
      id: 'tr_test123',
      amount: 5000,
      currency: 'usd',
      destination: 'acct_test123',
    })),
  },
};

let lastInsertedData: any = null;

const mockSupabaseClientInstance = {
  from: jest.fn((table: string) => {
    const qb: any = {};
    const mockData = [
      { id: 'tx1', type: 'deposit', amount: 5000, created_at: '2024-01-01', user_id: 'user123' },
      { id: 'tx2', type: 'withdrawal', amount: 2000, created_at: '2024-01-02', user_id: 'user123' },
    ];

    Object.assign(qb, {
      select: jest.fn(() => qb),
      eq: jest.fn(() => qb),
      in: jest.fn(() => qb),
      order: jest.fn(() => qb),
      range: jest.fn(() => qb),
      limit: jest.fn(() => qb),
      single: jest.fn(() => {
        if (lastInsertedData) {
          const res = Promise.resolve({ data: { ...lastInsertedData, id: 'tx_new' }, error: null });
          lastInsertedData = null;
          return res;
        }
        if (table === 'wallets' || table === 'profiles') {
          return Promise.resolve({ data: { id: 'w123', user_id: 'user123', balance: 10000, version: 1 }, error: null });
        }
        if (table === 'bounties') {
          return Promise.resolve({
            data: { id: 'bounty123', poster_id: 'user123', hunter_id: 'hunter123', amount: 5000, status: 'in_progress' },
            error: null,
          });
        }
        if (table === 'wallet_transactions') {
          return Promise.resolve({ data: { id: 'tx123', user_id: 'user123', type: 'escrow', amount: 5000 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      insert: jest.fn((data) => {
        lastInsertedData = Array.isArray(data) ? data[0] : data;
        return qb;
      }),
      update: jest.fn(() => qb),
      match: jest.fn(() => Promise.resolve({ error: null, count: 1 })),
      then: (resolve: any) => resolve({ data: mockData, error: null, count: mockData.length }),
    });
    return qb;
  }),
  rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
};

// Hoisted mocks
jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_mock_key' },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-service-role-key' },
  },
}));

jest.mock('../../../services/api/src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('stripe', () => {
  const m = jest.fn(() => mockStripeInstance);
  return { __esModule: true, default: m, Stripe: m };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClientInstance),
}));

jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ValidationError: class extends Error { constructor(m: any) { super(m); this.name = 'ValidationError'; } },
  ConflictError: class extends Error { constructor(m: any) { super(m); this.name = 'ConflictError'; } },
  NotFoundError: class extends Error { constructor(m: any) { super(m); this.name = 'NotFoundError'; } },
  ExternalServiceError: class extends Error { constructor(m: any) { super(m); this.name = 'ExternalServiceError'; } },
  handleStripeError: jest.fn(e => e),
}));

// Import service after all mocks
let walletService: any;

describe('Consolidated Wallet Service', () => {
  beforeAll(() => {
    walletService = require('../../../services/api/src/services/consolidated-wallet-service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    lastInsertedData = null;
  });

  describe('getBalance', () => {
    it('should return wallet balance for user', async () => {
      const result = await walletService.getBalance('user123');
      expect(result.balance).toBe(10000);
    });
  });

  describe('getTransactions', () => {
    it('should return transaction history', async () => {
      const result = await walletService.getTransactions('user123');
      expect(result.transactions).toHaveLength(2);
    });
  });

  describe('createDeposit', () => {
    it('should create a deposit', async () => {
      const result = await walletService.createDeposit('user123', 5000, 'pi_test123');
      expect(result.type).toBe('deposit');
    });
  });

  describe('createWithdrawal', () => {
    it('should create a withdrawal', async () => {
      const result = await walletService.createWithdrawal('user123', 5000, 'acct_test123');
      expect(result.type).toBe('withdrawal');
    });
  });

  describe('createEscrow', () => {
    it('should create escrow', async () => {
      const result = await walletService.createEscrow('bounty123', 'user123', 5000);
      expect(result.type).toBe('escrow');
    });
  });

  describe('releaseEscrow', () => {
    it('should release escrow', async () => {
      const result = await walletService.releaseEscrow('bounty123', 'hunter123');
      expect(result.type).toBe('release');
    });
  });

  describe('refundEscrow', () => {
    it('should refund escrow', async () => {
      const result = await walletService.refundEscrow('bounty123', 'user123', 'Cancelled');
      expect(result.type).toBe('refund');
    });
  });

  describe('updateBalance', () => {
    it('should update balance atomically', async () => {
      mockSupabaseClientInstance.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } as any });
      await walletService.updateBalance('user123', 5000);
      expect(mockSupabaseClientInstance.from).toHaveBeenCalledWith('profiles');
    });
  });
});
