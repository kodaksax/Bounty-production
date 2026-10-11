BEGIN;

-- A recurring condition may need a new intervention after its prior case was
-- resolved. Reopen the existing geocode case atomically when that happens.
CREATE OR REPLACE FUNCTION public.fn_record_geocode_failure(
  p_bounty_id uuid,
  p_reason text,
  p_terminal boolean DEFAULT false,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE (status text, case_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  v_status  text;
  v_poster  uuid;
  v_case_id uuid;
BEGIN
  UPDATE public.bounty_geocode_attempts g
     SET status = CASE
                    WHEN p_terminal AND p_reason = 'no_address' THEN 'no_address'
                    WHEN p_terminal OR g.attempts >= p_max_attempts THEN 'gave_up'
                    ELSE 'failed'
                  END,
         last_error = left(COALESCE(p_reason, 'unknown'), 200)
   WHERE g.bounty_id = p_bounty_id
  RETURNING g.status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fn_record_geocode_failure: bounty % was not claimed', p_bounty_id;
  END IF;

  IF v_status IN ('gave_up', 'no_address') THEN
    SELECT COALESCE(poster_id, user_id) INTO v_poster FROM public.bounties WHERE id = p_bounty_id;
    INSERT INTO public.support_cases (kind, channel, poster_id, bounty_id, summary, metadata, dedupe_key)
    VALUES (
      'geocode_failed', 'system', v_poster, p_bounty_id,
      CASE WHEN v_status = 'no_address'
           THEN 'In-person bounty has no address on file, so it cannot be placed on the map. Ask the poster where the job is.'
           ELSE 'In-person bounty address could not be located automatically. Check the address and set the location by hand.'
      END,
      jsonb_build_object('reason', left(COALESCE(p_reason, 'unknown'), 200)),
      'geocode:' || p_bounty_id::text
    )
    ON CONFLICT (dedupe_key) DO UPDATE
      SET kind = EXCLUDED.kind,
          channel = EXCLUDED.channel,
          poster_id = EXCLUDED.poster_id,
          bounty_id = EXCLUDED.bounty_id,
          summary = EXCLUDED.summary,
          metadata = EXCLUDED.metadata,
          status = 'open',
          updated_at = now(),
          resolved_at = NULL,
          resolved_by = NULL
      WHERE public.support_cases.status = 'resolved'
    RETURNING id INTO v_case_id;
  END IF;

  RETURN QUERY SELECT v_status, v_case_id IS NOT NULL;
END;
$$;

COMMIT;
