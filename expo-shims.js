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
    // Also provide a NativeModules-compatible stub so modules that read
    // `NativeModules.ExpoModulesCoreJSLogger` don't get `undefined`.
    try {
      if (!g.NativeModules) g.NativeModules = {};
      var nm = g.NativeModules;
      if (!nm.ExpoModulesCoreJSLogger) {
        nm.ExpoModulesCoreJSLogger = {};
      }
      var nml = nm.ExpoModulesCoreJSLogger;
      if (typeof nml.addListener !== 'function') {
        nml.addListener = function () {
          return { remove: function () {} };
        };
      }
      if (typeof nml.removeListeners !== 'function') {
        nml.removeListeners = function () {};
      }
    } catch (e) {
      // ignore any failures creating NativeModules shim
    }
  }
} catch (e) {
  // Intentionally ignore shim failures
}
