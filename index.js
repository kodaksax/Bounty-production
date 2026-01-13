// Keep the entry as small and deterministic as possible so Expo Go and dev clients
// can resolve the root component without extra shims.
// Gesture Handler must be first to avoid native runtime errors.
import 'expo-router/entry';
import 'react-native-gesture-handler';

