import { useState, useCallback, useRef, useEffect } from 'react';
import { getUserFriendlyError, type UserFriendlyError } from '../lib/utils/error-messages';
import { useHapticFeedback } from '../lib/haptic-feedback';

export interface AsyncOperationState<T> {
  data: T | null;
  isLoading: boolean;
  error: UserFriendlyError | null;
  isSuccess: boolean;
  isError: boolean;
}

export interface AsyncOperationOptions {
  /** Show success haptic feedback on completion */
  successHaptic?: boolean;
  /** Show error haptic feedback on failure */
  errorHaptic?: boolean;
  /** Number of retry attempts (default: 0) */
  retryAttempts?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Callback on success */
  onSuccess?: <T>(data: T) => void;
  /** Callback on error */
  onError?: (error: UserFriendlyError) => void;
}

/**
 * Hook for managing async operations with proper loading, error, and retry handling.
 * Provides user-friendly error messages and haptic feedback.
 * 
 * @example
 * ```tsx
 * const { execute, state, retry, reset } = useAsyncOperation<User[]>();
 * 
 * // Execute async operation
 * await execute(fetchUsers);
 * 
 * // Retry on failure
 * if (state.isError && state.error?.retryable) {
 *   await retry();
 * }
 * 
 * // In render
 * {state.isLoading && <Skeleton />}
 * {state.error && <ErrorBanner error={state.error} onAction={retry} />}
 * {state.isSuccess && <UserList users={state.data} />}
 * ```
 */
export function useAsyncOperation<T = any>(options: AsyncOperationOptions = {}) {
  const {
    successHaptic = true,
    errorHaptic = true,
    retryAttempts = 0,
    retryDelay = 1000,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<AsyncOperationState<T>>({
    data: null,
    isLoading: false,
    error: null,
    isSuccess: false,
    isError: false,
  });

  const { triggerHaptic } = useHapticFeedback();
  const lastOperationRef = useRef<(() => Promise<T>) | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Clean up mounted ref on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Track component mount state
  const setStateIfMounted = useCallback((newState: Partial<AsyncOperationState<T>>) => {
    if (mountedRef.current) {
      setState(prev => ({ ...prev, ...newState }));
    }
  }, []);

  const execute = useCallback(async (
    operation: () => Promise<T>,
    internalRetry = false
  ): Promise<T | null> => {
    // Store operation for potential retry
    if (!internalRetry) {
      lastOperationRef.current = operation;
      retryCountRef.current = 0;
    }

    setStateIfMounted({
      isLoading: true,
      error: null,
      isSuccess: false,
      isError: false,
    });

    try {
      const result = await operation();
      
      setStateIfMounted({
        data: result,
        isLoading: false,
        isSuccess: true,
        isError: false,
        error: null,
      });

      if (successHaptic) {
        triggerHaptic('success');
      }

      onSuccess?.(result);
      return result;
    } catch (err) {
      const friendlyError = getUserFriendlyError(err);

      // Handle retry logic
      if (friendlyError.retryable && retryCountRef.current < retryAttempts) {
        retryCountRef.current++;
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Retry the operation
        return execute(operation, true);
      }

      setStateIfMounted({
        isLoading: false,
        error: friendlyError,
        isSuccess: false,
        isError: true,
      });

      if (errorHaptic) {
        triggerHaptic('error');
      }

      onError?.(friendlyError);
      return null;
    }
  }, [successHaptic, errorHaptic, retryAttempts, retryDelay, triggerHaptic, onSuccess, onError, setStateIfMounted]);

  const retry = useCallback(async (): Promise<T | null> => {
    if (!lastOperationRef.current) {
      console.warn('No operation to retry');
      return null;
    }
    
    retryCountRef.current = 0;
    return execute(lastOperationRef.current);
  }, [execute]);

  const reset = useCallback(() => {
    setState({
      data: null,
      isLoading: false,
      error: null,
      isSuccess: false,
      isError: false,
    });
    lastOperationRef.current = null;
    retryCountRef.current = 0;
  }, []);

  return {
    execute,
    state,
    retry,
    reset,
    isLoading: state.isLoading,
    isError: state.isError,
    isSuccess: state.isSuccess,
    error: state.error,
    data: state.data,
  };
}

/**
 * Simple hook for tracking multiple async operations
 * Useful for screens that load multiple data sources
 */
export function useMultipleAsyncOperations() {
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, UserFriendlyError | null>>({});

  const setLoading = useCallback((key: string, loading: boolean) => {
    setLoadingMap(prev => ({ ...prev, [key]: loading }));
  }, []);

  const setError = useCallback((key: string, error: UserFriendlyError | null) => {
    setErrorMap(prev => ({ ...prev, [key]: error }));
  }, []);

  const isAnyLoading = Object.values(loadingMap).some(Boolean);
  const hasAnyError = Object.values(errorMap).some(Boolean);
  const errors = Object.entries(errorMap)
    .filter(([_, error]) => error !== null)
    .map(([key, error]) => ({ key, error: error! }));

  return {
    setLoading,
    setError,
    isLoading: isAnyLoading,
    hasError: hasAnyError,
    errors,
    getLoading: (key: string) => loadingMap[key] ?? false,
    getError: (key: string) => errorMap[key] ?? null,
  };
}
