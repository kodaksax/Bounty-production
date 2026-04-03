const request = require('supertest');

describe('server/index.js', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  test('GET /health returns ok when not in production', async () => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test';

    const server = require('../../server/index.js');
    const app = server.app;

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('stripeConfigured', true);
    expect(res.body).toHaveProperty('supabaseConfigured', true);
  });

  test('HTTPS enforcement rejects HTTP in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test';

    const server = require('../../server/index.js');
    const app = server.app;

    const res = await request(app).get('/health');
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'HTTPS required');
    expect(res.body).toHaveProperty('code', 'INSECURE_CONNECTION');
  });
});
