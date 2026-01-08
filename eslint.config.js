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
      // Accessibility rules
      'react-native-a11y/has-accessibility-props': 'error',
      'react-native-a11y/has-valid-accessibility-role': 'error',
      'react-native-a11y/has-valid-accessibility-state': 'warn',
      'react-native-a11y/has-valid-accessibility-live-region': 'warn',
      'react-native-a11y/has-valid-important-for-accessibility': 'warn',
      'react-native-a11y/no-nested-touchables': 'warn',
    },
  },
];
