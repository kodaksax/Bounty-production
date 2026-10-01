-- ============================================================================
-- $1 posting service fee — checkout records
--
-- Backs the 'posting-service-fee' PostHog experiment (see
-- lib/experiments/posting-fee-variant.ts). In the treatment arm the poster
-- passes through a checkout step BEFORE the bounty row is created, paying the
-- flat service fee AND the full bounty reward in one Stripe charge.
--
-- WHY A NEW TABLE RATHER THAN bounty_payments
-- -------------------------------------------
-- Two independent reasons, either of which is sufficient:
--
--   1. bounty_payments.bounty_id is NOT NULL with an FK to bounties. This
--      charge is collected before any bounty row exists — that is the whole
--      point of a blocking pre-publish checkout — so it structurally cannot
--      live there.
--   2. bounty_payments IS the escrow record. The service fee is platform
--      revenue and the reward is the poster's money in custody; a schema that
--      cannot tell them apart cannot produce an honest receipt, a correct
--      refund, or a correct revenue figure.
--
-- HOW THE MONEY SPLITS
-- --------------------
-- One PaymentIntent is charged for (fee + reward). On settlement the edge
-- function splits it:
--
--   reward_amount_cents -> public.apply_deposit(), i.e. credited to the
--                          poster's custodial wallet. The bounty INSERT that
--                          follows then triggers fn_reserve_bounty_escrow,
--                          which moves it from wallet into escrow exactly as
--                          a pre-funded post has always worked. No new escrow
--                          path is introduced.
--   fee_amount_cents    -> platform revenue. Recorded HERE and nowhere else.
--                          Deliberately never passed to apply_deposit: a fee
--                          credited to the wallet would be refundable to the
--                          poster as balance and would inflate custodial
--                          liability by $1 per post.
--
-- IDEMPOTENCY
-- -----------
-- posting_attempt_id is a client-generated uuid that is stable for one
-- composer session, including across retries, remounts and app restarts. It is
-- UNIQUE here and is also used as the Stripe idempotency key, so:
--
--   * a retried intent request returns the SAME PaymentIntent (Stripe dedupes)
--   * a retried settle is a no-op (apply_deposit dedupes on the intent id, and
--     the status transition below is non-regressing)
--   * a publish that fails after a settled checkout can be retried without a
--     second charge, because the paid-but-unconsumed row is found and reused
--
-- Deploy order: apply this BEFORE deploying the payments and webhooks edge
-- functions, which both reference this table.
-- ============================================================================

-- Explicit transaction: the column, the two triggers and the table are
-- interdependent. A partial apply would leave fn_bounties_normalize_funding_mode
-- referencing a column that does not exist, which would fail EVERY bounty
-- insert — for both arms.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bounty_posting_checkouts
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.bounty_posting_checkouts (
  id                        uuid        primary key default gen_random_uuid(),

  -- Deliberately NOT an FK to profiles/auth.users, matching bounty_payments.
  -- An account deletion cascading through a money record is how 30 bounties
  -- lost their owner irrecoverably (see the bounty owner-loss incident); a
  -- financial row must outlive the account it belonged to.
  poster_id                 uuid        not null,

  -- Client-generated, stable for one posting attempt. The idempotency anchor
  -- for the whole flow — see the header.
  posting_attempt_id        uuid        not null,

  stripe_payment_intent_id  text,

  -- Split at creation time by the server from its own constants; the client
  -- never gets to name either number.
  fee_amount_cents          integer     not null check (fee_amount_cents > 0),
  reward_amount_cents       integer     not null check (reward_amount_cents >= 0),
  -- Generated so the two halves can never drift from what was charged.
  total_amount_cents        integer     not null
    generated always as (fee_amount_cents + reward_amount_cents) stored,

  currency                  text        not null default 'usd'
    check (currency in ('usd', 'eur', 'gbp')),

  -- Lifecycle:
  --   pending  -> paid      (Stripe confirmed, money split and credited)
  --   pending  -> failed    (Stripe declined / errored)
  --   pending  -> canceled  (poster dismissed the sheet, or abandoned)
  --   paid     -> consumed  (a bounty was published against this checkout)
  --   paid     -> refunded  (operational reversal)
  status                    text        not null default 'pending'
    check (status in ('pending', 'paid', 'consumed', 'failed', 'canceled', 'refunded')),

  -- Set when the checkout is consumed by a real publish.
  bounty_id                 uuid        references public.bounties(id) on delete set null,

  -- Which experiment arm produced this row. Always 'fee' today; recorded so a
  -- later arm rename or a second treatment does not make historical rows
  -- ambiguous.
  variant                   text        not null default 'fee',

  -- Short machine-readable label on failure (e.g. 'card_declined'). Never a
  -- raw Stripe message: those can carry amounts and customer identifiers.
  failure_code              text,

  metadata                  jsonb       not null default '{}'::jsonb,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  paid_at                   timestamptz,
  consumed_at               timestamptz,

  -- A consumed checkout must name the bounty it paid for, and must have been
  -- paid first. Without this, a bug that marked rows consumed without a
  -- publish would silently destroy the poster's paid credit.
  constraint bounty_posting_checkouts_consumed_has_bounty
    check (status <> 'consumed' or (bounty_id is not null and paid_at is not null)),

  -- A paid checkout must name the charge that paid it.
  constraint bounty_posting_checkouts_paid_has_intent
    check (status not in ('paid', 'consumed', 'refunded') or stripe_payment_intent_id is not null)
);

comment on table public.bounty_posting_checkouts is
  'Pre-publish checkout records for the $1 posting service fee experiment. One row per posting attempt. fee_amount_cents is platform revenue; reward_amount_cents is credited to the poster wallet and then escrowed by the ordinary at_post path. Never merge with bounty_payments, which is the escrow record.';

comment on column public.bounty_posting_checkouts.posting_attempt_id is
  'Client-generated uuid, stable across retries/remounts for one posting attempt. Also used as the Stripe idempotency key, which is what makes a duplicate charge impossible.';

comment on column public.bounty_posting_checkouts.fee_amount_cents is
  'The posting service fee — platform revenue. Distinct from the 5% PLATFORM_FEE_PERCENT deducted from a hunter payout on release; the two are unrelated.';

-- One checkout row per posting attempt. This single constraint is what stops a
-- double-tap, a remount, or a retried request from opening a second charge.
create unique index if not exists uq_posting_checkouts_attempt
  on public.bounty_posting_checkouts (posting_attempt_id);

-- One checkout row per PaymentIntent. Partial, because a pending row has no
-- intent yet and several such rows must be able to coexist.
create unique index if not exists uq_posting_checkouts_intent
  on public.bounty_posting_checkouts (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Drives the "do I already have a paid checkout to reuse?" lookup on resume.
create index if not exists idx_posting_checkouts_poster_reusable
  on public.bounty_posting_checkouts (poster_id, created_at desc)
  where status = 'paid';

create index if not exists idx_posting_checkouts_bounty
  on public.bounty_posting_checkouts (bounty_id)
  where bounty_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. updated_at maintenance (mirrors set_bounty_payments_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_posting_checkouts_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_posting_checkouts_updated_at on public.bounty_posting_checkouts;
create trigger trg_posting_checkouts_updated_at
  before update on public.bounty_posting_checkouts
  for each row
  execute function public.set_posting_checkouts_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
--
-- The poster may READ their own checkouts — the composer needs this to resume
-- an interrupted attempt and to show "already paid" instead of charging again.
-- Nobody but the service role may write: every status transition here either
-- moves money or decides whether money is owed, and all of them happen inside
-- the payments/webhooks edge functions after a Stripe verification.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.bounty_posting_checkouts enable row level security;

drop policy if exists posting_checkouts_select_own on public.bounty_posting_checkouts;
create policy posting_checkouts_select_own on public.bounty_posting_checkouts
  for select
  using (auth.uid() = poster_id);

-- Admin read, using the JWT app_metadata role. profiles.role is dead (always
-- NULL in production) and must not be used for an admin check here.
drop policy if exists posting_checkouts_select_admin on public.bounty_posting_checkouts;
create policy posting_checkouts_select_admin on public.bounty_posting_checkouts
  for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fn_consume_posting_checkout
--
-- Binds a paid checkout to the bounty it paid for. Idempotent and
-- non-regressing: re-running it for the same (attempt, bounty) returns true
-- without touching the row, and it refuses to rebind a checkout to a DIFFERENT
-- bounty — which would mean one $1 fee had silently paid for two posts.
--
-- Returns false rather than raising when there is nothing to consume, because
-- the caller's correct response is "publish succeeded anyway, log it" rather
-- than "roll back a live bounty".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_consume_posting_checkout(
  p_posting_attempt_id uuid,
  p_bounty_id          uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.bounty_posting_checkouts;
begin
  if p_posting_attempt_id is null or p_bounty_id is null then
    return false;
  end if;

  -- Lock the row so two concurrent publishes cannot both consume it.
  select * into v_row
  from public.bounty_posting_checkouts
  where posting_attempt_id = p_posting_attempt_id
  for update;

  if not found then
    return false;
  end if;

  -- Already consumed by THIS bounty — idempotent success.
  if v_row.status = 'consumed' and v_row.bounty_id = p_bounty_id then
    return true;
  end if;

  -- Already consumed by a DIFFERENT bounty. Refuse loudly: silently rebinding
  -- would let one fee cover two posts and would corrupt the revenue record.
  if v_row.status = 'consumed' then
    raise exception
      'fn_consume_posting_checkout: attempt % already consumed by bounty %',
      p_posting_attempt_id, v_row.bounty_id
      using errcode = '23505';
  end if;

  if v_row.status <> 'paid' then
    return false;
  end if;

  update public.bounty_posting_checkouts
  set status      = 'consumed',
      bounty_id   = p_bounty_id,
      consumed_at = now(),
      -- Belt and braces for the consumed_has_bounty CHECK, which also requires
      -- paid_at. A 'paid' row always has one, but if it somehow did not, the
      -- CHECK would abort this UPDATE and therefore the whole bounty insert —
      -- turning a bookkeeping gap into a poster who cannot post.
      paid_at     = coalesce(v_row.paid_at, now())
  where id = v_row.id;

  return true;
end;
$$;

comment on function public.fn_consume_posting_checkout(uuid, uuid) is
  'Bind a paid posting checkout to the bounty it paid for. Idempotent for the same bounty; raises if the checkout was already consumed by a different bounty.';

-- service_role only. REVOKE ALL FROM PUBLIC does NOT remove the EXECUTE that
-- anon is auto-granted on a newly created function, so anon must be revoked by
-- name — this has bitten this schema before.
revoke all on function public.fn_consume_posting_checkout(uuid, uuid) from public;
revoke all on function public.fn_consume_posting_checkout(uuid, uuid) from anon;
revoke all on function public.fn_consume_posting_checkout(uuid, uuid) from authenticated;
grant execute on function public.fn_consume_posting_checkout(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Teaching the funding-mode trigger about a prepaid bounty
--
-- THE CONFLICT THIS RESOLVES
-- --------------------------
-- Since 20260827000000, fn_bounties_normalize_funding_mode decides funding_mode
-- UNILATERALLY and ignores the client's request outright — deliberately, because
-- the client never asking is exactly why pay-at-accept sat inert. Every v1
-- wallet-funded bounty with amount > 0 is stamped 'at_accept'.
--
-- That is correct for the control arm and wrong for a prepaid one. Without the
-- branch below, a treatment bounty whose reward was ALREADY collected at
-- checkout would be stamped 'at_accept', fn_reserve_bounty_escrow would skip
-- its debit, and the reward would sit in the poster's wallet as ordinary
-- spendable balance. Three concrete consequences, not hypotheticals:
--
--   1. The poster could withdraw the reward before hiring, after which
--      acceptance fails for insufficient funds — we would have returned their
--      reward and kept the fee.
--   2. The checkout screen tells them "the reward sits in escrow while hunters
--      apply. Nobody can touch it." That would simply be untrue.
--   3. escrow_funded would report timing 'at_accept' for a bounty funded at
--      post, so the experiment's central metric would be wrong.
--
-- HOW THIS STAYS FORGE-PROOF
-- --------------------------
-- The client does not get to assert "I prepaid". It may only POINT AT evidence
-- — an attempt id — and the trigger verifies that evidence against
-- bounty_posting_checkouts, which is service-role-write-only and only reaches
-- status 'paid' after the payments edge function has confirmed the charge with
-- Stripe. A forged or stale attempt id simply finds no matching row and falls
-- through to the ordinary default, so the worst outcome of a lie is today's
-- behaviour.
--
-- The reward amount must match too. Otherwise a $5 checkout could mark a $500
-- bounty as prepaid, and the receipt, the escrow record and the poster's
-- understanding would all disagree with each other.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.bounties
  add column if not exists posting_checkout_attempt_id uuid;

comment on column public.bounties.posting_checkout_attempt_id is
  'The bounty_posting_checkouts.posting_attempt_id this bounty was prepaid under ($1 posting-fee experiment). A CLAIM, not proof: trg_bounties_normalize_funding_mode verifies it against a paid checkout row of matching amount before honouring it, so a forged value yields ordinary pay-at-accept behaviour.';

-- Supports the trigger's verification lookup and the reverse (checkout -> bounty)
-- lookup used by reconciliation.
create index if not exists idx_bounties_posting_checkout_attempt
  on public.bounties (posting_checkout_attempt_id)
  where posting_checkout_attempt_id is not null;

create or replace function public.fn_bounties_normalize_funding_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_poster_id uuid;
  v_prepaid   boolean;
BEGIN
  -- Unchanged from 20260827000000: nothing to defer for these.
  --   * is_for_honor / amount <= 0 — no money to move
  --   * payment_architecture_version <> 1 — v2 funds through Stripe-native
  --     bounty_payments, not the custodial wallet
  IF NEW.is_for_honor IS TRUE
     OR COALESCE(NEW.payment_architecture_version, 1) <> 1
     OR NEW.amount IS NULL
     OR NEW.amount <= 0
  THEN
    NEW.funding_mode := 'at_post';
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  -- NEW: a bounty whose reward was already collected at checkout funds at post.
  -- Verified against the checkout table rather than trusted from the insert —
  -- see the header above.
  IF NEW.posting_checkout_attempt_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bounty_posting_checkouts c
      WHERE c.posting_attempt_id  = NEW.posting_checkout_attempt_id
        AND c.poster_id           = v_poster_id
        AND c.status              = 'paid'
        AND c.reward_amount_cents = round(NEW.amount * 100)::integer
    ) INTO v_prepaid;

    IF v_prepaid THEN
      NEW.funding_mode := 'at_post';
      RETURN NEW;
    END IF;

    -- Claimed but unverifiable. Drop the claim so nothing downstream (receipts,
    -- reconciliation, the consume trigger below) treats this bounty as prepaid,
    -- then fall through to the ordinary decision.
    NEW.posting_checkout_attempt_id := NULL;
  END IF;

  IF public.fn_can_defer_bounty_funding(v_poster_id, NEW.amount) THEN
    NEW.funding_mode := 'at_accept';
  ELSE
    NEW.funding_mode := 'at_post';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged; recreated only so a fresh database gets it
-- regardless of whether this migration or 20260827000000 ran last.
drop trigger if exists trg_bounties_normalize_funding_mode on public.bounties;
create trigger trg_bounties_normalize_funding_mode
  before insert on public.bounties
  for each row execute function public.fn_bounties_normalize_funding_mode();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Consume the checkout as part of the insert
--
-- Done in an AFTER INSERT trigger rather than a client RPC call so it cannot be
-- skipped, cannot race, and cannot half-happen: if escrow reservation fails the
-- whole transaction aborts and the checkout stays 'paid' and reusable, which is
-- exactly what a retry needs.
--
-- By this point normalize (BEFORE INSERT) has already NULLed any unverifiable
-- claim, so a non-null attempt id here is known-good.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_bounties_consume_posting_checkout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
BEGIN
  IF NEW.posting_checkout_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Raises if this checkout was already consumed by a DIFFERENT bounty, which
  -- would mean one fee had paid for two posts. Aborting the insert is the right
  -- outcome: better no second bounty than a silently unpaid one.
  PERFORM public.fn_consume_posting_checkout(NEW.posting_checkout_attempt_id, NEW.id);

  RETURN NEW;
END;
$$;

drop trigger if exists trg_bounties_consume_posting_checkout on public.bounties;
create trigger trg_bounties_consume_posting_checkout
  after insert on public.bounties
  for each row execute function public.fn_bounties_consume_posting_checkout();

revoke all on function public.fn_bounties_consume_posting_checkout() from public;
revoke all on function public.fn_bounties_consume_posting_checkout() from anon;

notify pgrst, 'reload schema';

COMMIT;

-- ===========================================================================
-- DOWN (reversal)
--
-- The kill switch is the PostHog flag: setting 'posting-service-fee' to 0%
-- rollout stops any NEW poster entering the checkout, without a deploy. Do
-- that first — everything below is only for removing the mechanism itself.
--
--   BEGIN;
--     -- 1. Restore the pre-experiment funding-mode decision. Copy the body
--     --    from 20260827000000_pay_at_accept_default_for_all_bounties.sql.
--     --    Do this BEFORE dropping the column, or every insert fails.
--     DROP TRIGGER IF EXISTS trg_bounties_consume_posting_checkout ON public.bounties;
--     DROP FUNCTION IF EXISTS public.fn_bounties_consume_posting_checkout();
--     -- (recreate fn_bounties_normalize_funding_mode from 20260827000000 here)
--     ALTER TABLE public.bounties DROP COLUMN IF EXISTS posting_checkout_attempt_id;
--   COMMIT;
--
-- Do NOT drop bounty_posting_checkouts. It is the only record of money
-- collected from posters — it is needed for refunds, chargebacks, revenue
-- reconciliation and support long after the experiment ends. Any bounty with a
-- non-null posting_checkout_attempt_id was funded at post and is already
-- escrowed; dropping the column loses the link from that escrow to the charge
-- that paid for it, so take an export first if the column must go.
-- ===========================================================================
