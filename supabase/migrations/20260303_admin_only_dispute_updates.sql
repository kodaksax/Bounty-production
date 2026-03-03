-- Enable RLS on bounty_disputes and restrict updates to admin users only
-- This prevents non-admin authenticated users from resolving/updating disputes

ALTER TABLE bounty_disputes ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read disputes they are involved in
CREATE POLICY "Users can view disputes they are involved in"
ON bounty_disputes
FOR SELECT
USING (
  initiator_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM bounties b
    WHERE b.id = bounty_disputes.bounty_id
    AND (b.creator_id = auth.uid() OR b.hunter_id = auth.uid())
  )
);

-- Allow admins to view all disputes
CREATE POLICY "Admins can view all disputes"
ON bounty_disputes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Allow authenticated users to create disputes for bounties/cancellations they are party to
CREATE POLICY "Users can create disputes"
ON bounty_disputes
FOR INSERT
WITH CHECK (
  initiator_id = auth.uid()
  AND (
    EXISTS (
      SELECT 1
      FROM bounties b
      WHERE b.id = bounty_disputes.bounty_id
      AND (b.creator_id = auth.uid() OR b.hunter_id = auth.uid())
    )
    OR
    EXISTS (
      SELECT 1
      FROM bounty_cancellations bc
      WHERE bc.id = bounty_disputes.cancellation_id
      AND (
        bc.requester_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM bounties b2
          WHERE b2.id = bc.bounty_id
          AND (b2.creator_id = auth.uid() OR b2.hunter_id = auth.uid())
        )
      )
    )
  )
);

-- Only admins can update disputes (status changes, resolution, etc.)
CREATE POLICY "Only admins can update disputes"
ON bounty_disputes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);
