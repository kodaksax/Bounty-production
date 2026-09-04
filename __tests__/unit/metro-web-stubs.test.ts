/**
 * Guards the platform-specific module substitutions in metro.config.cjs:
 * on `platform === 'web'` a fixed set of native-only packages must resolve to
 * their local web stubs, and every other platform must be left untouched.
 *
 * Exercises stubs/web-stub-resolver.cjs (the shared mapping metro.config.cjs
 * delegates to) so the assertion runs without booting Metro.
 */
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WEB_STUBS, resolveWebStub } = require('../../stubs/web-stub-resolver.cjs') as {
  WEB_STUBS: Record<string, string>;
  resolveWebStub: (
    targetName: string,
    platform: string | null,
    projectRoot: string
  ) => { type: 'sourceFile'; filePath: string } | null;
};

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STUBBED = Object.keys(WEB_STUBS);
const NON_WEB_PLATFORMS = ['ios', 'android', null];

describe('metro web-stub resolver', () => {
  it('covers exactly the packages that break react-native-web', () => {
    expect(STUBBED.sort()).toEqual(
      [
        '@stripe/stripe-react-native',
        'react-native-map-clustering',
        'react-native-maps',
        'react-native-url-polyfill/auto',
      ].sort()
    );
  });

  describe.each(STUBBED)('%s', (target) => {
    it('maps to its web stub on platform === "web"', () => {
      const result = resolveWebStub(target, 'web', PROJECT_ROOT);
      expect(result).toEqual({
        type: 'sourceFile',
        filePath: path.resolve(PROJECT_ROOT, WEB_STUBS[target]),
      });
    });

    it.each(NON_WEB_PLATFORMS)('is not remapped on platform === %p', (platform) => {
      expect(resolveWebStub(target, platform, PROJECT_ROOT)).toBeNull();
    });
  });

  it('defers unknown modules to the default resolver on every platform', () => {
    for (const platform of ['web', ...NON_WEB_PLATFORMS]) {
      expect(resolveWebStub('react-native', platform, PROJECT_ROOT)).toBeNull();
      expect(resolveWebStub('lodash', platform, PROJECT_ROOT)).toBeNull();
    }
  });
});
