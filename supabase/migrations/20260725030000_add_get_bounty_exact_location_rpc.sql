-- Migration: Location redesign (3/6) — get_bounty_exact_location() RPC
-- Created: 2026-07-25
--
-- The reveal-on-acceptance choke point. SECURITY DEFINER, but unlike a
-- naive "trust whatever the caller passes" function, access is re-checked
-- server-side against auth.uid() every call -- there is no caller-supplied
-- identity to spoof. Returns the exact address/coordinates/unit only when
-- the calling user is the bounty's poster OR its accepted hunter
-- (bounties.poster_id / bounties.accepted_by, the live column names --
-- verified against production schema directly, since git's baseline
-- migration's hunter_id/user_id names have drifted from what's actually
-- deployed). Anyone else gets zero rows back, not an error.
--
-- This mirrors get_my_profile() (20260719004500_add_get_my_profile_rpc.sql),
-- this project's existing pattern for "self-scoped read survives a future
-- column REVOKE." The column REVOKE itself (making this RPC the *only* way
-- to read these columns) is a separate, later, explicitly-gated step -- see
-- that migration's header for why it isn't bundled in here.

CREATE OR REPLACE FUNCTION public.get_bounty_exact_location(p_bounty_id uuid)
RETURNS TABLE(location text, latitude double precision, longitude double precision, unit text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT b.location, b.latitude, b.longitude, b.unit
  FROM public.bounties b
  WHERE b.id = p_bounty_id
    AND auth.uid() IS NOT NULL
    AND auth.uid() IN (b.poster_id, b.accepted_by);
$$;

COMMENT ON FUNCTION public.get_bounty_exact_location(uuid) IS
  'Returns a bounty''s exact location/coordinates/unit, scoped server-side to auth.uid() being the poster (poster_id) or the accepted hunter (accepted_by). Returns zero rows for anyone else, including other authenticated users browsing the open feed.';

REVOKE EXECUTE ON FUNCTION public.get_bounty_exact_location(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bounty_exact_location(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bounty_exact_location(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
