-- =====================================================================
-- Bounty Payments v3 — Phase 2: rollout flag + per-bounty funding state
--
-- ADDITIVE ONLY.
--   * public.bounties is NOT altered. v3 funding state lives in its own
--     side table, so no already-open v1 bounty can be affected.
--   * bounty_status_enum is NOT extended. Adding a value to a live enum
--     would force every existing consumer to handle a status it has never
--     seen; funding state is tracked separately instead.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rollout control. Defaults to the test cohort only: disabled globally,
--    0% rollout, empty cohort. A user is v3 only if explicitly listed, or
--    if they fall inside a deliberately raised percentage.
-- ---------------------------------------------------------------------
create table public.v3_rollout_config (
  id                 boolean primary key default true check (id),
  enabled            boolean not null default false,
  cohort_user_ids    uuid[]  not null default '{}'::uuid[],
  rollout_percent    smallint not null default 0
                       check (rollout_percent between 0 and 100),
  updated_at         timestamptz not null default now()
);

alter table public.v3_rollout_config enable row level security;

create policy v3_rollout_config_service_role_all
  on public.v3_rollout_config for all to service_role
  using (true) with check (true);

revoke all on public.v3_rollout_config from anon, authenticated;
grant  all on public.v3_rollout_config to service_role;

insert into public.v3_rollout_config (id, enabled, cohort_user_ids, rollout_percent)
values (true, false, '{}'::uuid[], 0);

-- ---------------------------------------------------------------------
-- 2. Routing decision, server-side only.
--    Deterministic per user: the same user always gets the same answer for
--    a given percentage, so a poster cannot flip between architectures
--    between two posts.
-- ---------------------------------------------------------------------
create or replace function public.fn_should_use_v3(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg public.v3_rollout_config;
begin
  if p_user_id is null then
    return false;
  end if;

  select * into cfg from public.v3_rollout_config where id;
  if not found or not cfg.enabled then
    return false;
  end if;

  if p_user_id = any (cfg.cohort_user_ids) then
    return true;
  end if;

  if cfg.rollout_percent <= 0 then
    return false;
  end if;

  -- Stable bucket in [0,99] derived from the user id.
  return (abs(hashtextextended(p_user_id::text, 0)) % 100) < cfg.rollout_percent;
end;
$$;

revoke all on function public.fn_should_use_v3(uuid) from public, anon, authenticated;
grant execute on function public.fn_should_use_v3(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. Per-bounty v3 funding state.
--
--    'authorizing' — PaymentIntent created, poster has not confirmed yet
--    'authorized'  — requires_capture reached; this is the healthy resting
--                    state for Phase 2 (capture/Transfer come in Phase 3)
--    'failed'      — the PaymentIntent failed before authorization
--    'expired'     — Stripe released the hold before the work completed.
--                    Expected for long-open bounties: only ~15% of open
--                    bounties are younger than the ~7-day auth window.
--    'canceled'    — deliberately canceled (poster cancel / rollback)
-- ---------------------------------------------------------------------
create table public.bounty_v3_funding (
  bounty_id                uuid primary key references public.bounties(id) on delete cascade,
  state                    text not null default 'authorizing'
                             check (state in ('authorizing','authorized','failed','expired','canceled')),
  stripe_payment_intent_id text,
  transfer_group           text,
  amount_cents             bigint not null,
  last_error_code          text,
  last_error_message       text,
  authorized_at            timestamptz,
  -- Nominal expiry of the card authorization; informational, Stripe is
  -- the authority via payment_intent.canceled.
  authorization_expires_at timestamptz,
  needs_reauthorization    boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index bounty_v3_funding_state_idx on public.bounty_v3_funding (state);
create unique index bounty_v3_funding_pi_idx
  on public.bounty_v3_funding (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.bounty_v3_funding enable row level security;

create policy bounty_v3_funding_service_role_all
  on public.bounty_v3_funding for all to service_role
  using (true) with check (true);

-- The poster may read their own bounty's funding state so the app can show
-- "authorization expired — re-authorize". Read-only, own rows only.
create policy bounty_v3_funding_owner_select
  on public.bounty_v3_funding for select to authenticated
  using (
    exists (
      -- bounties carries both user_id and poster_id; they are populated
      -- together and agree on every row, but 29 legacy rows have neither.
      select 1 from public.bounties b
      where b.id = bounty_v3_funding.bounty_id
        and coalesce(b.user_id, b.poster_id) = auth.uid()
    )
  );

revoke all on public.bounty_v3_funding from anon;
grant select on public.bounty_v3_funding to authenticated;
grant all    on public.bounty_v3_funding to service_role;

create trigger trg_bounty_v3_funding_updated_at
  before update on public.bounty_v3_funding
  for each row execute function public.set_updated_at();
