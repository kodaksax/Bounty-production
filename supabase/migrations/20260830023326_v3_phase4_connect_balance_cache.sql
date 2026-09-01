-- =====================================================================
-- Bounty Payments v3 — Phase 4: live Connect balance for v3-only hunters
--
-- ADDITIVE ONLY. profiles.balance keeps being written by every v1 path
-- exactly as today; nothing here changes v1 behaviour.
--
-- The cache is a TABLE, not an in-memory map in the edge function. The
-- isolate serving GET /wallet/balance is generally not the isolate that
-- receives the balance.available webhook, so an in-process cache could
-- never satisfy "invalidate immediately on the webhook".
-- =====================================================================

create table public.connect_balance_cache (
  user_id                  uuid primary key references public.profiles(id) on delete cascade,
  stripe_connect_account_id text   not null,
  available_cents          bigint not null,
  pending_cents            bigint not null default 0,
  currency                 text   not null default 'usd',
  fetched_at               timestamptz not null default now()
);

create index connect_balance_cache_account_idx
  on public.connect_balance_cache (stripe_connect_account_id);

alter table public.connect_balance_cache enable row level security;

create policy connect_balance_cache_service_role_all
  on public.connect_balance_cache for all to service_role
  using (true) with check (true);

-- Deliberately no `authenticated` read policy: the balance reaches the app
-- through the wallet function's service-role client, which applies the
-- v3-only routing rules. A direct client read would bypass that logic and
-- could show a stale or wrongly-sourced number.
revoke all on public.connect_balance_cache from anon, authenticated;
grant  all on public.connect_balance_cache to service_role;

comment on table public.connect_balance_cache is
  'Short-TTL cache of a connected account''s Stripe balance for v3-only hunters. Invalidated by deleting the row on a balance.available webhook. Never a source of truth — GET /wallet/balance refetches from Stripe on miss.';
