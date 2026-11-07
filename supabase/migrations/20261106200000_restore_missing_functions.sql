-- Additive: creates three functions, writes no rows, changes no policy.
--
-- 2026-11-06 production-quality pass. A scan of every .rpc() call site against
-- pg_proc on production found three functions the code calls that production
-- does not have. Their original migrations were never applied in full, and
-- those files also carry data changes, so they cannot simply be replayed. This
-- restores only the function definitions, copied unchanged.
--
-- 1. record_reconciliation_findings (from 20260901140000)
--    The batch form the reconciliation Edge Function calls to persist findings.
--    The singular record_reconciliation_finding() it wraps is already live.
--    Expect existing findings to appear on the first run after applying; the
--    AFTER INSERT trigger pages once for any that are critical.
--
-- 2. fn_mark_poster_interacted (from 20260913000000)
--    Called when a poster opens a chat with an applicant, so the request-expiry
--    sweep leaves an active conversation alone. The message trigger already
--    stamps the same column, so only a poster who opens a chat and sends nothing
--    is unprotected today.
--
-- 3. admin_user_stats (from 20260826120000)
--    The admin user list falls back to rows without stats when this is missing.
--    Validated against production's schema with a read-only run of its body.
--
-- Done means (observe rows, not the migration):
--   reconciliation_findings has rows with last_seen_at after the apply;
--   bounty_requests.poster_interacted_at is stamped by a chat opened without a
--   message; the admin user list shows real totals.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_reconciliation_findings(jsonb);
--   DROP FUNCTION IF EXISTS public.fn_mark_poster_interacted(uuid);
--   DROP FUNCTION IF EXISTS public.admin_user_stats(uuid[]);
-- Each is safe to drop: callers already tolerate the function being absent.

CREATE OR REPLACE FUNCTION public.record_reconciliation_findings(p_findings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_element jsonb;
  v_recorded integer := 0;
  v_errors   jsonb := '[]'::jsonb;
BEGIN
  IF p_findings IS NULL OR jsonb_typeof(p_findings) <> 'array' THEN
    RAISE EXCEPTION 'record_reconciliation_findings expects a JSON array, got %',
      COALESCE(jsonb_typeof(p_findings), 'null');
  END IF;

  -- `value` is named explicitly: FOR-over-query binds into the scalar v_element
  -- only while the query yields exactly one column, and `SELECT *` leaves that
  -- dependent on the set-returning function's shape rather than stating it.
  FOR v_element IN SELECT value FROM jsonb_array_elements(p_findings)
  LOOP
    BEGIN
      PERFORM public.record_reconciliation_finding(
        v_element->>'finding_type',
        v_element->>'severity',
        NULLIF(v_element->>'user_id', '')::uuid,
        COALESCE(v_element->'details', '{}'::jsonb),
        COALESCE((v_element->>'auto_repaired')::boolean, false)
      );
      v_recorded := v_recorded + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'finding_type', v_element->>'finding_type',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('recorded', v_recorded, 'errors', v_errors);
END;
$$;

COMMENT ON FUNCTION public.record_reconciliation_findings(jsonb) IS
  'Batch form of record_reconciliation_finding: records an array of findings in ONE round trip. Each element is applied in its own subtransaction, so one bad finding cannot discard the rest; per-element failures come back in the returned errors array instead of raising.';

REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_findings(jsonb) TO service_role;

-- SECURITY INVOKER + the poster_id = auth.uid() check means a poster can only
-- stamp their own pending requests; RLS on bounty_requests still applies. Uses
-- the database's now() so a skewed device clock can never move the watermark.
CREATE OR REPLACE FUNCTION public.fn_mark_poster_interacted(p_request_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
  UPDATE public.bounty_requests
  SET poster_interacted_at = now()
  WHERE id = p_request_id
    AND poster_id = auth.uid()
    AND poster_interacted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_mark_poster_interacted(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_mark_poster_interacted(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_mark_poster_interacted(uuid) TO authenticated;

-- EXECUTE is service_role only: the admin-profiles Edge Function calls this after
-- verifying the caller is an admin, so no client role can reach it.
CREATE OR REPLACE FUNCTION public.admin_user_stats(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  bounties_posted bigint,
  bounties_accepted bigint,
  bounties_completed bigint,
  total_spent numeric,
  total_earned numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT unnest(p_user_ids) AS id
  ),
  posted AS (
    SELECT b.poster_id AS id, count(*) AS n
    FROM public.bounties b
    WHERE b.poster_id = ANY(p_user_ids)
    GROUP BY b.poster_id
  ),
  accepted AS (
    SELECT b.accepted_by AS id, count(*) AS n
    FROM public.bounties b
    WHERE b.accepted_by = ANY(p_user_ids)
    GROUP BY b.accepted_by
  ),
  completed AS (
    -- Counted from the hunter's side: the bounties this user actually finished.
    SELECT b.accepted_by AS id, count(*) AS n
    FROM public.bounties b
    WHERE b.accepted_by = ANY(p_user_ids)
      AND b.status = 'completed'
    GROUP BY b.accepted_by
  ),
  spent AS (
    -- Money the user put in: escrow funded from their account.
    SELECT t.user_id AS id, sum(abs(t.amount)) AS total
    FROM public.wallet_transactions t
    WHERE t.user_id = ANY(p_user_ids)
      AND t.type = 'escrow'
      AND t.status = 'completed'
    GROUP BY t.user_id
  ),
  earned AS (
    -- Money released to the user as the receiving party.
    SELECT t.receiver_id AS id, sum(abs(t.amount)) AS total
    FROM public.wallet_transactions t
    WHERE t.receiver_id = ANY(p_user_ids)
      AND t.type = 'release'
      AND t.status = 'completed'
    GROUP BY t.receiver_id
  )
  SELECT
    ids.id,
    COALESCE(posted.n, 0)::bigint,
    COALESCE(accepted.n, 0)::bigint,
    COALESCE(completed.n, 0)::bigint,
    COALESCE(spent.total, 0)::numeric,
    COALESCE(earned.total, 0)::numeric
  FROM ids
  LEFT JOIN posted    ON posted.id    = ids.id
  LEFT JOIN accepted  ON accepted.id  = ids.id
  LEFT JOIN completed ON completed.id = ids.id
  LEFT JOIN spent     ON spent.id     = ids.id
  LEFT JOIN earned    ON earned.id    = ids.id;
$$;

REVOKE ALL ON FUNCTION public.admin_user_stats(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_stats(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_user_stats(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_stats(uuid[]) TO service_role;
