// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo', 'plugin:react-native-a11y/recommended'],
  plugins: ['react-native-a11y'],
  rules: {
    // Accessibility rules
    'react-native-a11y/has-accessibility-props': 'error',
    'react-native-a11y/has-valid-accessibility-role': 'error',
    'react-native-a11y/has-valid-accessibility-state': 'warn',
    'react-native-a11y/has-valid-accessibility-live-region': 'warn',
    'react-native-a11y/has-valid-important-for-accessibility': 'warn',
    'react-native-a11y/no-nested-touchables': 'warn',
  },
};
