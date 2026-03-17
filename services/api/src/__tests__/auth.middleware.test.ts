describe('auth middleware (supabase disabled)', () => {
  function clearAuthModuleCache() {
    // Ensure module is required fresh so module-level supabase initialization runs
    const resolved = require.resolve('../middleware/auth');
    if (require.cache[resolved]) delete require.cache[resolved];
  }

  test('authMiddleware assigns test user when supabase client is not configured', async () => {
    // Ensure Supabase env vars are not set so the module initializes with supabase = null
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    clearAuthModuleCache();
    // Require fresh module after clearing env
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { authMiddleware } = require('../middleware/auth');

    const req: any = {
      headers: {},
      log: console,
    };

    const reply: any = {
      sent: false,
      code: (status: number) => ({
        send: (body: any) => {
          reply.sent = true;
          reply.status = status;
          reply.body = body;
        },
      }),
    };

    await authMiddleware(req, reply);

    expect(req.userId).toBe('test-user-id');
    expect(req.user).toBeDefined();
    expect(req.user.email).toBe('test@example.com');
    expect(reply.sent).toBe(false);
  });

  test('adminMiddleware responds 403 when user is not admin', async () => {
    // Ensure Supabase env vars are not set so the module initializes with supabase = null
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    clearAuthModuleCache();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { adminMiddleware } = require('../middleware/auth');

    const req: any = {
      headers: {},
      log: console,
    };

    const reply: any = {
      sent: false,
      code: (status: number) => ({
        send: (body: any) => {
          reply.sent = true;
          reply.status = status;
          reply.body = body;
        },
      }),
    };

    await adminMiddleware(req, reply);

    expect(reply.sent).toBe(true);
    expect(reply.status).toBe(403);
    expect(reply.body).toHaveProperty('error', 'Forbidden');
  });

  test('optionalAuthMiddleware does not throw when supabase client is not configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    clearAuthModuleCache();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { optionalAuthMiddleware } = require('../middleware/auth');

    const req: any = {
      headers: {},
      log: console,
    };

    const reply: any = {};

    await expect(optionalAuthMiddleware(req, reply)).resolves.toBeUndefined();
  });
});
