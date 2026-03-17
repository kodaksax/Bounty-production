// Ensure required env vars for config module before importing
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test';

import { createTestAuthRequest, shouldBypassRateLimit } from '../middleware/unified-auth';

describe('unified-auth helpers', () => {
  test('createTestAuthRequest creates a mock authenticated request in non-production', () => {
    const req = createTestAuthRequest('user-123', 'tester@example.com');
    expect(req.userId).toBe('user-123');
    expect(req.user).toBeDefined();
    expect(req.user.email).toBe('tester@example.com');
  });

  test('shouldBypassRateLimit returns true for premium users', () => {
    const req: any = {
      user: {
        user_metadata: {
          is_premium: true,
        },
      },
    };

    expect(shouldBypassRateLimit(req)).toBe(true);

    const req2: any = {
      user: {
        user_metadata: {
          subscription: 'pro',
        },
      },
    };

    expect(shouldBypassRateLimit(req2)).toBe(true);

    const req3: any = { user: undefined };
    expect(shouldBypassRateLimit(req3 as any)).toBe(false);
  });
});
