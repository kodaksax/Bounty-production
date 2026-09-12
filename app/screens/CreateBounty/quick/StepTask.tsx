import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { validateTitle } from '../../../../lib/utils/bounty-validation';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { InfoTooltip } from '../../../../components/ui/tooltip';
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
}

// A curated set of one-tap starting points, chosen to signal the odd-jobs range
// of the marketplace — the errands people don't expect to be able to hand off —
// rather than to cover every BOUNTY_CATEGORIES bucket. Titles are kept short
// enough to fit a single chip line; prices are rough market anchors, not quotes,
// and StepPay shows them as an editable, pre-filled amount.
const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'hold_merch_line', title: 'Hold my spot in the merch line', category: 'other', amount: 25 },
  { id: 'lecture_notes', title: 'Take lecture notes for me', category: 'writing', amount: 20 },
  { id: 'home_haircut', title: 'Cut my hair at my place', category: 'other', amount: 65 },
  { id: 'mount_tv', title: 'Mount my TV', category: 'labor', amount: 35 },
  { id: 'explain_insurance', title: 'Explain my insurance policy', category: 'other', amount: 30 },
  { id: 'hem_gown', title: 'Hem my gown', category: 'other', amount: 45 },
  { id: 'tagalog_grocery_run', title: 'Tagalog language translator', category: 'other', amount: 55 },
  { id: 'walk_dog', title: 'Walk my dog', category: 'other', amount: 20 },
  { id: 'clean_closet', title: 'Clean out my closet', category: 'labor', amount: 60 },
  { id: 'help_move_in', title: 'Help me move in', category: 'labor', amount: 90 },
  { id: 'design_artwork', title: 'Design an artwork', category: 'design', amount: 100 },
  { id: 'assemble_furniture', title: 'Assemble my furniture', category: 'labor', amount: 40 },
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
  // Everything below scales off the viewport width rather than fixed pixels, so
  // the chips stay proportionate from small phones up to tablets. 375 is the
  // reference width the base values are tuned against; clamped so the pills
  // never shrink below legibility or balloon on a large tablet.
  const { width } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.85), 1.3);
  const styles = useMemo(() => makeStyles(theme, scale), [theme, scale]);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  const error = validateTitle(draft.title);
  const length = (draft.title || '').length;
  const isEmpty = length === 0;

  const handleChange = (value: string) => {
    onUpdate({ title: value });
  };

  // Records which marketplace term a poster looked up. Rides alongside the
  // shared post_step_viewed funnel rather than adding a step to it.
  const handleHelpOpen = (term: string) => {
    analyticsService.trackEvent('post_help_opened', {
      surface: 'create_flow',
      step_index: step,
      term,
    });
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
      subtitle="Write honestly about something you want someone else to solve, or tap a task below. "
      ctaLabel="Continue"
      ctaDisabled={!!error}
      onCta={onNext}
    >
      
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

      <View style={styles.introRow}>
        <Text style={styles.introText}>New to Bounty?</Text>
        <InfoTooltip
          title="How a bounty works"
          content="A bounty is a task you post. A nearby Hunter accepts it and does the work. You set the price and details on the next steps."
          iconSize={16}
          onOpen={() => handleHelpOpen('bounty')}
        />
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>Popular tasks</Text>
        <InfoTooltip
          title="About these prices"
          content="Each price is a suggested start, not a fixed fee. It is the amount you pay the Hunter who finishes the task. You can change it on the next step."
          iconSize={15}
          onOpen={() => handleHelpOpen('price')}
        />
      </View>

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
            <Text style={styles.cardTitle} numberOfLines={1}>
              {template.title}
            </Text>
            <Text style={styles.cardAmount}>${template.amount}</Text>
          </TouchableOpacity>
        ))}
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

function makeStyles(theme: AppTheme, scale: number) {
  // Base numbers are the reference-width (375pt) values, multiplied by the
  // viewport scale — nothing here is a fixed size.
  const ms = (n: number) => Math.round(n * scale);
  return StyleSheet.create({
    introRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 10,
    },
    introText: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      marginBottom: ms(16),
    },
    // A pill that hugs its content, so its width tracks the label length the
    // way the feed's filter chips do. No fixed width or height. flexShrink 0 so
    // several fit on a line and the row wraps to the next line instead of
    // squeezing a chip narrow enough to clip its label.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexShrink: 0,
      maxWidth: '100%',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.text,
      backgroundColor: theme.surface,
      paddingVertical: ms(7),
      paddingHorizontal: ms(12),
      marginRight: ms(8),
      marginBottom: ms(8),
    },
    cardTitle: {
      flexShrink: 1,
      fontSize: ms(13),
      fontWeight: '600',
      color: theme.text,
    },
    cardAmount: {
      marginLeft: ms(6),
      fontSize: ms(12),
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
