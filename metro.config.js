const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');
const cssInterop = require.resolve('react-native-css-interop/package.json');

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const alias = {
  app: path.resolve(projectRoot, 'app'),
  components: path.resolve(projectRoot, 'components'),
  hooks: path.resolve(projectRoot, 'hooks'),
  lib: path.resolve(projectRoot, 'lib'),
  providers: path.resolve(projectRoot, 'providers'),
  events: require.resolve('events'),
  '@': path.resolve(projectRoot, 'components'),
};

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
  alias: alias,
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

module.exports = withNativeWind(config, {
  input: './global.css',
  projectRoot,
  inlineRem: false,
  features: {
    "nativewind/metro": {
      transformerPath: require.resolve('react-native-css-interop/dist/metro/transformer'),
    }
  }
});