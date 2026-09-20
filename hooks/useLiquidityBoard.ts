// hooks/useLiquidityBoard.ts — state for the founder Liquidity Board (BNTY-10)
import { useCallback, useEffect, useRef, useState } from 'react';
import { liquidityBoardClient } from '../lib/admin/liquidityBoardClient';
import type { AdminLiquidityRow } from '../lib/types-admin';

interface UseLiquidityBoardResult {
  rows: AdminLiquidityRow[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useLiquidityBoard(): UseLiquidityBoardResult {
  const [rows, setRows] = useState<AdminLiquidityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow request resolving after a newer one.
  const seq = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const ticket = ++seq.current;
    if (mode === 'refresh') setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const next = await liquidityBoardClient.fetchBoard(500);
      if (ticket !== seq.current) return;
      setRows(next);
      setError(null);
    } catch (err) {
      if (ticket !== seq.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load the Liquidity Board');
    } finally {
      if (ticket === seq.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refetch = useCallback(() => load('refresh'), [load]);

  return { rows, isLoading, isRefreshing, error, refetch };
}
