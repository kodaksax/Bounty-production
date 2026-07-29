/**
 * Unit tests for useConnectBalance — the hook that sources the wallet balance
 * from the user's live Stripe Connect account.
 *
 * The critical invariants under test are the ones that make Stripe the single
 * source of truth: the hook must never fall back to a locally derived figure,
 * must never present a stale value as if it were live, and must not hammer the
 * Stripe API when the wallet screen refreshes on focus.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { useConnectBalance } from '../../../hooks/use-connect-balance';

const FULL_BALANCE = {
  available: 1250,
  pending: 500,
  instantAvailable: 750,
  currency: 'usd',
  lastUpdated: '2026-07-26T18:04:11.000Z',
  hasConnectAccount: true,
  payoutsEnabled: true,
};

function mockFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    json: response.json ?? (() => Promise.resolve({})),
  }) as jest.Mock;
}

describe('useConnectBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
  });

  it('starts in a loading state with no balance shown', () => {
    mockFetch({ ok: true, json: () => new Promise(() => {}) });
    const { result } = renderHook(() => useConnectBalance());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.available).toBe(0);
    expect(result.current.lastUpdated).toBeNull();
  });

  it('maps a live Stripe balance response', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.available).toBe(1250);
    expect(result.current.pending).toBe(500);
    expect(result.current.instantAvailable).toBe(750);
    expect(result.current.currency).toBe('usd');
    expect(result.current.hasConnectAccount).toBe(true);
    expect(result.current.payoutsEnabled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('calls GET /connect/balance with the caller\'s own token and no account id', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.example.com/connect/balance');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    // No account id anywhere in the request — the server derives it from the
    // JWT, so one user can never request another's balance.
    expect(url).not.toContain('acct_');
    expect(init.body).toBeUndefined();
  });

  it('surfaces an onboarding state rather than a zero balance when there is no Connect account', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          available: 0,
          pending: 0,
          instantAvailable: 0,
          currency: 'usd',
          lastUpdated: '2026-07-26T18:04:11.000Z',
          hasConnectAccount: false,
          payoutsEnabled: false,
        }),
    });
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasConnectAccount).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets an error on a failed response without inventing a balance', async () => {
    mockFetch({ ok: false });
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.available).toBe(0);
    // Never claims a fetch time it did not achieve.
    expect(result.current.lastUpdated).toBeNull();
  });

  it('sets an error when the network throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as jest.Mock;
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
  });

  it('keeps the last good balance on screen when a refresh fails', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());
    await waitFor(() => expect(result.current.available).toBe(1250));

    mockFetch({ ok: false });
    await act(async () => {
      await result.current.refresh({ force: true });
    });

    // Value persists so the UI doesn't flash to $0, but the error is surfaced
    // so it can be labelled as stale and offer a retry.
    expect(result.current.available).toBe(1250);
    expect(result.current.error).toBeTruthy();
  });

  it('distinguishes refreshing from first load', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveSecond: (v: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise(resolve => {
        resolveSecond = resolve;
      })
    ) as jest.Mock;

    act(() => {
      result.current.refresh({ force: true });
    });

    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    // A refresh must not blank the screen.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.available).toBe(1250);

    await act(async () => {
      resolveSecond({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    });
  });

  it('throttles unforced refreshes so screen focus cannot spam Stripe', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);

    await act(async () => {
      await result.current.refresh();
      await result.current.refresh();
      await result.current.refresh();
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('always honours an explicit pull-to-refresh', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result } = renderHook(() => useConnectBalance());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh({ force: true });
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('does not fetch when there is no session', () => {
    (useAuthContext as jest.Mock).mockReturnValue({ session: null });
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });

    renderHook(() => useConnectBalance());

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears the previous user\'s balance when the session changes', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(FULL_BALANCE) });
    const { result, rerender } = renderHook(() => useConnectBalance());
    await waitFor(() => expect(result.current.available).toBe(1250));

    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'other-user' } });
    mockFetch({ ok: true, json: () => new Promise(() => {}) });
    rerender({});

    // The incoming user must never briefly see the outgoing user's money.
    await waitFor(() => expect(result.current.available).toBe(0));
    expect(result.current.isLoading).toBe(true);
  });

  it('coerces malformed numeric fields instead of rendering NaN', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          ...FULL_BALANCE,
          available: 'not-a-number',
          pending: null,
          instantAvailable: undefined,
        }),
    });
    const { result } = renderHook(() => useConnectBalance());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.available).toBe(0);
    expect(result.current.pending).toBe(0);
    expect(result.current.instantAvailable).toBe(0);
  });
});
