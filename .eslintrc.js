// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo'],
  plugins: ['react-native-a11y'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      plugins: ['@typescript-eslint'],
      rules: {
        // Disable rules that don't exist in @typescript-eslint/parser v6
        '@typescript-eslint/no-empty-object-type': 'off',
        '@typescript-eslint/no-wrapper-object-types': 'off',
      },
    },
  ],
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
