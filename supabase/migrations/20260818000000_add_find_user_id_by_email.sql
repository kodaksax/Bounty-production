-- Resolve an email address to an existing auth user.
--
-- The public "Post a Bounty" web intake takes payment from someone who may not
-- have an account yet, and fn_create_bounty_from_pending requires a non-null
-- poster. The webhook therefore has to decide "existing customer or new one?"
-- from an email address alone.
--
-- public.profiles.email cannot answer that: it is populated for roughly a third
-- of rows (the auth trigger creates a profile but never copies the address
-- across), so a lookup there would report "no account" for most existing users
-- and hand them a duplicate account for a bounty they just paid for.
-- auth.users.email is the authoritative record, but it is not reachable through
-- PostgREST, so expose exactly this one read through a definer function.
--
-- Returns NULL when no live user has the address.

create or replace function public.fn_find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path to 'public', 'pg_temp'
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and u.deleted_at is null
  order by u.created_at
  limit 1;
$$;

comment on function public.fn_find_user_id_by_email(text) is
  'Authoritative email -> auth.users id lookup for the bounty checkout webhook. Service role only.';

-- Service role only: this reads across the whole user table, so it must never
-- become an email-enumeration oracle for anon/authenticated callers.
revoke all on function public.fn_find_user_id_by_email(text) from public;
revoke all on function public.fn_find_user_id_by_email(text) from anon;
revoke all on function public.fn_find_user_id_by_email(text) from authenticated;
grant execute on function public.fn_find_user_id_by_email(text) to service_role;
