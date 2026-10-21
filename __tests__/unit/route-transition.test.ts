/**
 * Root navigation motion. The root is a native stack (app/_layout.tsx); on
 * web, where that stack doesn't animate, each route gets an entrance from
 * components/ui/route-transition.tsx through `screenLayout`, its direction
 * coming from where the new route sits relative to the one on screen.
 */
import * as fs from 'fs';
import * as path from 'path';
import { routeDirection } from '../../components/ui/route-transition';

describe('routeDirection', () => {
  it('does not animate the first screen after launch', () => {
    expect(routeDirection(null, { key: 'index-1', index: 0 })).toBe('none');
  });

  it('slides forward when the new route lands above the last one', () => {
    expect(routeDirection({ key: 'tabs-1', index: 0 }, { key: 'bounty-1', index: 1 })).toBe('forward');
  });

  it('slides back when the new route lands below the last one', () => {
    expect(routeDirection({ key: 'bounty-1', index: 1 }, { key: 'tabs-1', index: 0 })).toBe('back');
  });

  it('crossfades a replace (same position, new route)', () => {
    expect(routeDirection({ key: 'index-1', index: 0 }, { key: 'tabs-1', index: 0 })).toBe('replace');
  });

  it('does not replay for the route already on screen', () => {
    expect(routeDirection({ key: 'tabs-1', index: 0 }, { key: 'tabs-1', index: 0 })).toBe('none');
  });
});

describe('root navigator wiring', () => {
  const root = path.resolve(__dirname, '../..');
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');

  // A Slot swapped screens in one frame, had no swipe-back and remounted the
  // screen you returned to. The root must stay a native stack.
  it('renders the root as a native Stack, not a Slot', () => {
    expect(layout).toMatch(/<Stack screenOptions=\{rootScreenOptions\} screenLayout=\{rootScreenLayout\}>/);
    expect(layout).not.toMatch(/import \{[^}]*\bSlot\b[^}]*\} from 'expo-router'/);
  });

  // Native stacks animate on iOS/Android; the JS entrance is only for web,
  // where the stack doesn't. Running both on native would double-animate.
  it('uses the JS route entrance on web only', () => {
    expect(layout).toMatch(
      /const rootScreenLayout = Platform\.OS === 'web' \? routeTransitionLayout : undefined;/
    );
  });
});
