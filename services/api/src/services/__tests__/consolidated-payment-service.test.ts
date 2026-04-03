/**
 * Tests for createStripeCustomerForNewUser in consolidated-payment-service.ts
 */

// ── Env bootstrap (must happen before any module import that reads config) ──
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockCustomersCreate = jest.fn();
const mockSupabaseUpdate = jest.fn();
const mockSupabaseFrom = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: mockCustomersCreate,
    },
  }));
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockSupabaseFrom,
    auth: { admin: { createUser: jest.fn() } },
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSupabaseMock(updateError: any = null) {
  mockSupabaseFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: updateError }),
    }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createStripeCustomerForNewUser', () => {
  let createStripeCustomerForNewUser: (
    userId: string,
    email: string
  ) => Promise<string | null>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Re-require to pick up fresh module state with cleared mocks
    createStripeCustomerForNewUser =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../services/consolidated-payment-service').createStripeCustomerForNewUser;
  });

  it('creates a Stripe customer with the correct metadata', async () => {
    const customerId = 'cus_test_123';
    mockCustomersCreate.mockResolvedValue({ id: customerId });
    buildSupabaseMock();

    const result = await createStripeCustomerForNewUser('user-1', 'test@example.com');

    expect(result).toBe(customerId);
    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        metadata: expect.objectContaining({
          user_id: 'user-1',
          created_at_signup: 'true',
        }),
      }),
      expect.objectContaining({ idempotencyKey: 'customer_signup_user-1' })
    );
  });

  it('saves the customer ID to the profile after creation', async () => {
    const customerId = 'cus_test_456';
    mockCustomersCreate.mockResolvedValue({ id: customerId });

    const mockEq = jest.fn().mockResolvedValue({ error: null });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    mockSupabaseFrom.mockReturnValue({ update: mockUpdate });

    const result = await createStripeCustomerForNewUser('user-2', 'user2@example.com');

    expect(result).toBe(customerId);
    expect(mockUpdate).toHaveBeenCalledWith({ stripe_customer_id: customerId });
    expect(mockEq).toHaveBeenCalledWith('id', 'user-2');
  });

  it('still returns the customer ID even if the profile update fails', async () => {
    const customerId = 'cus_test_789';
    mockCustomersCreate.mockResolvedValue({ id: customerId });

    const mockEq = jest.fn().mockResolvedValue({ error: { message: 'DB error' } });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    mockSupabaseFrom.mockReturnValue({ update: mockUpdate });

    const result = await createStripeCustomerForNewUser('user-3', 'user3@example.com');

    // Should still return the ID even though the DB update errored
    expect(result).toBe(customerId);
  });

  it('returns null (and does not throw) when Stripe customer creation fails', async () => {
    mockCustomersCreate.mockRejectedValue(new Error('Stripe API error'));
    buildSupabaseMock();

    const result = await createStripeCustomerForNewUser('user-4', 'user4@example.com');

    expect(result).toBeNull();
  });

  it('uses a deterministic idempotency key for deduplication', async () => {
    const customerId = 'cus_idempotent';
    mockCustomersCreate.mockResolvedValue({ id: customerId });
    buildSupabaseMock();

    // Call twice with the same userId
    await createStripeCustomerForNewUser('user-5', 'user5@example.com');
    await createStripeCustomerForNewUser('user-5', 'user5@example.com');

    // Both calls should use the same idempotency key
    const calls = mockCustomersCreate.mock.calls;
    expect(calls[0][1]).toEqual({ idempotencyKey: 'customer_signup_user-5' });
    expect(calls[1][1]).toEqual({ idempotencyKey: 'customer_signup_user-5' });
  });
});
