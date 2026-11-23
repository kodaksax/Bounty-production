// WalletProvider's realtime profiles subscription only refetches the balance
// when the balance actually changed.
//
// profiles uses the default replica identity, so an UPDATE's `old` record
// carries only the primary key. The guard used to compare new.balance against
// old.balance (always undefined), so every profile write — session tracking,
// location, onboarding flags — triggered a /wallet/balance request. It now
// compares against the balance the app already holds, in whole cents, because
// Realtime may deliver numeric(…,2) as a string.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockFetchWithTimeout = jest.fn();
const mockGetSession = jest.fn();
const mockProfileHandlers: ((payload: any) => void)[] = [];

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
      ch.on = jest.fn((_type: string, config: any, handler: any) => {
        if (config?.table === 'profiles') mockProfileHandlers.push(handler);
        return ch;
      });
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

const balanceCalls = () =>
  mockFetchWithTimeout.mock.calls.filter(([url]) => String(url).includes('/wallet/balance'));

const emitProfileUpdate = async (newRow: Record<string, unknown>) => {
  await act(async () => {
    // Default replica identity: `old` carries only the primary key.
    mockProfileHandlers.forEach(h => h({ new: { id: 'user-1', ...newRow }, old: { id: 'user-1' } }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('WalletProvider realtime balance guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileHandlers.length = 0;
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-1', user: { id: 'user-1' } } },
    });
    mockFetchWithTimeout.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/wallet/balance')
          ? jsonResponse({ balance: 10 })
          : jsonResponse({ transactions: [] })
      )
    );
  });

  const renderWallet = async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletProvider>{children}</WalletProvider>
    );
    const hook = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(mockProfileHandlers.length).toBeGreaterThan(0));
    await waitFor(() => expect(hook.result.current.balance).toBe(10));
    return hook;
  };

  it('ignores a profile write that leaves the balance unchanged', async () => {
    await renderWallet();
    const before = balanceCalls().length;

    // As Realtime may send numeric: a string, same value in cents.
    await emitProfileUpdate({ balance: '10.00', last_session_at: '2026-11-21T12:00:00Z' });
    await emitProfileUpdate({ balance: 10, latitude: 39.29 });

    expect(balanceCalls()).toHaveLength(before);
  });

  it('refetches when the balance changed', async () => {
    await renderWallet();
    const before = balanceCalls().length;

    await emitProfileUpdate({ balance: '12.50' });

    await waitFor(() => expect(balanceCalls().length).toBe(before + 1));
  });

  it('refetches when the payload has no usable balance', async () => {
    await renderWallet();
    const before = balanceCalls().length;

    await emitProfileUpdate({ last_session_at: '2026-11-21T12:00:00Z' });

    await waitFor(() => expect(balanceCalls().length).toBe(before + 1));
  });
});
