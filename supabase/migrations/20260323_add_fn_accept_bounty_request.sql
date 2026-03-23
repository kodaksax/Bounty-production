-- Migration: create fn_accept_bounty_request
-- Creates a SECURITY DEFINER function to atomically accept a bounty request
-- Usage: SELECT * FROM public.fn_accept_bounty_request(p_request_id := '...');

CREATE OR REPLACE FUNCTION public.fn_accept_bounty_request(p_request_id text)
RETURNS TABLE(bounty json, accepted_request json)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  req_row RECORD;
  bounty_row RECORD;
  updated_bounty RECORD;
  updated_request RECORD;
BEGIN
  -- Lock the request row
  SELECT * INTO req_row FROM bounty_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req_row.status IS NULL OR req_row.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  -- Lock the bounty row
  SELECT * INTO bounty_row FROM bounties WHERE id = req_row.bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  IF bounty_row.status IS NULL OR bounty_row.status <> 'open' THEN
    RAISE EXCEPTION 'bounty_not_open';
  END IF;

  -- Perform atomic updates
  UPDATE bounties
  SET status = 'in_progress', accepted_request_id = p_request_id, accepted_by = req_row.hunter_id, updated_at = now()
  WHERE id = bounty_row.id;

  UPDATE bounty_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = p_request_id;

  -- Reject other pending requests for this bounty
  UPDATE bounty_requests
  SET status = 'rejected', updated_at = now()
  WHERE bounty_id = bounty_row.id AND id <> p_request_id AND status = 'pending';

  -- Read back authoritative rows
  SELECT * INTO updated_bounty FROM bounties WHERE id = bounty_row.id;
  SELECT * INTO updated_request FROM bounty_requests WHERE id = p_request_id;

  RETURN QUERY SELECT row_to_json(updated_bounty), row_to_json(updated_request);
EXCEPTION
  WHEN others THEN
    -- Bubble up the error to caller with context
    RAISE;
END;
$$;
