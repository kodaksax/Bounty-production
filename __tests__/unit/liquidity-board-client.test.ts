// Tests for the founder Liquidity Board client (BNTY-10).
//
// The DB-side behaviour (each bucket's rule, the admin guard, the anon/
// authenticated grant) is exercised against the real schema by
// scripts/verify-liquidity-board.js, which applies inside a transaction and
// rolls it back. This suite covers the layer above it: row mapping.

const rpc = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
  isSupabaseConfigured: true,
}));

import { liquidityBoardClient, __liquidityBoardInternals } from '../../lib/admin/liquidityBoardClient';

const { mapLiquidityRow, normalizeBucket } = __liquidityBoardInternals;

beforeEach(() => {
  rpc.mockReset();
});

function ok(data: unknown) {
  return Promise.resolve({ data, error: null });
}

describe('mapLiquidityRow', () => {
  test('maps a full row', () => {
    const row = mapLiquidityRow({
      bucket: 'no_geom',
      bounty_id: 'b1',
      poster_id: 'u1',
      poster_username: 'jordan',
      title: 'Mow my lawn',
      amount: '40.00',
      status: 'open',
      funding_mode: 'at_post',
      stuck_since: '2026-09-18T10:00:00Z',
      stuck_hours: 26,
      detail: { reason: 'No location set; excluded from nearby search' },
      bucket_total: 42,
    });
    expect(row).toEqual({
      bucket: 'no_geom',
      bountyId: 'b1',
      posterId: 'u1',
      posterUsername: 'jordan',
      title: 'Mow my lawn',
      amount: 40,
      status: 'open',
      fundingMode: 'at_post',
      stuckSince: '2026-09-18T10:00:00Z',
      stuckHours: 26,
      detail: { reason: 'No location set; excluded from nearby search' },
      bucketTotal: 42,
    });
  });

  test('a missing bucket_total maps to undefined, not 0 or NaN', () => {
    const row = mapLiquidityRow({ bucket: 'no_geom', bounty_id: 'b1', stuck_hours: 1 });
    expect(row.bucketTotal).toBeUndefined();
  });

  test('an unrecognised bucket degrades to zero_applications rather than crashing', () => {
    expect(normalizeBucket('some_future_bucket')).toBe('zero_applications');
    expect(mapLiquidityRow({ bucket: 'nonsense', bounty_id: 'b1', stuck_hours: 1 }).bucket).toBe(
      'zero_applications'
    );
  });

  test('a missing poster leaves posterId/posterUsername undefined, not a message-poster dead end', () => {
    const row = mapLiquidityRow({ bucket: 'zero_applications', bounty_id: 'b1', stuck_hours: 3 });
    expect(row.posterId).toBeUndefined();
    expect(row.posterUsername).toBeUndefined();
  });

  test('a non-numeric amount maps to undefined rather than NaN', () => {
    const row = mapLiquidityRow({ bucket: 'no_geom', bounty_id: 'b1', amount: '', stuck_hours: 1 });
    expect(row.amount).toBeUndefined();
  });
});

describe('liquidityBoardClient.fetchBoard', () => {
  test('calls admin_liquidity_board with the given limit and maps every row', async () => {
    rpc.mockReturnValueOnce(
      ok([
        { bucket: 'poster_gone_dark', bounty_id: 'b1', stuck_hours: 50, detail: {} },
        { bucket: 'unopened_applications', bounty_id: 'b2', stuck_hours: 30, detail: { pending_unopened_count: 2 } },
      ])
    );
    const rows = await liquidityBoardClient.fetchBoard(250);
    expect(rpc).toHaveBeenCalledWith('admin_liquidity_board', { p_limit: 250 });
    expect(rows).toHaveLength(2);
    expect(rows[0].bucket).toBe('poster_gone_dark');
    expect(rows[1].detail).toEqual({ pending_unopened_count: 2 });
  });

  test('defaults to a 500 row limit', async () => {
    rpc.mockReturnValueOnce(ok([]));
    await liquidityBoardClient.fetchBoard();
    expect(rpc).toHaveBeenCalledWith('admin_liquidity_board', { p_limit: 500 });
  });

  test('a null data payload maps to an empty list rather than throwing', async () => {
    rpc.mockReturnValueOnce(ok(null));
    await expect(liquidityBoardClient.fetchBoard()).resolves.toEqual([]);
  });

  test('surfaces the RPC error as a thrown Error, e.g. the 403 a non-admin gets', async () => {
    rpc.mockReturnValueOnce(Promise.resolve({ data: null, error: { message: 'admin role required' } }));
    await expect(liquidityBoardClient.fetchBoard()).rejects.toThrow('admin role required');
  });
});
