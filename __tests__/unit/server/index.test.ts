import request from 'supertest';

describe('server/index basic endpoints and HTTPS enforcement', () => {
  let app: any;

  beforeAll(() => {
    // Ensure fresh module load
    jest.resetModules();
    // Do not set NODE_ENV here; tests will toggle it per-case
    const mod = require('../../../server/index');
    app = mod.app;
  });

  it('GET /health returns stripeConfigured false when no STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body.stripeConfigured).toBe(false);
    expect(res.body.supabaseConfigured).toBe(false);
  });

  it('Enforces HTTPS in production: rejects insecure requests', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/health');
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'INSECURE_CONNECTION');
  });

  it('Allows secure requests in production and sets HSTS header', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/health').set('x-forwarded-proto', 'https');
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});
