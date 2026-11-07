/**
 * A retention job deletes on a schedule, so what it may touch has to be pinned.
 * The windows below are the approved policy: widening a delete should fail here
 * rather than quietly remove more than was agreed.
 */
import * as fs from 'fs';
import * as path from 'path';

const sql = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20261107160000_operational_log_retention.sql'),
  'utf8'
);
const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));

describe('operational log retention migration', () => {
  it('deletes only the two log tables, each behind its window', () => {
    const deletes = body.match(/DELETE FROM [^;]+;/g) ?? [];

    expect(deletes).toEqual([
      "DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';",
      "DELETE FROM public.client_logs WHERE created_at < now() - interval '30 days';",
    ]);
  });

  it('cannot be called by client roles', () => {
    expect(body).toContain('REVOKE ALL ON FUNCTION public.fn_prune_operational_logs() FROM PUBLIC;');
    expect(body).toContain(
      'REVOKE ALL ON FUNCTION public.fn_prune_operational_logs() FROM anon, authenticated;'
    );
  });

  it('pins its search path, as a SECURITY DEFINER function must', () => {
    expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  });

  it('records what each run deleted in the heartbeat', () => {
    expect(body).toContain(
      "public.record_job_heartbeat('operational-log-retention-daily', public.fn_prune_operational_logs())"
    );
  });

  it('is watched by job health, so a stopped job raises an alert', () => {
    expect(body).toContain('INSERT INTO public.job_health_expectations');
    expect(body).toContain("'operational-log-retention-daily', '72 hours', NULL");
  });

  it('can be re-run without scheduling the job twice', () => {
    expect(body.indexOf('cron.unschedule(jobid)')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('cron.unschedule(jobid)')).toBeLessThan(body.indexOf('SELECT cron.schedule('));
  });
});
