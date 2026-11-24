/**
 * Focus-first colour roles and layout tokens.
 *
 * The design handoff (docs/design/focus-first-poster/) names its colours by
 * role: page, card, ink, secondary ink, line, chip, green, green text, the
 * soft tint behind each tone, and so on. Those roles are kept here so every
 * Focus-first component — My Jobs, the poster and hunter workspaces, the job
 * thread — asks for the same role and never decides for itself which app
 * token stands in for it.
 *
 * Every role maps onto a colour the app already has. Per the product owner's
 * direction the handoff's own hex values (PosterPhone.dc.html) are NOT
 * introduced: the Focus screens keep the app's current light and dark colours,
 * and only the layout, type sizes and copy follow the handoff. Changing a role
 * here therefore changes it everywhere at once, and adds no new colour.
 */
import { SIZING, TYPOGRAPHY } from '../constants/accessibility';
import type { AppTheme } from './types';

export interface PosterPalette {
  /** Page background. */
  bg: string;
  /** Cards and sheets. */
  card: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Hairlines between rows. */
  line: string;
  /** Outline of secondary and neutral buttons. */
  outline: string;
  /** Neutral chip fill. */
  chip: string;
  /** Brand green fill (primary buttons). */
  g: string;
  /** Green text and icons. */
  gt: string;
  /** "Your turn" pill fill and its text. */
  gpill: string;
  gpillfg: string;
  /** Quiet green background behind green text. */
  gtint: string;
  /** Warning: fill, text, tint. */
  w: string;
  wt: string;
  wtint: string;
  /** Error: fill, text, tint. */
  e: string;
  et: string;
  etint: string;
  /** Info: text, tint. */
  it: string;
  itint: string;
  /** Tile behind a job photo or category icon. */
  photo: string;
  /** Icon colour on that tile. */
  photoInk: string;
  /** Text and icons on a green or red fill. */
  onFill: string;
  /** The five-step bar: done, current and not-yet segments. */
  stepDone: string;
  stepNow: string;
  stepTodo: string;
}

/** The app colours a theme provides, before its Focus-first roles are added. */
export type PosterPaletteSource = Omit<AppTheme, 'poster'>;

/** Maps each Focus-first role onto the theme's existing colour. */
export function derivePosterPalette(t: PosterPaletteSource): PosterPalette {
  return {
    bg: t.background,
    card: t.surface,
    ink: t.text,
    ink2: t.textSecondary,
    line: t.borderSubtle,
    outline: t.border,
    chip: t.neutralTint,
    g: t.primary,
    gt: t.primaryLight,
    // primaryShade keeps white pill text above 4.5:1 in both modes.
    gpill: t.primaryShade,
    gpillfg: t.onPrimary,
    gtint: t.primaryTint,
    w: t.warning,
    wt: t.warningText,
    wtint: t.warningTint,
    e: t.error,
    et: t.errorText,
    etint: t.errorTint,
    it: t.infoText,
    itint: t.infoTint,
    // Same fill and icon colour as the My Jobs thumbnails (components/my-jobs/job-bits).
    photo: t.surfaceSecondary,
    photoInk: t.text,
    onFill: t.onPrimary,
    stepDone: t.primaryLight,
    stepNow: t.primary,
    stepTodo: t.border,
  };
}

/**
 * Sizes from PosterBlock.dc.html, in points. Where a value matches an
 * existing constant it is taken from it, so the two can't drift.
 */
export const FOCUS = {
  /** Pinned primary action, quiet and danger buttons (SIZING.BUTTON_HEIGHT_LARGE). */
  buttonPrimary: SIZING.BUTTON_HEIGHT_LARGE,
  /** Secondary and neutral buttons. */
  buttonSecondary: 52,
  /** Text and muted buttons (SIZING.COMFORTABLE_TOUCH_TARGET). */
  buttonText: SIZING.COMFORTABLE_TOUCH_TARGET,
  minTouch: SIZING.MIN_TOUCH_TARGET,
  buttonRadius: 14,

  /** "My Jobs" (fhead). */
  screenTitle: 38,
  /** WHAT'S HAPPENING headline (qa). */
  qaHeadline: 30,
  /** Section labels: WHAT'S HAPPENING, WHO OFFERED… */
  label: TYPOGRAPHY.SIZE_SMALL,
  labelTracking: 0.7,
  body: 17,
  bodySmall: TYPOGRAPHY.SIZE_DEFAULT,
  money: TYPOGRAPHY.SIZE_BODY,
  /** Workspace header job title (whead). */
  jobTitle: TYPOGRAPHY.SIZE_HEADER,
  meta: TYPOGRAPHY.SIZE_DEFAULT,
  stage: TYPOGRAPHY.SIZE_SMALL,
  /** Titles inside a flow (title block): "Choose Ada for $60?". */
  flowTitle: 26,
  flowTitleXL: 28,
  sheetTitle: TYPOGRAPHY.SIZE_XLARGE,

  /** Featured job card (feature). */
  featureRadius: 30,
  featureHero: 196,
  featureTitle: 25,
  featureStatus: 21,
  featureAction: 60,

  /** Five-step bar. */
  stepHeight: 6,
  stepGap: 5,
  jobIcon: 54,

  /** Switcher row (selrow) and the switch strip. */
  selrowMin: 76,
  switchMin: 68,
} as const;
