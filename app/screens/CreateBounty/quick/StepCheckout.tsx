import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { POSTING_FEE_DISPLAY } from '../../../../lib/constants/posting-fee';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepCheckoutProps {
  draft: BountyDraft;
  /** Itemised amounts, in cents, as the server will charge them. */
  totals: { feeCents: number; rewardCents: number; totalCents: number };
  onPay: () => void;
  onBack: () => void;
  isBusy: boolean;
  /** Non-null when the last attempt failed; shown above the CTA. */
  error?: string | null;
  /** True when this attempt was already paid and only needs publishing. */
  prepaid?: boolean;
  /** Fired once when this screen is first shown, for the funnel. */
  onShown?: () => void;
  step: number;
  totalSteps: number;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The checkout step for the $1 posting-fee experiment (treatment arm only).
 *
 * Purely presentational: every amount is handed in already itemised, and
 * payment orchestration lives in hooks/usePostingCheckout so the
 * charge -> verify -> publish sequence exists in exactly one place.
 *
 * WHAT THIS SCREEN HAS TO MAKE UNAMBIGUOUS
 * ----------------------------------------
 * The poster is being asked for two different kinds of money in one charge,
 * and conflating them is the failure mode with real consequences — a poster
 * who thinks the whole total is a fee will not post, and one who thinks the
 * whole total is the reward will think we pocketed it.
 *
 *   * the service fee is ours and is not refundable as balance
 *   * the reward is still THEIRS: it is held in escrow and is only released to
 *     a hunter they choose, or returned if nobody is hired
 *
 * So each line says who it goes to, and the escrow line says explicitly that
 * nothing reaches a hunter until the poster approves the work. That last point
 * is the one posters ask about, and the reason the "held in escrow" row is a
 * full row rather than a footnote.
 */
export function StepCheckout({
  draft,
  totals,
  onPay,
  onBack,
  isBusy,
  error,
  prepaid = false,
  onShown,
  step,
  totalSteps,
}: StepCheckoutProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Fire the funnel event once per mount, not once per render.
  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    onShown?.();
  }, [onShown]);

  const rows: {
    key: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    caption: string;
    value: string;
  }[] = [
    {
      key: 'reward',
      icon: 'lock',
      label: 'Bounty reward',
      caption: 'Held in escrow — still your money',
      value: money(totals.rewardCents),
    },
    {
      key: 'fee',
      icon: 'receipt-long',
      label: 'Posting service fee',
      caption: 'One-time, non-refundable',
      value: money(totals.feeCents),
    },
  ];

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title={prepaid ? 'Payment received' : 'Review and pay'}
      subtitle={
        prepaid
          ? 'You already paid for this bounty. Finish posting it — you will not be charged again.'
          : `Posting "${(draft.title || 'your bounty').trim()}" costs ${POSTING_FEE_DISPLAY} plus the reward you set.`
      }
      ctaLabel={
        prepaid
          ? 'Finish posting'
          : error
            ? 'Try again'
            : `Pay ${money(totals.totalCents)} & post`
      }
      onCta={onPay}
      ctaBusy={isBusy}
      footerNote={
        prepaid
          ? undefined
          : 'Your card is charged now. The reward stays in escrow until you approve the work.'
      }
    >
      <View style={styles.card}>
        {rows.map((row, index) => (
          <View
            key={row.key}
            style={[styles.row, index < rows.length - 1 && styles.rowDivider]}
          >
            <View style={styles.rowIcon}>
              <MaterialIcons name={row.icon} size={18} color={theme.textSecondary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowCaption}>{row.caption}</Text>
            </View>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Charged today</Text>
          <Text style={styles.totalValue}>{money(totals.totalCents)}</Text>
        </View>
      </View>

      {/* The three questions posters actually ask, answered before they are
          asked. Ordered by when each thing happens, not by importance. */}
      <View style={styles.explainer}>
        <ExplainerLine
          theme={theme}
          styles={styles}
          icon="check-circle"
          text={`You pay ${money(totals.totalCents)} now — ${money(totals.feeCents)} to post, ${money(totals.rewardCents)} into escrow.`}
        />
        <ExplainerLine
          theme={theme}
          styles={styles}
          icon="lock"
          text="The reward sits in escrow while hunters apply. Nobody can touch it."
        />
        <ExplainerLine
          theme={theme}
          styles={styles}
          icon="payments"
          text="Nothing more is charged when you hire someone — the reward is already covered."
        />
        <ExplainerLine
          theme={theme}
          styles={styles}
          icon="undo"
          text="Cancel before hiring and the reward is returned to your balance."
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={18} color={theme.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </QuickStepLayout>
  );
}

function ExplainerLine({
  theme,
  styles,
  icon,
  text,
}: {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.explainerRow}>
      <MaterialIcons name={icon} size={16} color={theme.textSecondary} />
      <Text style={styles.explainerText}>{text}</Text>
    </View>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      gap: 12,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    rowIcon: {
      width: 28,
      alignItems: 'center',
    },
    rowText: {
      flex: 1,
    },
    rowLabel: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowCaption: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    rowValue: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    totalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingVertical: 14,
      marginTop: 2,
    },
    totalLabel: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
    },
    totalValue: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    explainer: {
      marginTop: 20,
      gap: 10,
    },
    explainerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    explainerText: {
      flex: 1,
      color: theme.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 20,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.error,
      backgroundColor: `${theme.error}14`,
    },
    errorText: {
      flex: 1,
      color: theme.error,
      fontSize: 13,
      lineHeight: 19,
    },
  });

export default StepCheckout;
