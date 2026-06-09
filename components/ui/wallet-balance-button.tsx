import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { useWallet } from '../../lib/wallet-context'

export interface WalletBalanceButtonProps {
  onPress?: () => void
  accessibilityLabel?: string
}

export function WalletBalanceButton({ onPress, accessibilityLabel }: WalletBalanceButtonProps) {
  const router = useRouter()
  const { balance } = useWallet()
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const handlePress = () => {
    if (onPress) return onPress()
    router.push('/tabs/wallet-screen')
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={s.balanceContainer}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `Account balance: $${balance.toFixed(2)}`}
      accessibilityHint="Tap to view wallet and add money"
    >
      <View style={s.balanceCard}>
        <MaterialIcons name="account-balance-wallet" size={16} color={theme.primaryLight} style={{ marginRight: 6 }} />
        <Text style={s.headerBalance}>${balance.toFixed(2)}</Text>
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
  })
}
