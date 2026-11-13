/**
 * Withdrawal attempt guard: rate limiting + failed-attempt lockout for the
 * self-service withdrawal routes in supabase/functions/connect.
 *
 * Behavioural tests cover the pure helpers in _shared/withdrawal-guard.ts.
 * Source-level contract tests (same convention as
 * connect-native-payout-contract.test.ts) pin the wiring in connect/index.ts
 * and the security-critical parts of the migration.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_WITHDRAWAL_GUARD_LIMITS,
  WITHDRAWAL_GUARDED_ROUTES,
  blockedWithdrawalResponseBody,
  classifyWithdrawalOutcome,
  clientIpFromHeaders,
  finishWithdrawalAttempt,
  formatRetryAfter,
  loadWithdrawalGuardLimits,
  reserveWithdrawalAttempt,
} from '../../supabase/functions/_shared/withdrawal-guard';

const root = path.join(__dirname, '../..');
const connectSource = fs.readFileSync(path.join(root, 'supabase/functions/connect/index.ts'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261113120000_withdrawal_attempt_guard.sql'),
  'utf8'
);

function headers(map: Record<string, string>) {
  return { get: (k: string) => map[k.toLowerCase()] ?? null };
}

describe('loadWithdrawalGuardLimits', () => {
  it('uses defaults when env is empty', () => {
    expect(loadWithdrawalGuardLimits(() => undefined)).toEqual(DEFAULT_WITHDRAWAL_GUARD_LIMITS);
  });

  it('applies valid integer overrides', () => {
    const limits = loadWithdrawalGuardLimits(k => (k === 'WITHDRAW_RL_MAX_PER_HOUR' ? '3' : undefined));
    expect(limits.maxPerHour).toBe(3);
    expect(limits.maxPer10m).toBe(DEFAULT_WITHDRAWAL_GUARD_LIMITS.maxPer10m);
  });

  it.each(['abc', '0', '-5', '2.5', 'NaN', '  '])('ignores invalid override %p instead of disabling the limit', raw => {
    const limits = loadWithdrawalGuardLimits(() => raw);
    expect(limits).toEqual(DEFAULT_WITHDRAWAL_GUARD_LIMITS);
  });
});

describe('clientIpFromHeaders', () => {
  it('takes the first x-forwarded-for hop', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' }))).toBe('1.2.3.4');
  });
  it('falls back to cf-connecting-ip then x-real-ip', () => {
    expect(clientIpFromHeaders(headers({ 'cf-connecting-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });
  it('returns null when absent', () => {
    expect(clientIpFromHeaders(headers({}))).toBeNull();
  });
});

describe('classifyWithdrawalOutcome', () => {
  it('only 4xx (non-409) counts as a failure', () => {
    expect(classifyWithdrawalOutcome(200)).toBe('succeeded');
    expect(classifyWithdrawalOutcome(400)).toBe('failed');
    expect(classifyWithdrawalOutcome(403)).toBe('failed');
    expect(classifyWithdrawalOutcome(404)).toBe('failed');
    expect(classifyWithdrawalOutcome(409)).toBe('conflict');
    expect(classifyWithdrawalOutcome(502)).toBe('error');
    expect(classifyWithdrawalOutcome(503)).toBe('error');
  });
});

describe('blockedWithdrawalResponseBody', () => {
  it('returns 429 with Retry-After and a lockout message for failed attempts', () => {
    const r = blockedWithdrawalResponseBody({ allowed: false, reason: 'too_many_failed_attempts', retryAfterSeconds: 3600 });
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe(3600);
    expect(r.body.code).toBe('withdrawal_rate_limited');
    expect(r.body.error).toMatch(/unsuccessful attempts/);
    expect(r.body.error).toMatch(/60 minutes/);
  });

  it('does not disclose IP-based rules', () => {
    const r = blockedWithdrawalResponseBody({ allowed: false, reason: 'ip_account_limit', retryAfterSeconds: 600 });
    expect(r.body.error).not.toMatch(/ip|network|address/i);
  });

  it('fails closed with 503 when the guard is unavailable', () => {
    const r = blockedWithdrawalResponseBody({ allowed: false, reason: 'guard_unavailable', retryAfterSeconds: null });
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBeNull();
  });
});

describe('formatRetryAfter', () => {
  it.each([
    [30, 'a minute'],
    [600, '10 minutes'],
    [3600, '60 minutes'],
    [5400, '2 hours'],
    [86400, '24 hours'],
  ])('%p s → %p', (s, expected) => expect(formatRetryAfter(s)).toBe(expected));
});

describe('reserveWithdrawalAttempt', () => {
  const input = { userId: 'u1', route: '/transfer', ip: '1.2.3.4' };
  const client = (result: { data: unknown; error: unknown } | Error) => ({
    rpc: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result as { data: unknown; error: { message?: string } | null };
    }),
    from: jest.fn(),
  });

  it('passes every limit to the RPC and returns the attempt id', async () => {
    const c = client({ data: [{ allowed: true, attempt_id: 'a1', reason: null, retry_after_seconds: 0 }], error: null });
    const d = await reserveWithdrawalAttempt(c, input, DEFAULT_WITHDRAWAL_GUARD_LIMITS);
    expect(d).toEqual({ allowed: true, attemptId: 'a1' });
    expect(c.rpc).toHaveBeenCalledWith(
      'reserve_withdrawal_attempt',
      expect.objectContaining({
        p_user_id: 'u1',
        p_route: '/transfer',
        p_ip: '1.2.3.4',
        p_max_failures_short: DEFAULT_WITHDRAWAL_GUARD_LIMITS.maxFailuresShort,
        p_max_users_per_ip_day: DEFAULT_WITHDRAWAL_GUARD_LIMITS.maxUsersPerIpDay,
      })
    );
  });

  it('returns the block reason and retry-after', async () => {
    const c = client({
      data: [{ allowed: false, attempt_id: null, reason: 'too_many_attempts', retry_after_seconds: 120 }],
      error: null,
    });
    expect(await reserveWithdrawalAttempt(c, input)).toEqual({
      allowed: false,
      reason: 'too_many_attempts',
      retryAfterSeconds: 120,
    });
  });

  it.each([
    ['rpc error', { data: null, error: { message: 'function does not exist' } }],
    ['empty data', { data: [], error: null }],
    ['throw', new Error('network')],
  ])('fails closed on %s', async (_label, result) => {
    const d = await reserveWithdrawalAttempt(client(result as never), input);
    expect(d).toEqual({ allowed: false, reason: 'guard_unavailable', retryAfterSeconds: null });
  });
});

describe('finishWithdrawalAttempt', () => {
  function updateClient() {
    const eq = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq }));
    return { client: { rpc: jest.fn(), from: jest.fn(() => ({ update })) }, update, eq };
  }

  it('records a 4xx as failed with its error code', async () => {
    const { client, update, eq } = updateClient();
    const res = new Response(JSON.stringify({ error: 'x', code: 'insufficient_balance' }), { status: 400 });
    await finishWithdrawalAttempt(client, 'a1', res);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', http_status: 400, error_code: 'insufficient_balance' })
    );
    expect(eq).toHaveBeenCalledWith('id', 'a1');
    // The original response body must still be readable by the caller.
    await expect(res.json()).resolves.toMatchObject({ code: 'insufficient_balance' });
  });

  it('never throws', async () => {
    const client = { rpc: jest.fn(), from: jest.fn(() => { throw new Error('boom'); }) };
    await expect(finishWithdrawalAttempt(client as never, 'a1', new Response(null, { status: 200 }))).resolves.toBeUndefined();
  });
});

describe('connect/index.ts wiring (contract)', () => {
  it('guards every self-service withdrawal route', () => {
    expect([...WITHDRAWAL_GUARDED_ROUTES].sort()).toEqual(
      ['/instant-payout', '/payout', '/retry-transfer', '/transfer'].sort()
    );
    for (const route of WITHDRAWAL_GUARDED_ROUTES) {
      expect(connectSource).toContain(`subPath === '${route}'`);
    }
  });

  it('reserves the attempt after auth and before any route handler runs', () => {
    const authIdx = connectSource.indexOf('const userId = user.id;');
    const guardIdx = connectSource.indexOf('reserveWithdrawalAttempt(');
    const firstRouteIdx = connectSource.indexOf("subPath === '/prepare-account-replacement'");
    expect(authIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(authIdx);
    expect(guardIdx).toBeLessThan(firstRouteIdx);
    expect(connectSource.indexOf("subPath === '/transfer'")).toBeGreaterThan(guardIdx);
  });

  it('records the outcome for every return path via the outer wrapper', () => {
    expect(connectSource).toMatch(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?handleConnectRequest\(req, guard\)[\s\S]*?finally[\s\S]*?finishWithdrawalAttempt\(/);
  });
});

describe('migration (contract)', () => {
  it('revokes RPC execute from client roles so users cannot lock out other users', () => {
    expect(migrationSource).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.reserve_withdrawal_attempt\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('locks the attempts table down to the service role', () => {
    expect(migrationSource).toContain('ALTER TABLE public.withdrawal_attempts ENABLE ROW LEVEL SECURITY;');
    expect(migrationSource).toContain('REVOKE ALL ON public.withdrawal_attempts FROM authenticated;');
  });

  it('serializes per user and per IP so concurrent requests cannot slip under a limit', () => {
    expect(migrationSource).toContain("pg_advisory_xact_lock(hashtextextended('withdrawal_attempt:user:'");
    expect(migrationSource).toContain("pg_advisory_xact_lock(hashtextextended('withdrawal_attempt:ip:'");
  });

  it('does not count blocked attempts toward limits (no self-extending lockout)', () => {
    const velocityChecks = migrationSource.match(/outcome <> 'blocked'/g) ?? [];
    expect(velocityChecks.length).toBeGreaterThanOrEqual(6);
  });
});
