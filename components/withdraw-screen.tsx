
import { MaterialIcons } from "@expo/vector-icons";
import React, { useState, useEffect } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Alert, ActivityIndicator } from "react-native";
import { useWallet } from '../lib/wallet-context';
import { useStripe } from '../lib/stripe-context';


interface WithdrawScreenProps {
  onBack?: () => void;
  balance: number;
}

export function WithdrawScreen({ onBack, balance = 40 }: WithdrawScreenProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customAmount, setCustomAmount] = useState<string>("");
  
  const { withdraw } = useWallet();
  const { paymentMethods, isLoading } = useStripe();
  
  // Set default selected method when payment methods load
  useEffect(() => {
    if (paymentMethods.length > 0 && !selectedMethod) {
      setSelectedMethod(paymentMethods[0].id);
    }
  }, [paymentMethods, selectedMethod]);

  const handleWithdraw = async () => {
    if (!selectedMethod) {
      Alert.alert('No Payment Method', 'Please select a payment method for withdrawal.');
      return;
    }

    if (withdrawalAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
      return;
    }

    if (withdrawalAmount > balance) {
      Alert.alert('Insufficient Balance', 'You cannot withdraw more than your current balance.');
      return;
    }

    setIsProcessing(true);
    
    try {
      // In a real app, this would involve Stripe Express or similar for payouts
      // For now, we'll simulate the withdrawal
      const success = await withdraw(withdrawalAmount, {
        method: paymentMethods.find(pm => pm.id === selectedMethod)?.card.brand.toUpperCase() || 'Card',
        title: 'Withdrawal to Payment Method',
        status: 'pending'
      });

      if (success) {
        Alert.alert(
          'Withdrawal Initiated',
          `$${withdrawalAmount.toFixed(2)} withdrawal has been initiated. It may take 1-3 business days to process.`,
          [{ text: 'OK', onPress: onBack }]
        );
      } else {
        Alert.alert('Withdrawal Failed', 'Insufficient balance or invalid withdrawal amount.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to process withdrawal. Please try again.');
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
          <MaterialIcons name="gps-fixed" size={20} color="#fff" />
          <Text style={styles.headerTitle}>BOUNTY</Text>
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
          
          {/* Note about bank accounts */}
          <View style={styles.methodRowInactive}>
            <View style={styles.methodIconCircle}>
              <MaterialIcons name="info" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodName}>Bank Account Withdrawals</Text>
              <Text style={styles.methodDetails}>Coming soon - direct bank transfers</Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.bottomButtonBox}>
        <TouchableOpacity
          onPress={handleWithdraw}
          style={[
            styles.bottomButton,
            withdrawalAmount > 0 && selectedMethod && !isProcessing
              ? styles.bottomButtonActive 
              : styles.bottomButtonInactive,
          ]}
          disabled={withdrawalAmount <= 0 || !selectedMethod || isProcessing}
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