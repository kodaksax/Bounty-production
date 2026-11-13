// Withdrawal attempt guard — rate limiting and failed-attempt lockout for
// every self-service withdrawal route in the `connect` Edge Function.
//
// The limits are enforced atomically in Postgres by
// public.reserve_withdrawal_attempt() (migration
// 20261113120000_withdrawal_attempt_guard.sql). Edge isolates do not share
// memory, so an in-process limiter would be trivially bypassed by requests
// landing on different isolates.
//
// The pure helpers here (limits, IP extraction, outcome classification,
// blocked-response shaping) have no Deno or Supabase dependency, so Jest can
// import them directly.

/** POST sub-paths of /connect that move money out of the platform. */
export const WITHDRAWAL_GUARDED_ROUTES: ReadonlySet<string> = new Set([
  '/transfer',
  '/retry-transfer',
  '/payout',
  '/instant-payout',
]);

export interface WithdrawalGuardLimits {
  maxPer10m: number;
  maxPerHour: number;
  maxPerDay: number;
  maxFailuresShort: number;
  failureWindowShortMin: number;
  maxFailuresLong: number;
  failureWindowLongMin: number;
  maxPerIpHour: number;
  maxUsersPerIpDay: number;
}

export const DEFAULT_WITHDRAWAL_GUARD_LIMITS: Readonly<WithdrawalGuardLimits> = Object.freeze({
  maxPer10m: 5,
  maxPerHour: 10,
  maxPerDay: 20,
  // 5 rejected attempts in an hour → cool down until the oldest rolls off.
  maxFailuresShort: 5,
  failureWindowShortMin: 60,
  // 10 rejected attempts in 24h → locked out for up to a day.
  maxFailuresLong: 10,
  failureWindowLongMin: 24 * 60,
  // Across all accounts on one IP. Kept generous for carrier-grade NAT.
  maxPerIpHour: 30,
  maxUsersPerIpDay: 10,
});

const ENV_KEYS: Record<keyof WithdrawalGuardLimits, string> = {
  maxPer10m: 'WITHDRAW_RL_MAX_PER_10M',
  maxPerHour: 'WITHDRAW_RL_MAX_PER_HOUR',
  maxPerDay: 'WITHDRAW_RL_MAX_PER_DAY',
  maxFailuresShort: 'WITHDRAW_RL_MAX_FAILURES_SHORT',
  failureWindowShortMin: 'WITHDRAW_RL_FAILURE_WINDOW_SHORT_MIN',
  maxFailuresLong: 'WITHDRAW_RL_MAX_FAILURES_LONG',
  failureWindowLongMin: 'WITHDRAW_RL_FAILURE_WINDOW_LONG_MIN',
  maxPerIpHour: 'WITHDRAW_RL_MAX_PER_IP_HOUR',
  maxUsersPerIpDay: 'WITHDRAW_RL_MAX_USERS_PER_IP_DAY',
};

/**
 * Reads limits from env, falling back to the defaults. A missing, non-numeric,
 * non-integer or < 1 override is ignored rather than allowed to disable the
 * limit (same failure mode withdrawal-validation.ts guards against).
 */
export function loadWithdrawalGuardLimits(
  getEnv: (key: string) => string | undefined = defaultGetEnv
): WithdrawalGuardLimits {
  const limits = { ...DEFAULT_WITHDRAWAL_GUARD_LIMITS };
  for (const field of Object.keys(ENV_KEYS) as Array<keyof WithdrawalGuardLimits>) {
    const raw = getEnv(ENV_KEYS[field]);
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) limits[field] = parsed;
  }
  return limits;
}

function defaultGetEnv(key: string): string | undefined {
  // `Deno` only exists in the Edge runtime; Jest imports this module too.
  return typeof Deno !== 'undefined' ? Deno.env.get(key) : undefined;
}

/** Best-effort client IP. Supabase's gateway sets x-forwarded-for. */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>): string | null {
  const candidates = [
    headers.get('x-forwarded-for')?.split(',')[0],
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
  ];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip) return ip.slice(0, 64);
  }
  return null;
}

export type WithdrawalAttemptOutcome = 'succeeded' | 'failed' | 'conflict' | 'error';

/**
 * Maps a finished request's HTTP status to the outcome stored on the attempt.
 * Only 'failed' counts toward the lockout:
 *  - 4xx → failed: the request was rejected for something the caller sent or
 *    the state of their account (amount, balance, destination, eligibility).
 *    This is the probing signal.
 *  - 409 → conflict: a withdrawal is already in flight or an idempotency
 *    clash. That is a double-tap, not an attack.
 *  - 5xx → error: our fault or Stripe's; never held against the user.
 */
export function classifyWithdrawalOutcome(status: number): WithdrawalAttemptOutcome {
  if (status < 400) return 'succeeded';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'error';
  return 'failed';
}

export type WithdrawalGuardBlockReason =
  | 'too_many_failed_attempts'
  | 'too_many_attempts'
  | 'ip_rate_limited'
  | 'ip_account_limit';

export type WithdrawalGuardDecision =
  | { allowed: true; attemptId: string }
  | { allowed: false; reason: WithdrawalGuardBlockReason | string; retryAfterSeconds: number }
  | { allowed: false; reason: 'guard_unavailable'; retryAfterSeconds: null };

export function formatRetryAfter(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return 'a minute';
  const minutes = Math.ceil(s / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/**
 * Shapes the response for a blocked attempt. The message deliberately does
 * not say which limit tripped (in particular, IP rules are not disclosed) so
 * the limits are harder to tune an attack against.
 */
export function blockedWithdrawalResponseBody(
  decision: Extract<WithdrawalGuardDecision, { allowed: false }>
): { status: number; body: { error: string; code: string; retryAfter?: number }; retryAfter: number | null } {
  if (decision.retryAfterSeconds === null) {
    return {
      status: 503,
      body: {
        error:
          'Withdrawals are temporarily unavailable. Your balance has not been charged — please try again shortly.',
        code: 'withdrawal_guard_unavailable',
      },
      retryAfter: null,
    };
  }
  const wait = formatRetryAfter(decision.retryAfterSeconds);
  const error =
    decision.reason === 'too_many_failed_attempts'
      ? `For your security, withdrawals are paused after several unsuccessful attempts. Please try again in ${wait}, or contact support if you need help.`
      : `Too many withdrawal attempts. Please wait ${wait} before trying again.`;
  return {
    status: 429,
    body: { error, code: 'withdrawal_rate_limited', retryAfter: decision.retryAfterSeconds },
    retryAfter: decision.retryAfterSeconds,
  };
}

// ─── DB calls ────────────────────────────────────────────────────────────────
// Typed structurally so this file needs no esm.sh import under Jest.

interface RpcCapableClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
}

/**
 * Atomically checks every limit and reserves an attempt. Fails CLOSED: if the
 * guard cannot be evaluated, no money moves.
 */
export async function reserveWithdrawalAttempt(
  supabase: RpcCapableClient,
  input: { userId: string; route: string; ip: string | null },
  limits: WithdrawalGuardLimits = loadWithdrawalGuardLimits()
): Promise<WithdrawalGuardDecision> {
  try {
    const { data, error } = await supabase.rpc('reserve_withdrawal_attempt', {
      p_user_id: input.userId,
      p_route: input.route,
      p_ip: input.ip,
      p_max_per_10m: limits.maxPer10m,
      p_max_per_hour: limits.maxPerHour,
      p_max_per_day: limits.maxPerDay,
      p_max_failures_short: limits.maxFailuresShort,
      p_failure_window_short_min: limits.failureWindowShortMin,
      p_max_failures_long: limits.maxFailuresLong,
      p_failure_window_long_min: limits.failureWindowLongMin,
      p_max_per_ip_hour: limits.maxPerIpHour,
      p_max_users_per_ip_day: limits.maxUsersPerIpDay,
    });
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: boolean; attempt_id?: string | null; reason?: string | null; retry_after_seconds?: number | null }
      | null
      | undefined;
    if (error || !row || typeof row.allowed !== 'boolean') {
      console.error('[withdrawal-guard] reserve failed; failing closed', {
        userId: input.userId,
        route: input.route,
        error: error?.message ?? 'empty response',
      });
      return { allowed: false, reason: 'guard_unavailable', retryAfterSeconds: null };
    }
    if (row.allowed && row.attempt_id) return { allowed: true, attemptId: row.attempt_id };
    console.warn('[withdrawal-guard] attempt blocked', {
      userId: input.userId,
      route: input.route,
      reason: row.reason,
      retryAfterSeconds: row.retry_after_seconds,
    });
    return {
      allowed: false,
      reason: row.reason ?? 'too_many_attempts',
      retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 60),
    };
  } catch (err) {
    console.error('[withdrawal-guard] reserve threw; failing closed', {
      userId: input.userId,
      route: input.route,
      error: (err as { message?: string })?.message,
    });
    return { allowed: false, reason: 'guard_unavailable', retryAfterSeconds: null };
  }
}

/** Records how a reserved attempt ended. Best-effort; never throws. */
export async function finishWithdrawalAttempt(
  supabase: RpcCapableClient,
  attemptId: string,
  response: Response
): Promise<void> {
  try {
    let errorCode: string | null = null;
    if (response.status >= 400) {
      const parsed = await response.clone().json().catch(() => null);
      const code = (parsed as { code?: unknown } | null)?.code;
      if (typeof code === 'string') errorCode = code.slice(0, 100);
    }
    const { error } = await supabase
      .from('withdrawal_attempts')
      .update({
        outcome: classifyWithdrawalOutcome(response.status),
        http_status: response.status,
        error_code: errorCode,
        completed_at: new Date().toISOString(),
      })
      .eq('id', attemptId);
    if (error) {
      console.error('[withdrawal-guard] failed to record outcome', { attemptId, error: error.message });
    }
  } catch (err) {
    console.error('[withdrawal-guard] threw recording outcome', {
      attemptId,
      error: (err as { message?: string })?.message,
    });
  }
}
