-- 2026-03-20 02: Covering index for open feed queries
-- Speeds up: WHERE status = 'open' ORDER BY created_at DESC LIMIT N

CREATE INDEX IF NOT EXISTS idx_bounties_open_feed ON public.bounties (status, created_at DESC) INCLUDE (title, amount, category, poster_id);
