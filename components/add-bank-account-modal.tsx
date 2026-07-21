"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { stripeService } from "../lib/services/stripe-service"
import type { StripePaymentMethod } from "../lib/services/stripe-internal"
import { useAppThemeContext } from "../lib/themes/AppThemeContext"
import type { AppTheme } from "../lib/themes/types"

/**
 * Payload passed to the optional `onSave` callback once Financial Connections
 * has linked one or more banks. Manual entry fields have been removed — bank
 * linking now goes through Stripe FC exclusively.
 */
export interface BankAccountData {
  /** Newly-linked us_bank_account payment methods returned by Financial Connections. */
  linkedBanks: StripePaymentMethod[]
}

interface AddBankAccountModalProps {
  onBack: () => void
  onSave?: (bankData: BankAccountData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet)
   * — used when this modal is shown inside PaymentMethodsModal, which still
   * uses the legacy solid-green sheet (matching AddCardModal's embedded
   * mode). Embedded content keeps the white-on-green palette so it stays
   * readable on that host.
   */
  embedded?: boolean
}

/**
 * Bank linking via Stripe Financial Connections — DEPOSIT-ONLY.
 *
 * Replaces the previous manual routing/account number form. A single tap opens
 * Stripe's secure UI; on success the linked bank is attached as a
 * us_bank_account PaymentMethod on the user's Customer, usable for ACH
 * deposits (Add Money).
 *
 * This does NOT make the bank a withdrawal destination. These Connect
 * accounts have controller.requirement_collection === "stripe", so the
 * platform cannot mirror a linked bank onto the Connect account as a payout
 * external account via the API — Stripe rejects that write unconditionally.
 * Payout bank accounts must be added through Stripe's own hosted Express
 * Dashboard instead (see openPayoutDashboard in hooks/use-payout-methods.tsx).
 */
export function AddBankAccountModal({
  onBack,
  onSave,
  embedded = false,
}: AddBankAccountModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { session } = useAuthContext()
  const { theme } = useAppThemeContext()
  const styles = makeStyles(theme)
  const bodyStyles = embedded ? legacyBodyStyles(theme) : styles

  const handleLinkBank = async () => {
    if (isLoading) return
    setIsLoading(true)
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.')
      }

      const linkedBanks = await stripeService.linkBankWithFinancialConnections(
        session.access_token,
        { setAsDefault: true }
      )

      if (!linkedBanks || linkedBanks.length === 0) {
        // Should not happen — the service throws on cancellation.
        return
      }

      const first = linkedBanks[0]
      const bankName = first.us_bank_account?.bank_name ?? 'Your bank'
      const last4 = first.us_bank_account?.last4 ?? ''

      Alert.alert(
        'Bank Linked',
        last4
          ? `${bankName} •••• ${last4} is ready for deposits.`
          : `${bankName} is ready for deposits.`,
        [
          {
            text: 'OK',
            onPress: () => {
              onSave?.({ linkedBanks })
              onBack()
            },
          },
        ]
      )
    } catch (error: any) {
      // Cancellations come back as `card_error` with code 'Canceled' from
      // collectFinancialConnectionsAccounts — surface them as a soft no-op.
      const code = error?.code ?? error?.error?.code
      if (code === 'Canceled') {
        return
      }
      const message =
        error?.message ?? 'We couldn’t link your bank account. Please try again.'
      Alert.alert('Bank Linking Failed', String(message))
    } finally {
      setIsLoading(false)
    }
  }

  const heroIconColor = embedded ? '#fff' : theme.primary
  const bulletIconColor = embedded ? '#6ee7b7' : theme.primary
  const securityIconColor = embedded ? '#6ee7b7' : theme.textDisabled
  const spinnerColor = embedded ? theme.background : '#ffffff'

  const Body = (
    <ScrollView
      contentContainerStyle={bodyStyles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={bodyStyles.heroIconWrap}>
        <MaterialIcons name="account-balance" size={embedded ? 48 : 40} color={heroIconColor} />
      </View>

      <Text style={bodyStyles.heroTitle}>Link your bank securely</Text>
      <Text style={bodyStyles.heroSubtitle}>
        We use Stripe Financial Connections so you never share routing or account
        numbers with us. The same linked bank can be used for both deposits and
        withdrawals.
      </Text>

      <View style={bodyStyles.bulletList}>
        <View style={bodyStyles.bulletRow}>
          <MaterialIcons name="lock" size={18} color={bulletIconColor} />
          <Text style={bodyStyles.bulletText}>Bank-grade encryption end-to-end.</Text>
        </View>
        <View style={bodyStyles.bulletRow}>
          <MaterialIcons name="bolt" size={18} color={bulletIconColor} />
          <Text style={bodyStyles.bulletText}>
            Instant verification when your bank supports it; otherwise tiny
            test deposits arrive in 1–2 business days.
          </Text>
        </View>
        <View style={bodyStyles.bulletRow}>
          <MaterialIcons name="sync" size={18} color={bulletIconColor} />
          <Text style={bodyStyles.bulletText}>
            Reusable for deposits and payouts. Link once, use forever.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleLinkBank}
        disabled={isLoading}
        style={[bodyStyles.primaryButton, isLoading && bodyStyles.primaryButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Link bank with Stripe"
        accessibilityState={{ disabled: isLoading }}
      >
        {isLoading ? (
          <>
            <ActivityIndicator size="small" color={spinnerColor} style={{ marginRight: 8 }} />
            <Text style={bodyStyles.primaryButtonText}>Opening secure form…</Text>
          </>
        ) : (
          <Text style={bodyStyles.primaryButtonText}>Link Bank with Stripe</Text>
        )}
      </TouchableOpacity>

      <View style={bodyStyles.securityNotice}>
        <MaterialIcons name="verified-user" size={16} color={securityIconColor} />
        <Text style={bodyStyles.securityText}>
          Powered by Stripe — supports thousands of US banks. We never see your
          credentials.
        </Text>
      </View>
    </ScrollView>
  )

  if (embedded) {
    return (
      <View style={embeddedStyles.container}>
        <View style={embeddedStyles.navBar}>
          <TouchableOpacity
            onPress={onBack}
            style={embeddedStyles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={embeddedStyles.title}>Link Bank Account</Text>
          <View style={{ width: 44 }} />
        </View>
        {Body}
      </View>
    )
  }

  return (
    <View style={styles.overlayContainer}>
      <View style={styles.sheet}>
        <View style={styles.navBar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close link bank account"
            onPress={onBack}
            style={styles.navButton}
          >
            <MaterialIcons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Link Bank Account</Text>
          <View style={styles.navButtonPlaceholder} />
        </View>
        {Body}
      </View>
    </View>
  )
}

// Matches AddCardModal's embedded nav chrome — PaymentMethodsModal (the host
// for embedded mode) still renders a solid-green sheet with white text, so
// embedded content keeps the same white-on-green palette for contrast.
const embeddedStyles = StyleSheet.create({
  container: { paddingBottom: 24 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },
})

// Body styles for embedded mode — mirrors the white-on-green palette the
// PaymentMethodsModal host still uses (same key names as makeStyles so the
// shared Body JSX can reference either style set interchangeably).
function legacyBodyStyles(theme: AppTheme) {
  return StyleSheet.create({
    contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },
    heroIconWrap: {
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 16,
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(255,255,255,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroTitle: {
      color: '#fff',
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 8,
    },
    heroSubtitle: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 20,
    },
    bulletList: { marginBottom: 24, gap: 10 },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    bulletText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 18, flex: 1 },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.text,
      borderRadius: 14,
      paddingVertical: 14,
      marginBottom: 16,
      ...theme.shadows.md,
    },
    primaryButtonDisabled: { opacity: 0.6 },
    primaryButtonText: { color: theme.background, fontWeight: '700', fontSize: 16 },
    securityNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 12,
    },
    securityText: { color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center', flex: 1 },
  });
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    overlayContainer: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: t.background,
      borderTopLeftRadius: t.radius['2xl'],
      borderTopRightRadius: t.radius['2xl'],
      paddingBottom: 12,
      maxHeight: '92%',
    },
    navBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.xl,
      paddingTop: Platform.OS === 'ios' ? 20 : 12,
      paddingBottom: t.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    navButton: {
      padding: 8,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    navButtonPlaceholder: { width: 44, height: 44 },
    navTitle: { color: t.text, fontSize: t.typography.fontSize.lg, fontWeight: t.typography.fontWeight.semibold },
    contentContainer: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.lg, paddingBottom: 40 },
    heroIconWrap: {
      alignSelf: 'center',
      marginBottom: t.spacing.lg,
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.isDark ? 'rgba(34,197,94,0.15)' : 'rgba(5,150,105,0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroTitle: {
      color: t.text,
      fontSize: t.typography.fontSize.xl,
      fontWeight: t.typography.fontWeight.bold,
      textAlign: 'center',
      marginBottom: t.spacing.sm,
    },
    heroSubtitle: {
      color: t.textSecondary,
      fontSize: t.typography.fontSize.sm,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: t.spacing.xl,
    },
    bulletList: { marginBottom: t.spacing.xl, gap: 10 },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    bulletText: { color: t.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.primary,
      borderRadius: t.radius.lg,
      paddingVertical: 14,
      marginBottom: t.spacing.lg,
      ...t.shadows.sm,
    },
    primaryButtonDisabled: { opacity: 0.5 },
    primaryButtonText: { color: '#ffffff', fontWeight: t.typography.fontWeight.bold, fontSize: t.typography.fontSize.base },
    securityNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 12,
    },
    securityText: { color: t.textDisabled, fontSize: 11, textAlign: 'center', flex: 1 },
  });
}
