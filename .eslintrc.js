// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo', 'plugin:react-native-a11y/all'],
  plugins: ['react-native-a11y'],
  rules: {
    // Disable rules that are not available in the installed TypeScript ESLint version
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-wrapper-object-types': 'off',
    
    // Adjust some accessibility rules to warnings instead of errors
    'react-native-a11y/has-valid-accessibility-state': 'warn',
    'react-native-a11y/has-valid-accessibility-live-region': 'warn',
    'react-native-a11y/has-valid-important-for-accessibility': 'warn',
    'react-native-a11y/no-nested-touchables': 'warn',
  },
};
