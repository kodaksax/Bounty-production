/* eslint-disable @typescript-eslint/no-var-requires */
// Mock supabase and stripe before loading server module
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: () => ({
      select: () => ({ single: async () => ({ data: null, error: null }) })
    }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test_user' } }, error: null }) }
  }))
}));

jest.mock('stripe', () => jest.fn(() => ({})));

const request = require('supertest');

describe('server/index sanitizers and basic endpoints', () => {
  let serverModule: any;

  beforeAll(() => {
    // Ensure environment values are set for health endpoint
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_123';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key';

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
