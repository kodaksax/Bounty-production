import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { schedulePresetToDates } from 'lib/utils/schedule-utils';
import React, { useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepWhenProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  /** True while the parent persists this step onto a live bounty. */
  isSaving?: boolean;
  step: number;
  totalSteps: number;
}

type WhenChoice = 'asap' | 'today' | 'tomorrow' | 'custom';

const CHOICES: { key: WhenChoice; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'asap', label: 'ASAP', icon: 'schedule' },
  { key: 'today', label: 'Today', icon: 'wb-sunny' },
  { key: 'tomorrow', label: 'Tomorrow', icon: 'wb-twilight' },
  { key: 'custom', label: 'Pick a date', icon: 'calendar-today' },
];

/**
 * Step 4 — timing. Writes the same structured schedule fields the previous
 * schedule step did (scheduleType / startDate / endDate), which bountyService
 * maps to schedule_type, start_date, end_date and the is_time_sensitive flag.
 */
export function StepWhen({ draft, onUpdate, onNext, onBack, isSaving = false, step, totalSteps }: StepWhenProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Derive the active choice from the draft so returning to this step (e.g.
  // via Edit on the review screen) restores the selection.
  const selected: WhenChoice | null = useMemo(() => {
    if (draft.scheduleType === 'asap') return 'asap';
    if (draft.scheduleType === 'scheduled') {
      if (draft.startDate) {
        const start = new Date(draft.startDate);
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (start.toDateString() === now.toDateString()) return 'today';
        if (start.toDateString() === tomorrow.toDateString()) return 'tomorrow';
      }
      return 'custom';
    }
    return null;
  }, [draft.scheduleType, draft.startDate]);

  const isFlexible = draft.scheduleType === 'flexible';

  const handleSelect = (choice: WhenChoice) => {
    if (choice === 'asap') {
      onUpdate({ scheduleType: 'asap', startDate: undefined, endDate: undefined, conditionalEndNote: undefined });
      return;
    }
    if (choice === 'today' || choice === 'tomorrow') {
      const { startDate, endDate } = schedulePresetToDates(choice);
      onUpdate({ scheduleType: 'scheduled', startDate, endDate, conditionalEndNote: undefined });
      return;
    }
    // custom
    setPickerVisible(true);
  };

  const handleToggleFlexible = () => {
    if (isFlexible) {
      onUpdate({ scheduleType: undefined });
    } else {
      onUpdate({ scheduleType: 'flexible', startDate: undefined, endDate: undefined, conditionalEndNote: undefined });
    }
  };

  const handlePickerChange = (_event: unknown, date?: Date) => {
    if (Platform.OS === 'android') setPickerVisible(false);
    if (!date) return;
    onUpdate({
      scheduleType: 'scheduled',
      startDate: date.toISOString(),
      endDate: undefined,
      conditionalEndNote: undefined,
    });
  };

  const pickedDateLabel =
    selected === 'custom' && draft.startDate
      ? new Date(draft.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : null;

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title=" it?"
      ctaLabel={isSaving ? 'Saving…' : 'Continue'}
      ctaDisabled={!draft.scheduleType}
      ctaBusy={isSaving}
      onCta={onNext}
    >
      <View style={styles.grid}>
        {CHOICES.map((choice) => {
          const active = !isFlexible && selected === choice.key;
          return (
            <TouchableOpacity
              key={choice.key}
              onPress={() => handleSelect(choice.key)}
              activeOpacity={0.85}
              style={[
                styles.card,
                {
                  backgroundColor: active
                    ? theme.isDark
                      ? 'rgba(5,150,105,0.22)'
                      : 'rgba(5,150,105,0.12)'
                    : theme.surfaceSecondary,
                  borderColor: active ? theme.primary : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityState={{ selected: active }}
            >
              <MaterialIcons
                name={choice.icon}
                size={26}
                color={active ? theme.primary : theme.text}
              />
              <Text style={[styles.cardLabel, { color: active ? theme.primary : theme.text }]}>
                {choice.key === 'custom' && pickedDateLabel ? pickedDateLabel : choice.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Flexible */}
      <TouchableOpacity
        onPress={handleToggleFlexible}
        activeOpacity={0.8}
        style={styles.flexibleRow}
        accessibilityRole="radio"
        accessibilityLabel="I'm flexible on timing"
        accessibilityState={{ checked: isFlexible }}
      >
        <View style={[styles.radio, { borderColor: isFlexible ? theme.primary : theme.border }]}>
          {isFlexible ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}
        </View>
        <Text style={[styles.flexibleLabel, { color: isFlexible ? theme.primary : theme.text }]}>
          I&apos;m flexible on timing
        </Text>
      </TouchableOpacity>

      {/* Date picker */}
      {pickerVisible && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft.startDate ? new Date(draft.startDate) : new Date()}
          mode="date"
          minimumDate={new Date()}
          onChange={handlePickerChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={pickerVisible} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <DateTimePicker
                value={draft.startDate ? new Date(draft.startDate) : new Date()}
                mode="date"
                display="spinner"
                minimumDate={new Date()}
                onChange={handlePickerChange}
                textColor={theme.text}
              />
              <TouchableOpacity
                onPress={() => setPickerVisible(false)}
                style={[styles.modalDone, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Done choosing a date"
              >
                <Text style={styles.modalDoneLabel}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </QuickStepLayout>
  );
}

export default StepWhen;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    card: {
      width: '47%',
      flexGrow: 1,
      height: 120,
      borderRadius: 20,
      borderWidth: 2,
      padding: 18,
      justifyContent: 'space-between',
    },
    cardLabel: { fontSize: 17, fontWeight: '700' },
    flexibleRow: { marginTop: 26, flexDirection: 'row', alignItems: 'center' },
    radio: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioDot: { width: 12, height: 12, borderRadius: 6 },
    flexibleLabel: { marginLeft: 14, fontSize: 17, fontWeight: '500' },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalSheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 16,
    },
    modalDone: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    modalDoneLabel: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  });
}
