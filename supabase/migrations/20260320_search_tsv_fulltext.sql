-- 2026-03-20 04: Add materialized tsvector column, GIN index, and trigger for full-text search
-- Uses English configuration. Adjust locale as needed.

ALTER TABLE public.bounties ADD COLUMN IF NOT EXISTS search_tsv tsvector;

-- Populate existing rows
UPDATE public.bounties
SET search_tsv = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
WHERE search_tsv IS NULL;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_bounties_search_tsv_gin ON public.bounties USING GIN (search_tsv);

-- Trigger function to keep search_tsv up-to-date
CREATE OR REPLACE FUNCTION public.bounties_search_tsv_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.title,'') || ' ' || coalesce(NEW.description,''));
  RETURN NEW;
END
$$;

-- Create trigger
DROP TRIGGER IF EXISTS tsvectorupdate ON public.bounties;
CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE ON public.bounties
FOR EACH ROW EXECUTE PROCEDURE public.bounties_search_tsv_trigger();
