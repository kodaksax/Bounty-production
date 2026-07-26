-- Migration: Location redesign (1/6) — bounty location precision columns
-- Created: 2026-07-25
--
-- BACKGROUND: verified against live schema before writing this (see
-- docs precedent in 20260715h_fix_bounties_zip_code_drift.sql) —
-- public.bounties.latitude/longitude (double precision) ALREADY EXIST in
-- production but are untracked by any migration in this repo and are not
-- read or written by any app code (grepped). Same drift pattern as
-- zip_code. Reconstructed idempotently here rather than silently reused,
-- so a fresh environment matches prod. (public.profiles also has the same
-- untracked latitude/longitude columns — out of scope for this migration;
-- the hunter work-radius feature added later in this series uses a
-- dedicated hunter_service_areas table instead of those columns, since
-- their original purpose/consumers could not be established.)
--
-- NEW columns for the location redesign's privacy model (see plan doc):
--   approx_latitude / approx_longitude — a jittered display point, computed
--     once by a trigger in the next migration and never derived from a live
--     re-randomization, so it can be shown to any browsing user pre-acceptance
--     without ever converging on the real point via repeated sampling.
--   neighborhood — human-readable coarse label ("SoMa", "Downtown Austin")
--     shown pre-acceptance instead of the exact address.
--   unit — apartment/suite/unit number, kept out of the coarse `location`
--     text entirely (it's exact-only, same privacy tier as latitude/longitude).
--
-- latitude/longitude/unit/location are exact-precision and get locked down
-- from direct SELECT in a later migration in this series once app code is
-- verified to route through the get_bounty_exact_location() RPC instead —
-- NOT done in this migration (see that migration's header for why).

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS approx_latitude double precision,
  ADD COLUMN IF NOT EXISTS approx_longitude double precision,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS unit text;

COMMENT ON COLUMN public.bounties.latitude IS
  'Exact latitude of the job location. Privacy-sensitive: not directly readable by authenticated/anon once the column-lock-down migration lands — use get_bounty_exact_location(bounty_id), which is scoped to the poster and the accepted hunter.';
COMMENT ON COLUMN public.bounties.longitude IS
  'Exact longitude of the job location. Same access restriction as latitude — see that column comment.';
COMMENT ON COLUMN public.bounties.unit IS
  'Apartment/suite/unit number. Exact-precision, same access restriction as latitude/longitude.';
COMMENT ON COLUMN public.bounties.approx_latitude IS
  'Jittered display latitude (120-350m random offset from the real point, computed once at write time by bounties_compute_approx_location()). Safe to show to any browsing user before bounty acceptance.';
COMMENT ON COLUMN public.bounties.approx_longitude IS
  'Jittered display longitude — see approx_latitude comment.';
COMMENT ON COLUMN public.bounties.neighborhood IS
  'Coarse human-readable area label (e.g. neighborhood/sublocality) shown pre-acceptance instead of the exact address.';
