-- Counts recently-active hunters near a point, for the feed's "N active hunters
-- in your area" pill.
--
-- Why a definer function and not a client query: profiles RLS restricts SELECT
-- to the caller's own row, and public_profiles (the public read path) exposes
-- no coordinates at all — deliberately, see
-- 20260718235500_formalize_public_profiles_view.sql. Neither can answer "how
-- many people are near me", and neither should start exposing locations just to
-- make a counter work. This returns a single integer and never a row, so the
-- caller learns a density and nothing about any individual.
--
-- Distance uses tracked profiles.latitude/longitude directly so this migration is
-- self-contained in fresh environments. A GiST expression index keeps the
-- ST_DWithin below index-backed without depending on an untracked geom column or
-- trigger.
--
-- Activity uses last_session_at. profiles.last_seen_at is dead — it is NULL for
-- all 249 rows in production and nothing writes it — so treating it as an
-- activity signal would make this counter permanently zero.

alter table public.profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Supports the ST_DWithin below. No-op where it already exists.
create index if not exists profiles_lat_lng_geog_gix
  on public.profiles
  using gist ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography))
  where latitude is not null
    and longitude is not null;

-- Keeps the activity predicate cheap on the subset that can ever match.
create index if not exists profiles_last_session_at_idx
  on public.profiles (last_session_at)
  where latitude is not null
    and longitude is not null;

create or replace function public.fn_count_active_hunters_nearby(
  p_lat           double precision,
  p_lng           double precision,
  p_radius_miles  double precision default 30,
  p_active_within interval         default interval '7 days'
)
returns integer
language sql
security definer
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select count(*)::int
  from public.profiles p
  where p.latitude is not null
    and p.longitude is not null
    and p.last_session_at is not null
    and p.last_session_at > now() - least(p_active_within, interval '30 days')
    and p.primary_role in ('hunter', 'both')
    -- Never count the viewer in their own "people near you" number.
    and p.id is distinct from auth.uid()
    and ST_DWithin(
          ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          -- Clamped, not trusted. The radius is caller-supplied, and an
          -- unclamped one turns an aggregate into a locator: shrink it far
          -- enough around a guessed point and the count identifies a single
          -- person. A 5-mile floor keeps every answer a neighbourhood-scale
          -- number. The 100-mile ceiling just bounds the scan.
          greatest(5.0, least(100.0, coalesce(p_radius_miles, 30.0))) * 1609.344
        );
$$;

comment on function public.fn_count_active_hunters_nearby(double precision, double precision, double precision, interval) is
  'Count of recently-active hunters within a radius of a point, excluding the caller. Aggregate only — never exposes individual locations. Radius clamped to 5-100 miles so the count cannot be used to locate a specific user.';

-- Signed-in callers only. anon has no auth.uid(), so it could not be excluded
-- from its own count, and an unauthenticated caller has no reason to probe
-- population density.
revoke all on function public.fn_count_active_hunters_nearby(double precision, double precision, double precision, interval) from public;
revoke all on function public.fn_count_active_hunters_nearby(double precision, double precision, double precision, interval) from anon;
grant execute on function public.fn_count_active_hunters_nearby(double precision, double precision, double precision, interval) to authenticated;
grant execute on function public.fn_count_active_hunters_nearby(double precision, double precision, double precision, interval) to service_role;

notify pgrst, 'reload schema';
