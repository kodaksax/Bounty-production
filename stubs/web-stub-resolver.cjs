/**
 * Web-only module substitutions shared by metro.config.cjs and its unit test.
 *
 * Two kinds of rule live here:
 *
 * 1. WEB_STUBS -- keyed by the imported module id. Several native-only packages
 *    register view managers / call into Fabric codegen that react-native-web does
 *    not provide. Bundled for web they throw during route-module evaluation, which
 *    expo-router surfaces as the misleading "Cannot destructure property
 *    'ErrorBoundary' of 'undefined'" crash. On web we point Metro at an inert local
 *    stub instead.
 *
 * 2. SCOPED_WEB_STUBS -- keyed by (importing package, imported module id). Needed
 *    when the module to replace is reached by a RELATIVE import from inside a
 *    dependency, so there is no package-qualified id to key on. That is the case
 *    for react-native-web's own `Alert`: `react-native-web/dist/index.js` does
 *    `export { default as Alert } from './exports/Alert'`, and the file it lands on
 *    is `class Alert { static alert() {} }` -- a no-op that silently swallows every
 *    one of this repo's ~509 `Alert.alert(...)` calls on web. See
 *    stubs/react-native-web-alert.web.js.
 *
 * Every other platform is untouched by both.
 *
 * Values are repo-relative stub paths.
 */
const path = require('path');

/** @type {Record<string, string>} imported module id -> stub path */
const WEB_STUBS = {
  '@stripe/stripe-react-native': 'lib/services/stripe-mock.web.js',
  'react-native-maps': 'stubs/react-native-maps.web.js',
  'react-native-map-clustering': 'stubs/react-native-map-clustering.web.js',
  'react-native-url-polyfill/auto': 'stubs/react-native-url-polyfill-auto.web.js',
};

/**
 * Rules matched against the importing file as well as the imported id.
 *
 * `fromPackage` is matched against the origin file's path as a `/node_modules/<pkg>/`
 * segment, so it cannot be fooled by a same-named directory in the app's own source.
 * `module` is matched against the imported id with any leading `./` or `../` removed,
 * so `./exports/Alert`, `../exports/Alert` and `react-native-web/dist/exports/Alert`
 * all hit the same rule.
 *
 * @type {Array<{ fromPackage: string, module: RegExp, stub: string }>}
 */
const SCOPED_WEB_STUBS = [
  {
    fromPackage: 'react-native-web',
    module: /(^|\/)exports\/Alert(\/index(\.js)?)?$/,
    stub: 'stubs/react-native-web-alert.web.js',
  },
];

/** True when `originModulePath` sits inside `node_modules/<pkg>/`. */
function isInsidePackage(originModulePath, pkg) {
  if (typeof originModulePath !== 'string' || originModulePath.length === 0) return false;
  return originModulePath.split(path.sep).join('/').includes('/node_modules/' + pkg + '/');
}

/**
 * @param {string} targetName        the imported module id
 * @param {string | null} platform   Metro's target platform
 * @param {string} projectRoot       repo root, for resolving stub paths
 * @param {string} [originModulePath] absolute path of the importing file, when known
 * @returns {{ type: 'sourceFile', filePath: string } | null}
 *   a Metro resolution pointing at the web stub, or null to defer to the default
 *   resolver (always null when platform !== 'web').
 */
function resolveWebStub(targetName, platform, projectRoot, originModulePath) {
  if (platform !== 'web') return null;

  const flat = WEB_STUBS[targetName];
  if (flat) return { type: 'sourceFile', filePath: path.resolve(projectRoot, flat) };

  if (typeof targetName !== 'string') return null;
  const bare = targetName.replace(/^(\.\.?\/)+/, '');
  for (const rule of SCOPED_WEB_STUBS) {
    if (!rule.module.test(bare)) continue;
    // A bare, package-qualified id identifies itself; a relative one needs the importer.
    const qualified = bare.startsWith(rule.fromPackage + '/');
    if (!qualified && !isInsidePackage(originModulePath, rule.fromPackage)) continue;
    return { type: 'sourceFile', filePath: path.resolve(projectRoot, rule.stub) };
  }

  return null;
}

module.exports = { WEB_STUBS, SCOPED_WEB_STUBS, resolveWebStub };
