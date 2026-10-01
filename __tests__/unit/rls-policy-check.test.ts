/* eslint-disable @typescript-eslint/no-require-imports -- rules.js is a plain CommonJS script shared with scripts/check-rls-policies.js */
const { analyze, isSelfOnly } = require('../../scripts/rls-policy-check/rules');

const UID = '( SELECT auth.uid() AS uid)';

function baseSnapshot() {
  return {
    policies: [
      { tablename: 'bounty_disputes', policyname: 'insert_participant', permissive: 'PERMISSIVE', cmd: 'INSERT', roles: '{authenticated}', qual: null, with_check: `((initiator_id = ${UID}) AND (status = 'open'))` },
      { tablename: 'bounty_disputes', policyname: 'update_admin', permissive: 'PERMISSIVE', cmd: 'UPDATE', roles: '{authenticated}', qual: 'is_admin', with_check: 'is_admin' },
      { tablename: 'notes', policyname: 'notes_select', permissive: 'PERMISSIVE', cmd: 'SELECT', roles: '{authenticated}', qual: 'true', with_check: null },
    ],
    grants: [
      { table_name: 'bounty_disputes', grantee: 'authenticated', privilege_type: 'SELECT' },
      { table_name: 'bounty_disputes', grantee: 'authenticated', privilege_type: 'INSERT' },
      { table_name: 'bounty_disputes', grantee: 'authenticated', privilege_type: 'UPDATE' },
    ],
    triggers: [{ table_name: 'bounty_disputes', tgname: 'trg_guard', enabled: 'O' }],
    columns: [
      { table_name: 'bounty_disputes', column_name: 'status' },
      { table_name: 'wallet_like', column_name: 'balance' },
      { table_name: 'notes', column_name: 'body' },
    ],
    functions: [{ signature: 'gate(uuid)', grantees: ['service_role'] }],
  };
}

function manifest() {
  const snap = baseSnapshot();
  return {
    sensitive_columns: ['status', 'balance'],
    guarded_tables: { bounty_disputes: 'trg_guard' },
    protected: {
      bounty_disputes: {
        policies: snap.policies
          .filter((p) => p.tablename === 'bounty_disputes')
          .map(({ policyname, cmd, permissive, qual, with_check }) => ({
            policyname, cmd, permissive, roles: ['authenticated'], qual, with_check,
          })),
        grants: { anon: [], authenticated: ['INSERT', 'SELECT', 'UPDATE'] },
        required_triggers: ['trg_guard'],
      },
    },
    functions: [{ signature: 'gate(uuid)', forbid_execute: ['anon', 'authenticated', 'PUBLIC'] }],
    baseline: [],
  };
}

describe('rls-policy-check rules', () => {
  it('passes when the live state matches the manifest', () => {
    expect(analyze(baseSnapshot(), manifest()).errors).toEqual([]);
  });

  it('ignores cosmetic whitespace differences in deparsed expressions', () => {
    const snap = baseSnapshot();
    snap.policies[0].with_check = snap.policies[0].with_check.replace(/ AND /, '\n   AND ');
    expect(analyze(snap, manifest()).errors).toEqual([]);
  });

  it('catches the 20260715i regression: a re-added permissive "Participants insert"', () => {
    const snap = baseSnapshot();
    snap.policies.push({
      tablename: 'bounty_disputes', policyname: 'Participants insert', permissive: 'PERMISSIVE',
      cmd: 'INSERT', roles: '{authenticated}', qual: null, with_check: `(${UID} = initiator_id)`,
    });
    const { errors } = analyze(snap, manifest());
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('unexpected or modified policy "Participants insert"'),
      expect.stringContaining('2 permissive INSERT policies'),
    ]));
  });

  it('catches a self-only UPDATE policy re-added on a protected table', () => {
    const snap = baseSnapshot();
    snap.policies.push({
      tablename: 'bounty_disputes', policyname: 'Initiator update', permissive: 'PERMISSIVE',
      cmd: 'UPDATE', roles: '{authenticated}', qual: `(${UID} = initiator_id)`, with_check: `(${UID} = initiator_id)`,
    });
    expect(analyze(snap, manifest()).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('2 permissive UPDATE policies'),
    ]));
  });

  it('counts an ALL policy against every command', () => {
    const snap = baseSnapshot();
    snap.policies.push({
      tablename: 'bounty_disputes', policyname: 'Admin manage', permissive: 'PERMISSIVE',
      cmd: 'ALL', roles: '{authenticated}', qual: 'x', with_check: 'x',
    });
    const { errors } = analyze(snap, manifest());
    expect(errors.filter((e) => /permissive (INSERT|UPDATE) policies/.test(e))).toHaveLength(2);
  });

  it('flags unexpected and missing grants on protected tables', () => {
    const snap = baseSnapshot();
    snap.grants.push({ table_name: 'bounty_disputes', grantee: 'anon', privilege_type: 'UPDATE' });
    snap.grants = snap.grants.filter((g) => !(g.grantee === 'authenticated' && g.privilege_type === 'SELECT'));
    const { errors } = analyze(snap, manifest());
    expect(errors).toEqual(expect.arrayContaining([
      'bounty_disputes: unexpected anon grant(s): UPDATE',
      'bounty_disputes: missing authenticated grant(s): SELECT',
    ]));
  });

  it('fails when a required guard trigger is dropped or disabled', () => {
    const dropped = baseSnapshot();
    dropped.triggers = [];
    expect(analyze(dropped, manifest()).errors).toContain('bounty_disputes: required guard trigger trg_guard is missing');
    const disabled = baseSnapshot();
    disabled.triggers[0].enabled = 'D';
    expect(analyze(disabled, manifest()).errors).toContain('bounty_disputes: required guard trigger trg_guard is DISABLED');
  });

  it('flags a forbidden EXECUTE grant on a guarded function', () => {
    const snap = baseSnapshot();
    snap.functions[0].grantees.push('authenticated');
    expect(analyze(snap, manifest()).errors).toContain('function gate(uuid) is executable by authenticated');
  });

  describe('ratchet on unprotected tables', () => {
    it('fails on a NEW duplicate permissive policy, passes once baselined', () => {
      const snap = baseSnapshot();
      snap.policies.push({ ...snap.policies[2], policyname: 'notes_select_again' });
      expect(analyze(snap, manifest()).errors).toContain('new finding (not in baseline): multi_permissive:notes:SELECT');
      const m = { ...manifest(), baseline: ['multi_permissive:notes:SELECT'] };
      expect(analyze(snap, m).errors).toEqual([]);
    });

    it('fails on an unguarded self-only UPDATE on a table with money/lifecycle columns', () => {
      const snap = baseSnapshot();
      snap.policies.push({
        tablename: 'wallet_like', policyname: 'own_update', permissive: 'PERMISSIVE', cmd: 'UPDATE',
        roles: '{authenticated}', qual: `(${UID} = user_id)`, with_check: `(${UID} = user_id)`,
      });
      expect(analyze(snap, manifest()).errors).toContain('new finding (not in baseline): self_only_update:wallet_like:own_update');
    });

    it('fails on TRUNCATE granted to a client role', () => {
      const snap = baseSnapshot();
      snap.grants.push({ table_name: 'notes', grantee: 'authenticated', privilege_type: 'TRUNCATE' });
      expect(analyze(snap, manifest()).errors).toContain('new finding (not in baseline): dangerous_grant:notes:authenticated:TRUNCATE');
    });

    it('warns about baseline entries that have been fixed', () => {
      const m = { ...manifest(), baseline: ['multi_permissive:gone:SELECT'] };
      expect(analyze(baseSnapshot(), m).warnings).toEqual([
        'baseline entry no longer present (can be removed): multi_permissive:gone:SELECT',
      ]);
    });
  });

  it('recognises self-only expressions in both deparse styles', () => {
    expect(isSelfOnly('(auth.uid() = poster_id)')).toBe(true);
    expect(isSelfOnly(`(poster_id = ${UID})`)).toBe(true);
    expect(isSelfOnly(`((${UID} = poster_id) AND is_account_active(${UID}))`)).toBe(false);
    expect(isSelfOnly('true')).toBe(false);
  });
});
