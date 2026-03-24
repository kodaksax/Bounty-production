module.exports = function (api) {
  api.cache(true);
  return {
    // Ensure nativewind's JSX/runtime transform is available early
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Allow root-based imports like "components/..." and "lib/..."
      [
        "babel-plugin-module-resolver",
        {
          root: ["./"],
          alias: {
            components: "./components",
            lib: "./lib",
            hooks: "./hooks",
            services: "./services",
            app: "./app",
            assets: "./assets",
            // keep support for @/* paths used in TS config (map to components)
            "@": "./components"
          }
        }
      ],
      // Reanimated plugin must be listed last
      'react-native-reanimated/plugin',
    ],
    // Ensure react-native-css-interop and nativewind runtime files are fully
    // transpiled on all platforms.  When jsEngine:"hermes" is set, babel-preset-expo
    // passes unstable_transformProfile:"hermes-stable" to @react-native/babel-preset,
    // which causes it to skip @babel/plugin-transform-logical-assignment-operators
    // (on the assumption that Hermes already supports ??= / ||= / &&=).
    // In practice some Android Hermes builds (particularly older Expo Go builds) do
    // not fully support ES2021 logical-assignment operators, producing redbox parse
    // errors on Android while iOS works fine.  The overrides below force-apply the
    // transform only to the affected node_modules so no other code is affected.
    overrides: [
      {
        test: /node_modules\/(react-native-css-interop|nativewind)\//,
        plugins: [
          '@babel/plugin-transform-logical-assignment-operators',
        ],
      },
    ],
  };
};