-- Give reports.id (and moderation_actions.id) a server-side default.
--
-- Production's reports.id is `uuid NOT NULL` with NO default, unlike the
-- baseline migration (`DEFAULT gen_random_uuid()`); the table was created
-- outside git and 20260904000000_align_staging_with_production.sql never
-- touched the id column. lib/services/report-service.ts does not send an id, so
-- EVERY report insert failed with
--   null value in column "id" of relation "reports" violates not-null constraint
-- (#871). Checked 2026-09-28: public.reports had 0 rows ever.
--
-- moderation_actions.id has the same shape (declared `UUID PRIMARY KEY` with no
-- default in 20260904000000). Nothing writes it yet; fixed here so the first
-- writer doesn't hit the same wall.
--
-- Additive and idempotent: SET DEFAULT only affects future inserts.

ALTER TABLE public.reports ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.moderation_actions ALTER COLUMN id SET DEFAULT gen_random_uuid();
