/**
 * Guards the platform-specific module substitutions in metro.config.cjs:
 * on `platform === 'web'` a fixed set of native-only packages must resolve to
 * their local web stubs, and every other platform must be left untouched.
 *
 * Exercises stubs/web-stub-resolver.cjs (the shared mapping metro.config.cjs
 * delegates to) so the assertion runs without booting Metro.
 */
import path from 'path';

type Resolution = { type: 'sourceFile'; filePath: string } | null;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WEB_STUBS, SCOPED_WEB_STUBS, resolveWebStub } = require('../../stubs/web-stub-resolver.cjs') as {
  WEB_STUBS: Record<string, string>;
  SCOPED_WEB_STUBS: Array<{ fromPackage: string; module: RegExp; stub: string }>;
  resolveWebStub: (
    targetName: string,
    platform: string | null,
    projectRoot: string,
    originModulePath?: string
  ) => Resolution;
};

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STUBBED = Object.keys(WEB_STUBS);
const NON_WEB_PLATFORMS = ['ios', 'android', null];

/** The importing file for the Alert rule: react-native-web's own entry point. */
const RNW_INDEX = path.join(PROJECT_ROOT, 'node_modules', 'react-native-web', 'dist', 'index.js');
const ALERT_STUB = path.resolve(PROJECT_ROOT, 'stubs/react-native-web-alert.web.js');

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

  /**
   * react-native-web's Alert is a no-op (`static alert() {}`), which silently
   * swallows every Alert.alert(...) in the app on web. It is reached by a RELATIVE
   * import from inside react-native-web, so the rule has to key on the importer as
   * well as the imported id.
   */
  describe('react-native-web Alert', () => {
    it('has exactly one scoped rule, for react-native-web', () => {
      expect(SCOPED_WEB_STUBS).toHaveLength(1);
      expect(SCOPED_WEB_STUBS[0].fromPackage).toBe('react-native-web');
      expect(SCOPED_WEB_STUBS[0].stub).toBe('stubs/react-native-web-alert.web.js');
    });

    it.each([
      './exports/Alert',
      './exports/Alert/index.js',
      '../exports/Alert',
      'react-native-web/dist/exports/Alert',
    ])('maps %s to the Alert shim on web', (specifier) => {
      expect(resolveWebStub(specifier, 'web', PROJECT_ROOT, RNW_INDEX)).toEqual({
        type: 'sourceFile',
        filePath: ALERT_STUB,
      });
    });

    it('matches a package-qualified id even with no importer path', () => {
      expect(resolveWebStub('react-native-web/dist/exports/Alert', 'web', PROJECT_ROOT)).toEqual({
        type: 'sourceFile',
        filePath: ALERT_STUB,
      });
    });

    it.each(NON_WEB_PLATFORMS)('leaves it alone on platform === %p', (platform) => {
      expect(resolveWebStub('./exports/Alert', platform, PROJECT_ROOT, RNW_INDEX)).toBeNull();
    });

    it('does not hijack a relative ./exports/Alert imported from app code', () => {
      const appFile = path.join(PROJECT_ROOT, 'components', 'exports', 'index.tsx');
      expect(resolveWebStub('./exports/Alert', 'web', PROJECT_ROOT, appFile)).toBeNull();
      expect(resolveWebStub('./exports/Alert', 'web', PROJECT_ROOT, undefined)).toBeNull();
    });

    it('does not hijack react-native-web\'s other exports', () => {
      for (const other of ['./exports/View', './exports/Modal', './exports/AlertBanner']) {
        expect(resolveWebStub(other, 'web', PROJECT_ROOT, RNW_INDEX)).toBeNull();
      }
    });

    it('is not fooled by a same-named directory outside node_modules', () => {
      const decoy = path.join(PROJECT_ROOT, 'vendor', 'react-native-web', 'dist', 'index.js');
      expect(resolveWebStub('./exports/Alert', 'web', PROJECT_ROOT, decoy)).toBeNull();
    });
  });
});