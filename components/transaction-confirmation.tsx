import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BrandingLogo } from 'components/ui/branding-logo';
import { useHapticFeedback } from "../lib/haptic-feedback";

interface TransactionConfirmationProps {
  type: 'deposit' | 'withdrawal';
  amount: number;
  method: string;
  onContinue: () => void;
  onViewTransaction?: () => void;
}

export function TransactionConfirmation({ 
  type, 
  amount, 
  method, 
  onContinue, 
  onViewTransaction 
}: TransactionConfirmationProps) {
  const isDeposit = type === 'deposit';
  const { triggerHaptic } = useHapticFeedback();
  
  // Trigger success haptic when component mounts (transaction completed)
  useEffect(() => {
    triggerHaptic('success');
  }, [triggerHaptic]);
  
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <BrandingLogo size="small" />
        </View>
      </View>

      {/* Success Icon */}
      <View style={styles.iconContainer}>
        <View style={styles.successCircle}>
          <MaterialIcons name="check" size={48} color="#059669" />
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title}>
          {isDeposit ? 'Money Added!' : 'Withdrawal Initiated!'}
        </Text>
        
        <Text style={styles.subtitle}>
          {isDeposit 
            ? `$${amount.toFixed(2)} has been added to your wallet`
            : `$${amount.toFixed(2)} withdrawal is being processed`
          }
        </Text>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Amount:</Text>
            <Text style={styles.detailValue}>${amount.toFixed(2)}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Method:</Text>
            <Text style={styles.detailValue}>{method}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Status:</Text>
            <Text style={[styles.detailValue, { color: isDeposit ? '#10b981' : '#f59e0b' }]}>
              {isDeposit ? 'Completed' : 'Processing'}
            </Text>
          </View>
          
          {!isDeposit && (
            <View style={styles.noteContainer}>
              <MaterialIcons name="info" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={styles.noteText}>
                Withdrawals typically take 1-3 business days to complete.
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {onViewTransaction && (
          <TouchableOpacity accessibilityRole="button" 
            style={styles.secondaryButton}
            onPress={onViewTransaction}
          >
            <Text style={styles.secondaryButtonText}>View Transaction</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity accessibilityRole="button" 
          style={styles.primaryButton}
          onPress={onContinue}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
  },
  header: {
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 16,
    backgroundColor: '#059669',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  iconContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginBottom: 32,
  },
  detailsCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  noteText: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 8,
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#059669',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
});