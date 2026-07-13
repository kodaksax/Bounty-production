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
import { useEmailVerification } from '../hooks/use-email-verification';
import { API_BASE_URL } from '../lib/config/api';
import { MIN_WITHDRAWAL_AMOUNT } from '../lib/constants';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { useWallet } from '../lib/wallet-context';
import { AddBankAccountModal } from './add-bank-account-modal';
import { EmailVerificationBanner } from './ui/email-verification-banner';

interface BankAccount {
  id: string;
  accountHolderName: string;
  last4: string;
  bankName?: string;
  accountType: 'checking' | 'savings';
  status: string;
  default: boolean;
}

interface WithdrawWithBankScreenProps {
  onBack?: () => void;
  balance?: number;
}

<<<<<<< HEAD
// Client-side copy for server-classified withdrawal error codes (see
// supabase/functions/connect/index.ts). The server's `error` string is still
// shown as the alert body; this only picks a more specific title.
const ERROR_TITLES: Record<string, string> = {
  not_onboarded: 'Setup Required',
  insufficient_balance: 'Insufficient Balance',
  below_minimum: 'Minimum Withdrawal',
  above_maximum: 'Maximum Withdrawal',
  frozen: 'Balance On Hold',
  platform_funds: 'Withdrawals Unavailable',
  transfer_failed: 'Withdrawal Failed',
};

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network/i.test(error.message));
}
=======
// Height of the bottom tab bar + gap, so the sticky Withdraw button sits
// fully above it (same convention as postings-screen.tsx and the
// CreateBounty Step*.tsx screens).
const BOTTOM_NAV_OFFSET = 60;
>>>>>>> origin/main

export function WithdrawWithBankScreen({
  onBack,
  balance: propBalance,
}: WithdrawWithBankScreenProps) {
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasConnectedAccount, setHasConnectedAccount] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [showAddBankAccount, setShowAddBankAccount] = useState(false);
  // Server-driven limits from GET /connect/bank-accounts. Fall back to the
  // local MIN_WITHDRAWAL_AMOUNT constant / no cap until that call resolves.
  const [minWithdrawal, setMinWithdrawal] = useState<number>(MIN_WITHDRAWAL_AMOUNT);
  const [maxWithdrawal, setMaxWithdrawal] = useState<number | null>(null);
  const [serverAvailableBalance, setServerAvailableBalance] = useState<number | null>(null);

  const { balance: walletBalance, refresh } = useWallet();
  const { session } = useAuthContext();
  const { isEmailVerified, canWithdrawFunds, userEmail } = useEmailVerification();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const balance = propBalance ?? walletBalance;

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
    isProcessing ||
    !hasConnectedAccount ||
    !withdrawalAmount ||
    isNaN(parsedAmount) ||
    parsedAmount <= 0 ||
    (maxWithdrawal != null && parsedAmount > maxWithdrawal) ||
    bankAccounts.length === 0 ||
    !selectedBankAccount;

  const loadConnectStatus = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setHasConnectedAccount(data.onboarded && data.payoutsEnabled);
      }
    } catch (error) {
      console.error('Error loading Connect status:', error);
    }
  }, [session?.access_token]);

  const loadBankAccounts = useCallback(async () => {
    if (!session?.access_token) return;

    setIsLoadingAccounts(true);
    try {
      const response = await fetch(`${API_BASE_URL}/connect/bank-accounts`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setBankAccounts(data.bankAccounts || []);

        if (typeof data.minWithdrawal === 'number') setMinWithdrawal(data.minWithdrawal);
        if (typeof data.maxWithdrawal === 'number') setMaxWithdrawal(data.maxWithdrawal);
        if (typeof data.availableBalance === 'number') setServerAvailableBalance(data.availableBalance);
        // Only ever flip this on — verify-onboarding remains the source of
        // truth for turning it off / triggering the DB write.
        if (data.onboarded && data.payoutsEnabled) setHasConnectedAccount(true);

        // Auto-select default bank account or first one
        const defaultAccount = data.bankAccounts?.find((acc: BankAccount) => acc.default);
        if (defaultAccount) {
          setSelectedBankAccount(defaultAccount.id);
        } else if (data.bankAccounts?.length > 0) {
          setSelectedBankAccount(data.bankAccounts[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading bank accounts:', error);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [session?.access_token]);

  // Refresh Connect status and bank accounts when returning from the embedded
  // onboarding screen, then clear the loading indicator.
  useFocusEffect(
    useCallback(() => {
      if (needsRefreshOnFocusRef.current) {
        needsRefreshOnFocusRef.current = false;
        (async () => {
          try {
            await loadConnectStatus();
            await loadBankAccounts();
          } finally {
            setIsOnboarding(false);
          }
        })();
      }
    }, [loadConnectStatus, loadBankAccounts])
  );

  // Load Connect status and bank accounts when session changes
  useEffect(() => {
    loadConnectStatus();
    loadBankAccounts();
  }, [loadConnectStatus, loadBankAccounts]);

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
      Alert.alert('Minimum Withdrawal', `The minimum withdrawal amount is $${minWithdrawal.toFixed(2)}.`);
      return;
    }

    if (maxWithdrawal != null && amount > maxWithdrawal) {
      Alert.alert('Maximum Withdrawal', `The maximum withdrawal amount is $${maxWithdrawal.toFixed(2)} per transaction.`);
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

    setIsProcessing(true);

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

      // Refresh wallet balance
      await refresh();

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

      // Show success
      Alert.alert(
        'Withdrawal Initiated',
        `Transfer of $${amount.toFixed(2)} has been initiated to your bank account.\n\nEstimated arrival: 1-2 business days\n\nTransfer ID: ${transferId}`,
        [{ text: 'OK', onPress: onBack }]
      );
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
        Alert.alert(
          'Request Timed Out',
          'The request took too long to complete. Please check your connection and try again.',
          [{ text: 'OK' }]
        );
      } else if (isNetworkError(error)) {
        Alert.alert(
          'Connection Error',
          'Could not reach the server. Please check your connection and try again.',
          [{ text: 'OK' }]
        );
      } else {
        const title = (error?.code && ERROR_TITLES[error.code]) || 'Withdrawal Failed';
        Alert.alert(title, error.message || 'Failed to process withdrawal. Please try again.', [
          { text: 'OK' },
        ]);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddBankAccount = () => {
    setShowAddBankAccount(true);
  };

  const handleBankAccountAdded = async () => {
    setShowAddBankAccount(false);
    await loadBankAccounts();
  };

  const handleRemoveBankAccount = async (bankAccountId: string) => {
    Alert.alert('Remove Bank Account', 'Are you sure you want to remove this bank account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/connect/bank-accounts/${bankAccountId}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${session?.access_token}`,
              },
            });

            if (response.ok) {
              await loadBankAccounts();
              Alert.alert('Success', 'Bank account removed successfully');
            } else {
              throw new Error('Failed to remove bank account');
            }
          } catch (error) {
            console.error('Error removing bank account:', error);
            Alert.alert('Error', 'Failed to remove bank account');
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
          <Text style={s.balanceLabel}>Available Balance</Text>
          <Text style={s.balanceAmount}>${balance.toFixed(2)}</Text>
        </View>

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
<<<<<<< HEAD
          <Text style={s.limitsHint}>
            Min ${minWithdrawal.toFixed(2)}
            {maxWithdrawal != null ? ` · Max $${maxWithdrawal.toFixed(2)}` : ''}
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
              onPress={() =>
                setWithdrawalAmount(
                  (maxWithdrawal != null ? Math.min(balance, maxWithdrawal) : balance).toFixed(2)
                )
              }
              accessibilityLabel="Withdraw maximum balance"
              accessibilityRole="button"
            >
              <Text style={s.quickAmountText}>Max</Text>
            </TouchableOpacity>
          </View>
        </View>
=======
        )}
>>>>>>> origin/main

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
              onPress={() => setWithdrawalAmount(balance.toFixed(2))}
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
            Withdrawals typically arrive in 1-2 business days. There are no fees for standard bank
            transfers.
          </Text>
        </View>
      </ScrollView>

      {/* Withdraw Button */}
      <View style={[s.footer, { paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          onPress={handleWithdraw}
          disabled={isWithdrawDisabled}
          style={[s.withdrawButton, isWithdrawDisabled && s.withdrawButtonDisabled]}
          accessibilityLabel={
            withdrawalAmount
              ? `Withdraw $${parseFloat(withdrawalAmount).toFixed(2)}`
              : 'Withdraw funds'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: isWithdrawDisabled }}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.withdrawButtonText}>Processing...</Text>
            </>
          ) : (
            <Text style={s.withdrawButtonText}>
              Withdraw {withdrawalAmount ? `$${parseFloat(withdrawalAmount).toFixed(2)}` : ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>
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
