import type { Fonts, Radius, Shadows, Spacing, Typography } from './tokens';

export type ThemeMode = 'dark' | 'light' | 'system';

export type AppTheme = {
  // ── Customization knobs ───────────────────────────────────────────────────
  // High-level tokens for easy app-wide theming. Tweak these five values to
  // restyle the whole app: foreground (primary text/icons), background (page),
  // and three accents (accent1 = brand/CTA, accent2 = highlight, accent3 = info).
  foreground: string;         // primary text / icon color
  accent1: string;            // primary brand accent (CTA, active states)
  accent2: string;            // secondary accent (highlights, accent icons)
  accent3: string;            // tertiary accent (informational emphasis)

  // ── Backgrounds ──────────────────────────────────────────────────────────
  background: string;         // outermost page / screen root
  surface: string;            // cards, sections, modals
  surfaceSecondary: string;   // inputs, interactive secondary surfaces
  surfaceRaised: string;      // cards/panels that need depth above the screen
  borderRaised: string;       // edge for surfaceRaised

  // ── Borders ──────────────────────────────────────────────────────────────
  border: string;
  /**
   * Pressed-in card edge: per-side colours that read as a gradient from a
   * dark top edge to a light bottom edge. Spread into a style that already
   * has a borderWidth: `{ borderWidth: 1, ...theme.insetBorder }`.
   */
  insetBorder: {
    borderTopColor: string;
    borderLeftColor: string;
    borderRightColor: string;
    borderBottomColor: string;
  };
  /** Higher-contrast pressed-in edge for small controls (filter chips). */
  insetBorderStrong: {
    borderTopColor: string;
    borderLeftColor: string;
    borderRightColor: string;
    borderBottomColor: string;
  };
  /** The same pressed-in edge for surfaces filled with `primary`. */
  insetBorderPrimary: {
    borderTopColor: string;
    borderLeftColor: string;
    borderRightColor: string;
    borderBottomColor: string;
  };

  // ── Text ─────────────────────────────────────────────────────────────────
  text: string;               // primary
  textSecondary: string;      // secondary / muted
  textDisabled: string;       // disabled / placeholder

  // ── Brand ─────────────────────────────────────────────────────────────────
  primary: string;            // CTA buttons, active states
  primaryLight: string;       // accent icons, highlight text
  primaryShade: string;       // darker band under filled primary buttons (3D depth)
  errorShade: string;         // darker band under filled destructive buttons
  overlay: string;            // subtle button overlays

  // ── Semantic ──────────────────────────────────────────────────────────────
  success: string;
  error: string;
  warning: string;
  info: string;
  completed: string;          // indigo family
  cancelled: string;          // orange family
  target: string;
  // ── Meta ──────────────────────────────────────────────────────────────────
  isDark: boolean;

  // ── Layout tokens (identical across light/dark, see tokens.ts) ────────────
  spacing: Spacing;
  radius: Radius;
  typography: Typography;
  shadows: Shadows;
  fonts: Fonts;
};
