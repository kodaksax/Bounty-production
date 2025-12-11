import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InfoTooltip } from './ui/tooltip';

interface EscrowStatusCardProps {
  status: 'funded' | 'pending' | 'released' | 'none';
  amount: number;
  bountyTitle?: string;
}

/**
 * EscrowStatusCard - Visual component showing escrow status on bounty details
 * 
 * Usage:
 * - Shows on bounty detail when funds are escrowed
 * - Indicates whether funds are held, pending, or released
 * - Provides visual trust signal for marketplace participants
 */
export function EscrowStatusCard({ status, amount, bountyTitle }: EscrowStatusCardProps) {
  if (status === 'none') {
    return null;
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'funded':
        return {
          icon: 'lock' as const,
          iconColor: '#f59e0b',
          backgroundColor: '#fef3c7',
          borderColor: '#f59e0b',
          textColor: '#92400e',
          title: 'Funds Secured in Escrow',
          description: `$${amount.toFixed(2)} is held securely until bounty completion.`,
        };
      case 'pending':
        return {
          icon: 'hourglass-empty' as const,
          iconColor: '#6366f1',
          backgroundColor: '#e0e7ff',
          borderColor: '#6366f1',
          textColor: '#3730a3',
          title: 'Escrow Pending',
          description: 'Waiting for confirmation to secure funds.',
        };
      case 'released':
        return {
          icon: 'lock-open' as const,
          iconColor: '#10b981',
          backgroundColor: '#d1fae5',
          borderColor: '#10b981',
          textColor: '#065f46',
          title: 'Funds Released',
          description: `$${amount.toFixed(2)} has been released to the hunter.`,
        };
      default:
        return {
          icon: 'info' as const,
          iconColor: '#6b7280',
          backgroundColor: '#f3f4f6',
          borderColor: '#9ca3af',
          textColor: '#374151',
          title: 'Escrow Information',
          description: 'Status unknown',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <View style={[styles.container, { backgroundColor: config.backgroundColor, borderColor: config.borderColor }]}>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: `${config.iconColor}20` }]}>
          <MaterialIcons name={config.icon} size={24} color={config.iconColor} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: config.textColor }]}>{config.title}</Text>
          {bountyTitle && (
            <Text style={[styles.subtitle, { color: config.textColor, opacity: 0.7 }]} numberOfLines={1}>
              {bountyTitle}
            </Text>
          )}
        </View>
      </View>
      <Text style={[styles.description, { color: config.textColor }]}>{config.description}</Text>
      
      {status === 'funded' && (
        <View style={styles.infoRow}>
          <MaterialIcons name="verified-user" size={16} color={config.iconColor} />
          <Text style={[styles.infoText, { color: config.textColor }]}>
            Protected by BOUNTY escrow
          </Text>
          <InfoTooltip
            title="What is Escrow?"
            content="Escrow is a secure payment system that holds your funds safely until you confirm the work is complete. This protects both you and the hunter — you only pay for completed work, and hunters are guaranteed payment once you approve."
            iconSize={16}
            iconColor={config.iconColor}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    marginLeft: 6,
    fontWeight: '600',
  },
});
