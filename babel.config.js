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
      // Reanimated plugin must be listed last.
      // Pass the logical-assignment-operators transform as an extraPlugin so
      // that worklet code strings (serialized by the plugin from their TS
      // source) also have ??= / ||= / &&= replaced before Hermes sees them at
      // runtime.  Without this, the plugin's internal workletTransformSync
      // only runs @babel/preset-typescript and leaves those operators in the
      // serialized code string.
      [
        'react-native-reanimated/plugin',
        {
          extraPlugins: [
            '@babel/plugin-transform-logical-assignment-operators',
          ],
        },
      ],
    ],
    // When building for Android with Hermes, babel-preset-expo skips
    // @babel/plugin-transform-logical-assignment-operators because Hermes
    // is assumed to support them natively. However, several packages ship
    // pre-built dist files that already contain ??= / ||= syntax
    // (react-native-reanimated, expo-router, react-native-css-interop,
    // nativewind), so Hermes fails to compile those files at runtime.
    // This override re-enables the transform for all node_modules so
    // Android / Hermes builds succeed regardless of which dependency
    // ships pre-compiled code with these operators.
    overrides: [
      {
        test: /node_modules[\\/]/,
        plugins: [
          '@babel/plugin-transform-logical-assignment-operators',
        ],
      },
    ],
  };
};
