/* scripts/verify-closure-digest-pglite.mjs
 *
 * Functional checks for SBA-09
 * (supabase/migrations/20261020090000_hunter_closure_digest.sql) on an
 * in-process PostgreSQL + PostGIS (PGlite): the hold trigger on
 * notifications_outbox and fn_send_hunter_closure_digests.
 *
 * The schema is a minimal stand-in with production's columns and CHECK lists
 * (2026-10-19). Push_noti_manager is replaced by a trigger that logs what it
 * would have sent, and the distribution gate by a stub with its signature.
 * fn_bounty_request_distance (SBA-02), the BNTY-11 bounty-close trigger and
 * the migration under test are read from their migration files, so this
 * exercises the shipped SQL. The migration is applied twice (idempotency).
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite @electric-sql/pglite-postgis
 *     (or set PGLITE_DIR to a folder that has both)
 *   node scripts/verify-closure-digest-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { postgis } = await import(pathToFileURL(req.resolve('@electric-sql/pglite-postgis')).href);
const MIGRATION = fs.readFileSync(`${REPO}/supabase/migrations/20261020090000_hunter_closure_digest.sql`, 'utf8');
const ZOMBIE = fs.readFileSync(`${REPO}/supabase/migrations/20260919120000_close_zombie_applications_on_dead_bounties.sql`, 'utf8');

const db = await PGlite.create({ extensions: { postgis } });
const notices = [];
const q = (sql, params) => db.query(sql, params, { onNotice: (n) => notices.push(n.message) });
const one = async (sql, params) => (await q(sql, params)).rows[0];
const rows = async (sql, params) => (await q(sql, params)).rows;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

// ─── Supabase-ish base ──────────────────────────────────────────────────────
await db.exec(`
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, last_sign_in_at timestamptz);

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS
  $$ DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, username text, is_internal boolean DEFAULT false, deleted_at timestamptz,
  account_status text DEFAULT 'active', last_session_at timestamptz, notification_timezone text,
  quiet_hours_start smallint, quiet_hours_end smallint, geom geography(Point, 4326));
CREATE TABLE public.bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), poster_id uuid, user_id uuid, title text,
  amount numeric DEFAULT 0, status text NOT NULL DEFAULT 'open', work_type text NOT NULL DEFAULT 'online',
  accepted_by uuid, accepted_request_id uuid, is_test boolean DEFAULT false, is_stale boolean DEFAULT false,
  stale_reason text, deadline timestamptz, geom geography(Point, 4326), created_at timestamptz DEFAULT now());
CREATE TABLE public.bounty_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, hunter_id uuid, poster_id uuid,
  status text DEFAULT 'pending', accepted_at timestamp, rejected_at timestamp, rejection_source text,
  poster_interacted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, title text NOT NULL,
  body text NOT NULL, data jsonb, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  stripe_payout_id text, category text, count integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
  CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['marketplace'::text, 'messages'::text, 'payments'::text, 'security'::text, 'verification'::text, 'followers'::text, 'marketing'::text]))),
  CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['application'::text, 'acceptance'::text, 'completion'::text, 'payment'::text, 'message'::text, 'follow'::text, 'cancellation_request'::text, 'cancellation_accepted'::text, 'cancellation_rejected'::text, 'dispute_created'::text, 'dispute_resolved'::text, 'workflow_dispute_created'::text, 'stale_bounty'::text, 'stale_bounty_cancelled'::text, 'stale_bounty_reposted'::text, 'update'::text, 'review_needed'::text, 'balance_update'::text, 'bounty_nearby'::text, 'bounty_expiry'::text, 'dispute_escalated'::text, 'account_warning'::text, 'account_restricted'::text, 'payout_paid'::text, 'payout_failed'::text, 'payout_canceled'::text, 'withdrawal_reversed'::text, 'bank_disconnected'::text, 'payout_method_changed'::text, 'verification_submitted'::text, 'verification_verified'::text, 'verification_rejected'::text, 'verification_canceled'::text, 'marketing_promo'::text, 'reconciliation_alert'::text, 'reconciliation_digest'::text, 'bounty_quality_nudge'::text, 'application_pending_reminder'::text, 'application_expired'::text, 'rating_reminder'::text, 'application_bounty_closed'::text, 'payout_setup_required'::text, 'release_waiting_on_hunter'::text, 'bounty_location_nudge'::text]))));
CREATE TABLE public.notifications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text, bounty_id text,
  recipients jsonb, title text, body text, data jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
  stripe_payment_intent_id text, bundle_key text, count integer NOT NULL DEFAULT 1, delivery_errors jsonb);
-- Stands in for Push_noti_manager (AFTER INSERT -> process-notification).
CREATE TABLE public.push_dispatch_log (outbox_id uuid, type text, at timestamptz DEFAULT now());
CREATE FUNCTION public.fake_push_noti_manager() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.push_dispatch_log (outbox_id, type) VALUES (NEW.id, NEW.data->>'type'); RETURN NEW; END $$;
CREATE TRIGGER "Push_noti_manager" AFTER INSERT ON public.notifications_outbox FOR EACH ROW EXECUTE FUNCTION public.fake_push_noti_manager();
CREATE TABLE public.notification_channel_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text, channel text, enabled boolean,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.hunter_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hunter_id uuid, label text DEFAULT 'Primary', latitude double precision,
  longitude double precision, radius_miles double precision, is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.bounty_distribution_decisions (
  bounty_id uuid, path text, stage smallint, decision text, reasons text[], credibility text[],
  last_evaluated_at timestamptz DEFAULT now(), eval_count integer DEFAULT 1,
  CONSTRAINT bounty_distribution_decisions_decision_check CHECK ((decision = ANY (ARRAY['allowed'::text, 'skipped'::text]))),
  CONSTRAINT bounty_distribution_decisions_path_check CHECK ((path = ANY (ARRAY['escalation'::text, 'radius'::text, 'zip'::text, 'service_area'::text, 'targeting'::text]))),
  UNIQUE (bounty_id, path, stage, decision));
CREATE TABLE public.gate_block (bounty_id uuid PRIMARY KEY);
-- Gate stub: same signature, records decisions (exercises the path CHECK).
CREATE FUNCTION public.fn_bounty_distribution_gate(p_bounty_id uuid, p_path text, p_stage smallint, p_require_credibility boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_allowed boolean := NOT EXISTS (SELECT 1 FROM gate_block g WHERE g.bounty_id = p_bounty_id);
BEGIN
  INSERT INTO bounty_distribution_decisions AS d (bounty_id, path, stage, decision, reasons, credibility)
  VALUES (p_bounty_id, p_path, p_stage, CASE WHEN v_allowed THEN 'allowed' ELSE 'skipped' END,
          CASE WHEN v_allowed THEN '{}'::text[] ELSE ARRAY['blocked'] END, '{}')
  ON CONFLICT (bounty_id, path, stage, decision) DO UPDATE SET eval_count = d.eval_count + 1;
  RETURN jsonb_build_object('allowed', v_allowed);
END $$;
CREATE TABLE public.job_health_expectations (job_name text PRIMARY KEY, max_silence interval, probe_sql text, description text,
  enabled boolean DEFAULT true, registered_at timestamptz DEFAULT now());
CREATE TABLE public.job_health (job_name text, at timestamptz DEFAULT now(), detail jsonb);
CREATE FUNCTION public.record_job_heartbeat(p_job_name text, p_detail jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.job_health (job_name, detail) VALUES (p_job_name, p_detail) $$;
`);

// fn_bounty_request_distance exactly as 20261019200000 (section 2).
const dist = fs.readFileSync(`${REPO}/supabase/migrations/20261019200000_applicant_distance.sql`, 'utf8');
const distFn = dist.slice(dist.indexOf('CREATE OR REPLACE FUNCTION public.fn_bounty_request_distance('),
                          dist.indexOf('COMMENT ON FUNCTION public.fn_bounty_request_distance'));
await db.exec(distFn);

// The real BNTY-11 close trigger (function + trigger only, not its backfill).
const zStart = ZOMBIE.indexOf('CREATE OR REPLACE FUNCTION public.fn_reject_pending_requests_on_bounty_close()');
const zEnd = ZOMBIE.indexOf('COMMENT ON FUNCTION public.fn_reject_pending_requests_on_bounty_close()');
await db.exec(ZOMBIE.slice(zStart, zEnd));

// ─── Apply the migration (twice: must be idempotent) ────────────────────────
await db.exec(MIGRATION);
await db.exec(MIGRATION);
console.log('migration applied twice');

const typeDef = (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='notifications_type_check'`)).d;
check('type check keeps every old value and adds the digest once',
  typeDef.includes(`'bounty_location_nudge'::text`) && typeDef.includes(`'application_expired'::text`)
  && (typeDef.match(/application_closure_digest/g) || []).length === 1, typeDef);
const pathDef = (await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='bounty_distribution_decisions_path_check'`)).d;
check('path check adds closure_digest once', (pathDef.match(/closure_digest/g) || []).length === 1 && pathDef.includes(`'targeting'::text`), pathDef);
check('cron job scheduled once', (await one(`SELECT count(*)::int n FROM cron.job WHERE jobname='hunter-closure-digest-hourly' AND schedule='7 * * * *'`)).n === 1);
check('job health expectation', (await one(`SELECT count(*)::int n FROM job_health_expectations WHERE job_name='hunter-closure-digest-hourly'`)).n === 1);

// ─── Fixtures ───────────────────────────────────────────────────────────────
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (lon, lat) => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
// Hunters 1..9, posters 20.., all around Austin TX (-97.74, 30.27).
await db.exec(`
INSERT INTO profiles (id, username, geom) VALUES
  ('${U(1)}', 'h1-many', ${P(-97.74, 30.27)}),
  ('${U(2)}', 'h2-single', ${P(-97.74, 30.27)}),
  ('${U(3)}', 'h3-inapp-off', ${P(-97.74, 30.27)}),
  ('${U(4)}', 'h4-quiet', ${P(-97.74, 30.27)}),
  ('${U(5)}', 'h5-nogeom', NULL),
  ('${U(6)}', 'h6-anywhere', ${P(-97.74, 30.27)}),
  ('${U(7)}', 'h7-radius10', ${P(-97.74, 30.27)}),
  ('${U(8)}', 'h8-deleted', ${P(-97.74, 30.27)}),
  ('${U(9)}', 'h9-recent-digest', ${P(-97.74, 30.27)}),
  ('${U(20)}', 'poster-active', NULL),
  ('${U(21)}', 'poster-internal', NULL),
  ('${U(22)}', 'poster-gone-quiet', NULL);
UPDATE profiles SET is_internal = true WHERE id = '${U(21)}';
UPDATE profiles SET deleted_at = now() WHERE id = '${U(8)}';
UPDATE profiles SET last_session_at = now() - interval '1 day' WHERE id IN ('${U(20)}', '${U(21)}');
UPDATE profiles SET last_session_at = now() - interval '20 days' WHERE id = '${U(22)}';
INSERT INTO auth.users (id, last_sign_in_at) SELECT id, NULL FROM profiles;
INSERT INTO notification_channel_preferences (user_id, category, channel, enabled) VALUES ('${U(3)}', 'marketplace', 'in_app', false);
INSERT INTO hunter_service_areas (hunter_id, radius_miles, is_primary) VALUES ('${U(6)}', NULL, true), ('${U(7)}', 10, true);
-- h9 got a digest 19h ago under yesterday's date.
`);

// Bounties the hunters applied to (these will close). Internal poster, so they are never offered back.
const closedTitles = ['Fix the backyard fence before the storm', 'Mow lawn', 'Walk dog', 'Clean gutters'];
const closing = {};
for (const t of closedTitles) {
  closing[t] = (await one(`INSERT INTO bounties (poster_id, title, work_type, created_at) VALUES ($1, $2, 'online', now() - interval '5 days') RETURNING id`, [U(21), t])).id;
}
// Live listings that may be offered.
const alt = {};
async function addAlt(key, cols) {
  const c = { poster_id: U(20), title: key, work_type: 'online', status: 'open', created_at: "now() - interval '1 day'", ...cols };
  const r = await one(`INSERT INTO bounties (poster_id, title, work_type, status, is_test, is_stale, deadline, created_at, geom)
    VALUES ($1, $2, $3, $4, $5, $6, ${c.deadline ?? 'NULL'}, ${c.created_at}, ${c.geom ?? 'NULL'}) RETURNING id`,
    [c.poster_id, c.title, c.work_type, c.status, c.is_test ?? false, c.is_stale ?? false]);
  alt[key] = r.id;
}
await addAlt('Online logo', { created_at: "now() - interval '2 days'" });
await addAlt('Online newer', { created_at: "now() - interval '1 hour'" });
await addAlt('Near 5mi', { work_type: 'in_person', geom: P(-97.74, 30.34) });     // ~4.8 mi
await addAlt('Far 40mi', { work_type: 'in_person', geom: P(-97.74, 30.85) });     // ~40 mi
await addAlt('Test listing', { is_test: true });
await addAlt('Internal poster', { poster_id: U(21) });
await addAlt('Quiet poster', { poster_id: U(22), created_at: "now() - interval '20 days'" });
await addAlt('Already applied', {});
await addAlt('Gate blocked', {});
await addAlt('Stale', { is_stale: true });
await addAlt('Deadline passed', { deadline: "now() - interval '1 hour'" });
await addAlt('In progress', { status: 'in_progress' });
await q(`INSERT INTO gate_block VALUES ($1)`, [alt['Gate blocked']]);
for (const h of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  await q(`INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id, status, rejection_source) VALUES ($1, $2, $3, 'rejected', 'poster')`,
    [alt['Already applied'], U(h), U(20)]);
}

// Pending applications: h1 to all four, others to one each.
async function apply(h, title) {
  return (await one(`INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3) RETURNING id`, [closing[title], U(h), U(21)])).id;
}
const reqs = {};
for (const t of closedTitles) reqs[`1:${t}`] = await apply(1, t);
for (const h of [2, 3, 4, 5, 6, 7, 8, 9]) reqs[`${h}:Mow lawn`] = await apply(h, 'Mow lawn');

// Producer shapes. Expiry and sweep: UPDATE ... RETURNING then INSERT ... RETURNING in one statement.
async function expire(reqId, reason = 'no_response') {
  return rows(`
    WITH expired AS (
      UPDATE bounty_requests br SET status = 'rejected', rejection_source = 'system_expiry'
      WHERE br.id = $1 RETURNING br.id, br.bounty_id, br.hunter_id
    ), notified AS (
      INSERT INTO notifications_outbox (recipients, title, body, data, bounty_id)
      SELECT jsonb_build_array(e.hunter_id), 'Application closed',
             'The poster didn''t make a decision in time, so this application closed automatically -- this wasn''t a rejection. Feel free to apply to other bounties nearby.',
             jsonb_build_object('type', 'application_expired', 'bountyId', e.bounty_id, 'applicationId', e.id,
                                'requestId', e.id, 'reason', $2::text),
             e.bounty_id::text
      FROM expired e RETURNING 1
    ) SELECT e.id FROM expired e`, [reqId, reason]);
}

console.log('\nhold');
const before = (await one(`SELECT count(*)::int n FROM notifications_outbox`)).n;
const exp1 = await expire(reqs['1:Fix the backyard fence before the storm']);
check('producer statement still returns its closed row', exp1.length === 1);
check('held notice is not stored in the outbox', (await one(`SELECT count(*)::int n FROM notifications_outbox`)).n === before);
check('held notice never reaches the push dispatcher', (await one(`SELECT count(*)::int n FROM push_dispatch_log`)).n === 0);
const item1 = await one(`SELECT * FROM hunter_closure_items WHERE request_id = $1`, [reqs['1:Fix the backyard fence before the storm']]);
check('closure recorded with its bounty title and reason', item1 && item1.bounty_title === 'Fix the backyard fence before the storm' && item1.reason === 'no_response' && item1.digest_id === null, item1);
const n1 = await one(`SELECT * FROM notifications WHERE id = $1`, [item1?.notification_id]);
check('silent in-app row: read, heldForDigest, original copy', n1 && n1.read === true && n1.data.heldForDigest === true && n1.type === 'application_expired' && n1.title === 'Application closed', n1);
check('silent row has no requestId (no poster buttons) but keeps applicationId', n1 && !('requestId' in n1.data) && n1.data.applicationId === reqs['1:Fix the backyard fence before the storm'], n1?.data);

for (const t of ['Mow lawn', 'Walk dog']) await expire(reqs[`1:${t}`], 'poster_absent');
// The real BNTY-11 trigger: the bounty leaves open with h1's application pending.
await q(`UPDATE bounties SET status = 'cancelled' WHERE id = $1`, [closing['Clean gutters']]);
const gut = await one(`SELECT * FROM hunter_closure_items WHERE request_id = $1`, [reqs['1:Clean gutters']]);
check('bounty-close trigger notice is held too', gut && gut.notification_type === 'application_bounty_closed', gut);
check('still nothing dispatched', (await one(`SELECT count(*)::int n FROM push_dispatch_log`)).n === 0);

// Repeat notice for an already-recorded request: dropped, no second row.
await q(`INSERT INTO notifications_outbox (recipients, title, body, data) VALUES (jsonb_build_array($1::uuid), 'Application closed', 'x',
  jsonb_build_object('type','application_expired','bountyId',$2::uuid,'applicationId',$3::uuid,'requestId',$3::uuid))`,
  [U(1), closing['Mow lawn'], reqs['1:Mow lawn']]);
check('repeat notice for the same application is dropped', (await one(`SELECT count(*)::int n FROM hunter_closure_items WHERE hunter_id=$1`, [U(1)])).n === 4
  && (await one(`SELECT count(*)::int n FROM notifications WHERE user_id=$1`, [U(1)])).n === 4);

for (const h of [2, 3, 4, 5, 6, 7, 8, 9]) await expire(reqs[`${h}:Mow lawn`]);
const h3 = await one(`SELECT i.notification_id, (SELECT count(*)::int FROM notifications n WHERE n.user_id = $1) AS n FROM hunter_closure_items i WHERE i.hunter_id = $1`, [U(3)]);
check('in-app marketplace off: recorded, no in-app row', h3 && h3.notification_id === null && h3.n === 0, h3);

// Pass-through cases.
await q(`INSERT INTO notifications_outbox (recipients, title, body, data) VALUES (jsonb_build_array($1::uuid, $2::uuid), 't', 'b', '{"type":"application_expired"}')`, [U(1), U(2)]);
await q(`INSERT INTO notifications_outbox (recipients, title, body, data) VALUES ('["not-a-uuid"]', 't', 'b', '{"type":"application_expired"}')`);
await q(`INSERT INTO notifications_outbox (recipients, title, body, data) VALUES (jsonb_build_array($1::uuid), 't', 'b', '{"type":"application"}')`, [U(20)]);
const passed = await rows(`SELECT type FROM push_dispatch_log ORDER BY at`);
check('two-recipient row, bad recipient and other types pass through unchanged', passed.length === 3, passed);
check('the bad-recipient pass-through logged a warning', notices.some((m) => m.includes('sending application_expired') && m.includes('immediately')), notices);
await db.exec(`DELETE FROM push_dispatch_log; DELETE FROM notifications_outbox;`);

// h9 had a digest 19 hours ago, dated yesterday.
await q(`INSERT INTO hunter_closure_digests (hunter_id, local_date, time_zone, item_count, sent_at)
         VALUES ($1, (now() AT TIME ZONE 'America/Chicago')::date - 1, 'America/Chicago', 1, now() - interval '19 hours')`, [U(9)]);
// h4: valid timezone with quiet hours covering right now.
const chiMin = (await one(`SELECT (extract(hour FROM now() AT TIME ZONE 'America/Chicago') * 60 + extract(minute FROM now() AT TIME ZONE 'America/Chicago'))::int m`)).m;
await q(`UPDATE profiles SET notification_timezone = 'America/Chicago', quiet_hours_start = $2, quiet_hours_end = $3 WHERE id = $1`,
  [U(4), (chiMin + 1440 - 30) % 1440, (chiMin + 30) % 1440]);
// h5: quiet hours but no timezone -> process-notification never blocks, so neither do we.
await q(`UPDATE profiles SET quiet_hours_start = $2, quiet_hours_end = $3 WHERE id = $1`, [U(5), (chiMin + 1440 - 30) % 1440, (chiMin + 30) % 1440]);

console.log('\ndigest');
const chiHour = Math.floor(chiMin / 60);
if (chiHour < 23) {
  const notDue = await rows(`SELECT * FROM fn_send_hunter_closure_digests(true, $1)`, [chiHour + 1]);
  check('before the local send hour nobody is due', notDue.length === 0, notDue);
}
// A hunter in a zone where it is already past the hour while Chicago is not.
const dry = await rows(`SELECT * FROM fn_send_hunter_closure_digests(true, 0)`);
check('dry run lists due hunters: 1,2,3,5,6,7 (not quiet 4, deleted 8, recent 9)',
  JSON.stringify(dry.map((r) => r.hunter_id).sort()) === JSON.stringify([1, 2, 3, 5, 6, 7].map(U)), dry.map((r) => r.hunter_id));
check('dry run writes nothing', (await one(`SELECT count(*)::int n FROM notifications_outbox`)).n === 0
  && (await one(`SELECT count(*)::int n FROM hunter_closure_digests`)).n === 1);

const sent = await rows(`SELECT * FROM fn_send_hunter_closure_digests(false, 0)`);
check('real run sends to the same six hunters', sent.length === 6 && sent.every((r) => r.outbox_id), sent);
const out = Object.fromEntries((await rows(`SELECT recipients->>0 AS h, title, body, data, count, bounty_id FROM notifications_outbox`)).map((r) => [r.h, r]));
const d1 = out[U(1)];
console.log('    h1 title:', d1?.title, '\n    h1 body: ', d1?.body);
check('h1: "4 of your applications closed"', d1?.title === '4 of your applications closed');
check('h1: two titles, "and 2 more", not-a-rejection line', d1?.body.startsWith('"Fix the backyard fence before t…", "Mow lawn" and 2 more closed automatically — this wasn\'t a rejection.'), d1?.body);
check('h1: alternatives = near in-person first, then newest online, max 3',
  JSON.stringify(d1?.data.alternatives.map((a) => a.title)) === JSON.stringify(['Near 5mi', 'Online newer', 'Online logo']), d1?.data.alternatives);
check('h1: body names the alternatives', d1?.body.endsWith('Still open for you: "Near 5mi", "Online newer" and "Online logo".'), d1?.body);
check('h1: items carry each application, oldest first', d1?.data.items.length === 4 && d1.data.items[0].requestId === reqs['1:Fix the backyard fence before the storm']
  && d1.data.items[3].type === 'application_bounty_closed', d1?.data.items);
check('h1: bountyId = first alternative, no top-level requestId, count 1',
  d1?.data.bountyId === alt['Near 5mi'] && d1?.bounty_id === alt['Near 5mi'] && !('requestId' in d1.data) && d1.count === 1, d1);
check('digest goes to the push dispatcher (not held)', (await one(`SELECT count(*)::int n FROM push_dispatch_log WHERE type='application_closure_digest'`)).n === 6);
const d2 = out[U(2)];
check('single closure: \'Your application to "Mow lawn" closed\'', d2?.title === 'Your application to "Mow lawn" closed' && d2.body.startsWith('It closed automatically — this wasn\'t a rejection.'), d2);
check('no geom: only online alternatives', JSON.stringify(out[U(5)]?.data.alternatives.map((a) => a.title)) === JSON.stringify(['Online newer', 'Online logo']), out[U(5)]?.data.alternatives);
check('"Anywhere" radius: far in-person listing qualifies', out[U(6)]?.data.alternatives.map((a) => a.title).includes('Far 40mi'), out[U(6)]?.data.alternatives);
check('default 25 mi: far listing excluded', !d1?.data.alternatives.some((a) => a.title === 'Far 40mi'));
check('10 mi radius: near (≈5 mi) kept, far dropped', JSON.stringify(out[U(7)]?.data.alternatives.map((a) => a.title)) === JSON.stringify(['Near 5mi', 'Online newer', 'Online logo']), out[U(7)]?.data.alternatives);
const excluded = ['Test listing', 'Internal poster', 'Quiet poster', 'Already applied', 'Gate blocked', 'Stale', 'Deadline passed', 'In progress'];
const offered = new Set(Object.values(out).flatMap((r) => r.data.alternatives.map((a) => a.title)));
check('never offered: test, internal, inactive poster, applied, gated, stale, past deadline, not open', excluded.every((t) => !offered.has(t)), [...offered]);
check('gate decisions recorded under path closure_digest', (await one(`SELECT count(*)::int n FROM bounty_distribution_decisions WHERE path='closure_digest'`)).n > 0);
check('items marked with their digest', (await one(`SELECT count(*)::int n FROM hunter_closure_items WHERE digest_id IS NULL`)).n === 3,
  await rows(`SELECT hunter_id FROM hunter_closure_items WHERE digest_id IS NULL`));

// Same day: a second run sends nothing, and a new closure waits for tomorrow.
await q(`DELETE FROM push_dispatch_log`);
const again = await rows(`SELECT * FROM fn_send_hunter_closure_digests(false, 0)`);
check('second run the same day sends nothing', again.length === 0, again);
const r2b = (await one(`INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3) RETURNING id`, [alt['Online logo'], U(2), U(20)])).id;
await expire(r2b);
const later = await rows(`SELECT * FROM fn_send_hunter_closure_digests(false, 0)`);
check('a closure after today\'s digest is held for the next day', later.length === 0
  && (await one(`SELECT count(*)::int n FROM hunter_closure_items WHERE hunter_id=$1 AND digest_id IS NULL`, [U(2)])).n === 1);
check('nothing dispatched by the reruns', (await one(`SELECT count(*)::int n FROM push_dispatch_log`)).n === 0);

// Tomorrow (simulated by moving today's digest back a day and 21h).
await q(`UPDATE hunter_closure_digests SET local_date = local_date - 1, sent_at = sent_at - interval '21 hours' WHERE hunter_id = $1`, [U(2)]);
const tomorrow = await rows(`SELECT * FROM fn_send_hunter_closure_digests(false, 0)`);
check('next day: h2 gets exactly one digest for the new closure', tomorrow.length === 1 && tomorrow[0].hunter_id === U(2) && tomorrow[0].item_count === 1, tomorrow);

// Invalid timezone falls back to Chicago.
await q(`UPDATE profiles SET notification_timezone = 'Mars/Olympus' WHERE id = $1`, [U(9)]);
await q(`UPDATE hunter_closure_digests SET sent_at = now() - interval '25 hours' WHERE hunter_id = $1`, [U(9)]);
const tz = await rows(`SELECT * FROM fn_send_hunter_closure_digests(true, 0)`);
check('invalid timezone -> America/Chicago', tz.find((r) => r.hunter_id === U(9))?.time_zone === 'America/Chicago', tz);

// No alternatives: the line is left out and there is no bountyId to route to.
await q(`INSERT INTO gate_block SELECT id FROM bounties ON CONFLICT DO NOTHING`);
const none = await rows(`SELECT * FROM fn_send_hunter_closure_digests(false, 0)`);
const n9 = await one(`SELECT title, body, data, bounty_id FROM notifications_outbox WHERE recipients->>0 = $1`, [U(9)]);
check('no alternatives: no "Still open" line, no bountyId', none.length === 1 && none[0].alternative_count === 0
  && n9 && !n9.body.includes('Still open') && !('bountyId' in n9.data) && n9.bounty_id === null
  && JSON.stringify(n9.data.alternatives) === '[]', n9);

// Grants: nobody but service_role.
const priv = await one(`SELECT
  has_function_privilege('anon', 'public.fn_send_hunter_closure_digests(boolean,integer)', 'EXECUTE') a1,
  has_function_privilege('authenticated', 'public.fn_send_hunter_closure_digests(boolean,integer)', 'EXECUTE') a2,
  has_function_privilege('authenticated', 'public.fn_hold_hunter_closure_notice()', 'EXECUTE') a3,
  has_function_privilege('service_role', 'public.fn_send_hunter_closure_digests(boolean,integer)', 'EXECUTE') s1,
  has_table_privilege('anon', 'public.hunter_closure_items', 'SELECT') t1,
  has_table_privilege('authenticated', 'public.hunter_closure_digests', 'SELECT') t2,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hunter_closure_items'::regclass) rls1,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hunter_closure_digests'::regclass) rls2,
  (SELECT proconfig FROM pg_proc WHERE proname = 'fn_send_hunter_closure_digests') cfg`);
check('grants: only service_role executes; tables closed; RLS on; fixed search_path',
  !priv.a1 && !priv.a2 && !priv.a3 && priv.s1 && !priv.t1 && !priv.t2 && priv.rls1 && priv.rls2 && String(priv.cfg).includes('search_path'), priv);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
