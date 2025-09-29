const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add a simple resolver alias so imports like 'lib/theme' work at runtime.
// Metro doesn't read tsconfig paths; we map them here to the local lib folder.
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = Object.assign({}, config.resolver.extraNodeModules || {}, {
	lib: path.resolve(__dirname, 'lib'),
});

module.exports = withNativeWind(config, { input: './global.css' });