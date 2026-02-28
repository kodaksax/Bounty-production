import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuthContext } from '../hooks/use-auth-context';
import { useEmailVerification } from '../hooks/use-email-verification';
import { API_BASE_URL } from '../lib/config/api';
import { colors, theme } from '../lib/theme';
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

export function WithdrawWithBankScreen({ onBack, balance: propBalance }: WithdrawWithBankScreenProps) {
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasConnectedAccount, setHasConnectedAccount] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>("");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [showAddBankAccount, setShowAddBankAccount] = useState(false);

  const { balance: walletBalance, refresh } = useWallet();
  const { session } = useAuthContext();
  const { isEmailVerified, canWithdrawFunds, userEmail } = useEmailVerification();

  const balance = propBalance ?? walletBalance;

  const loadConnectStatus = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        }
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
          'Authorization': `Bearer ${session.access_token}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        setBankAccounts(data.bankAccounts || []);

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

  // Load Connect status and bank accounts when session changes
  useEffect(() => {
    loadConnectStatus();
    loadBankAccounts();
  }, [loadConnectStatus, loadBankAccounts]);

  const handleConnectOnboarding = async () => {
    setIsOnboarding(true);

    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      const response = await fetch(`${API_BASE_URL}/connect/create-account-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          returnUrl: 'bountyexpo://wallet/connect/return',
          refreshUrl: 'bountyexpo://wallet/connect/refresh'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create account link');
      }

      const { url } = await response.json();

      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);

        // Refresh status after user returns
        setTimeout(async () => {
          await loadConnectStatus();
          await loadBankAccounts();
        }, 2000);
      } else {
        throw new Error('Cannot open Stripe Connect URL');
      }
    } catch (error: any) {
      console.error('Connect onboarding error:', error);
      Alert.alert(
        'Onboarding Failed',
        error.message || 'Unable to start Connect onboarding. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
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

    if (amount > balance) {
      Alert.alert('Insufficient Balance', 'You cannot withdraw more than your current balance.');
      return;
    }

    // Check Connect account
    if (!hasConnectedAccount) {
      Alert.alert(
        'Setup Required',
        'To withdraw funds, you need to complete Stripe Connect onboarding first.',
        [
          { text: 'Complete Onboarding', onPress: handleConnectOnboarding },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
      return;
    }

    // Check bank account selection
    if (bankAccounts.length === 0) {
      Alert.alert(
        'Bank Account Required',
        'Please add a bank account to receive withdrawals.',
        [
          { text: 'Add Bank Account', onPress: () => setShowAddBankAccount(true) },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
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

      const response = await fetch(`${API_BASE_URL}/connect/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount,
          currency: 'usd'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to initiate transfer');
      }

      const { transferId } = await response.json();

      // Refresh wallet balance
      await refresh();

      // Show success
      Alert.alert(
        'Withdrawal Initiated',
        `Transfer of $${amount.toFixed(2)} has been initiated to your bank account.\n\nEstimated arrival: 1-2 business days\n\nTransfer ID: ${transferId}`,
        [{ text: 'OK', onPress: onBack }]
      );
    } catch (error: any) {
      console.error('Withdrawal error:', error);
      Alert.alert(
        'Withdrawal Failed',
        error.message || 'Failed to process withdrawal. Please try again.',
        [{ text: 'OK' }]
      );
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
    Alert.alert(
      'Remove Bank Account',
      'Are you sure you want to remove this bank account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(
                `${API_BASE_URL}/connect/bank-accounts/${bankAccountId}`,
                {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `Bearer ${session?.access_token}`,
                  }
                }
              );

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
          }
        }
      ]
    );
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
    <View style={styles.container}>
      {/* Email Verification Banner */}
      {!isEmailVerified && (
        <EmailVerificationBanner email={userEmail} />
      )}

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Withdraw Funds</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Balance Display */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
        </View>

        {/* Amount Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Withdrawal Amount</Text>
          <View style={styles.amountInputContainer}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={withdrawalAmount}
              onChangeText={setWithdrawalAmount}
              placeholder="0.00"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="decimal-pad"
              accessibilityLabel="Withdrawal amount"
              accessibilityHint="Enter the amount you want to withdraw"
            />
          </View>
          <View style={styles.quickAmounts}>
            <TouchableOpacity
              style={styles.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.25).toFixed(2))}
              accessibilityLabel="Withdraw 25% of balance"
              accessibilityRole="button"
            >
              <Text style={styles.quickAmountText}>25%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.5).toFixed(2))}
              accessibilityLabel="Withdraw 50% of balance"
              accessibilityRole="button"
            >
              <Text style={styles.quickAmountText}>50%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickAmountButton}
              onPress={() => setWithdrawalAmount((balance * 0.75).toFixed(2))}
              accessibilityLabel="Withdraw 75% of balance"
              accessibilityRole="button"
            >
              <Text style={styles.quickAmountText}>75%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickAmountButton}
              onPress={() => setWithdrawalAmount(balance.toFixed(2))}
              accessibilityLabel="Withdraw maximum balance"
              accessibilityRole="button"
            >
              <Text style={styles.quickAmountText}>Max</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Bank Accounts Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bank Accounts</Text>
            <TouchableOpacity
              onPress={handleAddBankAccount}
              style={styles.addButton}
              accessibilityLabel="Add bank account"
              accessibilityRole="button"
            >
              <MaterialIcons name="add" size={18} color={colors.primary[500]} />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {isLoadingAccounts ? (
            <ActivityIndicator size="small" color={colors.primary[500]} style={{ marginVertical: 20 }} />
          ) : bankAccounts.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="account-balance" size={48} color="rgba(255,255,255,0.3)" />
              <Text style={styles.emptyStateText}>No bank accounts added</Text>
              <TouchableOpacity
                onPress={handleAddBankAccount}
                style={styles.emptyStateButton}
                accessibilityLabel="Add your first bank account"
                accessibilityRole="button"
              >
                <Text style={styles.emptyStateButtonText}>Add Bank Account</Text>
              </TouchableOpacity>
            </View>
          ) : (
            bankAccounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={[
                  styles.bankAccountCard,
                  selectedBankAccount === account.id && styles.bankAccountCardSelected
                ]}
                onPress={() => setSelectedBankAccount(account.id)}
                accessibilityLabel={`${account.bankName || 'Bank Account'} ending in ${account.last4}, ${account.accountType}, status ${account.status}${account.default ? ', default account' : ''}${selectedBankAccount === account.id ? ', selected' : ''}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedBankAccount === account.id }}
              >
                <View style={styles.radioButton}>
                  {selectedBankAccount === account.id ? (
                    <MaterialIcons name="radio-button-checked" size={24} color={colors.primary[500]} />
                  ) : (
                    <MaterialIcons name="radio-button-unchecked" size={24} color="rgba(255,255,255,0.4)" />
                  )}
                </View>
                <View style={styles.bankAccountInfo}>
                  <View style={styles.bankAccountHeader}>
                    <Text style={styles.bankAccountName}>{account.bankName || 'Bank Account'}</Text>
                    {account.default && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.bankAccountDetails}>
                    {account.accountType.charAt(0).toUpperCase() + account.accountType.slice(1)} ••••{account.last4}
                  </Text>
                  <Text style={styles.bankAccountStatus}>Status: {account.status}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveBankAccount(account.id)}
                  style={styles.removeButton}
                  accessibilityLabel={`Remove ${account.bankName || 'bank account'} ending in ${account.last4}`}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Connect Status */}
        {!hasConnectedAccount && (
          <View style={styles.warningCard}>
            <MaterialIcons name="warning" size={24} color="#fbbf24" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.warningTitle}>Stripe Connect Required</Text>
              <Text style={styles.warningText}>
                Complete Stripe Connect onboarding to withdraw funds to your bank account.
              </Text>
              <TouchableOpacity
                onPress={handleConnectOnboarding}
                style={styles.warningButton}
                disabled={isOnboarding}
                accessibilityLabel="Complete Stripe Connect onboarding"
                accessibilityRole="button"
                accessibilityState={{ disabled: isOnboarding }}
              >
                {isOnboarding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.warningButtonText}>Complete Onboarding</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Info Card */}
        <View style={styles.infoCard}>
          <MaterialIcons name="info-outline" size={20} color={colors.primary[500]} />
          <Text style={styles.infoText}>
            Withdrawals typically arrive in 1-2 business days. There are no fees for standard bank transfers.
          </Text>
        </View>
      </ScrollView>

      {/* Withdraw Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleWithdraw}
          disabled={
            isProcessing ||
            !hasConnectedAccount ||
            !withdrawalAmount ||
            parseFloat(withdrawalAmount) <= 0 ||
            bankAccounts.length === 0 ||
            !selectedBankAccount
          }
          style={[
            styles.withdrawButton,
            (isProcessing ||
              !hasConnectedAccount ||
              !withdrawalAmount ||
              parseFloat(withdrawalAmount) <= 0 ||
              bankAccounts.length === 0 ||
              !selectedBankAccount) &&
            styles.withdrawButtonDisabled
          ]}
          accessibilityLabel={withdrawalAmount ? `Withdraw $${parseFloat(withdrawalAmount).toFixed(2)}` : 'Withdraw funds'}
          accessibilityRole="button"
          accessibilityState={{
            disabled: isProcessing || !hasConnectedAccount || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0 || bankAccounts.length === 0 || !selectedBankAccount
          }}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.withdrawButtonText}>Processing...</Text>
            </>
          ) : (
            <Text style={styles.withdrawButtonText}>
              Withdraw {withdrawalAmount ? `$${parseFloat(withdrawalAmount).toFixed(2)}` : ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#047857',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    padding: 16,
  },
  balanceCard: {
    backgroundColor: 'rgba(4,120,87,0.6)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary[500],
    marginLeft: 4,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(4,120,87,0.6)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
  },
  quickAmounts: {
    flexDirection: 'row',
    gap: 8,
  },
  quickAmountButton: {
    flex: 1,
    backgroundColor: 'rgba(4,120,87,0.6)',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickAmountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  bankAccountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(4,120,87,0.6)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  bankAccountCardSelected: {
    borderColor: colors.primary[500],
    backgroundColor: 'rgba(16,185,129,0.2)',
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
    color: '#fff',
    marginRight: 8,
  },
  defaultBadge: {
    backgroundColor: colors.primary[500],
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
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 2,
  },
  bankAccountStatus: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  removeButton: {
    padding: 8,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
  },
  emptyStateText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 12,
    marginBottom: 16,
  },
  emptyStateButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyStateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  warningCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(251,191,36,0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fbbf24',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 12,
  },
  warningButton: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginLeft: 8,
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  withdrawButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary[500],
    borderRadius: 12,
    paddingVertical: 16,
    ...theme.shadows.emerald,
  },

  withdrawButtonDisabled: {
    opacity: 0.5,
  },
  withdrawButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
