import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { validateTitle } from '../../../../lib/utils/bounty-validation';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';
import { SuggestionPlaceholder } from './SuggestionPlaceholder';

// Cycled in the empty field to show the kind of answer that works here. These
// are examples only — none of them is ever written into the draft.
const SUGGESTIONS = [
  'Pick up groceries',
  'Assemble my desk',
  'Mount my TV',
  'Walk my dog',
  'Wait in line for me',
  'Take photos of my car',
];

interface StepTaskProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  step: number;
  totalSteps: number;
}

// validateTitle caps titles at 120 characters — enforce it in the input so the
// poster can't compose something the service will reject at publish time.
const MAX_LENGTH = 120;

/**
 * Step 1 — the bounty title, as a single short question. Longer context is
 * optional and lives on step 2, so this field stays scannable in the feed and
 * comfortably inside validateTitle's 120-character cap.
 */
export function StepTask({ draft, onUpdate, onNext, step, totalSteps }: StepTaskProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  const error = validateTitle(draft.title);
  const length = (draft.title || '').length;
  const isEmpty = length === 0;

  const handleChange = (value: string) => {
    onUpdate({ title: value });
  };

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      title="What do you need done?"
      ctaLabel="Continue"
      ctaDisabled={!!error}
      onCta={onNext}
    >
      <View>
        <TextInput
          value={draft.title}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setTouched(true);
          }}
          multiline
          textAlignVertical="top"
          maxLength={MAX_LENGTH}
          style={[
            styles.input,
            { borderColor: focused ? theme.primary : theme.border },
          ]}
          accessibilityLabel="What do you need done?"
          accessibilityHint="For example, pick up groceries or wait in line for me"
        />

        {/* Animated examples, shown only while the field is untouched. */}
        {isEmpty ? (
          <SuggestionPlaceholder suggestions={SUGGESTIONS} style={styles.suggestion} />
        ) : null}
      </View>

      <View style={styles.helperRow}>
        <Text style={styles.helper}>Keep it short and clear. You can add photos next.</Text>
        {length > 90 ? (
          <Text style={styles.counter}>
            {length}/{MAX_LENGTH}
          </Text>
        ) : null}
      </View>

      {touched && error ? <Text style={styles.error}>{error}</Text> : null}
    </QuickStepLayout>
  );
}

export default StepTask;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    input: {
      minHeight: 110,
      borderRadius: 24,
      borderWidth: 2,
      backgroundColor: theme.surface,
      color: theme.text,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 20,
      fontSize: 20,
      lineHeight: 26,
    },
    // Positioned to sit exactly where the input's own text begins:
    // 2px border + 20px padding on each side.
    suggestion: {
      top: 22,
      left: 22,
      right: 22,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    helperRow: {
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    helper: {
      flex: 1,
      fontSize: 15,
      color: theme.textSecondary,
    },
    counter: {
      marginLeft: 12,
      fontSize: 14,
      color: theme.textSecondary,
    },
    error: {
      marginTop: 8,
      fontSize: 14,
      color: theme.error,
    },
  });
}
