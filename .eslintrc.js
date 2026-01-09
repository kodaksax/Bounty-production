// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo'],
  plugins: ['react-native-a11y'],
  rules: {
    // Disable missing TypeScript rules that aren't available in current version
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-wrapper-object-types': 'off',
    
    // Accessibility rules
    'react-native-a11y/has-accessibility-props': 'warn',
    'react-native-a11y/has-valid-accessibility-role': 'warn',
    'react-native-a11y/has-valid-accessibility-state': 'warn',
    'react-native-a11y/has-valid-accessibility-live-region': 'warn',
    'react-native-a11y/has-valid-important-for-accessibility': 'warn',
    'react-native-a11y/no-nested-touchables': 'warn',
  },
};
