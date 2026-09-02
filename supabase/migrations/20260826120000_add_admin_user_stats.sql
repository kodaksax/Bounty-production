-- Admin user activity/financial aggregates.
--
-- Why this exists: the admin panel's user list and user-detail screens render
-- "Bounties Posted / Accepted / Completed" and "Total Spent / Total Earned".
-- Those five values were read straight off the `profiles` row
-- (`row.bounties_posted`, `row.total_spent`, ...) but `profiles` has never had
-- any of those columns, so each one resolved to `undefined`, was defaulted to
-- 0 by the client mapper, and every user in the console displayed a hard zero
-- for their entire activity and financial history regardless of the real data.
--
-- Rather than denormalise five counters onto `profiles` (which would need
-- triggers on bounties + wallet_transactions and could drift), this computes
-- them on demand for a bounded set of user ids -- at most one page of the
-- admin list at a time.
--
-- Access: EXECUTE is granted to service_role only. The admin-profiles Edge
-- Function calls it with the service-role key after it has already verified
-- the caller's `app_metadata.role = 'admin'`; no client-facing role can reach
-- it, so this does not widen what an ordinary authenticated user can read.

create or replace function public.admin_user_stats(p_user_ids uuid[])
returns table (
  user_id uuid,
  bounties_posted bigint,
  bounties_accepted bigint,
  bounties_completed bigint,
  total_spent numeric,
  total_earned numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ids as (
    select unnest(p_user_ids) as id
  ),
  posted as (
    select b.poster_id as id, count(*) as n
    from public.bounties b
    where b.poster_id = any(p_user_ids)
    group by b.poster_id
  ),
  accepted as (
    select b.accepted_by as id, count(*) as n
    from public.bounties b
    where b.accepted_by = any(p_user_ids)
    group by b.accepted_by
  ),
  completed as (
    -- "Completed" is counted from the hunter's side: the bounties this user
    -- actually finished. A poster's completed bounties are already covered by
    -- `posted`, and counting both under one label is what made the old
    -- placeholder numbers meaningless.
    select b.accepted_by as id, count(*) as n
    from public.bounties b
    where b.accepted_by = any(p_user_ids)
      and b.status = 'completed'
    group by b.accepted_by
  ),
  spent as (
    -- Money the user put in: escrow funded from their account.
    select t.user_id as id, sum(abs(t.amount)) as total
    from public.wallet_transactions t
    where t.user_id = any(p_user_ids)
      and t.type = 'escrow'
      and t.status = 'completed'
    group by t.user_id
  ),
  earned as (
    -- Money released to the user as the receiving party.
    select t.receiver_id as id, sum(abs(t.amount)) as total
    from public.wallet_transactions t
    where t.receiver_id = any(p_user_ids)
      and t.type = 'release'
      and t.status = 'completed'
    group by t.receiver_id
  )
  select
    ids.id,
    coalesce(posted.n, 0)::bigint,
    coalesce(accepted.n, 0)::bigint,
    coalesce(completed.n, 0)::bigint,
    coalesce(spent.total, 0)::numeric,
    coalesce(earned.total, 0)::numeric
  from ids
  left join posted    on posted.id    = ids.id
  left join accepted  on accepted.id  = ids.id
  left join completed on completed.id = ids.id
  left join spent     on spent.id     = ids.id
  left join earned    on earned.id    = ids.id;
$$;

revoke all on function public.admin_user_stats(uuid[]) from public;
revoke all on function public.admin_user_stats(uuid[]) from anon;
revoke all on function public.admin_user_stats(uuid[]) from authenticated;
grant execute on function public.admin_user_stats(uuid[]) to service_role;

comment on function public.admin_user_stats(uuid[]) is
  'Per-user bounty and wallet aggregates for the admin console. service_role only; called by the admin-profiles Edge Function after it verifies the caller is an admin.';

-- Indexes backing the aggregates above. `poster_id` is already the hot path
-- for the main bounty feed, but `accepted_by` and the wallet counterparty
-- columns were unindexed, which is what makes an on-demand aggregate viable
-- instead of denormalised counters.
create index if not exists idx_bounties_accepted_by on public.bounties (accepted_by) where accepted_by is not null;
create index if not exists idx_wallet_tx_receiver_id on public.wallet_transactions (receiver_id) where receiver_id is not null;
create index if not exists idx_wallet_tx_user_id_type on public.wallet_transactions (user_id, type);
