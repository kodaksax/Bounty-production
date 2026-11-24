/**
 * One in-flight run at a time, locked synchronously.
 *
 * Why not React state: a `setBusy(true)` + `disabled={busy}` pair does not stop
 * a fast double tap. Both touch events can be dispatched before React commits
 * the re-render that disables the button, and the second handler still reads
 * the `busy` value from the render the first tap happened in. A ref (here, a
 * closure variable) is set before the handler's first `await`, so the second
 * tap sees it.
 *
 * A call made while one is in flight does NOT start a second run: it receives
 * the in-flight promise instead ("joins" it). Callers that wrap their own busy
 * UI around the call (`setBusy(true); try { await run(...) } finally {
 * setBusy(false) }`) therefore stay in step with the real work, rather than a
 * dropped call's `finally` clearing the spinner while the first run is still
 * going.
 *
 * The lock is released in `finally`, so a failure (thrown or rejected) always
 * leaves the action retryable.
 *
 * Every function run through one instance should resolve to the same type: a
 * joined caller receives the in-flight run's result.
 */
export interface SingleFlight {
  run<T>(fn: () => Promise<T> | T): Promise<T>;
  /** True while a run is in flight. Synchronous; safe to read in a handler. */
  readonly busy: boolean;
}

export function createSingleFlight(): SingleFlight {
  let inFlight: Promise<unknown> | null = null;

  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      if (inFlight) return inFlight as Promise<T>;
      let promise: Promise<T>;
      try {
        promise = Promise.resolve(fn());
      } catch (err) {
        // A synchronous throw must not leave the lock held.
        return Promise.reject(err);
      }
      const tracked = promise.finally(() => {
        if (inFlight === tracked) inFlight = null;
      });
      inFlight = tracked;
      return tracked;
    },
    get busy() {
      return inFlight !== null;
    },
  };
}

/**
 * Keyed variant: one in-flight run per key, different keys run concurrently.
 * For module-level services where several callers act on the same resource
 * (e.g. approving one bounty's submission from two screens).
 */
export function createKeyedSingleFlight() {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T>;
      let promise: Promise<T>;
      try {
        promise = Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
      const tracked = promise.finally(() => {
        if (inFlight.get(key) === tracked) inFlight.delete(key);
      });
      inFlight.set(key, tracked);
      return tracked;
    },
    isBusy(key: string) {
      return inFlight.has(key);
    },
  };
}
