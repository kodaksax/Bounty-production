/**
 * Unit tests for Consolidated Payment Service
 */

export { };

const mockStripeInstance = {
  paymentIntents: {
    create: jest.fn(async () => ({ id: 'pi_test123', client_secret: 'secret' })),
    retrieve: jest.fn(async () => ({ id: 'pi_test123', status: 'succeeded', amount: 5000, currency: 'usd', metadata: { user_id: 'user123' } })),
    list: jest.fn(async () => ({ data: [] })),
    confirm: jest.fn(async () => ({ id: 'pi_test123' })),
  },
  customers: {
    create: jest.fn(async () => ({ id: 'cus_test123' })),
    retrieve: jest.fn(async () => ({ id: 'cus_test123' })),
    list: jest.fn(async () => ({ data: [] })),
  },
  paymentMethods: {
    list: jest.fn(async () => ({ data: [] })),
    attach: jest.fn(async () => ({ id: 'pm_test123' })),
    detach: jest.fn(async () => ({ id: 'pm_test123' })),
  },
  setupIntents: {
    create: jest.fn(async () => ({ id: 'seti_test123' })),
  }
};

const mockSupabaseClientInstance = {
  from: jest.fn((table: string) => {
    const qb: any = {};
    Object.assign(qb, {
      select: jest.fn(() => qb),
      eq: jest.fn(() => qb),
      single: jest.fn(() => Promise.resolve({ data: { id: 'user123', stripe_customer_id: 'cus_test123' }, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { id: 'user123', stripe_customer_id: 'cus_test123' }, error: null })),
      insert: jest.fn(() => Promise.resolve({ error: null })),
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
    });
    return qb;
  }),
};

jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_mock_key' },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-service-role-key' },
  },
}));

jest.mock('../../../services/api/src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('stripe', () => {
  const m = jest.fn(() => mockStripeInstance);
  return { __esModule: true, default: m, Stripe: m };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClientInstance),
}));

jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ExternalServiceError: class extends Error { constructor(m: any) { super(m); } },
  ValidationError: class extends Error { constructor(m: any) { super(m); } },
  handleStripeError: jest.fn(e => e),
}));

let paymentService: any;

describe('Consolidated Payment Service', () => {
  beforeAll(() => {
    paymentService = require('../../../services/api/src/services/consolidated-payment-service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    it('should create a payment intent', async () => {
      const result = await paymentService.createPaymentIntent({ userId: 'user123', amountCents: 5000 });
      expect(result.paymentIntentId).toBe('pi_test123');
    });
  });

  describe('listPaymentMethods', () => {
    it('should list payment methods', async () => {
      const result = await paymentService.listPaymentMethods('user123');
      expect(result).toEqual([]);
    });
  });
});
