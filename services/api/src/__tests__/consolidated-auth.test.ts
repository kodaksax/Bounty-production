// Ensure required env vars for config module
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test';

describe('consolidated-auth routes helpers', () => {
  test('stopRateLimitCleanup is callable and registerConsolidatedAuthRoutes registers routes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { stopRateLimitCleanup, registerConsolidatedAuthRoutes } = require('../routes/consolidated-auth');
    expect(typeof stopRateLimitCleanup).toBe('function');

    // Create a minimal mock Fastify instance
    const mockFastify: any = {
      post: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    await expect(registerConsolidatedAuthRoutes(mockFastify)).resolves.toBeUndefined();

    // Ensure the registration invoked the logger to indicate registration
    expect(mockFastify.log.info).toHaveBeenCalledWith('Consolidated authentication routes registered');

    // Clean up background interval started by startRateLimitCleanup
    stopRateLimitCleanup();
  });
});
