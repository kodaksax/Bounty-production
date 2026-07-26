-- Notification redesign, migration 5/6: quiet hours preferences on profiles.
--
-- Stored as minutes-since-midnight (local time) + an IANA timezone name rather
-- than a Postgres `time`, so DST transitions are handled by Deno's
-- Intl.DateTimeFormat at read time (in process-notification) instead of by SQL
-- time arithmetic. notification_timezone IS NULL means quiet hours are disabled
-- for that user (fail open — never silently block a notification because we
-- don't know their timezone).

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiet_hours_start smallint,
  ADD COLUMN IF NOT EXISTS quiet_hours_end   smallint,
  ADD COLUMN IF NOT EXISTS notification_timezone text;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_quiet_hours_range_check
  CHECK (
    (quiet_hours_start IS NULL OR (quiet_hours_start >= 0 AND quiet_hours_start < 1440))
    AND (quiet_hours_end IS NULL OR (quiet_hours_end >= 0 AND quiet_hours_end < 1440))
  );

COMMIT;
