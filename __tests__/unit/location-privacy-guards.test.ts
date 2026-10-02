import fs from 'fs';
import path from 'path';

// Static guards for the location privacy fix (Trust Spine audit T3/S3).
// The behaviour itself is proven by scripts/verify-location-privacy.js
// (database) and scripts/e2e-location-privacy-http.js (API); these keep the
// pieces from being quietly undone in later edits.

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATION = read('supabase/migrations/20261001160000_bounty_location_privacy.sql');

describe('location privacy migration', () => {
  it('keeps get_bounty_exact_location signature and return shape (installed builds call it)', () => {
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_bounty_exact_location\(p_bounty_id uuid\)\s+RETURNS TABLE\(location text, latitude double precision, longitude double precision, unit text\)/,
    );
  });

  it('never grants the exact-location RPC or private tables to anon', () => {
    expect(MIGRATION).toContain('REVOKE ALL ON FUNCTION public.get_bounty_exact_location(uuid) FROM PUBLIC, anon;');
    for (const t of ['bounty_private_locations', 'bounty_location_backfill_snapshot', 'location_privacy_rollback_defs']) {
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(MIGRATION).not.toMatch(new RegExp(`GRANT [A-Z, ]+ ON public\\.${t} TO [a-z_, ]*(anon|authenticated)`));
    }
  });

  it('only grants the accepted hunter while the job is live', () => {
    expect(MIGRATION).toContain("v_status IN ('in_progress', 'cancellation_requested', 'disputed')");
  });

  it('privatizes on every write and stores via the AFTER INSERT half', () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER zz_bounties_privatize_location\s+BEFORE INSERT OR UPDATE ON public\.bounties/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER zz_bounties_store_private_location\s+AFTER INSERT ON public\.bounties/);
  });

  it('has a rollback script', () => {
    expect(fs.existsSync(path.join(ROOT, 'supabase/rollbacks/production/20261001160000_bounty_location_privacy.down.sql'))).toBe(true);
  });
});

describe('client surfaces never render the raw bounties.location', () => {
  // Each of these used to print `bounty.location` (an exact street address)
  // to anyone browsing. They must go through formatPublicLocation() or the
  // access-checked exact-location hook.
  const surfaces = [
    'components/bounty-card.tsx',
    'components/bountydetailmodal.tsx',
    'app/bounty/[id]/public.tsx',
    'components/profile-bounty-history-section.tsx',
    'components/bounty-grid-feed.tsx',
    'components/bounty-feed.tsx',
    'app/in-progress/[bountyId]/hunter/work-in-progress.tsx',
    'app/postings/[bountyId]/index.tsx',
  ];

  it('app/tabs/search.tsx formats rows once in mapBounty (item.location is pre-formatted)', () => {
    expect(read('app/tabs/search.tsx')).toContain('location: formatPublicLocation(b) ?? undefined,');
  });

  it.each(surfaces)('%s', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\{\s*(bounty|item|b|left|right)\.location\s*\}/);
    expect(src).not.toMatch(/location=\{\s*(bounty|item|b|left|right)\.location\s*\}/);
    expect(src).not.toMatch(/location:\s*\(?(b as any)?\)?\.location,/);
  });
});
