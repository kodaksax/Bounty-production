"use client"


import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AddMoneyScreen } from "../../components/add-money-screen";
import { PaymentMethodsModal } from "../../components/payment-methods-modal";
import { TransactionHistoryScreen } from "../../components/transaction-history-screen";
import { EmptyState } from "../../components/ui/empty-state";
import { PaymentMethodSkeleton } from "../../components/ui/skeleton-loaders";
import { WithdrawScreen } from "../../components/withdraw-screen";
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility';
import { stripeService } from '../../lib/services/stripe-service';
import { useStripe } from '../../lib/stripe-context';
import { useWallet, type WalletTransactionRecord } from '../../lib/wallet-context';


interface WalletScreenProps {
  onBack?: () => void
}

export function WalletScreen({ onBack }: WalletScreenProps = {}) {
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const { balance, transactions } = useWallet();
  const { paymentMethods, isLoading: stripeLoading, loadPaymentMethods } = useStripe();

  

  const handleAddMoney = async (amount: number) => {
    // AddMoneyScreen now handles Stripe integration internally
    setShowAddMoney(false);
  };

  // Get recent transactions for preview (show all types, not just bounty-related)
  const recentTransactions = useMemo(() => transactions
    .slice(0, 5) // show most recent 5 transactions as preview
  , [transactions]);

  // Helper function to get transaction label
  const getTransactionLabel = (tx: WalletTransactionRecord): string => {
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
  };

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
    <>
    <ScrollView 
      style={styles.container}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MaterialIcons 
            name="gps-fixed" 
            size={24} 
            color="#fff" 
            accessibilityElementsHidden={true}
          />
          <Text 
            style={styles.headerTitle}
            accessibilityRole="header"
          >
            BOUNTY
          </Text>
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
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={() => setShowAddMoney(true)}
                accessibilityRole="button"
                accessibilityLabel="Add money to wallet"
                accessibilityHint="Add funds to your wallet using a payment method"
              >
                <MaterialIcons name="add" size={20} color="#fff" accessibilityElementsHidden={true} />
                <Text style={styles.actionButtonText}>Add Money</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={() => setShowWithdraw(true)}
                accessibilityRole="button"
                accessibilityLabel="Withdraw money from wallet"
                accessibilityHint="Transfer funds from your wallet to your bank account"
              >
                <MaterialIcons name="keyboard-arrow-down" size={20} color="#fff" accessibilityElementsHidden={true} />
                <Text style={styles.actionButtonText}>Withdraw</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>


        {/* Linked Accounts Section */}
        <View style={styles.sectionPad}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Linked Accounts</Text>
            <TouchableOpacity 
              onPress={() => setShowPaymentMethods(true)}
              accessibilityRole="button"
              accessibilityLabel="Manage payment methods"
              accessibilityHint="Add, remove, or update payment methods"
            >
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
              <View style={{ paddingVertical: 8 }}>
                <PaymentMethodSkeleton />
                <PaymentMethodSkeleton />
              </View>
            ) : paymentMethods.length === 0 ? (
              <TouchableOpacity 
                style={styles.accountCard}
                onPress={() => setShowPaymentMethods(true)}
              >
                <View style={styles.accountIcon}>
                  <MaterialIcons name="add" size={24} color="#fff" />
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
                    <MaterialIcons name="credit-card" size={24} color="#fff" />
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
          


        {/* Transaction History Section */}
        
  <View style={[styles.sectionPad, { flex: 1, marginTop: 8 }]}> 
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Transaction History</Text>
            <TouchableOpacity onPress={() => setShowTransactionHistory(true)}>
              <Text style={styles.sectionManage}>View All</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ minHeight: 200 }}>
            {transactions.length === 0 ? (
              <EmptyState
                icon="receipt-long"
                title="No Transactions Yet"
                description="Your transaction history will appear here once you add funds, post, or complete a bounty."
                actionLabel="Browse Bounties"
                onAction={() => {}}
                style={{ paddingVertical: 40 }}
              />
            ) : (
              <>
                {recentTransactions.map(tx => (
                  <View key={tx.id} style={styles.bountyCard}>
                    <Text style={styles.bountyName}>{getTransactionLabel(tx)}</Text>
                    <Text style={[styles.bountyAmount, {color: tx.amount > 0 ? '#6ee7b7' : '#fca5a5'}]}>{tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </View>
        
      {/* Bottom navigation is now provided at app level; bottom padding ensures content isn't obscured */}
    </ScrollView>

    {/* Modals should be rendered outside the main ScrollView to avoid nesting VirtualizedLists */}
    <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
    </>
  );

}

export default WalletScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 20,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    backgroundColor: '#059669',
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    transform: [
      { translateY: -2 },
      { translateX: -2 },
    ],
  },
  headerTitle: {
    color: '#fff',
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
    backgroundColor: '#047857',
    borderRadius: SPACING.SCREEN_HORIZONTAL,
    padding: 20,
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
    color: '#6ee7b7',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
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
    marginTop: SPACING.ELEMENT_GAP,
    gap: SPACING.COMPACT_GAP,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#065f46',
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
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  sectionManage: {
    color: '#6ee7b7',
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
    backgroundColor: '#047857cc',
    borderRadius: SPACING.ELEMENT_GAP,
    padding: SPACING.SCREEN_HORIZONTAL,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
  },
  accountIcon: {
    height: SIZING.AVATAR_MEDIUM,
    width: SIZING.AVATAR_MEDIUM,
    backgroundColor: '#065f46',
    borderRadius: SPACING.COMPACT_GAP,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.ELEMENT_GAP,
  },
  accountName: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  accountSub: {
    color: '#6ee7b7',
    fontSize: TYPOGRAPHY.SIZE_SMALL - 1,
  },
  bountyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#047857cc',
    borderRadius: SPACING.ELEMENT_GAP,
    padding: SPACING.SCREEN_HORIZONTAL,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  bountyName: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  bountyAmount: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  emptyState: {
    paddingVertical: SPACING.SECTION_GAP,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#6ee7b7',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    opacity: 0.9,
  },
  // bottom nav indicator removed; using shared BottomNav at app level
});

