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

/**
 * Public shape preserved for backward compatibility with existing callers.
 *
 * Manual bank account entry (raw routing/account numbers) is no longer
 * supported. The fields below are retained as optional so older code that
 * destructures them at the type-level keeps compiling, but they are never
 * populated by this component now that linking is handled by Stripe Financial
 * Connections.
 */
export interface BankAccountData {
  accountHolderName?: string
  accountNumber?: string
  routingNumber?: string
  accountType?: 'checking' | 'savings'
  /** Newly-linked us_bank_account payment methods returned by Financial Connections. */
  linkedBanks?: StripePaymentMethod[]
}

interface AddBankAccountModalProps {
  onBack: () => void
  onSave?: (bankData: BankAccountData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet)
   * — used when this modal is shown inside another modal (e.g. PaymentMethodsModal).
   */
  embedded?: boolean
}

/**
 * Bank linking via Stripe Financial Connections.
 *
 * Replaces the previous manual routing/account number form. A single tap opens
 * Stripe's secure UI; on success the linked bank powers both deposits (as a
 * us_bank_account PaymentMethod attached to the user's Customer) and
 * withdrawals (mirrored as an external account on the user's Connect account).
 */
export function AddBankAccountModal({
  onBack,
  onSave,
  embedded = false,
}: AddBankAccountModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { session } = useAuthContext()

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
          ? `${bankName} •••• ${last4} is ready for deposits and withdrawals.`
          : `${bankName} is ready for deposits and withdrawals.`,
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

  const Body = (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heroIconWrap}>
        <MaterialIcons name="account-balance" size={48} color="#fff" />
      </View>

      <Text style={styles.heroTitle}>Link your bank securely</Text>
      <Text style={styles.heroSubtitle}>
        We use Stripe Financial Connections so you never share routing or account
        numbers with us. The same linked bank can be used for both deposits and
        withdrawals.
      </Text>

      <View style={styles.bulletList}>
        <View style={styles.bulletRow}>
          <MaterialIcons name="lock" size={18} color="#6ee7b7" />
          <Text style={styles.bulletText}>Bank-grade encryption end-to-end.</Text>
        </View>
        <View style={styles.bulletRow}>
          <MaterialIcons name="bolt" size={18} color="#6ee7b7" />
          <Text style={styles.bulletText}>
            Instant verification when your bank supports it; otherwise tiny
            test deposits arrive in 1–2 business days.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <MaterialIcons name="sync" size={18} color="#6ee7b7" />
          <Text style={styles.bulletText}>
            Reusable for deposits and payouts. Link once, use forever.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleLinkBank}
        disabled={isLoading}
        style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Link bank with Stripe"
        accessibilityState={{ disabled: isLoading }}
      >
        {isLoading ? (
          <>
            <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>Opening secure form…</Text>
          </>
        ) : (
          <Text style={styles.primaryButtonText}>Link Bank with Stripe</Text>
        )}
      </TouchableOpacity>

      <View style={styles.securityNotice}>
        <MaterialIcons name="verified-user" size={16} color="#6ee7b7" />
        <Text style={styles.securityText}>
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
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Link Bank Account</Text>
          <View style={styles.navButtonPlaceholder} />
        </View>
        {Body}
      </View>
    </View>
  )
}

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

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#059669',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 12,
    maxHeight: '92%',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 20 : 12,
    paddingBottom: 12,
  },
  navButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonPlaceholder: { width: 44, height: 44 },
  navTitle: { color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  heroIconWrap: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(16,185,129,0.25)',
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
    color: '#d1fae5',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  bulletList: { marginBottom: 24, gap: 10 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { color: '#d1fae5', fontSize: 13, lineHeight: 18, flex: 1 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  securityText: { color: '#a7f3d0', fontSize: 11, textAlign: 'center', flex: 1 },
})
