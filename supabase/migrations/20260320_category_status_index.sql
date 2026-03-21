-- 2026-03-20 03: Index for category + status filters
-- Speeds up: WHERE category = X AND status = 'open' ORDER BY created_at DESC

CREATE INDEX IF NOT EXISTS idx_bounties_category_status ON public.bounties (category, status, created_at DESC) WHERE category IS NOT NULL;
