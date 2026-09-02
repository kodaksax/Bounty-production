-- =====================================================================
-- Bounty Payments v3 — Phase 1: shadow ledger
--
-- ADDITIVE ONLY. No existing table, RPC, or edge function is modified.
-- Nothing in application logic reads ledger_entries in this phase.
--
-- Capture is via an AFTER trigger on wallet_transactions rather than
-- edge-function call sites, because 13 SECURITY DEFINER RPCs write that
-- table and the escrow leg is written by fn_reserve_bounty_escrow() from
-- a trigger on bounties with no edge function in the path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enums
--    'dispute_loss' and 'admin_adjustment' extend the v3 design doc's
--    list so that all 7 wallet_tx_type_enum values have a valid leg.
-- ---------------------------------------------------------------------
create type public.ledger_leg_enum as enum (
  'payment','escrow_hold','capture_release','refund','platform_fee','payout',
  'dispute_loss','admin_adjustment'
);
create type public.app_state_enum    as enum ('requested','succeeded','failed');
create type public.stripe_state_enum as enum ('none','pending','confirmed','failed');

-- ---------------------------------------------------------------------
-- 2. ledger_entries
-- ---------------------------------------------------------------------
create table public.ledger_entries (
  id                        uuid primary key default gen_random_uuid(),
  bounty_id                 uuid,
  transfer_group            text,
  leg                       public.ledger_leg_enum   not null,
  app_state                 public.app_state_enum    not null,
  stripe_state              public.stripe_state_enum not null default 'none',
  amount_cents              bigint not null,
  currency                  text   not null default 'usd',
  stripe_payment_intent_id  text,
  stripe_charge_id          text,
  stripe_transfer_id        text,
  stripe_payout_id          text,
  user_id                   uuid,
  metadata                  jsonb  not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index ledger_entries_bounty_id_idx      on public.ledger_entries (bounty_id);
create index ledger_entries_transfer_group_idx on public.ledger_entries (transfer_group);
create index ledger_entries_user_leg_idx       on public.ledger_entries (user_id, leg);

-- wallet_transactions rows are UPDATEd (apply_release_tx, the payout.paid
-- webhook, fail_legacy_withdrawal), so the mirror upserts on this key
-- rather than inserting a second row per transition.
create unique index ledger_entries_source_wt_idx
  on public.ledger_entries ((metadata->>'source_wallet_transaction_id'))
  where metadata ? 'source_wallet_transaction_id';

alter table public.ledger_entries enable row level security;

create policy ledger_entries_service_role_all
  on public.ledger_entries for all to service_role
  using (true) with check (true);

revoke all on public.ledger_entries from anon, authenticated;
grant  all on public.ledger_entries to service_role;

-- ---------------------------------------------------------------------
-- 3. Kill switch
-- ---------------------------------------------------------------------
create table public.ledger_shadow_config (
  id                 boolean primary key default true check (id),
  dual_write_enabled boolean not null default false,
  updated_at         timestamptz not null default now()
);

alter table public.ledger_shadow_config enable row level security;

create policy ledger_shadow_config_service_role_all
  on public.ledger_shadow_config for all to service_role
  using (true) with check (true);

revoke all on public.ledger_shadow_config from anon, authenticated;
grant  all on public.ledger_shadow_config to service_role;

insert into public.ledger_shadow_config (id, dual_write_enabled) values (true, true);

-- Instant off:  update public.ledger_shadow_config set dual_write_enabled = false;

-- ---------------------------------------------------------------------
-- 4. Shared mapping + upsert
--    Single source of the (type,status,stripe_payout_id,payout_method)
--    -> (leg,app_state,stripe_state) mapping. Called by BOTH the trigger
--    and the historical backfill, so there is exactly one mapping.
--    Payout branch order is transcribed from withdrawal_payout_confirmation.
-- ---------------------------------------------------------------------
create or replace function public.fn_ledger_upsert_from_wallet_transaction(
  wt public.wallet_transactions
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leg    public.ledger_leg_enum;
  v_app    public.app_state_enum;
  v_stripe public.stripe_state_enum;
begin
  v_leg := (case wt.type::text
    when 'deposit'          then 'payment'
    when 'escrow'           then 'escrow_hold'
    when 'release'          then 'capture_release'
    when 'refund'           then 'refund'
    when 'withdrawal'       then 'payout'
    when 'dispute_loss'     then 'dispute_loss'
    when 'admin_adjustment' then 'admin_adjustment'
  end)::public.ledger_leg_enum;

  if wt.type::text = 'withdrawal' then
    if wt.payout_method = 'manually_paid' then
      v_app := 'succeeded'; v_stripe := 'confirmed';   -- manually_confirmed_outside_stripe
    elsif wt.stripe_payout_id is not null and wt.status::text = 'completed' then
      v_app := 'succeeded'; v_stripe := 'confirmed';   -- stripe_confirmed_paid
    elsif wt.stripe_payout_id is not null and wt.status::text = 'pending' then
      v_app := 'requested'; v_stripe := 'pending';     -- payout_in_flight
    elsif wt.status::text = 'failed' then
      v_app := 'failed';    v_stripe := 'failed';      -- payout_failed
    elsif wt.status::text = 'completed' and wt.stripe_payout_id is null then
      v_app := 'succeeded'; v_stripe := 'none';        -- unverified_legacy_completion
    else
      v_app := 'requested'; v_stripe := 'none';        -- payout_not_yet_created
    end if;
  else
    v_app := (case wt.status::text
      when 'completed'     then 'succeeded'
      when 'manually_paid' then 'succeeded'
      when 'failed'        then 'failed'
      else 'requested'
    end)::public.app_state_enum;

    v_stripe := (case
      when wt.stripe_payment_intent_id is not null
        or wt.stripe_charge_id is not null
        or wt.stripe_transfer_id is not null
        or wt.stripe_refund_id is not null
      then 'confirmed' else 'none'
    end)::public.stripe_state_enum;
  end if;

  insert into public.ledger_entries (
    bounty_id, transfer_group, leg, app_state, stripe_state,
    amount_cents, currency,
    stripe_payment_intent_id, stripe_charge_id,
    stripe_transfer_id, stripe_payout_id,
    user_id, metadata, created_at, updated_at
  ) values (
    wt.bounty_id,
    coalesce(wt.bounty_id::text, wt.reference_id),
    v_leg, v_app, v_stripe,
    round(wt.amount * 100)::bigint, 'usd',
    wt.stripe_payment_intent_id, wt.stripe_charge_id,
    wt.stripe_transfer_id, wt.stripe_payout_id,
    coalesce(wt.user_id, wt.receiver_id, wt.sender_id),
    jsonb_build_object(
      'source',                       'wallet_transactions_mirror',
      'source_wallet_transaction_id', wt.id::text,
      'source_type',                  wt.type::text,
      'source_status',                wt.status::text,
      'source_payout_method',         wt.payout_method
    ),
    wt.created_at, wt.updated_at
  )
  on conflict ((metadata->>'source_wallet_transaction_id'))
    where metadata ? 'source_wallet_transaction_id'
  do update set
    leg                      = excluded.leg,
    app_state                = excluded.app_state,
    stripe_state             = excluded.stripe_state,
    amount_cents             = excluded.amount_cents,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    stripe_charge_id         = excluded.stripe_charge_id,
    stripe_transfer_id       = excluded.stripe_transfer_id,
    stripe_payout_id         = excluded.stripe_payout_id,
    metadata                 = excluded.metadata,
    updated_at               = now();
end;
$$;

revoke all on function public.fn_ledger_upsert_from_wallet_transaction(public.wallet_transactions) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Trigger wrapper
--    The entire body is inside an exception block, so a mirror failure
--    can never abort the caller's transaction or change an HTTP response.
--    This is the specific guard against the 2026-07-19 incident in which
--    a trigger on a financial path raised and blocked every paid write.
-- ---------------------------------------------------------------------
create or replace function public.fn_mirror_wallet_transaction_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  begin
    select dual_write_enabled into v_enabled
      from public.ledger_shadow_config where id;

    if coalesce(v_enabled, false) then
      perform public.fn_ledger_upsert_from_wallet_transaction(new);
    end if;
  exception when others then
    raise warning 'ledger mirror failed for wallet_transaction %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- NOTE: the EXECUTE revoke for this function is applied separately in
-- 20260830014935_v3_phase1_revoke_mirror_trigger_execute.sql, matching the
-- order in which the two migrations were actually applied to production.

create trigger trg_wallet_transactions_ledger_mirror
  after insert or update on public.wallet_transactions
  for each row execute function public.fn_mirror_wallet_transaction_to_ledger();

-- ---------------------------------------------------------------------
-- 6. Diff check — both directions plus amount drift, last 24h
-- ---------------------------------------------------------------------
create or replace view public.ledger_shadow_diff_24h as
with wt as (
  select id, type::text as t, status::text as s, amount, created_at
  from public.wallet_transactions
  where created_at >= now() - interval '24 hours'
),
le as (
  select (metadata->>'source_wallet_transaction_id')::uuid as wt_id,
         leg::text as leg, app_state::text as app_state,
         amount_cents, created_at
  from public.ledger_entries
  where metadata ? 'source_wallet_transaction_id'
    and created_at >= now() - interval '24 hours'
)
select 'missing_in_ledger'::text as issue, wt.id as wallet_transaction_id,
       wt.t as detail_a, wt.s as detail_b,
       wt.amount, null::bigint as amount_cents, wt.created_at
from wt left join le on le.wt_id = wt.id
where le.wt_id is null
union all
select 'missing_in_wallet_transactions', le.wt_id,
       le.leg, le.app_state, null::numeric, le.amount_cents, le.created_at
from le left join wt on wt.id = le.wt_id
where wt.id is null
union all
select 'amount_mismatch', wt.id, wt.t, le.leg,
       wt.amount, le.amount_cents, wt.created_at
from wt join le on le.wt_id = wt.id
where round(wt.amount * 100)::bigint is distinct from le.amount_cents;

revoke all on public.ledger_shadow_diff_24h from anon, authenticated;
grant  select on public.ledger_shadow_diff_24h to service_role;
