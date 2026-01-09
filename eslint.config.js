// Minimal flat ESLint config: register the accessibility plugin and rules.
module.exports = [
  // ignore patterns applied by flat config
  {
    ignores: ['**/.history/**', '**/*.bak', 'node_modules/**', '.expo/**', 'dist/**', 'build/**', 'coverage/**'],
  },
  {
    plugins: {
      'react-native-a11y': require('eslint-plugin-react-native-a11y'),
    },
    rules: {
      'react-native-a11y/has-accessibility-props': 'error',
      'react-native-a11y/has-valid-accessibility-role': 'error',
      'react-native-a11y/has-valid-accessibility-state': 'warn',
      'react-native-a11y/has-valid-accessibility-live-region': 'warn',
      'react-native-a11y/has-valid-important-for-accessibility': 'warn',
      'react-native-a11y/no-nested-touchables': 'warn',
    },
  },
];
