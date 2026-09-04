/** Metro config — extend expo/metro-config and merge project aliases. */
const path = require('path');
const { resolve } = require('metro-resolver');
const { resolveWebStub } = require('./stubs/web-stub-resolver.cjs');
const projectRoot = __dirname;

const aliasExtraNodeModules = {
  components: path.resolve(projectRoot, 'components'),
  lib: path.resolve(projectRoot, 'lib'),
  hooks: path.resolve(projectRoot, 'hooks'),
  services: path.resolve(projectRoot, 'services'),
  app: path.resolve(projectRoot, 'app'),
  assets: path.resolve(projectRoot, 'assets'),
  '@': path.resolve(projectRoot, 'components'),
  // Ensure Metro can resolve tweetnacl's build file explicitly via require.resolve
  tweetnacl: path.dirname(require.resolve('tweetnacl/package.json')),
};

console.log('[METRO DIAGNOSTIC] projectRoot:', projectRoot);
console.log('[METRO DIAGNOSTIC] tweetnacl path:', aliasExtraNodeModules.tweetnacl);

// Always extend expo/metro-config so tooling (expo-doctor, EAS) recognizes it.
try {
  const { getDefaultConfig } = require('expo/metro-config');
  const defaultConfig = getDefaultConfig(projectRoot);

  const originalResolver =
    (defaultConfig.resolver && defaultConfig.resolver.resolveRequest) || resolve;

  // Custom resolver: on web, route a handful of native-only packages (Stripe,
  // react-native-maps + its clustering wrapper, the url-polyfill auto-installer) to
  // local web stubs. The mapping lives in stubs/web-stub-resolver.cjs so it can be
  // unit-tested without booting Metro. Non-web platforms fall straight through.
  const resolveRequest = (context, realModuleName, platform, moduleName) => {
    const targetName = realModuleName || moduleName;
    const webStub = resolveWebStub(targetName, platform, projectRoot);
    if (webStub) return webStub;

    return originalResolver(context, realModuleName, platform, moduleName);
  };

  let finalConfig = Object.assign({}, defaultConfig, {
    resolver: Object.assign({}, defaultConfig.resolver || {}, {
      extraNodeModules: Object.assign(
        {},
        (defaultConfig.resolver && defaultConfig.resolver.extraNodeModules) || {},
        aliasExtraNodeModules
      ),
      sourceExts: Array.from(
        new Set(
          [].concat((defaultConfig.resolver && defaultConfig.resolver.sourceExts) || [], ['cjs'])
        )
      ),
      nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
      resolveRequest,
    }),
    watchFolders: Array.from(
      new Set([].concat(defaultConfig.watchFolders || [], [path.resolve(projectRoot)]))
    ),
  });

  try {
    const { withNativeWind } = require('nativewind/metro');
    if (typeof withNativeWind === 'function')
      finalConfig = withNativeWind(finalConfig, { input: './global.css' });
    console.warn('[metro.config] nativewind/metro applied to Metro config');
  } catch (e) {
    console.warn('[metro.config] nativewind/metro not applied:', e && e.message ? e.message : e);
  }

  module.exports = finalConfig;
} catch (err) {
  console.warn(
    '[metro.config] Failed to load expo/metro-config; using fallback config.',
    err && err.message ? err.message : err
  );
  module.exports = {
    resolver: {
      extraNodeModules: aliasExtraNodeModules,
      sourceExts: ['js', 'json', 'ts', 'tsx', 'jsx', 'cjs'],
    },
    watchFolders: [path.resolve(projectRoot)],
  };
}
