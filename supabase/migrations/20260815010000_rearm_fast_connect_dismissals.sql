-- Fast Connect dismissals were produced by modal lifecycle events rather than
-- deliberate user choices. Give those users another chance without changing
-- genuine, slower dismissals.
UPDATE public.user_activation_moments
SET status = 'pending',
    dismissed_at = NULL,
    snoozed_until = NULL
WHERE moment_type = 'stripe_connect_onboarding'
  AND status IN ('dismissed', 'snoozed')
  AND first_shown_at IS NOT NULL
  AND COALESCE(dismissed_at, updated_at) - first_shown_at < INTERVAL '2 seconds';