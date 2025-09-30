// hooks/useAdminMetrics.ts - Hook for fetching admin dashboard metrics
import { useCallback, useEffect, useState } from 'react';
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminMetrics } from '../lib/types-admin';

interface UseAdminMetricsResult {
  metrics: AdminMetrics | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAdminMetrics(): UseAdminMetricsResult {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      console.error('Error fetching admin metrics:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return {
    metrics,
    isLoading,
    error,
    refetch: fetchMetrics,
  };
}
