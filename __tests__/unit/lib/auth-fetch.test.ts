/**
 * Regression tests for lib/utils/auth-fetch.ts — authFetchWithTimeout
 *
 * These tests verify the production bug fix described in the PR:
 *   "Add auth request timeout handling and session cleanup"
 *
 * The root cause: auth-js holds `lockAcquired` while refreshing a token.
 * With no fetch timeout, a stalled /auth/v1/token request squats the lock
 * indefinitely, causing every subsequent auth call (including signInWithPassword)
 * to queue behind it and eventually time out too.
 *
 * The fix: `authFetchWithTimeout` aborts /auth/v1/* fetches after 8 s so the
 * stalled refresh fails fast and the auth lock is released within the 15 s
 * AUTH_TIMEOUT budget.
 *
 * Tests here:
 *  - Non-auth URLs are forwarded without a timeout (no regression on other calls)
 *  - Auth URLs get an 8 s AbortController timeout
 *  - A timed-out fetch is aborted (AbortError)
 *  - The timeout is cleared if the fetch completes before the deadline
 *  - A caller-supplied AbortSignal is forwarded into the controller
 *  - An already-aborted caller signal is respected immediately
 *  - The caller signal listener is cleaned up after the fetch settles
 */

jest.useFakeTimers();

import { authFetchWithTimeout, AUTH_FETCH_TIMEOUT_MS, isAuthUrl } from '../../../lib/utils/auth-fetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a fake Response so we don't need the real fetch. */
function fakeResponse(status = 200): Response {
  return { status, ok: status < 400 } as unknown as Response;
}

// ---------------------------------------------------------------------------
// isAuthUrl
// ---------------------------------------------------------------------------

describe('isAuthUrl', () => {
  it('returns true for GoTrue /auth/v1/ URLs', () => {
    expect(isAuthUrl('https://abcdef.supabase.co/auth/v1/token')).toBe(true);
    expect(isAuthUrl('https://abcdef.supabase.co/auth/v1/user')).toBe(true);
  });

  it('returns false for non-auth URLs', () => {
    expect(isAuthUrl('https://abcdef.supabase.co/rest/v1/bounties')).toBe(false);
    expect(isAuthUrl('https://abcdef.supabase.co/storage/v1/object')).toBe(false);
    expect(isAuthUrl('/rest/v1/bounties')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(isAuthUrl(null)).toBe(false);
    expect(isAuthUrl(undefined)).toBe(false);
    expect(isAuthUrl(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// authFetchWithTimeout — non-auth URLs
// ---------------------------------------------------------------------------

describe('authFetchWithTimeout — non-auth URLs', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('passes non-auth requests straight through to global.fetch without an AbortController', async () => {
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    const url = 'https://abcdef.supabase.co/rest/v1/bounties';
    const init = { method: 'GET' };
    await authFetchWithTimeout(url, init);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The original init object is passed unchanged — no signal injected.
    expect(mockFetch).toHaveBeenCalledWith(url, init);
  });

  it('handles Request objects whose url is not an auth URL', async () => {
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    const req = { url: 'https://example.com/rest/v1/users' } as Request;
    await authFetchWithTimeout(req);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(req, {});
  });
});

// ---------------------------------------------------------------------------
// authFetchWithTimeout — auth URLs: happy path
// ---------------------------------------------------------------------------

describe('authFetchWithTimeout — auth URLs (happy path)', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('resolves when the fetch completes before the timeout', async () => {
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token', {
      method: 'POST',
    });

    // Complete before advancing timers
    const result = await promise;
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('injects a signal into the fetch init for auth URLs', async () => {
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    await authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/user');

    const callArgs = mockFetch.mock.calls[0];
    const passedInit = callArgs[1];
    expect(passedInit.signal).toBeDefined();
    expect(passedInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('clears the timeout after the fetch settles (no dangling timers)', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    await authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token');

    // clearTimeout must have been called (even though it resolves quickly)
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// authFetchWithTimeout — auth URLs: timeout path
// ---------------------------------------------------------------------------

describe('authFetchWithTimeout — auth URLs (timeout path)', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('aborts the fetch and rejects when the auth timeout fires', async () => {
    // Simulate a hanging /auth/v1/token request — never resolves on its own.
    let injectedSignal: AbortSignal | null = null;
    const mockFetch = jest.fn().mockImplementation((_input: any, init: any) => {
      injectedSignal = init?.signal ?? null;
      return new Promise<Response>((_, reject) => {
        // Reject as an AbortError when the signal fires, matching real fetch behavior.
        init?.signal?.addEventListener('abort', () => {
          const err = new DOMException('The operation was aborted.', 'AbortError');
          reject(err);
        });
      });
    });
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token');

    // Advance past the 8 s deadline.
    jest.advanceTimersByTime(AUTH_FETCH_TIMEOUT_MS + 100);
    await Promise.resolve(); // flush microtasks

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(injectedSignal?.aborted).toBe(true);
  });

  it('does NOT abort non-auth requests when the same timer fires', async () => {
    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/rest/v1/bounties');
    jest.advanceTimersByTime(AUTH_FETCH_TIMEOUT_MS + 100);

    const result = await promise;
    expect(result.status).toBe(200);

    const passedInit = mockFetch.mock.calls[0][1];
    // Non-auth calls should not have our injected signal
    expect(passedInit).not.toHaveProperty('signal');
  });
});

// ---------------------------------------------------------------------------
// authFetchWithTimeout — caller AbortSignal forwarding
// ---------------------------------------------------------------------------

describe('authFetchWithTimeout — caller AbortSignal forwarding', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('forwards an in-flight caller abort into the request', async () => {
    const callerController = new AbortController();

    let injectedSignal: AbortSignal | null = null;
    const mockFetch = jest.fn().mockImplementation((_input: any, init: any) => {
      injectedSignal = init?.signal ?? null;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token', {
      signal: callerController.signal,
    });

    // Caller aborts before our 8 s timeout fires.
    callerController.abort();
    await Promise.resolve();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(injectedSignal?.aborted).toBe(true);
  });

  it('handles an already-aborted caller signal without starting the fetch successfully', async () => {
    const callerController = new AbortController();
    callerController.abort(); // aborted before the call

    let injectedSignal: AbortSignal | null = null;
    const mockFetch = jest.fn().mockImplementation((_input: any, init: any) => {
      injectedSignal = init?.signal ?? null;
      return new Promise<Response>((_, reject) => {
        // immediately abort since signal is already set
        if (init?.signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token', {
      signal: callerController.signal,
    });

    await Promise.resolve();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(injectedSignal?.aborted).toBe(true);
  });

  it('cleans up the caller-signal listener after the fetch resolves', async () => {
    const callerController = new AbortController();
    const removeEventListenerSpy = jest.spyOn(
      callerController.signal,
      'removeEventListener'
    );

    const mockFetch = jest.fn().mockResolvedValue(fakeResponse(200));
    global.fetch = mockFetch;

    await authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token', {
      signal: callerController.signal,
    });

    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });

  it('cleans up the caller-signal listener after the fetch rejects', async () => {
    const callerController = new AbortController();
    const removeEventListenerSpy = jest.spyOn(
      callerController.signal,
      'removeEventListener'
    );

    const mockFetch = jest.fn().mockImplementation((_input: any, init: any) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    global.fetch = mockFetch;

    const promise = authFetchWithTimeout('https://abcdef.supabase.co/auth/v1/token', {
      signal: callerController.signal,
    });

    jest.advanceTimersByTime(AUTH_FETCH_TIMEOUT_MS + 100);
    await Promise.resolve();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario: queued signInWithPassword proceeds after stalled refresh aborts
// ---------------------------------------------------------------------------
//
// This is the core production regression test. It simulates:
//   1. A /auth/v1/token refresh that hangs indefinitely.
//   2. Our 8 s timeout aborts it.
//   3. A /auth/v1/token signInWithPassword request that arrives while the
//      refresh is in-flight — this should complete normally once the first
//      request is aborted (auth-js would release the lock at that point).
//
// We cannot mock the auth-js lock directly in a unit test, but we can verify
// that authFetchWithTimeout resolves a second concurrent auth request even
// while the first one is still "pending" (the wrapper itself does not block).

describe('authFetchWithTimeout — concurrent requests are independent', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('a fast auth request resolves independently of a hanging one', async () => {
    let resolveSignIn!: (r: Response) => void;

    const mockFetch = jest.fn().mockImplementation((input: any, _init: any) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url?.includes('grant_type=refresh_token')) {
        // Hanging refresh — never resolves on its own.
        return new Promise<Response>((_, reject) => {
          _init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      // signInWithPassword request — resolves immediately.
      return new Promise<Response>((resolve) => { resolveSignIn = resolve; });
    });
    global.fetch = mockFetch;

    // Start both concurrently.
    const refreshPromise = authFetchWithTimeout(
      'https://abcdef.supabase.co/auth/v1/token?grant_type=refresh_token'
    );
    const signInPromise = authFetchWithTimeout(
      'https://abcdef.supabase.co/auth/v1/token?grant_type=password'
    );

    // Resolve the signIn immediately.
    resolveSignIn(fakeResponse(200));
    const signInResult = await signInPromise;
    expect(signInResult.status).toBe(200);

    // Advance timers to trigger the refresh timeout.
    jest.advanceTimersByTime(AUTH_FETCH_TIMEOUT_MS + 100);
    await Promise.resolve();

    // The refresh should now reject with AbortError.
    await expect(refreshPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
