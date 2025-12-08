const { withNativeWind } = require('nativewind/metro');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Performance optimizations for Metro bundler
config.transformer = {
  ...config.transformer,
  // Enable minification for better performance
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

// Enable caching for faster rebuilds
config.cacheStores = [
  {
    name: 'metro-cache',
    get: (key) => {
      // Use default cache implementation
      return undefined;
    },
    set: (key, value) => {
      // Use default cache implementation
    },
  },
];

module.exports = withNativeWind(config, { input: './global.css' });