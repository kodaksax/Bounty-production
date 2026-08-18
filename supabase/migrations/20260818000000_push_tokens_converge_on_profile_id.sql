-- push_tokens: make profile_id the authoritative owner column.
--
-- NOT APPLIED. Written for a human to review and apply.
--
-- Background
-- ----------
-- push_tokens carries two owner columns, user_id and profile_id, both NOT NULL
-- and both FK -> profiles(id). Every writer (supabase/functions/notifications/
-- handler.ts and lib/services/notification-service.ts) probes for profile_id
-- first, finds it, and upserts ON CONFLICT (token) writing profile_id only.
-- The existing sync trigger fills whichever column is NULL from the other, but
-- never corrects a value that is already set.
--
-- The consequence: re-registering a token on a device that a different account
-- previously used rewrites profile_id and leaves user_id pointing at the
-- earlier account. profile_id therefore tracks the current device owner, and
-- user_id silently freezes at whoever registered the token first.
--
-- Verified in production 2026-08-18: 117 token rows, 0 with either column null,
-- and 6 rows where user_id and profile_id name two different real accounts.
-- All 6 were enabled. All 6 profile_id values exist in profiles and auth.users,
-- so the backfill below is FK-safe. token is globally unique
-- (idx_push_tokens_token_unique), so rewriting user_id cannot collide with the
-- UNIQUE (user_id, token) constraint.
--
-- process-notification resolves push recipients with .in('profile_id', ...),
-- which is correct under this model and is deliberately left unchanged.
--
-- Verify before applying:
--   select count(*) filter (where user_id is distinct from profile_id) as diverged,
--          count(*) as total
--   from public.push_tokens;
--   -- expect diverged = 6 (or fewer if some have since re-registered)
--
-- Verify after applying:
--   select count(*) filter (where user_id is distinct from profile_id) as diverged
--   from public.push_tokens;
--   -- expect 0, and the CHECK constraint below makes any future divergence fail loudly

begin;

-- 1. Correct the stale mirrors. Idempotent: re-running matches no rows.
update public.push_tokens
set user_id = profile_id
where user_id is distinct from profile_id
  and profile_id is not null;

-- 2. Make profile_id authoritative so the divergence cannot recur.
--    The legacy insert direction (a writer that supplies only user_id) is
--    preserved: profile_id is seeded from user_id when absent, and user_id is
--    then forced to match. An UPDATE touching only user_id no longer silently
--    reassigns ownership — ownership moves via profile_id.
create or replace function public.sync_push_tokens_user_profile_ids()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.profile_id is null and new.user_id is not null then
    new.profile_id := new.user_id;
  end if;
  new.user_id := new.profile_id;
  return new;
end;
$function$;

-- 3. Enforce the invariant independently of the trigger. If the trigger is ever
--    dropped or altered, divergence fails loudly here instead of silently
--    misrouting notifications again.
alter table public.push_tokens
  drop constraint if exists push_tokens_owner_columns_agree;

alter table public.push_tokens
  add constraint push_tokens_owner_columns_agree
  check (user_id = profile_id);

-- 4. Point RLS at the authoritative column. Previously all four policies keyed
--    on user_id, so for the 6 diverged rows the current owner could not read or
--    delete their own token row while the previous owner still could.
drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select using (auth.uid() = profile_id);

drop policy if exists push_tokens_insert_own on public.push_tokens;
create policy push_tokens_insert_own on public.push_tokens
  for insert with check (auth.uid() = profile_id);

drop policy if exists push_tokens_update_own on public.push_tokens;
create policy push_tokens_update_own on public.push_tokens
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own on public.push_tokens
  for delete using (auth.uid() = profile_id);

-- 5. Index the column notifications are actually resolved by. The existing
--    idx_push_tokens_user_id covers the mirror; process-notification's
--    .in('profile_id', ...) had no index at all.
create index if not exists idx_push_tokens_profile_id
  on public.push_tokens using btree (profile_id);

commit;

-- Follow-up, deliberately not done here:
--   * idx_push_tokens_user_id and the UNIQUE (user_id, token) constraint are now
--     redundant with their profile_id equivalents. Drop them once this has
--     soaked and nothing queries user_id.
--   * user_id itself can be dropped once every reader is confirmed off it.
--     Dropping it requires removing the CHECK and the trigger's user_id branch
--     in the same migration.
