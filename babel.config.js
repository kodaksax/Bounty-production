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
    // When building for Android with Hermes, babel-preset-expo skips
    // @babel/plugin-transform-logical-assignment-operators because Hermes
    // is assumed to support them natively. However, react-native-css-interop
    // and nativewind ship pre-built dist files that already contain ??= / ||=
    // syntax, so Hermes still needs to parse them — but the transform has
    // already been skipped. These overrides re-enable the transform for those
    // packages so Android / Hermes builds succeed.
    overrides: [
      {
        test: /node_modules[\\/](react-native-css-interop|nativewind)[\\/]/,
        plugins: [
          '@babel/plugin-transform-logical-assignment-operators',
        ],
      },
    ],
  };
};
