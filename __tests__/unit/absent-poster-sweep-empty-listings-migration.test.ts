import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20261019015859_absent_poster_sweep_empty_listings.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

// Body of the function only, so comments in the header can't satisfy a check.
const body = sql.slice(sql.indexOf('AS $$'), sql.lastIndexOf('$$;'));

describe('absent-poster sweep: dead listings with no pending applications (SBA-01)', () => {
  it('replaces the existing sweep in place, still dry-run by default and service-role only', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_sweep_absent_posters(');
    expect(sql).toContain('p_dry_run     boolean DEFAULT true');
    expect(sql).not.toMatch(/DROP FUNCTION/i);
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'");
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM ${role};`,
      );
    }
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) TO service_role;',
    );
    // Rides the existing absent-poster-sweep-daily job; no second schedule.
    expect(sql).not.toMatch(/cron\.schedule/i);
  });

  it('adds open listings with nothing pending, but only external, non-test, not-yet-flagged ones', () => {
    expect(body).toContain('WHERE o.has_pending OR o.empty_eligible');
    expect(body).toContain('b.is_test IS NOT TRUE');
    expect(body).toContain('NOT COALESCE(pi.is_internal, false)');
    expect(body).toContain("NOT (COALESCE(b.is_stale, false) AND b.stale_reason = 'poster_absent')");
    // Assigned bounties are still not the sweep's to close.
    expect(body).toContain('AND b.accepted_by IS NULL');
    expect(body).toContain('AND b.accepted_request_id IS NULL');
    // Eligibility is re-checked on the state read under the lock.
    expect(body).toContain('IF v_ids IS NULL\n       AND (v_is_test OR r.is_internal OR v_flagged) THEN');
  });

  it('keeps the same poster-activity signals', () => {
    for (const signal of [
      'pr.last_session_at',
      'u.last_sign_in_at',
      'msg.last_at',
      'posted.last_at',
      'decided.last_at',
    ]) {
      expect(body).toContain(signal);
    }
    expect(body).toContain('a.last_active IS NULL OR a.last_active < now() - make_interval(days => v_days)');
    expect(body).toContain("RAISE EXCEPTION 'absent_days % is below the 7-day floor'");
  });

  it('never archives a bounty that may hold funds or has an owner-refund claim', () => {
    expect(body).toContain(
      'v_funded := public.fn_bounty_may_hold_funds(r.bounty_id)\n                OR EXISTS (SELECT 1 FROM public.bounty_owner_refund_claims oc',
    );
    // Exactly one way to close: the unfunded branch.
    expect(body.match(/status = 'archived'/g)).toHaveLength(1);
    const funded = body.indexOf('IF v_funded THEN');
    const archive = body.indexOf("SET status = 'archived'");
    const elseBranch = body.indexOf('ELSE', funded);
    expect(funded).toBeGreaterThan(-1);
    expect(elseBranch).toBeLessThan(archive);
    expect(body.slice(funded, elseBranch)).not.toContain('status =');
  });

  it('keeps the lock-then-recheck order and NOWAIT', () => {
    expect(body.match(/FOR UPDATE NOWAIT/g)).toHaveLength(2);
    expect(body.indexOf('FROM public.bounty_requests br\n      WHERE br.bounty_id = r.bounty_id AND br.status = \'pending\''))
      .toBeLessThan(body.indexOf('FROM public.bounties b WHERE b.id = r.bounty_id'));
    expect(body).toContain('EXCEPTION WHEN lock_not_available THEN');
  });

  it('logs and returns listings swept with nothing pending', () => {
    expect(body).toContain("v_ids := COALESCE(v_ids, '{}'::uuid[]);");
    expect(body).toContain('v_action, cardinality(v_ids), v_ids);');
    expect(body).toContain('SELECT v_sweep_id, NULL::uuid, r.bounty_id, NULL::uuid, r.poster_id');
    // Hunter notices still come only from closed request rows.
    expect(body).toContain('FROM closed c\n      RETURNING 1');
    expect(body).toContain("rejection_source = 'system_poster_absent'");
  });
});
