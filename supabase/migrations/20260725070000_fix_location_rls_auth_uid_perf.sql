-- Migration: Location redesign (7/7) — RLS perf fix for hunter_service_areas/saved_locations
-- Created: 2026-07-25
--
-- get_advisors (performance) flagged both new tables' RLS policies for the
-- standard "Auth RLS Initialization Plan" issue: bare auth.uid() calls
-- re-evaluate per row instead of once per query. Fixes by wrapping in
-- (select auth.uid()), matching the pattern the live bounties table's own
-- policies already use (bounties_select_own etc., confirmed via direct
-- pg_policy query against production).

DROP POLICY IF EXISTS hunter_service_areas_select_own ON public.hunter_service_areas;
CREATE POLICY hunter_service_areas_select_own
  ON public.hunter_service_areas FOR SELECT
  USING ((select auth.uid()) = hunter_id);

DROP POLICY IF EXISTS hunter_service_areas_insert_own ON public.hunter_service_areas;
CREATE POLICY hunter_service_areas_insert_own
  ON public.hunter_service_areas FOR INSERT
  WITH CHECK ((select auth.uid()) = hunter_id);

DROP POLICY IF EXISTS hunter_service_areas_update_own ON public.hunter_service_areas;
CREATE POLICY hunter_service_areas_update_own
  ON public.hunter_service_areas FOR UPDATE
  USING ((select auth.uid()) = hunter_id)
  WITH CHECK ((select auth.uid()) = hunter_id);

DROP POLICY IF EXISTS hunter_service_areas_delete_own ON public.hunter_service_areas;
CREATE POLICY hunter_service_areas_delete_own
  ON public.hunter_service_areas FOR DELETE
  USING ((select auth.uid()) = hunter_id);

DROP POLICY IF EXISTS saved_locations_select_own ON public.saved_locations;
CREATE POLICY saved_locations_select_own
  ON public.saved_locations FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS saved_locations_insert_own ON public.saved_locations;
CREATE POLICY saved_locations_insert_own
  ON public.saved_locations FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS saved_locations_update_own ON public.saved_locations;
CREATE POLICY saved_locations_update_own
  ON public.saved_locations FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS saved_locations_delete_own ON public.saved_locations;
CREATE POLICY saved_locations_delete_own
  ON public.saved_locations FOR DELETE
  USING ((select auth.uid()) = user_id);
