-- Atomically update a bounty and create its cancellation record.
-- The expected status prevents a concurrent request from overwriting a newer
-- status after the first request has already acquired the bounty row lock.
CREATE OR REPLACE FUNCTION public.create_bounty_cancellation(
  p_bounty_id UUID,
  p_expected_status TEXT,
  p_target_status TEXT,
  p_requester_id UUID,
  p_requester_type TEXT,
  p_reason TEXT,
  p_status TEXT,
  p_refund_percentage NUMERIC,
  p_refund_amount NUMERIC,
  p_response_message TEXT,
  p_resolved_at TIMESTAMPTZ
) RETURNS SETOF public.bounty_cancellations
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.bounties
  SET status = p_target_status
  WHERE id = p_bounty_id
    AND status = p_expected_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bounty status changed before cancellation could be created'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
    INSERT INTO public.bounty_cancellations (
      bounty_id,
      requester_id,
      requester_type,
      reason,
      status,
      refund_percentage,
      refund_amount,
      response_message,
      resolved_at
    )
    VALUES (
      p_bounty_id,
      p_requester_id,
      p_requester_type,
      p_reason,
      p_status,
      p_refund_percentage,
      p_refund_amount,
      p_response_message,
      p_resolved_at
    )
    RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bounty_cancellation(
  UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ
) TO authenticated;
