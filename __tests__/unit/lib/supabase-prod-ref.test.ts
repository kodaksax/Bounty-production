/**
 * Regression tests: production Supabase environment integrity
 * ---------------------------------------------------------------------------
 * Pins the invariants that broke in production, where an OTA bundle shipped the
 * WRONG (development) Supabase project ref and the app hung on getSession() then
 * fell back to signed-out.
 *
 * NOTE ON THE DEV REF: `ajsbkocnixpwbrjokvnq` is the *legitimate* development
 * project ref (see lib/config/supabase-refs.json). It MUST exist in the tree so
 * the development env-guard mapping works. A blanket repo-wide ban would be
 * wrong. Instead these tests assert the dev ref never appears where it would
 * poison a PRODUCTION build/OTA, and that client init has no hardcoded URL
 * fallback that could reintroduce a stale ref.
 */
import * as fs from 'fs';
import * as path from 'path';

import supabaseRefs from '../../../lib/config/supabase-refs.json';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PROD_REF = 'xwlwqzzphmmhghiqvkeu';
const DEV_REF = 'ajsbkocnixpwbrjokvnq';

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('production Supabase URL / project ref', () => {
  test('production Supabase URL points at the correct project and has no fallback', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://xwlwqzzphmmhghiqvkeu.supabase.co';
    const ref = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).host.split('.')[0];
    expect(ref).toBe('xwlwqzzphmmhghiqvkeu');
  });

  test('supabase-refs.json maps the production channel/env to the correct ref', () => {
    expect(supabaseRefs.byChannel.production).toBe(PROD_REF);
    expect(supabaseRefs.byAppEnv.production).toBe(PROD_REF);
    // The dev ref must never be the production mapping.
    expect(supabaseRefs.byChannel.production).not.toBe(DEV_REF);
    expect(supabaseRefs.byAppEnv.production).not.toBe(DEV_REF);
  });
});

describe('no hardcoded / fallback Supabase config in client init', () => {
  const clientInitFiles = ['lib/supabase.ts', 'lib/config.ts'];

  test.each(clientInitFiles)(
    '%s contains no hardcoded *.supabase.co URL',
    (relPath) => {
      const src = read(relPath);
      // Catch any literal "<something>.supabase.co" host baked into source.
      expect(src).not.toMatch(/[a-z0-9-]+\.supabase\.co/i);
    }
  );

  test.each(clientInitFiles)(
    '%s has no "?? https://…supabase" / "|| https://…supabase" URL fallback',
    (relPath) => {
      const src = read(relPath);
      // Flag a hardcoded Supabase endpoint used as a fallback default. (A benign
      // `|| 'http://localhost'` display default in the inert stub is not a
      // Supabase config fallback and must not trip this guard.)
      expect(src).not.toMatch(/(\?\?|\|\|)\s*['"`]https?:\/\/[^'"`]*supabase/i);
    }
  );

  test('client reads Supabase URL/key strictly from centralized env config', () => {
    const src = read('lib/supabase.ts');
    expect(src).toContain('config.supabase.url');
    expect(src).toContain('config.supabase.anonKey');
  });
});

describe('development ref cannot poison a production build/OTA', () => {
  test('app.json extra does not bake in any Supabase URL/ref', () => {
    const src = read('app.json');
    expect(src).not.toContain(DEV_REF);
    expect(src).not.toMatch(/supabase\.co/i);
  });

  test('eas.json production profile does not hardcode the dev ref', () => {
    const easJson = JSON.parse(read('eas.json'));
    const prodEnv = JSON.stringify(easJson.build?.production?.env ?? {});
    expect(prodEnv).not.toContain(DEV_REF);
    // Production must be pinned to the production channel so the runtime guard
    // can validate the bundle it receives over OTA.
    expect(easJson.build?.production?.channel).toBe('production');
    expect(easJson.build?.production?.env?.APP_ENV).toBe('production');
  });

  test('committed .env.production* files (if any) never contain the dev ref', () => {
    const candidates = [
      '.env.production',
      '.env.production.local',
      '.env.production.example',
    ];
    for (const rel of candidates) {
      const full = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(full)) continue;
      const src = fs.readFileSync(full, 'utf8');
      expect(src).not.toContain(DEV_REF);
    }
  });
});
