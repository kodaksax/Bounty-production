// Minimal runtime shims to avoid crashes when native Expo logger is absent.
// Keep this file intentionally simple (no modern syntax that might confuse
// Hermes transformation) and small so it can be executed early during bundle
// evaluation.
try {
  if (typeof globalThis !== 'undefined') {
    var g = globalThis;
    if (!g.ExpoModulesCoreJSLogger) {
      g.ExpoModulesCoreJSLogger = {};
    }
    var l = g.ExpoModulesCoreJSLogger;
    if (typeof l.addListener !== 'function') {
      l.addListener = function () {
        return { remove: function () {} };
      };
    }
    if (typeof l.removeListeners !== 'function') {
      l.removeListeners = function () {};
    }
  }
} catch (e) {
  // Intentionally ignore shim failures
}
