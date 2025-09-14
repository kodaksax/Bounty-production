"use client"

import type React from "react"

import { ArrowLeft, Check, ChevronRight, Home, Plus, Target } from "lucide-react"
import { useState } from "react"
import { cn } from "lib/utils"
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';

interface WithdrawScreenProps {
  onBack?: () => void
  balance: number
}

interface PaymentMethod {
  id: string
  name: string
  details: string
  icon: React.ReactNode
}

export function WithdrawScreen({ onBack, balance = 40 }: WithdrawScreenProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>("bank-of-america")
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0)

  const paymentMethods: PaymentMethod[] = [
    {
      id: "bank-of-america",
      name: "Bank Of America",
      details: "Checking XXXXXX23",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "apple-pay",
      name: "Apple Pay",
      details: "ending in 1138",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "chase-bank",
      name: "Chase Bank",
      details: "Checking XXXXXX45",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "wells-fargo",
      name: "Wells Fargo",
      details: "Savings XXXXXX78",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "venmo",
      name: "Venmo",
      details: "@username",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "paypal",
      name: "PayPal",
      details: "user@example.com",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "cash-app",
      name: "Cash App",
      details: "$username",
      icon: <Home className="h-5 w-5" />,
    },
  ]

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#059669', // emerald-600
    },
    header: {
      backgroundColor: '#059669',
      paddingTop: 32,
      zIndex: 10,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    backButton: {
      marginRight: 12,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    targetIcon: {
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    titleContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    balanceContainer: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    balanceLabel: {
      fontSize: 14,
      color: '#A7F3D0', // emerald-200
    },
    progressContainer: {
      height: 8,
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
      borderRadius: 4,
      overflow: 'hidden',
      marginBottom: 4,
    },
    progressBar: {
      height: '100%',
      backgroundColor: '#10B981', // emerald-400
    },
    progressLabel: {
      fontSize: 12,
      color: '#6EE7B7', // emerald-300
    },
    amountContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    amountLabel: {
      fontSize: 14,
      color: '#A7F3D0', // emerald-200
      marginBottom: 4,
    },
    amountInput: {
      width: '100%',
      backgroundColor: 'rgba(6, 95, 70, 0.3)', // emerald-700/30
      borderWidth: 1,
      borderColor: 'rgba(16, 185, 129, 0.3)', // emerald-500/30
      borderRadius: 8,
      padding: 8,
      color: 'white',
      fontSize: 16,
    },
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      paddingBottom: 96, // Space for fixed button
    },
    paymentMethodsContainer: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    paymentMethodsTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: 'white',
      marginBottom: 12,
    },
    methodsList: {
      gap: 12,
    },
    methodItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      borderRadius: 8,
    },
    methodItemSelected: {
      backgroundColor: '#047857', // emerald-700
    },
    methodItemUnselected: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
    },
    methodContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    methodIcon: {
      height: 32,
      width: 32,
      borderRadius: 16,
      backgroundColor: '#065F46', // emerald-800
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    methodInfo: {
      flex: 1,
    },
    methodName: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
    methodDetails: {
      fontSize: 12,
      color: '#6EE7B7', // emerald-300
    },
    radioContainer: {
      height: 20,
      width: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#10B981', // emerald-400
      alignItems: 'center',
      justifyContent: 'center',
    },
    addNewAccount: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
      borderRadius: 8,
    },
    buttonContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      backgroundColor: '#059669', // emerald-600
      borderTopWidth: 1,
      borderTopColor: 'rgba(16, 185, 129, 0.3)', // emerald-500/30
      zIndex: 10,
    },
    withdrawButton: {
      width: '100%',
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    withdrawButtonEnabled: {
      backgroundColor: '#10B981', // emerald-500
    },
    withdrawButtonDisabled: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
    },
    withdrawButtonText: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
  });

  return (
    <View style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <ArrowLeft color="white" size={20} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Target color="white" size={20} style={styles.targetIcon} />
            <Text style={styles.headerTitle}>BOUNTY</Text>
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>WITHDRAW</Text>
        </View>

        {/* Balance Info */}
        <View style={styles.balanceContainer}>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Your Balance:</Text>
            <Text style={styles.balanceLabel}>Withdrawal: ${withdrawalAmount.toFixed(2)}</Text>
          </View>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${(withdrawalAmount / balance) * 100}%` }]} />
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.progressLabel}>$0</Text>
            <Text style={styles.progressLabel}>${balance.toFixed(2)}</Text>
          </View>
        </View>

        {/* Withdrawal Amount */}
        <View style={styles.amountContainer}>
          <Text style={styles.amountLabel}>Amount:</Text>
          <TextInput
            style={styles.amountInput}
            value={withdrawalAmount ? withdrawalAmount.toString() : ""}
            onChangeText={(text) =>
              setWithdrawalAmount(Math.min(balance, Math.max(0, Number.parseFloat(text) || 0)))
            }
            placeholder="Enter amount to withdraw"
            placeholderTextColor="rgba(16, 185, 129, 0.5)"
            keyboardType="numeric"
          />
        </View>
      </View>

      {/* Scrollable Content Area */}
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentContainer}>
        {/* Payment Methods */}
        <View style={styles.paymentMethodsContainer}>
          <Text style={styles.paymentMethodsTitle}>Select Withdrawal Method</Text>
          <View style={styles.methodsList}>
            {paymentMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodItem,
                  selectedMethod === method.id ? styles.methodItemSelected : styles.methodItemUnselected,
                ]}
                onPress={() => setSelectedMethod(method.id)}
              >
                <View style={styles.methodContent}>
                  <View style={styles.methodIcon}>
                    {method.icon}
                  </View>
                  <View style={styles.methodInfo}>
                    <Text style={styles.methodName}>{method.name}</Text>
                    {method.details && <Text style={styles.methodDetails}>{method.details}</Text>}
                  </View>
                </View>
                <View style={styles.radioContainer}>
                  {selectedMethod === method.id && <Check color="#10B981" size={12} />}
                </View>
              </TouchableOpacity>
            ))}

            {/* Add New Bank Account */}
            <TouchableOpacity style={styles.addNewAccount}>
              <View style={styles.methodContent}>
                <View style={styles.methodIcon}>
                  <Plus color="white" size={20} />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodName}>New Bank Account</Text>
                  <Text style={styles.methodDetails}>Menu description</Text>
                </View>
              </View>
              <ChevronRight color="#10B981" size={20} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Fixed Button at Bottom */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.withdrawButton,
            withdrawalAmount > 0 ? styles.withdrawButtonEnabled : styles.withdrawButtonDisabled,
          ]}
          disabled={withdrawalAmount <= 0}
        >
          <Text style={styles.withdrawButtonText}>Begin Withdrawal</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
