/**
 * identity-webhooks: once a profile is verified, no later webhook moves it off
 * verified (supabase/functions/identity-webhooks/logic.ts). In production the
 * processing and verified events for one session landed in the same second and
 * processing was written last, leaving 12 verified people reading as not
 * verified to everyone else.
 *
 * The rule, the status write, superseding stale queued notifications and the
 * new notification all run in one profile-locked transaction:
 * public.apply_identity_webhook_event (migration 20261125200000). Otherwise a
 * slow processing response could queue "Verification Submitted" after the
 * verified handler queued "Identity Verified".
 *
 * index.ts is Deno (esm.sh / npm: imports) and the RPC is SQL, so neither runs
 * here: the rules are tested through logic.ts, and the sources are checked to
 * say the same thing and to route every handler through the RPC.
 */
import fs from 'fs';
import path from 'path';
import {
  isSupersededBy,
  mayWriteIdentityStatus,
  NON_VERIFIED_STATUS_BY_EVENT,
  NOTIFICATION_TYPE_BY_STATUS,
} from '../../supabase/functions/identity-webhooks/logic';

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/identity-webhooks/index.ts'), 'utf8');
const sql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261125200000_identity_webhook_atomic_status_and_notify.sql'),
  'utf8',
);

/** The body of one `case '<event>': { ... }` in the handler's switch. */
function caseBody(event: string): string {
  const start = source.indexOf(`case '${event}': {`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\n      case '", start + 1);
  const end = next > -1 ? next : source.indexOf('\n      default:', start);
  return source.slice(start, end);
}

const STATUSES = ['verified', 'processing', 'requires_input', 'canceled'];

describe('the rule', () => {
  it('verified is never overwritten by processing, requires_input or canceled', () => {
    for (const next of ['processing', 'requires_input', 'canceled']) {
      expect(mayWriteIdentityStatus('verified', next)).toBe(false);
    }
  });

  it('every other status moves as before', () => {
    for (const current of [null, undefined, 'unstarted', 'requires_input', 'processing', 'canceled']) {
      for (const next of STATUSES) {
        expect(mayWriteIdentityStatus(current, next)).toBe(true);
      }
    }
  });

  it('verified always writes, including the processing → verified race the other way round', () => {
    expect(mayWriteIdentityStatus('processing', 'verified')).toBe(true);
    expect(mayWriteIdentityStatus('verified', 'verified')).toBe(true);
  });
});

describe('superseding queued notifications', () => {
  it('a queued "Verification Submitted" is dropped once verified lands (the reviewed race)', () => {
    expect(isSupersededBy('verification_submitted', 'verified')).toBe(true);
    expect(isSupersededBy('verification_rejected', 'verified')).toBe(true);
    expect(isSupersededBy('verification_canceled', 'verified')).toBe(true);
  });

  it('a notification for the status just written is kept', () => {
    for (const status of STATUSES) {
      expect(isSupersededBy(NOTIFICATION_TYPE_BY_STATUS[status], status)).toBe(false);
    }
  });

  it('non-verification notifications are never touched', () => {
    for (const status of STATUSES) {
      expect(isSupersededBy('bounty_accepted', status)).toBe(false);
    }
  });
});

describe('the SQL says the same thing', () => {
  it('maps each status to the same notification type', () => {
    for (const [status, type] of Object.entries(NOTIFICATION_TYPE_BY_STATUS)) {
      expect(sql).toMatch(new RegExp(`WHEN '${status}'\\s+THEN '${type}'`));
    }
  });

  it('locks the profile before deciding, and refuses to move off verified', () => {
    const lock = sql.indexOf('FOR UPDATE');
    const refuse = sql.indexOf("IF p_status <> 'verified' AND v_current = 'verified' THEN");
    const write = sql.indexOf('UPDATE public.profiles');
    expect(lock).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(refuse);
  });

  it('supersedes before inserting, and only rows that can still be claimed', () => {
    const supersede = sql.indexOf("SET status     = 'superseded'");
    const insert = sql.indexOf('INSERT INTO public.notifications_outbox');
    expect(supersede).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(supersede);
    // The same states fn_claim_notification_outbox claims.
    expect(sql).toContain("(status = 'pending' OR (status = 'failed' AND attempts < 5))");
    for (const type of Object.values(NOTIFICATION_TYPE_BY_STATUS)) expect(sql).toContain(`'${type}'`);
  });

  it('is service-role only and keeps the outbox health probe from paging on superseded rows', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_identity_webhook_event\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_identity_webhook_event\([^)]*\) TO service_role/);
    expect(sql).toContain("status NOT IN ('sent', 'superseded')");
  });
});

describe('index.ts uses it', () => {
  it.each(['identity.verification_session.verified', ...Object.keys(NON_VERIFIED_STATUS_BY_EVENT)])(
    '%s: one RPC call, no separate profile write or outbox insert',
    (event) => {
      const body = caseBody(event);
      const status = event === 'identity.verification_session.verified' ? 'verified' : NON_VERIFIED_STATUS_BY_EVENT[event];
      expect(body).toContain('applyIdentityEvent(supabase');
      expect(body).toContain(`status: '${status}'`);
      expect(body).not.toContain(".from('profiles')");
      expect(body).not.toContain('notifications_outbox');
    },
  );

  it('nothing else in the handler writes profiles or the outbox directly', () => {
    expect(source).not.toContain(".from('profiles')");
    expect(source).not.toContain(".from('notifications_outbox')");
    expect(source).toContain("supabase.rpc('apply_identity_webhook_event'");
  });

  it('an RPC error fails the event so Stripe retries it', () => {
    expect(source).toMatch(/if \(error\) throw new Error\(`apply_identity_webhook_event failed/);
  });

  it('imports the rules with the .ts extension Deno needs', () => {
    expect(source).toContain("from './logic.ts'");
  });
});
