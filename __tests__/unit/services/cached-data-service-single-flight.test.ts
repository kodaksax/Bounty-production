/**
 * Several screens mount the same cached query, and one realtime event reaches
 * all of them. These pin the contract that keeps that to one network pass
 * without ever handing a caller data older than its own request.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cachedDataService } from '../../../lib/services/cached-data-service';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      getAllKeys: jest.fn(async () => [...store.keys()]),
      multiRemove: jest.fn(async (keys: string[]) => {
        keys.forEach(key => store.delete(key));
      }),
    },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

/** A fetch whose completion the test controls, so overlap is deterministic. */
function controlledFetch<T>() {
  const pending: { resolve: (value: T) => void; reject: (error: Error) => void }[] = [];
  const fetchFn = jest.fn(
    () =>
      new Promise<T>((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  );
  return { fetchFn, pending };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

describe('cachedDataService single-flight', () => {
  beforeEach(async () => {
    await cachedDataService.clearAll();
  });

  it('collapses a burst of forced refreshes into one running pass plus one trailing pass', async () => {
    const { fetchFn, pending } = controlledFetch<string>();

    const calls = [1, 2, 3, 4, 5].map(() =>
      cachedDataService.fetchWithCache('burst', fetchFn, { forceRefresh: true })
    );
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    pending[0].resolve('first');
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    pending[1].resolve('second');
    const results = await Promise.all(calls);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    // The first caller started the pass; every later caller waited for the
    // trailing one, so none of them can miss a write made before they asked.
    expect(results).toEqual(['first', 'second', 'second', 'second', 'second']);
  });

  it('never gives a forced refresh a pass that started before it was requested', async () => {
    const { fetchFn, pending } = controlledFetch<string>();

    const earlier = cachedDataService.fetchWithCache('fresh', fetchFn, { forceRefresh: true });
    await flush();

    // A message is sent here, after the first pass already read the database.
    const afterWrite = cachedDataService.fetchWithCache('fresh', fetchFn, { forceRefresh: true });

    pending[0].resolve('before the write');
    await flush();
    pending[1].resolve('after the write');

    await expect(earlier).resolves.toBe('before the write');
    await expect(afterWrite).resolves.toBe('after the write');
  });

  it('shares one background revalidation between concurrent stale-while-revalidate reads', async () => {
    await cachedDataService.setCache('swr', 'cached');
    const { fetchFn, pending } = controlledFetch<string>();

    const reads = await Promise.all([
      cachedDataService.fetchWithCache('swr', fetchFn),
      cachedDataService.fetchWithCache('swr', fetchFn),
      cachedDataService.fetchWithCache('swr', fetchFn),
    ]);
    await flush();

    expect(reads).toEqual(['cached', 'cached', 'cached']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    pending[0].resolve('revalidated');
    await flush();
  });

  it('writes the cache once per network pass, not once per caller', async () => {
    const { fetchFn, pending } = controlledFetch<string>();
    (AsyncStorage.setItem as jest.Mock).mockClear();

    const calls = [1, 2, 3].map(() => cachedDataService.fetchWithCache('one-write', fetchFn));
    await flush();
    pending[0].resolve('value');
    await Promise.all(calls);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps keys independent', async () => {
    const a = jest.fn(async () => 'a');
    const b = jest.fn(async () => 'b');

    const results = await Promise.all([
      cachedDataService.fetchWithCache('key-a', a, { forceRefresh: true }),
      cachedDataService.fetchWithCache('key-b', b, { forceRefresh: true }),
    ]);

    expect(results).toEqual(['a', 'b']);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed pass poison the next fetch', async () => {
    const fetchFn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('recovered');

    await expect(
      cachedDataService.fetchWithCache('flaky', fetchFn, { forceRefresh: true })
    ).rejects.toThrow('network down');

    await expect(
      cachedDataService.fetchWithCache('flaky', fetchFn, { forceRefresh: true })
    ).resolves.toBe('recovered');
  });

  it('still runs the trailing refresh when the pass it waited on fails', async () => {
    const { fetchFn, pending } = controlledFetch<string>();

    const first = cachedDataService.fetchWithCache('fail-then-trail', fetchFn, {
      forceRefresh: true,
    });
    await flush();
    const trailing = cachedDataService.fetchWithCache('fail-then-trail', fetchFn, {
      forceRefresh: true,
    });

    // Attached before the rejection fires, the way a real awaiting caller is.
    const firstOutcome = expect(first).rejects.toThrow('first pass failed');
    pending[0].reject(new Error('first pass failed'));
    await flush();
    pending[1].resolve('trailing ok');

    await firstOutcome;
    await expect(trailing).resolves.toBe('trailing ok');
  });

  it('does not let a caller join a pass started before clearAll (logout)', async () => {
    const { fetchFn, pending } = controlledFetch<string>();

    const beforeLogout = cachedDataService.fetchWithCache('session', fetchFn);
    await flush();
    await cachedDataService.clearAll();

    const afterLogin = cachedDataService.fetchWithCache('session', fetchFn);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    pending[0].resolve('previous account');
    pending[1].resolve('new account');
    await expect(beforeLogout).resolves.toBe('previous account');
    await expect(afterLogin).resolves.toBe('new account');
  });
});
