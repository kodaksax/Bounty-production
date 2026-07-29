/**
 * Unit tests for usePayoutHistory — withdrawal history sourced from Stripe.
 *
 * The point of this hook is that Stripe, not our ledger, decides what the user
 * is told happened to their money. These tests pin that, and pin that
 * disagreement between the two is surfaced rather than silently resolved.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/use-auth-context', () => ({ useAuthContext: jest.fn() }));
jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { payoutStatusLabel, usePayoutHistory } from '../../../hooks/use-payout-history';

const PAID = {
  payoutId: 'po_paid',
  status: 'paid',
  amountCents: 2500,
  currency: 'usd',
  method: 'standard',
  arrivalDate: 1785110400,
  createdAt: 1784900000,
  failureCode: null,
  failureMessage: null,
  destinationId: 'ba_1',
  ledgerStatus: 'completed',
  transactionId: 'tx_1',
  bountyId: null,
  description: 'Withdrawal to bank account',
  reconciled: true,
  statusMatchesLedger: true,
};

function mockFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    json: response.json ?? (() => Promise.resolve({})),
  }) as jest.Mock;
}

describe('usePayoutHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
  });

  it('requests payout history from the Stripe-backed endpoint', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ payouts: [PAID], unreconciled: [], hasConnectAccount: true }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/connect/payouts');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('exposes the Stripe payout list', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ payouts: [PAID], unreconciled: [], hasConnectAccount: true }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.payouts).toHaveLength(1);
    expect(result.current.payouts[0].payoutId).toBe('po_paid');
    expect(result.current.payouts[0].status).toBe('paid');
    expect(result.current.hasDrift).toBe(false);
  });

  it('flags drift when Stripe has a payout our ledger does not', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          payouts: [{ ...PAID, reconciled: false, transactionId: null, statusMatchesLedger: null }],
          unreconciled: [],
          hasConnectAccount: true,
        }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasDrift).toBe(true);
  });

  it('flags drift when our ledger status disagrees with Stripe', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          payouts: [{ ...PAID, ledgerStatus: 'pending', statusMatchesLedger: false }],
          unreconciled: [],
          hasConnectAccount: true,
        }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasDrift).toBe(true);
  });

  it('flags drift when a local row references a payout Stripe did not return', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          payouts: [PAID],
          unreconciled: [
            { transactionId: 'tx_orphan', payoutId: 'po_missing', ledgerStatus: 'pending', createdAt: '2026-07-01' },
          ],
          hasConnectAccount: true,
        }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasDrift).toBe(true);
    expect(result.current.unreconciled).toHaveLength(1);
  });

  it('reports no Connect account without erroring', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ payouts: [], unreconciled: [], hasConnectAccount: false }),
    });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasConnectAccount).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error without inventing history', async () => {
    mockFetch({ ok: false });
    const { result } = renderHook(() => usePayoutHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.payouts).toEqual([]);
  });

  it('does not fetch when disabled', () => {
    mockFetch({ ok: true, json: () => Promise.resolve({ payouts: [] }) });
    const { result } = renderHook(() => usePayoutHistory({ enabled: false }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('throttles unforced refreshes but always honours a forced one', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ payouts: [PAID], unreconciled: [], hasConnectAccount: true }),
    });
    const { result } = renderHook(() => usePayoutHistory());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);

    await act(async () => {
      await result.current.refresh({ force: true });
    });
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });
});

describe('payoutStatusLabel', () => {
  it.each([
    ['pending', undefined, 'Payout initiated'],
    ['in_transit', 'standard', 'On its way'],
    ['in_transit', 'instant', 'Sending'],
    ['paid', undefined, 'Payout paid'],
    ['failed', undefined, 'Payout failed'],
    ['canceled', undefined, 'Payout canceled'],
  ])('maps %s (%s) to "%s"', (status, method, expected) => {
    expect(payoutStatusLabel(status, method)).toBe(expected);
  });

  it('passes through an unrecognised status rather than hiding it', () => {
    expect(payoutStatusLabel('some_new_stripe_status')).toBe('some_new_stripe_status');
  });
});
