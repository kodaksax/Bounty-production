-- 20260824120000_seed_post_first_bounty_moments.sql
--
-- Enqueues the `post_first_bounty` activation moment for users who declared a
-- poster intent during onboarding but have never published a bounty.
--
-- WHY THIS EXISTS
-- ---------------
-- The Moments Queue is live and working (profile-photo and notification
-- prompts are being shown and resolved daily), but `post_first_bounty` has
-- only ever produced `completed` rows -- 9 of them, all for users who had
-- ALREADY posted. Not one user has ever been shown the prompt.
--
-- Root cause: lib/moments/backfill.ts is the sole enqueue site for this
-- moment, and providers/moments-provider.tsx calls it as
--
--     backfillEventMoments(userId, profile?.primary_role, fetchedStates)
--
-- which only reaches backfillPostFirstBounty() when `primary_role` is
-- 'poster' or 'both'. Measured on production 2026-08-24:
--
--     profiles.primary_role = NULL ....... 259 / 313  (83%)
--     profiles.primary_role = 'hunter' ....  49
--     profiles.primary_role = 'poster' ....   5
--
-- `primary_role` is only written by hooks/useCompleteOnboarding.ts, and only
-- when the local onboarding context still carries an `intent` at completion.
-- Most users reach the app without that ever being persisted, so the gate
-- never opens and the enqueue branch never runs. The handful of rows that do
-- exist are all from the OTHER branch (markCompleted for users who already
-- had a bounty), which is why the table looks like the moment "only applies
-- to people who already posted."
--
-- The poster signal for these users does exist -- in analytics, not in
-- Postgres. This migration carries it across.
--
-- AUDIENCE
-- --------
-- The user id list below is every distinct Supabase user resolvable from a
-- PostHog `onboarding_role_selected` event with role='poster'. Produced
-- 2026-08-24 against PostHog project 461576 with:
--
--   WITH poster_persons AS (
--     SELECT DISTINCT person_id FROM events
--     WHERE event = 'onboarding_role_selected' AND properties.role = 'poster'
--   ), ids AS (
--     SELECT person_id,
--            argMax(coalesce(properties.user_id, properties.userId), timestamp) AS uid
--     FROM events
--     WHERE person_id IN (SELECT person_id FROM poster_persons)
--       AND coalesce(properties.user_id, properties.userId) != ''
--     GROUP BY person_id
--   )
--   SELECT DISTINCT uid FROM ids;
--
-- 88 PostHog persons picked 'poster'; 76 resolve to a user id (role is picked
-- on welcome.tsx before sign-up, so pre-auth-only persons cannot be mapped).
-- All 76 are listed. The WHERE clause below -- not the list -- decides who is
-- actually enqueued, so a user who posts between now and apply time is
-- correctly skipped. As measured on 2026-08-24 that filter yields 66:
--
--     76 PostHog user ids
--     -7  no matching profiles row
--     -3  already published a bounty (all 3 already hold a `completed` row)
--     == 66 enqueued
--
-- WHAT THE USER ACTUALLY SEES
-- ---------------------------
-- Nothing immediately. A `pending` row is necessary but not sufficient:
-- registry.ts additionally requires ctx.sessionCount >= 2 AND an activeScreen
-- of 'bounty' or 'postings' before the sheet is presented. So this reaches
-- people on a later app open, while they are on Feed or Activity -- never as
-- an interruption, and never mid-onboarding.
--
-- Note that post_first_bounty has priority 5, ahead of enable_notifications
-- (10) and add_profile_photo (20). For these 66 users it will therefore be
-- the next moment shown, ahead of any permission or profile prompt still
-- outstanding. That is the intent of this backfill, but it is a real change
-- in what those users see next.
--
-- Idempotent: safe to re-run. The second run matches zero rows.

begin;

-- ---------------------------------------------------------------------------
-- 0. Audit trail.
--
--    Reuses the table introduced by 20260815213000 -- it is the single record
--    of server-side writes to user_activation_moments, and keeping seeds and
--    repairs in one place keeps the rollback story in one place too. A seed
--    has no prior state, so the old_* columns stay null; `moment_id` is the
--    id of the row this migration CREATED, which is what rollback deletes.
-- ---------------------------------------------------------------------------
create table if not exists activation_moment_repair_snapshot (
  snapshot_id     uuid primary key default gen_random_uuid(),
  migration       text        not null,
  captured_at     timestamptz not null default now(),
  repair_action   text        not null,
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

alter table activation_moment_repair_snapshot enable row level security;
-- No policies: service-role only by design, consistent with the other
-- operational tables in this schema (reconciliation_findings, admin_action_log).

-- ---------------------------------------------------------------------------
-- 1. Enqueue.
--
--    Guards, in order:
--      * profile must exist, not be soft-deleted, not be restricted, and not
--        be banned/suspended -- never prompt an account that cannot act.
--      * zero bounties as poster_id. This is the authoritative "hasn't
--        published" check; analytics is only used to establish INTENT. This
--        guard is re-checked at insert time (in the WHERE clause) to prevent
--        a race condition where a user publishes a bounty between eligible
--        CTE evaluation and the actual insert.
--      * no existing user_activation_moments row for this moment type. The
--        `on conflict do nothing` below is a second line of defence, but the
--        explicit `not exists` is what keeps the RETURNING set (and therefore
--        the audit rows and the assertions) honest.
--
--    metadata records provenance so conversion for this cohort can be
--    measured separately from organically-enqueued rows later on.
-- ---------------------------------------------------------------------------
with poster_intent(user_id) as (
  select unnest(array[
    '02e0ddef-f464-46f6-a7da-82866cb83368','04b34428-a477-43ee-a3b1-da3d6bd9c4a6',
    '0615a5c7-df8a-4e1c-aef3-c683db8598d4','091a51f8-6bb2-4ad3-9708-a511acaa6241',
    '0a5a20e1-eb7e-4b4a-ad8a-96edd86a197a','10c14979-7f49-4c90-8279-cc38ca886353',
    '12a825e0-2e5c-4c48-a287-1ffe0559c352','13acc850-deb5-45af-bc4a-eeacce3b29fd',
    '14333f0d-45e7-4962-aa0c-baa70488c71c','14cf04d9-196d-441c-b770-569ad9a38fb5',
    '1680b6dc-9a5a-43b0-945b-e8ec22d27704','16efc236-2c30-4e3c-a61c-fe2f7f2e7a88',
    '20831504-d223-426e-bff7-62d513530202','23dbdaab-e28f-4552-a9e0-07cd219f3607',
    '260a5c55-1fb1-438c-9857-f6daa3b544ec','28846180-5778-4fad-a196-3db1e419335a',
    '293c75ce-2ae6-4110-b941-adf797aae444','2b218b9d-b996-412c-bbd1-6dd48e604360',
    '2e1aca90-b562-4460-9e0e-3116f318d2d9','2e5daef3-9da2-4e13-8888-ef7a139a75a3',
    '3220ed37-014f-407e-9f3d-368b2193e507','37d0843c-1a1c-4e44-9119-c14e120a60f9',
    '3de53ddd-3e55-4880-a4ea-d2f44d2d59b3','3f94b804-2065-4806-94e9-96a750830583',
    '3fe0a669-2adf-47ee-990a-eb1a8c0cde30','467020a8-59f8-4e00-8762-76a3c1545b7a',
    '5109b77b-4c8e-45f9-adc7-f70e46a0a84e','5b48fe18-4bbf-4de0-bf26-23a0a4bcc271',
    '5ddb3857-775b-4d1f-8597-4d6a461f7dfe','650d48ca-b4a3-4407-83a7-8cbb7c549b0f',
    '68ac1a1f-1b24-4dea-b805-d256b394e6a0','6813a9d6-81b2-4cf8-a1e9-b45e0b897d2f',
    '694c840f-ce29-4c8c-bb0d-a97af5b49d63','6b07b423-6106-436c-a7be-dd09c1373f0a',
    '6db83e86-b5c9-4914-8bfb-2478827e6bca','6fdeb6f5-b23f-44fc-98ed-c6dcd43dfad2',
    '76590723-b18d-47b8-b95c-c0c163e73caf','784f3a25-784c-4b51-b6a5-bdfdac9a3352',
    '78c972ad-d932-4f8f-a15d-e82ebefb1eab','7c563942-9490-4eee-8bb4-1351fe90af69',
    '7c6bb9c6-7e7c-4c56-836d-73f7443bf364','82055f79-cb45-4466-afd4-93f0813edab8',
    '8527a8d8-02ba-49fd-8476-5d0e1bef96fc','8bcc6278-efe6-495a-92ba-38e614ef1e20',
    '8d527e02-f041-409f-bc1f-55a2042478cb','8fb77487-c4a2-420c-b0bb-c89cb3f5c594',
    '91ea9e95-6eb8-4016-9e1d-f7763a626dcc','9527ccb4-d16c-4346-934a-a2b55b9287cf',
    'a5df564d-699e-4219-bf82-581b746eb642','b609c1c1-1ea8-4f9e-8785-34b10757f334',
    'b9f2a09c-f8c6-46a8-82f9-f5dfbbd07403','bcc7b325-cd09-475d-99dd-b4a77024eecd',
    'be03e586-3baa-437a-96ce-c921e7a4f924','bf975c53-219d-44cb-9207-54a7b0d83650',
    'c17f9c9c-0e36-4f96-9e07-8b1f9f183e1f','c33b5690-3cb6-440a-abae-18a9a8561c4e',
    'c7362fc9-cf99-4b40-b5ee-bc19eb4fa346','c7c8d758-e7ee-4489-8ccc-11627434b3e1',
    'cc8ca602-4ce0-463a-8d32-3e75fba265d3','ce86587b-7b32-4b21-aae8-5ab2ac2bb922',
    'cea53afd-f721-4715-bc84-4b93fd7ad167','d0b1ee42-f5c4-4962-a46d-4fa39f5904ce',
    'd1cc3d96-bc89-4e93-9fb3-fbc17ca6a411','d49d633c-ffe8-4ea1-9597-712f45eef1b2',
    'd4bb0e14-a04c-4e2c-ac9e-1a993bb7258f','d522f21e-5bab-4bfb-973f-7c8afbf01a63',
    'd6f6e174-5c71-49d0-b71c-46aebe3a76bb','da5acf52-c723-4974-82aa-6c86f7207023',
    'dd86fc07-5f37-4472-85dd-bf2da28a5151','df1bcf18-e6ca-4174-8a83-5fe8a03d0b5c',
    'e1d3ab44-0c59-4b50-8a9d-09a591b52c92','e43880c8-1076-472e-b5b2-757160b6c411',
    'efac9fdb-edc1-4ecc-bf93-58ff5552853c','f4bd948b-a0a6-4991-8e5d-d4a3978760e6',
    'fa53f54f-9368-47eb-b338-bf78963d6e8a','fb0f1a8e-537f-4db0-ab10-d88b0a88a1b3'
  ]::uuid[])
),
eligible as (
  select p.id as user_id
  from poster_intent i
  join profiles p on p.id = i.user_id
  where p.deleted_at is null
    and coalesce(p.account_restricted, false) = false
    and coalesce(p.account_status, 'active') = 'active'
    and not exists (
      select 1 from user_activation_moments m
      where m.user_id = p.id and m.moment_type = 'post_first_bounty'
    )
),
inserted as (
  insert into user_activation_moments (user_id, moment_type, status, shown_count, metadata)
  select e.user_id,
         'post_first_bounty',
         'pending',
         0,
         jsonb_build_object(
           'enqueuedBy', 'migration:20260824120000',
           'audience',   'posthog:onboarding_role_selected.role=poster',
           'reason',     'declared poster intent, never published a bounty'
         )
  from eligible e
  -- RE-CHECK at insert time to prevent race condition: a user could have
  -- published a bounty between eligible CTE evaluation and this insert.
  -- Moving this check into the insert statement makes it atomic with the
  -- insert itself, eliminating the race window.
  where not exists (select 1 from bounties b where b.poster_id = e.user_id)
  on conflict (user_id, moment_type) do nothing
  returning id, user_id, moment_type
)
insert into activation_moment_repair_snapshot (
  migration, repair_action, moment_id, user_id, moment_type
)
select '20260824120000', 'seed_post_first_bounty', i.id, i.user_id, i.moment_type
from inserted i;

-- ---------------------------------------------------------------------------
-- 2. Assertions -- fail loudly if production diverged from what was measured.
--
--    Measured on production 2026-08-24: 66 rows enqueued out of 76 candidate
--    ids. The bound is deliberately loose; it exists to catch an
--    order-of-magnitude surprise (an empty list, or the guards silently
--    matching everybody), not to pin an exact value. A re-run legitimately
--    inserts 0 rows, so the assertion is made against the cumulative audit
--    total rather than this run's insert count.
-- ---------------------------------------------------------------------------
do $$
declare
  v_seeded_now   integer;
  v_seeded_total integer;
  v_bad          integer;
begin
  select count(*) into v_seeded_total
    from activation_moment_repair_snapshot
   where migration = '20260824120000' and repair_action = 'seed_post_first_bounty';

  select count(*) into v_seeded_now
    from activation_moment_repair_snapshot
   where migration = '20260824120000'
     and repair_action = 'seed_post_first_bounty'
     and captured_at > now() - interval '1 minute';

  raise notice 'post_first_bounty seed: % rows enqueued this run, % total',
    v_seeded_now, v_seeded_total;

  if v_seeded_total not between 1 and 120 then
    raise exception
      'Seeded row count % is outside the expected range (measured 66 on 2026-08-24). Review before proceeding.',
      v_seeded_total;
  end if;

  -- Post-condition: nothing was enqueued for a user who has in fact posted.
  select count(*) into v_bad
    from activation_moment_repair_snapshot s
   where s.migration = '20260824120000'
     and exists (select 1 from bounties b where b.poster_id = s.user_id);

  if v_bad > 0 then
    raise exception
      'Post-migration: % seeded users already have a bounty; the enqueue guard did not hold.',
      v_bad;
  end if;
end $$;

commit;

-- ===========================================================================
-- ROLLBACK (run manually; not part of the migration)
-- ===========================================================================
-- Deletes only rows this migration created, and only those the user has not
-- interacted with since -- a row already shown or resolved is left alone, as
-- deleting it would re-arm the prompt from scratch.
--
-- begin;
-- delete from user_activation_moments m
--  using activation_moment_repair_snapshot s
--  where s.migration = '20260824120000'
--    and s.repair_action = 'seed_post_first_bounty'
--    and m.id = s.moment_id
--    and m.status = 'pending'
--    and m.shown_count = 0;
-- delete from activation_moment_repair_snapshot
--  where migration = '20260824120000';
-- commit;
--
-- ===========================================================================
-- POST-DEPLOY VERIFICATION
-- ===========================================================================
-- Immediately after apply -- expect 66 pending, 9 completed:
--
-- select status, count(*)
--   from user_activation_moments
--  where moment_type = 'post_first_bounty'
--  group by status;
--
-- Over the following days -- the cohort should move pending -> shown ->
-- (completed | dismissed). `completed` here means the user actually posted:
--
-- select m.status,
--        count(*)                                                as users,
--        count(*) filter (
--          where exists (select 1 from bounties b where b.poster_id = m.user_id)
--        )                                                       as now_have_a_bounty
--   from user_activation_moments m
--   join activation_moment_repair_snapshot s on s.moment_id = m.id
--  where s.migration = '20260824120000'
--  group by m.status;
--
-- If `shown` stays at 0 for more than a few days, the blocker is the client
-- gate, not this table: registry.ts requires ctx.sessionCount >= 2, and
-- sessionCount is per-device AsyncStorage (lib/moments/sessionTracking.ts),
-- so a user on a fresh install starts counting from 0 again.
