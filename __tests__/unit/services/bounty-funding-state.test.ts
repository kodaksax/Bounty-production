/**
 * getBountyFundingState: hunter-facing funding state from
 * get_bounty_funding_status (supabase/migrations/20261002180000_bounty_funding_status_read_model.sql).
 *
 * The contract is "a claim only when the server made one": every failure or
 * unexpected payload is null, and the UI renders nothing for null.
 */

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn() },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn() },
}));

import { getBountyFundingState } from '../../../lib/services/bounty-funding-service';

const supabaseModule = require('../../../lib/supabase');
const rpc: jest.Mock = supabaseModule.supabase.rpc;

beforeEach(() => {
  rpc.mockReset();
  supabaseModule.isSupabaseConfigured = true;
});

describe('getBountyFundingState', () => {
  test.each(['held', 'held_on_selection', 'not_held', 'not_applicable'] as const)(
    'valid state %s is passed through',
    async (state) => {
      rpc.mockResolvedValue({ data: [{ bounty_id: 'b1', funding_state: state }], error: null });
      await expect(getBountyFundingState('b1')).resolves.toBe(state);
    }
  );

  test('calls the RPC with a one-element id array (string ids)', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getBountyFundingState(42);
    expect(rpc).toHaveBeenCalledWith('get_bounty_funding_status', { p_bounty_ids: ['42'] });
  });

  test('error result (RPC not deployed, permission denied) -> null', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(getBountyFundingState('b1')).resolves.toBeNull();
  });

  test('thrown exception (network) -> null, never rethrown', async () => {
    rpc.mockRejectedValue(new Error('fetch failed'));
    await expect(getBountyFundingState('b1')).resolves.toBeNull();
  });

  test('data as a single object (not an array) is accepted', async () => {
    rpc.mockResolvedValue({ data: { bounty_id: 'b1', funding_state: 'held' }, error: null });
    await expect(getBountyFundingState('b1')).resolves.toBe('held');
  });

  test('empty array (bounty not visible / not found) -> null', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getBountyFundingState('b1')).resolves.toBeNull();
  });

  test.each([
    ['unknown state string', [{ funding_state: 'escrowed' }]],
    ['wrong case', [{ funding_state: 'HELD' }]],
    ['missing field', [{ bounty_id: 'b1' }]],
    ['null state', [{ funding_state: null }]],
    ['null data', null],
    ['non-object row', ['held']],
  ])('%s -> null', async (_label, data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getBountyFundingState('b1')).resolves.toBeNull();
  });

  test('Supabase not configured -> null without calling the RPC', async () => {
    supabaseModule.isSupabaseConfigured = false;
    await expect(getBountyFundingState('b1')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
