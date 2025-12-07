/**
 * Payment Receipt Component
 * Displays comprehensive payment receipt information
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Check, Download, Share2, Mail } from 'lucide-react-native';

export interface PaymentReceiptData {
  id: string;
  type: 'payment' | 'refund' | 'transfer' | 'deposit' | 'withdrawal';
  amount: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed' | 'canceled';
  createdAt: Date;
  completedAt?: Date;
  description: string;
  paymentMethod?: {
    type: string;
    last4?: string;
    brand?: string;
  };
  fees?: {
    stripeFee: number;
    platformFee: number;
    total: number;
  };
  netAmount?: number;
  metadata?: Record<string, string>;
  receiptUrl?: string;
}

interface PaymentReceiptProps {
  receipt: PaymentReceiptData;
  onClose?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onEmail?: () => void;
}

export function PaymentReceipt({
  receipt,
  onClose,
  onDownload,
  onShare,
  onEmail,
}: PaymentReceiptProps) {
  const formatCurrency = (amount: number, currency: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'succeeded':
        return '#10b981'; // emerald-500
      case 'pending':
        return '#f59e0b'; // amber-500
      case 'failed':
        return '#ef4444'; // red-500
      case 'canceled':
        return '#6b7280'; // gray-500
      default:
        return '#6b7280';
    }
  };

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'payment':
        return 'Payment';
      case 'refund':
        return 'Refund';
      case 'transfer':
        return 'Transfer';
      case 'deposit':
        return 'Deposit';
      case 'withdrawal':
        return 'Withdrawal';
      default:
        return 'Transaction';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.statusIcon, { backgroundColor: getStatusColor(receipt.status) }]}>
            <Check size={32} color="#ffffff" />
          </View>
          <Text style={styles.title}>{getTypeLabel(receipt.type)} Receipt</Text>
          <Text style={[styles.status, { color: getStatusColor(receipt.status) }]}>
            {receipt.status.toUpperCase()}
          </Text>
        </View>

        {/* Amount Section */}
        <View style={styles.section}>
          <View style={styles.amountContainer}>
            <Text style={styles.amountLabel}>Amount</Text>
            <Text style={styles.amount}>
              {formatCurrency(receipt.amount, receipt.currency)}
            </Text>
          </View>
        </View>

        {/* Transaction Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction Details</Text>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction ID</Text>
            <Text style={styles.detailValue}>{receipt.id}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{formatDate(receipt.createdAt)}</Text>
          </View>

          {receipt.completedAt && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Completed</Text>
              <Text style={styles.detailValue}>{formatDate(receipt.completedAt)}</Text>
            </View>
          )}

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Description</Text>
            <Text style={styles.detailValue}>{receipt.description}</Text>
          </View>

          {receipt.paymentMethod && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Payment Method</Text>
              <Text style={styles.detailValue}>
                {receipt.paymentMethod.brand?.toUpperCase() || receipt.paymentMethod.type} 
                {receipt.paymentMethod.last4 && ` •••• ${receipt.paymentMethod.last4}`}
              </Text>
            </View>
          )}
        </View>

        {/* Fee Breakdown (if available) */}
        {receipt.fees && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fee Breakdown</Text>
            
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Subtotal</Text>
              <Text style={styles.detailValue}>
                {formatCurrency(receipt.amount, receipt.currency)}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Processing Fee</Text>
              <Text style={styles.detailValue}>
                -{formatCurrency(receipt.fees.stripeFee, receipt.currency)}
              </Text>
            </View>

            {receipt.fees.platformFee > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Platform Fee</Text>
                <Text style={styles.detailValue}>
                  -{formatCurrency(receipt.fees.platformFee, receipt.currency)}
                </Text>
              </View>
            )}

            <View style={[styles.detailRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Net Amount</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(receipt.netAmount || receipt.amount, receipt.currency)}
              </Text>
            </View>
          </View>
        )}

        {/* Metadata (if available) */}
        {receipt.metadata && Object.keys(receipt.metadata).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Information</Text>
            {Object.entries(receipt.metadata).map(([key, value]) => (
              <View key={key} style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}
                </Text>
                <Text style={styles.detailValue}>{value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {onDownload && (
            <Pressable style={styles.actionButton} onPress={onDownload}>
              <Download size={20} color="#047857" />
              <Text style={styles.actionText}>Download</Text>
            </Pressable>
          )}

          {onShare && (
            <Pressable style={styles.actionButton} onPress={onShare}>
              <Share2 size={20} color="#047857" />
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          )}

          {onEmail && (
            <Pressable style={styles.actionButton} onPress={onEmail}>
              <Mail size={20} color="#047857" />
              <Text style={styles.actionText}>Email</Text>
            </Pressable>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Questions about this transaction?{'\n'}
            Contact support@bountyexpo.com
          </Text>
        </View>

        {/* Close Button */}
        {onClose && (
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  amountContainer: {
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
  },
  amount: {
    fontSize: 36,
    fontWeight: '700',
    color: '#047857',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  detailLabel: {
    fontSize: 14,
    color: '#6b7280',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  totalRow: {
    borderTopWidth: 2,
    borderTopColor: '#e5e7eb',
    borderBottomWidth: 0,
    marginTop: 8,
    paddingTop: 16,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#047857',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#047857',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#047857',
  },
  footer: {
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  closeButton: {
    backgroundColor: '#047857',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
