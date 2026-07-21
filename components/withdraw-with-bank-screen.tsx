import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../hooks/use-auth-context';
import { useConnectEligibility } from '../hooks/use-connect-eligibility';
import { useEmailVerification } from '../hooks/use-email-verification';
import { usePayoutMethods } from '../hooks/use-payout-methods';
import { API_BASE_URL } from '../lib/config/api';
import { analyticsService } from '../lib/services/analytics-service';
import { formatCurrency } from '../lib/utils';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { useWallet } from '../lib/wallet-context';
import { AddBankAccountModal } from './add-bank-account-modal';
import { AddDebitCardModal } from './add-debit-card-modal';
import { InstantCashOutScreen } from './instant-cash-out-screen';
import { PayoutMethodsScreen } from './payout-methods-screen';
import { EmailVerificationBanner } from './ui/email-verification-banner';
import { WithdrawalConfirmSheet } from './ui/withdrawal-confirm-sheet';
import { WithdrawalResultScreen, type WithdrawalResultStatus } from './ui/withdrawal-result-screen';
import { WithdrawMethodSelect } from './withdraw-method-select';

interface WithdrawWithBankScreenProps {
  onBack?: () => void;
  balance?: number;
}

interface WithdrawalResultData {
  status: WithdrawalResultStatus;
  transferId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network/i.test(error.message));
}

// Height of the bottom tab bar + gap, so the sticky Withdraw button sits
// fully above it (same convention as postings-screen.tsx and the
// CreateBounty Step*.tsx screens).
const BOTTOM_NAV_OFFSET = 60;

export function WithdrawWithBankScreen({
  onBack,
  balance: propBalance,
}: WithdrawWithBankScreenProps) {
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [showAddBankAccount, setShowAddBankAccount] = useState(false);
  const [showInstantCashOut, setShowInstantCashOut] = useState(false);
  const [showPayoutMethods, setShowPayoutMethods] = useState(false);
  const [showAddDebitCard, setShowAddDebitCard] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [submittedAmount, setSubmittedAmount] = useState(0);
  const [submittedDestinationLabel, setSubmittedDestinationLabel] = useState('');
  const [withdrawalResult, setWithdrawalResult] = useState<WithdrawalResultData | null>(null);

  const { balance: walletBalance, refreshFromApi, transactions } = useWallet();
  const { session } = useAuthContext();
  const { isEmailVerified, canWithdrawFunds, userEmail } = useEmailVerification();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const balance = propBalance ?? walletBalance;

  const eligibility = useConnectEligibility();
  const payoutMethods = usePayoutMethods();
  const {
    bankAccounts,
    minWithdrawal,
    maxWithdrawal,
    availableBalance: serverAvailableBalance,
    hasInstantEligibleCard,
    isLoading: isLoadingAccounts,
  } = payoutMethods;
  const hasConnectedAccount = eligibility.isFullyOnboarded;

  // Auto-select the default bank account (or the first one) whenever the
  // shared bank-account list changes — mirrors the old loadBankAccounts()
  // auto-select behavior.
  useEffect(() => {
    if (selectedBankAccount && bankAccounts.some(a => a.id === selectedBankAccount)) return;
    const defaultAccount = bankAccounts.find(a => a.default);
    if (defaultAccount) {
      setSelectedBankAccount(defaultAccount.id);
    } else if (bankAccounts.length > 0) {
      setSelectedBankAccount(bankAccounts[0].id);
    }
  }, [bankAccounts, selectedBankAccount]);

  // Tracks whether we need to refresh Connect status when this screen
  // regains focus (i.e. the user returns from the embedded onboarding screen).
  const needsRefreshOnFocusRef = useRef(false);

  // Stable idempotency key for this withdrawal attempt.  Generated once on
  // mount so that retries (e.g. network failure) reuse the same key, letting
  // the server return the cached Stripe response instead of creating a
  // duplicate transfer.  Regenerated to a fresh value after a successful
  // withdrawal so the next withdrawal gets its own unique key.
  const idempotencyKeyRef = useRef(`withdraw_${session?.user?.id ?? 'u'}_${Date.now()}`);

  const parsedAmount = parseFloat(withdrawalAmount);
  const isWithdrawDisabled =
    !hasConnectedAccount ||
    !withdrawalAmount ||
    isNaN(parsedAmount) ||
    parsedAmount <= 0 ||
    (maxWithdrawal != null && parsedAmount > maxWithdrawal) ||
    bankAccounts.length === 0 ||
    !selectedBankAccount;

  // Refresh Connect status and payout methods when returning from the
  // embedded onboarding screen, then clear the loading indicator.
  useFocusEffect(
    useCallback(() => {
      if (needsRefreshOnFocusRef.current) {
        needsRefreshOnFocusRef.current = false;
        (async () => {
          try {
            await eligibility.refresh();
            await payoutMethods.refresh();
          } finally {
            setIsOnboarding(false);
          }
        })();
      }
    }, [eligibility.refresh, payoutMethods.refresh])
  );

  // Withdrawal history, segmented by status — sourced from the same
  // transactions list the Wallet tab already loads (GET /wallet/transactions
  // via useWallet().refreshFromApi()), not a separate fetch.
  const withdrawalHistory = useMemo(
    () => transactions.filter(tx => tx.type === 'withdrawal'),
    [transactions]
  );
  const statusOf = (tx: (typeof withdrawalHistory)[number]) =>
    (tx.details?.status ?? '').toLowerCase();
  const pendingWithdrawals = useMemo(
    () => withdrawalHistory.filter(tx => statusOf(tx) === 'pending'),
    [withdrawalHistory]
  );
  const failedWithdrawals = useMemo(
    () => withdrawalHistory.filter(tx => statusOf(tx) === 'failed'),
    [withdrawalHistory]
  );
  const completedWithdrawals = useMemo(
    () => withdrawalHistory.filter(tx => statusOf(tx) === 'completed').slice(0, 5),
    [withdrawalHistory]
  );

  const router = useRouter();

  const handleConnectOnboarding = () => {
    // Use the in-app embedded onboarding route so users never leave the app.
    // The embedded screen handles errors itself (including the platform-level
    // "not signed up for Connect" error) and refreshes status on exit.
    try {
      setIsOnboarding(true);
      needsRefreshOnFocusRef.current = true;
      router.push('/wallet/connect/embedded-onboarding');
      // Status refresh and isOnboarding reset are handled by useFocusEffect
      // when this screen regains focus after the user returns.
    } catch (error: unknown) {
      console.error('[withdraw-with-bank] Failed to open embedded onboarding', error);
      needsRefreshOnFocusRef.current = false;
      Alert.alert(
        'Onboarding Failed',
        error instanceof Error
          ? error.message
          : 'Unable to start Connect onboarding. Please try again.',
        [{ text: 'OK' }]
      );
      setIsOnboarding(false);
    }
  };

  const handleMaxWithdrawal = () => {
    setWithdrawalAmount(
      (maxWithdrawal != null ? Math.min(balance, maxWithdrawal) : balance).toFixed(2)
    );
  };

  const handleWithdraw = async () => {
    // Email verification gate
    if (!canWithdrawFunds) {
      Alert.alert(
        'Email Verification Required',
        'Please verify your email address before withdrawing funds.',
        [{ text: 'OK' }]
      );
      return;
    }

    const amount = parseFloat(withdrawalAmount);

    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
      return;
    }

    if (amount < minWithdrawal) {
      Alert.alert('Minimum Withdrawal', `The minimum withdrawal amount is ${formatCurrency(minWithdrawal)}.`);
      return;
    }

    if (maxWithdrawal != null && amount > maxWithdrawal) {
      Alert.alert('Maximum Withdrawal', `The maximum withdrawal amount is ${formatCurrency(maxWithdrawal)} per transaction.`);
      return;
    }

    const availableForWithdrawal = serverAvailableBalance ?? balance;
    if (amount > availableForWithdrawal) {
      Alert.alert('Insufficient Balance', 'You cannot withdraw more than your available balance.');
      return;
    }

    // Check Connect account
    if (!hasConnectedAccount) {
      Alert.alert(
        'Setup Required',
        'To withdraw funds, you need to complete Stripe Connect onboarding first.',
        [
          { text: 'Complete Onboarding', onPress: handleConnectOnboarding },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    // Check bank account selection
    if (bankAccounts.length === 0) {
      Alert.alert('Bank Account Required', 'Please add a bank account to receive withdrawals.', [
        { text: 'Add Bank Account', onPress: () => setShowAddBankAccount(true) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    if (!selectedBankAccount) {
      Alert.alert('Select Bank Account', 'Please select a bank account for withdrawal.');
      return;
    }

    const selectedAccount = bankAccounts.find((account) => account.id === selectedBankAccount);
    const destination = selectedAccount?.bankName
      ? `${selectedAccount.bankName} account ending in ${selectedAccount.last4}`
      : `account ending in ${selectedAccount?.last4 ?? '****'}`;

    setSubmittedAmount(amount);
    setSubmittedDestinationLabel(destination);
    setShowConfirmSheet(true);
  };

  const performWithdraw = async (amount: number) => {
    setWithdrawalResult({ status: 'processing' });

    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      const idempotencyKey = idempotencyKeyRef.current;

      // Funnel: payout initiated. Tracked before the network call so we can
      // also measure failure/abandonment rates.
      try {
        await analyticsService.trackEvent('payout_initiated', {
          amount,
          currency: 'usd',
          method: 'stripe_connect_bank',
        });
      } catch {
        /* analytics is best-effort */
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/connect/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            amount,
            currency: 'usd',
            idempotencyKey,
            // The server makes this account the actual Stripe payout
            // destination (promoting it to default_for_currency if it
            // isn't already) before creating the transfer — see
            // resolveWithdrawalDestination() in supabase/functions/connect.
            bankAccountId: selectedBankAccount,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const requestError = new Error(errorData.error || 'Failed to initiate transfer') as Error & {
          code?: string;
        };
        requestError.code = errorData.code;
        throw requestError;
      }

      const { transferId } = await response.json();

      // Refresh wallet balance from the server -- the withdrawal itself was a
      // direct fetch() to /connect/transfer, not a wallet-context mutation, so
      // the local SecureStore-cached balance was never updated. `refresh()`
      // only re-reads that stale local cache; refreshFromApi() is the one
      // that actually re-fetches the post-withdrawal balance.
      await refreshFromApi(session?.access_token);
      await payoutMethods.refresh();

      // Rotate the idempotency key so the next withdrawal gets a fresh key.
      idempotencyKeyRef.current = `withdraw_${session?.user?.id ?? 'u'}_${Date.now()}`;

      // Funnel: Stripe accepted the transfer. Final bank settlement is async.
      try {
        await analyticsService.trackEvent('payout_success', {
          amount,
          currency: 'usd',
          method: 'stripe_connect_bank',
          transferId: transferId ? String(transferId) : undefined,
        });
      } catch {
        /* analytics is best-effort */
      }

      setWithdrawalResult({ status: 'success', transferId: transferId ?? null });
    } catch (error: any) {
      console.error('Withdrawal error:', error);
      try {
        await analyticsService.trackEvent('payout_failed', {
          amount,
          currency: 'usd',
          method: 'stripe_connect_bank',
          reason: error?.message ? String(error.message).slice(0, 200) : 'unknown',
        });
      } catch {
        /* analytics is best-effort */
      }
      if (error?.name === 'AbortError') {
        setWithdrawalResult({
          status: 'failure',
          errorMessage: 'The request took too long to complete. Please check your connection and try again.',
        });
      } else if (isNetworkError(error)) {
        setWithdrawalResult({
          status: 'failure',
          errorMessage: 'Could not reach the server. Please check your connection and try again.',
        });
      } else {
        setWithdrawalResult({
          status: 'failure',
          errorCode: error?.code,
          errorMessage: error?.message || 'Failed to process withdrawal. Please try again.',
        });
      }
    }
  };

  const handleAddBankAccount = () => {
    setShowAddBankAccount(true);
  };

  const handleBankAccountAdded = async () => {
    setShowAddBankAccount(false);
    await payoutMethods.refresh();
  };

  const handleRemoveBankAccount = async (bankAccountId: string) => {
    Alert.alert('Remove Bank Account', 'Are you sure you want to remove this bank account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const result = await payoutMethods.removeBankAccount(bankAccountId);
          if (result.ok) {
            Alert.alert('Success', 'Bank account removed successfully');
          } else {
            Alert.alert('Error', result.error);
          }
        },
      },
    ]);
  };

  if (showAddBankAccount) {
    return (
      <AddBankAccountModal
        onBack={() => setShowAddBankAccount(false)}
        onSave={handleBankAccountAdded}
      />
    );
  }

  if (showAddDebitCard) {
    return (
      <AddDebitCardModal
        onBack={() => setShowAddDebitCard(false)}
        onSave={async () => {
          setShowAddDebitCard(false);
          await payoutMethods.refresh();
        }}
      />
    );
  }

  if (showInstantCashOut) {
    return (
      <InstantCashOutScreen
        balance={balance}
        onBack={() => setShowInstantCashOut(false)}
        onComplete={() => payoutMethods.refresh()}
        eligibility={eligibility}
        payoutMethods={payoutMethods}
      />
    );
  }

  if (showPayoutMethods) {
    return (
      <PayoutMethodsScreen
        onBack={() => {
          setShowPayoutMethods(false);
          eligibility.refresh();
        }}
        payoutMethods={payoutMethods}
        eligibility={eligibility}
      />
    );
  }

  if (withdrawalResult) {
    return (
      <WithdrawalResultScreen
        status={withdrawalResult.status}
        method="standard"
        amount={submittedAmount}
        destinationLabel={submittedDestinationLabel}
        estimatedArrival="1-3 business days"
        transferId={withdrawalResult.transferId}
        errorCode={withdrawalResult.errorCode}
        errorMessage={withdrawalResult.errorMessage}
        onDismiss={() => {
          const wasSuccess = withdrawalResult.status === 'success';
          setWithdrawalResult(null);
          if (wasSuccess) {
            setWithdrawalAmount('');
            onBack?.();
          }
        }}
        onRetry={
          withdrawalResult.status === 'failure' ? () => performWithdraw(submittedAmount) : undefined
        }
      />
    );
  }

  return (
    <View style={s.container}>
      {/* Email Verification Banner */}
      {!isEmailVerified && <EmailVerificationBanner email={userEmail} />}

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={s.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Withdraw Funds</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Balance Display */}
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>Total Balance</Text>
          <Text style={s.balanceAmount}>{formatCurrency(balance)}</Text>
          <View style={s.breakdownRow}>
            <View style={s.breakdownItem}>
              <Text style={s.breakdownLabel}>Available</Text>
              <Text style={s.breakdownValue}>
                {formatCurrency(serverAvailableBalance ?? balance)}
              </Text>
            </View>
            <View style={s.breakdownDivider} />
            <View style={s.breakdownItem}>
              <Text style={s.breakdownLabel}>Pending</Text>
              <Text style={s.breakdownValue}>
                {formatCurrency(
                  serverAvailableBalance != null ? Math.max(balance - serverAvailableBalance, 0) : 0
                )}
              </Text>
            </View>
          </View>
        </View>

        {/* Standard vs Instant chooser — always visible once a payout
            account exists, so Instant is a real advertised choice rather
            than a card that silently disappears when ineligible. Picking
            Instant opens the dedicated Instant Cash Out screen; picking
            Standard is a no-op (this screen already is the standard flow). */}
        {hasConnectedAccount && (
          <WithdrawMethodSelect
            selected="standard"
            onSelect={method => {
              if (method === 'instant') setShowInstantCashOut(true);
            }}
            instantEligible={hasInstantEligibleCard}
            instantIneligibleReason="Add a debit card to unlock"
            onAddDebitCard={() => setShowAddDebitCard(true)}
          />
        )}

        <TouchableOpacity
          onPress={() => setShowPayoutMethods(true)}
          style={s.manageMethodsLink}
          accessibilityRole="button"
          accessibilityLabel="Manage payout methods"
        >
          <MaterialIcons name="settings" size={16} color={theme.primary} />
          <Text style={s.manageMethodsLinkText}>Manage Payout Methods</Text>
        </TouchableOpacity>

        {/* Connect Status — surfaced first since it blocks withdrawal entirely */}
        {!hasConnectedAccount && (
          <View style={s.warningCard}>
            <MaterialIcons name="warning" size={24} color="#fbbf24" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.warningTitle}>Stripe Connect Required</Text>
              <Text style={s.warningText}>
                Complete Stripe Connect onboarding to withdraw funds to your bank account.
              </Text>
              <TouchableOpacity
                onPress={handleConnectOnboarding}
                style={s.warningButton}
                disabled={isOnboarding}
                accessibilityLabel="Complete Stripe Connect onboarding"
                accessibilityRole="button"
                accessibilityState={{ disabled: isOnboarding }}
              >
                {isOnboarding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.warningButtonText}>Complete Onboarding</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Bank Accounts Section */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Bank Accounts</Text>
            <TouchableOpacity
              onPress={handleAddBankAccount}
              style={s.addButton}
              accessibilityLabel="Add bank account"
              accessibilityRole="button"
            >
              <MaterialIcons name="add" size={18} color={theme.primary} />
              <Text style={s.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {isLoadingAccounts ? (
            <ActivityIndicator size="small" color="#059669" style={{ marginVertical: 8 }} />
          ) : bankAccounts.length === 0 ? (
            <TouchableOpacity
              style={s.emptyState}
              onPress={handleAddBankAccount}
              accessibilityLabel="Add your first bank account"
              accessibilityRole="button"
            >
              <MaterialIcons name="account-balance" size={20} color={theme.textDisabled} />
              <Text style={s.emptyStateText}>No bank accounts added — tap Add to get started</Text>
            </TouchableOpacity>
          ) : (
            bankAccounts.map(account => (
              <TouchableOpacity
                key={account.id}
                style={[
                  s.bankAccountCard,
                  selectedBankAccount === account.id && s.bankAccountCardSelected,
                ]}
                onPress={() => setSelectedBankAccount(account.id)}
                accessibilityLabel={`${account.bankName || 'Bank Account'} ending in ${account.last4}, ${account.accountType}, status ${account.status}${account.default ? ', default account' : ''}${selectedBankAccount === account.id ? ', selected' : ''}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedBankAccount === account.id }}
              >
                <View style={s.radioButton}>
                  {selectedBankAccount === account.id ? (
                    <MaterialIcons name="radio-button-checked" size={24} color="#059669" />
                  ) : (
                    <MaterialIcons
                      name="radio-button-unchecked"
                      size={24}
                      color={theme.textDisabled}
                    />
                  )}
                </View>
                <View style={s.bankAccountInfo}>
                  <View style={s.bankAccountHeader}>
                    <Text style={s.bankAccountName}>{account.bankName || 'Bank Account'}</Text>
                    {account.default && (
                      <View style={s.defaultBadge}>
                        <Text style={s.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.bankAccountDetails}>
                    {account.accountType
                      ? account.accountType.charAt(0).toUpperCase() + account.accountType.slice(1)
                      : ''}{' '}
                    ••••{account.last4}
                  </Text>
                  <Text style={s.bankAccountStatus}>Status: {account.status}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveBankAccount(account.id)}
                  style={s.removeButton}
                  accessibilityLabel={`Remove ${account.bankName || 'bank account'} ending in ${account.last4}`}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={20} color={theme.textDisabled} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Amount Input */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Withdrawal Amount</Text>
          <View style={s.amountInputContainer}>
            <Text style={s.currencySymbol}>$</Text>
            <TextInput
              style={s.amountInput}
              value={withdrawalAmount}
              onChangeText={setWithdrawalAmount}
              placeholder="0.00"
              placeholderTextColor={theme.textDisabled}
              keyboardType="decimal-pad"
              accessibilityLabel="Withdrawal amount"
              accessibilityHint="Enter the amount you want to withdraw"
            />
          </View>
          <Text style={s.limitsHint}>
            Min {formatCurrency(minWithdrawal)}
            {maxWithdrawal != null ? ` · Max ${formatCurrency(maxWithdrawal)}` : ''}
          </Text>
          <View style={s.quickAmounts}>
            <TouchableOpacity
              style={s.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.25).toFixed(2))}
              accessibilityLabel="Withdraw 25% of balance"
              accessibilityRole="button"
            >
              <Text style={s.quickAmountText}>25%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.5).toFixed(2))}
              accessibilityLabel="Withdraw 50% of balance"
              accessibilityRole="button"
            >
              <Text style={s.quickAmountText}>50%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.75).toFixed(2))}
              accessibilityLabel="Withdraw 75% of balance"
              accessibilityRole="button"
            >
              <Text style={s.quickAmountText}>75%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.quickAmountButton}
              onPress={handleMaxWithdrawal}
              accessibilityLabel="Withdraw maximum balance"
              accessibilityRole="button"
            >
              <Text style={s.quickAmountText}>Max</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Info Card */}
        <View style={s.infoCard}>
          <MaterialIcons name="info-outline" size={20} color={theme.primary} />
          <Text style={s.infoText}>
            Withdrawals typically arrive in 1-3 business days. There are no fees for standard bank
            transfers. The bank account you select becomes your default payout account going
            forward.
          </Text>
        </View>

        {/* Withdrawal History — segmented by status, sourced from the same
            transactions list the Wallet tab loads (no separate fetch). */}
        {(pendingWithdrawals.length > 0 || failedWithdrawals.length > 0 || completedWithdrawals.length > 0) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Withdrawal History</Text>

            {pendingWithdrawals.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={s.historyGroupLabel}>Pending</Text>
                {pendingWithdrawals.map(tx => (
                  <View key={tx.id} style={s.historyRow}>
                    <MaterialIcons name="hourglass-empty" size={18} color="#fbbf24" />
                    <Text style={s.historyAmount}>{formatCurrency(Math.abs(tx.amount))}</Text>
                    <Text style={s.historyDate}>{tx.date.toLocaleDateString()}</Text>
                  </View>
                ))}
              </View>
            )}

            {failedWithdrawals.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={s.historyGroupLabel}>Failed</Text>
                {failedWithdrawals.map(tx => (
                  <View key={tx.id} style={s.historyRow}>
                    <MaterialIcons name="error-outline" size={18} color="#ef4444" />
                    <Text style={s.historyAmount}>{formatCurrency(Math.abs(tx.amount))}</Text>
                    <Text style={s.historyDate}>{tx.date.toLocaleDateString()}</Text>
                  </View>
                ))}
              </View>
            )}

            {completedWithdrawals.length > 0 && (
              <View>
                <Text style={s.historyGroupLabel}>Completed</Text>
                {completedWithdrawals.map(tx => (
                  <View key={tx.id} style={s.historyRow}>
                    <MaterialIcons name="check-circle-outline" size={18} color="#6ee7b7" />
                    <Text style={s.historyAmount}>{formatCurrency(Math.abs(tx.amount))}</Text>
                    <Text style={s.historyDate}>{tx.date.toLocaleDateString()}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Withdraw Button */}
      <View style={[s.footer, { paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          onPress={handleWithdraw}
          disabled={isWithdrawDisabled}
          style={[s.withdrawButton, isWithdrawDisabled && s.withdrawButtonDisabled]}
          accessibilityLabel={
            withdrawalAmount
              ? `Withdraw ${formatCurrency(parseFloat(withdrawalAmount))}`
              : 'Withdraw funds'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: isWithdrawDisabled }}
        >
          <Text style={s.withdrawButtonText}>
            Withdraw {withdrawalAmount ? formatCurrency(parseFloat(withdrawalAmount)) : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <WithdrawalConfirmSheet
        visible={showConfirmSheet}
        method="standard"
        amount={submittedAmount}
        destinationLabel={submittedDestinationLabel}
        estimatedArrival="1-3 business days"
        isSubmitting={false}
        onConfirm={() => {
          setShowConfirmSheet(false);
          performWithdraw(submittedAmount);
        }}
        onCancel={() => setShowConfirmSheet(false)}
      />
    </View>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: t.text,
  },
  content: {
    padding: 16,
  },
  balanceCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 13,
    color: t.textSecondary,
    marginBottom: 2,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: t.text,
  },
  breakdownRow: {
    flexDirection: 'row',
    marginTop: 10,
    alignItems: 'center',
  },
  breakdownItem: {
    flex: 1,
    alignItems: 'center',
  },
  breakdownDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: t.textDisabled,
    opacity: 0.4,
  },
  breakdownLabel: {
    fontSize: 11,
    color: t.textSecondary,
    marginBottom: 2,
  },
  breakdownValue: {
    fontSize: 15,
    fontWeight: '600',
    color: t.text,
  },
  manageMethodsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 16,
    gap: 6,
  },
  manageMethodsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.primary,
  },
  historyGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: t.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  historyAmount: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: t.text,
  },
  historyDate: {
    fontSize: 12,
    color: t.textDisabled,
  },
  section: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.text,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceSecondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.primary,
    marginLeft: 4,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  currencySymbol: {
    fontSize: 22,
    fontWeight: '600',
    color: t.text,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: t.text,
  },
  limitsHint: {
    fontSize: 12,
    color: t.textSecondary,
    marginBottom: 12,
  },
  quickAmounts: {
    flexDirection: 'row',
    gap: 8,
  },
  quickAmountButton: {
    flex: 1,
    backgroundColor: t.surfaceSecondary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickAmountText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.text,
  },
  bankAccountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  bankAccountCardSelected: {
    borderColor: '#059669',
    backgroundColor: t.surface,
  },
  radioButton: {
    marginRight: 12,
  },
  bankAccountInfo: {
    flex: 1,
  },
  bankAccountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bankAccountName: {
    fontSize: 16,
    fontWeight: '600',
    color: t.text,
    marginRight: 8,
  },
  defaultBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  bankAccountDetails: {
    fontSize: 14,
    color: t.textSecondary,
    marginBottom: 2,
  },
  bankAccountStatus: {
    fontSize: 12,
    color: t.textDisabled,
  },
  removeButton: {
    padding: 8,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
  },
  emptyStateText: {
    flex: 1,
    fontSize: 13,
    color: t.textSecondary,
  },
  warningCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(251,191,36,0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fbbf24',
    marginBottom: 2,
  },
  warningText: {
    fontSize: 13,
    color: t.textSecondary,
    marginBottom: 8,
  },
  warningButton: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  warningButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: t.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: t.textSecondary,
    marginLeft: 8,
    lineHeight: 18,
  },
  footer: {
    padding: 16,
  },
  withdrawButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.primary,
    borderRadius: 12,
    paddingVertical: 16,
    shadowColor: t.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },

  withdrawButtonDisabled: {
    opacity: 0.5,
  },
  withdrawButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
}); }
