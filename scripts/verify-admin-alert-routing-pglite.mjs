/* scripts/verify-admin-alert-routing-pglite.mjs
 *
 * Functional checks for supabase/migrations/20261021230000_admin_alert_routing.sql
 * on an in-process PostgreSQL (PGlite): the admin_recipients paging list,
 * fn_notify_admins, the outbox dispatch trigger that replaces Push_noti_manager,
 * the ops-alert lifecycle (stays open, 24h reminder, acknowledge, resolve), the
 * edge-auth-or-5xx attribution, and grants.
 *
 * pg_net and vault are stand-ins: net.http_post records each call and returns
 * an id, net._http_response is a plain table the test fills. The ops tables,
 * expectations and the 2026-09-12 recipient plumbing are read from their own
 * migrations, so the shipped SQL is what runs. The migration under test is
 * applied twice (idempotency).
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-admin-alert-routing-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const read = (f) => fs.readFileSync(`${REPO}/supabase/migrations/${f}`, 'utf8');
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end));

const MIGRATION = read('20261021230000_admin_alert_routing.sql');
const PLUMBING = read('20260912033941_reconciliation_alert_plumbing.sql');
const JOB_HEALTH = read('20260925120000_job_health_monitoring.sql');

const db = await PGlite.create();
const notices = [];
const q = (sql, params) => db.query(sql, params, { onNotice: (n) => notices.push(n.message) });
const one = async (sql, params) => (await q(sql, params)).rows[0];
const rows = async (sql, params) => (await q(sql, params)).rows;
async function fails(sql, params) {
  try { await q(sql, params); return null; } catch (e) { return e.message; }
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

const A = '00000000-0000-4000-8000-00000000000a'; // internal admin
const K = '00000000-0000-4000-8000-00000000000b'; // external admin (access only)
const N = '00000000-0000-4000-8000-00000000000c'; // internal non-admin
const B = '00000000-0000-4000-8000-00000000000d'; // second recipient, critical only

// ─── Supabase-ish base ──────────────────────────────────────────────────────
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}', deleted_at timestamptz);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid $$;

-- Live definition (20261012120000).
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND COALESCE(u.raw_app_meta_data ->> 'role', '') = 'admin');
$$;

CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('SUPABASE_URL', 'https://ref.supabase.co'), ('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');

CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb, timeout_ms int);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net.calls (url, headers, body, timeout_ms) VALUES (url, headers, body, timeout_milliseconds) RETURNING id $$;
CREATE TABLE net._http_response (id bigint, status_code int, content text, error_msg text, timed_out boolean, created timestamptz DEFAULT now());

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, start_time timestamptz, status text);
CREATE FUNCTION cron.alter_job(job_id bigint, command text) RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET command = $2 WHERE jobid = $1 $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_internal boolean DEFAULT false);
CREATE TABLE public.notifications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, bounty_id text,
  recipients jsonb, title text, body text, data jsonb);
-- What production has today: a webhook with a credential in its definition.
CREATE FUNCTION public.fake_webhook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER "Push_noti_manager" AFTER INSERT ON public.notifications_outbox FOR EACH ROW EXECUTE FUNCTION public.fake_webhook();

CREATE TABLE public.reconciliation_findings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), finding_type text, severity text, details jsonb DEFAULT '{}', user_id uuid);
`);

// Users: A internal admin, K external admin, N internal non-admin, B internal non-admin.
await q(`INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ($1, 'a@x', '{"role":"admin"}'), ($2, 'k@x', '{"role":"admin"}'), ($3, 'n@x', '{}'), ($4, 'b@x', '{}')`, [A, K, N, B]);
await q(`INSERT INTO public.profiles (id, is_internal) VALUES ($1, true), ($2, false), ($3, true), ($4, true)`, [A, K, N, B]);

// Pre-migration state from git: recipient plumbing, critical-finding trigger,
// ops tables, heartbeat writer, expectations.
await db.exec(PLUMBING);
const CRIT = read('20260912034020_alert_on_critical_finding_trigger.sql');
await db.exec(CRIT.slice(CRIT.indexOf('CREATE OR REPLACE FUNCTION public.fn_alert_on_critical_finding'),
                         CRIT.indexOf('-- ─── Suppress the known backlog')));
await db.exec(between(JOB_HEALTH, '-- 2. Tables', '-- 3. Heartbeat writer'));
await db.exec(between(JOB_HEALTH, '-- 3. Heartbeat writer', '-- 4. Checker'));
await db.exec(between(JOB_HEALTH, '-- 6. Expectations', '-- 7. Heartbeats'));
await db.exec(`
UPDATE public.job_health_expectations SET enabled = false WHERE job_name <> 'edge-auth-or-5xx';
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description, registered_at)
VALUES ('test-job', '10 minutes', NULL, 'test job', now() - interval '1 hour');
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description, enabled)
VALUES ('job-health-retention-daily', '72 hours', NULL, 'old description', false)
ON CONFLICT (job_name) DO NOTHING;
INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('stripe-balance-reconciliation-hourly', '0 * * * *',
   $c$SELECT net.http_post(url := 'x/admin-withdrawals', body := '{}'::jsonb, timeout_milliseconds := 55000);$c$),
  ('moderation-sweep-10min', '*/10 * * * *', $c$SELECT net.http_post(url := 'x/moderation-sweep', timeout_milliseconds := 55000);$c$);
`);
check('baseline: old resolver pages both admins (the bug)',
  (await one(`SELECT cardinality(public.fn_admin_recipient_ids()) AS n`)).n === 2);

// ─── Apply (twice) ──────────────────────────────────────────────────────────
await db.exec(MIGRATION);
await db.exec(MIGRATION);
check('migration applies twice', true);

// ─── 1. Recipients ──────────────────────────────────────────────────────────
console.log('\nrecipients');
const seeded = await rows(`SELECT user_id, min_severity, enabled FROM public.admin_recipients`);
check('seeded with the internal admin only', seeded.length === 1 && seeded[0].user_id === A, seeded);
check('fn_admin_recipient_ids() = list, not role', JSON.stringify((await one(`SELECT public.fn_admin_recipient_ids() AS r`)).r) === JSON.stringify([A]));
check('moderation_admin_recipients() = list', JSON.stringify(await rows(`SELECT user_id FROM public.moderation_admin_recipients()`)) === JSON.stringify([{ user_id: A }]));

await q(`INSERT INTO public.admin_recipients (user_id, min_severity) VALUES ($1, 'critical')`, [B]);
check('high alert skips a critical-only recipient',
  JSON.stringify((await one(`SELECT public.fn_admin_recipients_for('high') AS r`)).r) === JSON.stringify([A]));
check('critical alert reaches both',
  (await one(`SELECT cardinality(public.fn_admin_recipients_for('critical')) AS n`)).n === 2);
check('unknown severity ranks as high', (await one(`SELECT public.fn_alert_severity_rank('bogus') AS r`)).r === 3);
check('medium recipient gets warning-severity alerts', (await one(`SELECT cardinality(public.fn_admin_recipients_for('warning')) AS n`)).n === 1);
await q(`DELETE FROM public.admin_recipients WHERE user_id = $1`, [B]);

// ─── 2. Dispatch trigger ────────────────────────────────────────────────────
console.log('\noutbox dispatch');
check('Push_noti_manager dropped',
  (await one(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'Push_noti_manager'`)).n === 0);
await q(`TRUNCATE net.calls`);
const ob = await one(`INSERT INTO public.notifications_outbox (recipients, title, body, data) VALUES ('["${N}"]', 't', 'b', '{"type":"message"}') RETURNING id`);
const call = await one(`SELECT * FROM net.calls ORDER BY id DESC LIMIT 1`);
check('insert posts to process-notification', call?.url === 'https://ref.supabase.co/functions/v1/process-notification', call);
check('with the vault key', call?.headers?.Authorization === 'Bearer sb_secret_test');
check('body is the row id', call?.body?.id === ob.id);
check('request labelled', (await one(`SELECT caller, target FROM public.ops_http_requests WHERE request_id = $1`, [call.id]))?.caller === 'notifications_outbox_dispatch');
check('the first worker atomically claims the outbox row',
  (await one(`SELECT public.fn_claim_notification_outbox($1) AS claimed`, [ob.id])).claimed === true);
check('a concurrent worker cannot claim the same row',
  (await one(`SELECT public.fn_claim_notification_outbox($1) AS claimed`, [ob.id])).claimed === false);

await q(`UPDATE vault.decrypted_secrets SET name = 'X' WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'`);
const before = (await one(`SELECT count(*)::int AS n FROM net.calls`)).n;
const noVault = await fails(`INSERT INTO public.notifications_outbox (recipients, title, body, data) VALUES ('[]', 't', 'b', '{}')`);
check('no vault key: insert still succeeds, no call', noVault === null && (await one(`SELECT count(*)::int AS n FROM net.calls`)).n === before, noVault);
await q(`UPDATE vault.decrypted_secrets SET name = 'SUPABASE_SERVICE_ROLE_KEY' WHERE name = 'X'`);

// ─── 3. fn_notify_admins ────────────────────────────────────────────────────
console.log('\nfn_notify_admins');
await q(`TRUNCATE net.calls`);
const hi = (await one(`SELECT public.fn_notify_admins('moderation_alert', 'high', 'Suspicious', 'scam text',
  '{"type":"spoof","severity":"low","bounty_id":"x"}'::jsonb) AS r`)).r;
const hiRow = await one(`SELECT * FROM public.notifications_outbox WHERE id = $1`, [hi.outbox_id]);
const emailCall = await one(`SELECT * FROM net.calls WHERE url LIKE '%send-notification-email'`);
check('high: one outbox row to the list', JSON.stringify(hiRow.recipients) === JSON.stringify([A]), hiRow.recipients);
check('high: producer cannot override type/severity', hiRow.data.type === 'moderation_alert' && hiRow.data.severity === 'high', hiRow.data);
check('high: emailDispatched=true on the outbox row', hiRow.data.emailDispatched === true);
check('high: email sent directly to the list', JSON.stringify(emailCall?.body?.userIds) === JSON.stringify([A]) && emailCall?.body?.category === 'security', emailCall?.body);
check('high: email uses the vault key', emailCall?.headers?.Authorization === 'Bearer sb_secret_test');
const del = await one(`SELECT * FROM public.admin_alert_deliveries ORDER BY id DESC LIMIT 1`);
check('high: delivery recorded with the email request id', del.email_request_id == emailCall.id && del.email_skipped_reason === null && del.outbox_id === hi.outbox_id, del);
const highEmailAttempt = await one(`SELECT * FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [del.id]);
check('high: email outcome starts pending for its recipient',
  highEmailAttempt?.user_id === A && highEmailAttempt.outcome === 'pending' && highEmailAttempt.attempts === 1, highEmailAttempt);
await q(`INSERT INTO net._http_response (id, status_code, content) VALUES ($1, 200, '{"sent":1,"failed":0,"skipped":0}')`, [emailCall.id]);
await q(`SELECT public.fn_reconcile_admin_alert_emails()`);
check('high: confirmed provider acceptance is recorded',
  (await one(`SELECT outcome FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [del.id])).outcome === 'delivered');

await q(`TRUNCATE net.calls`);
const med = (await one(`SELECT public.fn_notify_admins('moderation_alert', 'medium', 'Flag', 'x') AS r`)).r;
const medRow = await one(`SELECT data FROM public.notifications_outbox WHERE id = $1`, [med.outbox_id]);
check('medium: no direct email, normal fan-out left on',
  (await one(`SELECT count(*)::int AS n FROM net.calls WHERE url LIKE '%send-notification-email'`)).n === 0 && medRow.data.emailDispatched === false);
check('medium: reason recorded', (await one(`SELECT email_skipped_reason r FROM public.admin_alert_deliveries ORDER BY id DESC LIMIT 1`)).r === 'below_email_severity');

await q(`UPDATE vault.decrypted_secrets SET name = 'X' WHERE name = 'SUPABASE_URL'`);
const nv = (await one(`SELECT public.fn_notify_admins('reconciliation_alert', 'critical', 'T', 'B') AS r`)).r;
check('vault missing: outbox still written, fan-out covers email',
  (await one(`SELECT data FROM public.notifications_outbox WHERE id = $1`, [nv.outbox_id])).data.emailDispatched === false &&
  (await one(`SELECT email_skipped_reason r FROM public.admin_alert_deliveries ORDER BY id DESC LIMIT 1`)).r === 'vault_missing');
await q(`UPDATE vault.decrypted_secrets SET name = 'SUPABASE_URL' WHERE name = 'X'`);

await q(`TRUNCATE net.calls`);
const retryPage = (await one(`SELECT public.fn_notify_admins('moderation_alert', 'high', 'Retry', 'failure') AS r`)).r;
const retryDelivery = await one(`SELECT * FROM public.admin_alert_deliveries WHERE outbox_id = $1`, [retryPage.outbox_id]);
const failedEmailRequest = retryDelivery.email_request_id;
await q(`INSERT INTO net._http_response (id, status_code, content) VALUES ($1, 200, '{"sent":0,"failed":1,"skipped":0}')`, [failedEmailRequest]);
await q(`SELECT public.fn_reconcile_admin_alert_emails()`);
check('confirmed email failure becomes retryable',
  (await one(`SELECT outcome FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [retryDelivery.id])).outcome === 'retryable');
await q(`UPDATE public.admin_alert_email_attempts SET next_attempt_at = now() WHERE delivery_id = $1`, [retryDelivery.id]);
await q(`SELECT public.fn_reconcile_admin_alert_emails()`);
const retryRequest = await one(`SELECT request_id, attempts, outcome FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [retryDelivery.id]);
check('confirmed email failure is retried once without expanding recipients',
  retryRequest.attempts === 2 && retryRequest.outcome === 'pending' &&
    JSON.stringify((await one(`SELECT body->'userIds' user_ids FROM net.calls WHERE id = $1`, [retryRequest.request_id])).user_ids) === JSON.stringify([A]));
await q(`INSERT INTO net._http_response (id, status_code, content) VALUES ($1, 200, '{"sent":1,"failed":0,"skipped":0}')`, [retryRequest.request_id]);
await q(`SELECT public.fn_reconcile_admin_alert_emails()`);
check('retried email is marked delivered',
  (await one(`SELECT outcome FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [retryDelivery.id])).outcome === 'delivered');

await q(`TRUNCATE net.calls`);
const ambiguousPage = (await one(`SELECT public.fn_notify_admins('moderation_alert', 'high', 'Ambiguous', 'timeout') AS r`)).r;
const ambiguousDelivery = await one(`SELECT * FROM public.admin_alert_deliveries WHERE outbox_id = $1`, [ambiguousPage.outbox_id]);
await q(`UPDATE public.ops_http_requests SET created_at = now() - interval '4 minutes' WHERE request_id = $1`, [ambiguousDelivery.email_request_id]);
await q(`SELECT public.fn_reconcile_admin_alert_emails()`);
check('missing response becomes ambiguous and is not resent',
  (await one(`SELECT outcome FROM public.admin_alert_email_attempts WHERE delivery_id = $1`, [ambiguousDelivery.id])).outcome === 'ambiguous' &&
    (await one(`SELECT count(*)::int n FROM net.calls WHERE url LIKE '%send-notification-email'`)).n === 1);

await q(`UPDATE public.admin_recipients SET enabled = false`);
const outboxBefore = (await one(`SELECT count(*)::int n FROM public.notifications_outbox`)).n;
const none = (await one(`SELECT public.fn_notify_admins('moderation_alert', 'critical', 'T', 'B') AS r`)).r;
check('empty list: returns 0, writes no outbox row, records it',
  none.recipients === 0 && (await one(`SELECT count(*)::int n FROM public.notifications_outbox`)).n === outboxBefore &&
  (await one(`SELECT email_skipped_reason r FROM public.admin_alert_deliveries ORDER BY id DESC LIMIT 1`)).r === 'no_recipients');
check('empty list: warns', notices.some((m) => m.includes('nobody was notified')));
await q(`UPDATE public.admin_recipients SET enabled = true`);

// ─── 4. Producers ───────────────────────────────────────────────────────────
console.log('\nproducers');
await q(`TRUNCATE net.calls`);
await q(`INSERT INTO public.reconciliation_findings (finding_type, severity, details) VALUES ('orphan_payout', 'critical', '{"payout_id":"po_1"}')`);
const crit = await one(`SELECT * FROM public.notifications_outbox WHERE title = 'Critical reconciliation finding' ORDER BY created_at DESC LIMIT 1`);
check('critical finding pages the list with email', crit && crit.data.emailDispatched === true && JSON.stringify(crit.recipients) === JSON.stringify([A]), crit);
check('critical finding coalescing still recorded', (await one(`SELECT count(*)::int n FROM public.reconciliation_alerts_sent WHERE finding_type = 'orphan_payout'`)).n === 1);
await q(`INSERT INTO public.reconciliation_findings (finding_type, severity) VALUES ('orphan_payout', 'critical')`);
check('second within the hour suppressed', (await one(`SELECT count(*)::int n FROM public.notifications_outbox WHERE title = 'Critical reconciliation finding'`)).n === 1);

await q(`SELECT public.fn_trust_review_page_admins('[Support] x', 'y', '{"disputeId": 7}')`);
const tr = await one(`SELECT * FROM public.notifications_outbox WHERE title = '[Support] x'`);
check('trust review page: high, emailed, keeps its data', tr.data.severity === 'high' && tr.data.emailDispatched === true && tr.data.disputeId === 7, tr.data);

// ─── 5. Ops alert lifecycle ─────────────────────────────────────────────────
console.log('\nops alert lifecycle');
const pages = async () => (await one(`SELECT count(*)::int n FROM public.notifications_outbox WHERE data->>'alertKey' = 'test-job'`)).n;
const alert = async () => one(`SELECT * FROM public.ops_alerts WHERE alert_key = 'test-job' ORDER BY opened_at DESC LIMIT 1`);
const check_ = () => q(`SELECT count(*) FROM public.fn_check_job_health()`);

await check_();
let a1 = await alert();
check('unhealthy: alert opens and pages once', a1 && a1.resolved_at === null && (await pages()) === 1 && a1.notify_count === 1, a1);
const firstPage = await one(`SELECT title, data FROM public.notifications_outbox WHERE data->>'alertKey' = 'test-job'`);
check('page is critical, emailed, says how to close it',
  firstPage.title === '[Ops] Failing: test-job' && firstPage.data.emailDispatched === true, firstPage);
await check_();
check('still failing: no second page', (await pages()) === 1);

await q(`SELECT public.record_job_heartbeat('test-job')`);
await check_();
a1 = await alert();
check('healthy: stays open, cleared_at set, nobody paged', a1.resolved_at === null && a1.cleared_at !== null && (await pages()) === 1, a1);

await q(`DELETE FROM public.job_health WHERE job_name = 'test-job'`);
await check_();
const a2 = await alert();
check('fails again: same alert, occurrences 2, no page', a2.id === a1.id && a2.occurrences === 2 && a2.cleared_at === null && (await pages()) === 1, a2);

await q(`UPDATE public.ops_alerts SET last_notified_at = now() - interval '25 hours' WHERE id = $1`, [a1.id]);
await check_();
const rem = await one(`SELECT title FROM public.notifications_outbox WHERE data->>'alertKey' = 'test-job' AND (data->>'reminder')::boolean`);
check('24h later: reminder page', (await pages()) === 2 && rem?.title === '[Ops] Still open: test-job', rem);

// acknowledge as admin A
const asUser = async (sub, role, fn) => {
  await q(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub, role: 'authenticated', app_metadata: role ? { role } : {} })]);
  await q(`SET ROLE authenticated`);
  try { return await fn(); } finally { await q(`RESET ROLE`); await q(`SELECT set_config('request.jwt.claims', '', false)`); }
};
const ackByN = await asUser(N, null, () => fails(`SELECT public.admin_ack_ops_alert($1)`, [a1.id]));
check('non-admin cannot acknowledge', ackByN && ackByN.includes('admin only'), ackByN);
const ackByA = await asUser(A, 'admin', () => fails(`SELECT public.admin_ack_ops_alert($1)`, [a1.id]));
check('admin acknowledges', ackByA === null && (await alert()).acknowledged_by === A, ackByA);
await q(`UPDATE public.ops_alerts SET last_notified_at = now() - interval '25 hours' WHERE id = $1`, [a1.id]);
await check_();
check('acknowledged within 24h: no reminder', (await pages()) === 2);
await q(`UPDATE public.ops_alerts SET acknowledged_at = now() - interval '25 hours' WHERE id = $1`, [a1.id]);
await check_();
check('acknowledgement older than 24h: reminder resumes', (await pages()) === 3);

const noNote = await asUser(A, 'admin', () => fails(`SELECT public.admin_resolve_ops_alert($1, '  ')`, [a1.id]));
check('resolve needs a note', noNote && noNote.includes('note is required'), noNote);
const resolved = await asUser(A, 'admin', () => fails(`SELECT public.admin_resolve_ops_alert($1, 'restarted the job')`, [a1.id]));
const r1 = await one(`SELECT * FROM public.ops_alerts WHERE id = $1`, [a1.id]);
check('admin resolves with a note', resolved === null && r1.resolved_at !== null && r1.resolved_by === A && r1.resolution_note === 'restarted the job', resolved);
const again = await asUser(A, 'admin', () => fails(`SELECT public.admin_resolve_ops_alert($1, 'again')`, [a1.id]));
check('resolving twice is refused', again && again.includes('is not open'), again);
await check_();
const a3 = await alert();
check('still failing after resolve: new alert, paged', a3.id !== a1.id && a3.resolved_at === null && (await pages()) === 4, a3);

const anonResolve = await (async () => { await q('SET ROLE anon'); try { return await fails(`SELECT public.admin_resolve_ops_alert($1, 'x')`, [a3.id]); } finally { await q('RESET ROLE'); } })();
check('anon cannot call resolve', anonResolve && anonResolve.includes('permission denied'), anonResolve);

// ─── 6. edge-auth-or-5xx attribution ────────────────────────────────────────
console.log('\nedge-auth-or-5xx attribution');
// Backdated: the probe's max_silence is 1 second, so a failure younger than
// that still reads as healthy (production checks every 5 minutes).
await q(`INSERT INTO net._http_response (id, status_code, content, created) VALUES
  (9001, 401, '{"error":"Unauthorized"}', now() - interval '2 minutes'),
  (9002, 401, '{"error":"Unauthorized"}', now() - interval '2 minutes')`);
await q(`INSERT INTO public.ops_http_requests (request_id, caller, target) VALUES (9001, 'notifications_outbox_dispatch', 'process-notification'), (9002, 'notifications_outbox_dispatch', 'process-notification')`);
await check_();
let ea = await one(`SELECT * FROM public.ops_alerts WHERE alert_key = 'edge-auth-or-5xx' AND resolved_at IS NULL`);
check('opens with kind=auth', ea?.detail?.cause?.kind === 'auth', ea?.detail);
check('headline names function, caller and status',
  /2 x 401 from process-notification \(via notifications_outbox_dispatch\)/.test(ea.summary), ea.summary);
check('groups carried in detail', ea.detail.cause.groups?.[0]?.n === 2 && ea.detail.cause.failures === 2, ea.detail.cause);

await q(`INSERT INTO cron.job_run_details (jobid, start_time, status) SELECT jobid, now() - interval '150 seconds', 'succeeded' FROM cron.job WHERE jobname = 'stripe-balance-reconciliation-hourly'`);
await q(`INSERT INTO net._http_response (id, status_code, error_msg, timed_out, created) VALUES (9003, NULL, 'Timeout of 55000 ms reached', true, now() - interval '2 minutes')`);
await check_();
ea = await one(`SELECT * FROM public.ops_alerts WHERE alert_key = 'edge-auth-or-5xx' AND resolved_at IS NULL`);
check('a timeout among 401s is kind=mixed, not auth', ea.detail.cause.kind === 'mixed', ea.detail.cause.kind);
check('unlabelled failure lists the cron job that fired before it',
  ea.detail.cause.cron_suspects?.[0]?.jobname === 'stripe-balance-reconciliation-hourly', ea.detail.cause.cron_suspects);

// ─── 7. Drain labels, retention, grants ─────────────────────────────────────
console.log('\ncron timeouts, drain, retention, grants');
const jobs = Object.fromEntries((await rows(`SELECT jobname, command FROM cron.job`)).map((r) => [r.jobname, r.command]));
check('money-sync job gets 150s', /timeout_milliseconds := 150000/.test(jobs['stripe-balance-reconciliation-hourly']) &&
  /admin-withdrawals/.test(jobs['stripe-balance-reconciliation-hourly']), jobs['stripe-balance-reconciliation-hourly']);
check('other jobs untouched', /timeout_milliseconds := 55000/.test(jobs['moderation-sweep-10min']));
await q(`TRUNCATE net.calls`);
await q(`UPDATE public.notifications_outbox SET scheduled_at = NULL, status = 'pending'`);
await q(`SELECT public.drain_notifications_outbox()`);
check('drain requests are labelled',
  (await one(`SELECT count(*)::int n FROM public.ops_http_requests WHERE caller = 'drain_notifications_outbox'`)).n > 0);

await q(`INSERT INTO public.ops_http_requests (request_id, caller, target, created_at) VALUES (777777, 'old', 'x', now() - interval '3 days')`);
await q(`SELECT public.fn_prune_job_health()`);
check('prune drops labels older than 2 days', (await one(`SELECT count(*)::int n FROM public.ops_http_requests WHERE request_id = 777777`)).n === 0);
check('prune keeps recent labels', (await one(`SELECT count(*)::int n FROM public.ops_http_requests`)).n > 0);

const anonNotify = await (async () => { await q('SET ROLE anon'); try { return await fails(`SELECT public.fn_notify_admins('x','high','t','b')`); } finally { await q('RESET ROLE'); } })();
check('anon cannot page admins', anonNotify && anonNotify.includes('permission denied'), anonNotify);
const authNotify = await asUser(N, null, () => fails(`SELECT public.fn_notify_admins('x','high','t','b')`));
check('signed-in user cannot page admins', authNotify && authNotify.includes('permission denied'), authNotify);
const selfAdd = await asUser(K, 'admin', () => fails(`INSERT INTO public.admin_recipients (user_id) VALUES ($1)`, [K]));
check('an admin cannot add themselves through the API', selfAdd && selfAdd.includes('permission denied'), selfAdd);
const serviceWrite = await (async () => {
  await q('SET ROLE service_role');
  try { return await fails(`UPDATE public.admin_recipients SET enabled = false WHERE user_id = $1`, [A]); }
  finally { await q('RESET ROLE'); }
})();
check('service_role cannot change the owner-managed paging list', serviceWrite && serviceWrite.includes('permission denied'), serviceWrite);
const nRead = await asUser(N, null, () => rows(`SELECT * FROM public.admin_recipients`));
check('non-admin reads no recipients', nRead.length === 0);
const aRead = await asUser(A, 'admin', () => rows(`SELECT * FROM public.admin_recipients`));
check('admin reads the list', aRead.length === 1);
const delRead = await asUser(N, null, () => rows(`SELECT * FROM public.admin_alert_deliveries`));
check('non-admin reads no deliveries', delRead.length === 0);
const labelRead = await asUser(A, 'admin', () => fails(`SELECT * FROM public.ops_http_requests`));
check('ops_http_requests not exposed to the API', labelRead && labelRead.includes('permission denied'), labelRead);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
