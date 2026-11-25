/**
 * identity-webhooks: once a profile is verified, no later webhook moves it off
 * verified (supabase/functions/identity-webhooks/logic.ts). In production the
 * processing and verified events for one session landed in the same second and
 * processing was written last, leaving 12 verified people reading as not
 * verified to everyone else.
 *
 * index.ts is Deno (esm.sh / npm: imports), so it can't run here: the rule is
 * tested through logic.ts, and the source is checked to use it in every
 * handler that writes a non-verified status.
 */
import fs from 'fs';
import path from 'path';
import {
  mayWriteIdentityStatus,
  NON_VERIFIED_STATUS_BY_EVENT,
  NOT_VERIFIED_FILTER,
  shouldNotifyAfterWrite,
} from '../../supabase/functions/identity-webhooks/logic';

const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/identity-webhooks/index.ts'), 'utf8');

/** The body of one `case '<event>': { ... }` in the handler's switch. */
function caseBody(event: string): string {
  const start = source.indexOf(`case '${event}': {`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\n      case '", start + 1);
  const end = next > -1 ? next : source.indexOf('\n      default:', start);
  return source.slice(start, end);
}

describe('the rule', () => {
  it('verified is never overwritten by processing, requires_input or canceled', () => {
    for (const next of ['processing', 'requires_input', 'canceled']) {
      expect(mayWriteIdentityStatus('verified', next)).toBe(false);
    }
  });

  it('every other status moves as before', () => {
    for (const current of [null, undefined, 'unstarted', 'requires_input', 'processing', 'canceled']) {
      for (const next of ['processing', 'requires_input', 'canceled', 'verified']) {
        expect(mayWriteIdentityStatus(current, next)).toBe(true);
      }
    }
  });

  it('verified always writes, including the processing → verified race the other way round', () => {
    expect(mayWriteIdentityStatus('processing', 'verified')).toBe(true);
    expect(mayWriteIdentityStatus('verified', 'verified')).toBe(true);
  });

  it('the filter is the same rule in PostgREST, NULLs included (neq alone skips them)', () => {
    expect(NOT_VERIFIED_FILTER).toBe('stripe_identity_status.is.null,stripe_identity_status.neq.verified');
  });

  it('no notification unless the status was written', () => {
    expect(shouldNotifyAfterWrite(0)).toBe(false);
    expect(shouldNotifyAfterWrite(1)).toBe(true);
  });
});

describe('index.ts uses it', () => {
  it.each(Object.keys(NON_VERIFIED_STATUS_BY_EVENT))('%s: guarded update, checked before notifying', (event) => {
    const body = caseBody(event);
    const status = NON_VERIFIED_STATUS_BY_EVENT[event];
    expect(body).toContain(`stripe_identity_status: '${status}'`);
    const guard = body.indexOf('.or(NOT_VERIFIED_FILTER)');
    expect(guard).toBeGreaterThan(-1);
    expect(body).toContain(".select('id')");
    expect(body).toContain('shouldNotifyAfterWrite(written?.length ?? 0)');
    const notify = body.indexOf('enqueueVerificationNotification');
    if (notify > -1) expect(guard).toBeLessThan(notify);
  });

  it('the verified handler is unguarded: it must always win', () => {
    expect(caseBody('identity.verification_session.verified')).not.toContain('NOT_VERIFIED_FILTER');
  });

  it('imports the rules with the .ts extension Deno needs', () => {
    expect(source).toContain("from './logic.ts'");
  });
});
