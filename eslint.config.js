// https://docs.expo.dev/guides/using-eslint/
// ESLint v9 flat config format

const expoConfig = require('eslint-config-expo/flat');
const reactNativeA11y = require('eslint-plugin-react-native-a11y');

module.exports = [
  ...expoConfig,
  {
    plugins: {
      'react-native-a11y': reactNativeA11y,
    },
    rules: {
      // Accessibility rules from plugin's "all" config (basic + iOS + Android)
      // Basic rules (common to both iOS & Android)
      'react-native-a11y/has-accessibility-hint': 'error',
      'react-native-a11y/has-accessibility-props': 'error',
      'react-native-a11y/has-valid-accessibility-actions': 'error',
      'react-native-a11y/has-valid-accessibility-component-type': 'error',
      'react-native-a11y/has-valid-accessibility-descriptors': 'error',
      'react-native-a11y/has-valid-accessibility-role': 'error',
      'react-native-a11y/has-valid-accessibility-state': 'error',
      'react-native-a11y/has-valid-accessibility-states': 'error',
      'react-native-a11y/has-valid-accessibility-traits': 'error',
      'react-native-a11y/has-valid-accessibility-value': 'error',
      'react-native-a11y/no-nested-touchables': 'error',
      // iOS-specific rules
      'react-native-a11y/has-valid-accessibility-ignores-invert-colors': 'error',
      // Android-specific rules
      'react-native-a11y/has-valid-accessibility-live-region': 'error',
      'react-native-a11y/has-valid-important-for-accessibility': 'error',
    },
  },
];
