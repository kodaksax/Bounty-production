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

function makeTransformerConfig(baseTransformer = {}) {
  const transformer = Object.assign({}, baseTransformer);
  try {
    transformer.minifierPath = require.resolve('metro-minify-terser');
    transformer.minifierConfig = { ecma: 2020, keep_classnames: false, keep_fnames: false, module: true };
  } catch (e) {
    console.debug('[metro.config] metro-minify-terser not available:', e && e.message ? e.message : e);
  }
  return transformer;
}

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
    transformer: makeTransformerConfig(defaultConfig.transformer || {}),
  });

  try {
    const { withNativeWind } = require('nativewind/metro');
    if (typeof withNativeWind === 'function') finalConfig = withNativeWind(finalConfig);
    console.warn('[metro.config] nativewind/metro applied to Metro config');
    try {
      const t = finalConfig.transformer || {};
      console.warn('[metro.config] transformer keys:', Object.keys(t));
      console.warn('[metro.config] has babelTransformerPath:', !!t.babelTransformerPath);
      console.warn('[metro.config] has getTransformOptions:', typeof finalConfig.transformer?.getTransformOptions === 'function');
    } catch (e) {
      console.warn('[metro.config] transformer inspect failed:', e && e.message ? e.message : e);
    }
  } catch (e) {
    console.warn('[metro.config] nativewind/metro not applied:', e && e.message ? e.message : e);
  }

  module.exports = finalConfig;
} catch (err) {
  console.warn('[metro.config] Failed to load expo/metro-config; using fallback config.', err && err.message ? err.message : err);
  module.exports = { resolver: { extraNodeModules: aliasExtraNodeModules, sourceExts: ['js', 'json', 'ts', 'tsx', 'jsx', 'cjs'] }, watchFolders: [path.resolve(projectRoot)], transformer: makeTransformerConfig() };
}
