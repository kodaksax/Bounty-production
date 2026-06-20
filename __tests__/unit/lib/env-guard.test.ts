/**
 * Unit tests for lib/config/env-guard.ts → checkEnvironmentIntegrity
 *
 * Covers the three critical safety scenarios required by the code review:
 *  (1) Matching channel + URL passes → real client may be initialized
 *  (2) Mismatch blocks → ok: false, preventing cross-environment data leakage
 *  (3) Unknown or absent channel does NOT block → Expo Go / local dev sessions work
 *
 * These tests pin the guard logic so regressions that would re-introduce
 * cross-environment data leakage (e.g., production balances visible in dev) are
 * caught immediately.
 */

// Mock expo-updates so each test can control the channel value.
// The factory returns a plain object; we redefine `channel` per-test via
// Object.defineProperty because Jest wraps module exports in a namespace
// object where named exports are non-writable by default.
jest.mock('expo-updates', () => ({ channel: null }));

import {
    checkEnvironmentIntegrity,
    getBuildChannel,
    projectRefFromUrl,
} from '../../../lib/config/env-guard';
import supabaseRefs from '../../../lib/config/supabase-refs.json';

/** Helper to set the mocked channel between tests. */
function setChannel(ch: string | null | undefined) {
  Object.defineProperty(jest.requireMock('expo-updates'), 'channel', {
    value: ch ?? null,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// projectRefFromUrl — building block used by the guard
// ---------------------------------------------------------------------------
describe('projectRefFromUrl', () => {
  it('extracts the subdomain ref from a valid Supabase URL', () => {
    expect(projectRefFromUrl('https://xwlwqzzphmmhghiqvkeu.supabase.co')).toBe(
      'xwlwqzzphmmhghiqvkeu'
    );
  });

  it('works when the URL global is unavailable (Hermes environments)', () => {
    // Simulate environments where URL is not defined
    const saved = (globalThis as any).URL;
    delete (globalThis as any).URL;
    try {
      expect(projectRefFromUrl('https://xwlwqzzphmmhghiqvkeu.supabase.co')).toBe(
        'xwlwqzzphmmhghiqvkeu'
      );
    } finally {
      (globalThis as any).URL = saved;
    }
  });

  it('returns null for a null input', () => {
    expect(projectRefFromUrl(null)).toBeNull();
  });

  it('returns null for an undefined input', () => {
    expect(projectRefFromUrl(undefined)).toBeNull();
  });

  it('returns null for a malformed / non-URL string', () => {
    expect(projectRefFromUrl('not-a-url')).toBeNull();
  });

  it('returns null for a bare hostname without a protocol', () => {
    expect(projectRefFromUrl('xwlwqzzphmmhghiqvkeu.supabase.co')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(projectRefFromUrl('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getBuildChannel — reads the immutable channel from expo-updates
// ---------------------------------------------------------------------------
describe('getBuildChannel', () => {
  afterEach(() => setChannel(null));

  it('returns the channel string when set', () => {
    setChannel('production');
    expect(getBuildChannel()).toBe('production');
  });

  it('returns null when channel is null', () => {
    setChannel(null);
    expect(getBuildChannel()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkEnvironmentIntegrity — three required safety scenarios
// ---------------------------------------------------------------------------
describe('checkEnvironmentIntegrity', () => {
  afterEach(() => setChannel(null));

  // -------------------------------------------------------------------------
  // Scenario 1: Matching channel + URL → must pass (ok: true)
  // -------------------------------------------------------------------------
  describe('(1) matching channel and URL — passes through', () => {
    it.each(Object.entries(supabaseRefs.byChannel))(
      'passes for channel "%s" pointing at its expected ref',
      (channel, ref) => {
        setChannel(channel);
        const result = checkEnvironmentIntegrity(`https://${ref}.supabase.co`);

        expect(result.ok).toBe(true);
        expect(result.channel).toBe(channel);
        expect(result.expectedRef).toBe(ref);
        expect(result.actualRef).toBe(ref);
        expect(result.reason).toBeUndefined();
      }
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Mismatch → must block (ok: false)
  // -------------------------------------------------------------------------
  describe('(2) mismatched channel and URL — blocks with ok: false', () => {
    it('blocks when production channel points at the development project', () => {
      setChannel('production');
      const devRef = supabaseRefs.byChannel['development'];
      const result = checkEnvironmentIntegrity(`https://${devRef}.supabase.co`);

      expect(result.ok).toBe(false);
      expect(result.channel).toBe('production');
      expect(result.expectedRef).toBe(supabaseRefs.byChannel['production']);
      expect(result.actualRef).toBe(devRef);
      expect(result.reason).toMatch(/production/);
    });

    it('blocks when development channel points at the production project', () => {
      setChannel('development');
      const prodRef = supabaseRefs.byChannel['production'];
      const result = checkEnvironmentIntegrity(`https://${prodRef}.supabase.co`);

      expect(result.ok).toBe(false);
      expect(result.channel).toBe('development');
      expect(result.expectedRef).toBe(supabaseRefs.byChannel['development']);
      expect(result.actualRef).toBe(prodRef);
    });

    it('blocks when the staging channel points at the production project', () => {
      setChannel('staging');
      const prodRef = supabaseRefs.byChannel['production'];
      const result = checkEnvironmentIntegrity(`https://${prodRef}.supabase.co`);

      expect(result.ok).toBe(false);
      expect(result.expectedRef).toBe(supabaseRefs.byChannel['staging']);
    });

    it('blocks (with descriptive reason) when URL is null for a known channel', () => {
      setChannel('production');
      const result = checkEnvironmentIntegrity(null);

      expect(result.ok).toBe(false);
      expect(result.actualRef).toBeNull();
      expect(result.reason).toMatch(/missing or could not be parsed/);
    });

    it('blocks when URL is an unparseable string for a known channel', () => {
      setChannel('production');
      const result = checkEnvironmentIntegrity('not-a-url');

      expect(result.ok).toBe(false);
      expect(result.actualRef).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Unknown or absent channel → must NOT block
  // -------------------------------------------------------------------------
  describe('(3) unknown or absent channel — does not block', () => {
    it('passes when there is no channel (Expo Go / local dev bundle)', () => {
      setChannel(null);
      const result = checkEnvironmentIntegrity(
        `https://${supabaseRefs.byChannel['production']}.supabase.co`
      );

      expect(result.ok).toBe(true);
      expect(result.channel).toBeNull();
    });

    it('passes when the channel is not in the known mapping', () => {
      setChannel('nightly-ci');
      const result = checkEnvironmentIntegrity('https://anything.supabase.co');

      expect(result.ok).toBe(true);
      expect(result.expectedRef).toBeNull();
    });

    it('passes when channel is an empty string (treated as absent)', () => {
      setChannel('');
      const result = checkEnvironmentIntegrity('https://anything.supabase.co');

      // Empty string is falsy — treated the same as no channel.
      expect(result.ok).toBe(true);
    });

    it('passes for an unknown channel even when URL is also unexpected', () => {
      setChannel('feature-branch');
      const result = checkEnvironmentIntegrity('https://someotherref.supabase.co');

      expect(result.ok).toBe(true);
    });
  });
});
