import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useWalletBalanceDisplay } from '../../hooks/use-wallet-balance-display'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { formatCurrencyCents } from '../../lib/utils'

export interface WalletBalanceButtonProps {
  onPress?: () => void
  accessibilityLabel?: string
}

export function WalletBalanceButton({ onPress, accessibilityLabel }: WalletBalanceButtonProps) {
  const router = useRouter()
  // Same authoritative balance path as the wallet screen, so the header pill
  // can never disagree with the balance card. Previously this read
  // useWallet().balance directly and formatted it with a hardcoded
  // `$${toFixed(2)}`, which both bypassed locale formatting and pinned it to
  // the legacy ledger figure.
  const { amountCents, currency, isLoading } = useWalletBalanceDisplay()
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const formatted = formatCurrencyCents(amountCents, currency)

  const handlePress = () => {
    if (onPress) return onPress()
    router.push('/tabs/wallet-screen')
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={s.balanceContainer}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ||
        (isLoading ? 'Account balance loading' : `Account balance: ${formatted}`)
      }
      accessibilityHint="Tap to view wallet and add money"
    >
      <View style={s.balanceCard}>
        <MaterialIcons name="account-balance-wallet" size={16} color={theme.primaryLight} style={{ marginRight: 6 }} />
        {isLoading ? (
          <View style={s.headerBalanceSkeleton} />
        ) : (
          <Text style={s.headerBalance}>{formatted}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    balanceContainer: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    balanceCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surface,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.primaryLight,
    },
    headerBalance: {
      fontSize: 14,
      fontWeight: 'bold',
      color: t.text,
    },
    headerBalanceSkeleton: {
      width: 48,
      height: 14,
      borderRadius: 4,
      backgroundColor: t.border ?? 'rgba(255,255,255,0.12)',
    },
  })
}
