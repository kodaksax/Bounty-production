-- Region waitlist signups for users outside the current service area.

CREATE TABLE IF NOT EXISTS public.region_waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  country_code text NULL,
  region text NULL,
  source text NOT NULL DEFAULT 'mobile_onboarding',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_waitlist_signups_email_country
  ON public.region_waitlist_signups (email, country_code);

ALTER TABLE public.region_waitlist_signups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'region_waitlist_signups'
      AND policyname = 'region_waitlist_signups_insert_own_or_anonymous'
  ) THEN
    CREATE POLICY region_waitlist_signups_insert_own_or_anonymous
      ON public.region_waitlist_signups
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'region_waitlist_signups'
      AND policyname = 'region_waitlist_signups_select_own'
  ) THEN
    CREATE POLICY region_waitlist_signups_select_own
      ON public.region_waitlist_signups
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;
