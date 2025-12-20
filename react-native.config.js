// Disable autolinking for deprecated @react-native-community/clipboard if present
// This prevents duplicate/legacy clipboard module from breaking Android builds.

module.exports = {
  dependencies: {
    '@react-native-community/clipboard': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
