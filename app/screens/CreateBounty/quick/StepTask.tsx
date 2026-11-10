import { MaterialIcons } from '@expo/vector-icons';
import { BountyRequirementsEditor } from '../../../../components/bounty-requirements-editor';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useIsScreenFocused } from '../../../../hooks/useRouteFocus';
import { DEFAULT_OVERLAY_KEY, useTopInsetOverlay } from '../../../../lib/context/TopInsetOverlayContext';
import { pageTranslateX, useTabPager } from '../../../../components/ui/tab-pager';
import { usePaymentPromiseCopy } from '../../../../lib/experiments/payment-promise-copy';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { paymentPromiseStrings } from '../../../../lib/strings/payment-promise';
import {
  validateContactInfo,
  validateDescription,
  validateTitle,
} from '../../../../lib/utils/bounty-validation';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { InfoTooltip } from '../../../../components/ui/tooltip';
import { trackTrustContentViewed } from '../../../../lib/analytics/trust-content';
import { composerScreenForStep, type ComposerTelemetry, type MissingField } from '../composerTelemetry';
import { BlockedTapCapture } from './BlockedTapCapture';
import { StepProgressRow, useStepEntrance } from './QuickStepLayout';
import { SuggestionPlaceholder } from './SuggestionPlaceholder';
import { withAlpha } from '../../../../lib/utils';
import { findTaskTemplateByTitle, TASK_TEMPLATES, type TaskTemplate } from './taskTemplates';
import {
  MAX_TITLE_LENGTH as MAX_LENGTH,
  MIN_DETAIL_LENGTH,
  stepTaskBlockedNotice,
  stepTaskHint,
} from './stepTaskCopy';

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

// Placeholder for a title the poster typed themselves.
const CUSTOM_DETAIL_EXAMPLE = 'Two boxes from my car up to the 3rd floor, Sunday after 2pm';

type Field = 'title' | 'description';

// Room kept between a focused field and the edges of what's visible.
const FIELD_MARGIN = 12;

// A blur followed by a focus (moving title → details) shouldn't unpin and
// re-pin the footer for a frame in between.
const BLUR_SETTLE_MS = 120;

interface Box {
  y: number;
  height: number;
}

interface StepTaskProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  /** Fired on every focus of an input (or a template tap) with the field it
   * was. The first one is the composer's first real interaction. Optional so
   * tests/older call sites don't need to pass it. */
  onFieldFocus?: (field: 'title' | 'description' | 'template') => void;
  /** Leaves the composer. Omit to hide the close control. */
  onClose?: () => void;
  /** Paints the status-bar strip above the flow green so the hero reads as
   * running to the top of the screen. Off when something (the email banner)
   * sits between the strip and the hero. */
  tintStatusBar?: boolean;
  /** The host's top gap, which the later steps sit below. The hero pads its
   * progress row by it so the row lands where theirs does. */
  topInset?: number;
  /** Drop-off events. Omitted while the flow is preloaded off-screen. */
  telemetry?: ComposerTelemetry;
  step: number;
  totalSteps: number;
}

/**
 * Step 1 — a green hero with the question, a raised card holding the title
 * field, a required "What exactly, and when?" field (saved as the bounty's
 * description) and the Next button, and a list of concrete task templates
 * below. Tapping a template prefills title, category and a suggested price,
 * then stays here and focuses the details field: a template alone used to be
 * a four-tap path to a title-only listing (SBA-03). Next stays disabled until
 * the details have at least 20 characters, for templates and typed titles
 * alike.
 *
 * Unlike the later steps this doesn't use QuickStepLayout: at rest the CTA
 * lives in the card next to the fields. While a field is focused it moves to
 * a bar pinned to the bottom of the step, which the flow root keeps just
 * above the keyboard, and the focused field is kept scrolled into view. In
 * the card it sat below the fold as soon as the keyboard opened, and posters
 * on small Android screens typed for minutes without ever seeing it.
 *
 * A tap on the disabled Next moves focus to the first field still missing
 * and says, in words, what it needs.
 */
export function StepTask({ draft, onUpdate, onNext, onFieldFocus, onClose, tintStatusBar = true, topInset = 0, telemetry, step, totalSteps }: StepTaskProps) {
  const { theme } = useAppThemeContext();
  const showPaymentPromise = usePaymentPromiseCopy();
  // Scales off the viewport width so the headline stays proportionate from
  // small phones up to tablets. 375 is the reference width.
  const { width } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.85), 1.3);
  const styles = useMemo(() => makeStyles(theme, scale), [theme, scale]);
  const entrance = useStepEntrance();
  const [touched, setTouched] = useState(false);
  const [detailTouched, setDetailTouched] = useState(false);
  const titleInputRef = useRef<TextInput>(null);
  const detailInputRef = useRef<TextInput>(null);
  // Which field has focus. Drives the pinned footer.
  const [focusedField, setFocusedField] = useState<Field | null>(null);
  const focusedFieldRef = useRef<Field | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by a tap on the disabled Next; cleared once Next is enabled.
  const [blockedTapped, setBlockedTapped] = useState(false);

  // RootFrame (app/_layout.tsx) reserves the status-bar strip above all app
  // content in the screen colour. Hand it the hero's green, translated with
  // the scroll like the grid feed's banner, so there's no tan seam at the top.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [heroHeight, setHeroHeight] = useState(0);
  const setTopInsetOverlay = useTopInsetOverlay()?.setOverlay;
  // In the tab shell's pager (the Post tab) the green slides with this page,
  // so it never lingers over a neighbouring tab mid-swipe.
  const tabPager = useTabPager();
  const overlayTranslateX = useMemo(() => pageTranslateX(tabPager, 'postings'), [tabPager]);
  const overlayKey = overlayTranslateX ? 'postings' : DEFAULT_OVERLAY_KEY;
  // The strip is painted above every route, so it comes down while another
  // screen is open over the tab shell (which stays mounted underneath) —
  // otherwise that screen inherits the composer's green strip.
  const isScreenFocused = useIsScreenFocused();
  useEffect(() => {
    if (!tintStatusBar || !isScreenFocused || !setTopInsetOverlay) return;
    setTopInsetOverlay({
      colors: [theme.primary, theme.primary],
      height: heroHeight,
      scrollY,
      translateX: overlayTranslateX,
      barColor: theme.primary,
    }, overlayKey);
    return () => setTopInsetOverlay(null, overlayKey);
  }, [tintStatusBar, isScreenFocused, setTopInsetOverlay, theme.primary, heroHeight, scrollY, overlayTranslateX, overlayKey]);

  const error = validateTitle(draft.title);
  const length = (draft.title || '').length;
  const isEmpty = length === 0;
  const detail = draft.description || '';
  const detailLength = detail.trim().length;
  const detailError = validateDescription(detail);
  // Checked here rather than only at publish, where it surfaces as a generic
  // failure after the poster has already picked a location and price.
  const contactError = validateContactInfo(draft.title, detail);
  const canContinue = !error && !detailError && !contactError;
  // Follows the title: a template's own example, else a generic one. Derived
  // from the title rather than remembered, so it survives drafts and Back.
  const detailExample = findTaskTemplateByTitle(draft.title)?.detailExample ?? CUSTOM_DETAIL_EXAMPLE;
  // The first thing still stopping Next, in the order the fields appear.
  const missingField: MissingField | null = error
    ? 'title'
    : detailError
      ? 'description'
      : contactError
        ? 'contact'
        : null;

  const handleChange = (value: string) => {
    telemetry?.titleFirstTyped(step, draft);
    onUpdate({ title: value });
  };

  const handleDetailChange = (value: string) => {
    telemetry?.detailFirstTyped(step, draft);
    onUpdate({ description: value });
  };

  const handleNextPress = () => {
    telemetry?.nextTapped({ step, draft, blocked: false, missingField: null });
    onNext();
  };

  // ---- keeping the focused field in view ----
  // Positions are in the scroll content's coordinates: the card is a direct
  // child of the content, the fields' boxes are relative to the card.
  const scrollRef = useRef<ScrollView>(null);
  const geometryRef = useRef<{
    cardY: number;
    title: Box | null;
    description: Box | null;
    viewport: number;
    scrollY: number;
  }>({ cardY: 0, title: null, description: null, viewport: 0, scrollY: 0 });

  // Scrolls only as far as needed. A field taller than the space left above
  // the keyboard keeps its end (where the caret is) in view.
  const ensureFieldVisible = useCallback((field: Field) => {
    const g = geometryRef.current;
    const box = g[field];
    if (!box || g.viewport <= 0) return;
    const top = g.cardY + box.y - FIELD_MARGIN;
    const bottom = g.cardY + box.y + box.height + FIELD_MARGIN;
    let target: number | null = null;
    if (bottom - top > g.viewport) target = bottom - g.viewport;
    else if (top < g.scrollY) target = top;
    else if (bottom > g.scrollY + g.viewport) target = bottom - g.viewport;
    if (target === null) return;
    const y = Math.max(0, Math.round(target));
    if (Math.abs(y - g.scrollY) < 1) return;
    scrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  const ensureFocusedVisible = useCallback(() => {
    const field = focusedFieldRef.current;
    if (field) ensureFieldVisible(field);
  }, [ensureFieldVisible]);

  // The viewport shrinks as the keyboard opens and the footer pins, so check
  // again whenever it changes, and whenever a focused field grows a line.
  const handleScrollLayout = (e: LayoutChangeEvent) => {
    geometryRef.current.viewport = e.nativeEvent.layout.height;
    ensureFocusedVisible();
  };
  const handleCardLayout = (e: LayoutChangeEvent) => {
    geometryRef.current.cardY = e.nativeEvent.layout.y;
  };
  const fieldLayout = (field: Field) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    geometryRef.current[field] = { y, height };
    if (focusedFieldRef.current === field) ensureFieldVisible(field);
  };

  const handleFieldFocus = (field: Field) => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    focusedFieldRef.current = field;
    setFocusedField(field);
    onFieldFocus?.(field);
    setTimeout(() => ensureFieldVisible(field), 0);
  };

  const handleFieldBlur = (field: Field) => {
    if (field === 'title') setTouched(true);
    else setDetailTouched(true);
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      if (focusedFieldRef.current !== field) return;
      focusedFieldRef.current = null;
      setFocusedField(null);
    }, BLUR_SETTLE_MS);
  };

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    []
  );

  const focusField = (field: Field) => {
    (field === 'title' ? titleInputRef : detailInputRef).current?.focus();
    setTimeout(() => ensureFieldVisible(field), 0);
  };
  const focusDetail = () => focusField('description');

  // ---- the disabled Next ----
  // Contact details can be in either field; go to the one that has them.
  const contactField: Field = validateContactInfo(draft.title) ? 'title' : 'description';
  const blockedTarget: Field | null =
    missingField === 'title'
      ? 'title'
      : missingField === 'description'
        ? 'description'
        : missingField === 'contact'
          ? contactField
          : null;
  const copyInput = { title: draft.title || '', detail, missingField };
  const blockedNotice = blockedTapped && !canContinue ? stepTaskBlockedNotice(copyInput) : null;

  useEffect(() => {
    if (canContinue) setBlockedTapped(false);
  }, [canContinue]);

  const handleNextBlocked = () => {
    telemetry?.nextTapped({ step, draft, blocked: true, missingField });
    setBlockedTapped(true);
    if (blockedTarget) focusField(blockedTarget);
    const notice = stepTaskBlockedNotice(copyInput);
    if (notice) AccessibilityInfo.announceForAccessibility?.(notice);
  };

  const titleErrorShown = touched && !!error && !isEmpty;
  const contactErrorShown = !!contactError;
  // The card's "Add what and when" / "N more characters" hint, or the red line
  // under the field. The hint gives way to the character counter on long titles.
  const detailLengthShown =
    !contactError &&
    ((length <= 90 && detailLength < MIN_DETAIL_LENGTH) ||
      (detailTouched && !!detailError && detailLength > 0));

  useEffect(() => {
    if (!telemetry) return;
    const title = draft.title;
    if (titleErrorShown) telemetry.validationShown({ step, title, field: 'title', rule: 'title' });
    if (contactErrorShown) telemetry.validationShown({ step, title, field: 'contact', rule: 'contact_info' });
    if (detailLengthShown) telemetry.validationShown({ step, title, field: 'description', rule: 'min_length' });
  }, [telemetry, step, draft.title, titleErrorShown, contactErrorShown, detailLengthShown]);

  const cardHint = blockedNotice ?? stepTaskHint(copyInput);
  // While a field is focused the footer is pinned to the bottom of the step,
  // which the flow root holds just above the keyboard.
  const footerPinned = focusedField !== null;

  const composerScreen = composerScreenForStep(step);

  // Records which marketplace term a poster looked up. Rides alongside the
  // shared post_step_viewed funnel rather than adding a step to it.
  const handleHelpOpen = (term: string) => {
    analyticsService.trackEvent('post_help_opened', {
      surface: 'create_flow',
      step_index: step,
      term,
      composer_screen: composerScreen,
    });
    trackTrustContentViewed('how_it_works', composerScreen, { composer_screen: composerScreen, term });
  };

  const handleTemplate = (template: TaskTemplate) => {
    onFieldFocus?.('template');
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
      composer_screen: composerScreen,
    });
    analyticsService.trackEvent('post_chip_tapped', {
      surface: 'create_flow',
      chip_id: template.id,
      category: template.category,
      amount: template.amount,
      composer_screen: composerScreen,
    });
    // Stay on this step: the template names the job, the poster still has to
    // say what exactly and when. Any details already typed are kept. The
    // template rows sit below the card, so this also scrolls back up to the
    // field, and focusing it pins Next above the keyboard.
    focusDetail();
  };

  const footer = (
    <>
      <Text
        style={[styles.cardHint, blockedNotice ? styles.cardHintBlocked : null]}
        accessibilityLiveRegion="polite"
        testID="step-task-hint"
      >
        {cardHint}
      </Text>
      <BlockedTapCapture blocked={!canContinue} onBlockedTap={handleNextBlocked}>
        <TouchableOpacity
          onPress={handleNextPress}
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
      </BlockedTapCapture>
    </>
  );

  return (
    <Animated.View style={[styles.root, entrance]}>
      <Animated.ScrollView
        ref={scrollRef}
        testID="step-task-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        // Not on web: react-native-web's 'on-drag' blurs the focused input on
        // any scroll, including the scrollTo that brings that input into view.
        keyboardDismissMode={Platform.select({ ios: 'interactive', android: 'on-drag', default: 'none' })}
        showsVerticalScrollIndicator={false}
        onLayout={handleScrollLayout}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            geometryRef.current.scrollY = e.nativeEvent.contentOffset.y;
          },
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
            {showPaymentPromise ? (
              <Text style={styles.paymentPromise}>{paymentPromiseStrings.stepTaskLine}</Text>
            ) : null}
          </View>
        </View>

        {/* Raised card overlapping the hero's bottom edge */}
        <View style={styles.card} onLayout={handleCardLayout} testID="step-task-card">
          <View onLayout={fieldLayout('title')} testID="step-task-title-block">
            <TextInput
              ref={titleInputRef}
              value={draft.title}
              onChangeText={handleChange}
              onFocus={() => handleFieldFocus('title')}
              onBlur={() => handleFieldBlur('title')}
              onSubmitEditing={focusDetail}
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

          {/* Required detail — becomes the bounty description. */}
          <View style={styles.detailBlock} onLayout={fieldLayout('description')} testID="step-task-detail-block">
            <Text style={styles.detailLabel}>
              What exactly, and when?
            </Text>
            <TextInput
              ref={detailInputRef}
              value={detail}
              onChangeText={handleDetailChange}
              onFocus={() => handleFieldFocus('description')}
              onBlur={() => handleFieldBlur('description')}
              onSubmitEditing={canContinue ? onNext : undefined}
              placeholder={detailExample}
              placeholderTextColor={theme.textDisabled}
              multiline
              submitBehavior="blurAndSubmit"
              textAlignVertical="top"
              style={styles.detailInput}
              accessibilityLabel="What exactly, and when?"
              accessibilityHint={`Required, at least ${MIN_DETAIL_LENGTH} characters. For example: ${detailExample}`}
            />
          </View>

          {contactError ? (
            <Text style={styles.error}>{contactError}</Text>
          ) : detailTouched && detailError && detailLength > 0 ? (
            <Text style={styles.error}>{detailError}</Text>
          ) : null}

          {footerPinned ? null : <View style={styles.cardFooter}>{footer}</View>}
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
              accessibilityHint="Fills in the task, category, and price"
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

      {/* Outside the scroll body, so it stays put above the keyboard. */}
      {footerPinned ? (
        <View style={styles.pinnedFooter} testID="step-task-pinned-footer">
          {footer}
        </View>
      ) : null}
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
    paymentPromise: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      color: HERO_TEXT,
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
      fontSize: 18,
      lineHeight: 25,
    },
    // Sits exactly where the input's own text begins (the input has no padding).
    suggestion: {
      top: 0,
      left: 0,
      right: 0,
      fontSize: 18,
      lineHeight: 25,
      color: theme.textDisabled,
    },
    error: {
      marginTop: 6,
      fontSize: 13,
      color: theme.error,
    },
    detailBlock: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    detailLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.textSecondary,
      marginBottom: 6,
    },
    detailInput: {
      minHeight: 48,
      padding: 0,
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
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
    // After a tap on the disabled Next: the same line, louder.
    cardHintBlocked: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.text,
    },
    pinnedFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
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
      backgroundColor: theme.isDark ? withAlpha(theme.primary, 0.14) : withAlpha(theme.primary, 0.1),
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
