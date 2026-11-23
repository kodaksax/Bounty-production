/**
 * FourQuestions — the block every workspace stage answers, in this order
 * (handoff block `qa`):
 *
 *   WHAT'S HAPPENING   a large headline
 *   WHAT IT MEANS      plain-language explanation
 *   Your money ·       the money truth, with an icon and tint for its kind
 *   After that ·       what to expect next (optional)
 *
 * MoneyLine is the money row on its own: inline inside FourQuestions, or as
 * a standalone card (block `money`, e.g. in the take-down dialog).
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import type { MoneyKind } from '../../lib/utils/stage-copy-types';

interface MoneyLook {
  icon: IconName;
  iconColor: string;
  bg: string;
  border: string;
  dashed: boolean;
}

/** mkind → icon and tint, as PosterBlock's `qa` maps it. */
export function getMoneyLook(kind: MoneyKind, p: PosterPalette): MoneyLook {
  switch (kind) {
    case 'held':
      return { icon: 'lock', iconColor: p.gt, bg: p.gtint, border: 'transparent', dashed: false };
    case 'released':
      return { icon: 'check-circle', iconColor: p.gt, bg: p.gtint, border: 'transparent', dashed: false };
    case 'warn':
      return { icon: 'priority-high', iconColor: p.wt, bg: p.wtint, border: 'transparent', dashed: false };
    case 'ph':
      return { icon: 'help-outline', iconColor: p.it, bg: p.itint, border: p.it, dashed: true };
    case 'none':
    default:
      return { icon: 'account-balance-wallet', iconColor: p.ink2, bg: p.card, border: p.line, dashed: false };
  }
}

export function MoneyLine({
  kind,
  text,
  variant = 'inline',
  testID,
}: {
  kind: MoneyKind;
  text: string;
  variant?: 'inline' | 'card';
  testID?: string;
}) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const look = getMoneyLook(kind, p);

  if (variant === 'card') {
    return (
      <View style={s.moneyCard} testID={testID ?? 'money-line'} accessibilityLabel={`Your money. ${text}`}>
        <MaterialIcons name={look.icon} size={22} color={look.iconColor} />
        <View style={s.moneyCardText}>
          <Text style={s.moneyCardLabel}>Your money</Text>
          <Text style={s.moneyCardBody}>{text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        s.moneyInline,
        { backgroundColor: look.bg, borderColor: look.border, borderStyle: look.dashed ? 'dashed' : 'solid' },
      ]}
      testID={testID ?? 'money-line'}
      accessible
      accessibilityLabel={`Your money. ${text}`}
      // "Checking your payment…" changing to the answer is announced.
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons name={look.icon} size={20} color={look.iconColor} style={s.moneyIcon} />
      <Text style={s.moneyText}>
        <Text style={s.moneyLead}>Your money · </Text>
        {text}
      </Text>
    </View>
  );
}

export interface FourQuestionsProps {
  now: string;
  means: string;
  money?: { kind: MoneyKind; text: string } | null;
  after?: string | null;
  /** testID for the money row (screens keep their existing ones). */
  moneyTestID?: string;
}

export function FourQuestions({ now, means, money, after, moneyTestID }: FourQuestionsProps) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);

  return (
    <View style={s.wrap} testID="four-questions" accessibilityLiveRegion="polite">
      <View style={s.group}>
        <Text style={s.label}>{"WHAT'S HAPPENING"}</Text>
        <Text style={s.headline} accessibilityRole="header" testID="qa-now">
          {now}
        </Text>
      </View>
      <View style={s.group}>
        <Text style={s.label}>WHAT IT MEANS</Text>
        <Text style={s.means} testID="qa-means">
          {means}
        </Text>
      </View>
      {money ? <MoneyLine kind={money.kind} text={money.text} testID={moneyTestID} /> : null}
      {after ? (
        <View style={s.after} testID="qa-after">
          <MaterialIcons name="subdirectory-arrow-right" size={20} color={p.ink2} style={s.moneyIcon} />
          <Text style={s.afterText}>
            <Text style={s.afterLead}>After that · </Text>
            {after}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    wrap: { gap: 18, paddingTop: 8 },
    group: { gap: 6 },
    label: { color: p.gt, fontSize: FOCUS.label, fontWeight: '800', letterSpacing: FOCUS.labelTracking },
    headline: { color: p.ink, fontSize: FOCUS.qaHeadline, fontWeight: '800', lineHeight: 35, letterSpacing: -0.6 },
    means: { color: p.ink, fontSize: FOCUS.body, lineHeight: 26 },
    moneyInline: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    moneyIcon: { marginTop: 2 },
    moneyText: { flex: 1, color: p.ink, fontSize: FOCUS.money, lineHeight: 24 },
    moneyLead: { fontWeight: '800' },
    moneyCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      backgroundColor: p.card,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    moneyCardText: { flex: 1, gap: 3 },
    moneyCardLabel: { color: p.ink2, fontSize: 14, fontWeight: '700' },
    moneyCardBody: { color: p.ink, fontSize: FOCUS.money, lineHeight: 23 },
    after: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    afterText: { flex: 1, color: p.ink2, fontSize: FOCUS.money, lineHeight: 24 },
    afterLead: { color: p.ink, fontWeight: '800' },
  });
}
