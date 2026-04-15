/* eslint-disable @typescript-eslint/no-var-requires */
// Mock supabase and stripe before loading server module
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: () => chainMock,
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test_user' } }, error: null }),
      admin: undefined,
    },
  })),
}));

// Chainable Supabase query mock — returns {data:null,error:null} from terminal calls
const chainMock: any = {
  select: () => chainMock,
  eq: () => chainMock,
  single: async () => ({ data: null, error: null }),
  maybeSingle: async () => ({ data: null, error: null }),
  update: () => chainMock,
  delete: () => chainMock,
  insert: () => chainMock,
  order: () => chainMock,
  range: () => chainMock,
  limit: () => chainMock,
  upsert: () => chainMock,
  rpc: async () => ({ data: null, error: null }),
};

jest.mock('stripe', () => jest.fn(() => ({})));

const request = require('supertest');

describe('server/index sanitizers and basic endpoints', () => {
  let serverModule: any;

  beforeAll(() => {
    // Ensure environment values are set for health endpoint
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_123';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key';

    serverModule = require('../../server/index.js');
  });

  test('sanitizeText returns empty for falsy input and trims', () => {
    const { sanitizeText } = serverModule;
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText('  hello ')).toBe('hello');
  });

  test('sanitizeNumber and variants behave as expected', () => {
    const { sanitizeNumber, sanitizeNonNegativeNumber, sanitizePositiveNumber } = serverModule;
    expect(sanitizeNumber('123.45')).toBeCloseTo(123.45);
    expect(() => sanitizeNumber('abc')).toThrow(/Invalid numeric format/);
    expect(sanitizeNonNegativeNumber('0')).toBe(0);
    expect(() => sanitizePositiveNumber('0')).toThrow(/Number must be positive/);
  });

  test('GET /health returns status and config flags', async () => {
    const { app } = serverModule;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.supabaseConfigured).toBe(true);
  });

  test('GET /debug returns ok and does not crash when server not listening', async () => {
    const { app } = serverModule;
    const res = await request(app).get('/debug');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // serverListening should be false when startServer was not called in tests
    expect(res.body.serverListening).toBe(false);
  });
});

describe('server/index — deprecated routes set X-Deprecated header', () => {
  let app: any;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_123';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key';
    // Use the already-loaded module from the first describe block so we don't
    // double-initialise the Express app.
    app = require('../../server/index.js').app;
  });

  const BEARER = 'Bearer mock_token_for_tests';

  it('POST /payments/create-payment-intent responds with X-Deprecated: true', async () => {
    const res = await request(app)
      .post('/payments/create-payment-intent')
      .set('Authorization', BEARER)
      .send({ amountCents: 1000, currency: 'usd' });
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('GET /payments/methods responds with X-Deprecated: true', async () => {
    const res = await request(app).get('/payments/methods').set('Authorization', BEARER);
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('POST /payments/methods responds with X-Deprecated: true', async () => {
    const res = await request(app)
      .post('/payments/methods')
      .set('Authorization', BEARER)
      .send({ paymentMethodId: 'pm_test_123' });
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('DELETE /payments/methods/:id responds with X-Deprecated: true', async () => {
    const res = await request(app)
      .delete('/payments/methods/pm_test_123')
      .set('Authorization', BEARER);
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('POST /payments/confirm responds with X-Deprecated: true', async () => {
    const res = await request(app)
      .post('/payments/confirm')
      .set('Authorization', BEARER)
      .send({ paymentIntentId: 'pi_test_123' });
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('GET /wallet/balance responds with X-Deprecated: true', async () => {
    const res = await request(app).get('/wallet/balance').set('Authorization', BEARER);
    expect(res.headers['x-deprecated']).toBe('true');
  });

  it('GET /wallet/transactions responds with X-Deprecated: true', async () => {
    const res = await request(app).get('/wallet/transactions').set('Authorization', BEARER);
    expect(res.headers['x-deprecated']).toBe('true');
  });
});
