/** Metro config — extend expo/metro-config and merge project aliases. */
const path = require('path');
const projectRoot = __dirname;

const aliasExtraNodeModules = {
  components: path.resolve(projectRoot, 'components'),
  lib: path.resolve(projectRoot, 'lib'),
  hooks: path.resolve(projectRoot, 'hooks'),
  services: path.resolve(projectRoot, 'services'),
  app: path.resolve(projectRoot, 'app'),
  assets: path.resolve(projectRoot, 'assets'),
  '@': path.resolve(projectRoot, 'components'),
};

// Always extend expo/metro-config so tooling (expo-doctor, EAS) recognizes it.
try {
  const { getDefaultConfig } = require('expo/metro-config');
  const defaultConfig = getDefaultConfig(projectRoot);

  let finalConfig = Object.assign({}, defaultConfig, {
    resolver: Object.assign({}, defaultConfig.resolver || {}, {
      extraNodeModules: Object.assign({}, (defaultConfig.resolver && defaultConfig.resolver.extraNodeModules) || {}, aliasExtraNodeModules),
      sourceExts: Array.from(new Set([].concat((defaultConfig.resolver && defaultConfig.resolver.sourceExts) || [], ['cjs']))),
    }),
    watchFolders: Array.from(new Set([].concat(defaultConfig.watchFolders || [], [path.resolve(projectRoot)]))),
  });

  try {
    const { withNativeWind } = require('nativewind/metro');
    if (typeof withNativeWind === 'function') finalConfig = withNativeWind(finalConfig, { input: './global.css' });
    console.warn('[metro.config] nativewind/metro applied to Metro config');
  } catch (e) {
    console.warn('[metro.config] nativewind/metro not applied:', e && e.message ? e.message : e);
  }

  module.exports = finalConfig;
} catch (err) {
  console.warn('[metro.config] Failed to load expo/metro-config; using fallback config.', err && err.message ? err.message : err);
  module.exports = { resolver: { extraNodeModules: aliasExtraNodeModules, sourceExts: ['js', 'json', 'ts', 'tsx', 'jsx', 'cjs'] }, watchFolders: [path.resolve(projectRoot)] };
}
