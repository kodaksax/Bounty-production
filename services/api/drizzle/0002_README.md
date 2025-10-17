Migration 0002_add_poster_hunter_fks.sql

Purpose:
- Add `poster_id` on `bounties` and `hunter_id` on `bounty_requests` (if missing).
- Backfill values from legacy `user_id` columns where present.
- Create FK constraints named `bounties_poster_id_fkey` and `bounty_requests_hunter_id_fkey` referencing `profiles(id)`.
- Create indexes to speed joins.

How to apply:
- Run this SQL in Supabase SQL editor or via psql connected to your DB.

Verify:
- Check FK constraint exists:
  SELECT conname FROM pg_constraint WHERE conname IN ('bounties_poster_id_fkey','bounty_requests_hunter_id_fkey');

- Verify a sample bounty:
  SELECT id, user_id, poster_id FROM bounties LIMIT 5;

- Verify indexes:
  SELECT indexname FROM pg_indexes WHERE tablename IN ('bounties','bounty_requests');
