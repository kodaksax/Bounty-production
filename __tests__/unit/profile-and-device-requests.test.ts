/**
 * The two requests that errored in a new poster's sessions:
 *  - GET portfolio_items?user_id=eq.current-user  -> 400 (a placeholder in a
 *    uuid filter), when Profile opened before auth had resolved.
 *  - GET user_devices?...&device_name=eq.<model>  -> 406 (.single() on a
 *    device's first sign-in, when there is no row yet).
 *
 * Each query is recorded as the chain of builder calls it makes, so the test
 * pins the request shape: which filters, and whether it asks PostgREST for a
 * single object (single) or an array it checks client-side (maybeSingle).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

type Call = [method: string, ...args: unknown[]];
interface Query {
  table: string;
  calls: Call[];
}

const mockQueries: Query[] = [];
// Result for the next query on a table: { data, error }.
const mockResults: Record<string, Array<{ data?: unknown; error?: unknown; count?: number }>> = {};
const mockGetUser = jest.fn();

jest.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const q: Query = { table, calls: [] };
    mockQueries.push(q);
    const result = () => mockResults[table]?.shift() ?? { data: null, error: null };
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const r = result();
            return (resolve: (v: unknown) => void) => resolve(r);
          }
          return (...args: unknown[]) => {
            q.calls.push([prop, ...args]);
            return chain;
          };
        },
      }
    );
    return chain;
  };
  return {
    supabase: {
      from,
      auth: { getUser: (...a: unknown[]) => mockGetUser(...a) },
    },
    isSupabaseConfigured: true,
  };
});

// ESM-only native module; never reached by these queries.
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('../../lib/services/portfolio-legacy-migration', () => ({
  migrateLegacyPortfolioItems: jest.fn().mockResolvedValue(undefined),
}));

import { usePortfolio } from '../../hooks/usePortfolio';
import { deviceService } from '../../lib/services/device-service';
import { portfolioService } from '../../lib/services/portfolio-service';
import { isUuid } from '../../lib/utils/is-uuid';

const USER_ID = '6f1c2b8e-0d3a-4c51-9a7e-2f4b8c9d1e00';
const methods = (q: Query) => q.calls.map((c) => c[0]);

beforeEach(() => {
  mockQueries.length = 0;
  for (const k of Object.keys(mockResults)) delete mockResults[k];
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isUuid', () => {
  it.each([
    [USER_ID, true],
    ['current-user', false],
    ['', false],
    [undefined, false],
    [null, false],
    ['6f1c2b8e-0d3a-4c51-9a7e-2f4b8c9d1e0', false],
  ])('%p -> %p', (v, expected) => expect(isUuid(v)).toBe(expected));
});

describe('portfolio_items never queried with a placeholder id', () => {
  it.each(['current-user', '', null, undefined])('getItems(%p) sends no request', async (id) => {
    await expect(portfolioService.getItems(id as any)).resolves.toEqual([]);
    await expect(portfolioService.getItemCount(id as any)).resolves.toBe(0);
    expect(mockQueries).toEqual([]);
  });

  it('getItems(real id) filters on that id', async () => {
    mockResults.portfolio_items = [{ data: [], error: null }];
    await portfolioService.getItems(USER_ID);
    expect(mockQueries).toHaveLength(1);
    expect(mockQueries[0].calls).toContainEqual(['eq', 'user_id', USER_ID]);
  });

  it('usePortfolio waits for a real id, then fetches with it', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => usePortfolio(id, true), {
      initialProps: { id: null as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockQueries).toEqual([]);
    expect(result.current.items).toEqual([]);

    mockResults.portfolio_items = [{ data: [], error: null }];
    await act(async () => rerender({ id: USER_ID }));
    await waitFor(() => expect(mockQueries).toHaveLength(1));
    expect(mockQueries[0].calls).toContainEqual(['eq', 'user_id', USER_ID]);
  });

  it("usePortfolio('current-user') sends nothing", async () => {
    const { result } = renderHook(() => usePortfolio('current-user', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockQueries).toEqual([]);
  });
});

describe('user_devices registration on a device', () => {
  const lookup = () => mockQueries[0];

  it('first sign-in: reads with maybeSingle (a 200 with no row), then creates the row', async () => {
    mockResults.user_devices = [{ data: null, error: null }, { data: null, error: null }];
    await deviceService.registerCurrentDevice();

    expect(methods(lookup())).toContain('maybeSingle');
    expect(methods(lookup())).not.toContain('single');
    expect(lookup().calls).toContainEqual(['eq', 'device_name', 'iPhone']);
    expect(lookup().calls).toContainEqual(['limit', 1]);

    expect(mockQueries).toHaveLength(2);
    const insert = mockQueries[1].calls.find((c) => c[0] === 'insert');
    expect(insert?.[1]).toMatchObject({ user_id: USER_ID, device_name: 'iPhone', is_active: true });
  });

  it('known device: updates last_active and inserts nothing', async () => {
    mockResults.user_devices = [{ data: { id: 'dev-1' }, error: null }, { data: null, error: null }];
    await deviceService.registerCurrentDevice();

    expect(mockQueries).toHaveLength(2);
    expect(methods(mockQueries[1])).toContain('update');
    expect(methods(mockQueries[1])).not.toContain('insert');
    expect(mockQueries[1].calls).toContainEqual(['eq', 'id', 'dev-1']);
  });

  it('a failed lookup creates nothing (no duplicate rows on a flaky launch)', async () => {
    mockResults.user_devices = [{ data: null, error: { code: '500', message: 'boom' } }];
    await deviceService.registerCurrentDevice();
    expect(mockQueries).toHaveLength(1);
  });

  it('signed out: no request', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await deviceService.registerCurrentDevice();
    expect(mockQueries).toEqual([]);
  });

  it('checkDeviceStatus uses maybeSingle and treats a failed read as still active', async () => {
    mockResults.user_devices = [{ data: null, error: null }];
    await expect(deviceService.checkDeviceStatus()).resolves.toBe(false);
    expect(methods(lookup())).toContain('maybeSingle');
    expect(methods(lookup())).not.toContain('single');

    mockQueries.length = 0;
    mockResults.user_devices = [{ data: null, error: { code: '500', message: 'boom' } }];
    await expect(deviceService.checkDeviceStatus()).resolves.toBe(true);
  });
});
