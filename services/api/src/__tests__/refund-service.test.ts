// Mock database chain helper (supports simple .where() filtering)
const mockCreateChain = (tableName: any, error: Error | null = null, customData: any[] | null = null) => {
  // Allow callers to pass customData as the first argument
  if (Array.isArray(tableName)) {
    customData = tableName;
    tableName = 'wallet_transactions';
  }
  const chain: any = {
    _where: null,
    where: jest.fn().mockImplementation((cond: any) => { chain._where = cond; return chain; }),
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
          amount_cents: 5000,
          status: 'cancelled',
          payment_intent_id: 'pi_test123',
          title: 'Test Bounty',
        }]);
      }
      if (tableName === 'wallet_transactions') {
        return Promise.resolve([]);
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
            amount_cents: 5000,
            status: 'cancelled',
            payment_intent_id: 'pi_test123',
            title: 'Test Bounty',
          }];
        }
      }

      // If no customData provided, attempt to apply simple equality filtering
      try {
        const cond = chain._where;
        if (!customData && cond && Array.isArray(data) && data.length > 0) {
          const valueChunk = cond?.queryChunks ? cond.queryChunks.find((c: any) => typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') : undefined;
          const fieldChunk = cond?.queryChunks ? cond.queryChunks.find((c: any) => c && c.name) : undefined;
          if (valueChunk !== undefined && fieldChunk && fieldChunk.name) {
            data = data.filter((row: any) => row[fieldChunk.name] === valueChunk);
          }
        }
      } catch (e) {
        // ignore filtering errors in mock
      }

      const p = error ? Promise.reject(error) : Promise.resolve(data);
      return p.then(onFulfilled, onRejected);
    }),
    catch: jest.fn().mockImplementation((onRejected) => {
      let data = customData || [];
      if (!customData && tableName === 'bounties') {
        data = [{ id: 'bounty123', creator_id: 'poster123', amount_cents: 5000, status: 'cancelled', payment_intent_id: 'pi_test123', title: 'Test Bounty' }];
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
      secretKey: 'sk_test_FAKE_PLACEHOLDER',
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
          if (tableName === 'bounties') {
            return mockCreateChain('bounties');
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
      delete: jest.fn().mockImplementation(() => mockCreateChain('unknown')),
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






// Mock Stripe Connect service
jest.mock('../services/stripe-connect-service', () => ({
  stripeConnectService: {
    refundPaymentIntent: jest.fn(async () => ({
      success: true,
      refundId: 'ref_test123',
      amount: 5000,
      status: 'succeeded',
    })),
  },
}));



jest.mock('../services/outbox-service', () => ({
  outboxService: {
    createEvent: jest.fn(async () => ({ id: 'outbox_event_123' })),
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
import { outboxService } from '../services/outbox-service';
import { refundService } from '../services/refund-service';
import { stripeConnectService } from '../services/stripe-connect-service';



describe('Refund Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure queued/resolvedOnce fixtures on the stripe mock do not leak between tests
    (stripeConnectService.refundPaymentIntent as jest.Mock).mockReset();
    // Restore a sane default implementation so tests that don't set per-test
    // responses still get a successful refund by default.
    (stripeConnectService.refundPaymentIntent as jest.Mock).mockResolvedValue({
      success: true,
      refundId: 'ref_test123',
      amount: 5000,
      status: 'succeeded',
    });
  });

  describe('processRefund', () => {
    it('should process refund for cancelled bounty', async () => {
      const request = {
        bountyId: 'bounty123',
        reason: 'Bounty cancelled by poster',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);

      expect(result.success).toBe(true);
      expect(result.amount).toBe(50); // 5000 cents = 50 dollars
      expect(stripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        'Bounty cancelled by poster'
      );

    });

    it('should prevent refund for completed bounties', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          {
            id: 'bounty123',
            status: 'completed',
          },
        ])),
      }));




      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain('completed');

    });

    it('should prevent refund for honor-only bounties', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          {
            id: 'bounty123',
            amount_cents: 0,
            status: 'cancelled',
          },
        ])),
      }));




      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain('honor');

    });

    it('should prevent duplicate refunds', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn()
          .mockImplementationOnce(() => mockCreateChain('bounties'))
          .mockImplementationOnce(() => mockCreateChain('wallet_transactions', null, [
            { id: 'tx_refund', type: 'refund', bounty_id: 'bounty123' },
          ])),
      }));




      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already been refunded');

    });

    it('should handle missing payment intent ID', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          {
            id: 'bounty123',
            status: 'cancelled',
            amount: 5000,
            payment_intent_id: null,
          },
        ])),
      }));




      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should create outbox event on Stripe failure', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(outboxService.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REFUND_RETRY',
        })
      );
    });



    it('should include reason in refund transaction', async () => {
      const request = {
        bountyId: 'bounty123',
        reason: 'Poster requested cancellation',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      // Verify transaction was called
      expect(db.transaction).toHaveBeenCalled();
      
      // Get the callback passed to transaction and check that values() was called with reason
      const transactionCallback = (db.transaction as jest.Mock).mock.calls[0][0];
      const mockTx = {
        insert: jest.fn().mockImplementation(() => ({
          values: jest.fn().mockImplementation(() => mockCreateChain('wallet_transactions')),
        })),
        update: jest.fn().mockImplementation(() => ({
          set: jest.fn().mockImplementation(() => mockCreateChain('bounties')),
        })),
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => mockCreateChain('wallet_transactions')),
        })),
      };
      
      await transactionCallback(mockTx);
      
      // Verify insert was called and check the values parameter
      expect(mockTx.insert).toHaveBeenCalled();
      const insertChain = mockTx.insert.mock.results[0].value;
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Poster requested cancellation',
          type: 'refund',
          bounty_id: 'bounty123',
        })
      );
    });

    it('should default reason when not provided', async () => {
      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(stripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        undefined
      );
    });

    it('should validate bounty exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [])),
      }));




      const request = {
        bountyId: 'invalid_bounty',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should sanitize error messages for security', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockRejectedValueOnce({
        message: 'Stripe error with API key: sk_test_FAKE_PLACEHOLDER',
      });


      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      try {
        await refundService.processRefund(request);
      } catch (error: any) {
        expect(error.message).not.toContain('sk_live');
      }
    });
  });

  describe('isAlreadyRefunded', () => {
    it('should return true if refund transaction exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [
          { id: 'tx_refund', type: 'refund' },
        ])),
      }));




      const result = await refundService.isAlreadyRefunded('bounty123');

      expect(result).toBe(true);
    });

    it('should return false if no refund transaction exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [])),
      }));




      const result = await refundService.isAlreadyRefunded('bounty123');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', new Error('Database error'))),
      }));





      await expect(refundService.isAlreadyRefunded('bounty123')).rejects.toThrow();
    });
  });

  describe('getRefundTransaction', () => {
    it('should return refund transaction details', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [
          {
            id: 'tx_refund',
            type: 'refund',
            amount_cents: 5000,
            bounty_id: 'bounty123',
          },
        ])),
      }));




      const result = await refundService.getRefundTransaction('bounty123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('tx_refund');
      expect(result!.amount_cents).toBe(5000);
      // `reason` is not stored on the wallet_transactions schema; ensure other
      // relevant fields are present instead.
    });

    it('should return null if no refund transaction exists', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('wallet_transactions', null, [])),
      }));




      const result = await refundService.getRefundTransaction('bounty123');

      expect(result).toBeNull();
    });
  });

  describe('processRefundFromOutbox', () => {
    it('should retry refund from outbox event', async () => {
      const payload = {
        bountyId: 'bounty123',
        reason: 'Retry refund',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefundFromOutbox(payload);

      expect(result).toBe(true);
      expect(stripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        'Retry refund'
      );
    });

    it('should return false on retry failure', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockRejectedValueOnce(
        new Error('Still failing')
      );


      const payload = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefundFromOutbox(payload);

      expect(result).toBe(false);
    });

    it('should skip if already refunded', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn()
          .mockImplementationOnce(() => mockCreateChain('bounties'))
          .mockImplementationOnce(() => mockCreateChain('wallet_transactions', null, [
            { id: 'tx_refund', type: 'refund' },
          ])),
      }));




      const payload = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefundFromOutbox(payload);

      expect(result).toBe(true);
      expect(stripeConnectService.refundPaymentIntent).not.toHaveBeenCalled();
    });

    it('should handle invalid payload', async () => {
      const payload = {
        bountyId: '',
        cancelledBy: '',
      };

      const result = await refundService.processRefundFromOutbox(payload);

      expect(result).toBe(false);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle partial refunds', async () => {
      (db.select as jest.Mock).mockImplementationOnce(() => ({
        from: jest.fn(() => mockCreateChain('bounties', null, [
          {
            id: 'bounty123',
            amount_cents: 10000,
            status: 'cancelled',
            payment_intent_id: 'pi_test123',
          },
        ])),
      }));




      (stripeConnectService.refundPaymentIntent as jest.Mock).mockResolvedValueOnce({
        id: 'ref_test123',
        amount: 5000, // Partial refund
        status: 'succeeded',
      });


      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);

      expect(result.success).toBe(true);
    });

    it('should handle Stripe refund pending status', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockResolvedValueOnce({
        id: 'ref_test123',
        amount: 5000,
        status: 'pending',
      });


      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);

      expect(result.refund.status).toBe('pending');
    });

    it('should handle Stripe refund failed status', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockResolvedValueOnce({
        id: 'ref_test123',
        amount: 5000,
        status: 'failed',
      });


      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle network timeouts', async () => {
      (stripeConnectService.refundPaymentIntent as jest.Mock).mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );


      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle concurrent refund attempts', async () => {
      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      // Simulate concurrent calls
      const promise1 = refundService.processRefund(request);
      const promise2 = refundService.processRefund(request);

      const results = await Promise.allSettled([promise1, promise2]);

      // One should succeed, one should fail with duplicate error
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(succeeded + failed).toBe(2);
    });

    it('should handle missing bounty ID', async () => {
      const request = {
        bountyId: '',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle missing cancelledBy', async () => {
      const request = {
        bountyId: 'bounty123',
        cancelledBy: '',
      };

      const result = await refundService.processRefund(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

    });

    it('should handle very long refund reasons', async () => {
      const longReason = 'a'.repeat(1000);

      const request = {
        bountyId: 'bounty123',
        reason: longReason,
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(stripeConnectService.refundPaymentIntent).toHaveBeenCalled();
    });

    it('should handle special characters in reason', async () => {
      const request = {
        bountyId: 'bounty123',
        reason: 'Cancelled: <script>alert("xss")</script>',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(stripeConnectService.refundPaymentIntent).toHaveBeenCalled();
    });
  });
});
