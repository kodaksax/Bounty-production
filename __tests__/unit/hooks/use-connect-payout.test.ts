/**
 * Unit tests for useConnectPayout — initiating a Connect-native withdrawal.
 *
 * The invariants that matter here are about not moving money twice: a double
 * tap, or a retry after a network timeout, must never produce two payouts.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/use-auth-context', () => ({ useAuthContext: jest.fn() }));
jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { useConnectPayout } from '../../../hooks/use-connect-payout';

const SUCCESS = {
  payoutId: 'po_123',
  payoutMethod: 'standard',
  status: 'pending',
  amount: 12.5,
  currency: 'usd',
  arrivalDate: 1785110400,
  remainingAvailableCents: 0,
  message: 'Withdrawal sent.',
};

function mockFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    json: response.json ?? (() => Promise.resolve({})),
  }) as jest.Mock;
}

describe('useConnectPayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useConnectPayout());
    expect(result.current.phase).toBe('idle');
    expect(result.current.isProcessing).toBe(false);
  });

  it('posts to /connect/payout for a standard withdrawal', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.example.com/connect/payout');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('posts to /connect/instant-payout for an instant withdrawal', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve({ ...SUCCESS, payoutMethod: 'instant' }) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'instant' });
    });

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.example.com/connect/instant-payout'
    );
  });

  it('never sends an account identifier — the server derives it from the JWT', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.accountId).toBeUndefined();
    expect(body.stripeAccount).toBeUndefined();
    expect(body.connectAccountId).toBeUndefined();
    expect(body.userId).toBeUndefined();
  });

  it('sends an idempotency key with every request', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('maps a successful payout into the result', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    await waitFor(() => expect(result.current.phase).toBe('completed'));
    expect(result.current.result?.payoutId).toBe('po_123');
    expect(result.current.result?.amountCents).toBe(1250);
    expect(result.current.result?.status).toBe('pending');
    expect(result.current.result?.arrivalDate).toBe(1785110400);
  });

  it('ignores a second concurrent submission', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise(resolve => {
        resolveFirst = resolve;
      })
    ) as jest.Mock;

    const { result } = renderHook(() => useConnectPayout());

    let second: unknown;
    await act(async () => {
      result.current.withdraw({ amountCents: 1250, method: 'standard' });
      second = await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    // A double tap must not fire a second payout request.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
    expect(second).toBeNull();

    await act(async () => {
      resolveFirst({ ok: true, json: () => Promise.resolve(SUCCESS) });
    });
  });

  it('retains the idempotency key after a network failure so a retry cannot double-pay', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as jest.Mock;
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    const firstKey = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;

    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    const retryKey = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    // Same key => the server replays the original payout instead of sending twice.
    expect(retryKey).toBe(firstKey);
  });

  it('marks a network failure as retryable and says retrying is safe', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as jest.Mock;
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error?.retryable).toBe(true);
    expect(result.current.error?.message).toMatch(/not send twice/i);
  });

  it('treats insufficient balance as a non-retryable failure', async () => {
    mockFetch({
      ok: false,
      json: () =>
        Promise.resolve({ code: 'insufficient_balance', error: 'That is more than you have available to withdraw.' }),
    });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 999999, method: 'standard' });
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error?.code).toBe('insufficient_balance');
    expect(result.current.error?.retryable).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it.each([
    'no_connect_account',
    'connect_not_onboarded',
    'payouts_disabled',
    'no_available_funds',
    'instant_unsupported',
  ])('treats %s as non-retryable', async code => {
    mockFetch({ ok: false, json: () => Promise.resolve({ code, error: 'nope' }) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error?.retryable).toBe(false);
  });

  it('treats an unrecognised server error as retryable', async () => {
    mockFetch({ ok: false, json: () => Promise.resolve({ code: 'stripe_unavailable', error: 'Stripe down' }) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    await waitFor(() => expect(result.current.error?.retryable).toBe(true));
  });

  it('surfaces a duplicate replay as success rather than an error', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ ...SUCCESS, duplicate: true, message: 'Already submitted.' }),
    });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    await waitFor(() => expect(result.current.phase).toBe('completed'));
    expect(result.current.result?.duplicate).toBe(true);
  });

  it('fails safely when there is no session', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({ session: null });
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.error?.code).toBe('not_authenticated');
  });

  it('reset clears state for a fresh attempt', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve(SUCCESS) });
    const { result } = renderHook(() => useConnectPayout());

    await act(async () => {
      await result.current.withdraw({ amountCents: 1250, method: 'standard' });
    });
    await waitFor(() => expect(result.current.phase).toBe('completed'));

    act(() => result.current.reset());

    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
