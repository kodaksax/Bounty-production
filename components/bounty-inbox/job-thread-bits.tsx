/**
 * The Focus-first pieces of a job thread (handoff "One conversation, two
 * sides"): the job strip under the chat header, and the one card pinned above
 * the message box. Both are built from the job's own records — the strip from
 * the bounty, the card from buildBountyThreadEvents via
 * selectPinnedThreadCard — so the poster and the hunter read the same state.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { calculateHunterEarnings } from '../../lib/constants/fees';
import { formatJobAmount } from '../../lib/my-jobs/format';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import type { BountyThreadRole, PinnedCardCopy } from '../../lib/utils/bounty-thread-events';
import { PosterButton } from '../poster/poster-button';
import { sideColors, type WorkspaceSide } from '../poster/side-label';

export interface JobStripInput {
  role: BountyThreadRole;
  viewerId: string | null;
  counterpartId?: string | null;
  bounty: {
    status?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
    accepted_by?: string | null;
    completed_at?: string | null;
  };
  counterpartName: string;
  paymentState?: 'released' | 'pending' | 'unknown' | null;
}

/** "You're doing this · $80 held by Bounty". Says "held" only once someone is chosen. */
export function describeJobStrip({ role, viewerId, counterpartId, bounty, counterpartName, paymentState }: JobStripInput): { side: WorkspaceSide; icon: IconName; text: string } {
  const honor = !!bounty.is_for_honor;
  const amount = honor ? null : formatJobAmount(bounty.amount);
  const status = String(bounty.status ?? '');
  const working = status === 'in_progress' || status === 'cancellation_requested';
  const hired = !!bounty.accepted_by;
  const completed = status === 'completed' || (status === 'archived' && !!bounty.completed_at);
  if (role === 'poster') {
    if (hired && working) return { side: 'posted', icon: 'assignment-ind', text: amount ? `You posted this · ${amount} held by Bounty` : 'You posted this' };
    if (hired && completed) {
      const helper = counterpartId && String(counterpartId) === String(bounty.accepted_by) && counterpartName.trim()
        ? counterpartName.trim()
        : 'your helper';
      return {
        side: 'posted',
        icon: 'assignment-ind',
        text: honor
          ? 'You posted this'
          : paymentState === 'released'
            ? `You posted this · Released to ${helper}`
            : `You posted this · Release status unconfirmed for ${helper}`,
      };
    }
    return { side: 'posted', icon: 'assignment-ind', text: amount ? `You posted this · ${amount}` : 'You posted this' };
  }
  const chosen = hired && !!viewerId && String(bounty.accepted_by) === String(viewerId);
  if (chosen && working) return { side: 'doing', icon: 'construction', text: amount ? `You're doing this · ${amount} held by Bounty` : "You're doing this" };
  if (chosen && completed) {
    const net = formatJobAmount(calculateHunterEarnings(bounty.amount).net);
    return {
      side: 'did',
      icon: 'task-alt',
      text: honor
        ? 'You did this'
        : paymentState === 'released'
          ? `You did this · ${net} released to your wallet`
          : `You did this · ${net} release status unconfirmed`,
    };
  }
  return { side: 'offered', icon: 'send', text: amount ? `You offered · ${amount}` : 'You offered' };
}

export function JobStrip({ input, onOpenJob }: { input: JobStripInput; onOpenJob: () => void }) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const strip = describeJobStrip(input);
  const { bg, fg } = sideColors(p, strip.side);
  return (
    <View style={[s.strip, { backgroundColor: bg }]} testID="job-strip">
      <MaterialIcons name={strip.icon} size={18} color={fg} />
      <Text style={s.stripText}>{strip.text}</Text>
      <TouchableOpacity
        onPress={onOpenJob}
        style={s.stripLink}
        accessibilityRole="button"
        accessibilityLabel="Open the job"
        testID="job-strip-open"
      >
        <Text style={s.stripLinkText}>Job</Text>
        <MaterialIcons name="chevron-right" size={20} color={p.gt} />
      </TouchableOpacity>
    </View>
  );
}

export function PinnedNextStep({
  copy,
  yourTurn,
  busy,
  onPress,
}: {
  copy: PinnedCardCopy;
  yourTurn: boolean;
  busy?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  return (
    <View
      style={[s.card, { borderColor: yourTurn ? p.g : p.line, borderWidth: yourTurn ? 2 : 1 }]}
      accessibilityLiveRegion="polite"
      testID={yourTurn ? 'pinned-next-step' : 'pinned-waiting'}
    >
      <View style={s.cardTop}>
        <View style={s.cardLabelRow}>
          <MaterialIcons name={yourTurn ? 'arrow-circle-right' : 'hourglass-empty'} size={18} color={yourTurn ? p.gt : p.ink2} />
          <Text style={[s.cardLabel, { color: yourTurn ? p.gt : p.ink2 }]}>{copy.label}</Text>
        </View>
        {yourTurn ? (
          <View style={[s.turnPill, { backgroundColor: p.gpill }]}>
            <Text style={[s.turnPillText, { color: p.gpillfg }]}>Your turn</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.cardTitle}>{copy.title}</Text>
      {copy.text ? <Text style={s.cardText}>{copy.text}</Text> : null}
      {yourTurn && copy.button && onPress ? (
        <PosterButton label={copy.button} onPress={onPress} loading={busy} style={s.cardButton} testID="pinned-next-step-button" />
      ) : null}
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 16,
      minHeight: FOCUS.buttonText,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    stripText: { flex: 1, color: p.ink, fontSize: 15 },
    stripLink: { flexDirection: 'row', alignItems: 'center', minHeight: FOCUS.minTouch, paddingLeft: 8 },
    stripLinkText: { color: p.gt, fontSize: 15, fontWeight: '800' },
    card: { backgroundColor: p.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 8, marginHorizontal: 12, marginBottom: 8 },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    cardLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
    turnPill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
    turnPillText: { fontSize: 13, fontWeight: '800' },
    cardTitle: { color: p.ink, fontSize: 17, fontWeight: '700', lineHeight: 23 },
    cardText: { color: p.ink2, fontSize: 15, lineHeight: 21 },
    cardButton: { marginTop: 2, minHeight: FOCUS.buttonSecondary },
  });
}
