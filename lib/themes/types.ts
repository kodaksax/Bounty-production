import type { Fonts, Radius, Shadows, Spacing, TextStyles, Typography } from './tokens';

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
  borderSubtle: string;       // card hairlines, quieter than border
  /**
   * Card edge: one even hairline on all four sides. Spread into a style that
   * already has a borderWidth: `{ borderWidth: 1, ...theme.insetBorder }`.
   */
  insetBorder: {
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
  primary: string;            // fills, icons, active states. Not for small text.
  primaryLight: string;       // green text: meets AA on this theme's surfaces
  primaryShade: string;       // pressed primary fill
  primaryTint: string;        // quiet green background behind green text
  onPrimary: string;          // text and icons on a primary or error fill
  errorShade: string;         // pressed destructive fill
  overlay: string;            // subtle button overlays

  // ── Semantic ──────────────────────────────────────────────────────────────
  // `success`, `error`, `warning` and `info` are for fills and icons. Use the
  // matching *Text token for words and the *Tint token behind them.
  success: string;
  successText: string;
  successTint: string;
  error: string;
  errorText: string;
  errorTint: string;
  warning: string;
  warningText: string;
  warningTint: string;
  info: string;
  infoText: string;
  infoTint: string;
  neutralTint: string;        // quiet background for neutral pills
  completed: string;          // indigo family
  cancelled: string;          // orange family
  target: string;
  // ── Meta ──────────────────────────────────────────────────────────────────
  isDark: boolean;

  // ── Layout tokens (identical across light/dark, see tokens.ts) ────────────
  spacing: Spacing;
  radius: Radius;
  typography: Typography;
  textStyles: TextStyles;
  shadows: Shadows;
  fonts: Fonts;
};
