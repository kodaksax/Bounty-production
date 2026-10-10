// Raw palette — import from darkTheme/lightTheme for themed tokens.
// Nothing in this file should be used directly in screens.
//
// Source: "Bounty Color Refresh" design — #008E2A leads every scheme.
// Light mode uses the 01 Complementary harmony (green lead + berry contrast
// on warm cream); dark mode uses the proposed warm graphite ramp.

export const palette = {
  // ── Brand green (#008E2A lead) ───────────────────────────────────────────
  green: {
    950: '#002E0E',
    900: '#00410F',
    800: '#00571A',   // support — featured cards, deep fills
    700: '#00701F',   // lead-deep — links, active tab, text on tint (light)
    600: '#008E2A',   // LEAD — CTAs, primary buttons, active states
    500: '#1FAE49',   // lead on dark — highlight text / success (dark)
    400: '#4CC46F',
    300: '#1FAE49',   // accent-on-dark (kept equal to 500 for one bright green)
    200: '#B5E3C2',
    100: '#DBF0E1',   // lead-tint — reward pills, completed pills
    50:  '#EDF8F0',
  },

  // ── Warm graphite → cream neutral ramp (both modes) ──────────────────────
  // Key name kept as `navy` so existing imports keep working.
  navy: {
    950: '#1B1E24',   // dark background
    900: '#22262C',   // dark surface
    800: '#2A2E35',   // dark surfaceSecondary
    700: '#454952',   // dark border
    600: '#61656B',   // light textSecondary / dark textDisabled
    500: '#929497',   // light textDisabled / dark textSecondary
    400: '#929497',
    300: '#D8D2C4',   // light border
    200: '#E6DED1',   // light background
    100: '#F4F1EC',   // light surfaceSecondary
    50:  '#F4F1EC',
  },

  // ── Berry (complementary contrast, light mode) ───────────────────────────
  berry: {
    700: '#7E1B60',
    600: '#871D67',
    500: '#B81E8A',   // contrast — urgent, alert dot, Claim
    100: '#F8E2F1',
  },

  ink:     '#31363F', // light-mode text
  cream:   '#E6DED1', // dark-mode text

  // ── Semantic (retuned to sit with the muted palette) ─────────────────────
  white:   '#FFFFFF',
  black:   '#000000',
  error:   '#C24A42',
  warning: '#C98A3A',
  success: '#008E2A',
  info:    '#3E6E92',
  completed: '#5F5AA6',
  cancelled: '#B06A38',
} as const;
