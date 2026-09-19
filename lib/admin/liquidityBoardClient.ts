// lib/admin/liquidityBoardClient.ts — founder Liquidity Board data client (BNTY-10)
//
// Reads admin_liquidity_board() from
// supabase/migrations/20260919120000_admin_liquidity_board.sql. That function
// re-checks `app_metadata.role === 'admin'` server-side (admin_assert_role()),
// so this client is a convenience layer, not the authorization boundary.
import { supabase } from '../supabase';
import {
  ADMIN_LIQUIDITY_BUCKETS,
  type AdminLiquidityBucket,
  type AdminLiquidityRow,
} from '../types-admin';

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeBucket(value: unknown): AdminLiquidityBucket {
  return (ADMIN_LIQUIDITY_BUCKETS as readonly string[]).includes(value as string)
    ? (value as AdminLiquidityBucket)
    : 'zero_applications';
}

/** Plain-language titles for the board's section headers. */
export const LIQUIDITY_BUCKET_TITLES: Record<AdminLiquidityBucket, string> = {
  no_geom: 'Open with no location',
  zero_applications: 'Open 2h+ with no applications',
  unopened_applications: 'Applications pending 24h+, unopened',
  funding_required_no_hire: 'Pay-at-accept, no hire in 24h',
  poster_gone_dark: 'Poster gone dark 48h+',
};

export function mapLiquidityRow(row: any): AdminLiquidityRow {
  return {
    bucket: normalizeBucket(row.bucket),
    bountyId: row.bounty_id,
    posterId: row.poster_id ?? undefined,
    posterUsername: row.poster_username ?? undefined,
    title: row.title ?? undefined,
    amount: optionalNumber(row.amount),
    status: row.status ?? undefined,
    fundingMode: row.funding_mode ?? undefined,
    stuckSince: row.stuck_since ?? new Date().toISOString(),
    stuckHours: Number(row.stuck_hours) || 0,
    detail: (row.detail ?? {}) as Record<string, unknown>,
  };
}

function unwrap<T>({ data, error }: { data: T; error: { message?: string } | null }): T {
  if (error) throw new Error(error.message ?? 'Liquidity Board query failed');
  return data;
}

export const liquidityBoardClient = {
  async fetchBoard(limit = 500): Promise<AdminLiquidityRow[]> {
    const data = unwrap(await supabase.rpc('admin_liquidity_board', { p_limit: limit }));
    return ((data ?? []) as any[]).map(mapLiquidityRow);
  },
};

// Exported for unit tests: the pure logic that decides what the operator reads.
export const __liquidityBoardInternals = { mapLiquidityRow, normalizeBucket };
