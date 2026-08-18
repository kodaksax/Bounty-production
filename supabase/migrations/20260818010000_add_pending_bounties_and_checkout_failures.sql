-- Add pending_bounties table, checkout_processing_failures table, and
-- fn_create_bounty_from_pending function.
--
-- These objects are referenced by the bounty-checkout Edge Function and the
-- checkout.session.completed / checkout.session.async_payment_succeeded handler
-- in the webhooks Edge Function.  They existed in production before this PR but
-- were never committed to the migration history, making it impossible to
-- reproduce the database from scratch (fresh installs and local dev failed).
--
-- Deploy order: this migration must be applied BEFORE the webhooks Edge
-- Function is deployed, since the handler calls fn_create_bounty_from_pending.
-- The existing find_user_id_by_email migration (20260818000000) must also be
-- applied first.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pending_bounties
--
-- A staging table used by bounty-checkout.  A row is inserted here when the
-- web intake form is validated and Stripe Checkout is opened.  The webhooks
-- function atomically converts it to a real bounty row (and captured
-- bounty_payments row) when the Stripe session comes back as paid.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pending_bounties (
  id                          uuid        primary key default gen_random_uuid(),
  -- Fields captured from the web form
  title                       text        not null,
  description                 text        not null,
  amount                      numeric(12, 2),
  is_for_honor                boolean     not null default false,
  location                    text,
  category                    text,
  -- The submitter's email (from the checkout form).  Used to resolve or create
  -- an account when the payment completes.
  customer_email              text,
  -- Set when the submitter was already signed in on the web; fast-paths
  -- account resolution in the webhook handler.
  supabase_user_id            uuid,
  -- Stripe Checkout session that was opened for this pending row.
  stripe_checkout_session_id  text,
  -- Lifecycle.  Transitions: pending_payment → created (success) or
  --   pending_payment → failed (terminal, requires manual intervention).
  status                      text        not null default 'pending_payment'
    check (status in ('pending_payment', 'created', 'failed')),
  -- Populated by fn_create_bounty_from_pending on success.
  resulting_bounty_id         uuid        references public.bounties(id) on delete set null,
  -- Arbitrary extra context stored by the web intake.
  metadata                    jsonb       not null default '{}',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.pending_bounties is
  'Staging rows created by the bounty-checkout function before payment. Converted to real bounties by fn_create_bounty_from_pending on Stripe payment success.';

-- RLS: this table is written by the service role only (bounty-checkout uses
-- the service-role client).  No app-level reads are required; expose nothing.
alter table public.pending_bounties enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. checkout_processing_failures
--
-- Operational log for paid Stripe sessions that could not be converted into
-- a bounty due to a terminal error (missing data, account creation failure,
-- etc.).  The customer has been charged, so these rows require human review.
--
-- Transient failures (network issues, RPC errors) are NOT recorded here —
-- they throw instead so Stripe retries the webhook delivery.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.checkout_processing_failures (
  id                          uuid        primary key default gen_random_uuid(),
  stripe_event_id             text        not null,
  stripe_checkout_session_id  text        not null,
  stripe_payment_intent_id    text,
  pending_bounty_id           uuid,
  customer_email              text,
  -- Amount in USD (converted from cents).  Null when the session carried a
  -- non-USD currency and we could not safely normalise it.
  amount                      numeric(12, 2),
  -- Short machine-readable label (e.g. 'missing_pending_bounty_id',
  -- 'account_creation_failed: …').
  reason                      text        not null,
  -- Raw Stripe session metadata for debugging.
  session_metadata            jsonb       not null default '{}',
  -- Set to true by ops tooling once the failure has been triaged and resolved.
  resolved                    boolean     not null default false,
  resolved_at                 timestamptz,
  resolved_by                 uuid        references auth.users(id) on delete set null,
  resolution_notes            text,
  created_at                  timestamptz not null default now()
);

comment on table public.checkout_processing_failures is
  'Terminal failures for paid Stripe checkout sessions that could not be converted to a bounty. Each row represents a charged customer who requires manual intervention.';

create index if not exists checkout_processing_failures_session_id_idx
  on public.checkout_processing_failures (stripe_checkout_session_id);
create index if not exists checkout_processing_failures_unresolved_idx
  on public.checkout_processing_failures (resolved) where (not resolved);

-- Service role only.
alter table public.checkout_processing_failures enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_create_bounty_from_pending
--
-- Atomic, replay-safe conversion of a pending_bounties row into a real bounty
-- plus a captured bounty_payments escrow row.  Called by the webhook handler
-- after verifying payment_status = 'paid'.
--
-- Returns a single row: { bounty_id, bounty_payment_id, created }.
--   created = true  → first call; bounty and payment rows were inserted.
--   created = false → replay; the rows already exist (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_create_bounty_from_pending(
  p_pending_id        uuid,
  p_poster_id         uuid,
  p_session_id        text,
  p_payment_intent_id text     default null,
  p_charge_id         text     default null,
  p_customer_id       text     default null,
  p_amount_paid       numeric  default null,
  p_currency          text     default 'usd',
  p_metadata          jsonb    default '{}'
)
returns table (
  bounty_id         uuid,
  bounty_payment_id uuid,
  created           boolean
)
language plpgsql
security definer
volatile
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pending         public.pending_bounties%rowtype;
  v_bounty_id       uuid;
  v_payment_id      uuid;
  v_amount          numeric(12, 2);
  v_transfer_group  text;
begin
  -- Lock the pending row for this session to prevent concurrent processing.
  select *
    into v_pending
    from public.pending_bounties
   where id = p_pending_id
   for update;

  if not found then
    raise exception 'pending_bounty % not found', p_pending_id;
  end if;

  -- Replay detection: if already created, return the existing ids.
  if v_pending.status = 'created' and v_pending.resulting_bounty_id is not null then
    select bp.id
      into v_payment_id
      from public.bounty_payments bp
     where bp.bounty_id = v_pending.resulting_bounty_id
     limit 1;

    return query select v_pending.resulting_bounty_id, v_payment_id, false;
    return;
  end if;

  -- Resolve the amount: prefer the USD amount actually settled by Stripe;
  -- fall back to the amount validated onto the pending row.
  v_amount := coalesce(p_amount_paid, v_pending.amount);
  if v_amount is null or v_amount <= 0 then
    raise exception 'cannot create bounty: no valid amount on pending row % or payment', p_pending_id;
  end if;

  -- Stripe transfer groups must match the PI used for escrow; derive it from
  -- the pending row id so it is stable across replays.
  v_transfer_group := 'bounty_' || p_pending_id::text;

  -- Insert the bounty.
  insert into public.bounties (
    user_id,
    poster_id,
    title,
    description,
    amount,
    is_for_honor,
    location,
    category,
    status,
    payment_architecture_version,
    created_at,
    updated_at
  )
  values (
    p_poster_id,
    p_poster_id,
    v_pending.title,
    v_pending.description,
    v_amount,
    v_pending.is_for_honor,
    v_pending.location,
    v_pending.category,
    'open',
    2,
    now(),
    now()
  )
  returning id into v_bounty_id;

  -- Insert the bounty_payments escrow row (already captured — Checkout
  -- does not use manual capture).
  insert into public.bounty_payments (
    bounty_id,
    poster_id,
    stripe_payment_intent_id,
    stripe_charge_id,
    transfer_group,
    amount,
    currency,
    capture_method,
    status,
    stripe_customer_id,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_bounty_id,
    p_poster_id,
    p_payment_intent_id,
    p_charge_id,
    v_transfer_group,
    v_amount,
    p_currency,
    'automatic',
    'captured',
    p_customer_id,
    p_metadata || jsonb_build_object(
      'source', 'checkout',
      'stripe_checkout_session_id', p_session_id,
      'pending_bounty_id', p_pending_id
    ),
    now(),
    now()
  )
  returning id into v_payment_id;

  -- Flip the pending row to 'created'.
  update public.pending_bounties
     set status              = 'created',
         resulting_bounty_id = v_bounty_id,
         updated_at          = now()
   where id = p_pending_id;

  return query select v_bounty_id, v_payment_id, true;
end;
$$;

comment on function public.fn_create_bounty_from_pending(uuid, uuid, text, text, text, text, numeric, text, jsonb) is
  'Atomically converts a pending_bounties row into a live bounty + captured bounty_payments escrow row. Idempotent: replays return created=false with the existing ids.';

-- Service role only — this function writes across several tables with elevated
-- privilege and must never be callable by anonymous or authenticated callers.
revoke all on function public.fn_create_bounty_from_pending(uuid, uuid, text, text, text, text, numeric, text, jsonb) from public;
revoke all on function public.fn_create_bounty_from_pending(uuid, uuid, text, text, text, text, numeric, text, jsonb) from anon;
revoke all on function public.fn_create_bounty_from_pending(uuid, uuid, text, text, text, text, numeric, text, jsonb) from authenticated;
grant execute on function public.fn_create_bounty_from_pending(uuid, uuid, text, text, text, text, numeric, text, jsonb) to service_role;
