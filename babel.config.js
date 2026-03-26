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
      'react-native-reanimated/plugin',
    ],
    // NOTE: logical-assignment transforms (??= / ||= / &&=) removed —
    // Hermes V1 (useHermesV1: true in expo-build-properties) supports
    // these operators natively.  If you fall back to legacy Hermes,
    // re-add @babel/plugin-transform-logical-assignment-operators here
    // and in a node_modules override.
  };
};
