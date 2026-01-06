const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

config.resolver = {
  ...config.resolver,
  sourceExts: Array.from(new Set([...(config.resolver?.sourceExts || []), 'cjs'])),
};

module.exports = config;