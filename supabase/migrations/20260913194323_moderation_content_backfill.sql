-- One-time backfill: run the retuned content scan (email/url/handle/promo/
-- honor-price) against every currently live listing, not just the last 7
-- days. run_moderation_sweep() intentionally stays windowed to 7 days for
-- its velocity/duplicate/repeated-listing checks (those are time-relative
-- and would be expensive/meaningless unbounded); new listings from here on
-- are covered at insert-time by the moderation_scan_bounty trigger
-- regardless of age. This closes the one gap: listings that already existed
-- before this migration, are older than 7 days, and haven't had their
-- title/description/is_for_honor touched since (the two live andrepace057
-- spam rows are exactly this case -- posted 2026-08-25/26).
DO $$
DECLARE
  v_b       record;
  v_signals jsonb;
BEGIN
  FOR v_b IN
    SELECT id, title, description, is_for_honor
    FROM public.bounties
    WHERE status::text IN ('open', 'in_progress', 'cancellation_requested')
  LOOP
    v_signals := public.moderation_scan_content(v_b.title, v_b.description);

    IF COALESCE(v_b.is_for_honor, false) AND lower(v_b.title) ~ '\y[0-9]+\$' THEN
      v_signals := v_signals || jsonb_build_object(
        'type', 'honor_listing_with_price', 'severity', 'high', 'weight', 3.0,
        'evidence', jsonb_build_object('title', v_b.title));
    END IF;

    IF jsonb_array_length(v_signals) > 0 THEN
      PERFORM public.moderation_apply_signals(v_b.id, v_signals, 'content');
    END IF;
  END LOOP;
END $$;
