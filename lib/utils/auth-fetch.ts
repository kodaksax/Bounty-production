/**
 * Auth-specific fetch wrapper with a hard per-request timeout.
 *
 * Background
 * ----------
 * auth-js issues token refreshes inside `getSession()` with no fetch timeout
 * of its own, retrying with exponential backoff for up to 30 s
 * (AUTO_REFRESH_TICK_DURATION_MS). React Native's platform default (~60 s) is
 * even longer. While a refresh is in-flight auth-js holds `lockAcquired`, so
 * every other auth call queues behind it in `_acquireLock`. The production
 * failure mode was: cold start → expired session → refresh stalls → 15 s
 * AUTH_TIMEOUT fires → user sees sign-in screen → sign-in sits in queue behind
 * dead refresh → sign-in also times out.
 *
 * This wrapper breaks the cascade: the stalled refresh fails fast (8 s) and
 * releases the lock before the outer 15 s budget is exhausted.
 *
 * Design decisions
 * ----------------
 * - Only /auth/v1/* URLs are bounded. PostgREST/Storage requests keep the
 *   platform default: a hard 8 s cap would break legitimately long operations
 *   like image uploads, and those requests do not hold the auth lock.
 * - 8 s leaves room for auth-js's internal 200/400/800 ms backoff retries to
 *   finish inside our 15 s AUTH_TIMEOUT budget.
 * - A caller-supplied signal is forwarded so auth-js's own cancellations are
 *   not swallowed by our controller.
 *
 * Telemetry
 * ---------
 * Emits PostHog events for every /auth/v1/* request:
 *   AUTH_TOKEN_REQUEST_STARTED   – request begins
 *   AUTH_TOKEN_REQUEST_COMPLETED – request settled (success or HTTP error)
 *   AUTH_TOKEN_REQUEST_ABORTED   – request was cancelled by timeout or caller
 *
 * Each event includes: url_path (no query params), elapsed_ms, aborted,
 * timed_out, http_status (if available), and whether a refresh grant was used.
 */

/** Milliseconds before a GoTrue (/auth/v1/*) fetch is aborted. */
export const AUTH_FETCH_TIMEOUT_MS = 8_000;

/**
 * Returns true when `url` targets the Supabase GoTrue service.
 * Used to decide whether the per-request timeout applies.
 */
export function isAuthUrl(url: unknown): boolean {
  return typeof url === 'string' && url.includes('/auth/v1/');
}

/** Emit a structured analytics event (best-effort — never throws). */
function emitAuthFetchEvent(
  eventName: string,
  properties: Record<string, unknown>
): void {
  try {
    // Dynamic require avoids a circular dependency: posthog → supabase → auth-fetch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { capture } = require('../posthog');
    if (typeof capture === 'function') {
      capture(eventName, properties);
    }
  } catch {
    // Telemetry must never interrupt auth flow.
  }
}

/** Strip query params from a URL path so tokens/credentials are never logged. */
function safeUrlPath(url: unknown): string {
  if (typeof url !== 'string') return 'unknown';
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? 'unknown';
  }
}

/**
 * Drop-in replacement for `fetch` that adds an AbortController-backed timeout
 * to every GoTrue (/auth/v1/*) request. Non-auth requests are forwarded
 * unchanged so long-running operations like image uploads are unaffected.
 *
 * Pass this as the `global.fetch` option when calling `createClient`.
 */
export function authFetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const url = typeof input === 'string' ? input : (input as Request)?.url;

  if (!isAuthUrl(url)) {
    // Non-auth request — pass through without modification.
    return fetch(input as any, init);
  }

  const startedAt = Date.now();
  const urlPath = safeUrlPath(url);
  const isRefreshGrant =
    typeof url === 'string' && url.includes('grant_type=refresh_token');

  emitAuthFetchEvent('AUTH_TOKEN_REQUEST_STARTED', {
    url_path: urlPath,
    is_refresh_grant: isRefreshGrant,
    started_at: new Date(startedAt).toISOString(),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);

  // Forward the caller's signal into our controller so neither cancellation
  // path is lost (auth-js passes its own signal for some operations).
  const callerSignal: AbortSignal | undefined = init?.signal as AbortSignal | undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener?.('abort', onCallerAbort);
    }
  }

  return fetch(input as any, { ...init, signal: controller.signal })
    .then(
      (response) => {
        const elapsedMs = Date.now() - startedAt;
        emitAuthFetchEvent('AUTH_TOKEN_REQUEST_COMPLETED', {
          url_path: urlPath,
          is_refresh_grant: isRefreshGrant,
          elapsed_ms: elapsedMs,
          http_status: response.status,
          aborted: false,
          timed_out: false,
        });
        return response;
      },
      (err) => {
        const elapsedMs = Date.now() - startedAt;
        const isAbort =
          err?.name === 'AbortError' || err?.name === 'DOMException';
        const timedOut = isAbort && !callerSignal?.aborted;
        emitAuthFetchEvent('AUTH_TOKEN_REQUEST_ABORTED', {
          url_path: urlPath,
          is_refresh_grant: isRefreshGrant,
          elapsed_ms: elapsedMs,
          aborted: true,
          timed_out: timedOut,
          caller_aborted: callerSignal?.aborted ?? false,
          error_name: err?.name,
        });
        throw err;
      }
    )
    .finally(() => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener?.('abort', onCallerAbort);
    });
}

