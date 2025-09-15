"use client"


import { ArrowDown, ArrowLeft, CreditCard, Plus, Target } from "lucide-react";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AddMoneyScreen } from "./add-money-screen";
import { PaymentMethodsModal } from "./payment-methods-modal";
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
  const [balance, setBalance] = useState(40)

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

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#059669', // emerald-600
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      paddingTop: 44, // Safe area inset for iPhone
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerIcon: {
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    backButton: {
      padding: 8,
    },
    balanceContainer: {
      paddingHorizontal: 16,
      marginBottom: 24,
    },
    balanceCard: {
      backgroundColor: '#047857', // emerald-700
      borderRadius: 12,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 8,
    },
    balanceTextContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    balanceLabel: {
      fontSize: 14,
      color: '#6EE7B7', // emerald-300
      fontWeight: '500',
      textTransform: 'uppercase',
    },
    balanceAmount: {
      fontSize: 36,
      fontWeight: 'bold',
      color: 'white',
      marginTop: 4,
    },
    buttonContainer: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    actionButton: {
      flex: 1,
      backgroundColor: '#065F46', // emerald-800
      paddingVertical: 12,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonIcon: {
      marginRight: 8,
    },
    actionButtonText: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
    },
    sectionContainer: {
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
    },
    manageButton: {
      padding: 8,
    },
    manageButtonText: {
      fontSize: 14,
      color: '#6EE7B7', // emerald-300
    },
    accountCard: {
      backgroundColor: 'rgba(6, 95, 70, 0.8)', // emerald-700/80
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    accountContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    accountIconContainer: {
      height: 48,
      width: 48,
      backgroundColor: '#065F46', // emerald-800
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    accountInfo: {
      flex: 1,
    },
    accountName: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
    },
    accountDetails: {
      fontSize: 14,
      color: '#6EE7B7', // emerald-300
    },
    scrollContainer: {
      flex: 1,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    bountyCard: {
      backgroundColor: 'rgba(6, 95, 70, 0.8)', // emerald-700/80
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    bountyContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    bountyLabel: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
    },
    bountyAmount: {
      fontSize: 16,
      fontWeight: '500',
      color: 'white',
    },
    navigationIndicator: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingBottom: 32, // Safe area inset
    },
    indicator: {
      height: 4,
      width: 4,
      borderRadius: 2,
      marginHorizontal: 4,
    },
    indicatorActive: {
      backgroundColor: 'white',
    },
    indicatorInactive: {
      backgroundColor: 'rgba(255, 255, 255, 0.5)',
    },
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Target color="#fff" size={20} style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <ArrowLeft color="#fff" size={20} />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Balance Card */}
        <View style={styles.sectionPad}>
          <View style={styles.balanceCard}>
            <View style={styles.balanceCardHeader}>
              <Text style={styles.balanceLabel}>BALANCE</Text>
              <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
            </View>
            <View style={styles.balanceActionsRow}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowAddMoney(true)}>
                <Plus color="#fff" size={20} style={{ marginRight: 8 }} />
                <Text style={styles.actionButtonText}>Add Money</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowWithdraw(true)}>
                <ArrowDown color="#fff" size={20} style={{ marginRight: 8 }} />
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
          <View style={styles.accountCard}>
            <View style={styles.accountIcon}><CreditCard color="#fff" size={24} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>VISA **** **** 3456</Text>
              <Text style={styles.accountSub}>Default Payment Method</Text>
            </View>
          </View>
          <View style={styles.accountCard}>
            <View style={styles.accountIcon}><CreditCard color="#fff" size={24} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>AMEX **** **** 7890</Text>
              <Text style={styles.accountSub}>Added 02/15/2025</Text>
            </View>
          </View>
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
      {/* Bottom Navigation Indicator */}
      <View style={styles.bottomNavRow}>
        <View style={styles.bottomNavDotActive} />
        <View style={styles.bottomNavDot} />
        <View style={styles.bottomNavDot} />
        <View style={styles.bottomNavDot} />
        <View style={styles.bottomNavDot} />
      </View>
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
  bottomNavRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 16,
    paddingTop: 8,
  },
  bottomNavDotActive: {
    height: 8,
    width: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginHorizontal: 4,
  },
  bottomNavDot: {
    height: 8,
    width: 8,
    borderRadius: 4,
    backgroundColor: '#fff6',
    marginHorizontal: 4,
  },
});

