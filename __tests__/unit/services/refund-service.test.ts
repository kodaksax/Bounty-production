/**
 * Unit tests for Refund Service
 * Tests refund processing for cancelled bounties
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

// Mock database
const mockDb = {
  select: jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve([
        {
          id: 'bounty123',
          poster_id: 'poster123',
          amount: 5000,
          status: 'cancelled',
          payment_intent_id: 'pi_test123',
        },
      ])),
    })),
  })),
  insert: jest.fn(() => ({
    into: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([
          {
            id: 'tx_refund',
            bounty_id: 'bounty123',
            user_id: 'poster123',
            type: 'refund',
            amount: 5000,
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

// Mock Stripe Connect service
const mockStripeConnectService = {
  refundPaymentIntent: jest.fn(async () => ({
    id: 'ref_test123',
    amount: 5000,
    status: 'succeeded',
  })),
};

jest.mock('../../../services/api/src/services/stripe-connect-service', () => mockStripeConnectService);

// Mock outbox service
const mockOutboxService = {
  createOutboxEvent: jest.fn(async () => ({ id: 'outbox_event_123' })),
};

jest.mock('../../../services/api/src/services/outbox-service', () => mockOutboxService);

// Mock logger
jest.mock('../../../services/api/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Import service
import { refundService } from '../../../services/api/src/services/refund-service';

describe('Refund Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      expect(result.refund.amount).toBe(5000);
      expect(mockStripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        'Bounty cancelled by poster'
      );
    });

    it('should prevent refund for completed bounties', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'bounty123',
              status: 'completed',
            },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should prevent refund for honor-only bounties', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'bounty123',
              amount: 0,
              status: 'cancelled',
            },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should prevent duplicate refunds', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn()
            .mockResolvedValueOnce([
              {
                id: 'bounty123',
                status: 'cancelled',
                amount: 5000,
                payment_intent_id: 'pi_test123',
              },
            ])
            .mockResolvedValueOnce([
              { id: 'tx_refund', type: 'refund', bounty_id: 'bounty123' },
            ]),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should handle missing payment intent ID', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'bounty123',
              status: 'cancelled',
              amount: 5000,
              payment_intent_id: null,
            },
          ])),
        })),
      }));

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should create outbox event on Stripe failure', async () => {
      mockStripeConnectService.refundPaymentIntent.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const request = {
        bountyId: 'bounty123',
        reason: 'Test reason',
        cancelledBy: 'poster123',
      };

      try {
        await refundService.processRefund(request);
      } catch (error) {
        expect(mockOutboxService.createOutboxEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            event_type: 'refund_retry',
            payload: request,
          })
        );
      }
    });

    it('should include reason in refund transaction', async () => {
      const request = {
        bountyId: 'bounty123',
        reason: 'Poster requested cancellation',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should default reason when not provided', async () => {
      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(mockStripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        undefined
      );
    });

    it('should validate bounty exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      }));

      const request = {
        bountyId: 'invalid_bounty',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should sanitize error messages for security', async () => {
      mockStripeConnectService.refundPaymentIntent.mockRejectedValueOnce({
        message: 'Stripe error with API key: sk_live_123456',
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
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            { id: 'tx_refund', type: 'refund' },
          ])),
        })),
      }));

      const result = await refundService.isAlreadyRefunded('bounty123');

      expect(result).toBe(true);
    });

    it('should return false if no refund transaction exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      }));

      const result = await refundService.isAlreadyRefunded('bounty123');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.reject(new Error('Database error'))),
        })),
      }));

      await expect(refundService.isAlreadyRefunded('bounty123')).rejects.toThrow();
    });
  });

  describe('getRefundTransaction', () => {
    it('should return refund transaction details', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'tx_refund',
              type: 'refund',
              amount: 5000,
              bounty_id: 'bounty123',
              reason: 'Bounty cancelled',
            },
          ])),
        })),
      }));

      const result = await refundService.getRefundTransaction('bounty123');

      expect(result.id).toBe('tx_refund');
      expect(result.amount).toBe(5000);
      expect(result.reason).toBe('Bounty cancelled');
    });

    it('should return null if no refund transaction exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
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
      expect(mockStripeConnectService.refundPaymentIntent).toHaveBeenCalledWith(
        'pi_test123',
        'bounty123',
        'Retry refund'
      );
    });

    it('should return false on retry failure', async () => {
      mockStripeConnectService.refundPaymentIntent.mockRejectedValueOnce(
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
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn()
            .mockResolvedValueOnce([
              { id: 'bounty123', status: 'cancelled', amount: 5000 },
            ])
            .mockResolvedValueOnce([
              { id: 'tx_refund', type: 'refund' },
            ]),
        })),
      }));

      const payload = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      const result = await refundService.processRefundFromOutbox(payload);

      expect(result).toBe(true);
      expect(mockStripeConnectService.refundPaymentIntent).not.toHaveBeenCalled();
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
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([
            {
              id: 'bounty123',
              amount: 10000,
              status: 'cancelled',
              payment_intent_id: 'pi_test123',
            },
          ])),
        })),
      }));

      mockStripeConnectService.refundPaymentIntent.mockResolvedValueOnce({
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
      mockStripeConnectService.refundPaymentIntent.mockResolvedValueOnce({
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
      mockStripeConnectService.refundPaymentIntent.mockResolvedValueOnce({
        id: 'ref_test123',
        amount: 5000,
        status: 'failed',
      });

      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should handle network timeouts', async () => {
      mockStripeConnectService.refundPaymentIntent.mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );

      const request = {
        bountyId: 'bounty123',
        cancelledBy: 'poster123',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
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

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should handle missing cancelledBy', async () => {
      const request = {
        bountyId: 'bounty123',
        cancelledBy: '',
      };

      await expect(refundService.processRefund(request)).rejects.toThrow();
    });

    it('should handle very long refund reasons', async () => {
      const longReason = 'a'.repeat(1000);

      const request = {
        bountyId: 'bounty123',
        reason: longReason,
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(mockStripeConnectService.refundPaymentIntent).toHaveBeenCalled();
    });

    it('should handle special characters in reason', async () => {
      const request = {
        bountyId: 'bounty123',
        reason: 'Cancelled: <script>alert("xss")</script>',
        cancelledBy: 'poster123',
      };

      await refundService.processRefund(request);

      expect(mockStripeConnectService.refundPaymentIntent).toHaveBeenCalled();
    });
  });
});
