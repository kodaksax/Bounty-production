import fastify from 'fastify';

// Import the route registrar
import { registerPaymentRoutes } from '../src/routes/payments';

describe('payments routes (fallback and webhook)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  test('registers fallback routes when STRIPE_SECRET_KEY not set', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const app = fastify();
    await registerPaymentRoutes(app as any);

    const res = await app.inject({ method: 'POST', url: '/payments/create-payment-intent', payload: {} });
    expect(res.statusCode).toBe(501);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Stripe not configured on this server' });

    await app.close();
  });

  test('webhook endpoint returns 500 when STRIPE_WEBHOOK_SECRET not configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const app = fastify();
    await registerPaymentRoutes(app as any);

    const res = await app.inject({ method: 'POST', url: '/payments/webhook', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Webhook not configured on server' });

    await app.close();
  });
});
