BEGIN;

CREATE FUNCTION public.get_bounty_applicant_qualification(
  p_bounty_ids uuid[],
  p_hunter_ids uuid[]
)
RETURNS TABLE (
  bounty_id uuid,
  hunter_id uuid,
  eligible boolean,
  score numeric,
  matched_terms jsonb,
  missing_required_terms text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_bounty_ids IS NULL OR cardinality(p_bounty_ids) > 200
    OR array_position(p_bounty_ids, NULL) IS NOT NULL
    OR p_hunter_ids IS NULL OR cardinality(p_hunter_ids) > 200
    OR array_position(p_hunter_ids, NULL) IS NOT NULL
  THEN RAISE EXCEPTION 'invalid_applicant_list'; END IF;
  PERFORM public.assert_account_active(auth.uid());
  IF (SELECT count(DISTINCT b.id) FROM public.bounties b
      WHERE b.id = ANY(p_bounty_ids)
        AND COALESCE(b.poster_id, b.user_id) = auth.uid())
    <> (SELECT count(DISTINCT requested_id) FROM unnest(p_bounty_ids) AS requested(requested_id))
  THEN RAISE EXCEPTION 'poster_required'; END IF;

  RETURN QUERY
  WITH requested_hunters AS (
    SELECT DISTINCT r.bounty_id, r.hunter_id
    FROM public.bounty_requests r
    WHERE r.bounty_id = ANY(p_bounty_ids)
      AND r.hunter_id = ANY(p_hunter_ids)
      AND r.status IN ('pending', 'accepted')
  ),
  requirement_terms AS (
    SELECT req.bounty_id, req.taxonomy_version, req.task_id, req.term_id, req.importance, term.label
    FROM public.bounty_requirements req
    JOIN public.capability_terms term
      ON (term.taxonomy_version, term.id) = (req.taxonomy_version, req.term_id)
    WHERE req.bounty_id = ANY(p_bounty_ids)
  ),
  comparisons AS (
    SELECT hunter.bounty_id, hunter.hunter_id, req.term_id, req.importance, req.label,
      capability.owner_id IS NOT NULL AS declared
    FROM requested_hunters hunter
    JOIN requirement_terms req ON req.bounty_id = hunter.bounty_id
    LEFT JOIN public.hunter_capabilities capability
      ON capability.owner_id = hunter.hunter_id
      AND capability.taxonomy_version = req.taxonomy_version
      AND capability.task_id = req.task_id
      AND capability.term_id = req.term_id
      AND capability.provenance = 'self_reported'
  ),
  summary AS (
    SELECT comparison.bounty_id, comparison.hunter_id,
      count(*) FILTER (WHERE importance = 'required') AS required_count,
      count(*) FILTER (WHERE importance = 'required' AND declared) AS matched_required_count,
      count(*) FILTER (WHERE importance = 'preferred') AS preferred_count,
      count(*) FILTER (WHERE importance = 'preferred' AND declared) AS matched_preferred_count,
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'label', label, 'importance', importance, 'provenance', 'self_reported'
        ) ORDER BY importance, label) FILTER (WHERE declared),
        '[]'::jsonb
      ) AS matched_terms,
      COALESCE(
        array_agg(label ORDER BY label) FILTER (WHERE importance = 'required' AND NOT declared),
        ARRAY[]::text[]
      ) AS missing_required_terms
    FROM comparisons comparison
    GROUP BY comparison.bounty_id, comparison.hunter_id
  )
  SELECT summary.bounty_id, summary.hunter_id,
    summary.matched_required_count = summary.required_count AS eligible,
    CASE
      WHEN summary.matched_required_count < summary.required_count THEN 0::numeric
      WHEN summary.preferred_count = 0 THEN 1::numeric
      ELSE summary.matched_preferred_count::numeric / summary.preferred_count
    END AS score,
    summary.matched_terms,
    summary.missing_required_terms
  FROM summary
  ORDER BY summary.bounty_id, score DESC, summary.hunter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bounty_applicant_qualification(uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bounty_applicant_qualification(uuid[], uuid[])
  TO authenticated;

COMMIT;
