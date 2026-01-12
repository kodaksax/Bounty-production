// Clean entry point for Expo Router
// This shim ensures Metro/Expo correctly resolves the expo-router entry module
// without require cycles or HMR runtime issues.
//
// Note: With Expo SDK 54+ and expo-router v6+, expo-router/entry handles HMR setup
// internally via @expo/metro-runtime. The previous polyfills that attempted to load
// HMRClient manually are no longer needed and were causing deprecated import warnings
// and require cycles.
import 'expo-router/entry';
