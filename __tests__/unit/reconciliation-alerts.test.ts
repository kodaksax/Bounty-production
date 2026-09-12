/**
 * Phase 4 — critical reconciliation findings must reach a human.
 *
 * Before this, a critical finding inserted a row and printed a log line whose
 * own comment called the prefix "the searchable key". 953 findings accumulated
 * that way, including a hunter paid $38 in cash outside the app because a
 * payout never landed.
 *
 * The interesting failures in this area are all SILENT — an alert that is
 * enqueued, reports success, and is never delivered. So the behavioural tests
 * below exercise the real taxonomy functions to prove delivery is not
 * suppressible, rather than only asserting that an insert exists.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  categoryForNotificationType,
  isForcedChannel,
  isUrgentNotification,
  NOTIFICATION_TYPE_CATEGORY,
} from '../../lib/config/notification-taxonomy';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

// Renamed from their original 20260824020000-020400 filenames during the
// 2026-09-12 notification overhaul, when this whole chain was actually
// applied for the first time (it had sat unapplied in git since 08-24) --
// the migration ledger records the real applied versions below.
const typeMigration = read(
  'supabase/migrations/20260912033911_reconciliation_alert_notification_type.sql'
);
const plumbing = read('supabase/migrations/20260912033941_reconciliation_alert_plumbing.sql');
const triggerSql = read(
  'supabase/migrations/20260912034020_alert_on_critical_finding_trigger.sql'
);
const digestSql = read(
  'supabase/migrations/20260912034056_unresolved_findings_daily_digest.sql'
);
const scheduleSql = read(
  'supabase/migrations/20260912034125_schedule_reconciliation_invariant_sweep.sql'
);
const processNotification = read('supabase/functions/process-notification/index.ts');
const reconciliationSource = read('supabase/functions/reconciliation/index.ts');

const stripSqlComments = (sql: string) =>
  sql
    .split('\n')
    .map(l => l.replace(/--.*$/, ''))
    .join('\n');

// ─── Delivery is not suppressible ───────────────────────────────────────────
// This is the half that would have failed silently. An unregistered type falls
// back to the 'marketplace' category, which is user-disableable and
// quiet-hours suppressed — the alert would enqueue, report sent, and never
// wake anyone at 3am.

describe('the alert actually reaches a human', () => {
  test('reconciliation_alert is a registered type, not an unmapped fallback', () => {
    expect(NOTIFICATION_TYPE_CATEGORY).toHaveProperty('reconciliation_alert');
    expect(categoryForNotificationType('reconciliation_alert')).toBe('security');
    // Prove the fallback is what we avoided: an unknown type lands here.
    expect(categoryForNotificationType('not_a_real_type')).toBe('marketplace');
  });

  test('push and in-app cannot be disabled by the recipient', () => {
    const category = categoryForNotificationType('reconciliation_alert');
    expect(isForcedChannel(category, 'push')).toBe(true);
    expect(isForcedChannel(category, 'in_app')).toBe(true);
    // Email stays user-controllable by design, for every category.
    expect(isForcedChannel(category, 'email')).toBe(false);
  });

  test('it bypasses quiet hours', () => {
    expect(isUrgentNotification('reconciliation_alert')).toBe(true);
    // Contrast: a marketplace-category type does not.
    expect(isUrgentNotification('bounty_nearby')).toBe(false);
  });

  test('the edge function and client taxonomies agree on the category', () => {
    // process-notification keeps a hand-maintained mirror of the client map,
    // because Deno's bundler cannot import from lib/. Drift here means the
    // push category and the in-app category disagree.
    expect(processNotification).toMatch(/reconciliation_alert:\s*'security'/);
    expect(NOTIFICATION_TYPE_CATEGORY.reconciliation_alert).toBe('security');
  });

  test('the DB accepts the type, so the in-app half is not dropped', () => {
    // public.notifications has a CHECK enumerating permitted types. An
    // unregistered value fails the constraint and the in-app notification never
    // lands — while the outbox row still reads 'sent'.
    expect(typeMigration).toMatch(/ADD CONSTRAINT notifications_type_check/);
    expect(typeMigration).toMatch(/'reconciliation_alert'/);
    // And the pre-existing types must survive the constraint rewrite.
    for (const preserved of [
      'application', 'payout_paid', 'payout_failed', 'dispute_created',
      'verification_verified', 'marketing_promo', 'balance_update',
    ]) {
      expect(typeMigration).toContain(`'${preserved}'`);
    }
  });
});

// ─── The trigger ────────────────────────────────────────────────────────────

describe('fn_alert_on_critical_finding', () => {
  test('fires only for critical severity, evaluated by Postgres', () => {
    expect(triggerSql).toMatch(
      /CREATE TRIGGER trg_reconciliation_findings_critical_alert\s+AFTER INSERT ON public\.reconciliation_findings\s+FOR EACH ROW\s+WHEN \(NEW\.severity = 'critical'\)/
    );
  });

  test('enqueues through notifications_outbox rather than a new channel', () => {
    // Reuse, not invention: the outbox is drained every minute and produces
    // both an in-app entry and a push. No Slack webhook exists in this repo.
    expect(triggerSql).toMatch(/INSERT INTO public\.notifications_outbox/);
    expect(triggerSql).not.toMatch(/slack|webhook_url/i);
  });

  test("uses the 'type' key process-notification actually reads", () => {
    // process-notification reads outboxData.type. A descriptive-but-wrong key
    // like 'kind' would silently take the 'system' default.
    expect(triggerSql).toMatch(/'type',\s*'reconciliation_alert'/);
  });

  test('fails open: an alerting error never rolls back the finding', () => {
    // A finding that vanishes is worse than one that arrives quietly. The
    // reconciliation function already had a bug where every findings insert
    // failed a CHECK and the error was swallowed, so the job reported healthy
    // counts while writing nothing for weeks.
    const fn = triggerSql.slice(
      triggerSql.indexOf('FUNCTION public.fn_alert_on_critical_finding()'),
      triggerSql.indexOf('COMMENT ON FUNCTION public.fn_alert_on_critical_finding')
    );
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(fn).toMatch(/RAISE WARNING/);
    // Must not re-raise.
    expect(stripSqlComments(fn)).not.toMatch(/RAISE EXCEPTION/);
  });

  test('warns loudly when there is no recipient instead of reporting success', () => {
    expect(triggerSql).toMatch(/NO admin recipient/);
  });

  test('coalesces repeats of the same finding_type within an hour', () => {
    expect(triggerSql).toMatch(/reconciliation_alerts_sent/);
    expect(triggerSql).toMatch(/sent_at > now\(\) - INTERVAL '1 hour'/);
  });

  test('seeds the known backlog so the first scheduled run pages only for new things', () => {
    // 28 open critical findings exist and are already documented and scheduled
    // for human decision. An alerting system whose debut is 28 simultaneous
    // pages teaches its recipients to mute it.
    expect(triggerSql).toMatch(
      /INSERT INTO public\.reconciliation_alerts_sent[\s\S]*?FROM public\.reconciliation_findings[\s\S]*?severity = 'critical'/
    );
    // Per-type, not a blanket suppression window: a type absent from today's
    // backlog must still page the first time it appears.
    expect(triggerSql).toMatch(/SELECT DISTINCT f\.finding_type/);
  });
});

// ─── Recipients ─────────────────────────────────────────────────────────────

describe('fn_admin_recipient_ids', () => {
  test('reads auth.users app_metadata, never the dead profiles.role column', () => {
    expect(plumbing).toMatch(/raw_app_meta_data->>'role' = 'admin'/);

    // Scope to the function BODY. The COMMENT ON for this function names
    // profiles.role in prose precisely to warn people off it, and asserting
    // against the whole file would match that warning rather than the code.
    const body = plumbing.slice(
      plumbing.indexOf('RETURNS uuid[]'),
      plumbing.indexOf('COMMENT ON FUNCTION public.fn_admin_recipient_ids')
    );
    expect(body).toMatch(/array_agg\(u\.id\)/); // sanity: we sliced real code
    // profiles.role returns 0 rows in production. An implementation reading it
    // addresses nobody, dispatches nothing, and reports success.
    expect(stripSqlComments(body)).not.toMatch(/profiles\.role|p\.role/);
  });

  test('requires a profiles row, since delivery resolves recipients through it', () => {
    expect(plumbing).toMatch(/JOIN public\.profiles p ON p\.id = u\.id/);
  });

  test('is locked to service_role', () => {
    expect(plumbing).toMatch(/REVOKE ALL ON FUNCTION public\.fn_admin_recipient_ids\(\) FROM PUBLIC/);
    // Supabase auto-grants EXECUTE to anon on new functions; REVOKE FROM PUBLIC
    // does not remove it.
    expect(plumbing).toMatch(/REVOKE ALL ON FUNCTION public\.fn_admin_recipient_ids\(\) FROM anon/);
    expect(plumbing).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_admin_recipient_ids\(\) TO service_role/);
  });

  test('the coalescing table is service-role only', () => {
    expect(plumbing).toMatch(/ALTER TABLE public\.reconciliation_alerts_sent ENABLE ROW LEVEL SECURITY/);
    expect(plumbing).toMatch(/REVOKE ALL ON public\.reconciliation_alerts_sent FROM anon/);
  });
});

// ─── The digest ─────────────────────────────────────────────────────────────

describe('fn_digest_unresolved_findings', () => {
  test('covers warning and info only — critical pages in real time', () => {
    expect(digestSql).toMatch(/severity IN \('warning', 'info'\)/);
  });

  test('mentions nothing younger than 48 hours', () => {
    // A drift that clears on its own is noise; one that persists is the
    // finding. Age is what makes this a signal rather than a second firehose.
    expect(digestSql).toMatch(/run_at < now\(\) - INTERVAL '48 hours'/);
  });

  test('sends nothing when there is nothing to say', () => {
    // A digest that arrives daily regardless of content trains recipients to
    // delete it unread, so the day it matters is the day it is ignored.
    expect(digestSql).toMatch(/IF COALESCE\(v_total, 0\) = 0 THEN\s+RETURN;/);
  });

  test('is scheduled after both reconciliation jobs', () => {
    expect(digestSql).toMatch(/'reconciliation-findings-digest',\s*'45 9 \* \* \*'/);
  });
});

// ─── Audit NEW-2: the sweep is actually scheduled ───────────────────────────

describe('the reconciliation invariant sweep runs on a schedule', () => {
  test('a cron job targets the reconciliation Edge Function', () => {
    // Alerting on a job that does not run is theatre. Before this migration no
    // cron job invoked /reconciliation at all — the sweep that owns
    // completed_withdrawal_without_payout and orphan_stripe_payout ran only
    // when a human invoked it by hand, most recently 2026-08-16.
    expect(scheduleSql).toMatch(/'reconciliation-invariant-sweep-daily'/);
    expect(scheduleSql).toMatch(/\|\| '\/reconciliation'/);
    expect(scheduleSql).toMatch(/'30 9 \* \* \*'/);
  });

  test('it authenticates with the secret the function actually checks', () => {
    expect(scheduleSql).toMatch(/reconciliation_cron_secret/);
    // The function compares the bearer against RECONCILIATION_CRON_SECRET.
    expect(reconciliationSource).toMatch(/Deno\.env\.get\('RECONCILIATION_CRON_SECRET'\)/);
  });

  test('it fails the migration loudly if either vault secret is missing', () => {
    // Otherwise the job posts unauthenticated every morning, the function
    // returns 401, and nothing surfaces it — a scheduled job that looks
    // scheduled and accomplishes nothing.
    expect(scheduleSql).toMatch(/RAISE EXCEPTION 'vault secret edge_function_base_url is missing/);
    expect(scheduleSql).toMatch(/RAISE EXCEPTION 'vault secret reconciliation_cron_secret is missing/);
  });

  test('an empty body reaches the default run action', () => {
    expect(scheduleSql).toMatch(/body := '\{\}'::jsonb/);
    expect(reconciliationSource).toMatch(
      /typeof body\.action === 'string' \? body\.action : 'run'/
    );
  });
});

// ─── Migration hygiene ──────────────────────────────────────────────────────

describe('migration set', () => {
  test('all Phase 4 migrations are present and correctly ordered', () => {
    // Renamed from 20260824020000-020400 during the 2026-09-12 notification
    // overhaul, when this chain was actually applied for the first time (see
    // the comment near the top of this file) -- relative order is unchanged.
    const expected = [
      '20260912033911_reconciliation_alert_notification_type.sql',
      '20260912033941_reconciliation_alert_plumbing.sql',
      '20260912034020_alert_on_critical_finding_trigger.sql',
      '20260912034056_unresolved_findings_daily_digest.sql',
      '20260912034125_schedule_reconciliation_invariant_sweep.sql',
    ];
    const present = fs.readdirSync(MIGRATIONS);
    for (const file of expected) expect(present).toContain(file);
    expect(expected).toEqual([...expected].sort());
  });

  test('the backlog is seeded before the sweep is scheduled', () => {
    // Ordering is load-bearing: schedule first and the first run pages for a
    // 28-finding backlog everyone already knows about.
    const seedMigration = '20260912034020';
    const scheduleMigration = '20260912034125';
    expect(seedMigration < scheduleMigration).toBe(true);
    expect(triggerSql).toMatch(/INSERT INTO public\.reconciliation_alerts_sent/);
  });
});
