export type ThemeMode = 'dark' | 'light' | 'system';

export type AppTheme = {
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
};
