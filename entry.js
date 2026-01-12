// Clean entry point for Expo Router
// This shim ensures Metro/Expo correctly resolves the expo-router entry module
// without require cycles or HMR runtime issues.
//
// Note: With Expo SDK 54+ and expo-router v6+, expo-router/entry handles HMR setup
// internally via @expo/metro-runtime. The previous polyfills that attempted to load
// HMRClient manually are no longer needed and were causing errors including:
// - "Cannot find module '@expo/metro-runtime/HMRClient'"
// - Deprecated deep import warnings from react-native internals
// - Require cycles between expo-router/entry.js files
// - "[EntryShim] skipping registerRootComponent" messages
import 'expo-router/entry'; // expo-router handles all initialization internally including HMR setup
