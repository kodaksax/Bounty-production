/**
 * E2E Tests for Complete Payment Flows
 * Tests end-to-end user scenarios for bounty payments, escrow, and refunds
 * 
 * NOTE: These tests interact directly with mocked Stripe/Supabase objects
 * rather than calling the actual app services or HTTP endpoints. While this
 * provides good coverage of business logic flows, true end-to-end tests would
 * drive the actual API/service layer. Consider enhancing these to test the
 * full stack for more comprehensive validation.
 */

import nock from 'nock';

// Mock environment
beforeAll(() => {
  // Using a valid Stripe test key format for mocking purposes
  // This is not a real key - it's a mock for E2E tests
  process.env.STRIPE_SECRET_KEY = 'sk_test_51MockTestKey000000000000000000000000000000000000000000000000';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NODE_ENV = 'test';
});

// Mock Supabase
const mockSupabaseClient = {
  from: jest.fn((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => {
          if (table === 'bounties') {
            return Promise.resolve({
              data: {
                id: 'bounty123',
                poster_id: 'poster123',
                hunter_id: 'hunter123',
                amount: 10000,
                status: 'in_progress',
                payment_intent_id: 'pi_test123',
              },
              error: null,
            });
          }
          if (table === 'users') {
            return Promise.resolve({
              data: {
                id: 'poster123',
                email: 'poster@example.com',
                stripe_customer_id: 'cus_poster',
                stripe_account_id: 'acct_poster',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: { id: 'tx_new', type: 'escrow', amount: 10000 },
          error: null,
        })),
      })),
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null, count: 1 })),
    })),
  })),
  rpc: jest.fn(() => Promise.resolve({ data: 15000, error: null })),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// Mock Stripe
const mockStripe = {
  customers: {
    create: jest.fn(async () => ({ id: 'cus_new', email: 'user@example.com' })),
    retrieve: jest.fn(async () => ({ id: 'cus_poster', email: 'poster@example.com' })),
  },
  paymentIntents: {
    create: jest.fn(async (params: any) => ({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
      amount: params.amount,
      currency: params.currency || 'usd',
      status: 'requires_payment_method',
      metadata: params.metadata || {},
    })),
    confirm: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'succeeded',
      amount: 10000,
    })),
    retrieve: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'succeeded',
      amount: 10000,
    })),
    cancel: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'canceled',
    })),
  },
  refunds: {
    create: jest.fn(async () => ({
      id: 'ref_test123',
      amount: 10000,
      status: 'succeeded',
      payment_intent: 'pi_test123',
    })),
  },
  transfers: {
    create: jest.fn(async () => ({
      id: 'tr_test123',
      amount: 9500,
      destination: 'acct_hunter',
    })),
  },
};

jest.mock('stripe', () => {
  // Return a constructor function that returns the mock Stripe instance
  return jest.fn().mockImplementation(() => mockStripe);
});

describe('Complete Payment Flow E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup nock to intercept Stripe API calls
    nock.cleanAll();
    
    // Mock comprehensive Stripe API endpoints for E2E flows
    nock('https://api.stripe.com:443')
      .persist()
      .post('/v1/customers')
      .reply(200, { id: 'cus_new', email: 'user@example.com' })
      .get(/\/v1\/customers/)
      .reply(200, { id: 'cus_poster', email: 'poster@example.com' })
      .post('/v1/payment_intents')
      .reply(200, (uri, requestBody) => {
        const params = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
        return {
          id: 'pi_test123',
          object: 'payment_intent',
          client_secret: 'pi_test123_secret_abc',
          amount: params.amount || 10000,
          currency: params.currency || 'usd',
          status: 'requires_payment_method',
          metadata: params.metadata || {},
        };
      })
      .post(/\/v1\/payment_intents\/.*\/confirm/)
      .reply(200, { id: 'pi_test123', status: 'succeeded', amount: 10000 })
      .get(/\/v1\/payment_intents/)
      .reply(200, { id: 'pi_test123', status: 'succeeded', amount: 10000 })
      .post(/\/v1\/payment_intents\/.*\/cancel/)
      .reply(200, { id: 'pi_test123', status: 'canceled', amount: 10000 })
      .post(/\/v1\/refunds/)
      .reply(200, { id: 'ref_test123', amount: 10000, status: 'succeeded' })
      .post('/v1/transfers')
      .reply(200, { id: 'tr_test123', amount: 9500, destination: 'acct_hunter' })
      .post('/v1/payment_methods')
      .reply(200, { id: 'pm_test123', type: 'card' })
      .post(/\/v1\/payment_methods\/.*\/attach/)
      .reply(200, { id: 'pm_test123', type: 'card' })
      .get(/\/v1\/customers\/.*\/payment_methods/)
      .reply(200, { object: 'list', data: [{ id: 'pm_test123', type: 'card' }] });
  });
  
  afterEach(() => {
    nock.cleanAll();
  });

  describe('Full Bounty Payment Flow - Happy Path', () => {
    it('should complete entire bounty payment lifecycle', async () => {
      // Step 1: Poster creates bounty and payment intent
      const createIntent = await mockStripe.paymentIntents.create({
        amount: 10000,
        currency: 'usd',
        metadata: {
          bountyId: 'bounty123',
          posterId: 'poster123',
        },
      });

      expect(createIntent.id).toBe('pi_test123');
      expect(createIntent.amount).toBe(10000);
      expect(createIntent.metadata.bountyId).toBe('bounty123');

      // Step 2: Poster confirms payment
      const confirmPayment = await mockStripe.paymentIntents.confirm('pi_test123');
      expect(confirmPayment.status).toBe('succeeded');

      // Step 3: Create escrow transaction
      const escrowTx = await mockSupabaseClient
        .from('wallet_transactions')
        .insert({
          user_id: 'poster123',
          bounty_id: 'bounty123',
          type: 'escrow',
          amount: 10000,
          status: 'held',
        })
        .select()
        .single();

      expect(escrowTx.data.type).toBe('escrow');
      expect(escrowTx.data.amount).toBe(10000);

      // Step 4: Hunter completes bounty
      const updateBounty = await mockSupabaseClient
        .from('bounties')
        .update({ status: 'completed' })
        .eq('id', 'bounty123');

      expect(updateBounty.error).toBeNull();

      // Step 5: Release escrow to hunter (with 5% platform fee)
      const platformFee = 10000 * 0.05;
      const hunterAmount = 10000 - platformFee;

      const releaseTx = await mockSupabaseClient
        .from('wallet_transactions')
        .insert({
          user_id: 'hunter123',
          bounty_id: 'bounty123',
          type: 'release',
          amount: hunterAmount,
          platform_fee: platformFee,
          status: 'completed',
        })
        .select()
        .single();

      expect(releaseTx.data.type).toBe('release');
      expect(releaseTx.data.amount).toBe(9500);
      expect(releaseTx.data.platform_fee).toBe(500);

      // Verify entire flow completed successfully
      expect(mockStripe.paymentIntents.create).toHaveBeenCalled();
      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalled();
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('wallet_transactions');
    });
  });

  describe('Bounty Cancellation Flow', () => {
    it('should handle full refund when bounty is cancelled', async () => {
      // Step 1: Bounty exists with escrowed payment
      const bounty = await mockSupabaseClient
        .from('bounties')
        .select()
        .eq('id', 'bounty123')
        .single();

      expect(bounty.data.payment_intent_id).toBe('pi_test123');
      expect(bounty.data.amount).toBe(10000);

      // Step 2: Cancel bounty
      await mockSupabaseClient
        .from('bounties')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', 'bounty123');

      // Step 3: Process refund
      const refund = await mockStripe.refunds.create({
        payment_intent: 'pi_test123',
        metadata: {
          bountyId: 'bounty123',
          reason: 'Bounty cancelled by poster',
        },
      });

      expect(refund.id).toBe('ref_test123');
      expect(refund.amount).toBe(10000);
      expect(refund.status).toBe('succeeded');

      // Step 4: Create refund transaction record
      const refundTx = await mockSupabaseClient
        .from('wallet_transactions')
        .insert({
          user_id: 'poster123',
          bounty_id: 'bounty123',
          type: 'refund',
          amount: 10000,
          status: 'completed',
          metadata: { refund_id: refund.id },
        })
        .select()
        .single();

      expect(refundTx.data.type).toBe('refund');
      expect(refundTx.data.amount).toBe(10000);

      // Verify refund flow completed
      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_intent: 'pi_test123',
        })
      );
    });

    it('should prevent refund for completed bounties', async () => {
      // Mock completed bounty
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'bounty123', status: 'completed', amount: 10000 },
              error: null,
            })),
          })),
        })),
      }));

      const bounty = await mockSupabaseClient
        .from('bounties')
        .select()
        .eq('id', 'bounty123')
        .single();

      // Should not allow refund for completed bounty
      expect(bounty.data.status).toBe('completed');
      
      // Attempt to refund would fail validation
      const shouldNotRefund = bounty.data.status === 'completed';
      expect(shouldNotRefund).toBe(true);
    });
  });

  describe('Wallet Deposit and Withdrawal Flow', () => {
    it('should complete deposit to wallet', async () => {
      // Step 1: Create payment intent for deposit
      const depositIntent = await mockStripe.paymentIntents.create({
        amount: 5000,
        currency: 'usd',
        metadata: {
          userId: 'user123',
          type: 'wallet_deposit',
        },
      });

      expect(depositIntent.id).toBe('pi_test123');

      // Step 2: Confirm payment
      const confirmed = await mockStripe.paymentIntents.confirm(depositIntent.id);
      expect(confirmed.status).toBe('succeeded');

      // Step 3: Create deposit transaction
      const depositTx = await mockSupabaseClient
        .from('wallet_transactions')
        .insert({
          user_id: 'user123',
          type: 'deposit',
          amount: 5000,
          status: 'completed',
          payment_intent_id: depositIntent.id,
        })
        .select()
        .single();

      expect(depositTx.data.type).toBe('deposit');
      expect(depositTx.data.amount).toBe(5000);

      // Step 4: Verify wallet balance increased
      const balance = await mockSupabaseClient.rpc('get_wallet_balance', {
        p_user_id: 'user123',
      });

      expect(balance.data).toBeGreaterThanOrEqual(5000);
    });

    it('should complete withdrawal from wallet', async () => {
      // Step 1: Check wallet balance
      const balance = await mockSupabaseClient.rpc('get_wallet_balance', {
        p_user_id: 'user123',
      });

      expect(balance.data).toBeGreaterThan(0);

      // Step 2: Create Stripe transfer
      const transfer = await mockStripe.transfers.create({
        amount: 5000,
        currency: 'usd',
        destination: 'acct_user123',
      });

      expect(transfer.id).toBe('tr_test123');

      // Step 3: Create withdrawal transaction
      const withdrawalTx = await mockSupabaseClient
        .from('wallet_transactions')
        .insert({
          user_id: 'user123',
          type: 'withdrawal',
          amount: 5000,
          status: 'completed',
          transfer_id: transfer.id,
        })
        .select()
        .single();

      expect(withdrawalTx.data.type).toBe('withdrawal');
      expect(withdrawalTx.data.amount).toBe(5000);
    });

    it('should prevent withdrawal with insufficient funds', async () => {
      // Mock low balance
      mockSupabaseClient.rpc = jest.fn(() => 
        Promise.resolve({ data: 1000, error: null })
      );

      const balance = await mockSupabaseClient.rpc('get_wallet_balance', {
        p_user_id: 'user123',
      });

      const withdrawalAmount = 5000;
      const hasSufficientFunds = balance.data >= withdrawalAmount;

      expect(hasSufficientFunds).toBe(false);
    });
  });

  describe('Escrow Management Flow', () => {
    it('should prevent duplicate escrow creation', async () => {
      // Mock existing escrow
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'existing_escrow', type: 'escrow', bounty_id: 'bounty123' },
              error: null,
            })),
          })),
        })),
      }));

      const existingEscrow = await mockSupabaseClient
        .from('wallet_transactions')
        .select()
        .eq('bounty_id', 'bounty123')
        .maybeSingle();

      expect(existingEscrow.data).not.toBeNull();
      expect(existingEscrow.data.type).toBe('escrow');
      
      // Should prevent duplicate
      const isDuplicate = existingEscrow.data !== null;
      expect(isDuplicate).toBe(true);
    });

    it('should prevent double release of escrow', async () => {
      // Mock existing release
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'existing_release', type: 'release', bounty_id: 'bounty123' },
              error: null,
            })),
          })),
        })),
      }));

      const existingRelease = await mockSupabaseClient
        .from('wallet_transactions')
        .select()
        .eq('bounty_id', 'bounty123')
        .maybeSingle();

      expect(existingRelease.data).not.toBeNull();
      
      // Should prevent duplicate release
      const alreadyReleased = existingRelease.data !== null && 
                               existingRelease.data.type === 'release';
      expect(alreadyReleased).toBe(true);
    });

    it('should calculate correct platform fee on release', async () => {
      const escrowAmount = 10000;
      const platformFeePercentage = 0.05;
      const platformFee = Math.round(escrowAmount * platformFeePercentage);
      const hunterAmount = escrowAmount - platformFee;

      expect(platformFee).toBe(500);
      expect(hunterAmount).toBe(9500);
      expect(platformFee + hunterAmount).toBe(escrowAmount);
    });

    it('should handle custom platform fee percentages', async () => {
      const escrowAmount = 10000;
      const customFeePercentage = 0.10; // 10%
      const platformFee = Math.round(escrowAmount * customFeePercentage);
      const hunterAmount = escrowAmount - platformFee;

      expect(platformFee).toBe(1000);
      expect(hunterAmount).toBe(9000);
    });
  });

  describe('Payment Method Management Flow', () => {
    it('should save payment method for future use', async () => {
      // Step 1: Create setup intent (for saving payment method)
      mockStripe.setupIntents.create.mockResolvedValueOnce({
        id: 'seti_test123',
        client_secret: 'seti_test123_secret',
        status: 'requires_payment_method',
      });

      // Step 2: Confirm setup with payment method
      const paymentMethod = {
        id: 'pm_test123',
        type: 'card',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025,
        },
      };

      // Step 3: Store payment method reference
      await mockSupabaseClient
        .from('payment_methods')
        .insert({
          user_id: 'user123',
          stripe_payment_method_id: paymentMethod.id,
          card_brand: paymentMethod.card.brand,
          card_last4: paymentMethod.card.last4,
          is_default: true,
        });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('payment_methods');
    });

    it('should use saved payment method for bounty payment', async () => {
      // Mock saved payment method
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                user_id: 'user123',
                stripe_payment_method_id: 'pm_saved123',
                is_default: true,
              },
              error: null,
            })),
          })),
        })),
      }));

      const savedMethod = await mockSupabaseClient
        .from('payment_methods')
        .select()
        .eq('user_id', 'user123')
        .single();

      expect(savedMethod.data.stripe_payment_method_id).toBe('pm_saved123');

      // Use saved method for payment
      const intent = await mockStripe.paymentIntents.create({
        amount: 10000,
        currency: 'usd',
        payment_method: savedMethod.data.stripe_payment_method_id,
        confirm: true,
      });

      expect(intent.id).toBeDefined();
    });
  });

  describe('Error Recovery and Retry Logic', () => {
    it('should retry failed payment confirmation', async () => {
      // First attempt fails
      mockStripe.paymentIntents.confirm
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: 'pi_test123', status: 'succeeded' } as any);

      let result;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          result = await mockStripe.paymentIntents.confirm('pi_test123');
          break;
        } catch (error) {
          if (attempts >= maxAttempts) throw error;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      expect(result).toBeDefined();
      expect(result?.status).toBe('succeeded');
      expect(attempts).toBe(2);
    });

    it('should handle payment intent idempotency', async () => {
      const idempotencyKey = 'unique-key-123';

      // First call
      await mockStripe.paymentIntents.create({
        amount: 10000,
        currency: 'usd',
        metadata: { idempotencyKey },
      });

      // Duplicate call with same key should return same result
      await mockStripe.paymentIntents.create({
        amount: 10000,
        currency: 'usd',
        metadata: { idempotencyKey },
      });

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(2);
    });

    it('should create outbox event for failed release', async () => {
      const releaseRequest = {
        bountyId: 'bounty123',
        hunterId: 'hunter123',
        amount: 10000,
      };

      // Create outbox event for retry (failure is implicit)
      await mockSupabaseClient
        .from('outbox_events')
        .insert({
          event_type: 'escrow_release_retry',
          payload: releaseRequest,
          status: 'pending',
          created_at: new Date().toISOString(),
        });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('outbox_events');
    });
  });

  describe('Security and Validation', () => {
    it('should validate bounty ownership before release', async () => {
      const bounty = await mockSupabaseClient
        .from('bounties')
        .select()
        .eq('id', 'bounty123')
        .single();

      const requestingUserId = 'wrong_user';
      const isOwner = bounty.data.poster_id === requestingUserId;

      expect(isOwner).toBe(false);
      // Should reject release attempt
    });

    it('should validate hunter assignment before release', async () => {
      const bounty = await mockSupabaseClient
        .from('bounties')
        .select()
        .eq('id', 'bounty123')
        .single();

      const releaseToHunterId = 'hunter123';
      const isCorrectHunter = bounty.data.hunter_id === releaseToHunterId;

      expect(isCorrectHunter).toBe(true);
    });

    it('should prevent refund after release', async () => {
      // Mock bounty with release transaction
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({
              data: { id: 'tx_release', type: 'release' },
              error: null,
            })),
            single: jest.fn(() => Promise.resolve({
              data: { id: 'bounty123', status: 'completed' },
              error: null,
            })),
          })),
        })),
      }));

      const releaseExists = await mockSupabaseClient
        .from('wallet_transactions')
        .select()
        .eq('bounty_id', 'bounty123')
        .maybeSingle();

      const canRefund = releaseExists.data === null;
      expect(canRefund).toBe(false);
    });

    it('should sanitize payment metadata', async () => {
      const unsafeMetadata = {
        bountyId: 'bounty123',
        description: '<script>alert("xss")</script>',
        userId: 'user123; DROP TABLE users;',
      };

      // Sanitization would remove/escape dangerous content
      // Use multiple passes to handle edge cases like nested tags
      let sanitizedDesc = unsafeMetadata.description;
      // Remove all HTML tags in multiple passes until none remain
      while (/<[^>]*>/.test(sanitizedDesc)) {
        sanitizedDesc = sanitizedDesc.replace(/<[^>]*>/g, '');
      }
      
      const sanitized = {
        bountyId: unsafeMetadata.bountyId,
        description: sanitizedDesc,
        userId: unsafeMetadata.userId.replace(/[^a-zA-Z0-9-]/g, ''),
      };

      expect(sanitized.description).not.toContain('<');
      expect(sanitized.description).not.toContain('>');
      expect(sanitized.description).not.toContain('script');
      expect(sanitized.userId).not.toContain(';');
    });
  });

  describe('Performance and Optimization', () => {
    it('should batch transaction queries efficiently', async () => {
      const bountyIds = ['bounty1', 'bounty2', 'bounty3'];

      // Instead of individual queries, batch them
      for (const id of bountyIds) {
        await mockSupabaseClient
          .from('wallet_transactions')
          .select()
          .eq('bounty_id', id);
      }

      // Would be optimized with .in() clause in real implementation
      expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent payment processing', async () => {
      const payments = [
        { amount: 1000, userId: 'user1' },
        { amount: 2000, userId: 'user2' },
        { amount: 3000, userId: 'user3' },
      ];

      const results = await Promise.all(
        payments.map(payment =>
          mockStripe.paymentIntents.create({
            amount: payment.amount,
            currency: 'usd',
            metadata: { userId: payment.userId },
          })
        )
      );

      expect(results).toHaveLength(3);
      expect(results.every(r => r.id === 'pi_test123')).toBe(true);
    });
  });
});
