"use client"


import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { PaymentMethodsModal } from "../../components/payment-methods-modal";
import { stripeService } from '../../lib/services/stripe-service';
import { useStripe } from '../../lib/stripe-context';
import { useWallet } from '../../lib/wallet-context';
import { AddMoneyScreen } from "./add-money-screen";
import { TransactionHistoryScreen } from "./transaction-history-screen";
import { WithdrawScreen } from "./withdraw-screen";


interface WalletScreenProps {
  onBack?: () => void
}

export function WalletScreen({ onBack }: WalletScreenProps = {}) {
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const { balance, deposit, transactions } = useWallet();
  const { paymentMethods, isLoading: stripeLoading } = useStripe();

  const handleAddMoney = async (amount: number) => {
    // AddMoneyScreen now handles Stripe integration internally
    setShowAddMoney(false);
  };

  // Filter bounty related transactions (posted/completed/received)
  const bountyTransactions = useMemo(() => transactions
    .filter(t => t.type === 'bounty_posted' || t.type === 'bounty_completed' || t.type === 'bounty_received')
    .slice(0, 20) // cap for now
  , [transactions]);

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
          <MaterialIcons name="gps-fixed" size={20} color="#fffef5" />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
      </View>
  
        {/* Balance Card */}
        <View style={styles.sectionPad}>
          <View style={styles.balanceCard}>
            <View style={styles.balanceCardHeader}>
              <Text style={styles.balanceLabel}>BALANCE</Text>
              <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
            </View>
            <View style={styles.balanceActionsRow}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowAddMoney(true)}>
                <MaterialIcons name="add" size={20} color="#fffef5" />
                <Text style={styles.actionButtonText}>Add Money</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowWithdraw(true)}>
                <MaterialIcons name="keyboard-arrow-down" size={20} color="#fffef5" />
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

          {/* Only the account cards scroll; header remains fixed */}
          <ScrollView
            style={{ maxHeight: 180 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {stripeLoading ? (
              <View style={[styles.accountCard, { justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.accountName}>Loading payment methods...</Text>
              </View>
            ) : paymentMethods.length === 0 ? (
              <TouchableOpacity 
                style={styles.accountCard}
                onPress={() => setShowPaymentMethods(true)}
              >
                <View style={styles.accountIcon}>
                  <MaterialIcons name="add" size={24} color="#fffef5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>Add Payment Method</Text>
                  <Text style={styles.accountSub}>No payment methods added yet</Text>
                </View>
              </TouchableOpacity>
            ) : (
              paymentMethods.map((method, index) => (
                <View key={method.id} style={styles.accountCard}>
                  <View style={styles.accountIcon}>
                    <MaterialIcons name="credit-card" size={24} color="#fffef5" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountName}>
                      {stripeService.formatCardDisplay(method)}
                    </Text>
                    <Text style={styles.accountSub}>
                      {index === 0 ? 'Default Payment Method' : `Added ${new Date(method.created * 1000).toLocaleDateString()}`}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
          


        {/* Bounty Postings Section */}
        
  <View style={[styles.sectionPad, { flex: 1, marginTop: 8 }]}> 
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Bounty Postings</Text>
            <TouchableOpacity onPress={() => setShowTransactionHistory(true)}>
              <Text style={styles.sectionManage}>View All</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={{ flex: 1 }}>
            {bountyTransactions.length === 0 ? (
              <View style={styles.emptyState}> 
                <Text style={styles.emptyStateText}>No bounty transactions yet</Text>
              </View>
            ) : bountyTransactions.map(tx => (
              <View key={tx.id} style={styles.bountyCard}>
                <Text style={styles.bountyName}>{
                  tx.type === 'bounty_posted' ? 'Posted' : tx.type === 'bounty_completed' ? 'Completed' : 'Received'
                } {tx.details.title ? `· ${tx.details.title}` : ''}</Text>
                <Text style={[styles.bountyAmount, {color: tx.amount > 0 ? '#00912C' : '#dc2626'}]}>{tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
        
      {/* Bottom navigation is now provided at app level; bottom padding ensures content isn't obscured */}
      <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
    </View>
  );

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e', // Updated to use new primary background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 32,
    paddingHorizontal: 16,
    backgroundColor: '#2d5240', // Updated to use new secondary background
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fffef5', // Company specified header text/logos color
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
    backgroundColor: '#2d5240', // Updated to use new secondary background
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
    color: '#c3c3c4', // Company specified subtle highlight color
    fontSize: 14,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  balanceAmount: {
    color: '#fffef5', // Company specified header text/logos color
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
    backgroundColor: '#61656b', // Company specified trim color
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flex: 1,
    marginHorizontal: 4,
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#fffef5', // Company specified header text/logos color
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
    color: '#fffef5', // Company specified header text/logos color
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionManage: {
    color: '#929497', // Company specified highlight color
    fontSize: 14,
    fontWeight: 'bold',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(45, 82, 64, 0.8)', // Updated to use new secondary background with transparency
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
    backgroundColor: '#61656b', // Company specified trim color
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  accountName: {
    color: '#fffef5', // Company specified header text/logos color
    fontSize: 16,
    fontWeight: 'bold',
  },
  accountSub: {
    color: '#929497', // Company specified highlight color
    fontSize: 13,
  },
  bountyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(45, 82, 64, 0.8)', // Updated to use new secondary background with transparency
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  bountyName: {
    color: '#fffef5', // Company specified header text/logos color
    fontSize: 16,
    fontWeight: 'bold',
  },
  bountyAmount: {
    color: '#fffef5', // Company specified header text/logos color
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#c3c3c4', // Company specified subtle highlight color
    fontSize: 14,
    opacity: 0.9,
  },
  // bottom nav indicator removed; using shared BottomNav at app level
});

