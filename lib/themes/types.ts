import type { Radius, Shadows, Spacing, Typography } from './tokens';

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

  // ── Borders ──────────────────────────────────────────────────────────────
  border: string;

  // ── Text ─────────────────────────────────────────────────────────────────
  text: string;               // primary
  textSecondary: string;      // secondary / muted
  textDisabled: string;       // disabled / placeholder

  // ── Brand ─────────────────────────────────────────────────────────────────
  primary: string;            // CTA buttons, active states
  primaryLight: string;       // accent icons, highlight text
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
};
