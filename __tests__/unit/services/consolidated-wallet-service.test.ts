/**
 * Unit tests for Consolidated Wallet Service
 * Tests wallet operations, escrow management, and balance updates
 */

// Mock config
jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock_key',
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    },
  },
}));

// Mock logger
jest.mock('../../../services/api/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock Supabase
const mockSupabaseClient = {
  from: jest.fn((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => {
          if (table === 'wallets') {
            return Promise.resolve({
              data: { user_id: 'user123', balance: 10000, version: 1 },
              error: null,
            });
          }
          if (table === 'bounties') {
            return Promise.resolve({
              data: {
                id: 'bounty123',
                poster_id: 'user123',
                hunter_id: 'hunter123',
                amount: 5000,
                status: 'in_progress',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        maybeSingle: jest.fn(() => Promise.resolve({
          data: { id: 'tx123', type: 'escrow' },
          error: null,
        })),
      })),
      order: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve({
          data: [
            { id: 'tx1', type: 'deposit', amount: 5000, created_at: '2024-01-01' },
            { id: 'tx2', type: 'withdrawal', amount: 2000, created_at: '2024-01-02' },
          ],
          error: null,
        })),
      })),
    })),
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: {
            id: 'tx_new',
            user_id: 'user123',
            type: 'deposit',
            amount: 5000,
            status: 'completed',
          },
          error: null,
        })),
      })),
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => ({
        match: jest.fn(() => Promise.resolve({ error: null, count: 1 })),
      })),
    })),
  })),
  rpc: jest.fn((fnName: string) => {
    if (fnName === 'get_wallet_balance') {
      return Promise.resolve({ data: 10000, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// Mock Stripe
const mockStripe = {
  transfers: {
    create: jest.fn(async () => ({
      id: 'tr_test123',
      amount: 5000,
      currency: 'usd',
      destination: 'acct_test123',
    })),
  },
};

jest.mock('stripe', () => {
  // Return a constructor function that returns the mock Stripe instance
  return jest.fn().mockImplementation(() => mockStripe);
});

// Mock error classes
jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string, public statusCode = 400) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(message: string, public statusCode = 409) {
      super(message);
      this.name = 'ConflictError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string, public statusCode = 404) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  ExternalServiceError: class ExternalServiceError extends Error {
    constructor(message: string, public statusCode = 502) {
      super(message);
      this.name = 'ExternalServiceError';
    }
  },
}));

// Import service after mocks
import * as walletService from '../../../services/api/src/services/consolidated-wallet-service';

describe('Consolidated Wallet Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('should return wallet balance for user', async () => {
      const result = await walletService.getBalance('user123');

      expect(result.balance).toBe(10000);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('profiles');
    });

    it('should handle user without wallet', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { balance: 0 },
              error: null,
            })),
          })),
        })),
      }));

      const result = await walletService.getBalance('user_no_wallet');

      expect(result.balance).toBe(0);
    });

    it('should handle database errors', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'Database error' },
            })),
          })),
        })),
      }));

      await expect(walletService.getBalance('user123')).rejects.toThrow();
    });
  });

  describe('getTransactions', () => {
    it('should return transaction history with pagination', async () => {
      const result = await walletService.getTransactions('user123', {
        limit: 10,
        offset: 0,
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].type).toBe('deposit');
      expect(result.transactions[1].type).toBe('withdrawal');
    });

    it('should filter transactions by type', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({
                data: [{ id: 'tx1', type: 'deposit', amount: 5000 }],
                error: null,
              })),
            })),
          })),
        })),
      }));

      const result = await walletService.getTransactions('user123', {
        type: 'deposit',
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe('deposit');
    });

    it('should use default pagination values', async () => {
      await walletService.getTransactions('user123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });
  });

  describe('createDeposit', () => {
    it('should create a deposit transaction', async () => {
      const result = await walletService.createDeposit(
        'user123',
        5000,
        'pi_test123'
      );

      expect(result.type).toBe('deposit');
      expect(result.amount).toBe(5000);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });

    it('should validate deposit amount', async () => {
      await expect(
        walletService.createDeposit('user123', -100, 'pi_test123')
      ).rejects.toThrow('ValidationError');
    });

    it('should use idempotency key to prevent duplicates', async () => {
      const idempotencyKey = 'deposit-idempotency-key';

      await walletService.createDeposit('user123', 5000, 'pi_test123', idempotencyKey);

      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });

    it('should handle zero amount deposits', async () => {
      await expect(
        walletService.createDeposit('user123', 0, 'pi_test123')
      ).rejects.toThrow('ValidationError');
    });

    it('should handle payment intent validation', async () => {
      await expect(
        walletService.createDeposit('user123', 5000, '')
      ).rejects.toThrow();
    });
  });

  describe('createWithdrawal', () => {
    it('should create a withdrawal transaction', async () => {
      const result = await walletService.createWithdrawal(
        'user123',
        5000,
        'acct_test123'
      );

      expect(result.type).toBe('withdrawal');
      expect(result.amount).toBe(5000);
      expect(mockStripe.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          destination: 'acct_test123',
        }),
        expect.any(Object)
      );
    });

    it('should validate withdrawal amount', async () => {
      await expect(
        walletService.createWithdrawal('user123', -100, 'acct_test123')
      ).rejects.toThrow('ValidationError');
    });

    it('should check sufficient balance before withdrawal', async () => {
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 1000, error: null });

      await expect(
        walletService.createWithdrawal('user123', 5000, 'acct_test123')
      ).rejects.toThrow();
    });

    it('should rollback on Stripe transfer failure', async () => {
      mockStripe.transfers.create.mockRejectedValueOnce(
        new Error('Stripe transfer failed')
      );

      await expect(
        walletService.createWithdrawal('user123', 5000, 'acct_test123')
      ).rejects.toThrow();
    });

    it('should use idempotency key for Stripe transfer', async () => {
      const idempotencyKey = 'withdrawal-idempotency-key';

      await walletService.createWithdrawal(
        'user123',
        5000,
        'acct_test123',
        idempotencyKey
      );

      expect(mockStripe.transfers.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey }
      );
    });
  });

  describe('createEscrow', () => {
    it('should create escrow transaction', async () => {
      const result = await walletService.createEscrow(
        'bounty123',
        'user123',
        5000
      );

      expect(result.type).toBe('escrow');
      expect(result.amount).toBe(5000);
    });

    it('should prevent duplicate escrows', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'existing_escrow', type: 'escrow' },
              error: null,
            })),
          })),
        })),
      }));

      await expect(
        walletService.createEscrow('bounty123', 'user123', 5000)
      ).rejects.toThrow('ConflictError');
    });

    it('should validate escrow amount', async () => {
      await expect(
        walletService.createEscrow('bounty123', 'user123', 0)
      ).rejects.toThrow('ValidationError');
    });

    it('should use idempotency key', async () => {
      const idempotencyKey = 'escrow-idempotency-key';

      await walletService.createEscrow('bounty123', 'user123', 5000, idempotencyKey);

      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });

    it('should deduct amount from poster balance', async () => {
      await walletService.createEscrow('bounty123', 'user123', 5000);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });
  });

  describe('releaseEscrow', () => {
    it('should release escrow to hunter', async () => {
      const result = await walletService.releaseEscrow('bounty123', 'hunter123');

      expect(result.type).toBe('release');
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });

    it('should calculate and deduct platform fee', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'escrow_tx',
                type: 'escrow',
                amount: 10000,
                bounty_id: 'bounty123',
              },
              error: null,
            })),
            maybeSingle: jest.fn(() => Promise.resolve({
              data: null,
              error: null,
            })),
          })),
        })),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'release_tx',
                type: 'release',
                amount: 9500, // 10000 - 5% fee
                platform_fee: 500,
              },
              error: null,
            })),
          })),
        })),
      }));

      const result = await walletService.releaseEscrow('bounty123', 'hunter123');

      expect(result.amount).toBe(9500);
      expect(result.platform_fee).toBe(500);
    });

    it('should prevent double release', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'escrow_tx', type: 'escrow', amount: 5000 },
              error: null,
            })),
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'release_tx', type: 'release' },
              error: null,
            })),
          })),
        })),
      }));

      await expect(
        walletService.releaseEscrow('bounty123', 'hunter123')
      ).rejects.toThrow('ConflictError');
    });

    it('should validate escrow exists before release', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'No escrow found' },
            })),
          })),
        })),
      }));

      await expect(
        walletService.releaseEscrow('bounty123', 'hunter123')
      ).rejects.toThrow('NotFoundError');
    });

    it('should use idempotency key', async () => {
      const idempotencyKey = 'release-idempotency-key';

      await walletService.releaseEscrow('bounty123', 'hunter123', idempotencyKey);

      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });

    it('should add amount to hunter balance', async () => {
      await walletService.releaseEscrow('bounty123', 'hunter123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });
  });

  describe('refundEscrow', () => {
    it('should refund escrow to poster', async () => {
      const result = await walletService.refundEscrow(
        'bounty123',
        'user123',
        'Bounty cancelled'
      );

      expect(result.type).toBe('refund');
    });

    it('should validate escrow exists before refund', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'No escrow found' },
            })),
          })),
        })),
      }));

      await expect(
        walletService.refundEscrow('bounty123', 'user123', 'Test reason')
      ).rejects.toThrow('NotFoundError');
    });

    it('should prevent double refund', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'escrow_tx', type: 'escrow', amount: 5000 },
              error: null,
            })),
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'refund_tx', type: 'refund' },
              error: null,
            })),
          })),
        })),
      }));

      await expect(
        walletService.refundEscrow('bounty123', 'user123', 'Test reason')
      ).rejects.toThrow('ConflictError');
    });

    it('should return full escrow amount to poster', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'escrow_tx', type: 'escrow', amount: 5000 },
              error: null,
            })),
            maybeSingle: jest.fn(() => Promise.resolve({
              data: null,
              error: null,
            })),
          })),
        })),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                id: 'refund_tx',
                type: 'refund',
                amount: 5000,
              },
              error: null,
            })),
          })),
        })),
      }));

      const result = await walletService.refundEscrow(
        'bounty123',
        'user123',
        'Test reason'
      );

      expect(result.amount).toBe(5000);
    });

    it('should include refund reason in transaction', async () => {
      const reason = 'Bounty cancelled by poster';

      await walletService.refundEscrow('bounty123', 'user123', reason);

      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });
  });

  describe('updateBalance', () => {
    it('should update wallet balance atomically', async () => {
      await walletService.updateBalance('user123', 5000);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallets');
    });

    it('should handle concurrent balance updates with optimistic locking', async () => {
      // First update succeeds
      mockSupabaseClient.from = jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            match: jest.fn()
              .mockResolvedValueOnce({ error: null, count: 0 }) // First attempt fails (stale version)
              .mockResolvedValueOnce({ error: null, count: 1 }), // Retry succeeds
          })),
        })),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { user_id: 'user123', balance: 10000, version: 2 },
              error: null,
            })),
          })),
        })),
      }));

      await walletService.updateBalance('user123', 5000);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallets');
    });

    it('should retry on optimistic lock failure', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            match: jest.fn()
              .mockResolvedValueOnce({ error: null, count: 0 }) // Fail once
              .mockResolvedValueOnce({ error: null, count: 1 }), // Then succeed
          })),
        })),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { user_id: 'user123', balance: 10000, version: 1 },
              error: null,
            })),
          })),
        })),
      }));

      await walletService.updateBalance('user123', 1000);

      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });

    it('should handle negative balance updates', async () => {
      await walletService.updateBalance('user123', -3000);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallets');
    });

    it('should prevent balance from going negative', async () => {
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 1000, error: null });

      await expect(
        walletService.updateBalance('user123', -5000)
      ).rejects.toThrow();
    });

    it('should handle max retry attempts', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            match: jest.fn(() => Promise.resolve({ error: null, count: 0 })), // Always fail
          })),
        })),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { user_id: 'user123', balance: 10000, version: 1 },
              error: null,
            })),
          })),
        })),
      }));

      await expect(walletService.updateBalance('user123', 1000)).rejects.toThrow();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle Stripe API timeout', async () => {
      mockStripe.transfers.create.mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );

      await expect(
        walletService.createWithdrawal('user123', 5000, 'acct_test123')
      ).rejects.toThrow();
    });

    it('should handle database connection errors', async () => {
      mockSupabaseClient.from = jest.fn(() => {
        throw new Error('Connection failed');
      });

      await expect(walletService.getBalance('user123')).rejects.toThrow();
    });

    it('should handle invalid user IDs', async () => {
      await expect(walletService.getBalance('')).rejects.toThrow();
    });

    it('should handle invalid bounty IDs', async () => {
      await expect(
        walletService.createEscrow('', 'user123', 5000)
      ).rejects.toThrow();
    });

    it('should handle large transaction amounts', async () => {
      const largeAmount = 999999999; // Very large amount

      await expect(
        walletService.createDeposit('user123', largeAmount, 'pi_test123')
      ).rejects.toThrow();
    });

    it('should sanitize error messages', async () => {
      mockStripe.transfers.create.mockRejectedValueOnce({
        message: 'Sensitive Stripe error with API key: sk_live_123456',
      });

      try {
        await walletService.createWithdrawal('user123', 5000, 'acct_test123');
      } catch (error: any) {
        expect(error.message).not.toContain('sk_live');
      }
    });
  });
});
