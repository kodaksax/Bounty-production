/**
 * THE single authoritative source for the balance figure rendered anywhere in
 * the app.
 *
 * Before this hook existed the displayed balance could be written from ~10
 * different places (optimistic deposit/withdraw updates, escrow and release
 * responses, a SecureStore cache, a public setBalance setter, a Realtime
 * subscription — see docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md §2.2),
 * which is what allowed the displayed number to drift from the money the user
 * could actually withdraw. Every balance display must now go through here.
 *
 * Which underlying source is used is decided by config.features.walletBalanceSource:
 *
 *   'connect' — the live Stripe Connect account balance. Authoritative under
 *               the Phase 2 architecture, where bounty releases Transfer money
 *               straight into the connected account and never touch
 *               profiles.balance.
 *   'ledger'  — the legacy custodial figure from profiles.balance. Retained
 *               only as the rollback path and for draining legacy balances.
 *
 * The two are never summed or blended: they describe different pots of money,
 * and adding them would overstate what the user can withdraw.
 *
 * All amounts are exposed in cents, matching Stripe. Render with
 * formatCurrencyCents().
 */
import { useCallback, useMemo } from 'react';
import { config } from '../lib/config';
import { useWallet } from '../lib/wallet-context';
import { useAuthContext } from './use-auth-context';
import { useConnectBalance } from './use-connect-balance';

export type WalletBalanceSource = 'connect' | 'ledger';

export interface WalletBalanceDisplay {
  /** The primary figure to show as the user's balance, in cents. */
  amountCents: number;
  /** Funds still clearing at Stripe, not yet withdrawable. Cents. Always 0 on the ledger path. */
  pendingCents: number;
  /** Withdrawable instantly, net of the instant-payout fee. Cents. Always 0 on the ledger path. */
  instantAvailableCents: number;
  currency: string;
  source: WalletBalanceSource;
  /** False when the user has not onboarded to Connect — render a CTA, not $0. Always true on the ledger path. */
  hasConnectAccount: boolean;
  payoutsEnabled: boolean;
  /** First load, nothing to show yet — render a skeleton. */
  isLoading: boolean;
  /** Re-fetching with a previous value still on screen — keep it visible. */
  isRefreshing: boolean;
  error: string | null;
  /**
   * True when the figure on screen is a previous value that the most recent
   * fetch failed to confirm. Label it rather than presenting it as live.
   */
  isStale: boolean;
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

/** profiles.balance is stored in dollars; Stripe and this hook speak cents. */
const dollarsToCents = (dollars: number): number =>
  Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;

export function useWalletBalanceDisplay(): WalletBalanceDisplay {
  const source: WalletBalanceSource =
    config.features.walletBalanceSource === 'connect' ? 'connect' : 'ledger';

  const { session } = useAuthContext();
  const wallet = useWallet();
  const connect = useConnectBalance({ enabled: source === 'connect' });

  const refreshLedger = useCallback(
    async () => {
      const token = session?.access_token;
      if (!token) return;
      await wallet.refreshFromApi(token);
    },
    [session?.access_token, wallet]
  );

  return useMemo(() => {
    if (source === 'connect') {
      return {
        amountCents: connect.available,
        pendingCents: connect.pending,
        instantAvailableCents: connect.instantAvailable,
        currency: connect.currency,
        source,
        hasConnectAccount: connect.hasConnectAccount,
        payoutsEnabled: connect.payoutsEnabled,
        isLoading: connect.isLoading,
        isRefreshing: connect.isRefreshing,
        error: connect.error,
        // A previous value is on screen but the latest fetch failed to confirm it.
        isStale: !!connect.error && connect.lastUpdated !== null,
        refresh: connect.refresh,
      };
    }

    return {
      amountCents: dollarsToCents(wallet.balance),
      pendingCents: 0,
      instantAvailableCents: 0,
      currency: 'usd',
      source,
      // The legacy path has no notion of Connect onboarding; report true so
      // callers don't render an onboarding CTA over a working ledger balance.
      hasConnectAccount: true,
      payoutsEnabled: true,
      isLoading: wallet.isLoading,
      isRefreshing: false,
      error: null,
      isStale: false,
      refresh: refreshLedger,
    };
  }, [source, connect, wallet.balance, wallet.isLoading, refreshLedger]);
}
