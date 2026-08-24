import { useCallback, useRef, useState } from 'react';

/**
 * Hook to prevent duplicate form submissions
 * Debounces submission and tracks loading state
 *
 * Two distinct guards, deliberately separated:
 *
 *  - `submitInProgressRef` blocks CONCURRENT submissions. This is the real
 *    duplicate-request guard and is always on.
 *
 *  - `debounceMs` blocks a submission that arrives too soon after the previous
 *    one FINISHED. It defaults to 0 (off) because the window is measured from
 *    completion, not from the start: a form whose submission fails fast
 *    locally (validation, a lockout check) would otherwise silently swallow
 *    the user's very next tap and present as a dead button. Callers that
 *    genuinely need a cooldown between completed submissions opt in.
 *
 * A blocked call resolves without touching `isSubmitting` or `error`, so it can
 * never leave the form stuck in a loading state.
 */
export function useFormSubmission<T = any>(
  onSubmit: (data?: T) => Promise<void>,
  options: {
    debounceMs?: number;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  } = {}
) {
  const { debounceMs = 0, onSuccess, onError } = options;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  /** Timestamp of the last submission that ran to COMPLETION (success or failure). */
  const lastCompletedAtRef = useRef<number>(0);
  const submitInProgressRef = useRef<boolean>(false);

  const submit = useCallback(
    async (data?: T) => {
      // Prevent concurrent submissions. This is the guard that matters: it is
      // impossible to fire a second request while the first is in flight.
      if (submitInProgressRef.current) {
        return;
      }

      // Optional cooldown after the previous submission completed.
      if (debounceMs > 0 && Date.now() - lastCompletedAtRef.current < debounceMs) {
        return;
      }

      try {
        setIsSubmitting(true);
        setError(null);
        submitInProgressRef.current = true;

        await onSubmit(data);

        if (onSuccess) {
          onSuccess();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Submission failed');
        setError(error);

        if (onError) {
          onError(error);
        }
      } finally {
        // Order matters: clear the in-progress flag and stamp the completion
        // time in `finally` so every exit path — including one that throws
        // before any await — leaves the form submittable again.
        lastCompletedAtRef.current = Date.now();
        setIsSubmitting(false);
        submitInProgressRef.current = false;
      }
    },
    [onSubmit, debounceMs, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setError(null);
    submitInProgressRef.current = false;
    // Clear the cooldown too. `reset` means "this form is submittable again";
    // leaving the last-completed stamp in place would let a `debounceMs`
    // caller swallow the very next submission after an explicit reset, which
    // is precisely the silent dead-button behaviour this hook was fixed to
    // stop producing.
    lastCompletedAtRef.current = 0;
  }, []);

  return {
    submit,
    isSubmitting,
    error,
    reset,
  };
}

/**
 * Generic request deduplication utility
 * Ensures only one request with the same key is in flight at a time
 */
class RequestDeduplicator {
  private inFlightRequests = new Map<string, Promise<any>>();

  async deduplicate<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // If request is already in flight, return the existing promise
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }

    // Start new request
    const promise = requestFn()
      .finally(() => {
        // Clean up after completion
        this.inFlightRequests.delete(key);
      });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  clear(key?: string) {
    if (key) {
      this.inFlightRequests.delete(key);
    } else {
      this.inFlightRequests.clear();
    }
  }
}

export const requestDeduplicator = new RequestDeduplicator();
