module.exports = function (api) {
  api.cache(true);
  return {
    // Ensure nativewind's JSX/runtime transform is available early
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Ensure JSX is always recognized in .js entry files
      '@babel/plugin-syntax-jsx',
      // Object rest/spread (e.g., `{ ...obj }`) should be transformed for older engines
      '@babel/plugin-transform-object-rest-spread',
      // Ensure modern syntax is transformed for older JS engines on Android (JS files)
      '@babel/plugin-transform-optional-chaining',
      '@babel/plugin-transform-nullish-coalescing-operator',
      ['@babel/plugin-transform-logical-assignment-operators', { 'loose': true }],
      '@babel/plugin-transform-numeric-separator',
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
    // Apply TypeScript transform only for TS/TSX files to avoid disabling JSX parsing for .js files
    overrides: [
      {
        test: [/\.ts$/, /\.tsx$/],
        plugins: [
          '@babel/plugin-transform-typescript',
          // Class and private transforms must run AFTER TypeScript transform for .ts files
          ['@babel/plugin-transform-private-methods', { 'loose': true }],
          ['@babel/plugin-transform-class-properties', { 'loose': true }],
          // Also ensure modern syntax transforms for TS files
          '@babel/plugin-transform-optional-chaining',
          '@babel/plugin-transform-object-rest-spread',
          '@babel/plugin-transform-nullish-coalescing-operator',
          ['@babel/plugin-transform-logical-assignment-operators', { 'loose': true }],
          '@babel/plugin-transform-numeric-separator',
        ],
      },
    ],
  };
};