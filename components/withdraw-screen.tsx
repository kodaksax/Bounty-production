
import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BrandingLogo } from './ui/branding-logo';
import { useAuthContext } from '../hooks/use-auth-context';
import { API_BASE_URL } from '../lib/config/api';
import { useStripe } from '../lib/stripe-context';
import { useWallet } from '../lib/wallet-context';

interface WithdrawScreenProps {
  onBack?: () => void;
  balance?: number; // Optional - will use wallet balance if not provided
}

export function WithdrawScreen({ onBack, balance: propBalance }: WithdrawScreenProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasConnectedAccount, setHasConnectedAccount] = useState(false);
  const [connectedAccountId, setConnectedAccountId] = useState<string>("");
  const [isOnboarding, setIsOnboarding] = useState(false);
  
  // Use wallet context for balance - this ensures balance is always in sync
  const { withdraw, balance: walletBalance, refresh } = useWallet();
  const { paymentMethods, isLoading } = useStripe();
  const { session } = useAuthContext();
  
  // Use prop balance if provided, otherwise use wallet context balance
  const balance = propBalance ?? walletBalance;
  
  // Set default selected method when payment methods load
  useEffect(() => {
    if (paymentMethods.length > 0 && !selectedMethod) {
      setSelectedMethod(paymentMethods[0].id);
    }
  }, [paymentMethods, selectedMethod]);

  // Check for existing Connect account on mount
  useEffect(() => {
    verifyConnectOnboarding();
  }, []);

  const verifyConnectOnboarding = async () => {
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
        if (data.onboarded) {
          setHasConnectedAccount(true);
          setConnectedAccountId(data.accountId);
        }
      }
    } catch (error) {
      console.error('Error verifying Connect onboarding:', error);
    }
  };

  const handleConnectOnboarding = async () => {
    setIsOnboarding(true);
    
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      // Call backend to create Connect account link
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

      const { url, accountId } = await response.json();
      
      // Open the Stripe Connect onboarding URL
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        
        // After returning, verify onboarding status
        setTimeout(async () => {
          await verifyConnectOnboarding();
        }, 2000);
      } else {
        throw new Error('Cannot open Stripe Connect URL');
      }
    } catch (error: any) {
      console.error('Connect onboarding error:', error);
      
      // Provide detailed error messages with troubleshooting guidance
      let errorMessage = error.message || 'Unable to start Connect onboarding. Please try again.';
      let errorTitle = 'Onboarding Failed';
      
      // Check for common Stripe Connect issues
      if (error.message?.includes('account already exists')) {
        errorTitle = 'Account Already Exists';
        errorMessage = 'You already have a Stripe Connect account. Please contact support if you need to update your banking details.';
      } else if (error.message?.includes('not configured') || error.message?.includes('STRIPE_SECRET_KEY')) {
        errorTitle = 'Service Unavailable';
        errorMessage = 'Stripe Connect is not configured on this server. Please contact support to enable withdrawals.';
      } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
        errorTitle = 'Network Error';
        errorMessage = 'Unable to connect to the payment service. Please check your internet connection and try again.';
      }
      
      Alert.alert(
        errorTitle,
        errorMessage + '\n\nIf this problem persists, please contact support at support@bountyexpo.com',
        [{ text: 'OK' }]
      );
    } finally {
      setIsOnboarding(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawalAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
      return;
    }

    if (withdrawalAmount > balance) {
      Alert.alert('Insufficient Balance', 'You cannot withdraw more than your current balance.');
      return;
    }

    // Check if user has connected account for bank transfers
    if (!hasConnectedAccount && !selectedMethod) {
      Alert.alert(
        'Setup Required',
        'To withdraw funds, you need to either:\n\n1. Connect your bank account (recommended)\n2. Select a payment method',
        [
          { text: 'Connect Bank Account', onPress: handleConnectOnboarding },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
      return;
    }

    setIsProcessing(true);
    
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      if (hasConnectedAccount) {
        // Use Stripe Connect transfer
        const response = await fetch(`${API_BASE_URL}/connect/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            amount: withdrawalAmount,
            currency: 'usd'
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to initiate transfer');
        }

        const { transferId, transactionId, estimatedArrival, message } = await response.json();
        
        // Refresh wallet to get updated balance from API
        await refresh();
        
        // Show success message
        Alert.alert(
          'Withdrawal Initiated',
          message || `Transfer of $${withdrawalAmount.toFixed(2)} has been initiated.\n\nEstimated arrival: 1-2 business days\n\nTransfer ID: ${transferId}`,
          [{ text: 'OK', onPress: onBack }]
        );
      } else {
        // Use payment method (card refund - requires original payment)
        const success = await withdraw(withdrawalAmount, {
          method: paymentMethods.find(pm => pm.id === selectedMethod)?.card.brand.toUpperCase() || 'Card',
          title: 'Withdrawal to Payment Method',
          status: 'completed'
        });

        if (success) {
          Alert.alert(
            'Withdrawal Initiated',
            `$${withdrawalAmount.toFixed(2)} withdrawal has been initiated. It may take 1-3 business days to process.\n\nNote: For faster withdrawals, consider connecting your bank account.`,
            [{ text: 'OK', onPress: onBack }]
          );
        } else {
          Alert.alert('Withdrawal Failed', 'Insufficient balance or invalid withdrawal amount.');
        }
      }
    } catch (error: any) {
      console.error('Withdrawal error:', error);
      Alert.alert(
        'Error', 
        error.message || 'Failed to process withdrawal. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <BrandingLogo size="small" />
        </View>
      </View>
      <View style={styles.titleBox}>
        <Text style={styles.title}>WITHDRAW</Text>
      </View>
      <View style={styles.balanceBox}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Your Balance:</Text>
          <Text style={styles.balanceLabel}>Withdrawal: ${withdrawalAmount.toFixed(2)}</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBar, { width: `${(withdrawalAmount / balance) * 100}%` }]} />
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceSubLabel}>$0</Text>
          <Text style={styles.balanceSubLabel}>${balance.toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.amountBox}>
        <Text style={styles.amountLabel}>Amount:</Text>
        <TextInput
          style={styles.amountInput}
          keyboardType="numeric"
          value={withdrawalAmount ? withdrawalAmount.toString() : ""}
          onChangeText={text => {
            const val = parseFloat(text);
            setWithdrawalAmount(Math.min(balance, Math.max(0, isNaN(val) ? 0 : val)));
          }}
          placeholder="Enter amount to withdraw"
          placeholderTextColor="#6ee7b7"
        />
      </View>
      <ScrollView style={styles.scrollArea} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.methodsBox}>
          <Text style={styles.methodsTitle}>Select Withdrawal Method</Text>
          
          {/* Bank Account - Stripe Connect */}
          {hasConnectedAccount ? (
            <TouchableOpacity
              style={[styles.methodRow, styles.methodRowActive]}
              onPress={() => setSelectedMethod('')}
            >
              <View style={styles.methodIconCircle}>
                <MaterialIcons name="account-balance" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodName}>Bank Account (Connected)</Text>
                <Text style={styles.methodDetails}>Fastest withdrawal method • 1-3 business days</Text>
              </View>
              <View style={styles.methodCheckCircle}>
                <MaterialIcons name="check" size={16} color="#34d399" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.methodRow, styles.methodRowInactive]}
              onPress={handleConnectOnboarding}
              disabled={isOnboarding}
            >
              <View style={styles.methodIconCircle}>
                <MaterialIcons name="account-balance" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodName}>Connect Bank Account</Text>
                <Text style={styles.methodDetails}>
                  {isOnboarding ? 'Setting up...' : 'Recommended • Fastest withdrawals'}
                </Text>
              </View>
              {isOnboarding ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <MaterialIcons name="arrow-forward" size={20} color="#6ee7b7" />
              )}
            </TouchableOpacity>
          )}
          
          {/* Divider */}
          <View style={{ height: 1, backgroundColor: '#047857', marginVertical: 12 }} />
          
          {/* Payment Methods */}
          {isLoading ? (
            <View style={[styles.methodRow, { justifyContent: 'center', alignItems: 'center' }]}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={[styles.methodName, { marginLeft: 8 }]}>Loading payment methods...</Text>
            </View>
          ) : paymentMethods.length === 0 ? (
            <View style={styles.methodRowInactive}>
              <View style={styles.methodIconCircle}>
                <MaterialIcons name="credit-card" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodName}>No Payment Methods</Text>
                <Text style={styles.methodDetails}>Add a payment method first to withdraw funds</Text>
              </View>
            </View>
          ) : (
            paymentMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodRow,
                  selectedMethod === method.id ? styles.methodRowActive : styles.methodRowInactive,
                ]}
                onPress={() => setSelectedMethod(method.id)}
              >
                <View style={styles.methodIconCircle}>
                  <MaterialIcons name="credit-card" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodName}>
                    {method.card.brand.toUpperCase()} •••• {method.card.last4}
                  </Text>
                  <Text style={styles.methodDetails}>
                    Expires {method.card.exp_month.toString().padStart(2, '0')}/{method.card.exp_year}
                  </Text>
                </View>
                <View style={styles.methodCheckCircle}>
                  {selectedMethod === method.id && <MaterialIcons name="check" size={16} color="#34d399" />}
                </View>
              </TouchableOpacity>
            ))
          )}
          
          {/* Processing time info */}
          <View style={styles.methodRowInactive}>
            <View style={styles.methodIconCircle}>
              <MaterialIcons name="info" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodName}>Processing Times</Text>
              <Text style={styles.methodDetails}>
                • Bank transfers: 1-3 business days{'\n'}
                • Card refunds: 5-10 business days{'\n'}
                Withdrawals are processed securely through Stripe
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.bottomButtonBox}>
        <TouchableOpacity
          onPress={handleWithdraw}
          style={[
            styles.bottomButton,
            withdrawalAmount > 0 && (selectedMethod || hasConnectedAccount) && !isProcessing
              ? styles.bottomButtonActive 
              : styles.bottomButtonInactive,
          ]}
          disabled={withdrawalAmount <= 0 || (!selectedMethod && !hasConnectedAccount) || isProcessing}
        >
          {isProcessing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.bottomButtonText}>Processing...</Text>
            </View>
          ) : (
            <Text style={styles.bottomButtonText}>
              Withdraw ${withdrawalAmount.toFixed(2)}
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
    backgroundColor: '#059669',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 16,
    backgroundColor: '#059669',
  },
  backButton: {
    marginRight: 12,
    padding: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  titleBox: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  balanceBox: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  balanceLabel: {
    color: '#a7f3d0',
    fontSize: 14,
  },
  balanceSubLabel: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#047857',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#34d399',
    borderRadius: 4,
  },
  amountBox: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  amountLabel: {
    color: '#a7f3d0',
    fontSize: 14,
    marginBottom: 4,
  },
  amountInput: {
    backgroundColor: '#047857',
    borderColor: '#10b981',
    borderWidth: 1,
    borderRadius: 8,
    color: '#fff',
    padding: 12,
    fontSize: 16,
    marginBottom: 4,
  },
  scrollArea: {
    flex: 1,
  },
  methodsBox: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  methodsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    justifyContent: 'space-between',
  },
  methodRowActive: {
    backgroundColor: '#047857',
  },
  methodRowInactive: {
    backgroundColor: '#04785799',
  },
  methodIconCircle: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: '#065f46',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  methodName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  methodDetails: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  methodCheckCircle: {
    height: 20,
    width: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#34d399',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomButtonBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: '#059669',
    borderTopWidth: 1,
    borderTopColor: '#10b981',
    elevation: 10,
  },
  bottomButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  bottomButtonActive: {
    backgroundColor: '#10b981',
  },
  bottomButtonInactive: {
    backgroundColor: '#04785799',
  },
  bottomButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});