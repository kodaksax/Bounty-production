import { useCallback, useEffect, useState } from 'react';
import { cachedDataService, type CacheOptions } from '../lib/services/cached-data-service';
import { logger } from '../lib/utils/error-logger';

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

    return unsubscribe;
  }, [key, enabled]);

  // Check online status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const online = cachedDataService.getOnlineStatus();
      setIsOffline(!online);
    }, 5000);

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
