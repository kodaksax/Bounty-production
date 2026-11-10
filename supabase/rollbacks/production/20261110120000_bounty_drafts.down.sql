-- Rollback for 20261110120000_bounty_drafts.sql.
--
-- Drops every server-side draft. Each device still holds its own local copy
-- (AsyncStorage bounty-draft-v1:<userId>), so no poster loses the draft on the
-- device they last used. Only the cross-device copy goes away.
--
-- Clients that already shipped the sync keep working without the table: a
-- failed fetch is treated as "server unavailable" and the local copy is used.
--
-- Also remove the bounty_drafts block from supabase/security/rls-manifest.json
-- in the same change, or the RLS check reports "protected table does not exist".

BEGIN;

DROP TABLE IF EXISTS public.bounty_drafts;

COMMIT;
