-- ============================================================================
-- Baseline Schema Migration
-- Date: 2025-10-01
-- Purpose: Creates all foundational tables that subsequent migrations depend on.
--          These tables were originally created directly in the Supabase dashboard
--          for the production environment. This migration captures that schema so
--          that new branches (preview, development) start from the same foundation.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================================================
-- PROFILES TABLE
-- Core user profile data. References auth.users (managed by Supabase Auth).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT UNIQUE NOT NULL,
  email        TEXT,
  name         TEXT,
  display_name TEXT,
  avatar       TEXT,
  bio          TEXT,
  location     TEXT,
  portfolio    TEXT,
  title        TEXT,
  languages    TEXT[],
  skills       TEXT[],
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
  balance      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Non-negative balance enforcement (idempotent guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'check_balance_non_negative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0);
  END IF;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username  ON public.profiles (username);
CREATE INDEX IF NOT EXISTS idx_profiles_email     ON public.profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_role      ON public.profiles (role);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- BOUNTIES TABLE
-- The core marketplace listing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bounties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  hunter_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  amount          NUMERIC(12, 2),
  is_for_honor    BOOLEAN NOT NULL DEFAULT false,
  location        TEXT,
  timeline        TEXT,
  skills_required TEXT,
  category        TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed', 'archived', 'cancelled')),
  is_stale        BOOLEAN NOT NULL DEFAULT false,
  deadline        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bounties_user_id      ON public.bounties (user_id);
CREATE INDEX IF NOT EXISTS idx_bounties_hunter_id    ON public.bounties (hunter_id) WHERE hunter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bounties_status       ON public.bounties (status);
CREATE INDEX IF NOT EXISTS idx_bounties_created_at   ON public.bounties (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounties_is_stale     ON public.bounties (is_stale) WHERE is_stale = true;
CREATE INDEX IF NOT EXISTS idx_bounties_deadline     ON public.bounties (deadline) WHERE deadline IS NOT NULL;

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_bounties_updated_at ON public.bounties;
CREATE TRIGGER trg_bounties_updated_at
  BEFORE UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.bounties ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- WALLET TRANSACTIONS TABLE
-- Financial audit trail; preserves records even after user deletion (SET NULL).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  bounty_id   UUID REFERENCES public.bounties(id) ON DELETE SET NULL,
  type        TEXT NOT NULL
                CHECK (type IN ('escrow', 'release', 'refund', 'deposit', 'withdrawal')),
  amount      NUMERIC(12, 2) NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id_created_at
  ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_bounty_id
  ON public.wallet_transactions (bounty_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type
  ON public.wallet_transactions (type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status
  ON public.wallet_transactions (status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id_type
  ON public.wallet_transactions (user_id, type);

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_updated_at
  BEFORE UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- NOTIFICATIONS TABLE
-- In-app notification inbox per user.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT,
  body       TEXT,
  data       JSONB,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read
  ON public.notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON public.notifications (type);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- NOTIFICATION PREFERENCES TABLE
-- Per-user channel opt-in/opt-out settings.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_enabled    BOOLEAN NOT NULL DEFAULT true,
  push_enabled     BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled   BOOLEAN NOT NULL DEFAULT true,
  sms_enabled      BOOLEAN NOT NULL DEFAULT false,
  -- Granular type toggles (null = inherit channel default)
  messages         BOOLEAN,
  applications     BOOLEAN,
  acceptances      BOOLEAN,
  completions      BOOLEAN,
  payments         BOOLEAN,
  disputes         BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SKILLS TABLE
-- User-defined skill tags (CASCADE-deleted when user is deleted).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.skills (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  level      TEXT CHECK (level IN ('beginner', 'intermediate', 'expert')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_user_id ON public.skills (user_id);

-- RLS
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- REPORTS TABLE
-- User-generated abuse/spam reports. Preserve records even if reporter is deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  bounty_id        UUID REFERENCES public.bounties(id) ON DELETE SET NULL,
  reason           TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_user_id          ON public.reports (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON public.reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status           ON public.reports (status);

-- RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- BLOCKED USERS TABLE
-- Bilateral block relationships; cascade-deleted when either user is deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker_id ON public.blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_id ON public.blocked_users (blocked_id);

-- RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- USER FOLLOWS TABLE
-- Follower/following relationship between users.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id  ON public.user_follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following_id ON public.user_follows (following_id);

-- RLS
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STORAGE BUCKETS (idempotent — ON CONFLICT DO NOTHING)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('Profilepictures', 'Profilepictures', true)
ON CONFLICT (id) DO NOTHING;
