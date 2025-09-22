"use client"


import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useEffect } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Platform } from "react-native";
import { AddMoneyScreen } from "./add-money-screen";
import { PaymentMethodsModal } from "./payment-methods-modal";
import { TransactionHistoryScreen } from "./transaction-history-screen";
import { WithdrawScreen } from "./withdraw-screen";


interface WalletScreenProps {
  onBack?: () => void
}

interface PaymentMethodData {
  id: string;
  type: 'card';
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  billing_details?: {
    name?: string;
    email?: string;
  };
  created: number;
}

export function WalletScreen({ onBack }: WalletScreenProps = {}) {
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const [balance, setBalance] = useState(40)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodData[]>([])
  const [isLoadingPaymentMethods, setIsLoadingPaymentMethods] = useState(false)

  // Mock customer ID - in a real app, this would come from your user authentication
  const customerId = "cus_mock_customer_id"

  // Load payment methods when component mounts
  useEffect(() => {
    loadPaymentMethods()
  }, [])

  const loadPaymentMethods = async () => {
    // Mock: Skip loading payment methods for now
    // TODO: Implement when backend is ready
    setIsLoadingPaymentMethods(false)
  }

  const handleAddMoney = (amount: number) => {
    setBalance((prev) => prev + amount)
    setShowAddMoney(false)
  }

  if (showWithdraw) {
    return <WithdrawScreen onBack={() => setShowWithdraw(false)} balance={balance} />;
  }
  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={handleAddMoney} />;
  }
  if (showTransactionHistory) {
    return <TransactionHistoryScreen onBack={() => setShowTransactionHistory(false)} />;
  }

  

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MaterialIcons name="gps-fixed" size={20} color="#fff" />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 160 }}>
        {/* Balance Card */}
        <View style={styles.sectionPad}>
          <View style={styles.balanceCard}>
            <View style={styles.balanceCardHeader}>
              <Text style={styles.balanceLabel}>BALANCE</Text>
              <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
            </View>
            <View style={styles.balanceActionsRow}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowAddMoney(true)}>
                <MaterialIcons name="add" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Add Money</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowWithdraw(true)}>
                <MaterialIcons name="keyboard-arrow-down" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Withdraw</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {/* Linked Accounts Section */}
        <View style={styles.sectionPad}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Linked Accounts</Text>
            <TouchableOpacity onPress={() => setShowPaymentMethods(true)}>
              <Text style={styles.sectionManage}>Manage</Text>
            </TouchableOpacity>
          </View>
          {isLoadingPaymentMethods ? (
            <View style={styles.accountCard}>
              <Text style={styles.accountName}>Loading payment methods...</Text>
            </View>
          ) : paymentMethods.length > 0 ? (
            paymentMethods.slice(0, 2).map((paymentMethod) => (
              <View key={paymentMethod.id} style={styles.accountCard}>
                <View style={styles.accountIcon}>
                  <MaterialIcons name="credit-card" size={24} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>
                    {paymentMethod.card.brand.toUpperCase()} •••• •••• •••• {paymentMethod.card.last4}
                  </Text>
                  <Text style={styles.accountSub}>
                    Expires {paymentMethod.card.exp_month}/{paymentMethod.card.exp_year}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.accountCard}>
              <View style={styles.accountIcon}>
                <MaterialIcons name="add" size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountName}>No payment methods</Text>
                <Text style={styles.accountSub}>Add a card to get started</Text>
              </View>
            </View>
          )}
        </View>
        {/* Bounty Postings Section */}
        <View style={[styles.sectionPad, { flex: 1 }]}> 
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Bounty Postings</Text>
            <TouchableOpacity onPress={() => setShowTransactionHistory(true)}>
              <Text style={styles.sectionManage}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.bountyCard}>
            <Text style={styles.bountyName}>Bounty</Text>
            <Text style={styles.bountyAmount}>$15.00</Text>
          </View>
          <View style={styles.bountyCard}>
            <Text style={styles.bountyName}>Bounty</Text>
            <Text style={styles.bountyAmount}>$25.00</Text>
          </View>
        </View>
      </ScrollView>
      {/* Bottom navigation is now provided at app level; bottom padding ensures content isn't obscured */}
      <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
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
    justifyContent: 'space-between',
    paddingTop: 32,
    paddingHorizontal: 16,
    backgroundColor: '#059669',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  backButton: {
    padding: 8,
  },
  sectionPad: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  balanceCard: {
    backgroundColor: '#047857',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    marginBottom: 8,
  },
  balanceCardHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 4,
  },
  balanceActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#065f46',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flex: 1,
    marginHorizontal: 4,
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionManage: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: 'bold',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#047857cc',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  accountIcon: {
    height: 48,
    width: 48,
    backgroundColor: '#065f46',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  accountName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  accountSub: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  bountyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#047857cc',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  bountyName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bountyAmount: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // bottom nav indicator removed; using shared BottomNav at app level
});

