// hooks/useAdminList.ts - Shared paginated/filtered list state for admin screens
//
// Replaces the copy-pasted body that useAdminBounties / useAdminUsers /
// useAdminTransactions each carried. Those all stored the caller's filters in
// a ref and built their fetcher with `useCallback(..., [])`, so the effect that
// ran the fetch never re-ran when the filters changed: every filter chip and
// every search box updated its own highlight but the list underneath kept
// showing the previous query's rows until something else forced a refetch.
// Filters are part of the fetch key here, so changing one refetches.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ADMIN_PAGE_SIZE, type AdminPage } from '../lib/types-admin';

export interface UseAdminListResult<T> {
  items: T[];
  /** Server-side count for the current filter set, not `items.length`. */
  total: number;
  isLoading: boolean;
  /** True only while a "load more" page is in flight, so the list is not blanked. */
  isLoadingMore: boolean;
  /** True while a pull-to-refresh is in flight. */
  isRefreshing: boolean;
  error: string | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Apply a locally-known change without a round trip (used after mutations). */
  patchItem: (id: string, patch: Partial<T>) => void;
  /** Drop a row locally (used after a delete-style mutation). */
  removeItem: (id: string) => void;
}

interface Options<T, F> {
  filters: F;
  fetcher: (filters: F & { page: number; pageSize: number }) => Promise<AdminPage<T>>;
  getId: (item: T) => string;
  pageSize?: number;
  /** Milliseconds to wait before refetching after a filter change. */
  debounceMs?: number;
  enabled?: boolean;
}

export function useAdminList<T, F extends object>({
  filters,
  fetcher,
  getId,
  pageSize = ADMIN_PAGE_SIZE,
  debounceMs = 0,
  enabled = true,
}: Options<T, F>): UseAdminListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serializing the filters gives the effect below a stable primitive
  // dependency, so a caller passing an inline object literal (which every one
  // of these screens does) does not retrigger the fetch on every render.
  const filterKey = useMemo(() => JSON.stringify(filters ?? {}), [filters]);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Guards against a slow first request resolving after a newer one and
  // overwriting the fresher rows.
  const requestSeq = useRef(0);

  const run = useCallback(
    async (targetPage: number, mode: 'replace' | 'append' | 'refresh') => {
      if (!enabled) return;
      const seq = ++requestSeq.current;

      if (mode === 'append') setIsLoadingMore(true);
      else if (mode === 'refresh') setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const result = await fetcherRef.current({
          ...(filtersRef.current as F),
          page: targetPage,
          pageSize,
        });
        if (seq !== requestSeq.current) return; // superseded

        setItems((prev) => (mode === 'append' ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
        setHasMore(result.hasMore);
        setPage(targetPage);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
        // A failed "load more" must not wipe the rows already on screen.
        if (mode !== 'append') {
          setItems([]);
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        if (seq === requestSeq.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
          setIsRefreshing(false);
        }
      }
    },
    [enabled, pageSize]
  );

  // Refetch page 0 whenever the filters change. Debounced so a search box does
  // not fire a request per keystroke.
  useEffect(() => {
    if (!enabled) return;
    if (debounceMs <= 0) {
      void run(0, 'replace');
      return;
    }
    const timer = setTimeout(() => void run(0, 'replace'), debounceMs);
    return () => clearTimeout(timer);
    // filterKey is the serialized form of `filters`; `run` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, run, debounceMs, enabled]);

  const refetch = useCallback(async () => {
    await run(0, 'refresh');
  }, [run]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore || isRefreshing) return;
    await run(page + 1, 'append');
  }, [hasMore, isLoading, isLoadingMore, isRefreshing, page, run]);

  const patchItem = useCallback(
    (id: string, patch: Partial<T>) => {
      setItems((prev) => prev.map((item) => (getId(item) === id ? { ...item, ...patch } : item)));
    },
    [getId]
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((item) => getId(item) !== id));
      setTotal((t) => Math.max(0, t - 1));
    },
    [getId]
  );

  return {
    items,
    total,
    isLoading,
    isLoadingMore,
    isRefreshing,
    error,
    hasMore,
    refetch,
    loadMore,
    patchItem,
    removeItem,
  };
}
