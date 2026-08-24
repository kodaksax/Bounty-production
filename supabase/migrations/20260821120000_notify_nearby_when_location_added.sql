-- Sends the "New Bounty Near You" push for a bounty that was posted without a
-- location and had one added moments later.
--
-- Why this is needed: the two-step posting flow (app/screens/CreateBounty/
-- index.tsx) publishes after title + amount, then collects photos, location
-- and schedule on its confirmation screen -- against the already-live row. All
-- three proximity dispatchers (fn_notify_radius_matched_bounty,
-- fn_notify_service_area_matched_bounty, fn_notify_zip_matched_bounty) were
-- wired AFTER INSERT only. trg_bounties_sync_geom and
-- trg_bounties_compute_approx_location DO run on UPDATE, so such a bounty
-- became findable in the radius feed -- it just never notified anybody. Every
-- in-person bounty posted through that flow was silently missing its only push
-- to nearby hunters.
--
-- The dispatch is ONE-SHOT per bounty, tracked by bounties.nearby_notified_at:
--   * stamped at INSERT when the row already carries coordinates or a zip,
--     because the existing AFTER INSERT triggers have already dispatched
--   * stamped at UPDATE the first time either one appears
-- So a bounty gets at most one "near you" blast however many times its address
-- is later edited, cleared, or re-added. Editing an address must never become a
-- way to re-notify the neighbourhood.
--
-- The claim is made in a BEFORE trigger and the AFTER triggers key off that
-- exact NULL -> NOT NULL transition. That means:
--   * one decision, in one place, shared by all three dispatchers
--   * no AFTER trigger writes to bounties, so there is no recursion to guard
--   * a later backfill or bulk UPDATE cannot re-fire them, since OLD is set
--
-- No backfill of nearby_notified_at is included on purpose. Historical rows
-- keep it NULL, and they are still protected: the AFTER triggers additionally
-- require the location to be appearing for the first time (old.geom is null),
-- which is false for every bounty that already had one. Stamping ~all rows
-- would rewrite updated_at across the table and broadcast a realtime change
-- per row (bounties_broadcast_trigger) for no behavioural gain.

alter table public.bounties
  add column if not exists nearby_notified_at timestamptz;

comment on column public.bounties.nearby_notified_at is
  'When the one-shot "New Bounty Near You" dispatch was claimed for this bounty. NULL means it has never had coordinates or a zip code to match on.';

-- Claims the dispatch. Sets nothing else, and never touches another row.
--
-- Reads latitude/longitude rather than geom deliberately: geom is filled in by
-- trg_bounties_sync_geom, another BEFORE trigger, and BEFORE triggers run in
-- trigger-name order. Keying on the columns the poster actually writes keeps
-- this correct regardless of how either trigger is named.
create or replace function public.fn_bounties_claim_nearby_notification()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_has_coords boolean := new.latitude is not null and new.longitude is not null;
  v_has_zip    boolean := new.zip_code is not null and btrim(new.zip_code) <> '';
  v_had_coords boolean;
  v_had_zip    boolean;
begin
  -- Already claimed: nothing more to do, ever.
  if new.nearby_notified_at is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The AFTER INSERT dispatchers are about to run (or already decided there
    -- was nobody to tell) -- either way this bounty has had its one shot.
    if v_has_coords or v_has_zip then
      new.nearby_notified_at := now();
    end if;
    return new;
  end if;

  -- An accepted, completed or cancelled bounty has no business advertising
  -- itself to hunters.
  if new.status <> 'open' then
    return new;
  end if;

  v_had_coords := old.latitude is not null and old.longitude is not null;
  v_had_zip    := old.zip_code is not null and btrim(old.zip_code) <> '';

  if (v_has_coords and not v_had_coords) or (v_has_zip and not v_had_zip) then
    -- The push reads "...was just posted near you", so it has to stay roughly
    -- true. In the posting flow this fires within minutes of publishing; an
    -- address added to a days-old bounty is a different event and is
    -- deliberately left unnotified rather than announced as new.
    if new.created_at > now() - interval '24 hours' then
      new.nearby_notified_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bounties_claim_nearby_notification on public.bounties;
create trigger trg_bounties_claim_nearby_notification
  before insert or update on public.bounties
  for each row
  execute function public.fn_bounties_claim_nearby_notification();

-- The three dispatchers, now also reachable on the update that first gives a
-- bounty a location. Each reuses the existing AFTER INSERT function unchanged
-- -- they read only NEW, so they behave identically under UPDATE.
--
-- geom is safe to test here (unlike in the BEFORE trigger above): every BEFORE
-- trigger, trg_bounties_sync_geom included, has already run by the time an
-- AFTER trigger's WHEN clause is evaluated.

drop trigger if exists trg_bounties_notify_radius_on_location_added on public.bounties;
create trigger trg_bounties_notify_radius_on_location_added
  after update on public.bounties
  for each row
  when (
    old.nearby_notified_at is null
    and new.nearby_notified_at is not null
    and old.geom is null
    and new.geom is not null
  )
  execute function public.fn_notify_radius_matched_bounty();

drop trigger if exists trg_bounties_notify_service_area_on_location_added on public.bounties;
create trigger trg_bounties_notify_service_area_on_location_added
  after update on public.bounties
  for each row
  when (
    old.nearby_notified_at is null
    and new.nearby_notified_at is not null
    and old.geom is null
    and new.geom is not null
  )
  execute function public.fn_notify_service_area_matched_bounty();

drop trigger if exists trg_bounties_notify_zip_on_location_added on public.bounties;
create trigger trg_bounties_notify_zip_on_location_added
  after update on public.bounties
  for each row
  when (
    old.nearby_notified_at is null
    and new.nearby_notified_at is not null
    and (old.zip_code is null or btrim(old.zip_code) = '')
    and new.zip_code is not null
    and btrim(new.zip_code) <> ''
  )
  execute function public.fn_notify_zip_matched_bounty();
