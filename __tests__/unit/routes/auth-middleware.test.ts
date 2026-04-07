/**
 * Unit tests for auth middleware (services/api/src/middleware/auth.ts)
 *
 * The middleware initialises a module-level `supabase` client from env vars
 * at import time. To test the "no credentials" path we clear the env vars
 * and mock dependencies before importing.
 */
export {};

// ---------------------------------------------------------------------------
// Clear Supabase env vars BEFORE any import touches them
// ---------------------------------------------------------------------------
delete process.env.SUPABASE_URL;
delete process.env.EXPO_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Module-level mocks (must appear before the module under test is imported)
// ---------------------------------------------------------------------------
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => null),
}));

jest.mock('../../../services/api/src/middleware/request-context', () => ({
  addUserContext: jest.fn(),
}));

// Now import — the module will see no env vars and leave `supabase` null
import { authMiddleware } from '../../../services/api/src/middleware/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, any> = {}): any {
  return {
    headers: {},
    log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    ...overrides,
  };
}

function makeReply(): any {
  const r: any = { sent: false };
  r.code = jest.fn().mockImplementation((c: number) => { r.status = c; return r; });
  r.send = jest.fn().mockImplementation((p: any) => { r.payload = p; r.sent = true; return r; });
  return r;
}

// ---------------------------------------------------------------------------
// Suite: Supabase credentials missing → 503
// ---------------------------------------------------------------------------

describe('authMiddleware — no Supabase credentials', () => {
  it('returns 503 when Supabase is not configured', async () => {
    const request = makeRequest();
    const reply = makeReply();

    await authMiddleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.payload).toEqual({
      error: 'Authentication service unavailable',
      message: 'The authentication service is not configured. Please contact support.',
    });
    expect(request.userId).toBeUndefined();
  });

  it('does not assign a test-user-id fallback', async () => {
    const request = makeRequest();
    const reply = makeReply();

    await authMiddleware(request, reply);

    expect(request.userId).toBeUndefined();
    expect(request.user).toBeUndefined();
  });
});
