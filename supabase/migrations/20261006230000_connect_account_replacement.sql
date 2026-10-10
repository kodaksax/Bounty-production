-- Financial HTTP calls cannot hold a PostgREST transaction open while awaiting
-- Stripe. Persist reservations under the same profile lock as replacement.
-- These are intentionally NOT expiring leases. Uncertain calls need evidence
-- and manual reconciliation, never an automatic unlock.
CREATE TABLE public.connect_account_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id text,
  kind text NOT NULL CHECK (kind IN (
    'account_creation', 'native_payout', 'legacy_withdrawal', 'legacy_instant',
    'withdrawal_retry', 'admin_retry', 'bounty_release_v2', 'bounty_release_v3', 'admin_reversal'
  )),
  operation_key text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'finished')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (account_id IS NOT NULL OR kind = 'account_creation')
);
CREATE UNIQUE INDEX connect_account_one_active_operation
  ON public.connect_account_operations(user_id) WHERE state = 'active';

CREATE TABLE public.connect_account_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  old_account_id text NOT NULL,
  candidate_account_id text,
  country text NOT NULL,
  email text,
  manual_payouts boolean NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX connect_account_one_pending_replacement
  ON public.connect_account_replacements(user_id) WHERE state = 'pending';

ALTER TABLE public.connect_account_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_account_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_account_operations, public.connect_account_replacements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.connect_account_operations, public.connect_account_replacements TO service_role;

CREATE FUNCTION public.reserve_connect_account_operation(
  p_user_id uuid, p_account_id text, p_kind text, p_operation_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account text; v_id uuid;
BEGIN
  SELECT stripe_connect_account_id INTO v_account FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR (p_account_id IS NULL AND NOT (p_kind = 'account_creation' AND v_account IS NULL)) OR (
    v_account IS DISTINCT FROM p_account_id AND NOT (
      p_kind = 'admin_reversal' AND EXISTS (
        SELECT 1 FROM connect_account_replacements
        WHERE user_id = p_user_id AND old_account_id = p_account_id AND state = 'completed'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Payout account changed; refresh before retrying';
  END IF;
  IF EXISTS (SELECT 1 FROM connect_account_replacements WHERE user_id = p_user_id AND state = 'pending') THEN
    RAISE EXCEPTION 'Account replacement in progress; resume or cancel it first';
  END IF;
  IF p_kind IN ('native_payout', 'legacy_withdrawal', 'legacy_instant', 'withdrawal_retry', 'admin_retry')
    AND EXISTS (SELECT 1 FROM wallet_transactions WHERE user_id = p_user_id
      AND type = 'withdrawal' AND status = 'pending') THEN
    RAISE EXCEPTION 'A withdrawal is still settling; wait before starting another';
  END IF;
  INSERT INTO connect_account_operations(user_id, account_id, kind, operation_key)
    VALUES (p_user_id, p_account_id, p_kind, p_operation_key) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.finish_connect_account_operation(p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM connect_account_operations WHERE id = p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account operation not found'; END IF;
  PERFORM 1 FROM profiles WHERE id = v_user FOR UPDATE;
  UPDATE connect_account_operations SET state = 'finished', finished_at = now()
    WHERE id = p_operation_id AND state = 'active';
END;
$$;

CREATE FUNCTION public.assert_connect_replacement_safe(p_user_id uuid, p_account_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM connect_account_operations WHERE user_id = p_user_id AND state = 'active') THEN
    RAISE EXCEPTION 'A financial operation is in progress or requires reconciliation; contact support if it persists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE user_id = p_user_id AND type = 'withdrawal' AND (
      status = 'pending'
      OR (status = 'completed' AND (stripe_payout_id IS NULL OR stripe_payout_status IS DISTINCT FROM 'paid'))
      OR COALESCE(metadata->>'manual_reconciliation_required', 'false') = 'true'
      OR metadata ? 'payout_creation_failed'
      OR (status = 'failed' AND stripe_transfer_id IS NOT NULL AND stripe_payout_id IS NULL)
      OR (status = 'failed' AND stripe_payout_id IS NOT NULL
        AND (stripe_payout_status IS NULL OR stripe_payout_status NOT IN ('failed', 'canceled')))
    )
  ) OR EXISTS (
    SELECT 1 FROM reconciliation_findings
    WHERE resolved_at IS NULL AND severity IN ('warning', 'critical') AND (
      user_id = p_user_id OR details->>'accountId' = p_account_id
      OR details->>'stripe_account_id' = p_account_id
    )
  ) THEN
    RAISE EXCEPTION 'Unresolved withdrawals or reconciliation findings must be settled before replacement';
  END IF;
  -- Do not retarget a previously attempted release's Stripe idempotency key.
  IF EXISTS (SELECT 1 FROM bounty_payments WHERE hunter_id = p_user_id
      AND status NOT IN ('released', 'refunded', 'canceled'))
    OR EXISTS (SELECT 1 FROM bounty_v3_funding WHERE hunter_id = p_user_id
      AND state NOT IN ('released', 'canceled', 'expired'))
  THEN
    RAISE EXCEPTION 'Finish or resolve funded bounties before replacing the payout account';
  END IF;
END;
$$;

CREATE FUNCTION public.begin_connect_account_replacement(
  p_user_id uuid, p_account_id text, p_country text, p_manual_payouts boolean
) RETURNS public.connect_account_replacements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles; v_row public.connect_account_replacements;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.stripe_connect_account_id IS NULL THEN
    RAISE EXCEPTION 'No existing payout account to replace';
  END IF;
  SELECT * INTO v_row FROM connect_account_replacements
    WHERE user_id = p_user_id AND state = 'pending';
  IF FOUND THEN RETURN v_row; END IF;
  SELECT * INTO v_row FROM connect_account_replacements
    WHERE user_id = p_user_id AND state = 'completed'
      AND candidate_account_id = v_profile.stripe_connect_account_id
      AND v_profile.stripe_connect_onboarded_at IS NULL
    ORDER BY completed_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  IF v_profile.stripe_connect_account_id IS DISTINCT FROM p_account_id
    OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Payout account changed or country unavailable';
  END IF;
  PERFORM assert_connect_replacement_safe(p_user_id, v_profile.stripe_connect_account_id);
  INSERT INTO connect_account_replacements(user_id, old_account_id, country, email, manual_payouts)
    VALUES (p_user_id, v_profile.stripe_connect_account_id, p_country, v_profile.email, p_manual_payouts)
    RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.complete_connect_account_replacement(
  p_user_id uuid, p_replacement_id uuid, p_candidate_account_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account text; v_row public.connect_account_replacements; v_legacy_column text;
BEGIN
  SELECT stripe_connect_account_id INTO v_account FROM profiles WHERE id = p_user_id FOR UPDATE;
  SELECT * INTO v_row FROM connect_account_replacements
    WHERE id = p_replacement_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement not found'; END IF;
  IF v_row.state = 'completed' AND v_account = v_row.candidate_account_id THEN RETURN v_account; END IF;
  IF v_row.state <> 'pending' OR v_account IS DISTINCT FROM v_row.old_account_id
    OR v_row.candidate_account_id IS DISTINCT FROM p_candidate_account_id
    OR p_candidate_account_id IS NULL OR p_candidate_account_id = v_account
  THEN RAISE EXCEPTION 'Replacement canceled or payout account changed'; END IF;
  PERFORM assert_connect_replacement_safe(p_user_id, v_account);
  UPDATE connect_account_replacements SET state = 'completed', completed_at = now()
    WHERE id = v_row.id;
  UPDATE profiles SET
    stripe_connect_account_id = p_candidate_account_id,
    stripe_connect_onboarded_at = NULL,
    stripe_connect_charges_enabled = false,
    stripe_connect_payouts_enabled = false,
    stripe_connect_onboarding_complete = false,
    stripe_connect_requirements = NULL,
    payout_failed_at = NULL,
    payout_failure_code = NULL
  WHERE id = p_user_id AND stripe_connect_account_id = v_row.old_account_id;
  -- Older deployments also cached unprefixed Connect flags. Reset aliases
  -- when present without requiring those obsolete columns on fresh schemas.
  FOREACH v_legacy_column IN ARRAY ARRAY['charges_enabled', 'payouts_enabled', 'details_submitted'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'profiles' AND column_name = v_legacy_column) THEN
      EXECUTE format('UPDATE public.profiles SET %I = false WHERE id = $1', v_legacy_column)
        USING p_user_id;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'profiles' AND column_name = 'disabled_reason') THEN
    UPDATE public.profiles SET disabled_reason = NULL WHERE id = p_user_id;
  END IF;
  DELETE FROM connect_balance_cache WHERE user_id = p_user_id;
  RETURN p_candidate_account_id;
END;
$$;

CREATE FUNCTION public.cancel_connect_account_replacement(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM profiles WHERE id = p_user_id FOR UPDATE;
  UPDATE connect_account_replacements SET state = 'canceled'
    WHERE user_id = p_user_id AND state = 'pending';
END;
$$;

-- Defense in depth for every service/client profile writer, not just the
-- onboarding handlers. Only initial NULL -> account or the recorded atomic
-- replacement may change identity. Never rewrite historical financial rows.
CREATE FUNCTION public.guard_connect_account_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stripe_connect_account_id IS NOT DISTINCT FROM NEW.stripe_connect_account_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM connect_account_operations WHERE user_id = OLD.id AND state = 'active'
      AND NOT (OLD.stripe_connect_account_id IS NULL AND kind = 'account_creation'))
    OR EXISTS (SELECT 1 FROM connect_account_replacements WHERE user_id = OLD.id AND state = 'pending')
  THEN RAISE EXCEPTION 'Account identity is reserved'; END IF;
  IF OLD.stripe_connect_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM connect_account_replacements
    WHERE user_id = OLD.id AND old_account_id = OLD.stripe_connect_account_id
      AND candidate_account_id = NEW.stripe_connect_account_id AND state = 'completed'
  ) THEN RAISE EXCEPTION 'Use the confirmed account replacement workflow'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_connect_account_identity BEFORE UPDATE OF stripe_connect_account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_connect_account_identity();

CREATE FUNCTION public.guard_withdrawal_account_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.type = 'withdrawal'
    AND OLD.stripe_connect_account_id IS DISTINCT FROM NEW.stripe_connect_account_id
  THEN RAISE EXCEPTION 'Historical withdrawal payout account cannot be changed'; END IF;

  IF NEW.type = 'withdrawal' AND NEW.status = 'pending'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT stripe_connect_account_id INTO v_account FROM profiles WHERE id = NEW.user_id FOR UPDATE;
    IF (NEW.stripe_connect_account_id IS NOT NULL AND NEW.stripe_connect_account_id IS DISTINCT FROM v_account)
      OR (NEW.stripe_connect_account_id IS NULL AND EXISTS (
        SELECT 1 FROM connect_account_replacements WHERE user_id = NEW.user_id AND state = 'completed'
      ))
      OR EXISTS (SELECT 1 FROM connect_account_replacements WHERE user_id = NEW.user_id AND state = 'pending')
    THEN RAISE EXCEPTION 'Payout account changed or replacement is in progress'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_withdrawal_account_identity BEFORE INSERT OR UPDATE OF status, stripe_connect_account_id ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_account_identity();

REVOKE ALL ON FUNCTION public.reserve_connect_account_operation(uuid,text,text,text),
  public.finish_connect_account_operation(uuid), public.assert_connect_replacement_safe(uuid,text),
  public.begin_connect_account_replacement(uuid,text,text,boolean), public.complete_connect_account_replacement(uuid,uuid,text),
  public.cancel_connect_account_replacement(uuid), public.guard_connect_account_identity(),
  public.guard_withdrawal_account_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_connect_account_operation(uuid,text,text,text),
  public.finish_connect_account_operation(uuid), public.assert_connect_replacement_safe(uuid,text),
  public.begin_connect_account_replacement(uuid,text,text,boolean), public.complete_connect_account_replacement(uuid,uuid,text),
  public.cancel_connect_account_replacement(uuid) TO service_role;
