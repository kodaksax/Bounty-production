import { useCallback, useRef, useState } from 'react';

/**
 * Hook to prevent duplicate form submissions
 * Debounces submission and tracks loading state
 */
export function useFormSubmission<T = any>(
  onSubmit: (data?: T) => Promise<void>,
  options: {
    debounceMs?: number;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  } = {}
) {
  const { debounceMs = 1000, onSuccess, onError } = options;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastSubmitTimeRef = useRef<number>(0);
  const submitInProgressRef = useRef<boolean>(false);

  const submit = useCallback(
    async (data?: T) => {
      const now = Date.now();

      // Prevent duplicate submissions within debounce window
      if (now - lastSubmitTimeRef.current < debounceMs) {
        console.log('Submission debounced - too soon');
        return;
      }

      // Prevent concurrent submissions
      if (submitInProgressRef.current) {
        console.log('Submission already in progress');
        return;
      }

      try {
        setIsSubmitting(true);
        setError(null);
        submitInProgressRef.current = true;
        lastSubmitTimeRef.current = now;

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
