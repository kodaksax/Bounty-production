const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * Wires the native Android requirement of Stripe Identity into the prebuild.
 *
 * `@stripe/stripe-identity-react-native` pulls in the `com.stripe:identity`
 * Android SDK, whose verification sheet inflates Material Components views from
 * the host Activity's theme. Expo generates that Activity with an AppCompat
 * theme, which is NOT a Material Components descendant. Launching the sheet
 * (`present()` in app/verification/launch.tsx) then throws a native inflation
 * error and kills the process -- before the JavaScript `catch` around
 * `present()` can run, which is why users are dropped out of the app when they
 * resubmit identity verification.
 *
 * The package ships no config plugin of its own (only a podspec and a
 * build.gradle for autolinking), so we register the native wiring here: switch
 * the generated `AppTheme` to the Material Components "Bridge" theme. The Bridge
 * variant adopts Material Components while staying compatible with an app
 * otherwise built against AppCompat, so it satisfies Stripe Identity without
 * restyling the rest of the app.
 *
 * The plugin is idempotent and defensive: it leaves an already-Material theme
 * untouched and no-ops if the generated styles are missing or malformed.
 *
 * NOTE: this changes native output, so it takes effect only on a new native
 * build (prebuild / EAS), not through an OTA update.
 */
const MATERIAL_BRIDGE_THEME = 'Theme.MaterialComponents.DayNight.NoActionBar.Bridge';

/**
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withStripeIdentity = (config) => {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults?.resources?.style;
    if (!Array.isArray(styles)) return cfg;

    const appTheme = styles.find((style) => style?.$?.name === 'AppTheme');
    const currentParent = appTheme?.$?.parent ?? '';
    if (appTheme && !currentParent.includes('MaterialComponents')) {
      appTheme.$.parent = MATERIAL_BRIDGE_THEME;
    }

    return cfg;
  });
};

module.exports = withStripeIdentity;
module.exports.MATERIAL_BRIDGE_THEME = MATERIAL_BRIDGE_THEME;
