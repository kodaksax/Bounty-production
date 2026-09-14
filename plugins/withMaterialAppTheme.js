const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * Make the Android `AppTheme` a Material Components theme.
 *
 * Stripe Identity (`@stripe/stripe-identity-react-native`) requires the
 * hosting activity to use a Material theme. Expo SDK 53+ prebuild restores
 * `AppTheme` to `Theme.AppCompat.DayNight.NoActionBar`, so presenting the
 * verification sheet on Android killed the process natively — the app just
 * closed on "Start verification" (GitHub #808; PostHog shows Android users
 * never reaching `verification_pending`, only a cold `Application Opened`
 * seconds after `verification_launch`).
 *
 * We use the `.Bridge` variant: it inherits from the AppCompat theme we
 * already ship (so existing native widgets/dialogs keep their look) while
 * defining the Material Components attributes the Stripe SDK checks for.
 * The Material library is already on the classpath via react-native-screens
 * and Stripe.
 */
const MATERIAL_APP_THEME_PARENT = 'Theme.MaterialComponents.DayNight.NoActionBar.Bridge';

function applyMaterialAppTheme(styles) {
  const style = (styles.resources && styles.resources.style) || [];
  const appTheme = style.find((s) => s && s.$ && s.$.name === 'AppTheme');
  if (appTheme) {
    appTheme.$.parent = MATERIAL_APP_THEME_PARENT;
  }
  return styles;
}

/**
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withMaterialAppTheme = (config) => {
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults = applyMaterialAppTheme(cfg.modResults);
    return cfg;
  });
};

module.exports = withMaterialAppTheme;
module.exports.applyMaterialAppTheme = applyMaterialAppTheme;
module.exports.MATERIAL_APP_THEME_PARENT = MATERIAL_APP_THEME_PARENT;
