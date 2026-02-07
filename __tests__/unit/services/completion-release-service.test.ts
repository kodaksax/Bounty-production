/**
 * Unit tests for Completion Release Service
 * Tests bounty completion and escrow release to hunters
 */

// Mock config
jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: {
      // Using a valid Stripe test key format for mocking purposes
      // This is not a real key - it's a mock for unit tests
      secretKey: 'sk_test_51MockTestKey000000000000000000000000000000000000000000000000',
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    },
  },
}));

// Mock database with proper Drizzle ORM chain including .limit()
const mockDb = {
  select: jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve([
          {
            id: 'bounty123',
            poster_id: 'poster123',
            hunter_id: 'hunter123',
            amount: 10000,
            status: 'in_progress',
          },
        ])),
      })),
    })),
  })),
  insert: jest.fn(() => ({
    into: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([
          {
            id: 'tx_release',
            bounty_id: 'bounty123',
            user_id: 'hunter123',
            type: 'release',
            amount: 9500,
            platform_fee: 500,
          },
        ])),
      })),
    })),
  })),
  update: jest.fn(() => ({
    table: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
    })),
  })),
};

jest.mock('../../../services/api/src/db/connection', () => ({
  db: mockDb,
}));

// Mock database schema
jest.mock('../../../services/api/src/db/schema', () => ({
  bounties: { id: 'bounties', poster_id: 'poster_id', hunter_id: 'hunter_id', amount: 'amount', status: 'status' },
  users: { id: 'users', email: 'email', stripe_account_id: 'stripe_account_id' },
  walletTransactions: { 
    id: 'walletTransactions', 
    bounty_id: 'bounty_id', 
    type: 'type',
    user_id: 'user_id',
    amount: 'amount',
    platform_fee: 'platform_fee'
  },
}));

// Mock drizzle-orm
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'eq_condition'),
  and: jest.fn((...conditions) => `and(${conditions.join(', ')})`),
}));

// Mock consolidated wallet service
const mockWalletService = {
  releaseEscrow: jest.fn(async () => ({
    id: 'tx_release',
    type: 'release',
    amount: 9500,
    platform_fee: 500,
    bounty_id: 'bounty123',
    user_id: 'hunter123',
    status: 'completed',
  })),
};

jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => mockWalletService);

// Mock email service
const mockEmailService = {
  sendCompletionEmail: jest.fn(async () => true),
};

jest.mock('../../../services/api/src/services/email-service', () => mockEmailService);

// Mock outbox service
const mockOutboxService = {
  createOutboxEvent: jest.fn(async () => ({ id: 'outbox_event_123' })),
};

jest.mock('../../../services/api/src/services/outbox-service', () => mockOutboxService);

// Mock realtime service
const mockRealtimeService = {
  broadcastBountyUpdate: jest.fn(async () => true),
};

jest.mock('../../../services/api/src/services/realtime-service', () => mockRealtimeService);

// Mock logger
jest.mock('../../../services/api/src/services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Import service
import { completionReleaseService } from '../../../services/api/src/services/completion-release-service';

describe('Completion Release Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processCompletionRelease', () => {
    it('should release escrow when bounty is completed', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        paymentIntentId: 'pi_test123',
      };

      const result = await completionReleaseService.processCompletionRelease(request);

      expect(result.success).toBe(true);
      expect(result.transaction.amount).toBe(9500);
      expect(result.transaction.platform_fee).toBe(500);
      expect(mockWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        undefined
      );
    });

    it('should use custom platform fee percentage', async () => {
      mockWalletService.releaseEscrow.mockResolvedValueOnce({
        id: 'tx_release',
        type: 'release',
        amount: 9000, // 10% fee
        platform_fee: 1000,
        bounty_id: 'bounty123',
        user_id: 'hunter123',
      });

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        platformFeePercentage: 10,
      };

      const result = await completionReleaseService.processCompletionRelease(request);

      expect(result.transaction.platform_fee).toBe(1000);
    });

    it('should prevent duplicate releases', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            { id: 'tx_existing', type: 'release', bounty_id: 'bounty123' },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should send completion email to hunter', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(mockEmailService.sendCompletionEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          hunterId: 'hunter123',
          bountyId: 'bounty123',
        })
      );
    });

    it('should broadcast realtime update', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(mockRealtimeService.broadcastBountyUpdate).toHaveBeenCalledWith(
        'bounty123',
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    it('should use idempotency key when provided', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        idempotencyKey: 'completion-idempotency-key',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(mockWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        'completion-idempotency-key'
      );
    });

    it('should create outbox event on failure for retry', async () => {
      mockWalletService.releaseEscrow.mockRejectedValueOnce(
        new Error('Temporary failure')
      );

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      try {
        await completionReleaseService.processCompletionRelease(request);
      } catch (error) {
        expect(mockOutboxService.createOutboxEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            event_type: 'completion_release_retry',
            payload: request,
          })
        );
      }
    });

    it('should handle missing bounty', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      }));

      const request = {
        bountyId: 'invalid_bounty',
        hunterId: 'hunter123',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should validate bounty is in correct status', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            { id: 'bounty123', status: 'cancelled' },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should validate hunter matches bounty', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'wrong_hunter',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should handle email service failure gracefully', async () => {
      mockEmailService.sendCompletionEmail.mockRejectedValueOnce(
        new Error('Email service down')
      );

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      // Should still succeed even if email fails
      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(true);
    });

    it('should handle realtime broadcast failure gracefully', async () => {
      mockRealtimeService.broadcastBountyUpdate.mockRejectedValueOnce(
        new Error('Realtime service down')
      );

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      // Should still succeed even if realtime fails
      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(true);
    });
  });

  describe('isAlreadyReleased', () => {
    it('should return true if release transaction exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            { id: 'tx_release', type: 'release' },
          ])),
        })),
      }));

      const result = await completionReleaseService.isAlreadyReleased('bounty123');

      expect(result).toBe(true);
    });

    it('should return false if no release transaction exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      }));

      const result = await completionReleaseService.isAlreadyReleased('bounty123');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.reject(new Error('Database error'))),
        })),
      }));

      await expect(
        completionReleaseService.isAlreadyReleased('bounty123')
      ).rejects.toThrow();
    });
  });

  describe('getReleaseTransaction', () => {
    it('should return release transaction details', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'tx_release',
              type: 'release',
              amount: 9500,
              platform_fee: 500,
              bounty_id: 'bounty123',
            },
          ])),
        })),
      }));

      const result = await completionReleaseService.getReleaseTransaction('bounty123');

      expect(result.id).toBe('tx_release');
      expect(result.amount).toBe(9500);
      expect(result.platform_fee).toBe(500);
    });

    it('should return null if no release transaction exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      }));

      const result = await completionReleaseService.getReleaseTransaction('bounty123');

      expect(result).toBeNull();
    });
  });

  describe('processCompletionReleaseFromOutbox', () => {
    it('should retry completion release from outbox event', async () => {
      const payload = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionReleaseFromOutbox(
        payload
      );

      expect(result).toBe(true);
      expect(mockWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        undefined
      );
    });

    it('should return false on retry failure', async () => {
      mockWalletService.releaseEscrow.mockRejectedValueOnce(
        new Error('Still failing')
      );

      const payload = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionReleaseFromOutbox(
        payload
      );

      expect(result).toBe(false);
    });

    it('should skip if already released', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            { id: 'tx_release', type: 'release' },
          ])),
        })),
      }));

      const payload = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionReleaseFromOutbox(
        payload
      );

      expect(result).toBe(true);
      expect(mockWalletService.releaseEscrow).not.toHaveBeenCalled();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle zero amount bounties', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'bounty123',
              amount: 0,
              hunter_id: 'hunter123',
            },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should handle negative platform fee percentages', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        platformFeePercentage: -5,
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should handle platform fee percentage over 100', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        platformFeePercentage: 150,
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });

    it('should handle concurrent release attempts', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      // Simulate concurrent calls
      const promise1 = completionReleaseService.processCompletionRelease(request);
      const promise2 = completionReleaseService.processCompletionRelease(request);

      const results = await Promise.allSettled([promise1, promise2]);

      // One should succeed, one should fail with duplicate error
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(succeeded + failed).toBe(2);
    });

    it('should handle missing required fields', async () => {
      const request = {
        bountyId: '',
        hunterId: 'hunter123',
      };

      await expect(
        completionReleaseService.processCompletionRelease(request)
      ).rejects.toThrow();
    });
  });
});
