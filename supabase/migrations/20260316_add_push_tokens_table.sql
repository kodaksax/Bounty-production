-- Migration: Add push_tokens table for storing Expo/FCM push tokens
-- Adds columns for platform, device_id, enabled flag, failure tracking, and RLS policies.

-- Create table
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  device_id text NULL,
  platform text NULL,
  enabled boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  last_failed_at timestamptz NULL,
  details text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constraints & Indexes
-- Ensure token uniqueness globally to prevent duplicate assignment
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token_unique ON public.push_tokens (token);

-- Also index by profile for fast lookups (guarded)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'profile_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_push_tokens_profile_id ON public.push_tokens (profile_id)';
  END IF;
END;
$$;

-- Index on device_id for devices queries (sparse, guarded)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'device_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_push_tokens_device_id ON public.push_tokens (device_id) WHERE device_id IS NOT NULL';
  END IF;
END;
$$;

-- Trigger to maintain updated_at
CREATE OR REPLACE FUNCTION public.refresh_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON public.push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.refresh_updated_at();

-- Enable Row Level Security
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Policies: create them only if the `profile_id` column exists and policy doesn't already exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'profile_id'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'Users can view their own push tokens') THEN
      EXECUTE $pol$CREATE POLICY "Users can view their own push tokens"
        ON public.push_tokens FOR SELECT
        USING (auth.uid()::uuid = profile_id);$pol$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'Users can insert their own push tokens') THEN
      EXECUTE $pol$CREATE POLICY "Users can insert their own push tokens"
        ON public.push_tokens FOR INSERT
        WITH CHECK (auth.uid()::uuid = profile_id);$pol$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'Users can update their own push tokens') THEN
      EXECUTE $pol$CREATE POLICY "Users can update their own push tokens"
        ON public.push_tokens FOR UPDATE
        USING (auth.uid()::uuid = profile_id);$pol$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'Users can delete their own push tokens') THEN
      EXECUTE $pol$CREATE POLICY "Users can delete their own push tokens"
        ON public.push_tokens FOR DELETE
        USING (auth.uid()::uuid = profile_id);$pol$;
    END IF;
  END IF;
END;
$$;

-- Helpful partial index for common enabled lookups by profile (speeds fetch of active tokens, guarded)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'profile_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_push_tokens_profile_enabled ON public.push_tokens (profile_id) WHERE enabled = true';
  END IF;
END;
$$;

-- Notes:
-- - Uses gen_random_uuid() (pgcrypto) which is enabled in this project migrations elsewhere.
-- - The server code expects `profile_id` column name; adapt code if you prefer `user_id`.
