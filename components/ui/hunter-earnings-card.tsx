import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  PLATFORM_FEE_DISPLAY,
  calculateHunterEarnings,
} from '../../lib/constants/fees';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface HunterEarningsCardProps {
  /** The bounty amount the poster named. */
  amount: number | null | undefined;
  /**
   * The authoritative fee for an already-settled release, in dollars. When
   * given it wins over the client-side estimate, so a receipt never disagrees
   * with the money that actually moved.
   */
  actualFee?: number | null;
  /**
   * 'estimate' — before the work: "You'll earn", framed as what they take home.
   * 'receipt'  — after payout: "You earned", past tense, no escrow promise.
   */
  variant?: 'estimate' | 'receipt';
  /** Hide the "held in escrow" reassurance (e.g. on a settled receipt). */
  showProtection?: boolean;
}

/**
 * Answers the Hunter's first question — "what do I actually take home?" —
 * at the moment they are deciding whether to apply, and again on the receipt.
 *
 * The app previously showed the gross bounty amount everywhere and never
 * mentioned the service fee outside the FAQ, so a hunter looking at a $40
 * bounty had no way to learn that $38 is what reaches their wallet. Showing
 * the deduction up front is both the honest thing and the thing that stops
 * the "I was paid the wrong amount" support ticket.
 */
export function HunterEarningsCard({
  amount,
  actualFee,
  variant = 'estimate',
  showProtection = true,
}: HunterEarningsCardProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();

  const { gross, fee, net } = calculateHunterEarnings(amount, actualFee);
  if (gross <= 0) return null;

  const isReceipt = variant === 'receipt';

  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <MaterialIcons name="payments" size={18} color={theme.primary} />
        <Text style={s.headText}>{isReceipt ? 'What you earned' : "What you'll earn"}</Text>
      </View>

      <View style={s.row}>
        <Text style={s.label}>Bounty amount</Text>
        <Text style={s.value}>${gross.toFixed(2)}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.label}>Bounty service fee ({PLATFORM_FEE_DISPLAY})</Text>
        <Text style={s.value}>−${fee.toFixed(2)}</Text>
      </View>

      <View style={s.divider} />

      <View style={s.row}>
        <Text style={s.totalLabel}>{isReceipt ? 'Paid to you' : 'You take home'}</Text>
        <Text style={s.totalValue}>${net.toFixed(2)}</Text>
      </View>

      {showProtection ? (
        <View style={s.protectionRow}>
          <MaterialIcons name="lock" size={14} color={theme.textSecondary} />
          <Text style={s.protectionText}>
            {isReceipt
              ? 'Released from escrow to your wallet. Cash out any time from Wallet.'
              : "The poster's money is held in escrow before you start, and released to your wallet when they approve the work."}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() => router.push('/legal/how-it-works' as Href)}
        accessibilityRole="link"
        accessibilityLabel="Learn how payment and escrow work"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={s.link}>How payment works</Text>
      </TouchableOpacity>
    </View>
  );
}

export default HunterEarningsCard;

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      gap: 8,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    headText: {
      color: t.text,
      fontSize: 15,
      fontWeight: '700',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    label: {
      flex: 1,
      color: t.textSecondary,
      fontSize: 14,
    },
    value: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.border,
      marginVertical: 4,
    },
    totalLabel: {
      flex: 1,
      color: t.text,
      fontSize: 15,
      fontWeight: '700',
    },
    totalValue: {
      color: t.primary,
      fontSize: 20,
      fontWeight: '800',
    },
    protectionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 6,
    },
    protectionText: {
      flex: 1,
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    link: {
      marginTop: 6,
      color: t.primaryLight,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
