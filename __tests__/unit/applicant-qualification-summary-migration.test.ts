import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20261016210000_applicant_qualification_summary.sql'),
  'utf8',
);

describe('applicant qualification summary RPC', () => {
  it('is bounded and exposes results only to an active bounty owner', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toContain('PERFORM public.assert_account_active(auth.uid())');
    expect(sql).toContain('COALESCE(b.poster_id, b.user_id) = auth.uid()');
    expect(sql).toContain('cardinality(p_bounty_ids) > 200');
    expect(sql).toContain('cardinality(p_hunter_ids) > 200');
    expect(sql).toContain("r.status IN ('pending', 'accepted')");
    expect(sql).toContain('TO authenticated');
    expect(sql).toContain('FROM PUBLIC, anon');
  });

  it('returns only exact self-reported matches and missing required labels', () => {
    expect(sql).toContain("capability.provenance = 'self_reported'");
    expect(sql).toContain("'provenance', 'self_reported'");
    expect(sql).toContain("importance = 'required' AND NOT declared");
    expect(sql).toContain('capability.task_id = req.task_id');
    expect(sql).toContain('capability.taxonomy_version = req.taxonomy_version');
    expect(sql).not.toContain('GRANT SELECT ON public.hunter_capabilities');
  });
});
