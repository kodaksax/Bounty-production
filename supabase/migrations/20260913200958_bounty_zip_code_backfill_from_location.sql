-- One-time backfill: extract a ZIP from bounties.location for rows that
-- already carry one embedded in the free-text address (e.g. "5018 Painters
-- Mill Road, Owings Mills, MD 21117") but never had zip_code populated,
-- because no write path derived it before app/services/bountyService.ts
-- started doing so at create/update time. Only fills currently-NULL
-- zip_code -- never overwrites an existing value. Dry-run via
-- BEGIN/ROLLBACK confirmed exactly 6 of 152 live bounties match; the
-- remainder have either no location text, a bare city/nickname with no
-- ZIP, or coords only (which would require external reverse-geocoding
-- infra this project doesn't have server-side).
UPDATE public.bounties
SET zip_code = substring(location from '\y(\d{5})\y\D*$')
WHERE zip_code IS NULL
  AND location IS NOT NULL
  AND location ~ '\y\d{5}\y';
