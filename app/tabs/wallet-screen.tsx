"use client"


import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddMoneyScreen } from "../../components/add-money-screen";
import { ConnectionStatus } from "../../components/connection-status";
import { PaymentMethodsModal } from "../../components/payment-methods-modal";
import { TransactionHistoryScreen } from "../../components/transaction-history-screen";
import { BrandingLogo } from "../../components/ui/branding-logo";
import { EmptyState } from "../../components/ui/empty-state";
import { PayoutFailedBanner } from "../../components/ui/PayoutFailedBanner";
import { PaymentMethodSkeleton } from "../../components/ui/skeleton-loaders";
import { WithdrawWithBankScreen } from "../../components/withdraw-with-bank-screen";
import { useAuthContext } from '../../hooks/use-auth-context';
import { useWalletBalanceDisplay } from '../../hooks/use-wallet-balance-display';
import { useForegroundRefresh } from '../../hooks/useForegroundRefresh';
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility';
import { useHapticFeedback } from '../../lib/haptic-feedback';
import { StripePaymentMethod, stripeService } from '../../lib/services/stripe-service';
import { useStripe } from '../../lib/stripe-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { formatCurrency, formatCurrencyCents } from '../../lib/utils';
import { useWallet, type WalletTransactionRecord } from '../../lib/wallet-context';


interface WalletScreenProps {
  onBack?: () => void
}

// Pure function of its argument — hoisted out of the component so the
// transaction FlatList's renderItem (below) doesn't need to recreate it (and
// isn't forced to list it as a render-time dependency) on every render.
function getTransactionLabel(tx: WalletTransactionRecord): string {
  switch (tx.type) {
    case 'deposit':
      return `Deposit${tx.details.method ? ` via ${tx.details.method}` : ''}`;
    case 'withdrawal':
      return `Withdrawal${tx.details.method ? ` to ${tx.details.method}` : ''}`;
    case 'bounty_posted':
      return `Posted${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'bounty_completed':
      return `Completed${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'bounty_received':
      return `Received${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'escrow':
      return `Escrow${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'release':
      return `Released${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    case 'refund':
      return `Refund${tx.details.title ? ` · ${tx.details.title}` : ''}`;
    default:
      return 'Transaction';
  }
}

// Direction icon glyph per transaction type — hoisted for the same reason as
// getTransactionLabel above.
function getTransactionIconName(tx: WalletTransactionRecord): keyof typeof MaterialIcons.glyphMap {
  switch (tx.type) {
    case 'deposit':
      return 'arrow-downward';
    case 'withdrawal':
      return 'arrow-upward';
    case 'bounty_posted':
      return 'gps-fixed';
    case 'bounty_completed':
      return 'check-circle';
    case 'bounty_received':
      return 'arrow-downward';
    case 'escrow':
      return 'lock';
    case 'release':
      return 'lock-open';
    case 'refund':
      return 'refresh';
    default:
      return 'receipt-long';
  }
}

export function WalletScreen({ onBack }: WalletScreenProps = {}) {
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const { balance, transactions, refreshFromApi, secureStoreAvailable } = useWallet();
  // The one authoritative balance path — see hooks/use-wallet-balance-display.
  // Never read useWallet().balance for display; it is the legacy ledger figure
  // and does not reflect Phase 2 earnings held in the Connect account.
  const balanceDisplay = useWalletBalanceDisplay();
  const { paymentMethods, isLoading: stripeLoading, error: stripeError, loadPaymentMethods } = useStripe();
  const { triggerHaptic } = useHapticFeedback();
  const { session } = useAuthContext();
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [refreshing, setRefreshing] = useState(false);

  const hasValidSession = !!(session?.access_token && session?.user?.id &&
    session.user.id !== '00000000-0000-0000-0000-000000000001');

  const refreshBalance = balanceDisplay.refresh;

  // Refresh wallet data from API when user is authenticated. The transaction
  // list still comes from the wallet ledger; the balance comes from
  // balanceDisplay, which is authoritative and may be Stripe-backed.
  useEffect(() => {
    if (hasValidSession) {
      // Silent so it doesn't flash the balance skeleton, and keyed on the
      // stable access-token string rather than the whole `session` object —
      // the object's identity churns on every token refresh / re-render, which
      // was re-firing this refresh (and the flash) repeatedly.
      refreshFromApi(session!.access_token, { silent: true });
    }
  }, [hasValidSession, session?.access_token, refreshFromApi]);

  // Safety net alongside the realtime balance subscription in WalletProvider:
  // re-sync if the app was backgrounded long enough that a realtime event
  // could plausibly have been missed (e.g. socket dropped while backgrounded).
  //
  // This matters more on the Stripe-backed path: the Realtime subscription
  // watches profiles, which Phase 2 transfers never touch, so it never fires
  // for Connect-held funds. Foreground + focus + pull-to-refresh are the real
  // refresh triggers there.
  useForegroundRefresh(() => {
    if (hasValidSession) {
      refreshFromApi(session!.access_token, { silent: true });
      if (balanceDisplay.source === 'connect') {
        refreshBalance({ force: true });
      }
    }
  });

  const onRefresh = useCallback(async () => {
    if (!hasValidSession) return;
    setRefreshing(true);
    try {
      // Silent: the RefreshControl already shows its own spinner, so we don't
      // also flip the balance skeleton.
      await Promise.all([
        refreshFromApi(session!.access_token, { silent: true }),
        balanceDisplay.source === 'connect'
          ? refreshBalance({ force: true })
          : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [balanceDisplay.source, hasValidSession, session, refreshFromApi, refreshBalance]);

  const handleAddMoney = async (amount: number) => {
    // AddMoneyScreen now handles Stripe integration internally
    setShowAddMoney(false);
    // Refresh wallet after adding money, only if we have a valid session
    const hasValidSession = session?.access_token && session?.user?.id &&
      session.user.id !== '00000000-0000-0000-0000-000000000001';
    if (hasValidSession) {
      refreshFromApi(session.access_token, { silent: true });
    }
  };

  const insets = useSafeAreaInsets();

  const renderEmptyTransactions = useCallback(
    () => (
      <View style={[s.sectionPad, { flex: 1 }]}>
        <View style={{ minHeight: 200 }}>
          <EmptyState
            icon="receipt-long"
            title="No Transactions Yet"
            description="Your transaction history will appear here. Start by posting a bounty or completing work to see your activity."
            actionLabel="Browse Bounties"
            onAction={() => router.push('/tabs/bounty-app')}
            style={{ paddingVertical: 40 }}
          />
        </View>
      </View>
    ),
    [s, router]
  );

  const renderTransactionItem = useCallback(
    ({ item: tx }: { item: WalletTransactionRecord }) => {
      const isPositive = tx.amount > 0;
      const amountColor = isPositive ? theme.success : theme.text;
      const status = tx.details.status?.toLowerCase();
      const statusColor = status === 'failed' ? theme.error : status === 'pending' ? theme.warning : theme.success;

      return (
        <View style={[s.sectionPad, { marginTop: 8 }]}>
          <View style={s.bountyCard}>
            <View style={s.bountyIcon}>
              <MaterialIcons name={getTransactionIconName(tx)} size={20} color={theme.text} />
            </View>
            <View style={s.bountyBody}>
              <View style={s.bountyTopRow}>
                <Text style={s.bountyName} numberOfLines={1} ellipsizeMode="tail">
                  {getTransactionLabel(tx)}
                </Text>
                <Text style={[s.bountyAmount, { color: amountColor }]} numberOfLines={1}>
                  {isPositive ? '+' : '-'}
                  {formatCurrency(Math.abs(tx.amount))}
                </Text>
              </View>
              <View style={s.bountyBottomRow}>
                <Text style={s.bountyDate}>{format(tx.date, 'MMM d · h:mm a')}</Text>
                {status && (
                  <View style={s.bountyStatusRow}>
                    <View style={[s.bountyStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.bountyStatusText, { color: statusColor }]}>{tx.details.status}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      );
    },
    [s, theme]
  );

  if (showWithdraw) {
    return <WithdrawWithBankScreen onBack={() => setShowWithdraw(false)} balance={balance} />;
  }
  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={handleAddMoney} />;
  }
  if (showTransactionHistory) {
    return <TransactionHistoryScreen onBack={() => setShowTransactionHistory(false)} />;
  }




  return (
    <>
      {/* Connection Status Banner - appears at top when offline */}
      <ConnectionStatus showQueueCount={true} />
      {/* Payout Failed Banner - shown when most recent payout failed */}
      <PayoutFailedBanner />
      <FlatList<WalletTransactionRecord>
        style={s.container}
        data={transactions}
        keyExtractor={(tx: WalletTransactionRecord) => tx.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 18 }}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={5}
        initialNumToRender={3}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
        ListHeaderComponent={() => (
          <>
            {/* Header */}
            <View style={s.header}>
              <View style={s.headerTitleRow}>
                <BrandingLogo size="medium" />
              </View>
            </View>

            {/* Balance Card */}
            <View style={s.sectionPad}>
              {/* Warning if secure storage for sensitive keys is unavailable */}
              {!secureStoreAvailable && (
                <View style={{ backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, marginBottom: 10 }}>
                  <Text style={{ color: '#92400E', fontWeight: '600' }}>Security Notice</Text>
                  <Text style={{ color: '#92400E' }}>
                    Your device does not support secure storage. Sensitive wallet data is not being stored encrypted. Please use a managed build or sign out and back in on a supported device.
                  </Text>
                </View>
              )}
              <View style={s.balanceCard}>
                <View style={s.balanceCardHeader}>
                  <Text style={s.balanceLabel}>
                    {balanceDisplay.source === 'connect' ? 'AVAILABLE BALANCE' : 'BALANCE'}
                  </Text>
                  {balanceDisplay.isLoading ? (
                    <View style={s.balanceSkeleton} />
                  ) : (
                    <Text
                      style={[s.balanceAmount, balanceDisplay.isStale && s.balanceAmountStale]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {formatCurrencyCents(balanceDisplay.amountCents, balanceDisplay.currency)}
                    </Text>
                  )}

                  {/* Funds Stripe is still clearing. Shown so a hunter who was
                      just paid understands why the number is lower than the
                      bounty they completed, rather than assuming money is missing. */}
                  {!balanceDisplay.isLoading &&
                    !balanceDisplay.error &&
                    balanceDisplay.pendingCents > 0 && (
                      <Text style={s.balancePending}>
                        {formatCurrencyCents(balanceDisplay.pendingCents, balanceDisplay.currency)} clearing
                      </Text>
                    )}

                  {/* Stripe read failed. Never silently substitute a locally
                      derived figure — say the number may be out of date and
                      offer a retry. */}
                  {!!balanceDisplay.error && (
                    <View style={s.balanceErrorRow}>
                      <Text style={s.balanceErrorText} numberOfLines={2}>
                        {balanceDisplay.isStale
                          ? 'Balance may be out of date.'
                          : balanceDisplay.error}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic('light');
                          balanceDisplay.refresh({ force: true });
                        }}
                        disabled={balanceDisplay.isRefreshing}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading balance"
                      >
                        <Text style={s.balanceRetryText}>
                          {balanceDisplay.isRefreshing ? 'Retrying…' : 'Retry'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Connect onboarding not finished: an honest CTA beats a
                      $0 that reads like the money vanished. */}
                  {!balanceDisplay.isLoading &&
                    !balanceDisplay.error &&
                    !balanceDisplay.hasConnectAccount && (
                      <Text style={s.balanceErrorText}>
                        Finish setting up payouts to receive and withdraw earnings.
                      </Text>
                    )}
                </View>
                <View style={s.balanceActionsRow}>
                  <TouchableOpacity
                    style={s.actionButton}
                    onPress={() => {
                      triggerHaptic('medium');
                      setShowAddMoney(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Add money to wallet"
                    accessibilityHint="Add funds to your wallet using a payment method"
                  >
                    <MaterialIcons name="add" size={20} color="#ffffff" accessibilityElementsHidden={true} />
                    <Text style={s.actionButtonText}>Add Money</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actionButton}
                    onPress={() => {
                      triggerHaptic('medium');
                      setShowWithdraw(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Withdraw money from wallet"
                    accessibilityHint="Transfer funds from your wallet to your bank account"
                  >
                    <MaterialIcons name="keyboard-arrow-down" size={20} color="#ffffff" accessibilityElementsHidden={true} />
                    <Text style={s.actionButtonText}>Withdraw</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>


            {/* Linked Accounts Section */}
            <View style={s.sectionPad}>
              <View style={s.sectionHeaderRow}>
                <Text style={s.sectionTitle}>Linked Accounts</Text>
                <TouchableOpacity
                  onPress={() => setShowPaymentMethods(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Manage payment methods"
                  accessibilityHint="Add, remove, or update payment methods"
                >
                  <Text style={s.sectionManage}>Manage</Text>
                </TouchableOpacity>
              </View>

              {/* Render payment methods without a nested VirtualizedList to avoid scrolling conflicts */}
              {stripeLoading ? (
                <View style={{ paddingVertical: SPACING.COMPACT_GAP }}>
                  <PaymentMethodSkeleton />
                  <PaymentMethodSkeleton />
                </View>
              ) : stripeError ? (
                <View
                  style={s.accountCard}
                  accessible={true}
                  accessibilityRole="alert"
                  accessibilityLabel="Unable to load payment methods. Service may be temporarily unavailable."
                >
                  <View style={[s.accountIcon, { backgroundColor: '#ef4444' }]}>
                    <MaterialIcons name="cloud-off" size={24} color="#ffffff" accessibilityElementsHidden={true} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.accountName}>Unable to Load Payment Methods</Text>
                    <Text style={s.accountSub}>Service temporarily unavailable</Text>
                  </View>
                  <TouchableOpacity
                    onPress={loadPaymentMethods}
                    style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading payment methods"
                    accessibilityHint="Double tap to reload payment methods"
                  >
                    <MaterialIcons name="refresh" size={20} color="#ffffff" accessibilityElementsHidden={true} />
                  </TouchableOpacity>
                </View>
              ) : paymentMethods.length === 0 ? (
                <TouchableOpacity
                  style={s.accountCard}
                  onPress={() => setShowPaymentMethods(true)}
                >
                  <View style={s.accountIcon}>
                    <MaterialIcons name="add" size={24} color="#ffffff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.accountName}>Add Payment Method</Text>
                    <Text style={s.accountSub}>No payment methods added yet</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={{ paddingBottom: SPACING.COMPACT_GAP }}>
                  {paymentMethods.map((method: StripePaymentMethod, index: number) => (
                    <View key={method.id} style={s.accountCard}>
                      <View style={s.accountIcon}>
                        <MaterialIcons name="credit-card" size={24} color="#ffffff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.accountName}>
                          {stripeService.formatCardDisplay(method)}
                        </Text>
                        <Text style={s.accountSub}>
                          {index === 0 ? 'Default Payment Method' : `Added ${new Date(method.created * 1000).toLocaleDateString()}`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Transaction History header (moved into header so it renders once) */}
            <View style={[s.sectionPad, { marginTop: 8 }]}>
              <View style={s.sectionHeaderRow}>
                <Text style={s.sectionTitle}>Transaction History</Text>
                <TouchableOpacity onPress={() => setShowTransactionHistory(true)}>
                  <Text style={s.sectionManage}>View All</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
        ListEmptyComponent={renderEmptyTransactions}
        renderItem={renderTransactionItem}
      />

      {/* Modals should be rendered outside the main ScrollView to avoid nesting VirtualizedLists */}
      <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
    </>
  );

}

export default WalletScreen;

function makeStyles(t: AppTheme) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 20,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    backgroundColor: t.background,
    gap: SPACING.COMPACT_GAP,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
    transform: [
      { translateY: -2 },
      { translateX: -2 },
    ],
  },
  headerTitle: {
    color: t.text,
    fontSize: HEADER_LAYOUT.titleFontSize,
    fontWeight: 'bold',
    letterSpacing: TYPOGRAPHY.LETTER_SPACING_WIDE,
  },
  backButton: {
    padding: SPACING.COMPACT_GAP,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionPad: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    marginBottom: SPACING.SECTION_GAP,
  },
  balanceCard: {
    backgroundColor: t.surface,
    borderRadius: SPACING.SCREEN_HORIZONTAL,
    padding: SPACING.CARD_PADDING,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    marginBottom: SPACING.COMPACT_GAP,
  },
  balanceCardHeader: {
    alignItems: 'center',
    marginBottom: SPACING.SCREEN_HORIZONTAL,
  },
  balanceLabel: {
    color: t.primaryLight,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  balanceAmount: {
    color: t.text,
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 4,
  },
  balanceSkeleton: {
    width: 120,
    height: 32,
    borderRadius: 6,
    marginTop: 4,
    backgroundColor: t.border ?? 'rgba(255,255,255,0.12)',
  },
  // Dimmed while the figure on screen is unconfirmed by the latest fetch, so
  // a stale number never reads as a freshly verified one.
  balanceAmountStale: {
    opacity: 0.55,
  },
  balancePending: {
    color: t.textSecondary,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    marginTop: 2,
  },
  balanceErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.COMPACT_GAP,
    marginTop: 4,
  },
  balanceErrorText: {
    color: t.textSecondary,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    marginTop: 4,
    textAlign: 'center',
  },
  balanceRetryText: {
    color: t.primary,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '700',
  },
  balanceActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.ELEMENT_GAP,
    gap: SPACING.COMPACT_GAP,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderRadius: 10,
    paddingVertical: SPACING.ELEMENT_GAP,
    paddingHorizontal: 18,
    flex: 1,
    justifyContent: 'center',
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    gap: SPACING.COMPACT_GAP,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.COMPACT_GAP,
  },
  sectionTitle: {
    color: t.textSecondary,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  sectionManage: {
    color: t.primaryLight,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: 'bold',
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: SPACING.ELEMENT_GAP,
    padding: SPACING.SCREEN_HORIZONTAL,
    marginBottom: SPACING.COMPACT_GAP,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
  },
  accountIcon: {
    height: SIZING.AVATAR_MEDIUM,
    width: SIZING.AVATAR_MEDIUM,
    backgroundColor: t.surfaceSecondary,
    borderRadius: SPACING.COMPACT_GAP,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.ELEMENT_GAP,
  },
  accountName: {
    color: t.text,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  accountSub: {
    color: t.textSecondary,
    fontSize: TYPOGRAPHY.SIZE_SMALL - 1,
  },
  bountyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: SPACING.ELEMENT_GAP,
    padding: SPACING.SCREEN_HORIZONTAL,
    marginBottom: SPACING.COMPACT_GAP,
    borderWidth: 1,
    borderColor: t.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  bountyIcon: {
    height: SIZING.AVATAR_MEDIUM,
    width: SIZING.AVATAR_MEDIUM,
    borderRadius: SIZING.AVATAR_MEDIUM / 2,
    backgroundColor: t.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.ELEMENT_GAP,
    flexShrink: 0,
  },
  bountyBody: {
    flex: 1,
    minWidth: 0,
  },
  bountyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bountyBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  bountyName: {
    color: t.text,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
    flex: 1,
    marginRight: 10,
  },
  bountyAmount: {
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  bountyDate: {
    color: t.textSecondary,
    fontSize: TYPOGRAPHY.SIZE_SMALL - 1,
  },
  bountyStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  bountyStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bountyStatusText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL - 1,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  emptyState: {
    paddingVertical: SPACING.SECTION_GAP,
    alignItems: 'center',
  },
  emptyStateText: {
    color: t.primaryLight,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    opacity: 0.9,
  },
  // bottom nav indicator removed; using shared BottomNav at app level
}); }
