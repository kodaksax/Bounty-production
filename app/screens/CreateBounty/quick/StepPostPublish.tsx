import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

/** Which optional detail a row edits — maps to the step screen to open. */
export type DetailTarget = 'photos' | 'where' | 'when';

interface StepPostPublishProps {
  /** Snapshot of the draft as published, plus any details added since. */
  draft: BountyDraft;
  /** Open the step screen that owns a given detail. */
  onAddDetail: (target: DetailTarget) => void;
  /** Leaves the flow for the bounty feed. */
  onContinue: () => void;
  step: number;
  totalSteps: number;
}

/** Summarises the optional photos/details in one line. */
function describeContext(photoCount: number, description?: string): string {
  const hasDetails = (description || '').trim().length > 0;
  const photos = photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : null;

  if (photos && hasDetails) return `${photos}, details added`;
  if (photos) return `${photos} added`;
  if (hasDetails) return 'Details added';
  return 'Not added yet';
}

/** Human-readable timing label for the summary row. */
function describeSchedule(draft: BountyDraft): string {
  if (draft.scheduleType === 'asap') return 'ASAP';
  if (draft.scheduleType === 'flexible') return 'Flexible';
  if (draft.scheduleType === 'scheduled' && draft.startDate) {
    const start = new Date(draft.startDate);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.toDateString() === now.toDateString()) return 'Today';
    if (start.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return 'Not added yet';
}

/**
 * The confirmation screen for the two-step posting flow — the bounty is
 * already live by the time this renders.
 *
 * Reuses the review step's summary-card layout, but reframed: the rows are an
 * invitation to enrich a bounty that already exists, not a gate before
 * publishing. Every row is genuinely optional, which is why the CTA is a plain
 * "Continue" rather than a submit.
 *
 * Budget is intentionally read-only here. Escrow is funded at publish time
 * against the published amount, so changing it after the fact would desync the
 * bounty from its escrow row — see bountyService.updateBountyDetails.
 */
export function StepPostPublish({
  draft,
  onAddDetail,
  onContinue,
  step,
  totalSteps,
}: StepPostPublishProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const photoCount = draft.attachments?.length ?? 0;
  const locationValue =
    draft.workType === 'online' ? 'Online' : draft.location || 'Not added yet';

  const rows: {
    key: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    value: string;
    target?: DetailTarget;
  }[] = [
    { key: 'task', icon: 'description', label: 'Task', value: draft.title || 'Not set' },
    {
      key: 'photos',
      icon: 'image',
      label: 'Photos & details',
      value: describeContext(photoCount, draft.description),
      target: 'photos',
    },
    {
      key: 'location',
      icon: draft.workType === 'online' ? 'language' : 'place',
      label: 'Location',
      value: locationValue,
      target: 'where',
    },
    {
      key: 'date',
      icon: 'calendar-today',
      label: 'Date',
      value: describeSchedule(draft),
      target: 'when',
    },
    {
      key: 'budget',
      icon: 'attach-money',
      label: 'Budget',
      value: draft.isForHonor ? 'For honor' : `$${draft.amount} flat rate`,
    },
  ];

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      title="Your Bounty is live!!!"
      subtitle="It's live and hunters can see it now. Adding more below is optional — it just helps people understand the task."
      ctaLabel="Continue"
      onCta={onContinue}
      footerNote={
        draft.isForHonor
          ? 'No payment is involved in a for-honor bounty.'
          : "You'll only be charged when the job is done."
      }
    >
      <View style={styles.liveBadge}>
        <MaterialIcons name="check-circle" size={20} color={theme.primary} />
        <Text style={styles.liveText}>Posted and visible in the feed</Text>
      </View>

      <Text style={styles.sectionLabel}>Add more details to your bounty</Text>

      <View style={styles.card}>
        {rows.map((row, index) => (
          <View
            key={row.key}
            style={[styles.row, index < rows.length - 1 ? styles.rowDivider : null]}
          >
            <View style={styles.iconCircle}>
              <MaterialIcons name={row.icon} size={20} color={theme.primary} />
            </View>

            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue} numberOfLines={2}>
                {row.value}
              </Text>
            </View>

            {row.target ? (
              <TouchableOpacity
                onPress={() => onAddDetail(row.target!)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${row.label}`}
              >
                <Text style={styles.add}>Add</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </View>
    </QuickStepLayout>
  );
}

export default StepPostPublish;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    liveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.18)' : 'rgba(5,150,105,0.10)',
    },
    liveText: {
      marginLeft: 10,
      fontSize: 14,
      fontWeight: '700',
      color: theme.text,
    },
    sectionLabel: {
      marginTop: 22,
      marginBottom: 10,
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
    },
    card: {
      borderRadius: 24,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', padding: 18 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 15, color: theme.textSecondary },
    rowValue: { marginTop: 3, fontSize: 17, fontWeight: '700', color: theme.text },
    add: { fontSize: 16, fontWeight: '600', color: theme.primary },
  });
}
