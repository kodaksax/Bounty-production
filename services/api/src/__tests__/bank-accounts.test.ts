/**
 * Bank Account Management Tests
 * 
 * Tests for Stripe Connect bank account operations
 */

import { consolidatedStripeConnectService } from '../services/consolidated-stripe-connect-service';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    tokens: {
      create: jest.fn().mockResolvedValue({
        id: 'btok_test_123456',
      }),
    },
    accounts: {
      createExternalAccount: jest.fn().mockResolvedValue({
        id: 'ba_test_123456',
        object: 'bank_account',
        last4: '6789',
        bank_name: 'STRIPE TEST BANK',
        routing_number: '110000000',
        status: 'new',
        default_for_currency: false,
      }),
      listExternalAccounts: jest.fn().mockResolvedValue({
        object: 'list',
        data: [
          {
            id: 'ba_test_123456',
            object: 'bank_account',
            account_holder_name: 'John Doe',
            last4: '6789',
            bank_name: 'STRIPE TEST BANK',
            routing_number: '110000000',
            status: 'verified',
            default_for_currency: true,
          },
        ],
      }),
      deleteExternalAccount: jest.fn().mockResolvedValue({
        id: 'ba_test_123456',
        deleted: true,
      }),
      updateExternalAccount: jest.fn().mockResolvedValue({
        id: 'ba_test_123456',
        object: 'bank_account',
        account_holder_name: 'John Doe',
        last4: '6789',
        bank_name: 'STRIPE TEST BANK',
        routing_number: '110000000',
        status: 'verified',
        default_for_currency: true,
      }),
    },
  }));
});

// Mock Supabase
const mockSupabaseData = {
  stripe_connect_account_id: 'acct_test_123',
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => ({
            get data() {
              return mockSupabaseData;
            },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

describe('Bank Account Management', () => {
  const mockUserId = 'user_test_123';

  describe('addBankAccount', () => {
    it('should add a bank account successfully', async () => {
      const result = await consolidatedStripeConnectService.addBankAccount(
        mockUserId,
        'John Doe',
        '110000000',
        '000123456789',
        'checking'
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('ba_test_123456');
      expect(result.last4).toBe('6789');
      expect(result.accountType).toBe('checking');
    });

    it('should handle invalid routing number from Stripe API', async () => {
      // Mock Stripe to reject invalid routing number
      const Stripe = require('stripe');
      const mockTokens = Stripe.mock.results[0]?.value?.tokens;
      
      if (mockTokens) {
        mockTokens.create.mockRejectedValueOnce({
          type: 'StripeInvalidRequestError',
          code: 'invalid_routing_number',
          message: 'Invalid routing number',
        });
      }

      await expect(
        consolidatedStripeConnectService.addBankAccount(
          mockUserId,
          'John Doe',
          '12345', // Invalid routing number
          '000123456789',
          'checking'
        )
      ).rejects.toThrow();
    });
  });

  describe('listBankAccounts', () => {
    it('should list bank accounts successfully', async () => {
      const result = await consolidatedStripeConnectService.listBankAccounts(mockUserId);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe('ba_test_123456');
    });

    it('should return empty array if no Connect account', async () => {
      const originalAccountId = mockSupabaseData.stripe_connect_account_id;

      // Temporarily set mock data to return null account ID
      mockSupabaseData.stripe_connect_account_id = null;

      try {
        const result = await consolidatedStripeConnectService.listBankAccounts('user_no_account');
        expect(result).toEqual([]);
      } finally {
        // Restore mock data for other tests
        mockSupabaseData.stripe_connect_account_id = originalAccountId;
      }
    });
  });

  describe('removeBankAccount', () => {
    it('should remove a bank account successfully', async () => {
      const result = await consolidatedStripeConnectService.removeBankAccount(
        mockUserId,
        'ba_test_123456'
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('setDefaultBankAccount', () => {
    it('should set a bank account as default', async () => {
      const result = await consolidatedStripeConnectService.setDefaultBankAccount(
        mockUserId,
        'ba_test_123456'
      );

      expect(result).toBeDefined();
      expect(result.default).toBe(true);
      expect(result.id).toBe('ba_test_123456');
    });
  });
});
