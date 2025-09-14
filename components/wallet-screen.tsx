"use client"

import { useState } from "react"
import { CreditCard, Plus, ArrowDown, ArrowLeft } from "lucide-react"
import { Target } from "lucide-react"
import { WithdrawScreen } from "./withdraw-screen"
import { AddMoneyScreen } from "./add-money-screen"
import { PaymentMethodsModal } from "./payment-methods-modal"
import { TransactionHistoryScreen } from "./transaction-history-screen"
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

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
    return <WithdrawScreen onBack={() => setShowWithdraw(false)} balance={balance} />
  }

  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={handleAddMoney} />
  }

  if (showTransactionHistory) {
    return <TransactionHistoryScreen onBack={() => setShowTransactionHistory(false)} />
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
      {/* Header - iPhone optimized with safe area inset */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Target color="white" size={20} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <ArrowLeft color="white" size={20} />
          </TouchableOpacity>
        )}
      </View>

      {/* Balance Card */}
      <View style={styles.balanceContainer}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceTextContainer}>
            <Text style={styles.balanceLabel}>BALANCE</Text>
            <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowAddMoney(true)}
            >
              <Plus color="white" size={20} style={styles.actionButtonIcon} />
              <Text style={styles.actionButtonText}>Add Money</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowWithdraw(true)}
            >
              <ArrowDown color="white" size={20} style={styles.actionButtonIcon} />
              <Text style={styles.actionButtonText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Linked Accounts Section */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Linked Accounts</Text>
          <TouchableOpacity 
            style={styles.manageButton}
            onPress={() => setShowPaymentMethods(true)}
          >
            <Text style={styles.manageButtonText}>Manage</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.accountCard}>
          <View style={styles.accountContent}>
            <View style={styles.accountIconContainer}>
              <CreditCard color="white" size={24} />
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>VISA **** **** 3456</Text>
              <Text style={styles.accountDetails}>Default Payment Method</Text>
            </View>
          </View>
        </View>

        <View style={styles.accountCard}>
          <View style={styles.accountContent}>
            <View style={styles.accountIconContainer}>
              <CreditCard color="white" size={24} />
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>AMEX **** **** 7890</Text>
              <Text style={styles.accountDetails}>Added 02/15/2025</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Bounty Postings Section */}
      <ScrollView style={styles.scrollContainer}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Bounty Postings</Text>
          <TouchableOpacity
            style={styles.manageButton}
            onPress={() => setShowTransactionHistory(true)}
          >
            <Text style={styles.manageButtonText}>View All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bountyCard}>
          <View style={styles.bountyContent}>
            <Text style={styles.bountyLabel}>Bounty</Text>
            <Text style={styles.bountyAmount}>$15.00</Text>
          </View>
        </View>

        <View style={styles.bountyCard}>
          <View style={styles.bountyContent}>
            <Text style={styles.bountyLabel}>Bounty</Text>
            <Text style={styles.bountyAmount}>$25.00</Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Navigation Indicator - With safe area inset */}
      <View style={styles.navigationIndicator}>
        <View style={[styles.indicator, styles.indicatorActive]} />
        <View style={[styles.indicator, styles.indicatorInactive]} />
        <View style={[styles.indicator, styles.indicatorInactive]} />
        <View style={[styles.indicator, styles.indicatorInactive]} />
        <View style={[styles.indicator, styles.indicatorInactive]} />
      </View>

      {/* Payment Methods Modal */}
      <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
    </View>
  )
}
