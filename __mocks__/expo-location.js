// expo-location ships untransformed ESM and is native-only. This stub lets
// suites parse modules that import it; a test that cares about location mocks
// lib/services/location-service or expo-location itself.
const denied = { status: 'denied', granted: false, canAskAgain: false };

module.exports = {
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  PermissionStatus: { DENIED: 'denied', GRANTED: 'granted', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: async () => denied,
  getForegroundPermissionsAsync: async () => denied,
  getCurrentPositionAsync: async () => {
    throw new Error('expo-location is not available in tests');
  },
  reverseGeocodeAsync: async () => [],
  geocodeAsync: async () => [],
};
