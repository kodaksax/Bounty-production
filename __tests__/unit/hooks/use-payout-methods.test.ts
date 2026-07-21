/**
 * Unit tests for usePayoutMethods — the shared bank-account/debit-card hook
 * consumed by withdraw-with-bank-screen, instant-cash-out-screen, and
 * payout-methods-screen (replacing each screen's previous independent
 * GET /connect/bank-accounts + GET /connect/debit-cards fetches).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));
jest.mock('../../../lib/constants', () => ({ MIN_WITHDRAWAL_AMOUNT: 10 }));

const openUrlInBrowser = jest.fn();
jest.mock('../../../lib/utils/browser', () => ({
  openUrlInBrowser: (...args: unknown[]) => openUrlInBrowser(...args),
}));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { usePayoutMethods } from '../../../hooks/use-payout-methods';

const bankAccount = { id: 'ba_1', last4: '1234', default: true, status: 'verified' };
const eligibleCard = { id: 'card_1', brand: 'Visa', last4: '4242', instantEligible: true };
const ineligibleCard = { id: 'card_2', brand: 'Amex', last4: '0005', instantEligible: false };

function mockFetchSequence(responses: Array<{ ok: boolean; json?: () => Promise<unknown> }>) {
  let i = 0;
  global.fetch = jest.fn(() => {
    const res = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve({ ok: res.ok, json: res.json ?? (() => Promise.resolve({})) });
  }) as jest.Mock;
}

describe('usePayoutMethods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
  });

  it('fetches bank accounts and debit cards in parallel and merges the results', async () => {
    mockFetchSequence([
      {
        ok: true,
        json: () =>
          Promise.resolve({
            bankAccounts: [bankAccount],
            minWithdrawal: 15,
            maxWithdrawal: 5000,
            availableBalance: 123.45,
          }),
      },
      {
        ok: true,
        json: () => Promise.resolve({ debitCards: [eligibleCard, ineligibleCard], instantAvailableCents: 500 }),
      },
    ]);

    const { result } = renderHook(() => usePayoutMethods());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bankAccounts).toEqual([bankAccount]);
    expect(result.current.debitCards).toEqual([eligibleCard, ineligibleCard]);
    expect(result.current.hasInstantEligibleCard).toBe(true);
    expect(result.current.instantAvailableCents).toBe(500);
    expect(result.current.canInstantCashOut).toBe(true);
    expect(result.current.minWithdrawal).toBe(15);
    expect(result.current.maxWithdrawal).toBe(5000);
    expect(result.current.availableBalance).toBe(123.45);
    expect(result.current.error).toBeNull();
  });

  it('canInstantCashOut is true when a card is instant-eligible even when instantAvailableCents is 0 (pre-transfer balance is not a pre-flight gate)', async () => {
    // instantAvailableCents reflects the connected account's balance BEFORE
    // POST /connect/instant-payout has ever run its own platform->connected
    // transfer — it is necessarily 0 for a hunter who hasn't withdrawn yet,
    // so it must never gate canInstantCashOut (2026-07-21 fix: this used to
    // be `false` here, which permanently locked Instant Cash Out for every
    // first-time user regardless of a valid linked card).
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve({ bankAccounts: [] }) },
      { ok: true, json: () => Promise.resolve({ debitCards: [eligibleCard], instantAvailableCents: 0 }) },
    ]);
    const { result } = renderHook(() => usePayoutMethods());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasInstantEligibleCard).toBe(true);
    expect(result.current.canInstantCashOut).toBe(true);
  });

  it('hasInstantEligibleCard is false when no card is instant-eligible', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve({ bankAccounts: [] }) },
      { ok: true, json: () => Promise.resolve({ debitCards: [ineligibleCard] }) },
    ]);
    const { result } = renderHook(() => usePayoutMethods());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasInstantEligibleCard).toBe(false);
  });

  it('sets an error when both requests fail', async () => {
    mockFetchSequence([{ ok: false }, { ok: false }]);
    const { result } = renderHook(() => usePayoutMethods());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/could not load/i);
  });

  it('does not error when only one of the two requests fails (partial data still usable)', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve({ bankAccounts: [bankAccount] }) },
      { ok: false },
    ]);
    const { result } = renderHook(() => usePayoutMethods());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.bankAccounts).toEqual([bankAccount]);
    expect(result.current.debitCards).toEqual([]);
  });

  describe('openPayoutDashboard', () => {
    beforeEach(() => openUrlInBrowser.mockReset());

    it('fetches a login link, opens it in the browser, refreshes, and returns ok', async () => {
      mockFetchSequence([
        { ok: true, json: () => Promise.resolve({ bankAccounts: [bankAccount] }) },
        { ok: true, json: () => Promise.resolve({ debitCards: [] }) },
      ]);
      const { result } = renderHook(() => usePayoutMethods());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetchSequence([
        { ok: true, json: () => Promise.resolve({ url: 'https://connect.stripe.com/express/abc' }) }, // login-link
        { ok: true, json: () => Promise.resolve({ bankAccounts: [{ ...bankAccount, default: true }] }) }, // refresh: bank-accounts
        { ok: true, json: () => Promise.resolve({ debitCards: [] }) }, // refresh: debit-cards
      ]);
      openUrlInBrowser.mockResolvedValue({ success: true });

      let outcome: { ok: boolean };
      await act(async () => {
        outcome = await result.current.openPayoutDashboard();
      });
      expect(outcome!.ok).toBe(true);
      expect(openUrlInBrowser).toHaveBeenCalledWith('https://connect.stripe.com/express/abc');
    });

    it('returns a friendly error when the login-link request fails, without opening a browser', async () => {
      mockFetchSequence([
        { ok: true, json: () => Promise.resolve({ bankAccounts: [bankAccount] }) },
        { ok: true, json: () => Promise.resolve({ debitCards: [] }) },
      ]);
      const { result } = renderHook(() => usePayoutMethods());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetchSequence([{ ok: false, json: () => Promise.resolve({ error: 'nope' }) }]);
      let outcome: { ok: boolean; error?: string };
      await act(async () => {
        outcome = await result.current.openPayoutDashboard();
      });
      expect(outcome!.ok).toBe(false);
      expect(outcome!.error).toBeTruthy();
      expect(openUrlInBrowser).not.toHaveBeenCalled();
    });

    it('returns a friendly error when the browser fails to open', async () => {
      mockFetchSequence([
        { ok: true, json: () => Promise.resolve({ bankAccounts: [bankAccount] }) },
        { ok: true, json: () => Promise.resolve({ debitCards: [] }) },
      ]);
      const { result } = renderHook(() => usePayoutMethods());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockFetchSequence([{ ok: true, json: () => Promise.resolve({ url: 'https://connect.stripe.com/express/abc' }) }]);
      openUrlInBrowser.mockResolvedValue({ success: false, error: 'Cannot open URL' });

      let outcome: { ok: boolean; error?: string };
      await act(async () => {
        outcome = await result.current.openPayoutDashboard();
      });
      expect(outcome!.ok).toBe(false);
      expect(outcome!.error).toBe('Cannot open URL');
    });
  });
});
