/**
 * Unit tests for auth callback link parsing.
 *
 * The fixtures here are the real shapes production emits. The two 303 Location
 * headers were captured directly from
 * `GET https://xwlwqzzphmmhghiqvkeu.supabase.co/auth/v1/verify?...`, which is
 * why the credentials live in the fragment rather than the query string — the
 * bug these tests lock down is that nothing used to read the fragment at all.
 */

import {
  isRecoveryLink,
  parseAuthLink,
  parseParamString,
  redactAuthUrl,
  splitAuthUrl,
} from '../../../lib/auth/recovery-link';

// Real production redirect shapes.
const VALID_RECOVERY_LINK =
  'https://bountyfinder.app/auth/callback#access_token=eyJhbGciOiJIUzI1NiJ9.aaa.bbb' +
  '&expires_at=1786000000&expires_in=3600&refresh_token=v1xyz789&token_type=bearer&type=recovery';

const EXPIRED_RECOVERY_LINK =
  'https://bountyfinder.app/auth/callback#error=access_denied&error_code=otp_expired' +
  '&error_description=Email+link+is+invalid+or+has+expired&sb=';

const NATIVE_RECOVERY_LINK =
  'bountyexpo-workspace://auth/callback#access_token=eyJhbGciOiJIUzI1NiJ9.aaa.bbb' +
  '&refresh_token=v1xyz789&token_type=bearer&type=recovery';

describe('splitAuthUrl', () => {
  it('separates query from fragment', () => {
    expect(splitAuthUrl('https://x.test/cb?a=1#b=2')).toEqual({ query: 'a=1', fragment: 'b=2' });
  });

  it('handles a fragment that itself contains a question mark', () => {
    // A `?` after the `#` belongs to the fragment, not the query.
    expect(splitAuthUrl('https://x.test/cb#a=1?b=2')).toEqual({ query: '', fragment: 'a=1?b=2' });
  });

  it('handles custom schemes that URL() mishandles under Hermes', () => {
    expect(splitAuthUrl('bountyexpo-workspace://auth/callback#t=1')).toEqual({
      query: '',
      fragment: 't=1',
    });
  });

  it('returns empty bags for a bare URL and for an empty string', () => {
    expect(splitAuthUrl('https://x.test/cb')).toEqual({ query: '', fragment: '' });
    expect(splitAuthUrl('')).toEqual({ query: '', fragment: '' });
  });
});

describe('parseParamString', () => {
  it('decodes percent escapes and form-encoded spaces', () => {
    expect(parseParamString('error_description=Email+link+is+invalid%20or+expired')).toEqual({
      error_description: 'Email link is invalid or expired',
    });
  });

  it('keeps the first value when a key repeats', () => {
    // Defends against an attacker appending &access_token=… to a real link.
    expect(parseParamString('access_token=real&access_token=injected')).toEqual({
      access_token: 'real',
    });
  });

  it('tolerates a leading delimiter, empty pairs and valueless keys', () => {
    expect(parseParamString('#a=1&&b=&c')).toEqual({ a: '1', b: '', c: '' });
  });

  it('does not throw on malformed percent escapes', () => {
    expect(() => parseParamString('a=100%')).not.toThrow();
    expect(parseParamString('a=100%')).toEqual({ a: '100%' });
  });

  it('is immune to prototype pollution via a __proto__ key', () => {
    const result = parseParamString('__proto__=polluted&a=1');
    expect(result.a).toBe('1');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('parseAuthLink', () => {
  describe('valid recovery links', () => {
    it('reads implicit-flow tokens out of the fragment (web universal link)', () => {
      expect(parseAuthLink(VALID_RECOVERY_LINK)).toEqual({
        kind: 'tokens',
        accessToken: 'eyJhbGciOiJIUzI1NiJ9.aaa.bbb',
        refreshToken: 'v1xyz789',
        type: 'recovery',
      });
    });

    it('reads the same tokens from a native custom-scheme link', () => {
      const link = parseAuthLink(NATIVE_RECOVERY_LINK);
      expect(link.kind).toBe('tokens');
      expect(isRecoveryLink(link)).toBe(true);
    });

    it('reads a token_hash query link', () => {
      expect(
        parseAuthLink('bountyexpo-workspace://auth/callback?token_hash=pkce_abc&type=recovery')
      ).toEqual({ kind: 'token_hash', tokenHash: 'pkce_abc', type: 'recovery' });
    });

    it('accepts `token` as an alias for token_hash and defaults its type', () => {
      expect(parseAuthLink('https://bountyfinder.app/auth/callback?token=abc')).toEqual({
        kind: 'token_hash',
        tokenHash: 'abc',
        type: 'recovery',
      });
    });

    it('reads a PKCE code link', () => {
      expect(
        parseAuthLink('https://bountyfinder.app/auth/callback?code=xyz&type=recovery')
      ).toEqual({ kind: 'code', code: 'xyz', type: 'recovery' });
    });
  });

  describe('expo-router transports', () => {
    it("expands the reserved '#' param expo-router exposes on web", () => {
      const routerParams = {
        '#': 'access_token=at1&refresh_token=rt1&type=recovery',
      };
      expect(parseAuthLink(null, routerParams)).toEqual({
        kind: 'tokens',
        accessToken: 'at1',
        refreshToken: 'rt1',
        type: 'recovery',
      });
    });

    it("expands a '#' param that app/auth/index.tsx forwarded as a query value", () => {
      // /auth → /auth/callback?%23=access_token%3D…
      const url =
        'bountyexpo-workspace://auth/callback?%23=access_token%3Dat2%26refresh_token%3Drt2%26type%3Drecovery';
      expect(parseAuthLink(url)).toEqual({
        kind: 'tokens',
        accessToken: 'at2',
        refreshToken: 'rt2',
        type: 'recovery',
      });
    });

    it('flattens array-valued router params and ignores empty ones', () => {
      expect(parseAuthLink(null, { token_hash: ['h1', 'h2'], type: ['recovery'], extra: '' })).toEqual(
        { kind: 'token_hash', tokenHash: 'h1', type: 'recovery' }
      );
    });

    it('prefers the raw URL over router params when both carry material', () => {
      // The raw URL is the untampered source; router params are reconstructed.
      const link = parseAuthLink(NATIVE_RECOVERY_LINK, { access_token: 'stale', refresh_token: 'stale' });
      expect(link).toMatchObject({ kind: 'tokens', accessToken: 'eyJhbGciOiJIUzI1NiJ9.aaa.bbb' });
    });

    it('skips null and undefined sources', () => {
      expect(parseAuthLink(null, undefined, VALID_RECOVERY_LINK)).toMatchObject({ kind: 'tokens' });
    });
  });

  describe('failed links', () => {
    it('classifies the production expired-link redirect', () => {
      expect(parseAuthLink(EXPIRED_RECOVERY_LINK)).toEqual({
        kind: 'error',
        code: 'expired',
        type: null,
      });
    });

    it('classifies a reused link as expired (Supabase reports both identically)', () => {
      expect(
        parseAuthLink('https://bountyfinder.app/auth/callback#error_code=otp_expired&type=recovery')
      ).toEqual({ kind: 'error', code: 'expired', type: 'recovery' });
    });

    it('classifies a bare access_denied as invalid', () => {
      expect(parseAuthLink('https://bountyfinder.app/auth/callback#error=access_denied')).toEqual({
        kind: 'error',
        code: 'invalid',
        type: null,
      });
    });

    it('classifies an unrecognised error as unknown rather than guessing', () => {
      expect(
        parseAuthLink('https://bountyfinder.app/auth/callback#error=server_error')
      ).toEqual({ kind: 'error', code: 'unknown', type: null });
    });

    it('reports an error over any credentials present alongside it', () => {
      const link = parseAuthLink(
        'https://bountyfinder.app/auth/callback#error_code=otp_expired&access_token=a&refresh_token=b'
      );
      expect(link).toMatchObject({ kind: 'error', code: 'expired' });
    });

    it('treats an access_token with no refresh_token as invalid, not usable', () => {
      // Half a token pair cannot seed a durable session.
      expect(
        parseAuthLink('https://bountyfinder.app/auth/callback#access_token=lonely&type=recovery')
      ).toEqual({ kind: 'error', code: 'invalid', type: 'recovery' });
    });

    it('treats a type-only link as invalid rather than absent', () => {
      expect(parseAuthLink('https://bountyfinder.app/auth/callback#type=recovery')).toEqual({
        kind: 'error',
        code: 'invalid',
        type: 'recovery',
      });
    });
  });

  describe('links with nothing in them', () => {
    it.each([
      ['no params at all', 'bountyexpo-workspace://auth/callback'],
      ['an unrelated param', 'bountyexpo-workspace://auth/callback?utm_source=email'],
      ['an empty string', ''],
    ])('reports none for %s', (_label, url) => {
      expect(parseAuthLink(url)).toEqual({ kind: 'none' });
    });

    it('reports none when called with no sources', () => {
      expect(parseAuthLink()).toEqual({ kind: 'none' });
    });

    it('ignores an unknown type value rather than trusting it', () => {
      const link = parseAuthLink(
        'https://bountyfinder.app/auth/callback#access_token=a&refresh_token=b&type=totally-made-up'
      );
      expect(link).toEqual({ kind: 'tokens', accessToken: 'a', refreshToken: 'b', type: null });
    });
  });
});

describe('isRecoveryLink', () => {
  it('is true only for recovery-typed credential links', () => {
    expect(isRecoveryLink(parseAuthLink(VALID_RECOVERY_LINK))).toBe(true);
    expect(
      isRecoveryLink(parseAuthLink('https://x.test/cb?token_hash=h&type=recovery'))
    ).toBe(true);
  });

  it('is false for other flows and for failures', () => {
    expect(
      isRecoveryLink(parseAuthLink('https://x.test/cb#access_token=a&refresh_token=b&type=signup'))
    ).toBe(false);
    expect(isRecoveryLink(parseAuthLink(EXPIRED_RECOVERY_LINK))).toBe(false);
    expect(isRecoveryLink(parseAuthLink(''))).toBe(false);
  });
});

describe('redactAuthUrl', () => {
  it('keeps the shape and removes every credential value', () => {
    const redacted = redactAuthUrl(VALID_RECOVERY_LINK);

    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redacted).not.toContain('v1xyz789');
    expect(redacted).toContain('access_token=<redacted>');
    expect(redacted).toContain('refresh_token=<redacted>');
    // Non-sensitive keys survive as bare names, which is what makes a log useful.
    expect(redacted).toContain('type');
    expect(redacted).toContain('https://bountyfinder.app/auth/callback');
  });

  it('redacts token_hash and code as well', () => {
    const redacted = redactAuthUrl('https://x.test/cb?token_hash=secret1&code=secret2');
    expect(redacted).not.toContain('secret1');
    expect(redacted).not.toContain('secret2');
  });

  it('handles a missing url', () => {
    expect(redactAuthUrl(null)).toBe('<none>');
    expect(redactAuthUrl(undefined)).toBe('<none>');
  });

  it('leaves an error redirect readable for diagnosis', () => {
    expect(redactAuthUrl(EXPIRED_RECOVERY_LINK)).toContain('error_code');
  });
});
