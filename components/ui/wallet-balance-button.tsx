import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useWallet } from '../../lib/wallet-context'

export interface WalletBalanceButtonProps {
  onPress?: () => void
  accessibilityLabel?: string
}

export function WalletBalanceButton({ onPress, accessibilityLabel }: WalletBalanceButtonProps) {
  const router = useRouter()
  const { balance } = useWallet()

  const handlePress = () => {
    if (onPress) return onPress()
    router.push('/tabs/wallet-screen')
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.balanceContainer}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `Account balance: $${balance.toFixed(2)}`}
      accessibilityHint="Tap to view wallet and add money"
    >
      <View style={styles.balanceCard}>
        <MaterialIcons name="account-balance-wallet" size={16} color="#80c795" style={{ marginRight: 6 }} />
        <Text style={styles.headerBalance}>${balance.toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  balanceContainer: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007523',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#80c795',
  },
  headerBalance: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
})
