"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { CardField, useStripe } from "@stripe/stripe-react-native"
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
import { config } from "../lib/config"
import { API_BASE_URL } from "../lib/config/api"
import { useAppThemeContext } from "../lib/themes/AppThemeContext"
import type { AppTheme } from "../lib/themes/types"

export interface DebitCardData {
  id: string
  brand: string | null
  last4: string | null
  instantEligible: boolean
}

interface AddDebitCardModalProps {
  onBack: () => void
  onSave?: (card: DebitCardData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet) —
   * used when this modal is shown inside another modal, matching
   * AddBankAccountModal's `embedded` convention.
   */
  embedded?: boolean
}

/**
 * Adds a debit card as an Instant Cash Out payout destination on the user's
 * Stripe Connect account.
 *
 * Unlike bank accounts (linked via Stripe Financial Connections, no manual
 * entry), a payout debit card has no FC equivalent — Stripe requires a
 * client-tokenized card (stripe-react-native's CardField + createToken()).
 * The raw card number is captured entirely inside Stripe's own CardField
 * component and never touches Bounty's servers or state — only the
 * resulting token id (tok_...) is sent to POST /connect/debit-cards, which
 * attaches it as a `card`-type external account. This card is used
 * exclusively for Instant Cash Out; it is never promoted to
 * default_for_currency, so it never affects where standard withdrawals go.
 */
export function AddDebitCardModal({
  onBack,
  onSave,
  embedded = false,
}: AddDebitCardModalProps) {
  const [isCardComplete, setIsCardComplete] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const { session } = useAuthContext()
  const { createToken } = useStripe()
  const { theme } = useAppThemeContext()
  const styles = makeStyles(theme)

  const handleAddCard = async () => {
    if (isSaving || !isCardComplete) return
    setIsSaving(true)
    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.')
      }

      const { token, error: tokenError } = await createToken({ type: 'Card' })
      if (tokenError || !token) {
        throw new Error(tokenError?.message ?? 'Could not process this card. Please check the details and try again.')
      }

      const response = await fetch(`${API_BASE_URL}/connect/debit-cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
        body: JSON.stringify({ token: token.id }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error ?? 'We could not add this debit card. Please try again.')
      }

      const card: DebitCardData = {
        id: data.debitCard?.id,
        brand: data.debitCard?.brand ?? null,
        last4: data.debitCard?.last4 ?? null,
        instantEligible: !!data.debitCard?.instantEligible,
      }

      Alert.alert(
        'Debit Card Added',
        card.instantEligible
          ? `${card.brand ?? 'Your card'} •••• ${card.last4 ?? ''} is ready for Instant Cash Out.`
          : `${card.brand ?? 'Your card'} •••• ${card.last4 ?? ''} was added, but doesn't currently support Instant Cash Out. You can still withdraw normally to your bank account.`,
        [
          {
            text: 'OK',
            onPress: () => {
              onSave?.(card)
              onBack()
            },
          },
        ]
      )
    } catch (error: any) {
      const message = error?.message ?? "We couldn't add this debit card. Please try again."
      Alert.alert('Add Debit Card Failed', String(message))
    } finally {
      setIsSaving(false)
    }
  }

  const Body = (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heroIconWrap}>
        <MaterialIcons name="bolt" size={48} color="#fff" />
      </View>

      <Text style={styles.heroTitle}>Add a debit card for Instant Cash Out</Text>
      <Text style={styles.heroSubtitle}>
        Instant Cash Out sends money to an eligible debit card, usually within
        minutes, for a small fee. Your bank account stays your standard,
        no-fee payout method.
      </Text>

      <View style={styles.cardFieldWrap}>
        <CardField
          postalCodeEnabled={false}
          placeholders={{ number: '4242 4242 4242 4242' }}
          cardStyle={{
            backgroundColor: '#FFFFFF',
            textColor: '#000000',
            borderRadius: 12,
          }}
          style={styles.cardField}
          onCardChange={details => setIsCardComplete(!!details.complete)}
          accessibilityLabel="Debit card number, expiration, and CVC"
        />
      </View>

      <View style={styles.bulletList}>
        <View style={styles.bulletRow}>
          <MaterialIcons name="lock" size={18} color="#6ee7b7" />
          <Text style={styles.bulletText}>
            Your card number is entered directly into Stripe's secure field —
            Bounty never sees or stores it.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <MaterialIcons name="info-outline" size={18} color="#6ee7b7" />
          <Text style={styles.bulletText}>
            Instant eligibility is determined by your card's bank, not
            Bounty — we'll tell you right away if this card doesn't qualify.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleAddCard}
        disabled={isSaving || !isCardComplete}
        style={[
          styles.primaryButton,
          (isSaving || !isCardComplete) && styles.primaryButtonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add debit card"
        accessibilityState={{ disabled: isSaving || !isCardComplete }}
      >
        {isSaving ? (
          <>
            <ActivityIndicator size="small" color={theme.background} style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>Adding card…</Text>
          </>
        ) : (
          <Text style={styles.primaryButtonText}>Add Debit Card</Text>
        )}
      </TouchableOpacity>

      <View style={styles.securityNotice}>
        <MaterialIcons name="verified-user" size={16} color="#6ee7b7" />
        <Text style={styles.securityText}>
          Powered by Stripe. Fees for Instant Cash Out are shown before you
          confirm each cash out — never a surprise.
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
          <Text style={embeddedStyles.title}>Add Debit Card</Text>
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
            accessibilityLabel="Close add debit card"
            onPress={onBack}
            style={styles.navButton}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Add Debit Card</Text>
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

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    overlayContainer: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.primary, // intentional payment branding — matches Add Bank Account modal
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
    cardFieldWrap: { marginBottom: 20 },
    cardField: { width: '100%', height: 50 },
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
