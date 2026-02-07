/**
 * Unit tests for Stripe Connect Service
 * Tests Stripe Connect onboarding, account management, and payouts
 */

// Mock environment
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
});

// Mock database
const mockDb = {
  select: jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve([
          {
            id: 'user123',
            email: 'test@example.com',
            stripe_account_id: 'acct_test123',
          },
        ])),
      })),
    })),
  })),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve({ rowCount: 1 })),
    })),
  })),
};

jest.mock('../../../services/api/src/db/connection', () => ({
  db: mockDb,
}));

jest.mock('../../../services/api/src/db/schema', () => ({
  users: { id: 'users', stripe_account_id: 'stripe_account_id' },
  bounties: { id: 'bounties' },
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'eq_condition'),
}));

// Mock Stripe
const mockStripeAccount = {
  id: 'acct_test123',
  type: 'express',
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  requirements: {
    currently_due: [],
    eventually_due: [],
  },
};

const mockStripe = {
  accounts: {
    create: jest.fn(async () => mockStripeAccount),
    retrieve: jest.fn(async () => mockStripeAccount),
  },
  accountLinks: {
    create: jest.fn(async () => ({
      url: 'https://connect.stripe.com/setup/test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })),
  },
  paymentIntents: {
    create: jest.fn(async () => ({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
      amount: 5000,
      currency: 'usd',
      status: 'requires_payment_method',
    })),
  },
  refunds: {
    create: jest.fn(async () => ({
      id: 'ref_test123',
      amount: 5000,
      status: 'succeeded',
    })),
  },
};

jest.mock('stripe', () => {
  // Return a constructor function that returns the mock Stripe instance
  return jest.fn().mockImplementation(() => mockStripe);
});

// Import service after mocks
import { stripeConnectService } from '../../../services/api/src/services/stripe-connect-service';

describe('Stripe Connect Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOnboardingLink', () => {
    it('should create onboarding link for new Stripe account', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              {
                id: 'user123',
                email: 'test@example.com',
                stripe_account_id: null,
              },
            ])),
          })),
        })),
      }));

      const request = {
        userId: 'user123',
        refreshUrl: 'https://app.example.com/onboard/refresh',
        returnUrl: 'https://app.example.com/onboard/complete',
      };

      const result = await stripeConnectService.createOnboardingLink(request);

      expect(result.url).toBe('https://connect.stripe.com/setup/test');
      expect(result.expiresAt).toBeGreaterThan(Date.now() / 1000);
      expect(mockStripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'express',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        })
      );
    });

    it('should create onboarding link for existing Stripe account', async () => {
      const request = {
        userId: 'user123',
        refreshUrl: 'https://app.example.com/onboard/refresh',
        returnUrl: 'https://app.example.com/onboard/complete',
      };

      const result = await stripeConnectService.createOnboardingLink(request);

      expect(result.url).toBe('https://connect.stripe.com/setup/test');
      expect(mockStripe.accounts.create).not.toHaveBeenCalled();
      expect(mockStripe.accountLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          account: 'acct_test123',
          type: 'account_onboarding',
        })
      );
    });

    it('should use default URLs when not provided', async () => {
      const request = {
        userId: 'user123',
      };

      await stripeConnectService.createOnboardingLink(request);

      expect(mockStripe.accountLinks.create).toHaveBeenCalled();
    });

    it('should handle user not found', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      }));

      const request = {
        userId: 'invalid_user',
      };

      await expect(
        stripeConnectService.createOnboardingLink(request)
      ).rejects.toThrow('User not found');
    });

    it('should handle Stripe account creation failure', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              { id: 'user123', stripe_account_id: null },
            ])),
          })),
        })),
      }));

      mockStripe.accounts.create.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const request = {
        userId: 'user123',
      };

      await expect(
        stripeConnectService.createOnboardingLink(request)
      ).rejects.toThrow();
    });

    it('should update user with new Stripe account ID', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              { id: 'user123', stripe_account_id: null },
            ])),
          })),
        })),
      }));

      const request = {
        userId: 'user123',
      };

      await stripeConnectService.createOnboardingLink(request);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getConnectStatus', () => {
    it('should return connect status for user with Stripe account', async () => {
      const result = await stripeConnectService.getConnectStatus('user123');

      expect(result.hasStripeAccount).toBe(true);
      expect(result.stripeAccountId).toBe('acct_test123');
      expect(result.detailsSubmitted).toBe(true);
      expect(result.chargesEnabled).toBe(true);
      expect(result.payoutsEnabled).toBe(true);
      expect(mockStripe.accounts.retrieve).toHaveBeenCalledWith('acct_test123');
    });

    it('should return status for user without Stripe account', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              { id: 'user123', stripe_account_id: null },
            ])),
          })),
        })),
      }));

      const result = await stripeConnectService.getConnectStatus('user123');

      expect(result.hasStripeAccount).toBe(false);
      expect(result.stripeAccountId).toBeUndefined();
      expect(mockStripe.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('should indicate when account requires action', async () => {
      mockStripe.accounts.retrieve.mockResolvedValueOnce({
        ...mockStripeAccount,
        requirements: {
          currently_due: ['individual.id_number', 'individual.ssn_last_4'],
          eventually_due: [],
        },
      } as any);

      const result = await stripeConnectService.getConnectStatus('user123');

      expect(result.requiresAction).toBe(true);
      expect(result.currentlyDue).toEqual(['individual.id_number', 'individual.ssn_last_4']);
    });

    it('should handle incomplete account setup', async () => {
      mockStripe.accounts.retrieve.mockResolvedValueOnce({
        ...mockStripeAccount,
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false,
      } as any);

      const result = await stripeConnectService.getConnectStatus('user123');

      expect(result.detailsSubmitted).toBe(false);
      expect(result.chargesEnabled).toBe(false);
      expect(result.payoutsEnabled).toBe(false);
    });

    it('should handle user not found', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      }));

      await expect(
        stripeConnectService.getConnectStatus('invalid_user')
      ).rejects.toThrow();
    });
  });

  describe('createEscrowPaymentIntent', () => {
    it('should create escrow payment intent for bounty', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              {
                id: 'bounty123',
                amount: 5000,
                poster_id: 'user123',
                hunter_id: 'hunter123',
              },
            ])),
          })),
        })),
      }));

      const result = await stripeConnectService.createEscrowPaymentIntent('bounty123');

      expect(result.paymentIntentId).toBe('pi_test123');
      expect(result.clientSecret).toBe('pi_test123_secret_abc');
      expect(result.amount).toBe(5000);
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          metadata: expect.objectContaining({
            bountyId: 'bounty123',
            type: 'escrow',
          }),
        })
      );
    });

    it('should validate bounty exists', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      }));

      await expect(
        stripeConnectService.createEscrowPaymentIntent('invalid_bounty')
      ).rejects.toThrow();
    });

    it('should handle zero amount bounties', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              { id: 'bounty123', amount: 0 },
            ])),
          })),
        })),
      }));

      await expect(
        stripeConnectService.createEscrowPaymentIntent('bounty123')
      ).rejects.toThrow();
    });
  });

  describe('refundPaymentIntent', () => {
    it('should refund a payment intent', async () => {
      const result = await stripeConnectService.refundPaymentIntent(
        'pi_test123',
        'bounty123',
        'Bounty cancelled'
      );

      expect(result.id).toBe('ref_test123');
      expect(result.amount).toBe(5000);
      expect(result.status).toBe('succeeded');
      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_intent: 'pi_test123',
          metadata: expect.objectContaining({
            bountyId: 'bounty123',
          }),
        })
      );
    });

    it('should include refund reason in metadata', async () => {
      await stripeConnectService.refundPaymentIntent(
        'pi_test123',
        'bounty123',
        'User requested cancellation'
      );

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'User requested cancellation',
          }),
        })
      );
    });

    it('should handle partial refunds', async () => {
      mockStripe.refunds.create.mockResolvedValueOnce({
        id: 'ref_test123',
        amount: 2500,
        status: 'succeeded',
      } as any);

      const result = await stripeConnectService.refundPaymentIntent(
        'pi_test123',
        'bounty123'
      );

      expect(result.amount).toBe(2500);
    });

    it('should handle Stripe refund errors', async () => {
      mockStripe.refunds.create.mockRejectedValueOnce(
        new Error('Refund already processed')
      );

      await expect(
        stripeConnectService.refundPaymentIntent('pi_test123', 'bounty123')
      ).rejects.toThrow();
    });
  });

  describe('validatePaymentCapability', () => {
    it('should validate user can make payment', async () => {
      const result = await stripeConnectService.validatePaymentCapability(
        'user123',
        5000
      );

      expect(result.canPay).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for user without Stripe account', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([
              { id: 'user123', stripe_account_id: null },
            ])),
          })),
        })),
      }));

      const result = await stripeConnectService.validatePaymentCapability(
        'user123',
        5000
      );

      expect(result.canPay).toBe(false);
      expect(result.error).toBe('No Stripe account');
    });

    it('should return error for account with charges disabled', async () => {
      mockStripe.accounts.retrieve.mockResolvedValueOnce({
        ...mockStripeAccount,
        charges_enabled: false,
      } as any);

      const result = await stripeConnectService.validatePaymentCapability(
        'user123',
        5000
      );

      expect(result.canPay).toBe(false);
      expect(result.error).toBe('Charges not enabled');
    });

    it('should validate minimum payment amount', async () => {
      const result = await stripeConnectService.validatePaymentCapability(
        'user123',
        10 // Too small
      );

      expect(result.canPay).toBe(false);
      expect(result.error).toContain('minimum');
    });

    it('should handle user not found', async () => {
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      }));

      const result = await stripeConnectService.validatePaymentCapability(
        'invalid_user',
        5000
      );

      expect(result.canPay).toBe(false);
      expect(result.error).toBe('User not found');
    });
  });

  describe('handleWebhook', () => {
    it('should handle account.updated webhook', async () => {
      const payload = JSON.stringify({
        type: 'account.updated',
        data: {
          object: mockStripeAccount,
        },
      });

      const signature = 'whsec_test_signature';

      await expect(
        stripeConnectService.handleWebhook(payload, signature)
      ).resolves.not.toThrow();
    });

    it('should handle payment_intent.succeeded webhook', async () => {
      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            amount: 5000,
            metadata: {
              bountyId: 'bounty123',
            },
          },
        },
      });

      const signature = 'whsec_test_signature';

      await expect(
        stripeConnectService.handleWebhook(payload, signature)
      ).resolves.not.toThrow();
    });

    it('should handle refund.created webhook', async () => {
      const payload = JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test123',
            refunded: true,
          },
        },
      });

      const signature = 'whsec_test_signature';

      await expect(
        stripeConnectService.handleWebhook(payload, signature)
      ).resolves.not.toThrow();
    });

    it('should validate webhook signature', async () => {
      const payload = 'invalid_payload';
      const signature = 'invalid_signature';

      await expect(
        stripeConnectService.handleWebhook(payload, signature)
      ).rejects.toThrow();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle Stripe service not configured', async () => {
      const originalEnv = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      // Reimport to trigger constructor
      jest.resetModules();

      try {
        const serviceNoConfig = require('../../../services/api/src/services/stripe-connect-service');
        await expect(
          serviceNoConfig.createOnboardingLink({ userId: 'user123' })
        ).rejects.toThrow();
      } finally {
        process.env.STRIPE_SECRET_KEY = originalEnv;
      }
    });

    it('should handle database connection errors', async () => {
      mockDb.select = jest.fn(() => {
        throw new Error('Database connection failed');
      });

      await expect(
        stripeConnectService.getConnectStatus('user123')
      ).rejects.toThrow();
    });

    it('should handle Stripe API rate limits', async () => {
      mockStripe.accounts.retrieve.mockRejectedValueOnce({
        type: 'StripeRateLimitError',
        message: 'Too many requests',
      });

      await expect(
        stripeConnectService.getConnectStatus('user123')
      ).rejects.toThrow();
    });

    it('should handle network timeouts', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );

      await expect(
        stripeConnectService.createEscrowPaymentIntent('bounty123')
      ).rejects.toThrow();
    });
  });
});
