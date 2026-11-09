/**
 * Static contracts for the local-proof backend. The RPC's behaviour is tested
 * on a real Postgres by scripts/verify-poster-local-proof-pglite.mjs.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/utils/data-utils', () => ({}), { virtual: true });

import { LOCAL_PROOF_MIN } from '../../lib/services/bounty-location-service';
import { countryFromCfHeader } from '../../supabase/functions/_shared/ip-country';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const migration = read('supabase/migrations/20261108120000_poster_local_proof.sql');

describe('fn_poster_local_proof', () => {
  it('suppresses at the same minimum the app uses', () => {
    expect(LOCAL_PROOF_MIN).toBe(3);
    expect(migration).toMatch(new RegExp(`v_min_count CONSTANT integer := ${LOCAL_PROOF_MIN};`));
  });

  it('is closed to anon', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.fn_poster_local_proof\([^)]*\) FROM anon;/);
  });
});

describe('countryFromCfHeader', () => {
  it.each([
    ['US', 'US'],
    ['mx', 'MX'],
    [' NG ', 'NG'],
  ])('%s is %s', (header, country) => {
    expect(countryFromCfHeader(header)).toBe(country);
  });

  it.each([null, undefined, '', 'XX', 'T1', 'USA'])('%s is no country', header => {
    expect(countryFromCfHeader(header)).toBeNull();
  });
});

describe('the geo-country function stays undeployed', () => {
  it('lives in a folder CI skips', () => {
    expect(fs.existsSync(path.join(__dirname, '../../supabase/functions/_geo-country/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../supabase/functions/geo-country'))).toBe(false);
  });

  it('CI still excludes underscore folders', () => {
    const workflow = read('.github/workflows/deploy-edge-functions.yml');
    expect(workflow).toContain("grep -v '^_'");
    expect(workflow).toContain("grep -E '^supabase/functions/[^_/][^/]*/'");
    expect(workflow).toContain("grep -v '^supabase/functions/_'");
  });
});
