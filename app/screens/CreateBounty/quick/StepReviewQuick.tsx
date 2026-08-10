import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepReviewQuickProps {
  draft: BountyDraft;
  onSubmit: () => void;
  onBack: () => void;
  /** Jump straight to the step that owns a given row. */
  onEdit: (step: number) => void;
  isSubmitting: boolean;
  step: number;
  totalSteps: number;
}

/** Summarises the optional step-2 context in one line. */
function describeContext(photoCount: number, description?: string): string {
  const hasDetails = (description || '').trim().length > 0;
  const photos = photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : null;

  if (photos && hasDetails) return `${photos}, details added`;
  if (photos) return `${photos} added`;
  if (hasDetails) return 'Details added';
  return 'None added';
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
  return 'Not set';
}

/**
 * Step 6 — final summary. Purely presentational: submission is owned by
 * CreateBountyFlow so the create / escrow / rollback logic stays in one place.
 */
export function StepReviewQuick({
  draft,
  onSubmit,
  onBack,
  onEdit,
  isSubmitting,
  step,
  totalSteps,
}: StepReviewQuickProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const photoCount = draft.attachments?.length ?? 0;

  const rows: {
    key: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    value: string;
    step: number;
  }[] = [
    { key: 'task', icon: 'description', label: 'Task', value: draft.title || 'Not set', step: 1 },
    {
      key: 'photos',
      icon: 'image',
      label: 'Photos & details',
      value: describeContext(photoCount, draft.description),
      step: 2,
    },
    {
      key: 'location',
      icon: draft.workType === 'online' ? 'language' : 'place',
      label: 'Location',
      value: draft.workType === 'online' ? 'Online' : draft.location || 'Not set',
      step: 3,
    },
    { key: 'date', icon: 'calendar-today', label: 'Date', value: describeSchedule(draft), step: 4 },
    {
      key: 'budget',
      icon: 'attach-money',
      label: 'Budget',
      value: draft.isForHonor ? 'For honor' : `$${draft.amount} flat rate`,
      step: 5,
    },
  ];

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title="Review your bounty"
      subtitle="Make sure everything looks right."
      ctaLabel={isSubmitting ? 'Posting…' : 'Post Bounty'}
      ctaBusy={isSubmitting}
      onCta={onSubmit}
      footerNote={
        draft.isForHonor
          ? 'No payment is involved in a for-honor bounty.'
          : "You'll only be charged when the job is done."
      }
    >
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

            <TouchableOpacity
              onPress={() => onEdit(row.step)}
              disabled={isSubmitting}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${row.label}`}
            >
              <Text style={styles.edit}>Edit</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </QuickStepLayout>
  );
}

export default StepReviewQuick;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
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
    edit: { fontSize: 16, fontWeight: '600', color: theme.primary },
  });
}
