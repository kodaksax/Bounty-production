-- Adds a lightweight session-activity timestamp to profiles, used by the
-- Moments Queue's inactive_user_return moment (and future lifecycle
-- campaigns: welcome-back, new-opportunities-nearby, unclaimed-earnings,
-- seasonal re-engagement) to compute "days since last seen" without needing
-- a full session-history table. Written by providers/moments-provider.tsx,
-- throttled client-side to avoid write-storms from frequent foreground events.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_session_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_session_at IS
  'Last time the user was observed active in the app (throttled, not exact). Used for inactivity-based activation moments.';
