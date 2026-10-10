// WalletProvider.refreshFromApi — `coalesce` joins an in-flight refresh.
//
// Cold start fired GET /wallet/balance and /wallet/transactions twice ~100ms
// apart (mount sync + TOKEN_REFRESHED listener). Startup triggers now pass
// `coalesce` so the second joins the first. The invariants under test:
//
//   * coalesce callers with the same token share one request;
//   * callers that do not opt in always get their own request — post-write
//     refreshes must never be handed a read that started before the write;
//   * a different token never joins, so one account can't receive another's;
//   * `force` never joins (it exists for "the server just moved money").

import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockFetchWithTimeout = jest.fn();
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
  getSecureJSON: jest.fn().mockResolvedValue(null),
  setSecureJSON: jest.fn().mockResolvedValue(undefined),
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

jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { releaseBountyPayment: jest.fn() },
}));
jest.mock('lib/services/payment-service', () => ({ paymentService: { releaseEscrow: jest.fn() } }));

import { useWallet, WalletProvider } from '../../lib/wallet-context';

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
});

// Balance requests stay pending until released, so overlapping calls overlap.
// overlap() drains this after every use, so each call releases only the
// requests it started itself.
let pendingBalanceReleases: Array<() => void> = [];

const balanceCalls = () =>
  mockFetchWithTimeout.mock.calls.filter(([url]) => String(url).includes('/wallet/balance'));

const renderWallet = async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );
  const hook = renderHook(() => useWallet(), { wrapper });
  // No session on mount, so the mount sync makes no request of its own.
  await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
};

/** Start two refreshes back to back, then let every request finish. */
const overlap = async (
  first: () => Promise<void>,
  second: () => Promise<void>
): Promise<void> => {
  await act(async () => {
    const a = first();
    const b = second();
    await Promise.resolve();
    const releases = pendingBalanceReleases;
    pendingBalanceReleases = [];
    releases.forEach(release => release());
    await Promise.all([a, b]);
  });
};

describe('WalletProvider.refreshFromApi coalescing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pendingBalanceReleases = [];
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockFetchWithTimeout.mockImplementation((url: string) => {
      if (String(url).includes('/wallet/balance')) {
        return new Promise(resolve => {
          pendingBalanceReleases.push(() => resolve(jsonResponse({ balance: 10 })));
        });
      }
      return Promise.resolve(jsonResponse({ transactions: [] }));
    });
  });

  it('shares one request between coalescing callers with the same token', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => result.current.refreshFromApi('tok-1', { silent: true, coalesce: true })
    );

    expect(balanceCalls()).toHaveLength(1);
  });

  it('joins a non-coalescing request that is already in flight', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { silent: true }),
      () => result.current.refreshFromApi('tok-1', { silent: true, coalesce: true })
    );

    expect(balanceCalls()).toHaveLength(1);
  });

  it('gives a caller that did not opt in its own request', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => result.current.refreshFromApi('tok-1', { silent: true })
    );

    expect(balanceCalls()).toHaveLength(2);
  });

  it('never joins a request made with a different token', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => result.current.refreshFromApi('tok-2', { coalesce: true })
    );

    expect(balanceCalls()).toHaveLength(2);
  });

  it('never joins when force is set', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => result.current.refreshFromApi('tok-1', { silent: true, force: true, coalesce: true })
    );

    expect(balanceCalls()).toHaveLength(2);
  });

  it('never joins an in-flight request that was started with force', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { silent: true, force: true }),
      () => result.current.refreshFromApi('tok-1', { silent: true, coalesce: true })
    );

    expect(balanceCalls()).toHaveLength(2);
  });

  it('starts a fresh request once the previous one has settled', async () => {
    const { result } = await renderWallet();

    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => Promise.resolve()
    );
    await overlap(
      () => result.current.refreshFromApi('tok-1', { coalesce: true }),
      () => Promise.resolve()
    );

    expect(balanceCalls()).toHaveLength(2);
  });
});
