/**
 * Bank Account Management Tests
 * 
 * Tests for Stripe Connect bank account operations
 */

import { consolidatedStripeConnectService } from '../services/consolidated-stripe-connect-service';

const mockTokensCreate = jest.fn().mockResolvedValue({
  id: 'btok_test_123456',
});

const mockCreateExternalAccount = jest.fn().mockResolvedValue({
  id: 'ba_test_123456',
  object: 'bank_account',
  last4: '6789',
  bank_name: 'STRIPE TEST BANK',
  routing_number: '110000000',
  status: 'new',
  default_for_currency: false,
});

const mockListExternalAccounts = jest.fn().mockResolvedValue({
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
});

const mockDeleteExternalAccount = jest.fn();

const mockUpdateExternalAccount = jest.fn();

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    tokens: {
      create: mockTokensCreate,
    },
    accounts: {
      createExternalAccount: mockCreateExternalAccount,
      listExternalAccounts: mockListExternalAccounts,
      deleteExternalAccount: mockDeleteExternalAccount,
      updateExternalAccount: mockUpdateExternalAccount,
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

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
      mockTokensCreate.mockRejectedValueOnce({
        type: 'StripeInvalidRequestError',
        code: 'invalid_routing_number',
        message: 'Invalid routing number',
      });

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
    it('rejects with payout dashboard guidance instead of attempting a forbidden Stripe delete', async () => {
      await expect(
        consolidatedStripeConnectService.removeBankAccount(
          mockUserId,
          'ba_test_123456'
        )
      ).rejects.toMatchObject({
        message: expect.stringMatching(/no longer supported/i),
        details: expect.objectContaining({
          code: 'bank_account_remove_deprecated',
          migrateTo: '/functions/v1/connect/login-link',
          bankAccountId: 'ba_test_123456',
        }),
      });

      expect(mockDeleteExternalAccount).not.toHaveBeenCalled();
    });
  });

  describe('setDefaultBankAccount', () => {
    it('rejects with payout dashboard guidance instead of attempting a forbidden Stripe update', async () => {
      await expect(
        consolidatedStripeConnectService.setDefaultBankAccount(
          mockUserId,
          'ba_test_123456'
        )
      ).rejects.toMatchObject({
        message: expect.stringMatching(/no longer supported/i),
        details: expect.objectContaining({
          code: 'bank_account_default_deprecated',
          migrateTo: '/functions/v1/connect/login-link',
          bankAccountId: 'ba_test_123456',
        }),
      });

      expect(mockUpdateExternalAccount).not.toHaveBeenCalled();
    });
  });
});
