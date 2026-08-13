const { withAppDelegate } = require('@expo/config-plugins');

/**
 * Removes the legacy `sourceURL(for bridge: RCTBridge)` override from the
 * generated iOS AppDelegate.
 *
 * `expo-template-bare-minimum@55` still ships this override on
 * `ReactNativeDelegate`:
 *
 *   override func sourceURL(for bridge: RCTBridge) -> URL? {
 *     bridge.bundleURL ?? bundleURL()
 *   }
 *
 * Under React Native 0.83 + the new architecture the bridge is gone and
 * `RCTBridge` is no longer visible to Swift, so prebuild produces an
 * AppDelegate that fails to compile with:
 *
 *   cannot find type 'RCTBridge' in scope
 *
 * `bundleURL()` alone is what the runtime (including expo-dev-client) uses on
 * bridgeless, so the override can simply be dropped.
 *
 * The regex intentionally matches only the function itself — not the
 * "// Extension point for config-plugins" anchor above it — so code injected
 * there by other config plugins is preserved regardless of plugin ordering.
 *
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withNewArchAppDelegate = (config) => {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      return cfg;
    }

    // The body contains no nested braces, so a lazy match to the first
    // two-space-indented closing brace ends exactly at the function's end.
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /\n[^\S\n]*override func sourceURL\(for bridge: RCTBridge\) -> URL\? \{[\s\S]*?\n[^\S\n]*\}\n/,
      '\n'
    );

    return cfg;
  });
};

module.exports = withNewArchAppDelegate;
