// Web keeps the platform default typeface. The native implementation
// (applyGlobalFont.ts) patches react-native internals, which Metro refuses to
// bundle for web even behind a try/catch, so it fails `expo export -p web`.
export function applyGlobalFont() {}
