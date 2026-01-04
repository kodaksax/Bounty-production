const { getDefaultConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.transformer = {
  ...defaultConfig.transformer,
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

defaultConfig.resolver = {
  ...defaultConfig.resolver,
  sourceExts: Array.from(new Set([...(defaultConfig.resolver?.sourceExts || []), 'cjs'])),
};

module.exports = defaultConfig;