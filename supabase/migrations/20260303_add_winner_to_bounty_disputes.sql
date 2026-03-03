-- Add winner column to bounty_disputes to track dispute resolution outcome
-- Values: 'hunter' (release escrow to hunter) or 'poster' (refund escrow to poster)
ALTER TABLE bounty_disputes
  ADD COLUMN IF NOT EXISTS winner TEXT CHECK (winner IN ('hunter', 'poster'));
