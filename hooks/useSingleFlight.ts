import { useCallback, useRef } from 'react';
import { createSingleFlight, type SingleFlight } from '../lib/interaction/single-flight';

/**
 * A component-scoped single-flight lock (see lib/interaction/single-flight.ts).
 *
 * Use it when several handlers must share one lock, e.g. a sheet's three
 * payment buttons: `const pay = useSingleFlight(); pay.run(() => ...)`.
 *
 * The lock lives and dies with the component instance, so a screen that
 * unmounts mid-action can never leave a stale lock behind for its next mount.
 */
export function useSingleFlight(): SingleFlight {
  const ref = useRef<SingleFlight | null>(null);
  if (!ref.current) ref.current = createSingleFlight();
  return ref.current;
}

/**
 * Wrap one async handler so a double tap runs it once.
 *
 *   const handleSubmit = useSingleFlightCallback(async () => { ... });
 *
 * The returned function has a stable identity and always calls the latest
 * `fn`, so it reads current props/state and is safe to pass to memoised rows.
 * While a run is in flight, further calls join it (receive its promise); once
 * it settles, success or failure, the next call runs normally.
 */
export function useSingleFlightCallback<A extends unknown[], R>(
  fn: (...args: A) => Promise<R> | R
): (...args: A) => Promise<R> {
  const flight = useSingleFlight();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args: A) => flight.run(() => fnRef.current(...args)), [flight]);
}
