const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

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
  // Resolve web-specific implementations
  resolveRequest: (context, moduleName, platform) => {
    // For web platform, provide error-throwing stubs for native-only packages
    if (platform === 'web' && moduleName === '@stripe/stripe-react-native') {
      return {
        filePath: path.resolve(__dirname, 'lib/services/stripe-mock.web.js'),
        type: 'sourceFile',
      };
    }
    // Use default resolver for everything else
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;