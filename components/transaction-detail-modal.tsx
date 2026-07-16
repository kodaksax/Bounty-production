"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
import { receiptService } from "lib/services/receipt-service"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAppThemeContext } from "../lib/themes/AppThemeContext"
import type { AppTheme } from "../lib/themes/types"
import type { Transaction } from "./transaction-history-screen"

const DEFAULT_TITLE = 'Transaction'

interface TransactionDetailModalProps {
  transaction: Transaction
  onClose: () => void
}

function getStatusColor(t: AppTheme, status?: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return t.success
    case 'failed':
      return t.error
    case 'pending':
      return t.warning
    default:
      return t.textSecondary
  }
}

export function TransactionDetailModal({ transaction, onClose }: TransactionDetailModalProps) {
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false)
  const opacityAnim = useRef(new Animated.Value(0)).current
  const sheetAnim = useRef(new Animated.Value(40)).current
  const { theme } = useAppThemeContext()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const s = useMemo(() => makeStyles(theme), [theme])

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
        return <MaterialIcons name="keyboard-arrow-down" size={24} color={theme.text} />
      case "withdrawal":
        return <MaterialIcons name="keyboard-arrow-up" size={24} color={theme.text} />
      case "bounty_posted":
        return <MaterialIcons name="gps-fixed" size={24} color={theme.text} />
      case "bounty_completed":
        return <MaterialIcons name="check-circle" size={24} color={theme.info} />
      case "bounty_received":
        return <MaterialIcons name="credit-card" size={24} color="#a78bfa" />
      case "escrow":
        return <MaterialIcons name="lock" size={24} color={theme.warning} />
      case "release":
        return <MaterialIcons name="lock-open" size={24} color={theme.primary} />
      case "refund":
        return <MaterialIcons name="refresh" size={24} color={theme.completed} />
      default:
        return <MaterialIcons name="receipt-long" size={24} color={theme.textSecondary} />
    }
  }

  // Get transaction title based on type — always falls back to a sensible
  // default instead of rendering "undefined" when details.title is missing.
  const getTransactionTitle = () => {
    const title = transaction.details.title || DEFAULT_TITLE
    switch (transaction.type) {
      case "deposit":
        return `Deposit via ${transaction.details.method || 'Card'}`
      case "withdrawal":
        return `Withdrawal to ${transaction.details.method || 'Bank Account'}`
      case "bounty_posted":
        return `Posted Bounty: ${title}`
      case "bounty_completed":
        return `Completed Bounty: ${title}`
      case "bounty_received":
        return `Received Bounty Payment: ${title}`
      case "escrow":
        return `Escrow Hold: ${title}`
      case "release":
        return `Escrow Released: ${title}`
      case "refund":
        return `Refund: ${title}`
      default:
        return title
    }
  }

  // Get transaction description based on type. `counterparty` is only ever
  // populated for the same session that just performed the release/refund
  // (see lib/wallet-context.tsx) — GET /wallet/transactions does not return
  // it on reload, so this must degrade gracefully rather than print "undefined".
  const getTransactionDescription = () => {
    const title = transaction.details.title || DEFAULT_TITLE
    const counterparty = transaction.details.counterparty
    switch (transaction.type) {
      case "deposit":
        return `You added funds to your account${transaction.details.method ? ` using ${transaction.details.method}` : ''}.`
      case "withdrawal":
        return `You withdrew funds from your account${transaction.details.method ? ` to ${transaction.details.method}` : ''}.`
      case "bounty_posted":
        return `You posted a bounty titled "${title}" and the funds were reserved from your account.`
      case "bounty_completed":
        return `You completed the bounty "${title}"${counterparty ? ` posted by ${counterparty}` : ''}.`
      case "bounty_received":
        return `You received payment for the bounty "${title}"${counterparty ? ` from ${counterparty}` : ''}.`
      case "escrow":
        return `Funds for "${title}" are held in escrow until the bounty is completed.`
      case "release":
        return `Escrowed funds for "${title}" were released${counterparty ? ` to ${counterparty}` : ''}.`
      case "refund":
        return `Escrowed funds for "${title}" were refunded to your account.`
      default:
        return ''
    }
  }

  const description = getTransactionDescription()

  const escrowStatusText: Record<string, string> = {
    funded: 'Funds are held in escrow until bounty completion.',
    released: 'Funds have been released to the hunter.',
    pending: 'Escrow is pending verification.',
  }

  // Build the details list as data so rows (and dividers between them) stay
  // in sync with whichever fields are actually present, instead of five
  // near-identical JSX blocks that can drift out of sync.
  type DetailRow = {
    icon: keyof typeof MaterialIcons.glyphMap
    label: string
    value: string
    valueColor?: string
  }

  const detailRows = [
    { icon: 'info', label: 'Transaction ID', value: transaction.id, valueColor: undefined },
    { icon: 'calendar-today', label: 'Date', value: format(transaction.date, 'MMMM d, yyyy'), valueColor: undefined },
    { icon: 'schedule', label: 'Time', value: format(transaction.date, 'h:mm:ss a'), valueColor: undefined },
    transaction.details.status
      ? {
          icon: 'check-circle',
          label: 'Status',
          value: transaction.details.status,
          valueColor: getStatusColor(theme, transaction.details.status),
        }
      : null,
    transaction.details.method
      ? { icon: 'credit-card', label: 'Method', value: transaction.details.method, valueColor: undefined }
      : null,
    transaction.details.counterparty
      ? {
          icon: 'gps-fixed',
          label: transaction.type === 'bounty_completed' ? 'Paid to' : 'From',
          value: transaction.details.counterparty,
          valueColor: undefined,
        }
      : null,
  ].filter((row): row is DetailRow => row !== null)

  return (
    <Animated.View style={[s.backdrop, { opacity: opacityAnim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close transaction details" />
      <Animated.View
        style={[
          s.sheet,
          {
            maxHeight: windowHeight * 0.88,
            paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 16 : 20),
            transform: [{ translateY: sheetAnim }],
          },
        ]}
      >
        <View style={s.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close transaction details"
            onPress={handleClose}
            style={s.headerButton}
          >
            <MaterialIcons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Transaction Details</Text>
          <View style={s.headerButtonPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={s.summarySection}>
            <View style={s.summaryHeaderRow}>
              <View style={s.summaryIcon}>{getTransactionIcon()}</View>
              <View style={{ flex: 1 }}>
                <Text style={s.summaryTitle}>{getTransactionTitle()}</Text>
                <Text style={s.summaryMeta}>{format(transaction.date, 'MMMM d, yyyy')} at {format(transaction.date, 'h:mm a')}</Text>
              </View>
            </View>
            <View style={s.amountPill}>
              <Text style={[s.amountText, { color: transaction.amount > 0 ? theme.success : theme.error }]}>
                {transaction.amount > 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
              </Text>
            </View>
            {!!description && <Text style={s.descriptionText}>{description}</Text>}
          </View>

          <View style={s.detailSection}>
            <Text style={s.detailHeading}>Details</Text>
            <View style={s.detailList}>
              {detailRows.map((row, index) => (
                <View key={row.label} style={[s.detailRow, index > 0 && s.detailRowDivider]}>
                  <View style={s.detailIcon}><MaterialIcons name={row.icon} size={16} color={theme.primary} /></View>
                  <View style={s.detailContent}>
                    <Text style={s.detailLabel}>{row.label}</Text>
                    <Text style={[s.detailValue, row.valueColor ? { color: row.valueColor } : null]}>
                      {row.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {!!transaction.escrowStatus && (
            <View style={s.escrowBlock}>
              <View style={s.escrowHeaderRow}>
                <MaterialIcons name="lock" size={18} color={theme.primary} />
                <Text style={s.escrowTitle}>Escrow Information</Text>
              </View>
              <Text style={s.escrowText}>
                {escrowStatusText[transaction.escrowStatus] ?? 'Escrow status unavailable.'}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={s.actionsSection}>
          <TouchableOpacity
            onPress={handleGenerateReceipt}
            disabled={isGeneratingReceipt}
            style={[s.actionPrimary, isGeneratingReceipt && s.actionPrimaryDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Generate receipt for this transaction"
          >
            <MaterialIcons name="receipt" size={20} color="#ffffff" />
            <Text style={s.actionPrimaryText}>{isGeneratingReceipt ? 'Generating…' : 'Generate Receipt'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
      zIndex: 999,
    },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: t.isDark ? 0.4 : 0.15,
      shadowRadius: 16,
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'ios' ? 18 : 12,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    headerButton: { padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    headerButtonPlaceholder: { width: 44, height: 44 },
    headerTitle: { color: t.text, fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
    scrollContent: { paddingBottom: 8 },
    summarySection: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20 },
    summaryHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    summaryIcon: { height: 48, width: 48, borderRadius: 24, backgroundColor: t.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    summaryTitle: { color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 4 },
    summaryMeta: { color: t.textSecondary, fontSize: 13 },
    amountPill: { backgroundColor: t.surfaceSecondary, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 14 },
    amountText: { fontSize: 24, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
    descriptionText: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    detailSection: { paddingHorizontal: 24, paddingBottom: 8 },
    detailHeading: { color: t.primaryLight, fontSize: 13, fontWeight: '600', marginBottom: 12 },
    detailList: {},
    detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    detailRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    detailIcon: { height: 32, width: 32, borderRadius: 16, backgroundColor: t.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    detailContent: { flex: 1 },
    detailLabel: { color: t.textSecondary, fontSize: 11, marginBottom: 2 },
    detailValue: { color: t.text, fontSize: 14, fontWeight: '500' },
    escrowBlock: { marginHorizontal: 24, marginTop: 4, marginBottom: 8, backgroundColor: t.surfaceSecondary, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: t.border },
    escrowHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 },
    escrowTitle: { color: t.text, fontSize: 14, fontWeight: '600', marginLeft: 6 },
    escrowText: { color: t.textSecondary, fontSize: 12, lineHeight: 18 },
    actionsSection: { paddingHorizontal: 24, paddingTop: 14 },
    actionPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.primary, paddingVertical: 14, borderRadius: 24, shadowColor: t.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    actionPrimaryDisabled: { opacity: 0.6 },
    actionPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '600', marginLeft: 8 },
  });
}
