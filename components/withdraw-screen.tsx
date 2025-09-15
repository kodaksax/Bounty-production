
import React, { useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ScrollView } from "react-native";


interface WithdrawScreenProps {
  onBack?: () => void;
  balance: number;
}

interface PaymentMethod {
  id: string;
  name: string;
  details: string;
  icon: React.ReactNode;
}

export function WithdrawScreen({ onBack, balance = 40 }: WithdrawScreenProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>("bank-of-america");
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0);

  const paymentMethods: PaymentMethod[] = [
    {
      id: "bank-of-america",
      name: "Bank Of America",
      details: "Checking XXXXXX23",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "apple-pay",
      name: "Apple Pay",
      details: "ending in 1138",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "chase-bank",
      name: "Chase Bank",
      details: "Checking XXXXXX45",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "wells-fargo",
      name: "Wells Fargo",
      details: "Savings XXXXXX78",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "venmo",
      name: "Venmo",
      details: "@username",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "paypal",
      name: "PayPal",
      details: "user@example.com",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
    {
      id: "cash-app",
      name: "Cash App",
      details: "$username",
      icon: <MaterialIcons name="home" size={20} color="#fff" />,
    },
  ];

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#059669', // emerald-600
    },
    header: {
      backgroundColor: '#059669',
      paddingTop: 32,
      zIndex: 10,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    backButton: {
      marginRight: 12,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    targetIcon: {
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    titleContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    balanceContainer: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    balanceLabel: {
      fontSize: 14,
      color: '#A7F3D0', // emerald-200
    },
    progressContainer: {
      height: 8,
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
      borderRadius: 4,
      overflow: 'hidden',
      marginBottom: 4,
    },
    progressBar: {
      height: '100%',
      backgroundColor: '#10B981', // emerald-400
    },
    progressLabel: {
      fontSize: 12,
      color: '#6EE7B7', // emerald-300
    },
    amountContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    amountLabel: {
      fontSize: 14,
      color: '#A7F3D0', // emerald-200
      marginBottom: 4,
    },
    amountInput: {
      width: '100%',
      backgroundColor: 'rgba(6, 95, 70, 0.3)', // emerald-700/30
      borderWidth: 1,
      borderColor: 'rgba(16, 185, 129, 0.3)', // emerald-500/30
      borderRadius: 8,
      padding: 8,
      color: 'white',
      fontSize: 16,
    },
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      paddingBottom: 96, // Space for fixed button
    },
    paymentMethodsContainer: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    paymentMethodsTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: 'white',
      marginBottom: 12,
    },
    methodsList: {
      gap: 12,
    },
    methodItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      borderRadius: 8,
    },
    methodItemSelected: {
      backgroundColor: '#047857', // emerald-700
    },
    methodItemUnselected: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
    },
    methodContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    methodIcon: {
      height: 32,
      width: 32,
      borderRadius: 16,
      backgroundColor: '#065F46', // emerald-800
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    methodInfo: {
      flex: 1,
    },
    methodName: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
    methodDetails: {
      fontSize: 12,
      color: '#6EE7B7', // emerald-300
    },
    radioContainer: {
      height: 20,
      width: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#10B981', // emerald-400
      alignItems: 'center',
      justifyContent: 'center',
    },
    addNewAccount: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
      borderRadius: 8,
    },
    buttonContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      backgroundColor: '#059669', // emerald-600
      borderTopWidth: 1,
      borderTopColor: 'rgba(16, 185, 129, 0.3)', // emerald-500/30
      zIndex: 10,
    },
    withdrawButton: {
      width: '100%',
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    withdrawButtonEnabled: {
      backgroundColor: '#10B981', // emerald-500
    },
    withdrawButtonDisabled: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
    },
    withdrawButtonText: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
  });

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
          {paymentMethods.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodRow,
                selectedMethod === method.id ? styles.methodRowActive : styles.methodRowInactive,
              ]}
              onPress={() => setSelectedMethod(method.id)}
            >
              <View style={styles.methodIconCircle}>{method.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodName}>{method.name}</Text>
                {method.details ? <Text style={styles.methodDetails}>{method.details}</Text> : null}
              </View>
              <View style={styles.methodCheckCircle}>
                {selectedMethod === method.id && <MaterialIcons name="check" size={16} color="#34d399" />}
              </View>
            </TouchableOpacity>
          ))}
          {/* Add New Bank Account */}
          <View style={styles.methodRowInactive}>
            <View style={styles.methodIconCircle}><MaterialIcons name="add" size={20} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodName}>New Bank Account</Text>
              <Text style={styles.methodDetails}>Menu description</Text>
            </View>
            <MaterialIcons name="keyboard-arrow-right" size={20} color="#34d399" />
          </View>
        </View>
      </ScrollView>
      <View style={styles.bottomButtonBox}>
        <TouchableOpacity
          style={[
            styles.bottomButton,
            withdrawalAmount > 0 ? styles.bottomButtonActive : styles.bottomButtonInactive,
          ]}
          disabled={withdrawalAmount <= 0}
        >
          <Text style={styles.bottomButtonText}>Begin Withdrawal</Text>
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