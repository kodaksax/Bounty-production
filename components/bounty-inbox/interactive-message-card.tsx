/**
 * The action message a bounty thread shows for each workflow step — the
 * hunter applies, the poster hires, the hunter submits, the poster pays.
 *
 * Deliberately plain: it is the same bubble as an ordinary chat message
 * (components/MessageBubble.tsx) — brand green for the viewer's side, dark
 * grey for the other person, white text, system font — with the step's text
 * and, when the step needs the viewer, a button inside the bubble.
 *
 * The other person's cards are stacked (Hinge / Instagram-reply style): a
 * taller card showing the bounty the action is about sits behind, and the
 * action bubble overlaps its bottom edge.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AttachmentMeta, Bounty } from 'lib/services/database.types';
import type {
  BountyThreadAction,
  BountyThreadEvent,
  BountyThreadRole,
} from 'lib/utils/bounty-thread-events';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { useHapticFeedback } from '../../lib/haptic-feedback';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { MESSAGE_FONT_SIZE } from '../MessageBubble';

// The chat bubble colours from MessageBubble.
const MINE_BG = '#008E2A';
const THEIRS_BG = '#2A2E35';

// How far the action bubble rides up over the bounty card behind it.
const STACK_OVERLAP = 22;

interface Props {
  event: BountyThreadEvent;
  role: BountyThreadRole;
  bounty: Bounty;
  counterpartName: string;
  /** Fade in (a card that just arrived) rather than appearing in place. */
  animateIn?: boolean;
  /** An action from this card is in flight. */
  busy?: boolean;
  /** `choice` is only set for accept_or_decline. */
  onAction: (action: BountyThreadAction, event: BountyThreadEvent, choice?: 'accept' | 'decline') => void;
}

interface Copy {
  label: string;
  title: string;
  subtitle?: string;
  cta?: string;
}

function money(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function formatThreadTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function copyFor(event: BountyThreadEvent, role: BountyThreadRole, bounty: Bounty, name: string): Copy {
  const mine = event.actor === role;
  switch (event.kind) {
    case 'posted':
      return { label: 'Bounty posted', title: bounty.title };
    case 'applied':
      return {
        label: 'Application',
        title: mine ? 'Application sent' : `${name} applied`,
        subtitle: mine ? `Waiting on ${name}` : undefined,
      };
    case 'application_declined':
      return {
        label: 'Application',
        title: event.meta?.hiredSomeoneElse
          ? 'Someone else was hired'
          : event.meta?.systemClosed
            ? 'Application closed'
            : 'Not selected this time',
      };
    case 'hired':
      return {
        label: 'Hired',
        title: role === 'hunter' ? "You're hired" : `You hired ${name}`,
        subtitle: bounty.is_for_honor ? undefined : `${money(bounty.amount)} held in escrow`,
        cta: role === 'hunter' ? 'Submit work' : undefined,
      };
    case 'work_submitted':
      return {
        label: Number(event.meta?.revisionCount ?? 0) > 0 ? 'Revised work' : 'Work submitted',
        title: mine ? 'Work submitted' : `${name} submitted work`,
        subtitle: mine ? `Waiting on ${name}'s review` : undefined,
        cta: role === 'poster' ? 'Review & pay' : undefined,
      };
    case 'revision_requested':
      return {
        label: 'Changes requested',
        title: mine ? 'You asked for changes' : `${name} asked for changes`,
        cta: role === 'hunter' ? 'Resubmit work' : undefined,
      };
    case 'paid':
      return event.meta?.isForHonor
        ? { label: 'Completed', title: 'Completed for honor' }
        : {
            label: 'Payment released',
            title: money(Number(event.meta?.amount ?? 0)),
            subtitle: role === 'hunter' ? `Paid by ${name}` : `Paid to ${name}`,
            cta: role === 'hunter' ? 'View payout' : undefined,
          };
    case 'cancellation_requested':
      return {
        label: 'Cancellation',
        title: mine ? 'You asked to cancel' : `${name} asked to cancel`,
        subtitle: event.live && mine ? `Waiting on ${name}` : undefined,
        cta:
          event.action === 'respond_cancellation'
            ? 'Respond'
            : event.action === 'view_cancellation'
              ? 'View request'
              : undefined,
      };
    case 'cancellation_resolved':
      return event.meta?.outcome === 'accepted'
        ? { label: 'Cancellation', title: 'Cancellation approved', subtitle: 'Escrow returned to the poster' }
        : { label: 'Cancellation', title: 'Cancellation declined', subtitle: 'The bounty continues' };
    case 'dispute_opened':
      return {
        label: 'Dispute',
        title: mine ? 'You opened a dispute' : `${name} opened a dispute`,
        subtitle: event.live ? 'Paused while support reviews' : 'Dispute closed',
        cta: 'View dispute',
      };
    default:
      return { label: 'Update', title: 'Update' };
  }
}

function details(event: BountyThreadEvent, bounty: Bounty, role: BountyThreadRole) {
  const rows: { label: string; value: string }[] = [];
  let note: string | null = event.note?.trim() || null;
  switch (event.kind) {
    case 'posted':
      rows.push({ label: 'Reward', value: bounty.is_for_honor ? 'For honor' : money(bounty.amount) });
      if (bounty.location && bounty.work_type !== 'online') rows.push({ label: 'Where', value: bounty.location });
      if (bounty.timeline) rows.push({ label: 'When', value: bounty.timeline });
      note = bounty.description?.trim() || null;
      break;
    case 'applied':
      rows.push({ label: 'Reward', value: bounty.is_for_honor ? 'For honor' : money(bounty.amount) });
      break;
    case 'work_submitted': {
      const proofs = Number(event.meta?.proofCount ?? 0);
      rows.push({ label: 'Proof', value: proofs === 0 ? 'None attached' : `${proofs} attachment${proofs === 1 ? '' : 's'}` });
      break;
    }
    case 'hired':
      if (role === 'hunter' && event.live) note = 'When the work is done, submit your proof for review.';
      break;
    default:
      break;
  }
  return { rows, note };
}

function firstImageUri(bounty: Bounty): string | null {
  if (!bounty.attachments_json) return null;
  try {
    const attachments: AttachmentMeta[] = JSON.parse(bounty.attachments_json);
    return attachments.find(a => a.remoteUri && a.mimeType?.startsWith('image/'))?.remoteUri ?? null;
  } catch {
    return null;
  }
}

/**
 * The taller card behind the other person's action: the bounty it refers to.
 * Bottom padding leaves room for the overlapping bubble.
 */
function BountyContextCard({
  bounty,
  role,
  counterpartName,
  label,
  quote,
  st,
}: {
  bounty: Bounty;
  role: BountyThreadRole;
  counterpartName: string;
  label: string;
  /** The other person's message for this step, shown under the bounty. */
  quote?: string | null;
  st: ReturnType<typeof makeStackStyles>;
}) {
  const { theme } = useAppThemeContext();
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const cover = firstImageUri(bounty);
  const reward = bounty.is_for_honor ? 'For honor' : money(bounty.amount);
  const where = bounty.work_type === 'online' ? 'Online' : bounty.location;
  return (
    <View style={st.context} accessibilityLabel={`Bounty: ${bounty.title}, ${reward}`}>
      <View style={st.cover}>
        {cover ? (
          <ExpoImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={cover} />
        ) : (
          <LinearGradient
            colors={[theme.primary, theme.primary + 'cc']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, st.coverFallback]}
          >
            <MaterialIcons name="gps-fixed" size={40} color="rgba(255,255,255,0.85)" />
          </LinearGradient>
        )}
        <View style={st.coverChip}>
          <Text style={st.coverChipText}>{label}</Text>
        </View>
      </View>
      <View style={st.contextBody}>
        <Text style={st.eyebrow}>{role === 'poster' ? 'Your bounty' : `${counterpartName}'s bounty`}</Text>
        <Text style={st.contextTitle} numberOfLines={2}>
          {bounty.title}
        </Text>
        <View style={st.metaRow}>
          <Text style={st.reward}>{reward}</Text>
          {!!where && (
            <Text style={st.meta} numberOfLines={1}>
              · {where}
            </Text>
          )}
        </View>
        {!!quote && (
          <Text
            style={st.quote}
            numberOfLines={quoteExpanded ? undefined : 2}
            onPress={() => setQuoteExpanded(v => !v)}
            accessibilityHint={quoteExpanded ? 'Collapse message' : 'Show full message'}
          >
            “{quote}”
          </Text>
        )}
      </View>
    </View>
  );
}

/** Centered timeline note for system events (cancelled, dispute resolved). */
function SystemNote({ event, onPress }: { event: BountyThreadEvent; onPress?: () => void }) {
  const { theme } = useAppThemeContext();
  const text =
    event.kind === 'cancelled'
      ? 'Bounty cancelled'
      : event.kind === 'dispute_resolved'
        ? 'Dispute resolved'
        : event.kind === 'application_declined'
          ? 'Application closed'
          : 'Update';
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={{ alignSelf: 'center', marginVertical: 8 }}
    >
      <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
        {text} · {formatThreadTime(event.at)}
      </Text>
    </TouchableOpacity>
  );
}

export function InteractiveMessageCard({
  event,
  role,
  bounty,
  counterpartName,
  animateIn = false,
  busy = false,
  onAction,
}: Props) {
  const { prefersReducedMotion } = useAccessibleAnimation();
  const { triggerHaptic } = useHapticFeedback();
  const { theme } = useAppThemeContext();
  const st = useMemo(() => makeStackStyles(theme), [theme]);
  const fade = useRef(new Animated.Value(animateIn ? 0 : 1)).current;

  useEffect(() => {
    if (!animateIn) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: prefersReducedMotion ? 0 : 200,
      useNativeDriver: true,
    }).start();
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (event.actor === 'system') {
    return <SystemNote event={event} onPress={event.action ? () => onAction(event.action!, event) : undefined} />;
  }

  const copy = copyFor(event, role, bounty, counterpartName);
  const mine = event.actor === role;
  // The other person's action about this bounty gets the bounty card behind
  // it. 'posted' is itself the bounty, so it stays a plain bubble.
  const stacked = !mine && event.kind !== 'posted';
  const { rows, note } = details(event, bounty, role);
  const done = !event.live && event.kind !== 'posted' && event.kind !== 'paid';
  const destructive = event.action === 'withdraw' || event.action === 'dismiss';
  const singleAction =
    event.action && event.action !== 'accept_or_decline' && !destructive && copy.cta ? event.action : null;

  const fire = (action: BountyThreadAction, choice?: 'accept' | 'decline') => {
    if (busy) return;
    triggerHaptic(choice === 'decline' ? 'light' : 'medium');
    onAction(action, event, choice);
  };

  // A button inside the bubble: white on the green bubble, green on the grey one.
  const primaryBtn = mine ? s.btnOnMine : s.btnOnTheirs;
  const primaryColor = mine ? MINE_BG : '#fff';

  const bubbleLift = fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View
      style={[s.wrap, mine ? s.wrapMine : s.wrapTheirs, stacked && st.wrapStacked, { opacity: fade }]}
    >
      {stacked && (
        <BountyContextCard
          bounty={bounty}
          role={role}
          counterpartName={counterpartName}
          label={copy.label}
          quote={note}
          st={st}
        />
      )}
      <Animated.View
        style={[
          s.bubble,
          mine ? s.bubbleMine : s.bubbleTheirs,
          stacked && st.bubbleStacked,
          stacked && { transform: [{ translateY: bubbleLift }] },
          done && { opacity: 0.75 },
        ]}
        accessibilityLabel={[copy.label, copy.title, copy.subtitle, event.yourTurn ? 'Your move' : null]
          .filter(Boolean)
          .join('. ')}
      >
        {/* Stacked bubbles carry only the action ("Sam applied") and, when it
            is the viewer's turn, "Your move" — no step label, details or time. */}
        {stacked ? (
          event.yourTurn && <Text style={[s.label, st.labelStacked]}>Your move</Text>
        ) : (
          <Text style={s.label}>
            {copy.label}
            {event.yourTurn ? ' · Your move' : ''}
          </Text>
        )}
        <Text style={[s.title, stacked && st.titleStacked]}>{copy.title}</Text>
        {!stacked && !!copy.subtitle && <Text style={s.subtitle}>{copy.subtitle}</Text>}

        {!stacked && rows.length > 0 && (
          <View style={s.rows}>
            {rows.map(r => (
              <Text key={r.label} style={s.row}>
                <Text style={s.rowLabel}>{r.label}: </Text>
                {r.value}
              </Text>
            ))}
          </View>
        )}
        {!stacked && !!note && (
          <Text style={s.note} numberOfLines={event.kind === 'posted' ? 3 : 6}>
            {note}
          </Text>
        )}

        {event.action === 'accept_or_decline' ? (
          <View style={[s.btnRow, stacked && st.btnRowStacked]}>
            <TouchableOpacity
              onPress={() => fire('accept_or_decline', 'decline')}
              disabled={busy}
              style={[s.btn, stacked && st.btnStacked, s.btnOutline]}
              accessibilityRole="button"
              accessibilityLabel={`Pass on ${counterpartName}`}
            >
              <Text style={[s.btnText, { color: '#fff' }]}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => fire('accept_or_decline', 'accept')}
              disabled={busy}
              style={[s.btn, stacked && st.btnStacked, primaryBtn]}
              accessibilityRole="button"
              accessibilityLabel={`Hire ${counterpartName}`}
            >
              {busy ? (
                <ActivityIndicator color={primaryColor} />
              ) : (
                <Text style={[s.btnText, { color: primaryColor }]}>Hire</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : singleAction ? (
          <TouchableOpacity
            onPress={() => fire(singleAction)}
            disabled={busy}
            style={[s.btn, stacked && st.btnStacked, primaryBtn, s.btnFull, stacked && st.btnRowStacked]}
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
          >
            {busy ? (
              <ActivityIndicator color={primaryColor} />
            ) : (
              <Text style={[s.btnText, { color: primaryColor }]}>{copy.cta}</Text>
            )}
          </TouchableOpacity>
        ) : destructive ? (
          <TouchableOpacity
            onPress={() => fire(event.action!)}
            disabled={busy}
            style={[s.btn, stacked && st.btnStacked, s.btnOutline, s.btnFull, stacked && st.btnRowStacked]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[s.btnText, { color: '#fff' }]}>
                {event.action === 'withdraw' ? 'Withdraw application' : 'Remove from list'}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}

        {!stacked && (
          <Text style={s.time}>
            {formatThreadTime(event.at)}
            {done && event.kind !== 'application_declined' ? ' · Done' : ''}
          </Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}

// Metrics follow MessageBubble: rounded-2xl with a square tail corner, max 80%
// width, white text at the message font size.
const s = StyleSheet.create({
  wrap: {
    marginBottom: 12,
    paddingHorizontal: 12,
    maxWidth: '80%',
  },
  wrapMine: { marginLeft: 'auto' },
  wrapTheirs: { marginRight: 'auto' },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleMine: { backgroundColor: MINE_BG, borderBottomRightRadius: 0 },
  bubbleTheirs: { backgroundColor: THEIRS_BG, borderBottomLeftRadius: 0 },
  label: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  title: {
    color: '#fff',
    fontSize: MESSAGE_FONT_SIZE.body,
    lineHeight: Math.round(MESSAGE_FONT_SIZE.body * 1.35),
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    marginTop: 2,
  },
  rows: {
    marginTop: 8,
    gap: 2,
  },
  row: {
    color: '#fff',
    fontSize: 15,
  },
  rowLabel: {
    color: 'rgba(255,255,255,0.7)',
  },
  note: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  btn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  btnFull: {
    flex: 0,
    marginTop: 10,
  },
  btnOnMine: { backgroundColor: '#fff' },
  btnOnTheirs: { backgroundColor: MINE_BG },
  btnOutline: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  time: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
});

// Stacked layout for the other person's cards. Themed: the card behind uses
// the raised surface so it reads as a layer under the bubble.
function makeStackStyles(t: AppTheme) {
  return StyleSheet.create({
    wrapStacked: {
      width: '76%',
      maxWidth: 300,
    },
    context: {
      backgroundColor: t.surfaceRaised,
      borderColor: t.borderRaised,
      borderWidth: 1,
      borderRadius: 20,
      overflow: 'hidden',
      paddingBottom: STACK_OVERLAP + 6,
      shadowColor: '#000',
      shadowOpacity: t.isDark ? 0.35 : 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    cover: {
      height: 96,
      backgroundColor: t.surfaceSecondary,
    },
    coverFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverChip: {
      position: 'absolute',
      top: 10,
      left: 10,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    coverChipText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    contextBody: {
      paddingHorizontal: 14,
      paddingTop: 10,
      gap: 2,
    },
    eyebrow: {
      color: t.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    contextTitle: {
      color: t.text,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '700',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    reward: {
      color: t.primaryLight,
      fontSize: 14,
      fontWeight: '800',
    },
    meta: {
      flexShrink: 1,
      color: t.textSecondary,
      fontSize: 13,
    },
    // The action bubble rides up over the card's bottom-right edge — shorter
    // than the card, square to it (no tilt, no tail), and ringed in the
    // screen colour so it reads as a separate layer.
    bubbleStacked: {
      marginTop: -STACK_OVERLAP,
      alignSelf: 'flex-end',
      width: '72%',
      // Hangs past the card's right edge so it sits over the corner.
      marginRight: -12,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderBottomLeftRadius: 16,
      borderWidth: 3,
      borderColor: t.background,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    // Compact text so the overlapping bubble stays short.
    labelStacked: { fontSize: 11, marginBottom: 0 },
    titleStacked: { fontSize: 15, lineHeight: 19 },
    // The other person's message rides on the bounty card (not the bubble)
    // so every stacked bubble is the same short height. Tap to expand.
    quote: {
      color: t.text,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 6,
    },
    btnRowStacked: { marginTop: 6 },
    btnStacked: { minHeight: 32, borderRadius: 10 },
  });
}
