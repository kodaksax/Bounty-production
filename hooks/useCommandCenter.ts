// hooks/useCommandCenter.ts — state for the founder Command Center.
//
// One hook for the whole overview screen: the headline numbers, the live
// activity feed and the anomaly queue are fetched together so a refresh gives
// a consistent picture rather than three views of three different moments.
//
// Deliberately independent failure: a broken anomaly query must not blank the
// marketplace numbers, and vice versa. Each slice keeps its own error so the
// screen can degrade to a banner instead of an error page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { commandCenterClient } from '../lib/admin/commandCenterClient';
import type {
  AdminAnomaly,
  AdminFeedFilters,
  AdminLedgerEvent,
  AdminMarketplaceOverview,
} from '../lib/types-admin';

export const COMMAND_CENTER_WINDOWS = [
  { id: '24h', label: 'Today', hours: 24 },
  { id: '7d', label: '7 days', hours: 24 * 7 },
  { id: '30d', label: '30 days', hours: 24 * 30 },
] as const;

export type CommandCenterWindowId = (typeof COMMAND_CENTER_WINDOWS)[number]['id'];

const FEED_PAGE_SIZE = 40;

interface UseCommandCenterResult {
  overview: AdminMarketplaceOverview | null;
  events: AdminLedgerEvent[];
  anomalies: AdminAnomaly[];
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasMoreEvents: boolean;
  error: string | null;
  feedError: string | null;
  anomalyError: string | null;
  refetch: () => Promise<void>;
  loadMoreEvents: () => Promise<void>;
}

export function useCommandCenter(
  windowId: CommandCenterWindowId = '24h',
  feedFilters: Pick<AdminFeedFilters, 'sources' | 'types'> = {}
): UseCommandCenterResult {
  const [overview, setOverview] = useState<AdminMarketplaceOverview | null>(null);
  const [events, setEvents] = useState<AdminLedgerEvent[]>([]);
  const [anomalies, setAnomalies] = useState<AdminAnomaly[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreEvents, setHasMoreEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [anomalyError, setAnomalyError] = useState<string | null>(null);

  const hours = useMemo(
    () => COMMAND_CENTER_WINDOWS.find((w) => w.id === windowId)?.hours ?? 24,
    [windowId]
  );
  // Serialised so an inline object literal from the screen does not retrigger
  // the effect on every render.
  const filterKey = useMemo(() => JSON.stringify(feedFilters ?? {}), [feedFilters]);
  const filtersRef = useRef(feedFilters);
  filtersRef.current = feedFilters;

  // Guards against a slow request resolving after a newer one.
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const ticket = ++seq.current;
      if (mode === 'refresh') setIsRefreshing(true);
      else setIsLoading(true);

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const [overviewResult, feedResult, anomalyResult] = await Promise.allSettled([
        commandCenterClient.fetchOverview(since),
        commandCenterClient.fetchFeed({ ...filtersRef.current, limit: FEED_PAGE_SIZE }),
        commandCenterClient.fetchAnomalies(200),
      ]);

      if (ticket !== seq.current) return;

      if (overviewResult.status === 'fulfilled') {
        setOverview(overviewResult.value);
        setError(null);
      } else {
        setError(messageOf(overviewResult.reason));
      }

      if (feedResult.status === 'fulfilled') {
        setEvents(feedResult.value);
        setHasMoreEvents(feedResult.value.length >= FEED_PAGE_SIZE);
        setFeedError(null);
      } else {
        setFeedError(messageOf(feedResult.reason));
      }

      if (anomalyResult.status === 'fulfilled') {
        setAnomalies(anomalyResult.value);
        setAnomalyError(null);
      } else {
        setAnomalyError(messageOf(anomalyResult.reason));
      }

      setIsLoading(false);
      setIsRefreshing(false);
    },
    [hours]
  );

  useEffect(() => {
    void load('initial');
    // filterKey is the stable primitive stand-in for feedFilters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, filterKey]);

  const refetch = useCallback(() => load('refresh'), [load]);

  const loadMoreEvents = useCallback(async () => {
    const last = events[events.length - 1];
    if (!last || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const next = await commandCenterClient.fetchFeed({
        ...filtersRef.current,
        limit: FEED_PAGE_SIZE,
        before: last.occurredAt,
        beforeId: last.id,
      });
      setEvents((prev) => {
        // The keyset cursor makes overlap unlikely, but a same-timestamp burst
        // arriving between pages would otherwise duplicate a row.
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...next.filter((e) => !seen.has(e.id))];
      });
      setHasMoreEvents(next.length >= FEED_PAGE_SIZE);
      setFeedError(null);
    } catch (err) {
      setFeedError(messageOf(err));
    } finally {
      setIsLoadingMore(false);
    }
  }, [events, isLoadingMore]);

  return {
    overview,
    events,
    anomalies,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMoreEvents,
    error,
    feedError,
    anomalyError,
    refetch,
    loadMoreEvents,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? 'Unknown error');
}
