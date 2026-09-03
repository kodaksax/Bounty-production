import appConfig from '../../../app.json';

describe('Android Google OAuth redirect', () => {
  it('registers the application-id scheme used by expo-auth-session', () => {
    const intentFilters = appConfig.expo.android.intentFilters;
    const googleRedirectFilter = intentFilters.find(filter =>
      filter.data?.some(data => data.scheme === appConfig.expo.android.package)
    );

    expect(googleRedirectFilter).toEqual(
      expect.objectContaining({
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
      })
    );
    expect(googleRedirectFilter?.data).toContainEqual({
      scheme: 'app.bountyfinder.BOUNTYExpo',
    });
  });
});
