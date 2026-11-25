/**
 * True once a job has been in the paying stage (approved, the job row not yet
 * read back finished) for PAYING_SLOW_AFTER_MS. The stage copy then says
 * "We're confirming the payment" instead of "Paying Ana…", never an error.
 *
 * The clock starts the first time `paying` is seen for `jobKey` and only
 * resets when the job leaves the paying stage or a different job is shown.
 * Refreshes (the rating sheet opening or closing reloads the page) keep
 * `paying` true, so they can't restart it.
 */
import { useEffect, useRef, useState } from 'react';
import { PAYING_SLOW_AFTER_MS } from '../lib/utils/stage-progress';

export function usePayingSlow(paying: boolean, jobKey: string | null): boolean {
  const startedRef = useRef<{ key: string; at: number } | null>(null);
  const [slowFor, setSlowFor] = useState<string | null>(null);

  if (!paying || !jobKey) {
    startedRef.current = null;
  } else if (!startedRef.current || startedRef.current.key !== jobKey) {
    startedRef.current = { key: jobKey, at: Date.now() };
  }

  const startedAt = startedRef.current?.at ?? null;
  useEffect(() => {
    if (!paying || !jobKey || startedAt === null) {
      setSlowFor(null);
      return;
    }
    const left = PAYING_SLOW_AFTER_MS - (Date.now() - startedAt);
    if (left <= 0) {
      setSlowFor(jobKey);
      return;
    }
    const t = setTimeout(() => setSlowFor(jobKey), left);
    return () => clearTimeout(t);
  }, [paying, jobKey, startedAt]);

  return paying && !!jobKey && slowFor === jobKey;
}
