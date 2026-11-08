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
}

/**
 * One per CreateBountyFlow instance. The step screens unmount on every step
 * change, so the once-per-session guards have to live above them.
 */
export function createComposerTelemetry(): ComposerTelemetry {
  let titleTyped = false;
  let detailTyped = false;
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
  };
}
