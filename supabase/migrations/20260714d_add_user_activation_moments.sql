-- Migration: Add user_activation_moments table for the Moments Queue framework
-- Created: 2026-07-14
-- Purpose: Persists per-user, per-moment-type activation state (shown,
--          dismissed, completed, snoozed) server-side so contextual
--          activation prompts (identity verification, Stripe Connect
--          payouts, enable notifications, etc.) behave consistently across
--          devices and app restarts, respect cooldowns, and don't repeat
--          after completion or dismissal. Moment *definitions* (priority,
--          eligibility rules, copy) live in application code
--          (lib/moments/registry.ts) — this table only tracks state, so new
--          moment types never require a schema change.

CREATE TABLE IF NOT EXISTS public.user_activation_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  moment_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shown', 'dismissed', 'completed', 'expired', 'snoozed')),
  shown_count INTEGER NOT NULL DEFAULT 0,
  first_shown_at TIMESTAMPTZ,
  last_shown_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  -- Free-form per-moment context, e.g. which variant/copy was shown, for
  -- analytics correlation or future experimentation. Never load-bearing for
  -- eligibility — the row's typed columns above are.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, moment_type)
);

CREATE INDEX IF NOT EXISTS idx_user_activation_moments_user
  ON public.user_activation_moments (user_id);

CREATE OR REPLACE FUNCTION set_user_activation_moments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_activation_moments_updated_at ON public.user_activation_moments;
CREATE TRIGGER trg_user_activation_moments_updated_at
  BEFORE UPDATE ON public.user_activation_moments
  FOR EACH ROW
  EXECUTE FUNCTION set_user_activation_moments_updated_at();

ALTER TABLE public.user_activation_moments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own moment state" ON public.user_activation_moments;
CREATE POLICY "Users can view own moment state"
  ON public.user_activation_moments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own moment state" ON public.user_activation_moments;
CREATE POLICY "Users can insert own moment state"
  ON public.user_activation_moments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own moment state" ON public.user_activation_moments;
CREATE POLICY "Users can update own moment state"
  ON public.user_activation_moments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.user_activation_moments IS
  'Per-user state for the Moments Queue activation framework. One row per (user_id, moment_type). Moment definitions/eligibility live in app code, not this table.';
