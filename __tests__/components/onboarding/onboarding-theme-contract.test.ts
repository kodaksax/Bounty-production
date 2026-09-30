/**
 * Every screen in the onboarding flow, and every component they render, must
 * take its colors from useAppThemeContext() — never from a pinned darkTheme /
 * lightTheme, and never from a raw color literal.
 *
 * This is a static check on purpose. The regression it guards is invisible to
 * a render test: welcome.tsx, sign-up-form.tsx, role-select.tsx and
 * payouts.tsx each used to `const theme = darkTheme`, so a light-mode user was
 * flipped to dark for the first stretch of the funnel and back again. A
 * rendering assertion would pass either way, because the components are all
 * token-driven — what mattered was WHICH theme object got handed in.
 *
 * Raw literals are rejected for the same reason: a hardcoded hex is a color
 * that can't follow the theme. Genuinely fixed colors — third-party brand
 * marks, modal scrims — go through the allowlist below with a reason, so
 * adding one is a deliberate act rather than a slip.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

// The flow, in order, plus the components these screens render.
const FLOW_FILES = [
  'app/onboarding/_layout.tsx',
  'app/onboarding/index.tsx',
  'app/onboarding/welcome.tsx',
  'app/onboarding/username.tsx',
  'app/auth/sign-up-form.tsx',
  'app/onboarding/style.tsx',
  'app/onboarding/location.tsx',
  'app/onboarding/role-select.tsx',
  'app/onboarding/payouts.tsx',
  'app/onboarding/founder-note.tsx',
  'components/onboarding/WelcomeCarousel.tsx',
  'components/onboarding/CarouselGlow.tsx',
  'components/onboarding/ProofCard.tsx',
  'components/onboarding/PayoutSetupScreen.tsx',
  'components/onboarding/OnboardingProgressDots.tsx',
  'components/onboarding/BountyFormatPreview.tsx',
  'components/onboarding/BountyCompassMark.tsx',
  'components/onboarding/SkipAuthLink.tsx',
];

/**
 * Fixed colors that are correct to hardcode, with the reason. Anything else
 * must be a theme token or a `palette.*` constant.
 */
const ALLOWED_LITERALS: Record<string, string> = {
  '#635BFF': "Stripe's brand purple on the third-party mark in PayoutSetupScreen",
  'rgba(0,0,0,0.45)': 'modal scrim, black in both themes (matches components/ui/app-modal.tsx)',
  'rgba(0,0,0,0.5)': 'modal scrim, black in both themes (matches components/ui/app-modal.tsx)',
};

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

// Strips comments so prose about the old pinned themes (and about the hexes
// they used to contain) doesn't read as code.
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('onboarding flow theme contract', () => {
  it.each(FLOW_FILES)('%s pins no theme', file => {
    const code = stripComments(read(file));
    const pinned = code.match(/from\s+'[^']*themes\/(darkTheme|lightTheme)'/);

    expect(
      pinned
        ? `${file} imports ${pinned[1]} — onboarding screens must read the live theme via useAppThemeContext()`
        : null
    ).toBeNull();
  });

  it.each(FLOW_FILES)('%s uses no unapproved color literals', file => {
    const code = stripComments(read(file));
    const literals = code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
    const offenders = [...new Set(literals)].filter(literal => !(literal in ALLOWED_LITERALS));

    expect(
      offenders.length > 0
        ? `${file} hardcodes ${offenders.join(', ')} — use a theme token, or palette.* for a genuinely fixed color, or add it to ALLOWED_LITERALS with a reason`
        : null
    ).toBeNull();
  });

  it('every screen in the flow reads the theme from context', () => {
    // The components above take `theme` as a prop from their screen; the
    // screens themselves have to source it.
    const screens = FLOW_FILES.filter(file => file.startsWith('app/'));
    const missing = screens.filter(file => !read(file).includes('useAppThemeContext'));

    expect(missing).toEqual([]);
  });
});
