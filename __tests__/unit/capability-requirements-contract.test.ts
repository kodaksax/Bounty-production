import { readFileSync } from 'fs';
import { join } from 'path';
import { validateRequirements, requirementsFingerprint } from '../../lib/capabilities';
import { HUNTER_CAPABILITIES_ENABLED } from '../../lib/feature-flags';

const payload = { taxonomy_version: 1, task_id: 'organize_items', terms: [{ term_id: 'organization', importance: 'required' }] };
const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261014231000_capability_requirements.sql'), 'utf8');

describe('ordinary requirements validation', () => {
  it('defaults rollout off and accepts omission-compatible clear and ordinary terms', () => {
    expect(HUNTER_CAPABILITIES_ENABLED).toBe(false);
    expect(() => validateRequirements(null)).not.toThrow();
    expect(() => validateRequirements(payload)).not.toThrow();
    expect(() => validateRequirements({ taxonomy_version: 1, task_id: 'organize_items', terms: [] })).not.toThrow();
  });
  it('treats declaration order as non-material for retry deduplication', () => {
    const terms = [
      { term_id: 'organization', importance: 'required' as const },
      { term_id: 'storage_bins', importance: 'preferred' as const },
    ];
    expect(requirementsFingerprint({ taxonomy_version: 1, task_id: 'organize_items', terms })).toEqual(
      requirementsFingerprint({ taxonomy_version: 1, task_id: 'organize_items', terms: [...terms].reverse() }));
  });
  it.each([
    { ...payload, verified: true },
    { ...payload, version: 1 },
    { ...payload, provenance: 'verified' },
    { ...payload, taxonomy_version: undefined },
    { ...payload, taxonomy_version: '1' },
    { ...payload, taxonomy_version: 1.5 },
    { ...payload, taxonomy_version: -1 },
    { ...payload, terms: [payload.terms[0], payload.terms[0]] },
    { ...payload, terms: [{ term_id: 'organization', importance: 'verified' }] },
    { ...payload, terms: [{ ...payload.terms[0], evidence: 'private' }] },
    { ...payload, terms: [{ ...payload.terms[0], term_id: 1 }] },
    { ...payload, task_id: 'x'.repeat(65) },
    { ...payload, terms: Array(13).fill(payload.terms[0]) },
    { ...payload, terms: null },
    [],
    undefined,
  ])('rejects unexpected claims, malformed shapes and duplicates: %p', invalid => {
    expect(() => validateRequirements(invalid)).toThrow();
  });
});

describe('migration security/transaction contract (static, no database execution)', () => {
  it('wires the summary into both active public detail surfaces', () => {
    for (const path of ['app/bounty/[id]/public.tsx', 'components/bountydetailmodal.tsx']) {
      const source = readFileSync(join(__dirname, '../..', path), 'utf8');
      expect(source).toContain('<BountyRequirementsSummary value={bounty.requirements_payload} />');
    }
  });
  it('has normalized version/scope/task/term foreign keys and explicit provenance', () => {
    expect(sql).toContain("CHECK (scope = 'ordinary')");
    expect(sql).toContain("CHECK (provenance = 'self_reported')");
    expect(sql).toContain("CHECK (provenance = 'poster_declared')");
    expect(sql).toContain('REFERENCES public.capability_task_terms(taxonomy_version,task_id,term_id)');
    expect(sql).toContain('AND category = NEW.category AND active');
    expect(sql).toContain('AND t.active AND s.active');
    expect(sql).toContain("k NOT IN ('task_id','term_id','proficiency','experience')");
    expect(sql).toContain("k NOT IN ('taxonomy_version','task_id','terms')");
    expect(sql).toContain("k NOT IN ('term_id','importance')");
    expect(sql).toContain('duplicate_capability');
    expect(sql).toContain('duplicate_requirement');
  });
  it('exposes only self-authenticated declaration RPCs and owner-only reads', () => {
    expect(sql).toContain('USING (owner_id = auth.uid())');
    expect(sql).toContain("IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'");
    expect(sql).toContain('DELETE FROM public.hunter_capabilities WHERE owner_id = auth.uid()');
    expect(sql).toContain('PERFORM public.assert_account_active(auth.uid())');
    expect(sql.indexOf('WHERE id = auth.uid() FOR UPDATE')).toBeLessThan(sql.indexOf('PERFORM public.assert_account_active(auth.uid())'));
    expect(sql).not.toContain('p_owner');
    expect(sql).not.toMatch(/GRANT (?:INSERT|UPDATE|ALL).*TO authenticated/);
    for (const table of ['capability_taxonomy_versions', 'capability_tasks', 'capability_terms',
      'capability_task_terms', 'hunter_capabilities', 'bounty_requirements', 'bounty_requirement_locks']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });
  it('projects in the insert transaction before notification triggers without changing funding', () => {
    expect(sql).toContain('a00_validate_bounty_requirements BEFORE INSERT OR UPDATE ON public.bounties');
    expect(sql).toContain('a00_project_bounty_requirements AFTER INSERT OR UPDATE ON public.bounties');
    expect(sql).toContain('INSERT INTO public.bounty_requirements');
    expect(sql).toContain('requirements_metadata_server_controlled');
    expect(sql).not.toContain('fn_reserve_escrow_for_acceptance');
    expect(sql).not.toContain('apply_escrow');
  });
  it('serializes applications on the bounty row and durably freezes after withdrawn/rejected applications', () => {
    expect(sql).toContain('WHERE id = NEW.bounty_id FOR UPDATE');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF bounty_id ON public.bounty_requests');
    expect(sql).toContain('EXISTS (SELECT 1 FROM public.bounty_requests WHERE bounty_id = OLD.id)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM public.bounty_requirement_locks WHERE bounty_id = OLD.id)');
    expect(sql).toContain('OLD.accepted_by IS NOT NULL OR NEW.accepted_by IS NOT NULL');
    expect(sql).toContain('requirements_frozen_after_application');
    expect(sql).toContain('requirements_owner_only');
    expect(sql).toContain('IF NOT v_changed THEN RETURN NEW');
  });
  it('canonicalizes before freezing, separates taxonomy/revision, and stamps server-controlled audit confirmations', () => {
    expect(sql.indexOf("p := jsonb_set(p,'{terms}'")).toBeLessThan(sql.indexOf('v_changed :='));
    expect(sql.indexOf('v_changed :=')).toBeLessThan(sql.indexOf("RAISE EXCEPTION 'requirements_frozen_after_application'"));
    expect(sql).toContain('ADD COLUMN requirements_taxonomy_version integer REFERENCES');
    expect(sql).toContain('ADD COLUMN requirements_revision bigint NOT NULL DEFAULT 0');
    expect(sql).toContain('NEW.requirements_revision := OLD.requirements_revision + 1');
    expect(sql).toContain('NEW.requirements_confirmed_at := statement_timestamp()');
    expect(sql).toContain('NEW.requirements_revision IS DISTINCT FROM OLD.requirements_revision');
    expect(sql).toContain('NEW.requirements_confirmed_at IS DISTINCT FROM OLD.requirements_confirmed_at');
    expect(sql).toContain("IF (p->>'taxonomy_version')::integer <> v_version");
    expect(sql).toContain('IF p_taxonomy_version IS NULL OR p_taxonomy_version <> v_version');
    expect(sql).toContain('taxonomy_version_changed');
    expect(sql).toContain("WHERE active AND scope = 'ordinary' FOR SHARE");
  });
});
