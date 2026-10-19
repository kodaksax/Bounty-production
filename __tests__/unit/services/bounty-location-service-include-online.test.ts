/**
 * SBA-02: searchBountiesNearby asks the server to keep online jobs in a
 * radius search (20261019210000). A server without that migration answers
 * PGRST202; the client retries without the argument instead of showing an
 * empty feed.
 */
const mockRpc = jest.fn();
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

import { searchBountiesNearby } from '../../../lib/services/bounty-location-service';

beforeEach(() => mockRpc.mockReset());

it('sends p_include_online when asked', async () => {
  mockRpc.mockResolvedValue({ data: [{ id: 'a', work_type: 'online' }], error: null });
  const rows = await searchBountiesNearby({ latitude: 1, longitude: 2, radiusMiles: 25, includeOnline: true });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_radius_miles: 25, p_include_online: true });
  expect(rows).toEqual([{ id: 'a', work_type: 'online' }]);
});

it('leaves the argument out otherwise, so installed-build calls are unchanged', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await searchBountiesNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
  expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_include_online');
});

it('retries without it when the server does not know the argument (PGRST202)', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    .mockResolvedValueOnce({ data: [{ id: 'near' }], error: null });
  const rows = await searchBountiesNearby({ latitude: 1, longitude: 2, radiusMiles: 25, includeOnline: true });
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc.mock.calls[1][1]).not.toHaveProperty('p_include_online');
  expect(rows).toEqual([{ id: 'near' }]);
});

it('does not retry other errors', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
  const rows = await searchBountiesNearby({ latitude: 1, longitude: 2, radiusMiles: 25, includeOnline: true });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(rows).toEqual([]);
});
