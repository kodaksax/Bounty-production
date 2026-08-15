-- 20260815213000_rearm_bogus_dismissals_and_reset_show_counts.sql
--
-- Data migration accompanying the activation-moment queue fixes (guard timestamp,
-- terminal-status eligibility, universal show cap).
--
-- WHY THIS EXISTS
-- ---------------
-- Two code changes are about to land that treat existing rows as authoritative:
--
--   1. `dismissed` becomes a TERMINAL state — only an explicit enqueue() re-arms it.
--   2. A universal cap of 3 presentations per moment is enforced.
--
-- Both are correct going forward. Applied to the CURRENT table they would make two
-- pre-existing defects permanent:
--
--   * ~85 dismissals were fabricated by the dismissal-guard bug (recorded < 2s after
--     the current presentation — one as fast as 0.16s, one with NEGATIVE latency).
--     Making `dismissed` terminal would retire those prompts forever for ~84 users:
--     37 would never be asked for a profile photo again, 35 never asked to verify ID.
--     Measured 2026-08-15: 20/196 profiles have an avatar, 2 users are ID-verified.
--
--   * 70 rows in an ACTIVE state carry an inflated `shown_count` produced by the
--     re-presentation bug (max 413, still incrementing at time of writing). 27 of
--     them are already at or above the new cap of 3 and would go permanently
--     ineligible the instant the engine change ships — including ordinary
--     identity_verification and enable_location prompts sitting at exactly 3.
--
-- This migration gives every affected user a fair, capped restart, and snapshots
-- what it changed so the operation is reversible and auditable.
--
-- ORDERING: run this BEFORE the cap trigger migration
-- (20260815213100_cap_activation_moment_shows.sql).
--
-- Idempotent: safe to re-run. The second run matches zero rows.

begin;

-- ---------------------------------------------------------------------------
-- 0. Snapshot — preserves the pre-migration state for rollback and forensics.
--    Also the only surviving record of the 413-show row once counts are reset.
-- ---------------------------------------------------------------------------
create table if not exists activation_moment_repair_snapshot (
  snapshot_id     uuid primary key default gen_random_uuid(),
  migration       text        not null,
  captured_at     timestamptz not null default now(),
  repair_action   text        not null,          -- 'rearm_bogus_dismissal' | 'reset_show_count'
  moment_id       uuid        not null,
  user_id         uuid        not null,
  moment_type     text        not null,
  old_status      text,
  old_shown_count integer,
  old_first_shown_at timestamptz,
  old_last_shown_at  timestamptz,
  old_dismissed_at   timestamptz,
  old_snoozed_until  timestamptz,
  dismiss_latency_secs numeric
);

comment on table activation_moment_repair_snapshot is
  'Pre-change snapshot of user_activation_moments rows repaired by the 2026-08-15 '
  'activation-moment queue fix. Written once per repaired row. Retain until the fix '
  'is confirmed stable in production; see the rollback block at the foot of the '
  'migration file.';

alter table activation_moment_repair_snapshot enable row level security;
-- No policies: service-role only by design, consistent with the other
-- operational tables in this schema (reconciliation_findings, admin_action_log).

-- ---------------------------------------------------------------------------
-- 1. Re-arm dismissals the new guard would have rejected.
--
--    Criterion: dismissed less than 2s after the CURRENT presentation
--    (last_shown_at), which is the timestamp the corrected guard uses. This
--    deliberately includes negative latencies (dismissed before shown), which
--    are unambiguously not user-initiated.
--
--    Guard: never re-arm a prompt whose underlying condition the user has since
--    satisfied. As of 2026-08-15 this matches 0 rows, but it keeps the migration
--    correct if it is re-run later or applied to another environment.
-- ---------------------------------------------------------------------------
with bogus as (
  select m.id, m.user_id, m.moment_type, m.status, m.shown_count,
         m.first_shown_at, m.last_shown_at, m.dismissed_at, m.snoozed_until,
         extract(epoch from (m.dismissed_at - m.last_shown_at))::numeric as latency
  from user_activation_moments m
  join profiles p on p.id = m.user_id
  where m.status = 'dismissed'
    and m.dismissed_at is not null
    and m.last_shown_at is not null
    and extract(epoch from (m.dismissed_at - m.last_shown_at)) < 2
    -- skip anything the user has already done
    and not (
         (m.moment_type = 'add_profile_photo'         and p.avatar is not null)
      or (m.moment_type = 'identity_verification'     and (p.id_verification_status = 'verified'
                                                           or p.stripe_identity_status = 'verified'))
      or (m.moment_type = 'enable_location'           and p.latitude is not null)
      or (m.moment_type = 'stripe_connect_onboarding' and coalesce(p.stripe_connect_payouts_enabled, false))
    )
)
insert into activation_moment_repair_snapshot (
  migration, repair_action, moment_id, user_id, moment_type,
  old_status, old_shown_count, old_first_shown_at, old_last_shown_at,
  old_dismissed_at, old_snoozed_until, dismiss_latency_secs
)
select '20260815213000', 'rearm_bogus_dismissal', b.id, b.user_id, b.moment_type,
       b.status, b.shown_count, b.first_shown_at, b.last_shown_at,
       b.dismissed_at, b.snoozed_until, b.latency
from bogus b;

update user_activation_moments m
set status        = 'pending',
    dismissed_at  = null,
    snoozed_until = null,
    shown_count   = 0,          -- fair restart under the new cap
    updated_at    = now()
from activation_moment_repair_snapshot s
where s.migration = '20260815213000'
  and s.repair_action = 'rearm_bogus_dismissal'
  and s.moment_id = m.id;

-- ---------------------------------------------------------------------------
-- 2. Reset inflated show counts on rows that are still ACTIVE.
--
--    Without this, the new cap of 3 retroactively retires 27 live prompts whose
--    counts were inflated by the re-presentation bug, not by genuine exposure.
--    Terminal rows (dismissed/completed/expired) are intentionally left alone —
--    their counts are historical record and they are excluded from selection
--    anyway under the new engine rules.
-- ---------------------------------------------------------------------------
insert into activation_moment_repair_snapshot (
  migration, repair_action, moment_id, user_id, moment_type,
  old_status, old_shown_count, old_first_shown_at, old_last_shown_at,
  old_dismissed_at, old_snoozed_until
)
select '20260815213000', 'reset_show_count', m.id, m.user_id, m.moment_type,
       m.status, m.shown_count, m.first_shown_at, m.last_shown_at,
       m.dismissed_at, m.snoozed_until
from user_activation_moments m
where m.status in ('pending', 'shown', 'snoozed')
  and m.shown_count > 0
  and not exists (                       -- don't double-snapshot rows handled in step 1
    select 1 from activation_moment_repair_snapshot s
    where s.migration = '20260815213000' and s.moment_id = m.id
  );

update user_activation_moments m
set shown_count = 0,
    updated_at  = now()
from activation_moment_repair_snapshot s
where s.migration = '20260815213000'
  and s.repair_action = 'reset_show_count'
  and s.moment_id = m.id;

-- ---------------------------------------------------------------------------
-- 3. Assertions — fail loudly if production diverged from what was measured.
--
--    Measured on production 2026-08-15 ~21:20 UTC: 85 re-armed, 69 counts reset,
--    26 active rows at/above the cap. These drift by a row or two between checks
--    because the re-presentation bug is still running — the reset count moved
--    70 -> 69 within minutes during validation.
--    Bounds are deliberately loose; they exist to catch an order-of-magnitude
--    surprise, not to pin exact values.
--    Widen or drop them if you apply this well after 2026-08-16.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rearmed integer;
  v_reset   integer;
  v_left    integer;
begin
  select count(*) into v_rearmed from activation_moment_repair_snapshot
   where migration = '20260815213000' and repair_action = 'rearm_bogus_dismissal';
  select count(*) into v_reset from activation_moment_repair_snapshot
   where migration = '20260815213000' and repair_action = 'reset_show_count';

  raise notice 'activation-moment repair: % dismissals re-armed, % show counts reset',
    v_rearmed, v_reset;

  if v_rearmed not between 1 and 300 then
    raise exception 'Re-armed row count % is outside the expected range (measured 85 on 2026-08-15). Review before proceeding.', v_rearmed;
  end if;

  if v_reset not between 1 and 300 then
    raise exception 'Reset row count % is outside the expected range (measured 70 on 2026-08-15). Review before proceeding.', v_reset;
  end if;

  -- Post-condition: no active row may exceed the incoming cap of 3.
  select count(*) into v_left
    from user_activation_moments
   where status in ('pending', 'shown', 'snoozed') and shown_count >= 3;

  if v_left > 0 then
    raise exception 'Post-migration: % active rows still have shown_count >= 3; the cap would retire them.', v_left;
  end if;
end $$;

commit;

-- ===========================================================================
-- ROLLBACK (run manually; not part of the migration)
-- ===========================================================================
-- begin;
-- update user_activation_moments m
-- set status        = s.old_status,
--     shown_count   = s.old_shown_count,
--     dismissed_at  = s.old_dismissed_at,
--     snoozed_until = s.old_snoozed_until,
--     updated_at    = now()
-- from activation_moment_repair_snapshot s
-- where s.migration = '20260815213000' and s.moment_id = m.id;
-- commit;
--
-- ===========================================================================
-- POST-DEPLOY VERIFICATION (run after the client bundle is live)
-- ===========================================================================
-- All three should stay at zero / low for rows presented after the deploy:
--
-- select
--   count(*) filter (where last_shown_at > dismissed_at)                    as reshown_after_dismiss,
--   count(*) filter (where status = 'completed' and shown_count > 3)        as reshown_after_complete,
--   count(*) filter (where dismissed_at is not null
--                     and extract(epoch from (dismissed_at - last_shown_at)) < 2) as fast_dismissals,
--   max(shown_count)                                                        as max_shows
-- from user_activation_moments
-- where last_shown_at > '<deploy timestamp>';
--
-- Pre-migration baselines (2026-08-15 21:15 UTC):
--   fast dismissals vs last_shown_at ...... 141
--   re-presented after dismissal .......... 56
--   max shown_count ....................... 413
