-- Create a SECURITY DEFINER function that allows an authenticated user to
-- insert a notification for ANY user_id (e.g. to notify the other party in a
-- dispute). Because it runs as the function owner (postgres/service role) it
-- bypasses the RLS `notifications_insert_own` policy which only allows
-- `auth.uid() = user_id`.
--
-- Security notes:
--  - REVOKE from PUBLIC then GRANT only to `authenticated` ensures anonymous
--    callers cannot invoke it.
--  - The p_type parameter is validated against an allowed list so callers
--    cannot inject arbitrary notification types.

CREATE OR REPLACE FUNCTION public.send_system_notification(
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_data     JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow known system notification types so this function cannot be
  -- abused to spam arbitrary notifications.
  IF p_type NOT IN (
    'dispute_created',
    'dispute_resolved',
    'dispute_escalated',
    'workflow_dispute_created'
  ) THEN
    RAISE EXCEPTION 'Unsupported notification type: %', p_type;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, read)
  VALUES (p_user_id, p_type, p_title, p_body, p_data, false);
END;
$$;

-- Lock down the function: revoke from PUBLIC first, then re-grant only to
-- authenticated users.
REVOKE ALL ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
