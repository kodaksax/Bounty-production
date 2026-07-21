/**
 * Always-visible Standard vs Instant Cash Out chooser for the withdraw
 * screen. Replaces the previous design, where an Instant Cash Out entry
 * only appeared once an instant-eligible debit card was already linked
 * (withdraw-with-bank-screen.tsx's old `hasConnectedAccount &&
 * hasInstantEligibleCard` card) — that never actually offered hunters a
 * real "Instant vs Standard" choice, which the task explicitly calls for.
 * When Instant isn't eligible yet, this shows why and offers a direct path
 * to fix it instead of disappearing.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

export type WithdrawMethod = 'standard' | 'instant';

export interface WithdrawMethodSelectProps {
  selected: WithdrawMethod;
  onSelect: (method: WithdrawMethod) => void;
  instantEligible: boolean;
  /** Shown under the Instant card when it isn't eligible yet — e.g. "Add a debit card to unlock". */
  instantIneligibleReason?: string;
  onAddDebitCard: () => void;
}

export function WithdrawMethodSelect({
  selected,
  onSelect,
  instantEligible,
  instantIneligibleReason = 'Add a debit card to unlock',
  onAddDebitCard,
}: WithdrawMethodSelectProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.row}>
      <TouchableOpacity
        style={[s.card, selected === 'standard' && s.cardSelected]}
        onPress={() => onSelect('standard')}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'standard' }}
        accessibilityLabel="Standard withdrawal, free, 1 to 3 business days"
      >
        <MaterialIcons
          name="account-balance"
          size={22}
          color={selected === 'standard' ? theme.primary : theme.textSecondary}
        />
        <Text style={[s.cardTitle, selected === 'standard' && s.cardTitleSelected]}>Standard</Text>
        <Text style={s.cardSubtitle}>Free · 1-3 business days</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          s.card,
          selected === 'instant' && instantEligible && s.cardSelected,
          !instantEligible && s.cardDisabled,
        ]}
        onPress={() => (instantEligible ? onSelect('instant') : onAddDebitCard())}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'instant' && instantEligible, disabled: !instantEligible }}
        accessibilityLabel={
          instantEligible
            ? 'Instant Cash Out, fee applies, usually minutes'
            : `Instant Cash Out unavailable — ${instantIneligibleReason}`
        }
      >
        <View style={s.instantIconRow}>
          <MaterialIcons
            name="bolt"
            size={22}
            color={!instantEligible ? theme.textDisabled : selected === 'instant' ? '#22c55e' : theme.textSecondary}
          />
          {!instantEligible && <MaterialIcons name="lock" size={14} color={theme.textDisabled} style={{ marginLeft: 4 }} />}
        </View>
        <Text
          style={[
            s.cardTitle,
            selected === 'instant' && instantEligible && s.cardTitleSelectedInstant,
            !instantEligible && s.cardTitleDisabled,
          ]}
        >
          Instant
        </Text>
        <Text style={[s.cardSubtitle, !instantEligible && s.cardSubtitleDisabled]}>
          {instantEligible ? '~1% fee · Usually minutes' : instantIneligibleReason}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  card: {
    flex: 1, backgroundColor: t.surface, borderRadius: 14, padding: 14,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardSelected: { borderColor: t.primary, backgroundColor: t.surfaceSecondary },
  cardDisabled: { opacity: 0.6 },
  instantIconRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginTop: 8 },
  cardTitleSelected: { color: t.primary },
  cardTitleSelectedInstant: { color: '#22c55e' },
  cardTitleDisabled: { color: t.textSecondary },
  cardSubtitle: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  cardSubtitleDisabled: { color: t.textDisabled },
}); }
