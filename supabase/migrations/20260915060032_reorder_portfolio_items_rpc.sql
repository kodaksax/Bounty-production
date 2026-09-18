-- Batches portfolioService.reorderItems into a single server-side statement.
-- The previous client implementation issued one UPDATE per item (N requests,
-- no shared transaction, per-request errors silently ignored via
-- Promise.all), which is slow on mobile networks and can leave positions
-- partially reordered with no surfaced failure. This does it in one
-- statement instead.
--
-- No SECURITY DEFINER: relies on (and is redundant with) the existing
-- portfolio_items_update_own RLS policy, scoping every row touched to
-- auth.uid() regardless of what the caller passes.

BEGIN;

CREATE OR REPLACE FUNCTION public.reorder_portfolio_items(p_item_ids uuid[])
RETURNS SETOF public.portfolio_items
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE public.portfolio_items pi
     SET position = t.new_position - 1
    FROM unnest(p_item_ids) WITH ORDINALITY AS t(id, new_position)
   WHERE pi.id = t.id
     AND pi.user_id = auth.uid()
  RETURNING pi.*;
$$;

REVOKE ALL ON FUNCTION public.reorder_portfolio_items(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_portfolio_items(uuid[]) TO authenticated;

COMMIT;

-- Verification:
--   -- select public.reorder_portfolio_items(array[id1, id2, id3]) as the
--      owning user -> returns the 3 rows with position 0,1,2 and the table
--      reflects the new order in one round trip
--   -- passing another user's item id -> that id is silently skipped (no
--      row matches pi.user_id = auth.uid()), never reordering someone else's
--      portfolio
