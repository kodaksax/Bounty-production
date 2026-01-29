module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Allow root-based imports like "components/..." and "lib/..."
      [
        "module-resolver",
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
  };
};