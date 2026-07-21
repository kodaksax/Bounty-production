// Helper to race a promise against a timeout.
// Ensures the timer is cleaned up when the provided promise settles.
// Note: This does not cancel the underlying operation; it only rejects the promise after the timeout.
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Network request timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Runs `factory()` under `withTimeout`, retrying with exponential backoff when
 * an attempt times out (or another retryable error occurs). Designed for the
 * cold-start stall where the first Supabase request after a `--clear` bundle
 * rebuild hangs behind the auth lock / saturated JS thread and times out, but a
 * second attempt a moment later succeeds.
 *
 * `factory` MUST return a fresh promise on each call so every attempt issues a
 * new request rather than re-awaiting the same rejected one.
 */
export async function withTimeoutRetry<T>(
  factory: () => Promise<T>,
  ms: number,
  opts?: {
    retries?: number;
    backoffMs?: number;
    shouldRetry?: (error: unknown) => boolean;
    onRetry?: (attempt: number, error: unknown) => void;
  }
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const backoffMs = opts?.backoffMs ?? 800;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(factory(), ms);
    } catch (error) {
      lastError = error;
      const retryable = opts?.shouldRetry ? opts.shouldRetry(error) : true;
      if (attempt === retries || !retryable) break;
      opts?.onRetry?.(attempt + 1, error);
      // Exponential backoff: backoffMs, 2x, 4x, ...
      await new Promise(resolve => setTimeout(resolve, backoffMs * 2 ** attempt));
    }
  }

  throw lastError;
}

export default withTimeout
