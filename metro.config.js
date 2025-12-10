const { withNativeWind } = require('nativewind/metro');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Performance optimizations for Metro bundler
config.transformer = {
  ...config.transformer,
  // Configure minification with preserved names for Sentry error tracking
  // Keeps function and class names intact for better error reporting in production
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

module.exports = withNativeWind(config, { input: './global.css' });