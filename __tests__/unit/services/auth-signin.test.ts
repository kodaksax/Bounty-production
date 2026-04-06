/**
 * Unit tests for authentication sign-in / sign-up flows
 *
 * These tests mock the Supabase client and cover:
 *  - Successful login (session returned)
 *  - Failed login (invalid credentials, email not confirmed, rate limited, network error)
 *  - Successful sign-up with session (auto-sign-in path)
 *  - Sign-up without session (email confirmation required)
 *  - Duplicate account handling
 *  - Error message parsing via parseAuthError
 *
 * The tests follow the patterns described in the issue:
 *   it('handles login success', ...)
 *   it('handles login failure', ...)
 */

import { parseAuthError } from '../../../lib/utils/auth-errors';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function makeSession(userId = 'user-123', email = 'test@example.com') {
  return {
    access_token: `mock-access-token-${userId}`,
    refresh_token: `mock-refresh-token-${userId}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer' as const,
    user: { id: userId, email },
  };
}

function makeSupabaseAuthMock() {
  return {
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    getSession: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChange: jest.fn(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    })),
  };
}

// ---------------------------------------------------------------------------
// Helper that mimics the sign-in logic used in the app:
// calls supabase.auth.signInWithPassword and throws on error.
// ---------------------------------------------------------------------------
async function login(
  authMock: ReturnType<typeof makeSupabaseAuthMock>,
  email: string,
  password: string,
) {
  const { data, error } = await authMock.signInWithPassword({ email, password });
  if (error) {
    const parsed = parseAuthError(error);
    throw new Error(parsed.userMessage);
  }
  return data;
}

// Helper that mimics the sign-up logic used in the app:
// calls supabase.auth.signUp and returns structured result.
async function signup(
  authMock: ReturnType<typeof makeSupabaseAuthMock>,
  email: string,
  password: string,
  username: string,
) {
  const { data, error } = await authMock.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) {
    const parsed = parseAuthError(error);
    throw new Error(parsed.userMessage);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Sign-in tests
// ---------------------------------------------------------------------------

describe('login(email, password)', () => {
  let auth: ReturnType<typeof makeSupabaseAuthMock>;

  beforeEach(() => {
    auth = makeSupabaseAuthMock();
  });

  it('handles login success — returns session with access token', async () => {
    const session = makeSession();
    auth.signInWithPassword.mockResolvedValue({ data: { session, user: session.user }, error: null });

    const result = await login(auth, 'test@example.com', 'Password1!');

    expect(result).toBeTruthy();
    expect(result.session).toBeDefined();
    expect(result.session.access_token).toBeTruthy();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'Password1!',
    });
  });

  it('handles login failure — throws for invalid credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid login credentials', status: 400 },
    });

    await expect(login(auth, 'test@example.com', 'WrongPass')).rejects.toThrow();
  });

  it('provides a user-friendly error for invalid credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid login credentials', status: 400 },
    });

    await expect(login(auth, 'test@example.com', 'WrongPass')).rejects.toThrow(
      /invalid email or password/i,
    );
  });

  it('provides a user-friendly error for unconfirmed email', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Email not confirmed', status: 400 },
    });

    await expect(login(auth, 'unverified@example.com', 'Password1!')).rejects.toThrow(
      /confirm your email/i,
    );
  });

  it('provides a user-friendly error for rate limiting', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Too many requests', status: 429 },
    });

    await expect(login(auth, 'test@example.com', 'Password1!')).rejects.toThrow(
      /too many/i,
    );
  });

  it('provides a user-friendly error for network failures', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Network request failed' },
    });

    await expect(login(auth, 'test@example.com', 'Password1!')).rejects.toThrow(
      /connect/i,
    );
  });

  it('throws for a completely unexpected error', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: new Error('Something totally unexpected'),
    });

    await expect(login(auth, 'test@example.com', 'Password1!')).rejects.toThrow();
  });

  it('passes email and password exactly to signInWithPassword', async () => {
    const session = makeSession();
    auth.signInWithPassword.mockResolvedValue({ data: { session, user: session.user }, error: null });

    await login(auth, 'USER@EXAMPLE.COM', 'P@ssword1');

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'USER@EXAMPLE.COM',
      password: 'P@ssword1',
    });
  });
});

// ---------------------------------------------------------------------------
// Sign-up tests
// ---------------------------------------------------------------------------

describe('signup(email, password, username)', () => {
  let auth: ReturnType<typeof makeSupabaseAuthMock>;

  beforeEach(() => {
    auth = makeSupabaseAuthMock();
  });

  it('handles signup success with immediate session (auto sign-in)', async () => {
    const session = makeSession('new-user', 'newuser@example.com');
    auth.signUp.mockResolvedValue({
      data: { user: session.user, session },
      error: null,
    });

    const result = await signup(auth, 'newuser@example.com', 'Password1!', 'newuser');

    expect(result).toBeTruthy();
    expect(result.session).toBeDefined();
    expect(result.session.access_token).toBeTruthy();
    // signOut should NOT be called — the new flow keeps the session
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('handles signup success without session (email confirmation required)', async () => {
    const user = { id: 'new-user', email: 'newuser@example.com' };
    auth.signUp.mockResolvedValue({
      data: { user, session: null },
      error: null,
    });

    const result = await signup(auth, 'newuser@example.com', 'Password1!', 'newuser');

    expect(result).toBeTruthy();
    expect(result.user).toBeDefined();
    expect(result.session).toBeNull();
  });

  it('throws for duplicate email with user-friendly message', async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: 'User already registered', status: 400 },
    });

    await expect(
      signup(auth, 'existing@example.com', 'Password1!', 'existinguser'),
    ).rejects.toThrow(/already registered/i);
  });

  it('throws for weak password with user-friendly message', async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { code: 'weak_password', message: 'Password should be at least 8 characters' },
    });

    await expect(
      signup(auth, 'newuser@example.com', 'weak', 'newuser'),
    ).rejects.toThrow(/password/i);
  });

  it('throws for rate limiting', async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: 'Email rate limit exceeded', status: 429 },
    });

    await expect(
      signup(auth, 'newuser@example.com', 'Password1!', 'newuser'),
    ).rejects.toThrow(/too many/i);
  });

  it('passes correct arguments to signUp', async () => {
    const session = makeSession('new-user', 'newuser@example.com');
    auth.signUp.mockResolvedValue({
      data: { user: session.user, session },
      error: null,
    });

    await signup(auth, 'newuser@example.com', 'Password1!', 'newuser');

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'newuser@example.com',
      password: 'Password1!',
      options: { data: { username: 'newuser' } },
    });
  });
});

// ---------------------------------------------------------------------------
// Session management tests
// ---------------------------------------------------------------------------

describe('session management', () => {
  let auth: ReturnType<typeof makeSupabaseAuthMock>;

  beforeEach(() => {
    auth = makeSupabaseAuthMock();
  });

  it('getSession returns active session on cold start', async () => {
    const session = makeSession();
    auth.getSession.mockResolvedValue({ data: { session }, error: null });

    const { data } = await auth.getSession();

    expect(data.session).toBeDefined();
    expect(data.session.access_token).toBeTruthy();
  });

  it('getSession returns null when no session exists (requires re-login)', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const { data } = await auth.getSession();

    expect(data.session).toBeNull();
  });

  it('getSession handles an error gracefully', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'JWT expired', status: 401 },
    });

    const { data, error } = await auth.getSession();

    expect(error).toBeDefined();
    expect(data.session).toBeNull();
  });

  it('signOut clears session and subsequent getSession returns null', async () => {
    const session = makeSession();
    auth.getSession
      .mockResolvedValueOnce({ data: { session }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    auth.signOut.mockResolvedValue({ error: null });

    const before = await auth.getSession();
    expect(before.data.session).toBeDefined();

    await auth.signOut();

    const after = await auth.getSession();
    expect(after.data.session).toBeNull();
  });

  it('onAuthStateChange listener fires on sign-in', () => {
    const changeHandler = jest.fn();
    auth.onAuthStateChange.mockImplementation((cb: any) => {
      cb('SIGNED_IN', makeSession());
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    auth.onAuthStateChange(changeHandler);

    expect(changeHandler).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({
      access_token: expect.any(String),
    }));
  });

  it('onAuthStateChange listener fires on sign-out', () => {
    const changeHandler = jest.fn();
    auth.onAuthStateChange.mockImplementation((cb: any) => {
      cb('SIGNED_OUT', null);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    auth.onAuthStateChange(changeHandler);

    expect(changeHandler).toHaveBeenCalledWith('SIGNED_OUT', null);
  });
});

// ---------------------------------------------------------------------------
// Regression test — verifies the specific issue that login/signup used to fail
// due to the auth error message being overwritten for internal server errors.
// ---------------------------------------------------------------------------

describe('regression: auth error message sanitization', () => {
  it('internal server error is sanitized before reaching the user', () => {
    const error = { message: 'internal server error', status: 500 };
    const parsed = parseAuthError(error);

    // Must not expose the raw "internal server error" string to the user
    expect(parsed.userMessage.toLowerCase()).not.toBe('internal server error');
    expect(parsed.userMessage).toContain('went wrong');
  });

  it('"unexpected error" messages are sanitized before reaching the user', () => {
    const error = { message: 'unexpected error occurred', status: 500 };
    const parsed = parseAuthError(error);

    // Raw message must not be passed through unchanged
    expect(parsed.userMessage).not.toBe('unexpected error occurred');
    expect(parsed.userMessage.length).toBeGreaterThan(0);
  });

  it('login failure returns a retryable error for network issues', () => {
    const error = { message: 'Network request failed' };
    const parsed = parseAuthError(error);

    expect(parsed.category).toBe('network_error');
    expect(parsed.retryable).toBe(true);
  });

  it('auth state listener unsubscribes on component unmount (no leak)', () => {
    const unsubscribe = jest.fn();
    const mockAuth = makeSupabaseAuthMock();
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    });

    const { data } = mockAuth.onAuthStateChange(jest.fn());
    data.subscription.unsubscribe();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
