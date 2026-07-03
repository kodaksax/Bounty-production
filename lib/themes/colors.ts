// Raw palette — import from darkTheme/lightTheme for themed tokens.
// Nothing in this file should be used directly in screens.

export const palette = {
  // ── Brand green ──────────────────────────────────────────────────────────
  green: {
    950: '#022c22',
    900: '#064e3b',
    800: '#065f46',
    700: '#047857',
    600: '#059669',
    500: '#10b981',
    400: '#34d399',
    300: '#6ee7b7',
    200: '#a7f3d0',
    100: '#d1fae5',
    50:  '#ecfdf5',
  },

  // ── Navy (dark mode surfaces) ─────────────────────────────────────────────
  navy: {
    950: '#0B0F14',
    900: '#111827',
    800: '#1F2937',
    700: '#374151',
    600: '#4B5563',
    500: '#6B7280',
    400: '#9CA3AF',
    300: '#D1D5DB',
    200: '#E5E7EB',
    100: '#F3F4F6',
    50:  '#F9FAFB',
  },

  // ── Semantic (shared both themes) ────────────────────────────────────────
  white:   '#FFFFFF',
  black:   '#000000',
  error:   '#EF4444',
  warning: '#FBBF24',
  success: '#10B981',
  info:    '#60A5FA',
  completed: '#6366F1',
  cancelled: '#F97316',
} as const;
