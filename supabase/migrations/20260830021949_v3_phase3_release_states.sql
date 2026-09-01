-- =====================================================================
-- Bounty Payments v3 — Phase 3: capture + Transfer on completion approval
--
-- ADDITIVE ONLY. Extends the Phase 2 side table with the release half of
-- the lifecycle. No existing table, RPC, or edge function is altered.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Widen the v3 funding state machine.
--
--   authorizing               PaymentIntent created, poster not confirmed
--   authorized                requires_capture reached (Phase 2 resting state)
--   awaiting_hunter_onboarding  approved, but the hunter's Connect account
--                             cannot receive payouts yet. Nothing captured.
--   capturing                 capture + Transfer requested, Stripe accepted,
--                             transfer.created not yet seen
--   released                  transfer.created arrived with reversed = false
--   capture_failed            capture or Transfer rejected by Stripe
--   failed / expired / canceled   pre-capture terminal states (Phase 2)
-- ---------------------------------------------------------------------
alter table public.bounty_v3_funding
  drop constraint if exists bounty_v3_funding_state_check;

alter table public.bounty_v3_funding
  add constraint bounty_v3_funding_state_check
  check (state in (
    'authorizing',
    'authorized',
    'awaiting_hunter_onboarding',
    'capturing',
    'released',
    'capture_failed',
    'failed',
    'expired',
    'canceled'
  ));

alter table public.bounty_v3_funding
  add column if not exists stripe_charge_id   text,
  add column if not exists stripe_transfer_id text,
  add column if not exists hunter_id          uuid,
  add column if not exists platform_fee_cents bigint,
  add column if not exists hunter_amount_cents bigint,
  add column if not exists captured_at        timestamptz,
  add column if not exists released_at        timestamptz;

create unique index if not exists bounty_v3_funding_transfer_idx
  on public.bounty_v3_funding (stripe_transfer_id)
  where stripe_transfer_id is not null;

create index if not exists bounty_v3_funding_hunter_idx
  on public.bounty_v3_funding (hunter_id)
  where state = 'awaiting_hunter_onboarding';

-- ---------------------------------------------------------------------
-- Operational view: v3 releases whose Transfer is not yet Stripe-confirmed.
--
-- Mirrors the rule withdrawal_payout_confirmation enforces for v1: an API
-- call that returned 200 is NOT proof. Only a transfer.created webhook with
-- reversed = false promotes stripe_state to 'confirmed'.
-- ---------------------------------------------------------------------
create or replace view public.v3_release_confirmation as
select
  f.bounty_id,
  f.state                        as funding_state,
  f.hunter_id,
  f.amount_cents,
  f.platform_fee_cents,
  f.hunter_amount_cents,
  f.stripe_payment_intent_id,
  f.stripe_charge_id,
  f.stripe_transfer_id,
  f.captured_at,
  f.released_at,
  l.app_state::text              as ledger_app_state,
  l.stripe_state::text           as ledger_stripe_state,
  (l.stripe_state::text = 'confirmed') as stripe_confirmed_released,
  greatest(extract(epoch from now() - f.captured_at) / 3600.0, 0)::numeric(10,1)
                                 as hours_since_capture
from public.bounty_v3_funding f
left join public.ledger_entries l
  on l.bounty_id = f.bounty_id
 and l.leg = 'capture_release'
where f.state in ('capturing','released','capture_failed');

revoke all on public.v3_release_confirmation from anon, authenticated;
grant  select on public.v3_release_confirmation to service_role;
