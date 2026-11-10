// Raw palette — import from darkTheme/lightTheme for themed tokens.
// Nothing in this file should be used directly in screens.
//
// Brand: #008E2A leads every scheme, on the warm creams #D7CBBD and #F1EBE3.
// Light mode puts #F1EBE3 on the page with white cards and #D7CBBD on lines
// and warm fills. Dark mode uses the warm graphite ramp with #F1EBE3 text.

export const palette = {
  // ── Brand green (#008E2A lead) ───────────────────────────────────────────
  green: {
    950: '#002E0E',
    900: '#00410F',
    800: '#00571A',   // support — featured cards, deep fills
    700: '#00701F',   // lead-deep — green text on light surfaces
    600: '#008E2A',   // LEAD — CTAs, primary buttons, active states
    500: '#1FAE49',   // green text on dark surfaces
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
    600: '#5A5E65',   // light textSecondary (AA on #F1EBE3 and #E9E1D6)
    500: '#929497',   // light textDisabled
    400: '#A3A29C',   // dark textSecondary (AA on every dark surface)
    300: '#D7CBBD',   // brand cream — light border and warm fills
    200: '#F1EBE3',   // brand light cream — light background
    100: '#E9E1D6',   // light surfaceSecondary, visible on white and on the page
    50:  '#FBF8F3',   // light surfaceRaised — tab bar, search bar
  },

  // ── Berry (complementary contrast, light mode) ───────────────────────────
  berry: {
    700: '#7E1B60',
    600: '#871D67',
    500: '#B81E8A',   // contrast — urgent, alert dot, Claim
    100: '#F8E2F1',
  },

  ink:     '#31363F', // light-mode text
  cream:   '#F1EBE3', // dark-mode text
  brandCream: '#D7CBBD', // the crosshair on dark surfaces

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
