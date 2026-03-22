import { useCallback, useEffect, useState } from 'react';
import { cachedDataService, type CacheOptions } from '../lib/services/cached-data-service';
import { logger } from '../lib/utils/error-logger';

// Consider data stale on foreground if older than this (ms)
const FOREGROUND_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface UseCachedDataResult<T> {
  data: T | null;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  setData: (data: T) => void;
  isStale: boolean;
  isOffline: boolean;
}

/**
 * Hook to fetch data with automatic caching and offline support
 */
export function useCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: CacheOptions & { enabled?: boolean } = {}
): UseCachedDataResult<T> {
  const { enabled = true, ...cacheOptions } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isOffline, setIsOffline] = useState(!cachedDataService.getOnlineStatus());

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsOffline(!cachedDataService.getOnlineStatus());

      const result = await cachedDataService.fetchWithCache(
        key,
        fetchFn,
        { ...cacheOptions, forceRefresh }
      );

      setData(result);
      setIsStale(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch data');
      setError(error);
      logger.error('useCachedData error', { key, error });
    } finally {
      setIsLoading(false);
    }
  }, [key, fetchFn, enabled, JSON.stringify(cacheOptions)]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to background revalidation events
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = cachedDataService.onRevalidated(key, (newData) => {
      setData(newData);
      setIsValidating(false);
    });

    // Also listen for background revalidation errors so we can surface them
    const unsubscribeError = cachedDataService.onRevalidationError
      ? cachedDataService.onRevalidationError(key, (err: any) => {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsValidating(false);
        })
      : () => {};


    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [key, enabled]);

  // Subscribe to app foreground events to detect stale cache and trigger revalidation
  useEffect(() => {
    if (!enabled) return;

    if (typeof (cachedDataService as any).onForeground !== 'function') {
      // Not available (e.g., in some test mocks); skip gracefully
      return;
    }

    const unsubscribeForeground = (cachedDataService as any).onForeground(async (eventKey: string, meta: any) => {
      try {
        if (eventKey !== key) return;

        if (!meta || typeof meta.age !== 'number') return;

        // Mark stale if age exceeds threshold
        if (meta.age > FOREGROUND_STALE_THRESHOLD_MS) {
          setIsStale(true);

          // If we're online, automatically revalidate
          const online = cachedDataService.getOnlineStatus();
          if (online) {
            setIsValidating(true);
            await fetchData(true);
            setIsStale(false);
          }
        }
      } catch (err) {
        logger.error('Error handling foreground revalidation', { key, error: err });
      }
    });

    return () => {
      unsubscribeForeground();
    };
  }, [key, enabled, fetchData]);

  // Check online status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const online = cachedDataService.getOnlineStatus();
      setIsOffline(!online);
    }, 5000);

    // Register interval for test cleanup
    if (process.env.NODE_ENV === 'test') {
      const _i = interval as any
      if (typeof _i?.unref === 'function') {
        try { _i.unref(); } catch { /* ignore */ }
      }
      ;(globalThis as any).__BACKGROUND_INTERVALS = (globalThis as any).__BACKGROUND_INTERVALS || []
      ;(globalThis as any).__BACKGROUND_INTERVALS.push(interval)
    }

    return () => clearInterval(interval);
  }, []);

  const refetch = useCallback(() => {
    setIsValidating(true);
    return fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    isValidating,
    error,
    refetch,
    setData,
    isStale,
    isOffline,
  };
}
