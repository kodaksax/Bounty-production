import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { analyticsService } from 'lib/services/analytics-service';
import { findTaskTemplateByTitle } from './quick/taskTemplates';

export type ComposerScreen = 'composer_task' | 'composer_location' | 'composer_pay';

const COMPOSER_SCREENS: ComposerScreen[] = ['composer_task', 'composer_location', 'composer_pay'];

export const COMPOSER_STEP_TITLES = ['Task', 'Location', 'Compensation'];

/**
 * The `composer_screen` property: which composer step an event belongs to.
 * $screen_name can't answer that, because it names the tab underneath the
 * composer and lags a navigation.
 */
export function composerScreenForStep(step: number): ComposerScreen {
  return COMPOSER_SCREENS[Math.min(Math.max(step, 1), COMPOSER_SCREENS.length) - 1];
}

export type MissingField = 'title' | 'description' | 'contact' | 'location' | 'amount';

export type ValidationRule =
  | 'min_length'
  | 'contact_info'
  | 'title'
  | 'location_required'
  | 'address_unresolved'
  | 'min_amount';

type DraftText = Pick<BountyDraft, 'title' | 'description'>;

// 'typed' also covers a still-empty title; `missing_field: 'title'` tells the
// two apart.
function titleAttribution(title: string | undefined) {
  const template = findTaskTemplateByTitle(title);
  return {
    title_source: template ? 'template' : 'typed',
    template_id: template?.id ?? null,
  };
}

/**
 * The exact property set of every composer drop-off event, by event name.
 * __tests__/components/composer-event-contract.test.tsx holds each emitted
 * event to this list, both ways: a property added in code without being
 * listed here fails, and so does one listed here that stops being sent.
 *
 * None of these carry text the poster typed. Titles, descriptions, addresses
 * and search text are reported only as lengths, sources or field names.
 */
export const COMPOSER_EVENT_PROPERTIES = {
  // CreateBountyFlow (index.tsx)
  post_step_viewed: [
    'surface',
    'direction',
    'composer_screen',
    'step_index',
    'step_name',
    'variant',
    'deliberate_entry',
    'entry_point',
  ],
  post_step_completed: [
    'step_index',
    'composer_screen',
    'step_name',
    'seconds_on_step',
    'seconds_capped',
    'variant',
    'deliberate_entry',
  ],
  post_step_abandoned: [
    'step_index',
    'step_name',
    'seconds_on_step',
    'seconds_capped',
    'background_seconds',
    'composer_screen',
    'exit_method',
    'variant',
    'deliberate_entry',
    'composer_started',
    'entry_point',
    'last_field',
    'fields_touched',
    'incomplete_fields',
  ],
  // This module
  post_next_tapped: [
    'step_name',
    'step_index',
    'blocked',
    'missing_field',
    'detail_length',
    'title_source',
    'template_id',
    'composer_screen',
  ],
  post_title_first_typed: ['step_index', 'title_source', 'template_id', 'composer_screen'],
  post_detail_typed: ['step_index', 'title_source', 'template_id', 'composer_screen'],
  post_validation_shown: ['field', 'rule', 'composer_screen'],
  post_keyboard_shown: [
    'step_index',
    'composer_screen',
    'focused_field',
    'post_cta_visible_on_keyboard',
    'cta_overlap_px',
    'keyboard_height',
    'window_height',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ComposerEventName = keyof typeof COMPOSER_EVENT_PROPERTIES;

export interface Rect {
  y: number;
  height: number;
}

/**
 * Whether the Next button is fully on screen above the keyboard. Both inputs
 * are window coordinates: `cta` from measureInWindow, `keyboardTop` from the
 * keyboard event's endCoordinates.screenY. `overlapPx` is how far the button's
 * bottom edge sits below the keyboard's top (0 when visible), so a near miss
 * on small Android screens can be told apart from a button that never moved.
 */
export function ctaVisibilityAboveKeyboard(
  cta: Rect,
  keyboardTop: number
): { visible: boolean; overlapPx: number } {
  const bottom = cta.y + cta.height;
  const overlapPx = Math.max(0, Math.round(bottom - keyboardTop));
  const visible = cta.height > 0 && cta.y >= 0 && overlapPx === 0;
  return { visible, overlapPx };
}

export interface ComposerTelemetry {
  nextTapped(args: {
    step: number;
    draft: DraftText;
    blocked: boolean;
    missingField: MissingField | null;
  }): void;
  /** Call before the keystroke is applied, with the draft as it stood. */
  titleFirstTyped(step: number, draft: DraftText): void;
  detailFirstTyped(step: number, draft: DraftText): void;
  validationShown(args: {
    step: number;
    title: string | undefined;
    field: MissingField;
    rule: ValidationRule;
  }): void;
  /**
   * The keyboard finished opening on step 1, with the Next button measured.
   * Once per composer session: the first open is the one that decides whether
   * the poster ever sees the button while typing.
   */
  keyboardShown(args: {
    step: number;
    focusedField: 'title' | 'description' | null;
    ctaVisible: boolean;
    overlapPx: number;
    keyboardHeight: number;
    windowHeight: number;
  }): void;
}

/**
 * One per CreateBountyFlow instance. The step screens unmount on every step
 * change, so the once-per-session guards have to live above them.
 */
export function createComposerTelemetry(): ComposerTelemetry {
  let titleTyped = false;
  let detailTyped = false;
  let keyboardReported = false;
  const validationsShown = new Set<string>();

  return {
    nextTapped({ step, draft, blocked, missingField }) {
      analyticsService.trackEvent('post_next_tapped', {
        step_name: COMPOSER_STEP_TITLES[step - 1],
        step_index: step,
        blocked,
        missing_field: missingField,
        detail_length: (draft.description || '').trim().length,
        ...titleAttribution(draft.title),
        composer_screen: composerScreenForStep(step),
      });
    },
    titleFirstTyped(step, draft) {
      if (titleTyped) return;
      titleTyped = true;
      analyticsService.trackEvent('post_title_first_typed', {
        step_index: step,
        ...titleAttribution(draft.title),
        composer_screen: composerScreenForStep(step),
      });
    },
    detailFirstTyped(step, draft) {
      if (detailTyped) return;
      detailTyped = true;
      analyticsService.trackEvent('post_detail_typed', {
        step_index: step,
        ...titleAttribution(draft.title),
        composer_screen: composerScreenForStep(step),
      });
    },
    validationShown({ step, title, field, rule }) {
      if (!(title || '').trim()) return;
      const key = `${field}:${rule}`;
      if (validationsShown.has(key)) return;
      validationsShown.add(key);
      analyticsService.trackEvent('post_validation_shown', {
        field,
        rule,
        composer_screen: composerScreenForStep(step),
      });
    },
    keyboardShown({ step, focusedField, ctaVisible, overlapPx, keyboardHeight, windowHeight }) {
      if (keyboardReported) return;
      keyboardReported = true;
      analyticsService.trackEvent('post_keyboard_shown', {
        step_index: step,
        composer_screen: composerScreenForStep(step),
        focused_field: focusedField,
        post_cta_visible_on_keyboard: ctaVisible,
        cta_overlap_px: overlapPx,
        keyboard_height: Math.round(keyboardHeight),
        window_height: Math.round(windowHeight),
      });
    },
  };
}
