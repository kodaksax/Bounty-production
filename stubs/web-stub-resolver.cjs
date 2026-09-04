/**
 * Web-only module substitutions shared by metro.config.cjs and its unit test.
 *
 * Several native-only packages register view managers / call into Fabric codegen
 * that react-native-web does not provide. Bundled for web they throw during
 * route-module evaluation, which expo-router surfaces as the misleading
 * "Cannot destructure property 'ErrorBoundary' of 'undefined'" crash. On web we
 * point Metro at an inert local stub instead; every other platform is untouched.
 *
 * Keys are the imported module id; values are the repo-relative stub path.
 */
const WEB_STUBS = {
  '@stripe/stripe-react-native': 'lib/services/stripe-mock.web.js',
  'react-native-maps': 'stubs/react-native-maps.web.js',
  'react-native-map-clustering': 'stubs/react-native-map-clustering.web.js',
  'react-native-url-polyfill/auto': 'stubs/react-native-url-polyfill-auto.web.js',
};

const path = require('path');

/**
 * @returns {{ type: 'sourceFile', filePath: string } | null}
 *   a Metro resolution pointing at the web stub, or null to defer to the default
 *   resolver (always null when platform !== 'web').
 */
function resolveWebStub(targetName, platform, projectRoot) {
  if (platform !== 'web') return null;
  const rel = WEB_STUBS[targetName];
  if (!rel) return null;
  return { type: 'sourceFile', filePath: path.resolve(projectRoot, rel) };
}

module.exports = { WEB_STUBS, resolveWebStub };
