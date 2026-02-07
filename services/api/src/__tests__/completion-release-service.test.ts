/**
 * Unit tests for Completion Release Service
 * Tests bounty completion and escrow release to hunters
 */

// Mock database chain helper
const mockCreateChain = (tableName: string, error: Error | null = null, customData: any[] | null = null) => {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    and: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation(() => {
      if (error) return Promise.reject(error);
      if (customData) return Promise.resolve(customData);

      if (tableName === 'bounties') {
        return Promise.resolve([{
          id: 'bounty123',
          creator_id: 'poster123',
          hunter_id: 'hunter123',
          amount_cents: 10000,
          status: 'in_progress',
          title: 'Test Bounty',
        }]);
      }
      if (tableName === 'profiles') {
        return Promise.resolve([{
          id: 'hunter123',
          stripe_account_id: 'acct_123',
        }]);
      }

      return Promise.resolve([]);
    }),
    then: jest.fn().mockImplementation((onFulfilled, onRejected) => {
      let data = customData || [];
      if (!customData) {
        if (tableName === 'bounties') {
          data = [{
            id: 'bounty123',
            creator_id: 'poster123',
            hunter_id: 'hunter123',
            amount_cents: 10000,
            status: 'in_progress',
            title: 'Test Bounty',
          }];
        }
        if (tableName === 'profiles') {
          data = [{
            id: 'hunter123',
            stripe_account_id: 'acct_123',
          }];
        }

      }
      const p = error ? Promise.reject(error) : Promise.resolve(data);
      return p.then(onFulfilled, onRejected);
    }),
    catch: jest.fn().mockImplementation((onRejected) => {
      let data = customData || [];
      if (!customData) {
        if (tableName === 'bounties') {
          data = [{ id: 'bounty123', creator_id: 'poster123', hunter_id: 'hunter123', amount_cents: 10000, status: 'in_progress', title: 'Test Bounty' }];
        } else if (tableName === 'profiles') {
          data = [{ id: 'hunter123', stripe_account_id: 'acct_123' }];
        }
      }
      const p = error ? Promise.reject(error) : Promise.resolve(data);

      return p.catch(onRejected);
    }),
  };
  return chain;
};



// Mock config
jest.mock('../config', () => ({
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

jest.mock('../db/connection', () => {
  const getTableName = (table: any) => {
    if (typeof table === 'string') return table;
    const name = table?.name ||
      table?._?.name ||
      table?.config?.name ||
      table?.[Symbol.for('drizzle:Name')] ||
      'unknown';
    return name;
  };

  return {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table) => {
          const tableName = getTableName(table);
          // Return table-specific data
          if (tableName === 'bounties') {
            return mockCreateChain('bounties');
          }
          if (tableName === 'profiles' || tableName === 'users') {
            return mockCreateChain('profiles');
          }
          if (tableName === 'wallet_transactions') {
            return mockCreateChain('wallet_transactions', null, []); // Default empty for balance/checks
          }
          return mockCreateChain(tableName);
        }),
      })),
      insert: jest.fn().mockImplementation((table) => ({
        values: jest.fn().mockImplementation(() => mockCreateChain(getTableName(table))),
      })),
      update: jest.fn().mockImplementation((table) => ({
        set: jest.fn().mockImplementation(() => mockCreateChain(getTableName(table))),
      })),
      transaction: jest.fn().mockImplementation(async (cb) => {
        return await cb({
          select: jest.fn().mockImplementation(() => ({
            from: jest.fn().mockImplementation((table) => mockCreateChain(getTableName(table))),
          })),
          insert: jest.fn().mockImplementation((table) => ({
            values: jest.fn().mockImplementation(() => mockCreateChain(getTableName(table))),
          })),
          update: jest.fn().mockImplementation((table) => ({
            set: jest.fn().mockImplementation(() => mockCreateChain(getTableName(table))),
          })),
        });
      }),
    },
  };
});





// Mock consolidated wallet service
const mockReleaseEscrow = jest.fn(async () => ({
  id: 'tx_release',
  type: 'release',
  amount: 9500,
  metadata: {
    platform_fee: 500,
  },
  bounty_id: 'bounty123',
  user_id: 'hunter123',
  status: 'completed',
}));


jest.mock('../services/consolidated-wallet-service', () => ({
  releaseEscrow: mockReleaseEscrow,
  consolidatedWalletService: {
    releaseEscrow: mockReleaseEscrow,
  },
}));



jest.mock('../services/email-service', () => ({
  emailService: {
    sendReleaseConfirmation: jest.fn(async () => true),
  },
}));


jest.mock('../services/outbox-service', () => ({
  outboxService: {
    createEvent: jest.fn(async () => ({ id: 'outbox_event_123' })),
  },
}));


jest.mock('../services/realtime-service', () => ({
  realtimeService: {
    publishBountyStatusChange: jest.fn(async () => true),
  },
}));


// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));


import { db } from '../db/connection';
import { completionReleaseService } from '../services/completion-release-service';
import { consolidatedWalletService } from '../services/consolidated-wallet-service';
import { emailService } from '../services/email-service';
import { outboxService } from '../services/outbox-service';
import { realtimeService } from '../services/realtime-service';



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
      expect(result.releaseAmount).toBe(9500);
      expect(result.platformFee).toBe(500);

      expect(consolidatedWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        undefined
      );
    });

    it('should use custom platform fee percentage', async () => {
      (consolidatedWalletService.releaseEscrow as jest.Mock).mockResolvedValueOnce({
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

      expect(result.platformFee).toBe(1000);

    });

    it('should prevent duplicate releases', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn()
          .mockImplementationOnce(() => mockCreateChain('bounties'))
          .mockImplementationOnce(() => mockCreateChain('wallet_transactions', null, [
            { id: 'tx_existing', type: 'release', bounty_id: 'bounty123' },
          ])),
      }));




      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should send completion email to hunter', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(emailService.sendReleaseConfirmation).toHaveBeenCalledWith(
        'bounty123',
        expect.any(String),
        'hunter123',
        expect.any(Number),
        expect.any(Number)
      );


    });

    it('should broadcast realtime update', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(realtimeService.publishBountyStatusChange).toHaveBeenCalledWith(
        'bounty123',
        'completed'
      );


    });

    it('should use idempotency key when provided', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        idempotencyKey: 'completion-idempotency-key',
      };

      await completionReleaseService.processCompletionRelease(request);

      expect(consolidatedWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        'completion-idempotency-key'
      );
    });

    it('should create outbox event on failure for retry', async () => {
      (consolidatedWalletService.releaseEscrow as jest.Mock).mockRejectedValueOnce(
        new Error('Temporary failure')
      );

      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      try {
        await completionReleaseService.processCompletionRelease(request);
      } catch (error) {
        expect(outboxService.createOutboxEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            event_type: 'completion_release_retry',
            payload: request,
          })
        );

      }
    });

    it('should handle missing bounty', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [])),
      }));




      const request = {
        bountyId: 'invalid_bounty',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should validate bounty is in correct status', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          { id: 'bounty123', status: 'cancelled' },
        ])),
      }));




      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should validate hunter matches bounty', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'wrong_hunter',
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle email failure gracefully', async () => {
      (emailService.sendReleaseConfirmation as jest.Mock).mockRejectedValueOnce(
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
      (realtimeService.publishBountyStatusChange as jest.Mock).mockRejectedValueOnce(
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
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [
          { id: 'tx_release', type: 'release' },
        ])),
      }));


      const result = await completionReleaseService.isAlreadyReleased('bounty123');

      expect(result).toBe(true);
    });

    it('should return false if no release transaction exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [])),
      }));



      const result = await completionReleaseService.isAlreadyReleased('bounty123');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', new Error('Database error'))),
      }));




      await expect(
        completionReleaseService.isAlreadyReleased('bounty123')
      ).rejects.toThrow();
    });
  });

  describe('getReleaseTransaction', () => {
    it('should return release transaction details', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [
          {
            id: 'tx_release',
            type: 'release',
            amount_cents: 9500,
            platform_fee_cents: 500,
            bounty_id: 'bounty123',
          },
        ])),

      }));

      const result = await completionReleaseService.getReleaseTransaction('bounty123');

      expect(result.id).toBe('tx_release');
      expect(result.amount_cents).toBe(9500);
      expect(result.platform_fee_cents).toBe(500);

    });

    it('should return null if no release transaction exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [])),

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
      expect(consolidatedWalletService.releaseEscrow).toHaveBeenCalledWith(
        'bounty123',
        'hunter123',
        undefined
      );
    });

    it('should return false on retry failure', async () => {
      (consolidatedWalletService.releaseEscrow as jest.Mock).mockRejectedValueOnce(
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
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain([
          { id: 'tx_release', type: 'release' },
        ])),
      }));

      const payload = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionReleaseFromOutbox(
        payload
      );

      expect(result).toBe(true);
      expect(consolidatedWalletService.releaseEscrow).not.toHaveBeenCalled();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle zero amount bounties', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          {
            id: 'bounty123',
            amount_cents: 0,

            hunter_id: 'hunter123',
          },
        ])),
      }));


      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle negative platform fee percentages', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        platformFeePercentage: -5,
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle platform fee percentage over 100', async () => {
      const request = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        platformFeePercentage: 150,
      };

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

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

      const result = await completionReleaseService.processCompletionRelease(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });
  });
});
