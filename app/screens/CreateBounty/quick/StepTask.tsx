import { MaterialIcons } from '@expo/vector-icons';
import { BountyRequirementsEditor } from '../../../../components/bounty-requirements-editor';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTopInsetOverlay } from '../../../../lib/context/TopInsetOverlayContext';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { validateTitle } from '../../../../lib/utils/bounty-validation';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { InfoTooltip } from '../../../../components/ui/tooltip';
import { StepProgressRow, useStepEntrance } from './QuickStepLayout';
import { SuggestionPlaceholder } from './SuggestionPlaceholder';

// Cycled in the empty field to show the kind of answer that works here. These
// are examples only — none of them is ever written into the draft.
const SUGGESTIONS = [
  'Walk my dog around the block',
  'Pick up groceries',
  'Assemble my desk',
  'Mount my TV',
  'Wait in line for me',
  'Take photos of my car',
];

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

interface TaskTemplate {
  id: string;
  title: string;
  /** One of lib/constants/bounty-categories.ts's BOUNTY_CATEGORIES ids —
   * keeps template-originated bounties filterable in the feed the same way
   * as hand-picked categories. */
  category: string;
  amount: number;
  icon: IconName;
}

// A curated set of one-tap starting points, chosen to signal the odd-jobs range
// of the marketplace — the errands people don't expect to be able to hand off —
// rather than to cover every BOUNTY_CATEGORIES bucket. Prices are rough market
// anchors, not quotes, and StepPay shows them as an editable, pre-filled amount.
const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'hold_merch_line', title: 'Hold my spot in the merch line', category: 'other', amount: 25, icon: 'confirmation-number' },
  { id: 'lecture_notes', title: 'Take lecture notes for me', category: 'writing', amount: 20, icon: 'description' },
  { id: 'home_haircut', title: 'Cut my hair at my place', category: 'other', amount: 65, icon: 'content-cut' },
  { id: 'mount_tv', title: 'Mount my TV', category: 'labor', amount: 35, icon: 'tv' },
  { id: 'explain_insurance', title: 'Explain my insurance policy', category: 'other', amount: 30, icon: 'shield' },
  { id: 'hem_gown', title: 'Hem my gown', category: 'other', amount: 45, icon: 'checkroom' },
  { id: 'tagalog_grocery_run', title: 'Tagalog language translator', category: 'other', amount: 55, icon: 'translate' },
  { id: 'walk_dog', title: 'Walk my dog', category: 'other', amount: 20, icon: 'pets' },
  { id: 'clean_closet', title: 'Clean out my closet', category: 'labor', amount: 60, icon: 'cleaning-services' },
  { id: 'help_move_in', title: 'Help me move in', category: 'labor', amount: 90, icon: 'local-shipping' },
  { id: 'design_artwork', title: 'Design an artwork', category: 'design', amount: 100, icon: 'brush' },
  { id: 'assemble_furniture', title: 'Assemble my furniture', category: 'labor', amount: 40, icon: 'handyman' },
];

interface StepTaskProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  /** Fired on this field's first focus — the composer's first real
   * interaction. Optional so tests/older call sites don't need to pass it. */
  onFieldFocus?: () => void;
  /** Leaves the composer. Omit to hide the close control. */
  onClose?: () => void;
  /** Paints the status-bar strip above the flow green so the hero reads as
   * running to the top of the screen. Off when something (the email banner)
   * sits between the strip and the hero. */
  tintStatusBar?: boolean;
  /** The host's top gap, which the later steps sit below. The hero pads its
   * progress row by it so the row lands where theirs does. */
  topInset?: number;
  step: number;
  totalSteps: number;
}

// validateTitle caps titles at 120 characters — enforce it in the input so the
// poster can't compose something the service will reject at publish time.
const MAX_LENGTH = 120;

/**
 * Step 1 — a green hero with the question, a raised card holding the title
 * field and its Next button, and a list of concrete task templates below.
 * Tapping a template prefills title, category and a suggested price and drops
 * the poster straight onto the next step.
 *
 * Unlike the later steps this doesn't use QuickStepLayout: the CTA lives in
 * the card next to the field instead of being pinned to the bottom.
 */
export function StepTask({ draft, onUpdate, onNext, onFieldFocus, onClose, tintStatusBar = true, topInset = 0, step, totalSteps }: StepTaskProps) {
  const { theme } = useAppThemeContext();
  // Scales off the viewport width so the headline stays proportionate from
  // small phones up to tablets. 375 is the reference width.
  const { width } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.85), 1.3);
  const styles = useMemo(() => makeStyles(theme, scale), [theme, scale]);
  const entrance = useStepEntrance();
  const [touched, setTouched] = useState(false);

  // RootFrame (app/_layout.tsx) reserves the status-bar strip above all app
  // content in the screen colour. Hand it the hero's green, translated with
  // the scroll like the grid feed's banner, so there's no tan seam at the top.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [heroHeight, setHeroHeight] = useState(0);
  const setTopInsetOverlay = useTopInsetOverlay()?.setOverlay;
  useEffect(() => {
    if (!tintStatusBar || !setTopInsetOverlay) return;
    setTopInsetOverlay({
      colors: [theme.primary, theme.primary],
      height: heroHeight,
      scrollY,
      barColor: theme.primary,
    });
    return () => setTopInsetOverlay(null);
  }, [tintStatusBar, setTopInsetOverlay, theme.primary, heroHeight, scrollY]);

  const error = validateTitle(draft.title);
  const length = (draft.title || '').length;
  const isEmpty = length === 0;
  const canContinue = !error;

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
      requirements: undefined,
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
    <Animated.View style={[styles.root, entrance]}>
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
      >
        {/* Green hero */}
        <View style={[styles.hero, { paddingTop: topInset }]} onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}>
          {/* Same row, size and position as steps 2 and 3, recoloured for the green. */}
          <StepProgressRow step={step} totalSteps={totalSteps} onClose={onClose} onPrimary />

          <View style={styles.heroBody}>
            <Text style={styles.title} accessibilityRole="header">
              What do you need done?
            </Text>
            <Text style={styles.subtitle}>
              Name it. Set a reward. Someone nearby gets it done.
            </Text>
          </View>
        </View>

        {/* Raised card overlapping the hero's bottom edge */}
        <View style={styles.card}>
          <View>
            <TextInput
              value={draft.title}
              onChangeText={handleChange}
              onFocus={() => onFieldFocus?.()}
              onBlur={() => setTouched(true)}
              onSubmitEditing={canContinue ? onNext : undefined}
              multiline
              submitBehavior="blurAndSubmit"
              textAlignVertical="top"
              maxLength={MAX_LENGTH}
              style={styles.input}
              accessibilityLabel="What do you need done?"
              accessibilityHint="For example, walk my dog or wait in line for me"
            />
            {/* Animated examples, shown only while the field is empty. */}
            {isEmpty ? (
              <SuggestionPlaceholder
                suggestions={SUGGESTIONS.map((s) => `e.g. ${s}`)}
                style={styles.suggestion}
              />
            ) : null}
          </View>

          {touched && error && !isEmpty ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.cardFooter}>
            <Text style={styles.cardHint}>
              {length > 90 ? `${length}/${MAX_LENGTH}` : 'Location and reward come next'}
            </Text>
            <TouchableOpacity
              onPress={onNext}
              disabled={!canContinue}
              activeOpacity={0.85}
              style={[styles.nextButton, canContinue ? styles.nextButtonEnabled : null]}
              accessibilityRole="button"
              accessibilityLabel="Next"
              accessibilityState={{ disabled: !canContinue }}
            >
              <Text style={[styles.nextLabel, canContinue ? styles.nextLabelEnabled : null]}>
                Next
              </Text>
              <MaterialIcons
                name="arrow-forward"
                size={18}
                color={canContinue ? '#ffffff' : theme.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Templates */}
        <BountyRequirementsEditor category={draft.category} value={draft.requirements}
          onChange={(category, requirements) => onUpdate({ category, requirements })} />
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Or start from a popular one</Text>
          <InfoTooltip
            title="How a bounty works"
            content="A bounty is a task you post. A nearby Hunter accepts it and does the work. Each price below is a suggested start you can change on the reward step."
            label="How it works"
            labelStyle={styles.listLink}
            onOpen={() => handleHelpOpen('bounty')}
          />
        </View>

        <View style={styles.list}>
          {TASK_TEMPLATES.map((template, index) => (
            <TouchableOpacity
              key={template.id}
              onPress={() => handleTemplate(template)}
              activeOpacity={0.7}
              style={[styles.row, index > 0 ? styles.rowDivider : null]}
              accessibilityRole="button"
              accessibilityLabel={`${template.title}, suggested $${template.amount}`}
              accessibilityHint="Fills in the task, category, and price, then continues"
            >
              <View style={styles.rowIcon}>
                <MaterialIcons name={template.icon} size={18} color={theme.primaryLight} />
              </View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {template.title}
              </Text>
              <Text style={styles.rowAmount}>${template.amount}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.ScrollView>
    </Animated.View>
  );
}

export default StepTask;

// White reads on #008E2A in both themes; the brand's dark ink doesn't (≈2.8:1).
const HERO_TEXT = '#ffffff';
const CARD_OVERLAP = 72;

function makeStyles(theme: AppTheme, scale: number) {
  const ms = (n: number) => Math.round(n * scale);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 24 },
    hero: {
      backgroundColor: theme.primary,
      paddingBottom: 20 + CARD_OVERLAP,
    },
    // Matches QuickStepLayout's scrollContent padding, so the title lands
    // where the later steps' titles do.
    heroBody: { paddingHorizontal: 20, paddingTop: 16 },
    title: {
      fontSize: ms(38),
      lineHeight: ms(40),
      fontWeight: '800',
      letterSpacing: -1.2,
      color: HERO_TEXT,
    },
    subtitle: {
      marginTop: 10,
      fontSize: 15,
      lineHeight: 21,
      color: 'rgba(255,255,255,0.88)',
    },
    card: {
      marginTop: -CARD_OVERLAP + 16,
      marginHorizontal: 16,
      backgroundColor: theme.surface,
      borderRadius: 24,
      padding: 18,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.4 : 0.1,
      shadowRadius: 24,
      elevation: 6,
    },
    input: {
      minHeight: 64,
      padding: 0,
      color: theme.text,
      fontSize: 19,
      lineHeight: 25,
    },
    // Sits exactly where the input's own text begins (the input has no padding).
    suggestion: {
      top: 0,
      left: 0,
      right: 0,
      fontSize: 19,
      lineHeight: 25,
      color: theme.textDisabled,
    },
    error: {
      marginTop: 6,
      fontSize: 13,
      color: theme.error,
    },
    cardFooter: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardHint: {
      flex: 1,
      marginRight: 12,
      fontSize: 13,
      color: theme.textSecondary,
    },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 48,
      paddingHorizontal: 22,
      borderRadius: 24,
      backgroundColor: theme.surfaceSecondary,
    },
    nextButtonEnabled: { backgroundColor: theme.primary },
    nextLabel: { fontSize: 16, fontWeight: '700', color: theme.textSecondary },
    nextLabelEnabled: { color: '#ffffff' },
    listHeader: {
      marginTop: 28,
      marginHorizontal: 20,
      marginBottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    listTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
    },
    listLink: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primaryLight,
      textDecorationLine: 'underline',
    },
    list: { marginHorizontal: 20 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      // ~10% tint of the brand green over whatever the screen colour is.
      backgroundColor: theme.isDark ? 'rgba(31,174,73,0.14)' : 'rgba(0,142,42,0.10)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    rowTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: theme.text,
    },
    rowAmount: {
      marginLeft: 12,
      fontSize: 16,
      fontWeight: '700',
      color: theme.primaryLight,
    },
  });
}
