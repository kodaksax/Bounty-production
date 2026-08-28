// components/admin/AdminEventRow.tsx — one row of the canonical event ledger.
//
// Shared by the Command Center's live activity feed and a bounty's lifecycle
// timeline so the two can never drift into describing the same event
// differently.
//
// The provenance chip is not decoration. `payment.released` written by our own
// edge function and `stripe.transfer.paid` confirmed by a signed webhook are
// different facts, and the row is built so the second one cannot be mistaken
// for the first: the chip text comes from the `source` column, never from the
// event name.
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import { eventClassification, eventLabel } from '../../lib/admin/commandCenterClient';
import type { AdminEventSource, AdminLedgerEvent } from '../../lib/types-admin';
import { formatMoney, formatRelative, withAlpha } from './AdminUI';

type IconName = keyof typeof MaterialIcons.glyphMap;

/** Icon per event family. Falls back to a neutral dot for anything new. */
function iconFor(eventType: string): IconName {
  if (eventType.startsWith('bounty.posted')) return 'add-circle-outline';
  if (eventType.startsWith('bounty.accepted') || eventType.startsWith('bounty.in_progress'))
    return 'handshake';
  if (eventType.startsWith('bounty.completed')) return 'check-circle';
  if (eventType.startsWith('bounty.cancelled')) return 'cancel';
  if (eventType.startsWith('bounty.')) return 'work';
  if (eventType.startsWith('application.')) return 'how-to-reg';
  if (eventType.startsWith('completion.')) return 'assignment-turned-in';
  if (eventType.startsWith('payout.')) return 'payments';
  if (eventType.startsWith('payment.')) return 'account-balance-wallet';
  if (eventType.startsWith('dispute.')) return 'gavel';
  if (eventType.startsWith('moderation.')) return 'report';
  if (eventType.startsWith('stripe.')) return 'bolt';
  return 'circle';
}

/** Colour per provenance. Only a webhook confirmation reads as settled. */
function sourceColor(theme: ReturnType<typeof useAppTheme>['theme'], source: AdminEventSource) {
  switch (source) {
    case 'webhook':
      return theme.success;
    case 'stripe':
      return theme.info;
    case 'inferred':
      return theme.warning;
    case 'system':
      return theme.textSecondary;
    default:
      return theme.primary;
  }
}

/** Events that mean something went wrong, regardless of provenance. */
function isFailure(eventType: string): boolean {
  return (
    eventType.endsWith('.failed') ||
    eventType.startsWith('dispute.') ||
    eventType.startsWith('moderation.')
  );
}

export function AdminEventRow({
  event,
  showBounty = true,
  onPress,
  last,
}: {
  event: AdminLedgerEvent;
  /** Hide the bounty line on a timeline, where every row is the same bounty. */
  showBounty?: boolean;
  onPress?: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const classification = eventClassification(event);
  const accent = isFailure(event.eventType) ? theme.error : sourceColor(theme, classification.source);
  const label = eventLabel(event);

  const body = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: withAlpha(accent, 0.12), borderRadius: theme.radius.md },
        ]}
      >
        <MaterialIcons name={iconFor(event.eventType)} size={18} color={accent} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.titleLine}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text, flexShrink: 1 }}>
            {label}
          </Text>
          {event.amount != null ? (
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
              {formatMoney(event.amount)}
            </Text>
          ) : null}
        </View>

        {/* Provenance. Never omitted — an unlabelled money event is exactly the
            ambiguity this screen exists to remove. */}
        <View style={styles.metaLine}>
          <View
            style={[
              styles.chip,
              {
                backgroundColor: withAlpha(accent, 0.14),
                borderColor: withAlpha(accent, 0.4),
                borderRadius: theme.radius.sm,
              },
            ]}
          >
            <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: accent }}>
              {classification.label}
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            {formatRelative(event.occurredAt)}
          </Text>
        </View>

        {event.actorUsername ? (
          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {event.actorUsername}
          </Text>
        ) : null}

        {showBounty && event.bountyTitle ? (
          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {event.bountyTitle}
          </Text>
        ) : null}

        {event.correlationId ? (
          <Text
            style={{ fontSize: 11, color: theme.textDisabled, marginTop: 2, fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {event.correlationId}
          </Text>
        ) : null}
      </View>

      {onPress ? (
        <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  titleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
});
