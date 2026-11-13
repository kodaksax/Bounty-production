-- =====================================================================
-- Withdrawal attempt guard: rate limiting + failed-attempt lockout for
-- every self-service withdrawal route in the `connect` Edge Function
-- (/transfer, /retry-transfer, /payout, /instant-payout).
--
-- Why: we observed repeated failed withdrawal attempts (probing balances,
-- bank accounts, amounts and account state). The existing guards (amount
-- min/max, one in-flight withdrawal, account_status, hold-aware balance)
-- each reject a bad request, but nothing stopped a caller from retrying an
-- unbounded number of times, and nothing looked across accounts sharing an
-- IP. The legacy Express server had an in-memory express-rate-limit; the
-- Edge Function, which serves all production traffic, had none — and an
-- in-memory limiter cannot work there anyway because isolates do not share
-- memory. This guard lives in Postgres so it is global and atomic.
--
-- Shape:
--   * withdrawal_attempts       one row per withdrawal request (incl. blocked)
--   * reserve_withdrawal_attempt  atomic check-and-reserve under advisory
--                                 locks; returns allowed/blocked + retry_after
--   The Edge Function updates the row's outcome after the request finishes;
--   only outcome = 'failed' (a 4xx rejection) counts toward the lockout.
--
-- Service role only. If `authenticated` could call the RPC, any user could
-- insert attempt rows for another user_id and lock them out.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.withdrawal_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  route         TEXT NOT NULL,
  ip            TEXT,
  -- pending   : reserved, request still running (or the isolate died)
  -- succeeded : 2xx
  -- failed    : 4xx rejection (validation, balance, account, destination…)
  -- conflict  : 409 (already in flight / idempotency conflict) — benign
  -- error     : 5xx / platform fault — never held against the user
  -- blocked   : rejected by this guard; recorded for forensics, not counted
  outcome       TEXT NOT NULL DEFAULT 'pending'
                CHECK (outcome IN ('pending', 'succeeded', 'failed', 'conflict', 'error', 'blocked')),
  http_status   INTEGER,
  error_code    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.withdrawal_attempts IS
  'Every self-service withdrawal request seen by the connect Edge Function. Drives reserve_withdrawal_attempt() rate limits and failed-attempt lockouts. Service role only.';

CREATE INDEX IF NOT EXISTS idx_withdrawal_attempts_user_created
  ON public.withdrawal_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_withdrawal_attempts_ip_created
  ON public.withdrawal_attempts (ip, created_at DESC)
  WHERE ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawal_attempts_outcome_created
  ON public.withdrawal_attempts (outcome, created_at DESC);

ALTER TABLE public.withdrawal_attempts ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service_role bypasses RLS, nobody else gets in.
REVOKE ALL ON public.withdrawal_attempts FROM PUBLIC;
REVOKE ALL ON public.withdrawal_attempts FROM anon;
REVOKE ALL ON public.withdrawal_attempts FROM authenticated;


-- ---------------------------------------------------------------------
-- reserve_withdrawal_attempt
--
-- Checks every limit and, if all pass, inserts a 'pending' attempt row and
-- returns its id. Serialized per user and per IP with transaction-scoped
-- advisory locks, so N concurrent requests cannot all slip under a limit.
-- Lock order is always user → ip, so two requests can never deadlock.
--
-- Each "N within window" check uses the same trick: the row at OFFSET N-1
-- (newest first) exists inside the window iff there are already ≥ N rows,
-- and that row's created_at + window is exactly when the caller may retry.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_withdrawal_attempt(
  p_user_id                   UUID,
  p_route                     TEXT,
  p_ip                        TEXT,
  p_max_per_10m               INTEGER,
  p_max_per_hour              INTEGER,
  p_max_per_day               INTEGER,
  p_max_failures_short        INTEGER,
  p_failure_window_short_min  INTEGER,
  p_max_failures_long         INTEGER,
  p_failure_window_long_min   INTEGER,
  p_max_per_ip_hour           INTEGER,
  p_max_users_per_ip_day      INTEGER
)
RETURNS TABLE (
  allowed              BOOLEAN,
  attempt_id           UUID,
  reason               TEXT,
  retry_after_seconds  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      TIMESTAMPTZ := clock_timestamp();
  v_ip       TEXT := NULLIF(LEFT(BTRIM(COALESCE(p_ip, '')), 64), '');
  v_route    TEXT := LEFT(COALESCE(p_route, 'unknown'), 64);
  v_reason   TEXT := NULL;
  v_retry_at TIMESTAMPTZ := NULL;
  v_hit      TIMESTAMPTZ;
  v_id       UUID;
  v_recently_flagged BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'reserve_withdrawal_attempt: p_user_id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal_attempt:user:' || p_user_id::text, 0));
  IF v_ip IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal_attempt:ip:' || v_ip, 0));
  END IF;

  -- 1. Long failure lockout (e.g. 10 failures / 24h).
  SELECT wa.created_at INTO v_hit
    FROM public.withdrawal_attempts wa
   WHERE wa.user_id = p_user_id AND wa.outcome = 'failed'
     AND wa.created_at > v_now - make_interval(mins => GREATEST(p_failure_window_long_min, 1))
   ORDER BY wa.created_at DESC
  OFFSET GREATEST(p_max_failures_long, 1) - 1 LIMIT 1;
  IF FOUND THEN
    v_reason := COALESCE(v_reason, 'too_many_failed_attempts');
    v_retry_at := GREATEST(v_retry_at, v_hit + make_interval(mins => GREATEST(p_failure_window_long_min, 1)));
  END IF;

  -- 2. Short failure cooldown (e.g. 5 failures / 1h).
  SELECT wa.created_at INTO v_hit
    FROM public.withdrawal_attempts wa
   WHERE wa.user_id = p_user_id AND wa.outcome = 'failed'
     AND wa.created_at > v_now - make_interval(mins => GREATEST(p_failure_window_short_min, 1))
   ORDER BY wa.created_at DESC
  OFFSET GREATEST(p_max_failures_short, 1) - 1 LIMIT 1;
  IF FOUND THEN
    v_reason := COALESCE(v_reason, 'too_many_failed_attempts');
    v_retry_at := GREATEST(v_retry_at, v_hit + make_interval(mins => GREATEST(p_failure_window_short_min, 1)));
  END IF;

  -- 3-5. Per-user attempt velocity (any non-blocked outcome).
  SELECT wa.created_at INTO v_hit
    FROM public.withdrawal_attempts wa
   WHERE wa.user_id = p_user_id AND wa.outcome <> 'blocked'
     AND wa.created_at > v_now - INTERVAL '24 hours'
   ORDER BY wa.created_at DESC
  OFFSET GREATEST(p_max_per_day, 1) - 1 LIMIT 1;
  IF FOUND THEN
    v_reason := COALESCE(v_reason, 'too_many_attempts');
    v_retry_at := GREATEST(v_retry_at, v_hit + INTERVAL '24 hours');
  END IF;

  SELECT wa.created_at INTO v_hit
    FROM public.withdrawal_attempts wa
   WHERE wa.user_id = p_user_id AND wa.outcome <> 'blocked'
     AND wa.created_at > v_now - INTERVAL '1 hour'
   ORDER BY wa.created_at DESC
  OFFSET GREATEST(p_max_per_hour, 1) - 1 LIMIT 1;
  IF FOUND THEN
    v_reason := COALESCE(v_reason, 'too_many_attempts');
    v_retry_at := GREATEST(v_retry_at, v_hit + INTERVAL '1 hour');
  END IF;

  SELECT wa.created_at INTO v_hit
    FROM public.withdrawal_attempts wa
   WHERE wa.user_id = p_user_id AND wa.outcome <> 'blocked'
     AND wa.created_at > v_now - INTERVAL '10 minutes'
   ORDER BY wa.created_at DESC
  OFFSET GREATEST(p_max_per_10m, 1) - 1 LIMIT 1;
  IF FOUND THEN
    v_reason := COALESCE(v_reason, 'too_many_attempts');
    v_retry_at := GREATEST(v_retry_at, v_hit + INTERVAL '10 minutes');
  END IF;

  IF v_ip IS NOT NULL THEN
    -- 6. Per-IP attempt velocity across all accounts.
    SELECT wa.created_at INTO v_hit
      FROM public.withdrawal_attempts wa
     WHERE wa.ip = v_ip AND wa.outcome <> 'blocked'
       AND wa.created_at > v_now - INTERVAL '1 hour'
     ORDER BY wa.created_at DESC
    OFFSET GREATEST(p_max_per_ip_hour, 1) - 1 LIMIT 1;
    IF FOUND THEN
      v_reason := COALESCE(v_reason, 'ip_rate_limited');
      v_retry_at := GREATEST(v_retry_at, v_hit + INTERVAL '1 hour');
    END IF;

    -- 7. Distinct accounts withdrawing from one IP (account farms). A user
    --    already seen on this IP in the window is never blocked by this rule.
    IF NOT EXISTS (
      SELECT 1 FROM public.withdrawal_attempts wa
       WHERE wa.ip = v_ip AND wa.user_id = p_user_id AND wa.outcome <> 'blocked'
         AND wa.created_at > v_now - INTERVAL '24 hours'
    ) THEN
      SELECT u.last_seen INTO v_hit
        FROM (
          SELECT wa.user_id, MAX(wa.created_at) AS last_seen
            FROM public.withdrawal_attempts wa
           WHERE wa.ip = v_ip AND wa.outcome <> 'blocked' AND wa.user_id IS NOT NULL
             AND wa.created_at > v_now - INTERVAL '24 hours'
           GROUP BY wa.user_id
        ) u
       ORDER BY u.last_seen DESC
      OFFSET GREATEST(p_max_users_per_ip_day, 1) - 1 LIMIT 1;
      IF FOUND THEN
        v_reason := COALESCE(v_reason, 'ip_account_limit');
        v_retry_at := GREATEST(v_retry_at, v_hit + INTERVAL '24 hours');
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- Raise an audit flag at most once per user per 10 minutes so a flood of
    -- blocked requests does not also flood payout_audit_log.
    SELECT EXISTS (
      SELECT 1 FROM public.withdrawal_attempts wa
       WHERE wa.user_id = p_user_id AND wa.outcome = 'blocked'
         AND wa.created_at > v_now - INTERVAL '10 minutes'
    ) INTO v_recently_flagged;

    INSERT INTO public.withdrawal_attempts (user_id, route, ip, outcome, http_status, error_code, completed_at)
    VALUES (p_user_id, v_route, v_ip, 'blocked', 429, v_reason, v_now);

    IF NOT v_recently_flagged THEN
      INSERT INTO public.payout_audit_log (user_id, event, error_code, error_message, detail)
      VALUES (
        p_user_id,
        'withdrawal_rate_limited',
        v_reason,
        'Withdrawal attempt blocked by reserve_withdrawal_attempt',
        jsonb_build_object('route', v_route, 'ip', v_ip, 'retry_at', v_retry_at)
      );
    END IF;

    RETURN QUERY SELECT FALSE, NULL::UUID, v_reason,
      GREATEST(CEIL(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER, 1);
    RETURN;
  END IF;

  INSERT INTO public.withdrawal_attempts (user_id, route, ip, outcome)
  VALUES (p_user_id, v_route, v_ip, 'pending')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, v_id, NULL::TEXT, 0;
END;
$$;

COMMENT ON FUNCTION public.reserve_withdrawal_attempt IS
  'Atomic rate-limit + failed-attempt lockout check for self-service withdrawals. Inserts a pending withdrawal_attempts row when allowed. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reserve_withdrawal_attempt(
  UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_withdrawal_attempt(
  UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) TO service_role;
