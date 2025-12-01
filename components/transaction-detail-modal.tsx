"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
import { receiptService } from "lib/services/receipt-service"
import { useEffect, useRef, useState } from "react"
import { Alert, Animated, Easing, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import type { Transaction } from "./transaction-history-screen"

interface TransactionDetailModalProps {
  transaction: Transaction
  onClose: () => void
}

export function TransactionDetailModal({ transaction, onClose }: TransactionDetailModalProps) {
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false)
  const opacityAnim = useRef(new Animated.Value(0)).current
  const sheetAnim = useRef(new Animated.Value(40)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [opacityAnim, sheetAnim])

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 40, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onClose()
    })
  }

  const handleGenerateReceipt = async () => {
    setIsGeneratingReceipt(true)
    try {
      const success = await receiptService.shareReceipt(transaction as any)
      if (!success) Alert.alert('Receipt Generation', 'Unable to share receipt on this device.')
    } catch (error) {
      Alert.alert('Error', 'Failed to generate receipt. Please try again.')
    } finally {
      setIsGeneratingReceipt(false)
    }
  }

  // (Outside tap handled by Pressable backdrop below)

  // Get transaction icon based on type
  const getTransactionIcon = () => {
    switch (transaction.type) {
      case "deposit":
        return <MaterialIcons name="keyboard-arrow-down" size={24} color="#000000" />
      case "withdrawal":
        return <MaterialIcons name="keyboard-arrow-up" size={24} color="#000000" />
      case "bounty_posted":
        return <MaterialIcons name="gps-fixed" size={24} color="#000000" />
      case "bounty_completed":
        return <MaterialIcons name="check-circle" size={24} color="#60a5fa" />
      case "bounty_received":
        return <MaterialIcons name="credit-card" size={24} color="#a78bfa" />
    }
  }

  // Get transaction title based on type
  const getTransactionTitle = () => {
    switch (transaction.type) {
      case "deposit":
        return `Deposit via ${transaction.details.method}`
      case "withdrawal":
        return `Withdrawal to ${transaction.details.method}`
      case "bounty_posted":
        return `Posted Bounty: ${transaction.details.title}`
      case "bounty_completed":
        return `Completed Bounty: ${transaction.details.title}`
      case "bounty_received":
        return `Received Bounty Payment: ${transaction.details.title}`
    }
  }

  // Get transaction description based on type
  const getTransactionDescription = () => {
    switch (transaction.type) {
      case "deposit":
        return `You added funds to your account using ${transaction.details.method}.`
      case "withdrawal":
        return `You withdrew funds from your account to ${transaction.details.method}.`
      case "bounty_posted":
        return `You posted a bounty titled "${transaction.details.title}" and the funds were reserved from your account.`
      case "bounty_completed":
        return `You completed the bounty "${transaction.details.title}" posted by ${transaction.details.counterparty}.`
      case "bounty_received":
        return `You received payment for the bounty "${transaction.details.title}" from ${transaction.details.counterparty}.`
    }
  }

  return (
    <Animated.View style={[styles.backdrop, { opacity: opacityAnim }]}>      
      <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close transaction details" />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}>        
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close transaction details"
            onPress={handleClose}
            style={styles.headerButton}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Transaction Details</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <View style={styles.summarySection}>
          <View style={styles.summaryHeaderRow}>
            <View style={styles.summaryIcon}>{getTransactionIcon()}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryTitle}>{getTransactionTitle()}</Text>
              <Text style={styles.summaryMeta}>{format(transaction.date, 'MMMM d, yyyy')} at {format(transaction.date, 'h:mm a')}</Text>
            </View>
          </View>
          <View style={styles.amountPill}>
            <Text style={[styles.amountText, transaction.amount > 0 ? styles.amountPositive : styles.amountNegative]}>{transaction.amount > 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}</Text>
          </View>
          <Text style={styles.descriptionText}>{getTransactionDescription()}</Text>
        </View>

        <View style={styles.detailSection}>
          <Text style={styles.detailHeading}>Details</Text>
          <View style={styles.detailList}>
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><MaterialIcons name="info" size={16} color="#80c795" /></View>
              <View style={styles.detailContent}><Text style={styles.detailLabel}>Transaction ID</Text><Text style={styles.detailValue}>{transaction.id}</Text></View>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><MaterialIcons name="calendar-today" size={16} color="#80c795" /></View>
              <View style={styles.detailContent}><Text style={styles.detailLabel}>Date</Text><Text style={styles.detailValue}>{format(transaction.date,'MMMM d, yyyy')}</Text></View>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><MaterialIcons name="schedule" size={16} color="#80c795" /></View>
              <View style={styles.detailContent}><Text style={styles.detailLabel}>Time</Text><Text style={styles.detailValue}>{format(transaction.date,'h:mm:ss a')}</Text></View>
            </View>
            {transaction.details.status && (
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}><MaterialIcons name="check-circle" size={16} color="#80c795" /></View>
                <View style={styles.detailContent}><Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{transaction.details.status}</Text></View>
              </View>
            )}
            {transaction.details.method && (
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}><MaterialIcons name="credit-card" size={16} color="#80c795" /></View>
                <View style={styles.detailContent}><Text style={styles.detailLabel}>Method</Text><Text style={styles.detailValue}>{transaction.details.method}</Text></View>
              </View>
            )}
            {transaction.details.counterparty && (
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}><MaterialIcons name="gps-fixed" size={16} color="#80c795" /></View>
                <View style={styles.detailContent}><Text style={styles.detailLabel}>{transaction.type === 'bounty_completed' ? 'Paid to' : 'From'}</Text><Text style={styles.detailValue}>{transaction.details.counterparty}</Text></View>
              </View>
            )}
          </View>
        </View>

        {(transaction as any).escrowStatus && (
          <View style={styles.escrowBlock}>
            <View style={styles.escrowHeaderRow}>
              <MaterialIcons name="lock" size={18} color="#008e2a" />
              <Text style={styles.escrowTitle}>Escrow Information</Text>
            </View>
            <Text style={styles.escrowText}>
              {(transaction as any).escrowStatus === 'funded' && 'Funds are held in escrow until bounty completion.'}
              {(transaction as any).escrowStatus === 'released' && 'Funds have been released to the hunter.'}
              {(transaction as any).escrowStatus === 'pending' && 'Escrow is pending verification.'}
            </Text>
          </View>
        )}

        <View style={styles.actionsSection}>
          <TouchableOpacity
            onPress={handleGenerateReceipt}
            disabled={isGeneratingReceipt}
            style={[styles.actionPrimary, isGeneratingReceipt && styles.actionPrimaryDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Generate receipt for this transaction"
          >
            <MaterialIcons name="receipt" size={20} color="#ffffff" />
            <Text style={styles.actionPrimaryText}>{isGeneratingReceipt ? 'Generating…' : 'Generate Receipt'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.actionSecondary}
            accessibilityRole="button"
            accessibilityLabel="Close transaction details"
          >
            <Text style={styles.actionSecondaryText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  sheet: {
    backgroundColor: '#008e2a',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingBottom: Platform.OS === 'ios' ? 28 : 20,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 18 : 12,
    paddingBottom: 12,
  },
  headerButton: { padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerButtonPlaceholder: { width: 44, height: 44 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  summarySection: { paddingHorizontal: 24, paddingBottom: 20 },
  summaryHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  summaryIcon: { height: 48, width: 48, borderRadius: 24, backgroundColor: 'rgba(0,92,28,0.4)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  summaryTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  summaryMeta: { color: '#d5ecdc', fontSize: 13 },
  amountPill: { backgroundColor: 'rgba(0,92,28,0.55)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 14 },
  amountText: { fontSize: 24, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
  amountPositive: { color: '#80c795' },
  amountNegative: { color: '#fca5a5' },
  descriptionText: { color: '#ecfdf5', fontSize: 13, lineHeight: 18 },
  detailSection: { paddingHorizontal: 24, paddingBottom: 8 },
  detailHeading: { color: '#80c795', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  detailList: { gap: 14 },
  detailRow: { flexDirection: 'row', alignItems: 'center' },
  detailIcon: { height: 32, width: 32, borderRadius: 16, backgroundColor: 'rgba(0,92,28,0.5)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  detailContent: { flex: 1 },
  detailLabel: { color: '#80c795', fontSize: 11, marginBottom: 2 },
  detailValue: { color: '#fff', fontSize: 14, fontWeight: '500' },
  escrowBlock: { marginHorizontal: 24, marginTop: 12, marginBottom: 8, backgroundColor: 'rgba(0,92,28,0.5)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#007523' },
  escrowHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 },
  escrowTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 6 },
  escrowText: { color: '#d5ecdc', fontSize: 12, lineHeight: 18 },
  actionsSection: { paddingHorizontal: 24, paddingTop: 10, gap: 12 },
  actionPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#005c1c', paddingVertical: 14, borderRadius: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  actionPrimaryDisabled: { opacity: 0.6 },
  actionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 8 },
  actionSecondary: { backgroundColor: '#007523', paddingVertical: 14, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  actionSecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
