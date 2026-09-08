// WalletProvider.refundEscrow — who the LOCAL ledger belongs to.
//
// A cancellation refund is triggered by whoever ACCEPTS the cancellation. When
// the poster is the one who requested it, that party is the hunter — and the
// hunter's wallet never held the escrow. refundEscrow used to bail out with
// `false` the moment it could not find a local funded escrow row, which made
// every poster-initiated cancellation fail on the hunter's device even though
// the server had already refunded the poster.
//
// The invariants under test:
//
//   * a missing local escrow row is not a failure — the server owns the refund
//     and locates the escrow itself, so the call still resolves TRUE;
//   * on that device nothing local is written: no balance credit, no refund
//     ledger entry, no transaction rewrite. Crediting there would hand the
//     hunter money the server never moved;
//   * the funder's own device still gets the full local update (escrow marked
//     released, balance credited by the refunded fraction, refund logged);
//   * either way the server call is made, and a server rejection still fails.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockFetchWithTimeout = jest.fn();
const mockGetSecureJSON = jest.fn();
const mockSetSecureJSON = jest.fn().mockResolvedValue(undefined);
const mockGetSession = jest.fn();

jest.mock('lib/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

jest.mock('lib/utils/secure-storage', () => ({
  SecureKeys: {
    WALLET_BALANCE: 'wallet_balance',
    WALLET_TRANSACTIONS: 'wallet_transactions',
    WALLET_LAST_DEPOSIT_TS: 'wallet_last_deposit_ts',
  },
  getSecureJSON: (...args: unknown[]) => mockGetSecureJSON(...args),
  setSecureJSON: (...args: unknown[]) => mockSetSecureJSON(...args),
  migrateSecureStorageKeys: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    channel: jest.fn(() => {
      const ch: Record<string, unknown> = {};
      ch.on = jest.fn(() => ch);
      ch.subscribe = jest.fn(() => ch);
      return ch;
    }),
    removeChannel: jest.fn().mockResolvedValue(undefined),
  },
}));

// Sibling services are only reached by release/deposit paths, never by
// refundEscrow — stubbed so importing the provider does not pull their
// transitive native dependencies in.
jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { releaseBountyPayment: jest.fn() },
}));
jest.mock('lib/services/payment-service', () => ({ paymentService: { releaseEscrow: jest.fn() } }));

import { useWallet, WalletProvider } from '../../lib/wallet-context';

const ESCROW_TX = {
  id: 'tx-escrow-1',
  type: 'escrow',
  amount: -80,
  date: new Date('2026-09-01T00:00:00.000Z').toISOString(),
  escrowStatus: 'funded',
  details: { bounty_id: 'b-1', title: 'Walk my dog' },
};

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Seed what the provider reads out of secure storage on mount. */
const seedStorage = (transactions: unknown[]) => {
  mockGetSecureJSON.mockImplementation(async (key: string) => {
    if (key === 'wallet_balance') return 25;
    if (key === 'wallet_transactions') return transactions;
    return null;
  });
};

const renderWallet = async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );
  const hook = renderHook(() => useWallet(), { wrapper });
  // The mount effect loads storage then syncs from the API; wait for it to
  // settle so the assertions below see only what refundEscrow did.
  await waitFor(() => expect(mockGetSecureJSON).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
};

/** Refund POST calls only, ignoring the mount-time balance sync. */
const refundCalls = () =>
  mockFetchWithTimeout.mock.calls.filter(([url]) => String(url).includes('/wallet/refund'));

// refundEscrow's final step is a silent refreshFromApi, and the server is the
// authoritative source of the balance — so the post-call rendered balance is
// whatever the API returned, not the local credit. The local credit is instead
// asserted through what the provider PERSISTED, which is the write that would
// wrongly hand the hunter money.
const persistedBalances = (): number[] =>
  mockSetSecureJSON.mock.calls
    .filter(([key]) => key === 'wallet_balance')
    .map(([, value]) => value as number);

const persistedTransactions = (): Record<string, unknown>[][] =>
  mockSetSecureJSON.mock.calls
    .filter(([key]) => key === 'wallet_transactions')
    .map(([, value]) => value as Record<string, unknown>[]);

describe('WalletProvider.refundEscrow local ledger ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSecureJSON.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-abc', user: { id: 'u-1' } } },
    });
    mockFetchWithTimeout.mockImplementation(async (url: string) => {
      if (String(url).includes('/wallet/refund')) return jsonResponse({ success: true });
      // Mount-time reconcile. Returning the same balance keeps it a no-op.
      return jsonResponse({ balance: 25, transactions: [] });
    });
  });

  it('still succeeds on a device with no local escrow row', async () => {
    seedStorage([]);
    const { result } = await renderWallet();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.refundEscrow('b-1', 'Walk my dog', 100);
    });

    expect(ok).toBe(true);
    expect(refundCalls()).toHaveLength(1);
  });

  it('writes nothing locally when this wallet did not fund the escrow', async () => {
    seedStorage([]);
    const { result } = await renderWallet();
    mockSetSecureJSON.mockClear();

    await act(async () => {
      await result.current.refundEscrow('b-1', 'Walk my dog', 100);
    });

    // No self-credit: the only balance ever persisted is the server's own
    // value from the reconcile, never a locally-inflated one.
    expect(persistedBalances().every(value => value === 25)).toBe(true);
    // And no fabricated refund entry in this user's ledger.
    expect(result.current.transactions.some(tx => tx.type === 'refund')).toBe(false);
    expect(
      persistedTransactions().some(list => list.some(tx => tx.type === 'refund'))
    ).toBe(false);
  });

  it('credits and rewrites the ledger on the wallet that funded the escrow', async () => {
    seedStorage([ESCROW_TX]);
    const { result } = await renderWallet();
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    mockSetSecureJSON.mockClear();

    await act(async () => {
      await result.current.refundEscrow('b-1', 'Walk my dog', 50);
    });

    // 50% of the $80 escrow, credited on top of the $25 starting balance.
    expect(persistedBalances()).toContain(65);
    // The escrow row is closed out and a refund entry lands in the ledger.
    expect(
      persistedTransactions().some(list =>
        list.some(tx => tx.id === 'tx-escrow-1' && tx.escrowStatus === 'released')
      )
    ).toBe(true);
    expect(result.current.transactions.some(tx => tx.type === 'refund')).toBe(true);
  });

  it('reports failure when the server rejects the refund', async () => {
    seedStorage([]);
    mockFetchWithTimeout.mockImplementation(async (url: string) => {
      if (String(url).includes('/wallet/refund')) {
        return jsonResponse({ error: 'not_bounty_owner' }, { ok: false, status: 403 });
      }
      return jsonResponse({ balance: 25, transactions: [] });
    });
    const { result } = await renderWallet();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.refundEscrow('b-1', 'Walk my dog', 100);
    });

    expect(ok).toBe(false);
    expect(result.current.transactions.some(tx => tx.type === 'refund')).toBe(false);
  });
});
