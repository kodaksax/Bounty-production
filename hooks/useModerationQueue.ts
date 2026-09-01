// hooks/useModerationQueue.ts — state for the admin Bounty Moderation Queue.
//
// One hook for the queue screen: the rows, the unacknowledged founder alerts
// and the outcome metrics are fetched together so a refresh gives a consistent
// picture. Each slice keeps its own error so a broken alert query degrades to a
// banner instead of blanking the queue.
import { useCallback, useEffect, useRef, useState } from 'react';
import { moderationClient } from '../lib/admin/moderationClient';
import type {
  AdminModerationAlert,
  AdminModerationMetrics,
  AdminModerationQueueRow,
  AdminModerationState,
} from '../lib/types-admin';

const PAGE_SIZE = 100;

interface UseModerationQueueResult {
  rows: AdminModerationQueueRow[];
  alerts: AdminModerationAlert[];
  metrics: AdminModerationMetrics | null;
  total: number;
  hasMore: boolean;
  stateFilter: AdminModerationState | 'all';
  setStateFilter: (s: AdminModerationState | 'all') => void;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  alertsError: string | null;
  metricsError: string | null;
  refetch: () => Promise<void>;
  acknowledgeAlert: (id: string) => Promise<void>;
}

export function useModerationQueue(
  initialState: AdminModerationState | 'all' = 'flagged'
): UseModerationQueueResult {
  const [rows, setRows] = useState<AdminModerationQueueRow[]>([]);
  const [alerts, setAlerts] = useState<AdminModerationAlert[]>([]);
  const [metrics, setMetrics] = useState<AdminModerationMetrics | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stateFilter, setStateFilter] = useState<AdminModerationState | 'all'>(initialState);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Guards a slow request resolving after a newer one.
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const ticket = ++seq.current;
      if (mode === 'refresh') setIsRefreshing(true);
      else setIsLoading(true);

      const [queueResult, alertsResult, metricsResult] = await Promise.allSettled([
        moderationClient.fetchQueue({
          state: stateFilter === 'all' ? undefined : stateFilter,
          limit: PAGE_SIZE,
        }),
        moderationClient.fetchAlerts(false, 50),
        moderationClient.fetchMetrics(),
      ]);

      if (ticket !== seq.current) return;

      if (queueResult.status === 'fulfilled') {
        setRows(queueResult.value.rows);
        setTotal(queueResult.value.total);
        setHasMore(queueResult.value.hasMore);
        setError(null);
      } else {
        setError(messageOf(queueResult.reason));
      }

      if (alertsResult.status === 'fulfilled') {
        setAlerts(alertsResult.value);
        setAlertsError(null);
      } else {
        setAlertsError(messageOf(alertsResult.reason));
      }

      if (metricsResult.status === 'fulfilled') {
        setMetrics(metricsResult.value);
        setMetricsError(null);
      } else {
        setMetricsError(messageOf(metricsResult.reason));
      }

      setIsLoading(false);
      setIsRefreshing(false);
    },
    [stateFilter]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refetch = useCallback(() => load('refresh'), [load]);

  const acknowledgeAlert = useCallback(async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await moderationClient.acknowledgeAlert(id);
    } catch (err) {
      // Put it back and surface the failure.
      setAlertsError(messageOf(err));
      void load('refresh');
    }
  }, [load]);

  return {
    rows,
    alerts,
    metrics,
    total,
    hasMore,
    stateFilter,
    setStateFilter,
    isLoading,
    isRefreshing,
    error,
    alertsError,
    metricsError,
    refetch,
    acknowledgeAlert,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? 'Unknown error');
}
