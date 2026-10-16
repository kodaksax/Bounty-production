import manifest from '../../supabase/security/rls-manifest.json';
import { analyze } from '../../scripts/rls-policy-check/rules';

describe('qualification security manifest', () => {
  const protectedTables = manifest.protected as Record<string, {
    grants?: { anon: string[]; authenticated: string[] };
    policies?: { policyname: string; cmd: string; roles: string[]; qual: string | null }[];
    required_triggers?: string[];
    commands?: string[];
  }>;

  it.each([
    'bounty_targeting_config',
    'bounty_targeting_dispatches',
    'bounty_targeting_deliveries',
    'bounty_hunter_notifications',
    'bounty_requirement_locks',
  ])('keeps internal %s inaccessible to clients', (table) => {
    expect(protectedTables[table].grants).toEqual({ anon: [], authenticated: [] });
    expect(protectedTables[table].policies).toEqual([]);
  });

  it.each([
    'capability_taxonomy_versions',
    'capability_tasks',
    'capability_terms',
    'capability_task_terms',
    'hunter_capabilities',
    'bounty_requirements',
  ])('keeps %s read-only for authenticated clients', (table) => {
    expect(protectedTables[table].grants).toEqual({ anon: [], authenticated: ['SELECT'] });
    expect(protectedTables[table].policies).toHaveLength(1);
    expect(protectedTables[table].policies?.[0].cmd).toBe('SELECT');
    expect(protectedTables[table].policies?.[0].roles).toEqual(['authenticated']);
  });

  it('preserves owner isolation for self-reported hunter declarations', () => {
    expect(protectedTables.hunter_capabilities.policies?.[0].qual).toBe('(owner_id = auth.uid())');
  });

  it.each([
    'get_my_hunter_capabilities()',
    'set_my_hunter_capabilities(jsonb,integer)',
  ])('requires authenticated access to %s', (signature) => {
    const guard = manifest.functions.find((entry) => entry.signature === signature);
    expect(guard?.forbid_execute).toEqual(['anon', 'PUBLIC']);
  });

  it('requires both atomic requirement projection and application locking', () => {
    expect(protectedTables.bounties.required_triggers).toEqual(expect.arrayContaining([
      'trg_bounties_guard_lifecycle',
      'trg_bounties_enforce_funding_before_work',
      'a00_validate_bounty_requirements',
      'a00_project_bounty_requirements',
    ]));
    expect(protectedTables.bounty_requests.required_triggers).toEqual(expect.arrayContaining([
      'trg_bounty_requests_guard_assignment',
      'a00_lock_bounty_requirements',
    ]));
    expect(protectedTables.bounty_requests.commands).toEqual(['INSERT', 'UPDATE']);
  });

  it('leaves pre-existing request SELECT/DELETE policy findings in the baseline ratchet', () => {
    const snapshot = {
      tables: [{ table_name: 'bounty_requests', rls_enabled: true }],
      policies: ['SELECT', 'DELETE'].flatMap(cmd => ['hunter', 'poster'].map(policyname => ({
        tablename: 'bounty_requests', policyname, cmd, permissive: 'PERMISSIVE',
        roles: ['authenticated'], qual: 'true', with_check: null,
      }))),
      triggers: protectedTables.bounty_requests.required_triggers!.map(tgname => ({
        table_name: 'bounty_requests', tgname, enabled: 'O',
      })),
      grants: [], columns: [], column_grants: [], functions: [],
    };
    expect(analyze(snapshot, {
      protected: { bounty_requests: protectedTables.bounty_requests },
      baseline: ['multi_permissive:bounty_requests:SELECT', 'multi_permissive:bounty_requests:DELETE'],
    }).errors).toEqual([]);
  });

  it.each([
    'fn_score_and_dispatch_bounty_notification(uuid,uuid[],smallint,text,text,jsonb)',
    'fn_dispatch_bounty_targeting(uuid,text)',
    'fn_claim_bounty_targeting_delivery(uuid,uuid,text,uuid)',
    'fn_ack_bounty_targeting_delivery(uuid,uuid,text,uuid,text,text)',
    'fn_finish_bounty_targeting_outbox(uuid)',
    'validate_bounty_requirements()',
    'project_bounty_requirements()',
    'lock_bounty_requirements_for_application()',
  ])('forbids direct client execution of %s', (signature) => {
    const guard = manifest.functions.find((entry) => entry.signature === signature);
    expect(guard?.forbid_execute).toEqual(expect.arrayContaining(['PUBLIC', 'anon', 'authenticated']));
  });
});
