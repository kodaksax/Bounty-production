/**
 * WithdrawalConfirmSheet
 *
 * Themed bottom-sheet confirmation for both standard withdrawals and Instant
 * Cash Out, replacing the Alert.alert-based confirm dialogs previously in
 * withdraw-with-bank-screen.tsx / instant-cash-out-screen.tsx. A native
 * Alert can't show a fee/net breakdown or match light/dark theming, which
 * the task's "polished confirmation screens" requirement calls for.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { formatCurrency } from '../../lib/utils';

export interface WithdrawalConfirmSheetProps {
  visible: boolean;
  method: 'standard' | 'instant';
  amount: number;
  /** Instant Cash Out only — pre-submission fee/net estimate. */
  fee?: number;
  netAmount?: number;
  destinationLabel: string;
  estimatedArrival: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WithdrawalConfirmSheet({
  visible,
  method,
  amount,
  fee,
  netAmount,
  destinationLabel,
  estimatedArrival,
  isSubmitting,
  onConfirm,
  onCancel,
}: WithdrawalConfirmSheetProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const isInstant = method === 'instant';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => { if (!isSubmitting) onCancel(); }}
      accessibilityViewIsModal
    >
      <View style={s.scrim}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => { if (!isSubmitting) onCancel(); }}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
        />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{isInstant ? 'Confirm Instant Cash Out' : 'Confirm Withdrawal'}</Text>
          <Text style={s.amount}>{formatCurrency(amount)}</Text>

          <View style={s.breakdown}>
            <View style={s.row}>
              <Text style={s.rowLabel}>To</Text>
              <Text style={s.rowValue}>{destinationLabel}</Text>
            </View>
            {isInstant && fee != null && (
              <View style={s.row}>
                <Text style={s.rowLabel}>Instant fee</Text>
                <Text style={s.rowValue}>{formatCurrency(fee)}</Text>
              </View>
            )}
            {isInstant && netAmount != null && (
              <View style={s.row}>
                <Text style={s.rowLabelStrong}>You&apos;ll receive</Text>
                <Text style={s.rowValueStrong}>{formatCurrency(netAmount)}</Text>
              </View>
            )}
            <View style={s.row}>
              <Text style={s.rowLabel}>Estimated arrival</Text>
              <Text style={s.rowValue}>{estimatedArrival}</Text>
            </View>
          </View>

          <Text style={s.disclaimer}>
            {isInstant
              ? "The final fee may differ slightly from the estimate above and is set by Stripe. This can't be canceled once started."
              : "This account will become your default payout account for future withdrawals. This can't be canceled once started."}
          </Text>

          <TouchableOpacity
            style={[s.confirmButton, isSubmitting && s.confirmButtonDisabled]}
            onPress={onConfirm}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={isInstant ? 'Confirm cash out' : 'Confirm withdrawal'}
            accessibilityState={{ disabled: isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={s.confirmButtonText}>{isInstant ? 'Cash Out Now' : 'Confirm Withdrawal'}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.cancelButton}
            onPress={onCancel}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={s.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32, alignItems: 'center',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600', color: t.text },
  amount: { fontSize: 36, fontWeight: 'bold', color: t.text, marginTop: 4, marginBottom: 16 },
  breakdown: { width: '100%', backgroundColor: t.surface, borderRadius: 14, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontSize: 14, color: t.textSecondary },
  rowValue: { fontSize: 14, fontWeight: '600', color: t.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  rowLabelStrong: { fontSize: 14, fontWeight: '600', color: t.text },
  rowValueStrong: { fontSize: 15, fontWeight: '700', color: '#22c55e' },
  disclaimer: { fontSize: 12, color: t.textDisabled, textAlign: 'center', marginTop: 16, lineHeight: 17 },
  confirmButton: {
    width: '100%', backgroundColor: t.primary, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 20,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  cancelButton: { paddingVertical: 14, alignItems: 'center' },
  cancelButtonText: { fontSize: 15, fontWeight: '600', color: t.textSecondary },
}); }
