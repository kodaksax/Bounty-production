-- update_balance SQL Function
-- Purpose: Perform atomic balance updates at the database level
-- This function is used by the consolidated wallet service for high-performance updates

CREATE OR REPLACE FUNCTION update_balance(
  p_user_id UUID,
  p_amount NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  -- Update the balance in profiles table
  -- We use a single UPDATE statement with a WHERE clause for atomicity
  UPDATE profiles
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  -- Check if user exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  -- Enforce non-negative balance constraint
  -- (Though we should also have a DB-level constraint, this provides immediate feedback)
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance USING ERRCODE = '23514';
  END IF;

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION update_balance(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION update_balance(UUID, NUMERIC) TO service_role;

COMMENT ON FUNCTION update_balance IS 'Atomically updates a user balance and returns the new value. Enforces non-negative balance.';
