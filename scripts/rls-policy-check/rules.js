/* scripts/rls-policy-check/rules.js
 *
 * Pure analysis for the RLS regression check (trust-spine audit 2026-09-30,
 * "policy CI"). No database access here: check-rls-policies.js takes a
 * snapshot of the live catalog and hands it to analyze(), so the rules are
 * unit-testable (__tests__/unit/rls-policy-check.test.ts).
 *
 * Why it exists: 20260715i_sync_rls_policies_across_environments.sql
 * re-created permissive policies that earlier hardening had removed.
 * Permissive policies are OR'd, so one extra policy silently reopened
 * "anyone can resolve any dispute" and "suspended accounts can post".
 * Nothing noticed for 2.5 months.
 *
 * Two tiers:
 *   protected tables (manifest.protected) -- strict. Live policies must equal
 *     the manifest exactly, at most one permissive policy per command, exact
 *     anon/authenticated grants, required guard triggers present + enabled.
 *   everything else -- ratchet. Today's findings are listed in
 *     manifest.baseline; any NEW finding fails:
 *       multi_permissive:<table>:<cmd>   >1 permissive policy for a command
 *       self_only_update:<table>:<name>  UPDATE policy that is only
 *                                        "auth.uid() = col" on a table with
 *                                        lifecycle/money columns and no
 *                                        declared guard trigger
 *       dangerous_grant:<table>:<role>:<priv>  TRUNCATE/TRIGGER/REFERENCES to
 *                                        anon/authenticated (TRUNCATE bypasses RLS)
 */

const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const DANGEROUS_PRIVILEGES = ['TRUNCATE', 'TRIGGER', 'REFERENCES'];
const CLIENT_ROLES = ['anon', 'authenticated'];

/**
 * Collapse whitespace and numeric-literal casts so cosmetic deparse differences
 * never matter. Postgres prints `rating >= 1` against an integer column but
 * `rating >= (1)::numeric` against a numeric one (ratings.rating is integer on
 * prod, numeric on staging); the policies are logically identical.
 */
function norm(expr) {
  return expr == null
    ? null
    : String(expr)
        .replace(/\s+/g, ' ')
        .replace(/\((-?\d+(?:\.\d+)?)\)::(?:numeric|integer|int4|int8|bigint|smallint)\b/g, '$1')
        .trim();
}

function normRoles(roles) {
  if (Array.isArray(roles)) return [...roles].sort();
  return String(roles || '')
    .replace(/[{}]/g, '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .sort();
}

/**
 * A trigger only guards ordinary client writes in states 'O' (origin, the
 * default) and 'A' (always). 'D' is disabled and 'R' fires only when
 * session_replication_role = replica, which PostgREST never sets.
 */
function triggerActive(t) {
  return Boolean(t) && (t.enabled === 'O' || t.enabled === 'A');
}

function expandCommands(cmd) {
  return cmd === 'ALL' ? COMMANDS : [cmd];
}

/** "auth.uid() = col" / "col = (SELECT auth.uid() AS uid)" and nothing else. */
function isSelfOnly(expr) {
  if (!expr) return false;
  const e = String(expr).toLowerCase().replace(/\s+/g, '');
  const uid = '(?:\\(selectauth\\.uid\\(\\)asuid\\)|auth\\.uid\\(\\))';
  const re = new RegExp(`^\\(*(?:${uid}=\\(*\\w+\\)*|\\w+=${uid})\\)*$`);
  return re.test(e);
}

function policyKey(p) {
  return JSON.stringify([
    p.policyname,
    p.cmd,
    p.permissive,
    normRoles(p.roles),
    norm(p.qual),
    norm(p.with_check),
  ]);
}

/**
 * @param {object} snapshot  { policies, grants, triggers, columns, functions }
 *   policies:  [{ tablename, policyname, permissive, cmd, roles, qual, with_check }]
 *   grants:    [{ table_name, grantee, privilege_type }]
 *   triggers:  [{ table_name, tgname, enabled }]   enabled: 'O' | 'D' | 'R' | 'A'
 *              (only 'O' and 'A' fire for ordinary client writes)
 *   tables:    [{ table_name, rls_enabled }]
 *   column_grants: [{ table_name, column_name, grantee, privilege_type }]
 *              column-level grants only (pg_attribute.attacl), not table-wide ones
 *   columns:   [{ table_name, column_name }]
 *   functions: [{ signature, grantees: string[] }]  (EXECUTE grantees)
 * @param {object} manifest  supabase/security/rls-manifest.json
 * @returns {{ errors: string[], warnings: string[], findings: string[] }}
 */
function analyze(snapshot, manifest) {
  const errors = [];
  const warnings = [];
  const findings = [];
  const protectedTables = manifest.protected || {};
  const baseline = new Set(manifest.baseline || []);
  const guarded = manifest.guarded_tables || {};
  const sensitiveColumns = new Set(manifest.sensitive_columns || []);

  const byTable = new Map();
  for (const p of snapshot.policies) {
    if (!byTable.has(p.tablename)) byTable.set(p.tablename, []);
    byTable.get(p.tablename).push(p);
  }
  const triggerOn = (table, name) =>
    snapshot.triggers.find((t) => t.table_name === table && t.tgname === name);

  // ── Tier 1: protected tables ────────────────────────────────────────────
  for (const [table, spec] of Object.entries(protectedTables)) {
    // spec.commands narrows a table to the commands the manifest owns (the
    // rest of that table's policies fall back to the ratchet).
    const owns = (p) => !spec.commands || expandCommands(p.cmd).some((c) => spec.commands.includes(c));
    const live = (byTable.get(table) || []).filter(owns);

    // Policies and grants say nothing if row-level security is switched off:
    // ALTER TABLE ... DISABLE ROW LEVEL SECURITY leaves both untouched.
    const tableInfo = (snapshot.tables || []).find((t) => t.table_name === table);
    if (!tableInfo) errors.push(`${table}: protected table does not exist`);
    else if (!tableInfo.rls_enabled) errors.push(`${table}: row-level security is DISABLED`);

    if (spec.policies) {
      const liveKeys = new Map(live.map((p) => [policyKey(p), p]));
      const wantKeys = new Map(spec.policies.map((p) => [policyKey(p), p]));
      for (const [k, p] of liveKeys) {
        if (!wantKeys.has(k)) {
          errors.push(`${table}: unexpected or modified policy "${p.policyname}" (${p.cmd}, ${p.permissive})`);
        }
      }
      for (const [k, p] of wantKeys) {
        if (!liveKeys.has(k)) errors.push(`${table}: expected policy "${p.policyname}" (${p.cmd}) is missing or differs`);
      }
    }

    for (const cmd of spec.commands || COMMANDS) {
      const permissive = live.filter(
        (p) => p.permissive === 'PERMISSIVE' && expandCommands(p.cmd).includes(cmd)
      );
      if (permissive.length > 1) {
        errors.push(
          `${table}: ${permissive.length} permissive ${cmd} policies (${permissive
            .map((p) => p.policyname)
            .join(', ')}) -- permissive policies are OR'd; keep one`
        );
      }
    }

    if (spec.grants) {
      for (const role of CLIENT_ROLES) {
        const want = [...(spec.grants[role] || [])].sort();
        const have = snapshot.grants
          .filter((g) => g.table_name === table && g.grantee === role)
          .map((g) => g.privilege_type)
          .sort();
        const extra = have.filter((x) => !want.includes(x));
        const missing = want.filter((x) => !have.includes(x));
        if (extra.length) errors.push(`${table}: unexpected ${role} grant(s): ${extra.join(', ')}`);
        if (missing.length) errors.push(`${table}: missing ${role} grant(s): ${missing.join(', ')}`);
      }
    }

    // Column-level grants (e.g. UPDATE limited to the response columns) are
    // invisible to role_table_grants, so they are compared separately.
    if (spec.column_grants) {
      for (const role of CLIENT_ROLES) {
        const wantByPriv = spec.column_grants[role] || {};
        const haveByPriv = {};
        for (const g of snapshot.column_grants || []) {
          if (g.table_name !== table || g.grantee !== role) continue;
          (haveByPriv[g.privilege_type] = haveByPriv[g.privilege_type] || []).push(g.column_name);
        }
        for (const priv of new Set([...Object.keys(wantByPriv), ...Object.keys(haveByPriv)])) {
          const want = wantByPriv[priv] || [];
          const have = haveByPriv[priv] || [];
          const extra = have.filter((c) => !want.includes(c)).sort();
          const missing = want.filter((c) => !have.includes(c)).sort();
          if (extra.length) errors.push(`${table}: unexpected ${role} column ${priv} grant(s) on: ${extra.join(', ')}`);
          if (missing.length) errors.push(`${table}: missing ${role} column ${priv} grant(s) on: ${missing.join(', ')}`);
        }
      }
    }

    for (const name of spec.required_triggers || []) {
      const t = triggerOn(table, name);
      if (!t) errors.push(`${table}: required guard trigger ${name} is missing`);
      else if (t.enabled === 'D') errors.push(`${table}: required guard trigger ${name} is DISABLED`);
      else if (!triggerActive(t)) {
        errors.push(`${table}: required guard trigger ${name} does not fire for client writes (state ${t.enabled}; only O/A are effective)`);
      }
    }
  }

  for (const fn of manifest.functions || []) {
    const live = (snapshot.functions || []).find((f) => f.signature === fn.signature);
    if (!live) {
      errors.push(`function ${fn.signature} is missing`);
      continue;
    }
    for (const role of fn.forbid_execute || []) {
      if (live.grantees.includes(role)) errors.push(`function ${fn.signature} is executable by ${role}`);
    }
  }

  // ── Tier 2: ratchet over every public table ─────────────────────────────
  for (const [table, policies] of byTable) {
    for (const cmd of COMMANDS) {
      const n = policies.filter(
        (p) => p.permissive === 'PERMISSIVE' && expandCommands(p.cmd).includes(cmd)
      ).length;
      if (n > 1) findings.push(`multi_permissive:${table}:${cmd}`);
    }

    const hasSensitive = snapshot.columns.some(
      (c) => c.table_name === table && sensitiveColumns.has(c.column_name)
    );
    if (hasSensitive) {
      const guardName = guarded[table];
      const guardOk = guardName && triggerActive(triggerOn(table, guardName));
      for (const p of policies) {
        if (!expandCommands(p.cmd).includes('UPDATE')) continue;
        if (isSelfOnly(p.qual) && (p.with_check == null || isSelfOnly(p.with_check)) && !guardOk) {
          findings.push(`self_only_update:${table}:${p.policyname}`);
        }
      }
    }
  }

  for (const g of snapshot.grants) {
    if (CLIENT_ROLES.includes(g.grantee) && DANGEROUS_PRIVILEGES.includes(g.privilege_type)) {
      findings.push(`dangerous_grant:${g.table_name}:${g.grantee}:${g.privilege_type}`);
    }
  }

  const uniqueFindings = [...new Set(findings)].sort();
  for (const f of uniqueFindings) {
    const [kind, table, cmdOrName] = f.split(':');
    const spec = protectedTables[table];
    // Already judged strictly above, unless the manifest only owns some
    // commands of this table and the finding is about another one.
    if (spec && !(kind === 'multi_permissive' && spec.commands && !spec.commands.includes(cmdOrName))) continue;
    if (!baseline.has(f)) errors.push(`new finding (not in baseline): ${f}`);
  }
  const live = new Set(uniqueFindings);
  for (const b of baseline) {
    if (!live.has(b)) warnings.push(`baseline entry no longer present (can be removed): ${b}`);
  }

  return { errors, warnings, findings: uniqueFindings };
}

module.exports = { analyze, isSelfOnly, norm, normRoles, policyKey };
