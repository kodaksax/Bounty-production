import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { DURATION_PRESETS, formatDuration, schedulePresetToDates } from 'lib/utils/schedule-utils';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';

interface StepScheduleProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

/** Quick-select presets shown at the top of the scheduling step. */
type QuickPreset = 'asap' | 'today' | 'tomorrow' | 'this_week' | 'custom' | 'flexible';

const QUICK_PRESETS: { key: QuickPreset; label: string; icon: string }[] = [
  { key: 'asap',      label: 'ASAP',       icon: '🔴' },
  { key: 'today',     label: 'Today',      icon: '🟠' },
  { key: 'tomorrow',  label: 'Tomorrow',   icon: '🟡' },
  { key: 'this_week', label: 'This Week',  icon: '📅' },
  { key: 'custom',    label: 'Custom',     icon: '⏰' },
  { key: 'flexible',  label: 'Flexible',   icon: '🌀' },
];

type DatePickerTarget = 'startDate' | 'endDate' | 'latestArrivalTime';

export function StepSchedule({ draft, onUpdate, onNext, onBack }: StepScheduleProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;
  const scrollRef = useRef<any>(null);

  // Derive the active quick-preset from current draft state
  const [activePreset, setActivePreset] = useState<QuickPreset>(() => {
    if (draft.scheduleType === 'asap')     return 'asap';
    if (draft.scheduleType === 'flexible') return 'flexible';
    if (draft.scheduleType === 'scheduled') {
      // Attempt to reverse-match a preset from dates
      if (draft.startDate && draft.endDate) {
        const start = new Date(draft.startDate);
        const end   = new Date(draft.endDate);
        const now   = new Date();
        const isToday  = (d: Date) => d.toDateString() === now.toDateString();
        const isTomorrow = (d: Date) => {
          const tom = new Date(now); tom.setDate(tom.getDate() + 1);
          return d.toDateString() === tom.toDateString();
        };
        if (isToday(start) && isToday(end))     return 'today';
        if (isTomorrow(start) && isTomorrow(end)) return 'tomorrow';
      }
      return 'custom';
    }
    return 'asap'; // default
  });

  // Date picker state (Android shows a dialog; iOS shows inline in a modal)
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<DatePickerTarget>('startDate');
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, []);

  // ── Preset selection ────────────────────────────────────────────────────────

  const handlePresetSelect = (preset: QuickPreset) => {
    setActivePreset(preset);

    if (preset === 'asap') {
      onUpdate({
        scheduleType: 'asap',
        startDate: undefined,
        endDate: undefined,
        latestArrivalTime: undefined,
        durationMinutes: draft.durationMinutes, // keep duration if set
        conditionalEndNote: undefined,
      });
      return;
    }

    if (preset === 'flexible') {
      onUpdate({
        scheduleType: 'flexible',
        startDate: undefined,
        endDate: undefined,
        latestArrivalTime: undefined,
        conditionalEndNote: undefined,
      });
      return;
    }

    if (preset === 'today' || preset === 'tomorrow' || preset === 'this_week') {
      const { startDate, endDate } = schedulePresetToDates(preset);
      onUpdate({ scheduleType: 'scheduled', startDate, endDate, conditionalEndNote: undefined });
      return;
    }

    if (preset === 'custom') {
      onUpdate({ scheduleType: 'scheduled' });
      return;
    }
  };

  // ── Date picker helpers ─────────────────────────────────────────────────────

  const openPicker = (target: DatePickerTarget, mode: 'date' | 'time' = 'date') => {
    setPickerTarget(target);
    setPickerMode(mode);
    setPickerVisible(true);
  };

  const currentPickerDate = (): Date => {
    const val = draft[pickerTarget];
    return val ? new Date(val) : new Date();
  };

  const handlePickerChange = (_: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setPickerVisible(false);
    }
    if (!selectedDate) return;

    if (pickerMode === 'date' && Platform.OS === 'android') {
      // Android: after date selection, immediately open time picker
      onUpdate({ [pickerTarget]: selectedDate.toISOString() });
      setTimeout(() => {
        setPickerMode('time');
        setPickerVisible(true);
      }, 100);
      return;
    }

    onUpdate({ [pickerTarget]: selectedDate.toISOString() });
  };

  const handleIOSPickerDone = () => {
    setPickerVisible(false);
  };

  // ── Duration selection ──────────────────────────────────────────────────────

  const handleDurationSelect = (minutes: number) => {
    if (draft.durationMinutes === minutes) {
      onUpdate({ durationMinutes: undefined }); // toggle off
    } else {
      onUpdate({ durationMinutes: minutes });
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  const isValid = !!draft.scheduleType;

  // ── Helpers to format date/time for display ─────────────────────────────────

  const formatDateDisplay = (iso?: string): string => {
    if (!iso) return 'Pick date & time';
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${months[d.getMonth()]} ${d.getDate()} · ${h}:${m} ${ampm}`;
  };

  const showCustomDates = activePreset === 'custom' && draft.scheduleType === 'scheduled';
  const showConditionalEnd =
    (activePreset === 'today' || activePreset === 'tomorrow' || activePreset === 'this_week' || activePreset === 'custom') &&
    draft.scheduleType === 'scheduled';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        {/* Section: When */}
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 12 }}>
          When do you need this done?
        </Text>

        {/* Quick presets */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {QUICK_PRESETS.map(({ key, label, icon }) => {
            const active = activePreset === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => handlePresetSelect(key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 24,
                  borderWidth: 1.5,
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active
                    ? (theme.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.1)')
                    : theme.surfaceSecondary,
                }}
                accessibilityRole="button"
                accessibilityLabel={`Schedule: ${label}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={{ fontSize: 14 }}>{icon}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: active ? theme.primary : theme.text }}>
                  {label}
                </Text>
                {active && (
                  <MaterialIcons name="check" size={14} color={theme.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom date/time pickers */}
        {showCustomDates && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSecondary, marginBottom: 10 }}>
              Set date &amp; time
            </Text>

            {/* Start date */}
            <TouchableOpacity
              onPress={() => openPicker('startDate', 'date')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surfaceSecondary,
                borderRadius: 10,
                padding: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: draft.startDate ? theme.primary : theme.border,
              }}
              accessibilityRole="button"
              accessibilityLabel="Set start date and time"
            >
              <MaterialIcons name="schedule" size={20} color={draft.startDate ? theme.primary : theme.textSecondary} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 2 }}>Start (optional)</Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: draft.startDate ? theme.text : theme.textDisabled }}>
                  {formatDateDisplay(draft.startDate)}
                </Text>
              </View>
              {draft.startDate && (
                <TouchableOpacity
                  onPress={() => onUpdate({ startDate: undefined })}
                  accessibilityLabel="Clear start date"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {/* End / deadline date */}
            <TouchableOpacity
              onPress={() => openPicker('endDate', 'date')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surfaceSecondary,
                borderRadius: 10,
                padding: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: draft.endDate ? theme.primary : theme.border,
              }}
              accessibilityRole="button"
              accessibilityLabel="Set end date and time"
            >
              <MaterialIcons name="event" size={20} color={draft.endDate ? theme.primary : theme.textSecondary} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 2 }}>Deadline (optional)</Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: draft.endDate ? theme.text : theme.textDisabled }}>
                  {formatDateDisplay(draft.endDate)}
                </Text>
              </View>
              {draft.endDate && (
                <TouchableOpacity
                  onPress={() => onUpdate({ endDate: undefined })}
                  accessibilityLabel="Clear end date"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {/* Latest arrival time */}
            <TouchableOpacity
              onPress={() => openPicker('latestArrivalTime', 'date')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surfaceSecondary,
                borderRadius: 10,
                padding: 14,
                borderWidth: 1,
                borderColor: draft.latestArrivalTime ? theme.primary : theme.border,
              }}
              accessibilityRole="button"
              accessibilityLabel="Set latest arrival time"
            >
              <MaterialIcons name="person-pin-circle" size={20} color={draft.latestArrivalTime ? theme.primary : theme.textSecondary} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 2 }}>
                  Latest arrival (optional)
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: draft.latestArrivalTime ? theme.text : theme.textDisabled }}>
                  {formatDateDisplay(draft.latestArrivalTime)}
                </Text>
              </View>
              {draft.latestArrivalTime && (
                <TouchableOpacity
                  onPress={() => onUpdate({ latestArrivalTime: undefined })}
                  accessibilityLabel="Clear latest arrival time"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Conditional end note */}
        {showConditionalEnd && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSecondary, marginBottom: 8 }}>
              Conditional end (optional)
            </Text>
            <TextInput
              value={draft.conditionalEndNote || ''}
              onChangeText={(v) => onUpdate({ conditionalEndNote: v || undefined })}
              placeholder='e.g., "until the first Associate arrives"'
              placeholderTextColor={theme.textDisabled}
              style={{
                backgroundColor: theme.surfaceSecondary,
                color: theme.text,
                borderRadius: 10,
                padding: 14,
                fontSize: 15,
                borderWidth: 1,
                borderColor: draft.conditionalEndNote ? theme.primary : theme.border,
              }}
              accessibilityLabel="Conditional end condition"
            />
            <Text style={{ fontSize: 12, color: theme.textDisabled, marginTop: 6 }}>
              Describe the real-world event that ends the job early. The deadline above acts as a safety net.
            </Text>
          </View>
        )}

        {/* Section: Duration */}
        {activePreset !== 'asap' && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 12 }}>
              How long will this take? (optional)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DURATION_PRESETS.map(({ minutes, label }) => {
                const active = draft.durationMinutes === minutes;
                return (
                  <TouchableOpacity
                    key={minutes}
                    onPress={() => handleDurationSelect(minutes)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 20,
                      borderWidth: 1.5,
                      borderColor: active ? theme.primary : theme.border,
                      backgroundColor: active
                        ? (theme.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.1)')
                        : theme.surfaceSecondary,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Duration: ${label}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? theme.primary : theme.text }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Flexibility hint */}
        {activePreset === 'asap' && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              backgroundColor: theme.isDark ? 'rgba(220,38,38,0.1)' : 'rgba(220,38,38,0.06)',
              borderRadius: 10,
              padding: 12,
              borderWidth: 1,
              borderColor: theme.isDark ? 'rgba(220,38,38,0.3)' : 'rgba(220,38,38,0.2)',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <MaterialIcons name="bolt" size={18} color="#dc2626" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>
              <Text style={{ fontWeight: '700', color: '#dc2626' }}>ASAP</Text>
              {' '}lets hunters know you need help immediately — this will be surfaced at the top of the feed with an urgency badge.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: 16,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          backgroundColor: theme.background,
          marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8),
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={onBack}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.surfaceSecondary,
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            <Text style={{ fontWeight: '600', marginLeft: 8, color: theme.text }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onNext}
            disabled={!isValid}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isValid ? theme.primary : theme.surface,
            }}
            accessibilityRole="button"
            accessibilityLabel="Continue to next step"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text style={{ fontWeight: '600', marginRight: 8, color: isValid ? '#fff' : theme.textDisabled }}>
              Next
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color={isValid ? '#fff' : theme.textDisabled} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Date/Time picker — iOS modal, Android dialog */}
      {Platform.OS === 'ios' ? (
        <Modal
          visible={pickerVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerVisible(false)}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>
                  {pickerTarget === 'startDate' ? 'Start Date & Time'
                    : pickerTarget === 'endDate' ? 'Deadline'
                    : 'Latest Arrival'}
                </Text>
                <TouchableOpacity onPress={handleIOSPickerDone} accessibilityRole="button" accessibilityLabel="Done">
                  <Text style={{ fontSize: 16, fontWeight: '600', color: theme.primary }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={currentPickerDate()}
                mode="datetime"
                display="spinner"
                onChange={handlePickerChange}
                minimumDate={new Date()}
                textColor={theme.text}
                themeVariant={theme.isDark ? 'dark' : 'light'}
              />
            </View>
          </View>
        </Modal>
      ) : (
        pickerVisible && (
          <DateTimePicker
            value={currentPickerDate()}
            mode={pickerMode}
            display="default"
            onChange={handlePickerChange}
            minimumDate={new Date()}
          />
        )
      )}
    </View>
  );
}

export default StepSchedule;
