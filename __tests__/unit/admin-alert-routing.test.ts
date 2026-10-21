/**
 * Admin alert routing (20261021230000_admin_alert_routing.sql).
 *
 * Behaviour is exercised against real Postgres by
 * scripts/verify-admin-alert-routing-pglite.mjs. These checks pin the
 * cross-file contracts that script cannot see: the edge functions and the
 * taxonomy have to agree with the migration, or alerts go quiet again.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  categoryForNotificationType,
  isForcedChannel,
  isUrgentNotification,
} from '../../lib/config/notification-taxonomy';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripSqlComments = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const migration = read('supabase/migrations/20261021230000_admin_alert_routing.sql');
const migrationCode = stripSqlComments(migration);
const processNotification = read('supabase/functions/process-notification/index.ts');
const moderationSweep = read('supabase/functions/moderation-sweep/index.ts');

describe('moderation alerts are delivered like a page', () => {
  test('security category: push and in-app cannot be switched off, quiet hours bypassed', () => {
    expect(categoryForNotificationType('moderation_alert')).toBe('security');
    expect(isForcedChannel('security', 'push')).toBe(true);
    expect(isUrgentNotification('moderation_alert')).toBe(true);
  });

  test('process-notification mirrors the taxonomy', () => {
    expect(processNotification).toMatch(/moderation_alert:\s*'security'/);
  });
});

describe('one email per alert', () => {
  test('process-notification skips its fan-out when fn_notify_admins already emailed', () => {
    expect(processNotification).toMatch(/const emailDispatched = outboxData\.emailDispatched === true/);
    expect(processNotification).toMatch(/if \(!emailFallback && !emailDispatched && emailRecipients\.length > 0\)/);
  });

  test('fn_notify_admins sets the flag only when it queued the email', () => {
    expect(migrationCode).toMatch(/'emailDispatched', v_request IS NOT NULL/);
  });

  test('moderation-sweep pages through fn_notify_admins and nothing else', () => {
    expect(moderationSweep).toMatch(/rpc\('fn_notify_admins'/);
    expect(moderationSweep).not.toMatch(/send-notification-email/);
    expect(moderationSweep).not.toMatch(/from\('notifications'\)/);
    expect(moderationSweep).not.toMatch(/from\('notifications_outbox'\)/);
    expect(moderationSweep).not.toMatch(/moderation_admin_recipients/);
  });
});

describe('paging is a list, not a role', () => {
  test('every resolver reads admin_recipients', () => {
    for (const fn of ['fn_admin_recipients_for', 'fn_admin_recipient_ids', 'moderation_admin_recipients']) {
      const start = migrationCode.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const body = migrationCode.slice(start, migrationCode.indexOf('$$;', start));
      expect(body).toMatch(/FROM public\.admin_recipients r/);
      expect(body).not.toMatch(/raw_app_meta_data/);
    }
  });

  test('the list is not writable through the API', () => {
    expect(migrationCode).toMatch(/REVOKE ALL ON public\.admin_recipients FROM PUBLIC, anon, authenticated;/);
    expect(migrationCode).toMatch(/GRANT SELECT ON public\.admin_recipients TO authenticated;/);
    expect(migrationCode).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*admin_recipients/);
  });
});

describe('outbox dispatch', () => {
  test('the webhook with an embedded credential is replaced', () => {
    expect(migrationCode).toMatch(/DROP TRIGGER IF EXISTS "Push_noti_manager" ON public\.notifications_outbox;/);
    expect(migrationCode).toMatch(/CREATE TRIGGER notifications_outbox_dispatch\s+AFTER INSERT ON public\.notifications_outbox/);
    // No JWT or sb_secret_ literal anywhere in the migration.
    expect(migration).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(migration).not.toMatch(/sb_secret_[A-Za-z0-9]/);
  });

  test('dispatch reads the vault key, like the drain', () => {
    const start = migrationCode.indexOf('CREATE OR REPLACE FUNCTION public.fn_dispatch_notification_outbox');
    const body = migrationCode.slice(start, migrationCode.indexOf('$$;', start));
    expect(body).toMatch(/vault\.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'/);
  });
});

describe('ops alerts wait for a person', () => {
  const checker = (() => {
    const start = migrationCode.indexOf('CREATE OR REPLACE FUNCTION public.fn_check_job_health()');
    return migrationCode.slice(start, migrationCode.indexOf('$$;', start));
  })();

  test('the checker never resolves an alert', () => {
    expect(checker).not.toMatch(/resolved_at\s*=\s*now\(\)/);
    expect(checker).not.toMatch(/Recovered/);
  });

  test('reminders every 24h unless acknowledged within 24h', () => {
    expect(checker).toMatch(/a\.last_notified_at < now\(\) - interval '24 hours'/);
    expect(checker).toMatch(/a\.acknowledged_at IS NULL OR a\.acknowledged_at < now\(\) - interval '24 hours'/);
  });

  test('acknowledge and resolve are admin-checked and need a signed-in caller', () => {
    for (const fn of ['admin_ack_ops_alert', 'admin_resolve_ops_alert']) {
      const start = migrationCode.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      const body = migrationCode.slice(start, migrationCode.indexOf('$$;', start));
      expect(body).toMatch(/IF NOT public\.is_admin\(\) THEN/);
    }
    expect(migrationCode).toMatch(/REVOKE ALL ON FUNCTION public\.admin_resolve_ops_alert\(uuid, text\) FROM PUBLIC, anon;/);
  });
});
