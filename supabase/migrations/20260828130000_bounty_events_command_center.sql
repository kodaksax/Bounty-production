-- Migration: canonical bounty event ledger + founder Command Center reads
-- Created: 2026-08-28
--
-- WHY THIS EXISTS
-- ---------------
-- The console could answer "what does this row look like now" but not "what
-- happened, in what order, and did the money actually move". Marketplace state
-- lives on `bounties`, application state on `bounty_requests`, money on
-- `wallet_transactions` / `bounty_payments`, and Stripe's own view on
-- `stripe_events` -- with no shared spine and no timestamps for most
-- transitions (`bounties` records `created_at`, `updated_at`, `completed_at`
-- and nothing else, so "accepted at" was unrecoverable).
--
-- This adds ONE append-only ledger, `public.bounty_events`, that every other
-- table feeds. It is deliberately observability-only:
--
--   * It never participates in a money decision. Nothing reads it to decide
--     whether to pay, release or refund.
--   * Every trigger that writes to it is exception-swallowing. An event-ledger
--     failure can never block a marketplace or financial write. (A previous
--     untracked production trigger on `profiles` blocked ALL paid bounty,
--     withdrawal and dispute writes for a period -- that class of incident is
--     structurally impossible here.)
--   * It records provenance. A row written because a signed Stripe webhook
--     confirmed something is `source='webhook'`; a row reconstructed from
--     existing state is `source='inferred'`. The console renders those
--     differently and never reports an inferred value as Stripe-confirmed.
--
-- SECURITY
-- --------
-- `record_bounty_event` is SECURITY DEFINER with EXECUTE revoked from anon and
-- authenticated, so an end user cannot forge ledger entries (the same mistake
-- previously found on `dispute_audit_log`). Triggers reach it because they are
-- themselves SECURITY DEFINER and therefore run as the owner. Reads are
-- admin-only, gated on `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'` --
-- the pattern proven live in this database. `profiles.role = 'admin'` is NOT
-- used: that column is NULL for every row in production.

-- ============================================================================
-- 1. THE LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bounty_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency. Every producer derives this deterministically from the thing
  -- that happened (e.g. 'application.submitted:<request_id>',
  -- 'stripe:<stripe_event_id>'), so replaying a webhook, re-running the
  -- backfill, or firing a trigger twice inserts exactly one row.
  event_key      text NOT NULL UNIQUE,

  -- Deliberately NOT a foreign key. A financial event whose bounty no longer
  -- exists is one of the anomalies this ledger has to be able to report; an FK
  -- would either delete the evidence or block the delete.
  bounty_id      uuid,
  actor_id       uuid,

  event_type     text NOT NULL,

  -- Provenance, and the whole point of the table:
  --   app      -- an application row was written by a user action
  --   system   -- a backend job (expiry sweeper, reconciliation) acted
  --   stripe   -- observed by polling the Stripe API
  --   webhook  -- confirmed by a signature-verified Stripe webhook
  --   inferred -- reconstructed from surrounding state; NOT a confirmation
  source         text NOT NULL CHECK (source IN ('app', 'system', 'stripe', 'webhook', 'inferred')),

  -- Ties an app action to the Stripe objects it produced. Usually a payment
  -- intent / transfer group / payout id.
  correlation_id text,

  occurred_at    timestamptz NOT NULL DEFAULT now(),
  amount         numeric(12, 2),
  currency       text NOT NULL DEFAULT 'usd',
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bounty_events IS
  'Append-only, idempotent marketplace + financial event ledger. Observability only: no money decision reads this table.';
COMMENT ON COLUMN public.bounty_events.event_key IS
  'Deterministic idempotency key. Producers must derive it from the event, never from now()/random().';
COMMENT ON COLUMN public.bounty_events.source IS
  'Provenance. Only source=''webhook'' means Stripe confirmed it; source=''inferred'' must never be presented as confirmation.';

CREATE INDEX IF NOT EXISTS bounty_events_occurred_at_idx
  ON public.bounty_events (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bounty_events_bounty_idx
  ON public.bounty_events (bounty_id, occurred_at DESC) WHERE bounty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bounty_events_type_idx
  ON public.bounty_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS bounty_events_actor_idx
  ON public.bounty_events (actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bounty_events_correlation_idx
  ON public.bounty_events (correlation_id) WHERE correlation_id IS NOT NULL;

ALTER TABLE public.bounty_events ENABLE ROW LEVEL SECURITY;

-- Admins read. Nobody else -- and there is no INSERT/UPDATE/DELETE policy at
-- all, so the only writer is service_role (which bypasses RLS) and the
-- SECURITY DEFINER producers below. The ledger is append-only by construction.
DROP POLICY IF EXISTS bounty_events_select_admin ON public.bounty_events;
CREATE POLICY bounty_events_select_admin ON public.bounty_events
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

REVOKE ALL ON public.bounty_events FROM PUBLIC;
REVOKE ALL ON public.bounty_events FROM anon;
GRANT SELECT ON public.bounty_events TO authenticated;

-- ============================================================================
-- 2. THE ONLY WRITER
-- ============================================================================
-- Idempotent by construction: a repeated event_key is a no-op, not a duplicate
-- row and not an error. Callers can fire it as often as they like.

CREATE OR REPLACE FUNCTION public.record_bounty_event(
  p_event_key      text,
  p_event_type     text,
  p_source         text,
  p_bounty_id      uuid    DEFAULT NULL,
  p_actor_id       uuid    DEFAULT NULL,
  p_occurred_at    timestamptz DEFAULT NULL,
  p_amount         numeric DEFAULT NULL,
  p_correlation_id text    DEFAULT NULL,
  p_metadata       jsonb   DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_event_key IS NULL OR p_event_type IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.bounty_events (
    event_key, event_type, source, bounty_id, actor_id,
    occurred_at, amount, correlation_id, metadata
  )
  VALUES (
    p_event_key, p_event_type, p_source, p_bounty_id, p_actor_id,
    COALESCE(p_occurred_at, now()), p_amount, p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_id;

  -- Already recorded. Return the existing id so callers can still correlate.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.bounty_events WHERE event_key = p_event_key;
  END IF;

  RETURN v_id;
END;
$$;

-- Unforgeable by end users: only the SECURITY DEFINER triggers below and
-- service_role (the webhook function) may write events.
REVOKE ALL ON FUNCTION public.record_bounty_event(text, text, text, uuid, uuid, timestamptz, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_bounty_event(text, text, text, uuid, uuid, timestamptz, numeric, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_bounty_event(text, text, text, uuid, uuid, timestamptz, numeric, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_bounty_event(text, text, text, uuid, uuid, timestamptz, numeric, text, jsonb) TO service_role;

-- ============================================================================
-- 3. PRODUCERS -- triggers on the tables that already exist
-- ============================================================================
-- Every one of these swallows its own errors. The ledger is observability; it
-- must never be able to fail a marketplace or money write. They are all AFTER
-- triggers, so the return value is ignored and RETURN NULL is safe.

-- ---- bounties ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_bounties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stamp text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'bounty.posted:' || NEW.id,
      'bounty.posted',
      'app',
      NEW.id,
      COALESCE(NEW.poster_id, NEW.user_id),
      NEW.created_at,
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object(
        'title', NEW.title,
        'category', NEW.category,
        'is_for_honor', COALESCE(NEW.is_for_honor, false),
        'funding_mode', NEW.funding_mode,
        'payment_architecture_version', NEW.payment_architecture_version
      )
    );
    RETURN NULL;
  END IF;

  -- A transition is keyed on the row's own updated_at, so the same UPDATE
  -- replayed produces the same key while a genuine later transition to the
  -- same status (open -> in_progress -> open -> in_progress) does not collide.
  v_stamp := to_char(COALESCE(NEW.updated_at, now()) AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US');

  IF NEW.accepted_by IS DISTINCT FROM OLD.accepted_by AND NEW.accepted_by IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'bounty.accepted:' || NEW.id || ':' || NEW.accepted_by,
      'bounty.accepted',
      'app',
      NEW.id,
      NEW.accepted_by,
      COALESCE(NEW.updated_at, now()),
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object('poster_id', COALESCE(NEW.poster_id, NEW.user_id), 'hunter_id', NEW.accepted_by)
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.record_bounty_event(
      'bounty.status:' || NEW.id || ':' || NEW.status || ':' || v_stamp,
      CASE NEW.status::text
        WHEN 'completed' THEN 'bounty.completed'
        WHEN 'cancelled' THEN 'bounty.cancelled'
        WHEN 'in_progress' THEN 'bounty.in_progress'
        ELSE 'bounty.status_changed'
      END,
      'app',
      NEW.id,
      COALESCE(NEW.poster_id, NEW.user_id),
      COALESCE(
        CASE WHEN NEW.status::text = 'completed' THEN NEW.completed_at AT TIME ZONE 'UTC' END,
        NEW.updated_at,
        now()
      ),
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object('from', OLD.status, 'to', NEW.status, 'hunter_id', NEW.accepted_by)
    );
  END IF;

  IF COALESCE(NEW.is_stale, false) AND NOT COALESCE(OLD.is_stale, false) THEN
    PERFORM public.record_bounty_event(
      'bounty.stale:' || NEW.id || ':' || v_stamp,
      'bounty.flagged_stale',
      'system',
      NEW.id,
      NULL,
      COALESCE(NEW.stale_detected_at, NEW.updated_at, now()),
      NULL,
      NULL,
      jsonb_build_object('reason', NEW.stale_reason)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Observability must never break the marketplace.
  RAISE WARNING 'bounty_events: bounties trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_bounties ON public.bounties;
CREATE TRIGGER bounty_events_from_bounties
  AFTER INSERT OR UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_bounties();

-- ---- bounty_requests (applications) ----------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'application.submitted:' || NEW.id,
      'application.submitted',
      'app',
      NEW.bounty_id,
      NEW.hunter_id,
      NEW.created_at,
      NULL,
      NULL,
      jsonb_build_object('request_id', NEW.id, 'poster_id', NEW.poster_id, 'has_message', NEW.message IS NOT NULL)
    );
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('accepted', 'rejected') THEN
    PERFORM public.record_bounty_event(
      'application.' || NEW.status || ':' || NEW.id,
      'application.' || NEW.status,
      'app',
      NEW.bounty_id,
      NEW.poster_id,
      COALESCE(
        CASE WHEN NEW.status::text = 'accepted' THEN NEW.accepted_at ELSE NEW.rejected_at END AT TIME ZONE 'UTC',
        NEW.updated_at,
        now()
      ),
      NULL,
      NULL,
      jsonb_build_object('request_id', NEW.id, 'hunter_id', NEW.hunter_id)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: bounty_requests trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_requests ON public.bounty_requests;
CREATE TRIGGER bounty_events_from_requests
  AFTER INSERT OR UPDATE ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_requests();

-- ---- completion_submissions -------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_completions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'completion.submitted:' || NEW.id || ':' || COALESCE(NEW.revision_count, 0),
      'completion.submitted',
      'app',
      NEW.bounty_id,
      NEW.hunter_id,
      COALESCE(NEW.submitted_at, NEW.created_at, now()),
      NULL,
      NULL,
      jsonb_build_object('submission_id', NEW.id, 'revision', COALESCE(NEW.revision_count, 0))
    );
    RETURN NULL;
  END IF;

  -- A re-submission bumps revision_count, which is what makes the key unique
  -- across the revision loop rather than collapsing every round into one event.
  IF COALESCE(NEW.revision_count, 0) IS DISTINCT FROM COALESCE(OLD.revision_count, 0) THEN
    PERFORM public.record_bounty_event(
      'completion.submitted:' || NEW.id || ':' || COALESCE(NEW.revision_count, 0),
      'completion.submitted',
      'app',
      NEW.bounty_id,
      NEW.hunter_id,
      COALESCE(NEW.submitted_at, now()),
      NULL,
      NULL,
      jsonb_build_object('submission_id', NEW.id, 'revision', COALESCE(NEW.revision_count, 0))
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'completion.' || NEW.status || ':' || NEW.id || ':' || COALESCE(NEW.revision_count, 0),
      'completion.' || NEW.status,
      'app',
      NEW.bounty_id,
      NULL,
      COALESCE(NEW.reviewed_at, NEW.updated_at, now()),
      NULL,
      NULL,
      jsonb_build_object('submission_id', NEW.id, 'from', OLD.status, 'to', NEW.status)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: completion_submissions trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_completions ON public.completion_submissions;
CREATE TRIGGER bounty_events_from_completions
  AFTER INSERT OR UPDATE ON public.completion_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_completions();

-- ---- wallet_transactions (the v1 money ledger) ------------------------------
-- NOTE ON PROVENANCE: these rows are written by the app/edge functions, so
-- they are `source='app'` even when status='completed'. A completed
-- wallet_transaction is the platform's own assertion that money moved, NOT
-- Stripe's. Only a `source='webhook'` event is Stripe confirmation. The
-- Command Center relies on exactly this distinction.
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type   text;
  v_status text := COALESCE(NEW.status::text, 'unknown');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;  -- nothing lifecycle-relevant changed
  END IF;

  v_type := CASE NEW.type::text
    WHEN 'escrow'           THEN 'payment.escrow_funded'
    WHEN 'release'          THEN 'payment.released'
    WHEN 'refund'           THEN 'payment.refunded'
    WHEN 'deposit'          THEN 'payment.deposit'
    WHEN 'withdrawal'       THEN 'payout.' || v_status
    WHEN 'dispute_loss'     THEN 'payment.dispute_loss'
    WHEN 'admin_adjustment' THEN 'payment.adjustment'
    ELSE 'payment.' || NEW.type::text
  END;

  PERFORM public.record_bounty_event(
    'wallet.' || NEW.type || '.' || v_status || ':' || NEW.id,
    v_type,
    'app',
    NEW.bounty_id,
    COALESCE(NEW.user_id, NEW.sender_id),
    COALESCE(NEW.completed_at AT TIME ZONE 'UTC', NEW.updated_at, NEW.created_at, now()),
    ABS(COALESCE(NEW.amount, 0)),
    COALESCE(NEW.stripe_payout_id, NEW.stripe_transfer_id, NEW.stripe_payment_intent_id, NEW.stripe_charge_id),
    jsonb_build_object(
      'transaction_id', NEW.id,
      'ledger_type', NEW.type,
      'ledger_status', v_status,
      'receiver_id', NEW.receiver_id,
      'payout_method', NEW.payout_method,
      -- Which Stripe objects this row claims. Absence here is exactly what the
      -- "marked successful without Stripe confirmation" anomaly looks for.
      'stripe_payment_intent_id', NEW.stripe_payment_intent_id,
      'stripe_transfer_id', NEW.stripe_transfer_id,
      'stripe_payout_id', NEW.stripe_payout_id
    )
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: wallet_transactions trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_wallet ON public.wallet_transactions;
CREATE TRIGGER bounty_events_from_wallet
  AFTER INSERT OR UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_wallet();

-- ---- bounty_payments (the v2 Stripe-native payment record) ------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_bounty_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  PERFORM public.record_bounty_event(
    'bounty_payment.' || COALESCE(NEW.status, 'unknown') || ':' || NEW.id,
    'payment.record_' || COALESCE(NEW.status, 'unknown'),
    'app',
    NEW.bounty_id,
    NEW.poster_id,
    COALESCE(NEW.updated_at, NEW.created_at, now()),
    NEW.amount,
    COALESCE(NEW.stripe_payment_intent_id, NEW.transfer_group, NEW.stripe_checkout_session_id),
    jsonb_build_object(
      'bounty_payment_id', NEW.id,
      'hunter_id', NEW.hunter_id,
      'capture_method', NEW.capture_method,
      'stripe_payment_intent_id', NEW.stripe_payment_intent_id,
      'stripe_charge_id', NEW.stripe_charge_id,
      'stripe_transfer_id', NEW.stripe_transfer_id,
      'stripe_refund_id', NEW.stripe_refund_id,
      'platform_fee_amount', NEW.platform_fee_amount
    )
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: bounty_payments trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_bounty_payments ON public.bounty_payments;
CREATE TRIGGER bounty_events_from_bounty_payments
  AFTER INSERT OR UPDATE ON public.bounty_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_bounty_payments();

-- ---- bounty_disputes --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_disputes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'dispute.opened:' || NEW.id,
      'dispute.opened',
      'app',
      NEW.bounty_id,
      NEW.initiator_id,
      COALESCE(NEW.created_at AT TIME ZONE 'UTC', now()),
      NEW.hold_amount,
      NEW.payment_intent_id,
      jsonb_build_object('dispute_id', NEW.id, 'reason', NEW.reason, 'stripe_dispute_id', NEW.stripe_dispute_id)
    );
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.record_bounty_event(
      'dispute.' || NEW.status || ':' || NEW.id || ':' ||
        to_char(COALESCE(NEW.updated_at, now()) AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'dispute.' || NEW.status,
      'app',
      NEW.bounty_id,
      NEW.resolved_by,
      COALESCE(NEW.resolved_at AT TIME ZONE 'UTC', NEW.updated_at, now()),
      NEW.hold_amount,
      NEW.payment_intent_id,
      jsonb_build_object('dispute_id', NEW.id, 'from', OLD.status, 'to', NEW.status, 'winner', NEW.winner)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: bounty_disputes trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_disputes ON public.bounty_disputes;
CREATE TRIGGER bounty_events_from_disputes
  AFTER INSERT OR UPDATE ON public.bounty_disputes
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_disputes();

-- ---- reports (moderation signal) --------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_reports()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.record_bounty_event(
    'report.filed:' || NEW.id,
    'moderation.report_filed',
    'app',
    CASE WHEN NEW.content_type = 'bounty' THEN NEW.content_id ELSE NULL END,
    NEW.reporter_id,
    COALESCE(NEW.created_at AT TIME ZONE 'UTC', now()),
    NULL,
    NULL,
    jsonb_build_object('report_id', NEW.id, 'content_type', NEW.content_type, 'reason', NEW.reason)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: reports trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bounty_events_from_reports ON public.reports;
CREATE TRIGGER bounty_events_from_reports
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_reports();

-- ============================================================================
-- 4. WEBHOOK IDEMPOTENCY + WEBHOOK-SOURCED EVENTS
-- ============================================================================
-- BUG FIXED HERE (see docs/admin/COMMAND_CENTER.md "Financial findings"):
-- supabase/functions/webhooks/index.ts opened every request with
--
--     upsert({ stripe_event_id, event_type, event_data, processed: false },
--            { onConflict: 'stripe_event_id' })
--
-- and then ran the handler unconditionally. A Stripe redelivery of an event
-- that had ALREADY been processed therefore (a) reset `processed` back to
-- false and (b) re-ran the full handler -- re-crediting balances, re-writing
-- ledger rows and re-firing notifications for any handler without its own
-- internal idempotency key. `stripe_events` looked like a dedupe table but
-- never actually deduped anything.
--
-- `claim_stripe_event` makes the claim atomic: the INSERT ... ON CONFLICT DO
-- UPDATE ... WHERE NOT processed either wins the row or returns nothing. Two
-- concurrent deliveries of the same event serialise on the conflicting row, so
-- exactly one of them can be claimed.

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_stripe_event_id text,
  p_event_type      text,
  p_event_data      jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Processing lease. Must stay above the Edge Function wall-clock limit.
  c_lease_seconds constant integer := 300;
  v_claimed uuid;
BEGIN
  IF p_stripe_event_id IS NULL OR length(p_stripe_event_id) = 0 THEN
    RAISE EXCEPTION 'claim_stripe_event: p_stripe_event_id is required';
  END IF;

  INSERT INTO public.stripe_events (
    stripe_event_id, event_type, event_data, processed, status, last_retry_at
  )
  VALUES (p_stripe_event_id, p_event_type, p_event_data, false, 'processing', now())
  ON CONFLICT (stripe_event_id) DO UPDATE
    SET status        = 'processing',
        last_retry_at = now(),
        retry_count   = COALESCE(public.stripe_events.retry_count, 0) + 1,
        event_data    = COALESCE(EXCLUDED.event_data, public.stripe_events.event_data)
    WHERE public.stripe_events.processed IS DISTINCT FROM true
      -- Lease predicate, added 2026-09-02 and kept byte-identical to
      -- 20260902210000_stripe_event_claim_lease.sql so that whichever of the
      -- two migrations is applied last leaves the same function behind.
      -- Gating on `processed` alone only deduped COMPLETED events: two
      -- deliveries arriving while the first was still in flight both claimed
      -- the event and both ran the handler.
      AND (
        public.stripe_events.status IS DISTINCT FROM 'processing'
        OR public.stripe_events.last_retry_at IS NULL
        OR public.stripe_events.last_retry_at < now() - make_interval(secs => c_lease_seconds)
      )
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text, jsonb) TO service_role;

-- Records a signature-verified Stripe webhook into the ledger as
-- `source='webhook'` -- the only provenance the console treats as Stripe
-- confirmation. The bounty is resolved from whichever Stripe id the object
-- carries; an unresolvable one still records the event with a NULL bounty_id,
-- which is precisely the "financial record with no corresponding bounty"
-- anomaly rather than something to drop on the floor.
CREATE OR REPLACE FUNCTION public.record_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type      text,
  p_object          jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bounty  uuid;
  v_actor   uuid;
  v_pi      text := NULLIF(p_object ->> 'payment_intent', '');
  v_id      text := NULLIF(p_object ->> 'id', '');
  v_object  text := NULLIF(p_object ->> 'object', '');
  v_corr    text;
  v_amount  numeric;
BEGIN
  -- 1. Explicit metadata wins.
  BEGIN
    v_bounty := NULLIF(p_object -> 'metadata' ->> 'bounty_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_bounty := NULL;
  END;
  BEGIN
    v_actor := NULLIF(p_object -> 'metadata' ->> 'user_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  v_corr := COALESCE(v_pi, v_id);

  -- 2. Otherwise join back through whichever Stripe id we already store.
  IF v_bounty IS NULL AND v_corr IS NOT NULL THEN
    SELECT w.bounty_id, COALESCE(w.user_id, w.sender_id)
      INTO v_bounty, v_actor
      FROM public.wallet_transactions w
     WHERE w.stripe_payment_intent_id = v_corr
        OR w.stripe_transfer_id       = v_corr
        OR w.stripe_payout_id         = v_corr
        OR w.stripe_charge_id         = v_corr
     ORDER BY w.created_at DESC
     LIMIT 1;
  END IF;

  IF v_bounty IS NULL AND v_corr IS NOT NULL THEN
    SELECT p.bounty_id, p.poster_id
      INTO v_bounty, v_actor
      FROM public.bounty_payments p
     WHERE p.stripe_payment_intent_id  = v_corr
        OR p.stripe_charge_id          = v_corr
        OR p.stripe_transfer_id        = v_corr
        OR p.transfer_group            = v_corr
        OR p.stripe_checkout_session_id = v_corr
     ORDER BY p.created_at DESC
     LIMIT 1;
  END IF;

  -- Stripe amounts are in the smallest currency unit.
  v_amount := CASE
    WHEN v_object IN ('payment_intent', 'charge', 'transfer', 'payout', 'refund', 'topup')
      THEN (NULLIF(p_object ->> 'amount', ''))::numeric / 100.0
    ELSE NULL
  END;

  RETURN public.record_bounty_event(
    'stripe:' || p_stripe_event_id,
    'stripe.' || p_event_type,
    'webhook',
    v_bounty,
    v_actor,
    COALESCE(to_timestamp(NULLIF(p_object ->> 'created', '')::double precision), now()),
    v_amount,
    v_corr,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'stripe_event_type', p_event_type,
      'stripe_object', v_object,
      'stripe_object_id', v_id,
      'status', p_object ->> 'status',
      'failure_code', COALESCE(p_object ->> 'failure_code', p_object -> 'last_payment_error' ->> 'code'),
      'failure_message', COALESCE(p_object ->> 'failure_message', p_object -> 'last_payment_error' ->> 'message')
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: record_stripe_webhook_event suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stripe_webhook_event(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event(text, text, jsonb) TO service_role;

-- ============================================================================
-- 5. BACKFILL
-- ============================================================================
-- Reconstructs history from the rows that already exist so the Command Center
-- is useful on day one instead of empty until the next posting. Every insert
-- uses the SAME event_key formula the triggers use, and ON CONFLICT DO
-- NOTHING, so this block is safe to re-run and cannot double-count.
--
-- Where the real timestamp of a transition was never recorded (the schema has
-- no `accepted_at` / `cancelled_at` on `bounties`) the event is marked
-- `source='inferred'` and the console labels it INFERRED STATE. It is not
-- presented as an observed event, and never as a Stripe confirmation.

-- Bounty posted
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, metadata)
SELECT 'bounty.posted:' || b.id, 'bounty.posted', 'app', b.id,
       COALESCE(b.poster_id, b.user_id), b.created_at,
       CASE WHEN COALESCE(b.is_for_honor, false) THEN NULL ELSE b.amount END,
       jsonb_build_object('title', b.title, 'category', b.category,
                          'is_for_honor', COALESCE(b.is_for_honor, false), 'backfilled', true)
FROM public.bounties b
ON CONFLICT (event_key) DO NOTHING;

-- Bounty accepted. Real timestamp when the accepted application carries one,
-- otherwise inferred from updated_at.
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, metadata)
SELECT 'bounty.accepted:' || b.id || ':' || b.accepted_by,
       'bounty.accepted',
       CASE WHEN r.accepted_at IS NOT NULL THEN 'app' ELSE 'inferred' END,
       b.id, b.accepted_by,
       COALESCE(r.accepted_at AT TIME ZONE 'UTC', b.updated_at, b.created_at),
       CASE WHEN COALESCE(b.is_for_honor, false) THEN NULL ELSE b.amount END,
       jsonb_build_object('poster_id', COALESCE(b.poster_id, b.user_id),
                          'hunter_id', b.accepted_by, 'backfilled', true,
                          'timestamp_source',
                          CASE WHEN r.accepted_at IS NOT NULL THEN 'bounty_requests.accepted_at'
                               ELSE 'bounties.updated_at (inferred)' END)
FROM public.bounties b
LEFT JOIN LATERAL (
  SELECT br.accepted_at FROM public.bounty_requests br
  WHERE br.bounty_id = b.id AND br.hunter_id = b.accepted_by AND br.status::text = 'accepted'
  ORDER BY br.accepted_at DESC NULLS LAST LIMIT 1
) r ON true
WHERE b.accepted_by IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

-- Terminal / non-open bounty states.
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, metadata)
SELECT 'bounty.status:' || b.id || ':' || b.status || ':' ||
         to_char(COALESCE(
           CASE WHEN b.status::text = 'completed' THEN b.completed_at AT TIME ZONE 'UTC' END,
           b.updated_at, b.created_at) AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
       CASE b.status::text
         WHEN 'completed' THEN 'bounty.completed'
         WHEN 'cancelled' THEN 'bounty.cancelled'
         WHEN 'in_progress' THEN 'bounty.in_progress'
         ELSE 'bounty.status_changed' END,
       CASE WHEN b.status::text = 'completed' AND b.completed_at IS NOT NULL THEN 'app' ELSE 'inferred' END,
       b.id, COALESCE(b.poster_id, b.user_id),
       COALESCE(CASE WHEN b.status::text = 'completed' THEN b.completed_at AT TIME ZONE 'UTC' END,
                b.updated_at, b.created_at),
       CASE WHEN COALESCE(b.is_for_honor, false) THEN NULL ELSE b.amount END,
       jsonb_build_object('to', b.status, 'hunter_id', b.accepted_by, 'backfilled', true)
FROM public.bounties b
WHERE b.status::text <> 'open'
ON CONFLICT (event_key) DO NOTHING;

-- Applications
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, metadata)
SELECT 'application.submitted:' || r.id, 'application.submitted', 'app', r.bounty_id, r.hunter_id, r.created_at,
       jsonb_build_object('request_id', r.id, 'poster_id', r.poster_id, 'backfilled', true)
FROM public.bounty_requests r
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, metadata)
SELECT 'application.' || r.status || ':' || r.id, 'application.' || r.status,
       CASE WHEN COALESCE(r.accepted_at, r.rejected_at) IS NOT NULL THEN 'app' ELSE 'inferred' END,
       r.bounty_id, r.poster_id,
       COALESCE(CASE WHEN r.status::text = 'accepted' THEN r.accepted_at ELSE r.rejected_at END AT TIME ZONE 'UTC',
                r.updated_at, r.created_at),
       jsonb_build_object('request_id', r.id, 'hunter_id', r.hunter_id, 'backfilled', true)
FROM public.bounty_requests r
WHERE r.status::text IN ('accepted', 'rejected')
ON CONFLICT (event_key) DO NOTHING;

-- Completion submissions
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, metadata)
SELECT 'completion.submitted:' || c.id || ':' || COALESCE(c.revision_count, 0),
       'completion.submitted', 'app', c.bounty_id, c.hunter_id,
       COALESCE(c.submitted_at, c.created_at),
       jsonb_build_object('submission_id', c.id, 'revision', COALESCE(c.revision_count, 0), 'backfilled', true)
FROM public.completion_submissions c
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, occurred_at, metadata)
SELECT 'completion.' || c.status || ':' || c.id || ':' || COALESCE(c.revision_count, 0),
       'completion.' || c.status,
       CASE WHEN c.reviewed_at IS NOT NULL THEN 'app' ELSE 'inferred' END,
       c.bounty_id, COALESCE(c.reviewed_at, c.updated_at, c.submitted_at, c.created_at),
       jsonb_build_object('submission_id', c.id, 'to', c.status, 'backfilled', true)
FROM public.completion_submissions c
WHERE c.status IS NOT NULL AND c.status <> 'pending'
ON CONFLICT (event_key) DO NOTHING;

-- Wallet ledger
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, correlation_id, metadata)
SELECT 'wallet.' || w.type || '.' || w.status || ':' || w.id,
       CASE w.type::text
         WHEN 'escrow'           THEN 'payment.escrow_funded'
         WHEN 'release'          THEN 'payment.released'
         WHEN 'refund'           THEN 'payment.refunded'
         WHEN 'deposit'          THEN 'payment.deposit'
         WHEN 'withdrawal'       THEN 'payout.' || w.status::text
         WHEN 'dispute_loss'     THEN 'payment.dispute_loss'
         WHEN 'admin_adjustment' THEN 'payment.adjustment'
         ELSE 'payment.' || w.type::text END,
       'app', w.bounty_id, COALESCE(w.user_id, w.sender_id),
       COALESCE(w.completed_at AT TIME ZONE 'UTC', w.updated_at, w.created_at),
       ABS(COALESCE(w.amount, 0)),
       COALESCE(w.stripe_payout_id, w.stripe_transfer_id, w.stripe_payment_intent_id, w.stripe_charge_id),
       jsonb_build_object('transaction_id', w.id, 'ledger_type', w.type, 'ledger_status', w.status,
                          'receiver_id', w.receiver_id, 'payout_method', w.payout_method,
                          'stripe_payment_intent_id', w.stripe_payment_intent_id,
                          'stripe_transfer_id', w.stripe_transfer_id,
                          'stripe_payout_id', w.stripe_payout_id, 'backfilled', true)
FROM public.wallet_transactions w
ON CONFLICT (event_key) DO NOTHING;

-- v2 payment records
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, correlation_id, metadata)
SELECT 'bounty_payment.' || COALESCE(p.status, 'unknown') || ':' || p.id,
       'payment.record_' || COALESCE(p.status, 'unknown'), 'app', p.bounty_id, p.poster_id,
       COALESCE(p.updated_at, p.created_at), p.amount,
       COALESCE(p.stripe_payment_intent_id, p.transfer_group, p.stripe_checkout_session_id),
       jsonb_build_object('bounty_payment_id', p.id, 'hunter_id', p.hunter_id,
                          'stripe_payment_intent_id', p.stripe_payment_intent_id,
                          'stripe_charge_id', p.stripe_charge_id,
                          'stripe_transfer_id', p.stripe_transfer_id, 'backfilled', true)
FROM public.bounty_payments p
ON CONFLICT (event_key) DO NOTHING;

-- Disputes
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, correlation_id, metadata)
SELECT 'dispute.opened:' || d.id, 'dispute.opened', 'app', d.bounty_id, d.initiator_id,
       COALESCE(d.created_at AT TIME ZONE 'UTC', now()), d.hold_amount, d.payment_intent_id,
       jsonb_build_object('dispute_id', d.id, 'reason', d.reason, 'backfilled', true)
FROM public.bounty_disputes d
ON CONFLICT (event_key) DO NOTHING;

-- Historical Stripe webhooks. These were signature-verified when received, so
-- they keep source='webhook' -- they are genuine Stripe confirmations.
DO $backfill$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT stripe_event_id, event_type, event_data
    FROM public.stripe_events
    WHERE stripe_event_id IS NOT NULL AND event_data IS NOT NULL
    ORDER BY created_at
  LOOP
    PERFORM public.record_stripe_webhook_event(r.stripe_event_id, r.event_type, r.event_data);
  END LOOP;
END;
$backfill$;

-- ============================================================================
-- 6. MARKETPLACE STATUS vs FINANCIAL STATUS
-- ============================================================================
-- The single most important distinction in this whole feature. `bounties.status`
-- is a MARKETPLACE fact -- what the two humans think happened. It says nothing
-- about whether money moved, and 45 completed bounties in production prove it:
-- a bounty is marked completed by the poster tapping a button, with no
-- reference to Stripe at all.
--
-- This view derives a separate FINANCIAL status per bounty and, crucially,
-- records whether that status is CONFIRMED (a signature-verified Stripe
-- webhook, or a stored Stripe object id) or merely ASSERTED by our own ledger.
--
-- Not exposed to end users: it is only read from inside the SECURITY DEFINER
-- admin functions below, and EXECUTE/SELECT is revoked from anon and
-- authenticated.
CREATE OR REPLACE VIEW public.admin_bounty_financial_state AS
SELECT
  b.id                                         AS bounty_id,
  b.status::text                               AS marketplace_status,
  COALESCE(b.poster_id, b.user_id)             AS poster_id,
  b.accepted_by                                AS hunter_id,
  b.amount,
  COALESCE(b.is_for_honor, false)              AS is_for_honor,
  b.created_at,
  b.completed_at,
  COALESCE(w.escrow_amount, 0)                 AS escrow_amount,
  COALESCE(w.release_amount, 0)                AS release_amount,
  COALESCE(w.refund_amount, 0)                 AS refund_amount,
  COALESCE(w.pending_count, 0)                 AS pending_ledger_count,
  COALESCE(p.payment_records, 0)               AS payment_records,
  COALESCE(p.stripe_confirmed, false)          AS payment_record_confirmed,
  COALESCE(e.webhook_events, 0)                AS webhook_events,
  -- "Stripe actually told us so." Either a signature-verified webhook landed
  -- against this bounty, or a Stripe object id is stored on its v2 payment
  -- record. Our own wallet ledger saying `completed` does NOT count.
  (COALESCE(e.webhook_events, 0) > 0 OR COALESCE(p.stripe_confirmed, false)) AS stripe_confirmed,
  CASE
    WHEN COALESCE(b.is_for_honor, false) OR COALESCE(b.amount, 0) = 0 THEN 'not_applicable'
    WHEN COALESCE(w.refund_amount, 0) > 0 AND COALESCE(w.release_amount, 0) = 0 THEN 'refunded'
    WHEN COALESCE(w.release_amount, 0) > 0
      AND (COALESCE(e.webhook_events, 0) > 0 OR COALESCE(p.stripe_confirmed, false)) THEN 'released_verified'
    WHEN COALESCE(w.release_amount, 0) > 0 THEN 'released_unverified'
    WHEN COALESCE(w.escrow_amount, 0) > 0 AND b.status::text = 'completed' THEN 'release_pending'
    WHEN COALESCE(w.escrow_amount, 0) > 0 THEN 'escrow_held'
    WHEN b.status::text = 'completed' THEN 'completed_unfunded'
    ELSE 'unfunded'
  END AS financial_status
FROM public.bounties b
LEFT JOIN LATERAL (
  SELECT
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'escrow'  AND wt.status::text = 'completed') AS escrow_amount,
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'release' AND wt.status::text = 'completed') AS release_amount,
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'refund'  AND wt.status::text = 'completed') AS refund_amount,
    COUNT(*)            FILTER (WHERE wt.status::text = 'pending')                                 AS pending_count
  FROM public.wallet_transactions wt
  WHERE wt.bounty_id = b.id
) w ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS payment_records,
    BOOL_OR(bp.stripe_charge_id IS NOT NULL OR bp.stripe_transfer_id IS NOT NULL) AS stripe_confirmed
  FROM public.bounty_payments bp
  WHERE bp.bounty_id = b.id
) p ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS webhook_events
  FROM public.bounty_events be
  WHERE be.bounty_id = b.id
    AND be.source = 'webhook'
    AND be.event_type IN (
      'stripe.payment_intent.succeeded', 'stripe.charge.succeeded', 'stripe.charge.captured',
      'stripe.transfer.created', 'stripe.transfer.paid', 'stripe.payout.paid',
      'stripe.checkout.session.completed', 'stripe.checkout.session.async_payment_succeeded'
    )
) e ON true;

COMMENT ON VIEW public.admin_bounty_financial_state IS
  'Per-bounty MARKETPLACE status vs FINANCIAL status. stripe_confirmed=false means our ledger asserts the money moved but Stripe has never confirmed it.';

REVOKE ALL ON public.admin_bounty_financial_state FROM PUBLIC;
REVOKE ALL ON public.admin_bounty_financial_state FROM anon;
REVOKE ALL ON public.admin_bounty_financial_state FROM authenticated;

-- ============================================================================
-- 7. ADMIN GUARD
-- ============================================================================
-- Used by every read below. The SECURITY DEFINER functions bypass RLS by
-- design (they aggregate across all users), so this guard IS the authorization
-- boundary for them and must come first in every one.
CREATE OR REPLACE FUNCTION public.admin_assert_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assert_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_assert_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_assert_role() TO authenticated, service_role;

-- ============================================================================
-- 8. MARKETPLACE OVERVIEW
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_marketplace_overview(
  p_since timestamptz DEFAULT (now() - interval '24 hours')
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
  v_since timestamptz := COALESCE(p_since, now() - interval '24 hours');
BEGIN
  PERFORM public.admin_assert_role();

  SELECT jsonb_build_object(
    'since', v_since,
    'generated_at', now(),

    -- ── Flow ────────────────────────────────────────────────────────────
    'new_bounties', (SELECT count(*) FROM public.bounties WHERE created_at >= v_since),
    'applications', (SELECT count(*) FROM public.bounty_events
                      WHERE event_type = 'application.submitted' AND occurred_at >= v_since),
    'accepts',      (SELECT count(*) FROM public.bounty_events
                      WHERE event_type = 'bounty.accepted' AND occurred_at >= v_since),
    'completions',  (SELECT count(*) FROM public.bounty_events
                      WHERE event_type = 'bounty.completed' AND occurred_at >= v_since),

    -- A "new poster"/"new hunter" is someone whose FIRST ever post/application
    -- happened in the window -- not merely someone who signed up, which tells
    -- a founder nothing about whether the marketplace is working.
    'new_posters', (
      SELECT count(*) FROM (
        SELECT actor_id, min(occurred_at) AS first_at
        FROM public.bounty_events
        WHERE event_type = 'bounty.posted' AND actor_id IS NOT NULL
        GROUP BY actor_id
      ) f WHERE f.first_at >= v_since),
    'new_hunters', (
      SELECT count(*) FROM (
        SELECT actor_id, min(occurred_at) AS first_at
        FROM public.bounty_events
        WHERE event_type = 'application.submitted' AND actor_id IS NOT NULL
        GROUP BY actor_id
      ) f WHERE f.first_at >= v_since),
    'new_signups', (SELECT count(*) FROM public.profiles
                     WHERE created_at >= v_since AND deleted_at IS NULL),

    -- ── Money ───────────────────────────────────────────────────────────
    -- completed_gmv is what the marketplace CLAIMS it transacted.
    -- verified_gmv is the part of it Stripe has actually confirmed.
    -- The gap between them is the number a founder needs to watch.
    'completed_gmv', COALESCE((
      SELECT sum(f.amount) FROM public.admin_bounty_financial_state f
      JOIN public.bounties b ON b.id = f.bounty_id
      WHERE f.marketplace_status = 'completed' AND NOT f.is_for_honor
        AND COALESCE(b.completed_at AT TIME ZONE 'UTC', b.updated_at) >= v_since), 0),
    'verified_gmv', COALESCE((
      SELECT sum(f.amount) FROM public.admin_bounty_financial_state f
      JOIN public.bounties b ON b.id = f.bounty_id
      WHERE f.marketplace_status = 'completed' AND NOT f.is_for_honor AND f.stripe_confirmed
        AND COALESCE(b.completed_at AT TIME ZONE 'UTC', b.updated_at) >= v_since), 0),
    'completed_gmv_lifetime', COALESCE((
      SELECT sum(amount) FROM public.admin_bounty_financial_state
      WHERE marketplace_status = 'completed' AND NOT is_for_honor), 0),
    'verified_gmv_lifetime', COALESCE((
      SELECT sum(amount) FROM public.admin_bounty_financial_state
      WHERE marketplace_status = 'completed' AND NOT is_for_honor AND stripe_confirmed), 0),
    'escrow_held', COALESCE((
      SELECT sum(escrow_amount - LEAST(escrow_amount, release_amount + refund_amount))
      FROM public.admin_bounty_financial_state), 0),

    -- Everything the platform has recorded but not reconciled to Stripe.
    'pending_financial_events', (
      (SELECT count(*) FROM public.wallet_transactions WHERE status::text = 'pending')
      + (SELECT count(*) FROM public.admin_bounty_financial_state
          WHERE marketplace_status = 'completed'
            AND financial_status IN ('released_unverified', 'release_pending', 'completed_unfunded'))),
    'unverified_completions', (
      SELECT count(*) FROM public.admin_bounty_financial_state
      WHERE marketplace_status = 'completed' AND NOT is_for_honor AND NOT stripe_confirmed),

    'payout_failures', (
      SELECT count(*) FROM public.bounty_events
      WHERE occurred_at >= v_since
        AND event_type IN ('payout.failed', 'stripe.payout.failed', 'stripe.transfer.failed')),
    'payout_failures_lifetime', (
      SELECT count(*) FROM public.bounty_events
      WHERE event_type IN ('payout.failed', 'stripe.payout.failed', 'stripe.transfer.failed')),

    -- ── Trust & safety ──────────────────────────────────────────────────
    'suspicious_listings', (SELECT count(*) FROM public.admin_suspicious_listings()),
    'suspicious_applications', (SELECT count(*) FROM public.admin_suspicious_applications()),

    -- ── Operational queues (kept here so one round trip fills the screen) ─
    'open_disputes', (SELECT count(*) FROM public.bounty_disputes
                       WHERE status::text IN ('open', 'pending', 'under_review', 'escalated')),
    'pending_reports', (SELECT count(*) FROM public.reports WHERE status = 'pending'),
    'pending_withdrawals', (SELECT count(*) FROM public.wallet_transactions
                             WHERE type::text = 'withdrawal' AND status::text = 'pending'),
    'unprocessed_webhooks', (SELECT count(*) FROM public.stripe_events
                              WHERE COALESCE(processed, false) = false
                                AND created_at < now() - interval '1 hour'),
    'failed_webhooks', (SELECT count(*) FROM public.stripe_events WHERE status = 'failed'),
    'open_anomalies', (SELECT count(*) FROM public.admin_financial_anomalies())
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_marketplace_overview(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_marketplace_overview(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_overview(timestamptz) TO authenticated, service_role;

-- ============================================================================
-- 9. SUSPICIOUS ACTIVITY
-- ============================================================================
-- Built only from signals this database actually carries. Nothing here is a
-- guess dressed up as a score: every row names the rule that fired, so an
-- operator can disagree with the rule rather than with an opaque number.
--
-- Thresholds are deliberately inline and commented rather than hidden in a
-- config table nobody will find.

CREATE OR REPLACE FUNCTION public.admin_suspicious_listings()
RETURNS TABLE (
  bounty_id   uuid,
  poster_id   uuid,
  title       text,
  amount      numeric,
  status      text,
  reason      text,
  severity    text,
  detected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  -- (1) A user reported it and nobody has cleared the report.
  SELECT b.id, COALESCE(b.poster_id, b.user_id), b.title, b.amount, b.status::text,
         'open_report'::text, 'high'::text, COALESCE(r.created_at AT TIME ZONE 'UTC', b.created_at)
  FROM public.bounties b
  JOIN public.reports r ON r.content_type = 'bounty' AND r.content_id = b.id
  WHERE COALESCE(r.status, 'pending') IN ('pending', 'reviewed')
    AND b.status::text NOT IN ('deleted', 'archived')

  UNION ALL
  -- (2) Posted by an account that moderation has already acted against.
  SELECT b.id, COALESCE(b.poster_id, b.user_id), b.title, b.amount, b.status::text,
         'poster_restricted'::text, 'high'::text, b.created_at
  FROM public.bounties b
  JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
  WHERE (COALESCE(p.account_status, 'active') IN ('suspended', 'banned')
         OR COALESCE(p.account_restricted, false)
         OR p.risk_level = 'high')
    AND b.status::text NOT IN ('deleted', 'archived')

  UNION ALL
  -- (3) High-value listing from an account less than a day old. The classic
  --     advance-fee shape: signup, immediately post a large bounty.
  --     Threshold: >= $200 within 24h of signup.
  SELECT b.id, COALESCE(b.poster_id, b.user_id), b.title, b.amount, b.status::text,
         'new_account_high_value'::text, 'medium'::text, b.created_at
  FROM public.bounties b
  JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
  WHERE COALESCE(b.is_for_honor, false) = false
    AND COALESCE(b.amount, 0) >= 200
    AND b.created_at < p.created_at + interval '24 hours'
    AND b.status::text NOT IN ('deleted', 'archived')

  UNION ALL
  -- (4) The same poster spamming the same title. Threshold: 3+ identical
  --     titles inside 24 hours.
  SELECT b.id, COALESCE(b.poster_id, b.user_id), b.title, b.amount, b.status::text,
         'duplicate_listing'::text, 'medium'::text, b.created_at
  FROM public.bounties b
  WHERE b.status::text NOT IN ('deleted', 'archived')
    AND (
      SELECT count(*) FROM public.bounties d
      WHERE d.title = b.title
        AND COALESCE(d.poster_id, d.user_id) = COALESCE(b.poster_id, b.user_id)
        AND d.created_at BETWEEN b.created_at - interval '24 hours' AND b.created_at + interval '24 hours'
    ) >= 3;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_suspicious_applications()
RETURNS TABLE (
  request_id  uuid,
  bounty_id   uuid,
  hunter_id   uuid,
  status      text,
  reason      text,
  severity    text,
  detected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  -- (1) Applying from an account moderation has already acted against.
  SELECT r.id, r.bounty_id, r.hunter_id, r.status::text,
         'hunter_restricted'::text, 'high'::text, r.created_at
  FROM public.bounty_requests r
  JOIN public.profiles p ON p.id = r.hunter_id
  WHERE COALESCE(p.account_status, 'active') IN ('suspended', 'banned')
     OR COALESCE(p.account_restricted, false)
     OR p.risk_level = 'high'

  UNION ALL
  -- (2) Applying to your own bounty. Should be structurally impossible; if it
  --     appears, either the app has a hole or someone is farming their own
  --     listings. Either way an operator needs to know.
  SELECT r.id, r.bounty_id, r.hunter_id, r.status::text,
         'self_application'::text, 'critical'::text, r.created_at
  FROM public.bounty_requests r
  JOIN public.bounties b ON b.id = r.bounty_id
  WHERE r.hunter_id IS NOT NULL
    AND r.hunter_id = COALESCE(b.poster_id, b.user_id)

  UNION ALL
  -- (3) Spray applications. Threshold: 10+ distinct bounties inside 24h.
  SELECT r.id, r.bounty_id, r.hunter_id, r.status::text,
         'application_spray'::text, 'medium'::text, r.created_at
  FROM public.bounty_requests r
  WHERE r.hunter_id IS NOT NULL
    AND (
      SELECT count(DISTINCT d.bounty_id) FROM public.bounty_requests d
      WHERE d.hunter_id = r.hunter_id
        AND d.created_at BETWEEN r.created_at - interval '24 hours' AND r.created_at
    ) >= 10;
END;
$$;

-- ============================================================================
-- 10. AUTOMATIC ANOMALY DETECTION
-- ============================================================================
-- Every class the founder brief asks for, plus the ones the production audit
-- turned up. Read-only: this reports, it never repairs. Repair stays on the
-- existing Withdrawal Recovery / Balance Reconciliation screens where the
-- money-moving flow and its audit trail already live.
--
-- Deliberately NOT flagged: a v1 release with no Stripe transfer. Under the v1
-- architecture a release is an internal wallet move and no Stripe transfer is
-- ever expected -- the transfer happens later, at withdrawal. Flagging those
-- would report all 21 production releases as broken and train the operator to
-- ignore the screen. Only v2 bounties (payment_architecture_version >= 2, or
-- a bounty_payments record) are held to the transfer expectation.

CREATE OR REPLACE FUNCTION public.admin_financial_anomalies(p_limit integer DEFAULT 200)
RETURNS TABLE (
  anomaly_type text,
  severity     text,
  entity_type  text,
  entity_id    text,
  bounty_id    uuid,
  user_id      uuid,
  amount       numeric,
  detected_at  timestamptz,
  summary      text,
  detail       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  WITH findings AS (

    -- (1) Completed bounty with no financial record at all.
    SELECT 'completed_without_financial_record'::text AS anomaly_type,
           'critical'::text AS severity,
           'bounty'::text AS entity_type,
           f.bounty_id::text AS entity_id,
           f.bounty_id,
           f.poster_id AS user_id,
           f.amount,
           COALESCE(f.completed_at AT TIME ZONE 'UTC', f.created_at) AS detected_at,
           'Bounty is marked completed but no escrow, release or payment record exists.'::text AS summary,
           jsonb_build_object('marketplace_status', f.marketplace_status,
                              'financial_status', f.financial_status) AS detail
    FROM public.admin_bounty_financial_state f
    WHERE f.marketplace_status = 'completed'
      AND NOT f.is_for_honor
      AND COALESCE(f.amount, 0) > 0
      AND f.escrow_amount = 0 AND f.release_amount = 0 AND f.payment_records = 0

    UNION ALL
    -- (2) Completed bounty whose money our ledger claims moved, with no Stripe
    --     confirmation anywhere. This is the COMPLETED + VERIFICATION PENDING
    --     state, surfaced as an anomaly once it is old enough to be stuck.
    SELECT 'completed_without_stripe_confirmation', 'high', 'bounty',
           f.bounty_id::text, f.bounty_id, f.poster_id, f.amount,
           COALESCE(f.completed_at AT TIME ZONE 'UTC', f.created_at),
           'Bounty completed and released in our ledger, but Stripe has never confirmed it.',
           jsonb_build_object('financial_status', f.financial_status,
                              'release_amount', f.release_amount,
                              'webhook_events', f.webhook_events)
    FROM public.admin_bounty_financial_state f
    WHERE f.marketplace_status = 'completed'
      AND NOT f.is_for_honor
      AND COALESCE(f.amount, 0) > 0
      AND NOT f.stripe_confirmed
      AND f.release_amount > 0

    UNION ALL
    -- (3) Financial record pointing at a bounty that does not exist.
    SELECT 'financial_record_without_bounty', 'critical', 'wallet_transaction',
           w.id::text, w.bounty_id, COALESCE(w.user_id, w.sender_id), ABS(w.amount), w.created_at,
           'Wallet transaction references a bounty id with no matching bounty row.',
           jsonb_build_object('type', w.type, 'status', w.status, 'orphan_bounty_id', w.bounty_id)
    FROM public.wallet_transactions w
    WHERE w.bounty_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bounties b WHERE b.id = w.bounty_id)

    UNION ALL
    SELECT 'financial_record_without_bounty', 'critical', 'bounty_payment',
           p.id::text, p.bounty_id, p.poster_id, p.amount, p.created_at,
           'Bounty payment record references a bounty id with no matching bounty row.',
           jsonb_build_object('status', p.status, 'orphan_bounty_id', p.bounty_id)
    FROM public.bounty_payments p
    WHERE p.bounty_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bounties b WHERE b.id = p.bounty_id)

    UNION ALL
    -- (4) A v2 release with no Stripe transfer. See the note above on why this
    --     is scoped to v2 only.
    SELECT 'release_without_transfer', 'critical', 'wallet_transaction',
           w.id::text, w.bounty_id, COALESCE(w.receiver_id, w.user_id), ABS(w.amount),
           COALESCE(w.completed_at AT TIME ZONE 'UTC', w.created_at),
           'Escrow was released on a Stripe-native (v2) bounty but no transfer id was ever recorded.',
           jsonb_build_object('transaction_status', w.status,
                              'payment_architecture_version', b.payment_architecture_version)
    FROM public.wallet_transactions w
    JOIN public.bounties b ON b.id = w.bounty_id
    WHERE w.type::text = 'release'
      AND w.status::text = 'completed'
      AND w.stripe_transfer_id IS NULL
      AND (COALESCE(b.payment_architecture_version, 1) >= 2
           OR EXISTS (SELECT 1 FROM public.bounty_payments bp WHERE bp.bounty_id = b.id))

    UNION ALL
    -- (5) Withdrawal marked successful with nothing from Stripe to back it up.
    --     Severity is aged down for rows that predate payout-id capture, so the
    --     known legacy backlog does not drown out a fresh one.
    SELECT 'payout_success_without_stripe_confirmation',
           CASE WHEN w.created_at >= now() - interval '90 days' THEN 'critical' ELSE 'medium' END,
           'wallet_transaction', w.id::text, NULL::uuid, w.user_id, ABS(w.amount),
           COALESCE(w.completed_at AT TIME ZONE 'UTC', w.created_at),
           'Withdrawal is marked completed but carries no Stripe payout id and no payout webhook.',
           jsonb_build_object('payout_method', w.payout_method,
                              'stripe_transfer_id', w.stripe_transfer_id,
                              'age_days', EXTRACT(day FROM now() - w.created_at)::int)
    FROM public.wallet_transactions w
    WHERE w.type::text = 'withdrawal'
      AND w.status::text = 'completed'
      AND w.stripe_payout_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bounty_events e
        WHERE e.source = 'webhook'
          AND e.event_type IN ('stripe.payout.paid', 'stripe.transfer.paid')
          AND e.correlation_id IS NOT NULL
          AND e.correlation_id = w.stripe_transfer_id)

    UNION ALL
    -- (6) Stripe told us a payout failed.
    SELECT 'stripe_payout_failure', 'critical', 'bounty_event',
           e.id::text, e.bounty_id, e.actor_id, e.amount, e.occurred_at,
           'Stripe reported a failed payout or transfer.',
           e.metadata
    FROM public.bounty_events e
    WHERE e.event_type IN ('stripe.payout.failed', 'stripe.transfer.failed', 'payout.failed')

    UNION ALL
    -- (7) Withdrawal stuck in pending. Threshold: 72 hours.
    SELECT 'payout_pending_too_long', 'critical', 'wallet_transaction',
           w.id::text, NULL::uuid, w.user_id, ABS(w.amount), w.created_at,
           'Withdrawal has been pending for more than 72 hours.',
           jsonb_build_object('pending_hours', ROUND(EXTRACT(epoch FROM now() - w.created_at) / 3600.0)::int,
                              'stripe_transfer_id', w.stripe_transfer_id,
                              'stripe_payout_id', w.stripe_payout_id)
    FROM public.wallet_transactions w
    WHERE w.type::text = 'withdrawal'
      AND w.status::text = 'pending'
      AND w.created_at < now() - interval '72 hours'

    UNION ALL
    -- (8) Money still held against a bounty that is over and was never refunded.
    SELECT 'escrow_held_on_terminal_bounty', 'high', 'bounty',
           f.bounty_id::text, f.bounty_id, f.poster_id,
           f.escrow_amount - f.release_amount - f.refund_amount, f.created_at,
           'Bounty is cancelled/archived/deleted but escrow was never released or refunded.',
           jsonb_build_object('marketplace_status', f.marketplace_status,
                              'escrow_amount', f.escrow_amount,
                              'release_amount', f.release_amount,
                              'refund_amount', f.refund_amount)
    FROM public.admin_bounty_financial_state f
    WHERE f.marketplace_status IN ('cancelled', 'archived', 'deleted')
      AND f.escrow_amount - f.release_amount - f.refund_amount > 0

    UNION ALL
    -- (9) Escrowed amount does not match what the bounty says it is worth.
    SELECT 'escrow_amount_mismatch', 'high', 'bounty',
           f.bounty_id::text, f.bounty_id, f.poster_id, f.escrow_amount - f.amount, f.created_at,
           'Amount held in escrow does not match the bounty amount.',
           jsonb_build_object('bounty_amount', f.amount, 'escrow_amount', f.escrow_amount)
    FROM public.admin_bounty_financial_state f
    WHERE NOT f.is_for_honor
      AND f.escrow_amount > 0
      AND ABS(f.escrow_amount - COALESCE(f.amount, 0)) > 0.01

    UNION ALL
    -- (10) Webhook pipeline health. A backlog here means every number on this
    --      screen is behind reality, so it is reported as an anomaly, not a
    --      footnote.
    SELECT 'webhook_processing_failure', 'critical', 'stripe_event',
           s.stripe_event_id, NULL::uuid, NULL::uuid, NULL::numeric, s.created_at,
           'Stripe webhook failed processing and was never retried successfully.',
           jsonb_build_object('event_type', s.event_type, 'retry_count', s.retry_count,
                              'last_error', s.last_error)
    FROM public.stripe_events s
    WHERE s.status = 'failed'

    UNION ALL
    SELECT 'webhook_unprocessed', 'high', 'stripe_event',
           s.stripe_event_id, NULL::uuid, NULL::uuid, NULL::numeric, s.created_at,
           'Stripe webhook was received more than an hour ago and never finished processing.',
           jsonb_build_object('event_type', s.event_type, 'retry_count', s.retry_count)
    FROM public.stripe_events s
    WHERE COALESCE(s.processed, false) = false
      AND COALESCE(s.status, '') <> 'failed'
      AND s.created_at < now() - interval '1 hour'

    UNION ALL
    -- (11) The same money booked twice. Two completed ledger rows of the same
    --      type and amount against one bounty inside a minute is what a
    --      double-processed webhook looks like from the ledger side.
    SELECT 'duplicate_financial_record', 'critical', 'wallet_transaction',
           w2.id::text, w2.bounty_id, COALESCE(w2.user_id, w2.sender_id), ABS(w2.amount), w2.created_at,
           'A second identical ledger row was written for the same bounty within 60 seconds.',
           jsonb_build_object('type', w2.type, 'duplicate_of', w1.id, 'amount', ABS(w2.amount))
    FROM public.wallet_transactions w1
    JOIN public.wallet_transactions w2
      ON w2.bounty_id = w1.bounty_id
     AND w2.type = w1.type
     AND w2.amount = w1.amount
     AND w2.id <> w1.id
     AND w2.created_at > w1.created_at
     AND w2.created_at <= w1.created_at + interval '60 seconds'
    WHERE w1.bounty_id IS NOT NULL
      AND w1.status::text = 'completed'
      AND w2.status::text = 'completed'
  )
  SELECT f.anomaly_type, f.severity, f.entity_type, f.entity_id, f.bounty_id, f.user_id,
         f.amount, f.detected_at, f.summary, f.detail
  FROM findings f
  ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           f.detected_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspicious_listings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_suspicious_listings() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_suspicious_listings() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_suspicious_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_suspicious_applications() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_suspicious_applications() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_financial_anomalies(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_financial_anomalies(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_anomalies(integer) TO authenticated, service_role;

-- ============================================================================
-- 11. ACTIVITY FEED, BOUNTY DETAIL, LIFECYCLE TIMELINE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_activity_feed(
  p_limit     integer     DEFAULT 50,
  p_before    timestamptz DEFAULT NULL,
  p_before_id uuid        DEFAULT NULL,
  p_sources   text[]      DEFAULT NULL,
  p_types     text[]      DEFAULT NULL,
  p_bounty_id uuid        DEFAULT NULL,
  p_actor_id  uuid        DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  event_key      text,
  event_type     text,
  source         text,
  bounty_id      uuid,
  bounty_title   text,
  actor_id       uuid,
  actor_username text,
  amount         numeric,
  correlation_id text,
  occurred_at    timestamptz,
  metadata       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  SELECT e.id, e.event_key, e.event_type, e.source, e.bounty_id, b.title,
         e.actor_id, COALESCE(pr.username, pr.display_name), e.amount,
         e.correlation_id, e.occurred_at, e.metadata
  FROM public.bounty_events e
  LEFT JOIN public.bounties b ON b.id = e.bounty_id
  LEFT JOIN public.profiles pr ON pr.id = e.actor_id
  WHERE (p_bounty_id IS NULL OR e.bounty_id = p_bounty_id)
    AND (p_actor_id  IS NULL OR e.actor_id  = p_actor_id)
    AND (p_sources   IS NULL OR e.source     = ANY (p_sources))
    AND (p_types     IS NULL OR e.event_type = ANY (p_types))
    -- Keyset pagination: (occurred_at, id) strictly before the cursor, so a
    -- burst of events sharing a timestamp cannot repeat or skip a page.
    AND (p_before IS NULL
         OR e.occurred_at < p_before
         OR (e.occurred_at = p_before AND (p_before_id IS NULL OR e.id < p_before_id)))
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_activity_feed(integer, timestamptz, uuid, text[], text[], uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_activity_feed(integer, timestamptz, uuid, text[], text[], uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_feed(integer, timestamptz, uuid, text[], text[], uuid, uuid) TO authenticated, service_role;

-- One round trip for the whole bounty detail screen: the record, both people,
-- the applications, and -- separately labelled -- the marketplace and
-- financial status.
CREATE OR REPLACE FUNCTION public.admin_bounty_detail(p_bounty_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.admin_assert_role();

  SELECT jsonb_build_object(
    'bounty', jsonb_build_object(
      'id', b.id,
      'title', b.title,
      'description', b.description,
      'amount', b.amount,
      'is_for_honor', COALESCE(b.is_for_honor, false),
      'category', b.category,
      'location', b.location,
      'neighborhood', b.neighborhood,
      'zip_code', b.zip_code,
      'work_type', b.work_type,
      'created_at', b.created_at,
      'updated_at', b.updated_at,
      'deadline', b.deadline,
      'completed_at', b.completed_at,
      'is_stale', COALESCE(b.is_stale, false),
      'stale_reason', b.stale_reason,
      'payment_architecture_version', b.payment_architecture_version,
      'funding_mode', b.funding_mode
    ),
    'poster', (SELECT jsonb_build_object('id', p.id, 'username', COALESCE(p.username, p.display_name),
                                         'account_status', COALESCE(p.account_status, 'active'),
                                         'verification_status', p.verification_status,
                                         'risk_level', p.risk_level)
               FROM public.profiles p WHERE p.id = COALESCE(b.poster_id, b.user_id)),
    'hunter', (SELECT jsonb_build_object('id', p.id, 'username', COALESCE(p.username, p.display_name),
                                         'account_status', COALESCE(p.account_status, 'active'),
                                         'verification_status', p.verification_status,
                                         'risk_level', p.risk_level)
               FROM public.profiles p WHERE p.id = b.accepted_by),

    -- MARKETPLACE STATUS -- what the humans think happened.
    'marketplace', jsonb_build_object(
      'status', b.status,
      'applications', (SELECT count(*) FROM public.bounty_requests r WHERE r.bounty_id = b.id),
      'applications_pending', (SELECT count(*) FROM public.bounty_requests r
                                WHERE r.bounty_id = b.id AND r.status::text = 'pending'),
      'completion_submissions', (SELECT count(*) FROM public.completion_submissions c WHERE c.bounty_id = b.id)
    ),

    -- FINANCIAL STATUS -- what the money says, and whether Stripe agrees.
    'financial', (SELECT to_jsonb(f) FROM public.admin_bounty_financial_state f WHERE f.bounty_id = b.id),

    'moderation', jsonb_build_object(
      'reports', (SELECT count(*) FROM public.reports r
                   WHERE r.content_type = 'bounty' AND r.content_id = b.id),
      'reports_open', (SELECT count(*) FROM public.reports r
                        WHERE r.content_type = 'bounty' AND r.content_id = b.id
                          AND COALESCE(r.status, 'pending') = 'pending'),
      'disputes', (SELECT count(*) FROM public.bounty_disputes d WHERE d.bounty_id = b.id),
      'warnings', (SELECT count(*) FROM public.admin_warnings a WHERE a.bounty_id = b.id),
      'suspicious_reasons', COALESCE(
        (SELECT jsonb_agg(DISTINCT s.reason) FROM public.admin_suspicious_listings() s
          WHERE s.bounty_id = b.id), '[]'::jsonb)
    )
  ) INTO v
  FROM public.bounties b
  WHERE b.id = p_bounty_id;

  RETURN v;  -- NULL when no such bounty; the caller renders "not found".
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bounty_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bounty_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bounty_detail(uuid) TO authenticated, service_role;

-- The lifecycle timeline: the actual sequence, oldest first, each entry
-- carrying its provenance so the UI can label it APP EVENT / STRIPE EVENT /
-- WEBHOOK CONFIRMATION / INFERRED STATE.
CREATE OR REPLACE FUNCTION public.admin_bounty_timeline(p_bounty_id uuid, p_limit integer DEFAULT 300)
RETURNS TABLE (
  id             uuid,
  event_key      text,
  event_type     text,
  source         text,
  actor_id       uuid,
  actor_username text,
  amount         numeric,
  correlation_id text,
  occurred_at    timestamptz,
  metadata       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  SELECT e.id, e.event_key, e.event_type, e.source, e.actor_id,
         COALESCE(pr.username, pr.display_name), e.amount, e.correlation_id,
         e.occurred_at, e.metadata
  FROM public.bounty_events e
  LEFT JOIN public.profiles pr ON pr.id = e.actor_id
  WHERE e.bounty_id = p_bounty_id
  ORDER BY e.occurred_at ASC, e.id ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bounty_timeline(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bounty_timeline(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bounty_timeline(uuid, integer) TO authenticated, service_role;
