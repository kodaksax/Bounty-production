"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
import { receiptService } from "lib/services/receipt-service"
import { useState } from "react"
import { 
  Alert, 
  Text, 
  TouchableOpacity, 
  View, 
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator
} from "react-native"
import type { Transaction } from "./transaction-history-screen"

interface TransactionDetailModalProps {
  visible: boolean
  transaction: Transaction
  onClose: () => void
}

export function TransactionDetailModal({ visible, transaction, onClose }: TransactionDetailModalProps) {
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false)

  const handleClose = () => {
    if (!isGeneratingReceipt) {
      onClose()
    }
  }

  // Handle receipt generation
  const handleGenerateReceipt = async () => {
    setIsGeneratingReceipt(true)
    try {
      const success = await receiptService.shareReceipt(transaction as any)
      if (!success) {
        Alert.alert('Receipt Generation', 'Unable to share receipt on this device.')
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to generate receipt. Please try again.')
    } finally {
      setIsGeneratingReceipt(false)
    }
  }

  // Get transaction icon based on type
  const getTransactionIcon = () => {
    switch (transaction.type) {
      case "deposit":
        return <MaterialIcons name="keyboard-arrow-down" size={24} color="#10b981" />
      case "withdrawal":
        return <MaterialIcons name="keyboard-arrow-up" size={24} color="#10b981" />
      case "bounty_posted":
        return <MaterialIcons name="gps-fixed" size={24} color="#10b981" />
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <MaterialIcons name="receipt-long" size={24} color="#10b981" />
              <Text style={styles.headerTitle}>Transaction Details</Text>
            </View>
            <TouchableOpacity 
              onPress={handleClose} 
              disabled={isGeneratingReceipt}
              style={styles.closeButton}
            >
              <MaterialIcons name="close" size={24} color="#d1fae5" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            {/* Transaction Summary */}
            <View style={styles.summaryContainer}>
              <View style={styles.summaryHeader}>
                <View style={styles.iconContainer}>
                  {getTransactionIcon()}
                </View>
                <View style={styles.summaryTextContainer}>
                  <Text style={styles.summaryTitle}>{getTransactionTitle()}</Text>
                  <Text style={styles.summaryDate}>
                    {format(transaction.date, "MMMM d, yyyy")} at {format(transaction.date, "h:mm a")}
                  </Text>
                </View>
              </View>

              <View style={styles.amountContainer}>
                <Text
                  style={[
                    styles.amount,
                    transaction.amount > 0 ? styles.amountPositive : styles.amountNegative,
                  ]}
                >
                  {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
                </Text>
              </View>

              <Text style={styles.description}>{getTransactionDescription()}</Text>
            </View>

            {/* Transaction Details */}
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsTitle}>Details</Text>

              <View style={styles.detailsList}>
                <View style={styles.detailRow}>
                  <View style={styles.detailIconContainer}>
                    <MaterialIcons name="info" size={16} color="#6ee7b7" />
                  </View>
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Transaction ID</Text>
                    <Text style={styles.detailValue}>{transaction.id}</Text>
                  </View>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconContainer}>
                    <MaterialIcons name="calendar-today" size={16} color="#6ee7b7" />
                  </View>
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Date</Text>
                    <Text style={styles.detailValue}>{format(transaction.date, "MMMM d, yyyy")}</Text>
                  </View>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconContainer}>
                    <MaterialIcons name="schedule" size={16} color="#6ee7b7" />
                  </View>
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Time</Text>
                    <Text style={styles.detailValue}>{format(transaction.date, "h:mm:ss a")}</Text>
                  </View>
                </View>

                {transaction.details.status && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconContainer}>
                      <MaterialIcons name="check-circle" size={16} color="#6ee7b7" />
                    </View>
                    <View style={styles.detailTextContainer}>
                      <Text style={styles.detailLabel}>Status</Text>
                      <Text style={styles.detailValue}>{transaction.details.status}</Text>
                    </View>
                  </View>
                )}

                {transaction.details.method && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconContainer}>
                      <MaterialIcons name="credit-card" size={16} color="#6ee7b7" />
                    </View>
                    <View style={styles.detailTextContainer}>
                      <Text style={styles.detailLabel}>Method</Text>
                      <Text style={styles.detailValue}>{transaction.details.method}</Text>
                    </View>
                  </View>
                )}

                {transaction.details.counterparty && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconContainer}>
                      <MaterialIcons name="person" size={16} color="#6ee7b7" />
                    </View>
                    <View style={styles.detailTextContainer}>
                      <Text style={styles.detailLabel}>
                        {transaction.type === "bounty_completed" ? "Paid to" : "From"}
                      </Text>
                      <Text style={styles.detailValue}>{transaction.details.counterparty}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Escrow Status if applicable */}
            {(transaction as any).escrowStatus && (
              <View style={styles.escrowContainer}>
                <View style={styles.escrowHeader}>
                  <MaterialIcons name="lock" size={20} color="#10b981" />
                  <Text style={styles.escrowTitle}>Escrow Information</Text>
                </View>
                <Text style={styles.escrowText}>
                  {(transaction as any).escrowStatus === 'funded' && 'Funds are held in escrow until bounty completion.'}
                  {(transaction as any).escrowStatus === 'released' && 'Funds have been released to the hunter.'}
                  {(transaction as any).escrowStatus === 'pending' && 'Escrow is pending verification.'}
                </Text>
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.actionsContainer}>
              <TouchableOpacity 
                onPress={handleGenerateReceipt} 
                disabled={isGeneratingReceipt}
                style={[
                  styles.primaryButton,
                  isGeneratingReceipt && styles.primaryButtonDisabled
                ]}
              >
                {isGeneratingReceipt ? (
                  <View style={styles.buttonContent}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.primaryButtonText}>Generating...</Text>
                  </View>
                ) : (
                  <View style={styles.buttonContent}>
                    <MaterialIcons name="receipt" size={20} color="#ffffff" />
                    <Text style={styles.primaryButtonText}>Generate Receipt</Text>
                  </View>
                )}
              </TouchableOpacity>
              
              <TouchableOpacity 
                onPress={handleClose}
                disabled={isGeneratingReceipt}
                style={[
                  styles.secondaryButton,
                  isGeneratingReceipt && styles.secondaryButtonDisabled
                ]}
              >
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "#059669", // emerald-600
    borderRadius: 16,
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#047857", // emerald-700
    borderBottomWidth: 1,
    borderBottomColor: "rgba(4, 120, 87, 0.5)",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  summaryContainer: {
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(4, 120, 87, 0.5)",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  iconContainer: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: "rgba(4, 120, 87, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  summaryTextContainer: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  summaryDate: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
  },
  amountContainer: {
    backgroundColor: "rgba(4, 120, 87, 0.5)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  amount: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  amountPositive: {
    color: "#6ee7b7", // emerald-400
  },
  amountNegative: {
    color: "#fca5a5", // red-300
  },
  description: {
    fontSize: 14,
    color: "#d1fae5", // emerald-100
    lineHeight: 20,
  },
  detailsContainer: {
    paddingTop: 20,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6ee7b7", // emerald-300
    marginBottom: 12,
  },
  detailsList: {
    gap: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailIconContainer: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "rgba(4, 120, 87, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  detailTextContainer: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: "#6ee7b7", // emerald-300
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: "#fff",
  },
  escrowContainer: {
    marginTop: 20,
    padding: 16,
    backgroundColor: "rgba(4, 120, 87, 0.5)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#059669",
  },
  escrowHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  escrowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  escrowText: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
    lineHeight: 20,
  },
  actionsContainer: {
    paddingTop: 20,
    gap: 12,
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#047857", // emerald-700
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  secondaryButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#059669", // emerald-600
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
})
