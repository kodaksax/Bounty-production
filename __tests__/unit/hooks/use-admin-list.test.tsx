// Regression tests for useAdminList.
//
// The bug this replaces: useAdminBounties / useAdminUsers /
// useAdminTransactions each stored the caller's filters in a ref and built
// their fetcher with `useCallback(..., [])`, while the effect that ran the
// fetch depended only on that fetcher. The effect therefore never re-ran when
// a filter changed. Tapping a status chip or typing in a search box updated
// the control's own highlight, but the list underneath kept showing the
// previous query's rows until something else forced a refetch — so the admin
// panel's filters looked functional and did nothing.
//
// The first test here is the one that matters: change a filter, expect a
// refetch with the new filter.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { useAdminList } from '../../../hooks/useAdminList';
import type { AdminPage } from '../../../lib/types-admin';

// Preferences are read for the page size; keep them deterministic.
jest.mock('../../../lib/admin/adminPreferences', () => ({
  useAdminPreferences: () => ({
    preferences: {
      pageSize: 25,
      defaultBountyStatus: 'all',
      autoRefreshSeconds: 0,
      compactRows: false,
    },
    isLoading: false,
    update: jest.fn(),
    reset: jest.fn(),
  }),
}));

interface Row {
  id: string;
  label: string;
}

const getId = (row: Row) => row.id;

function page(items: Row[], total = items.length, hasMore = false): AdminPage<Row> {
  return { items, total, hasMore };
}

describe('useAdminList', () => {
  test('refetches when the filters change', async () => {
    const fetcher = jest
      .fn<Promise<AdminPage<Row>>, [any]>()
      .mockResolvedValue(page([{ id: '1', label: 'open' }]));

    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useAdminList<Row, { status: string }>({ filters: { status }, fetcher, getId }),
      { initialProps: { status: 'all' } }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatchObject({ status: 'all', page: 0 });

    // This is the assertion the old implementation failed.
    fetcher.mockResolvedValue(page([{ id: '2', label: 'completed' }]));
    rerender({ status: 'completed' });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1][0]).toMatchObject({ status: 'completed', page: 0 });
    await waitFor(() => expect(result.current.items).toEqual([{ id: '2', label: 'completed' }]));
  });

  test('does not refetch when an equivalent filter object is passed again', async () => {
    // Every admin screen passes an inline object literal, so a new identity
    // arrives on each render. Only a real change in filter *values* should
    // cost a request.
    const fetcher = jest.fn().mockResolvedValue(page([]));
    const { result, rerender } = renderHook(
      () => useAdminList<Row, { status: string }>({ filters: { status: 'all' }, fetcher, getId }),
      {}
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({});
    rerender({});

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('appends on loadMore instead of replacing the page', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(page([{ id: '1', label: 'a' }], 2, true))
      .mockResolvedValueOnce(page([{ id: '2', label: 'b' }], 2, false));

    const { result } = renderHook(() =>
      useAdminList<Row, Record<string, never>>({ filters: {}, fetcher, getId })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.items.map((r) => r.id)).toEqual(['1', '2']);
    expect(result.current.hasMore).toBe(false);
    expect(fetcher.mock.calls[1][0]).toMatchObject({ page: 1 });
  });

  test('reports the server-side total, not the number of rows on screen', async () => {
    const fetcher = jest.fn().mockResolvedValue(page([{ id: '1', label: 'a' }], 1240, true));
    const { result } = renderHook(() =>
      useAdminList<Row, Record<string, never>>({ filters: {}, fetcher, getId })
    );

    await waitFor(() => expect(result.current.total).toBe(1240));
    expect(result.current.items).toHaveLength(1);
  });

  test('a failed first load surfaces the error and empties the list', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('permission denied'));
    const { result } = renderHook(() =>
      useAdminList<Row, Record<string, never>>({ filters: {}, fetcher, getId })
    );

    await waitFor(() => expect(result.current.error).toBe('permission denied'));
    expect(result.current.items).toEqual([]);
  });

  test('a failed loadMore keeps the rows already on screen', async () => {
    // Blanking a list because page 2 failed would lose the operator's place.
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(page([{ id: '1', label: 'a' }], 2, true))
      .mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() =>
      useAdminList<Row, Record<string, never>>({ filters: {}, fetcher, getId })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('network');
    expect(result.current.items).toHaveLength(1);
  });

  test('ignores a stale response that resolves after a newer one', async () => {
    // A slow first query must not overwrite the fresher rows of the query the
    // operator actually asked for.
    let resolveSlow: (v: AdminPage<Row>) => void = () => {};
    const slow = new Promise<AdminPage<Row>>((resolve) => {
      resolveSlow = resolve;
    });

    const fetcher = jest
      .fn()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(page([{ id: 'fresh', label: 'fresh' }]));

    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useAdminList<Row, { status: string }>({ filters: { status }, fetcher, getId }),
      { initialProps: { status: 'all' } }
    );

    rerender({ status: 'open' });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'fresh', label: 'fresh' }]));

    // The superseded request lands late; it must be discarded.
    await act(async () => {
      resolveSlow(page([{ id: 'stale', label: 'stale' }]));
      await slow;
    });

    expect(result.current.items).toEqual([{ id: 'fresh', label: 'fresh' }]);
  });

  test('patchItem updates one row without a round trip', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      page([
        { id: '1', label: 'a' },
        { id: '2', label: 'b' },
      ])
    );
    const { result } = renderHook(() =>
      useAdminList<Row, Record<string, never>>({ filters: {}, fetcher, getId })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.patchItem('2', { label: 'patched' }));

    expect(result.current.items).toEqual([
      { id: '1', label: 'a' },
      { id: '2', label: 'patched' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('debounces rapid filter changes into a single request', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn().mockResolvedValue(page([]));
      const { rerender } = renderHook(
        ({ search }: { search: string }) =>
          useAdminList<Row, { search: string }>({
            filters: { search },
            fetcher,
            getId,
            debounceMs: 250,
          }),
        { initialProps: { search: '' } }
      );

      // Simulates typing: each keystroke re-renders with a new filter value.
      rerender({ search: 'a' });
      rerender({ search: 'ab' });
      rerender({ search: 'abc' });

      expect(fetcher).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toMatchObject({ search: 'abc' });
    } finally {
      jest.useRealTimers();
    }
  });
});
