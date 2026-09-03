import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { analyticsService } from '../../../../lib/services/analytics-service';
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

interface TaskTemplate {
  id: string;
  title: string;
  /** One of lib/constants/bounty-categories.ts's BOUNTY_CATEGORIES ids —
   * keeps template-originated bounties filterable in the feed the same way
   * as hand-picked categories. */
  category: string;
  amount: number;
  icon: keyof typeof MaterialIcons.glyphMap;
}

// One-tap starting points covering every category in BOUNTY_CATEGORIES, so no
// matter which template a poster taps their bounty is still filterable in the
// feed. Prices are rough market anchors, not quotes — StepPay shows them as an
// editable, pre-filled amount rather than a locked price.
const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'assemble_furniture', title: 'Assemble furniture', category: 'labor', amount: 40, icon: 'build' },
  { id: 'move_couch', title: 'Move a couch', category: 'labor', amount: 60, icon: 'weekend' },
  { id: 'pick_up_package', title: 'Pick up a package', category: 'delivery', amount: 15, icon: 'local-shipping' },
  { id: 'mount_tv', title: 'Mount a TV', category: 'labor', amount: 35, icon: 'tv' },
  { id: 'walk_dog', title: 'Walk my dog', category: 'other', amount: 20, icon: 'pets' },
  { id: 'design_flyer', title: 'Design a flyer', category: 'design', amount: 75, icon: 'palette' },
  { id: 'write_description', title: 'Write a product description', category: 'writing', amount: 30, icon: 'edit' },
  { id: 'fix_computer', title: 'Fix my computer', category: 'tech', amount: 45, icon: 'computer' },
];

interface StepTaskProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  /** Fired on this field's first focus — the composer's first real
   * interaction. Optional so tests/older call sites don't need to pass it. */
  onFieldFocus?: () => void;
  step: number;
  totalSteps: number;
}

// validateTitle caps titles at 120 characters — enforce it in the input so the
// poster can't compose something the service will reject at publish time.
const MAX_LENGTH = 120;

/**
 * Step 1 — a one-tap grid of concrete task templates, each prefilling title,
 * category and a suggested price so a single tap drops the poster straight
 * onto StepPay with everything already filled in (a de facto pre-populated
 * review) instead of an empty field. A "write your own" text entry stays
 * underneath for anything the templates don't cover.
 */
export function StepTask({ draft, onUpdate, onNext, onFieldFocus, step, totalSteps }: StepTaskProps) {
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

  const handleTemplate = (template: TaskTemplate) => {
    onFieldFocus?.();
    onUpdate({
      title: template.title,
      category: template.category,
      amount: template.amount,
      isForHonor: false,
    });
    analyticsService.trackEvent('category_selected', {
      surface: 'create_flow',
      category: template.category,
      method: 'template',
      template_id: template.id,
    });
    analyticsService.trackEvent('post_chip_tapped', {
      surface: 'create_flow',
      chip_id: template.id,
      category: template.category,
      amount: template.amount,
    });
    onNext();
  };

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      title="What do you need done?"
      subtitle="Tap a task to get started, or describe your own below."
      ctaLabel="Continue"
      ctaDisabled={!!error}
      onCta={onNext}
    >
      <View style={styles.grid}>
        {TASK_TEMPLATES.map((template) => (
          <TouchableOpacity
            key={template.id}
            onPress={() => handleTemplate(template)}
            activeOpacity={0.85}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`${template.title}, suggested $${template.amount}`}
            accessibilityHint="Fills in the task, category, and price, then continues to the price step"
          >
            <View style={styles.cardIconWrap}>
              <MaterialIcons name={template.icon} size={20} color={theme.primary} />
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {template.title}
            </Text>
            <Text style={styles.cardAmount}>${template.amount}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or describe it yourself</Text>
        <View style={styles.dividerLine} />
      </View>

      <View>
        <TextInput
          value={draft.title}
          onChangeText={handleChange}
          onFocus={() => {
            setFocused(true);
            onFieldFocus?.();
          }}
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
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    card: {
      width: '48%',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 10,
    },
    cardIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.2)' : 'rgba(5,150,105,0.1)',
      marginBottom: 8,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
      lineHeight: 18,
    },
    cardAmount: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: '700',
      color: theme.primary,
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    dividerText: {
      marginHorizontal: 10,
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    input: {
      minHeight: 90,
      borderRadius: 24,
      borderWidth: 2,
      backgroundColor: theme.surface,
      color: theme.text,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 16,
      fontSize: 17,
      lineHeight: 22,
    },
    // Positioned to sit exactly where the input's own text begins:
    // 2px border + 16px top padding, 20px left/right padding.
    suggestion: {
      top: 18,
      left: 22,
      right: 22,
      fontSize: 17,
      lineHeight: 22,
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
