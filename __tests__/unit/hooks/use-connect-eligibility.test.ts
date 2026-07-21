/**
 * Unit tests for useConnectEligibility — the shared Stripe Connect
 * onboarding/payout eligibility hook consumed by withdraw-with-bank-screen,
 * instant-cash-out-screen, and payout-methods-screen (replacing each
 * screen's previous independent POST /connect/verify-onboarding call).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { useConnectEligibility } from '../../../hooks/use-connect-eligibility';

function mockFetchOnce(response: { ok: boolean; json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    json: response.json ?? (() => Promise.resolve({})),
  }) as jest.Mock;
}

describe('useConnectEligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
  });

  it('starts in a loading state', () => {
    mockFetchOnce({ ok: true, json: () => new Promise(() => {}) });
    const { result } = renderHook(() => useConnectEligibility());
    expect(result.current.loading).toBe(true);
  });

  it('maps a fully-onboarded response', async () => {
    mockFetchOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accountId: 'acct_123',
          detailsSubmitted: true,
          chargesEnabled: true,
          payoutsEnabled: true,
          onboarded: true,
        }),
    });
    const { result } = renderHook(() => useConnectEligibility());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.connectedAccountExists).toBe(true);
    expect(result.current.detailsSubmitted).toBe(true);
    expect(result.current.chargesEnabled).toBe(true);
    expect(result.current.payoutsEnabled).toBe(true);
    expect(result.current.isFullyOnboarded).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('treats onboarded=true but payoutsEnabled=false as NOT fully onboarded', async () => {
    mockFetchOnce({
      ok: true,
      json: () => Promise.resolve({ accountId: 'acct_123', onboarded: true, payoutsEnabled: false }),
    });
    const { result } = renderHook(() => useConnectEligibility());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isFullyOnboarded).toBe(false);
  });

  it('sets an error when the server responds non-2xx', async () => {
    mockFetchOnce({ ok: false });
    const { result } = renderHook(() => useConnectEligibility());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/could not check/i);
  });

  it('sets an error when the fetch itself throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as jest.Mock;
    const { result } = renderHook(() => useConnectEligibility());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/could not reach/i);
  });

  it('does not fetch without a session', () => {
    (useAuthContext as jest.Mock).mockReturnValue({ session: null });
    global.fetch = jest.fn();
    renderHook(() => useConnectEligibility());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refresh() re-fetches on demand', async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve({ onboarded: false }) });
    const { result } = renderHook(() => useConnectEligibility());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
