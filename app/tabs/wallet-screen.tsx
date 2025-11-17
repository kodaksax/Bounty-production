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
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY, COLORS, RADIUS, SHADOWS } from '../../lib/constants/accessibility';
import { stripeService } from '../../lib/services/stripe-service';
import { useStripe } from '../../lib/stripe-context';
import { useWallet } from '../../lib/wallet-context';


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
            color={COLORS.TEXT_PRIMARY}
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
                <MaterialIcons name="add" size={20} color={COLORS.TEXT_PRIMARY} accessibilityElementsHidden={true} />
                <Text style={styles.actionButtonText}>Add Money</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={() => setShowWithdraw(true)}
                accessibilityRole="button"
                accessibilityLabel="Withdraw money from wallet"
                accessibilityHint="Transfer funds from your wallet to your bank account"
              >
                <MaterialIcons name="keyboard-arrow-down" size={20} color={COLORS.TEXT_PRIMARY} accessibilityElementsHidden={true} />
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
                  <MaterialIcons name="add" size={24} color={COLORS.TEXT_PRIMARY} />
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
                    <MaterialIcons name="credit-card" size={24} color={COLORS.TEXT_PRIMARY} />
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
          
          <View style={{ minHeight: 200 }}>
            {transactions.length === 0 ? (
              <EmptyState
                icon="receipt-long"
                title="No Transactions Yet"
                description="Your bounty transactions will appear here once you post or complete a bounty."
                actionLabel="Browse Bounties"
                onAction={() => {}}
                style={{ paddingVertical: 40 }}
              />
            ) : (
              <>
                {bountyTransactions.map(tx => (
                  <View key={tx.id} style={styles.bountyCard}>
                    <Text style={styles.bountyName}>{
                      tx.type === 'bounty_posted' ? 'Posted' : tx.type === 'bounty_completed' ? 'Completed' : 'Received'
                    } {tx.details.title ? `· ${tx.details.title}` : ''}</Text>
                    <Text style={[styles.bountyAmount, {color: tx.amount > 0 ? COLORS.SUCCESS_LIGHT : COLORS.ERROR_LIGHT}]}>{tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}</Text>
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
    backgroundColor: COLORS.BG_PRIMARY, // emerald-600
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: SPACING.SECTION_GAP - 4,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    backgroundColor: COLORS.BG_PRIMARY,
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
    color: COLORS.TEXT_PRIMARY,
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
    backgroundColor: COLORS.BG_SECONDARY, // emerald-700
    borderRadius: RADIUS.LG,
    padding: SPACING.SECTION_GAP - 4,
    ...SHADOWS.MD,
    marginBottom: SPACING.COMPACT_GAP,
  },
  balanceCardHeader: {
    alignItems: 'center',
    marginBottom: SPACING.SCREEN_HORIZONTAL,
  },
  balanceLabel: {
    color: COLORS.TEXT_ACCENT, // emerald-300
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    textTransform: 'uppercase',
    fontWeight: 'bold',
    letterSpacing: TYPOGRAPHY.LETTER_SPACING_WIDER,
  },
  balanceAmount: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_XLARGE + 8,
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
    backgroundColor: COLORS.BG_SURFACE, // emerald-800
    borderRadius: RADIUS.MD,
    paddingVertical: SPACING.ELEMENT_GAP,
    paddingHorizontal: SPACING.CARD_PADDING + 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    gap: SPACING.COMPACT_GAP,
    ...SHADOWS.SM,
  },
  actionButtonText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  sectionTitle: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  sectionManage: {
    color: COLORS.TEXT_ACCENT, // emerald-300
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.BG_OVERLAY, // emerald-900 with opacity
    borderRadius: RADIUS.MD,
    padding: SPACING.CARD_PADDING,
    marginBottom: SPACING.LIST_ITEM_GAP + 8,
    ...SHADOWS.SM,
    minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SUBTLE,
  },
  accountIcon: {
    height: SIZING.AVATAR_MEDIUM,
    width: SIZING.AVATAR_MEDIUM,
    backgroundColor: COLORS.BG_SURFACE, // emerald-800
    borderRadius: RADIUS.SM,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.ELEMENT_GAP,
  },
  accountName: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
    marginBottom: 2,
  },
  accountSub: {
    color: COLORS.TEXT_SECONDARY, // emerald-100
    fontSize: TYPOGRAPHY.SIZE_XSMALL,
  },
  bountyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.BG_OVERLAY, // emerald-900 with opacity
    borderRadius: RADIUS.MD,
    padding: SPACING.CARD_PADDING,
    marginBottom: SPACING.LIST_ITEM_GAP + 8,
    ...SHADOWS.SM,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SUBTLE,
  },
  bountyName: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
    flex: 1,
  },
  bountyAmount: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: 'bold',
  },
  emptyState: {
    paddingVertical: SPACING.SECTION_GAP,
    alignItems: 'center',
  },
  emptyStateText: {
    color: COLORS.TEXT_ACCENT,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    opacity: 0.9,
  },
});

