/**
 * Unit tests for auth redirect resolution and its open-redirect defence.
 *
 * The allowlist expectations mirror what production actually accepts, probed
 * against project xwlwqzzphmmhghiqvkeu: `bountyexpo-workspace://auth/callback`
 * and `https://bountyfinder.app/auth/callback` are allowlisted, the stale
 * `bountyexpo://` scheme is not, and an unlisted host silently falls back to the
 * project Site URL instead of erroring — which is exactly why a bad value here
 * has to be caught client-side rather than relied on to fail loudly.
 */

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;

function loadModule(platformOS: string = 'ios') {
  let mod: typeof import('../../../lib/auth/auth-redirect');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: platformOS } }));
    mod = require('../../../lib/auth/auth-redirect');
  });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return mod!;
}

describe('isAllowedAuthRedirect', () => {
  const { isAllowedAuthRedirect } = loadModule();

  it.each([
    'bountyexpo-workspace://auth/callback',
    'bountyexpo-workspace://auth',
    'https://bountyfinder.app/auth/callback',
    'https://bountyfinder.app/auth/update-password',
    'exp://192.168.1.10:8081/--/auth/callback',
    'http://localhost:8081/auth/callback',
  ])('accepts %s', url => {
    expect(isAllowedAuthRedirect(url)).toBe(true);
  });

  it.each([
    ['an unrelated host', 'https://evil.example.com/steal'],
    ['a lookalike suffix host', 'https://bountyfinder.app.evil.com/auth/callback'],
    ['a userinfo-smuggled host', 'https://bountyfinder.app@evil.com/auth/callback'],
    ['the stale app scheme', 'bountyexpo://auth/callback'],
    ['plain http on the real domain', 'http://bountyfinder.app/auth/callback'],
    ['a backslash-obfuscated host', 'https://bountyfinder.app\\@evil.com'],
    ['a scheme-relative url', '//evil.example.com/auth/callback'],
    ['a bare path', '/auth/callback'],
    ['a javascript url', 'javascript:alert(1)'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedAuthRedirect(url)).toBe(false);
  });

  it('rejects a redirect that already carries a fragment', () => {
    // Supabase appends session tokens to the fragment of whatever it is given,
    // so a pre-existing one would corrupt the callback it produces.
    expect(isAllowedAuthRedirect('https://bountyfinder.app/auth/callback#a=1')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isAllowedAuthRedirect(null)).toBe(false);
    expect(isAllowedAuthRedirect(undefined)).toBe(false);
  });

  it('is case-insensitive about scheme and host', () => {
    expect(isAllowedAuthRedirect('HTTPS://BountyFinder.app/auth/callback')).toBe(true);
  });
});

describe('getAuthCallbackUrl', () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;
    else process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('defaults to the native custom scheme on ios and android', () => {
    delete process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;
    expect(loadModule('ios').getAuthCallbackUrl()).toBe('bountyexpo-workspace://auth/callback');
    expect(loadModule('android').getAuthCallbackUrl()).toBe('bountyexpo-workspace://auth/callback');
  });

  it('honours an allowlisted env override', () => {
    process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL = 'https://bountyfinder.app/auth/callback';
    expect(loadModule('ios').getAuthCallbackUrl()).toBe('https://bountyfinder.app/auth/callback');
  });

  it('ignores a disallowed env override and warns instead of mailing it out', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL = 'https://evil.example.com/steal';

    expect(loadModule('ios').getAuthCallbackUrl()).toBe('bountyexpo-workspace://auth/callback');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring EXPO_PUBLIC_AUTH_REDIRECT_URL'));
  });

  it('returns every result already allowlisted', () => {
    delete process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;
    const mod = loadModule('ios');
    expect(mod.isAllowedAuthRedirect(mod.getAuthCallbackUrl())).toBe(true);
  });
});
