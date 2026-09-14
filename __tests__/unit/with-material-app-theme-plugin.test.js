/**
 * Regression test for GitHub #808: Stripe Identity crashed the Android app
 * natively because Expo prebuild left AppTheme on an AppCompat parent.
 */
const {
  applyMaterialAppTheme,
  MATERIAL_APP_THEME_PARENT,
} = require('../../plugins/withMaterialAppTheme');

function stylesWith(parent) {
  return {
    resources: {
      style: [
        {
          $: { name: 'AppTheme', parent },
          item: [{ $: { name: 'colorPrimary' }, _: '@color/colorPrimary' }],
        },
        {
          $: { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' },
          item: [{ $: { name: 'postSplashScreenTheme' }, _: '@style/AppTheme' }],
        },
      ],
    },
  };
}

describe('withMaterialAppTheme', () => {
  it('uses a Material Components parent (required by Stripe Identity)', () => {
    expect(MATERIAL_APP_THEME_PARENT).toMatch(/^Theme\.MaterialComponents\./);
  });

  it.each(['Theme.AppCompat.DayNight.NoActionBar', 'Theme.EdgeToEdge'])(
    'replaces the %s AppTheme parent',
    (parent) => {
      const result = applyMaterialAppTheme(stylesWith(parent));
      const appTheme = result.resources.style.find((s) => s.$.name === 'AppTheme');
      expect(appTheme.$.parent).toBe(MATERIAL_APP_THEME_PARENT);
      // Existing theme items are preserved.
      expect(appTheme.item).toHaveLength(1);
    }
  );

  it('leaves other styles untouched', () => {
    const result = applyMaterialAppTheme(stylesWith('Theme.AppCompat.DayNight.NoActionBar'));
    const splash = result.resources.style.find((s) => s.$.name === 'Theme.App.SplashScreen');
    expect(splash.$.parent).toBe('Theme.SplashScreen');
  });

  it('is a no-op when there is no AppTheme or no styles', () => {
    expect(applyMaterialAppTheme({ resources: {} })).toEqual({ resources: {} });
    expect(applyMaterialAppTheme({ resources: { style: [] } })).toEqual({ resources: { style: [] } });
  });
});
