# Supabase Migrations

This directory contains SQL migration files for the BOUNTYExpo database schema.

## Running Migrations

### Option 1: Supabase CLI (Recommended)
If you have the Supabase CLI installed:

```bash
# Link to your project (first time only)
supabase link --project-ref your-project-ref

# Apply all pending migrations
supabase db push
```

### Option 2: Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of the migration file
4. Execute the SQL

### Option 3: Direct Database Connection
If you have direct access to the PostgreSQL database:

```bash
psql -h your-db-host -U postgres -d postgres -f supabase/migrations/20251022_inprogress_flow.sql
```

## Migration: 20251022_inprogress_flow.sql

This migration adds support for the in-progress bounty management flow:

### Tables Created

1. **completion_ready** - Tracks when hunters mark bounties as "ready to submit"
   - `bounty_id` (uuid, PK)
   - `hunter_id` (uuid, PK)
   - `ready_at` (timestamptz)

2. **completion_submissions** - Stores hunter completion submissions with proof
   - `id` (uuid, PK)
   - `bounty_id` (uuid)
   - `hunter_id` (uuid)
   - `message` (text)
   - `proof_items` (jsonb) - Array of proof attachments
   - `status` (text) - 'pending', 'revision_requested', 'approved', 'rejected'
   - `poster_feedback` (text)
   - `submitted_at` (timestamptz)
   - `reviewed_at` (timestamptz)
   - `revision_count` (integer)

### Indexes Created

- `idx_completion_ready_bounty_id` - Fast lookups by bounty
- `idx_completion_submissions_bounty_id` - Fast lookups of submissions by bounty
- `idx_completion_submissions_hunter_id` - Fast lookups of submissions by hunter

### Optional Schema Updates

- Adds `accepted_by` column to `bounties` table if it doesn't exist

## Security Considerations

The migration includes commented-out Row Level Security (RLS) policy examples. **You should enable and customize these policies** based on your security requirements:

- Hunters should only access their own submissions
- Posters should only access submissions for their bounties
- Enforce proper authorization for status updates

## Testing the Migration

After running the migration, verify:

1. Tables exist:
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name IN ('completion_ready', 'completion_submissions');
   ```

2. Indexes are created:
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE tablename IN ('completion_ready', 'completion_submissions');
   ```

3. Test inserting sample data (then clean up):
   ```sql
   -- Insert test data
   INSERT INTO completion_ready (bounty_id, hunter_id) 
   VALUES (gen_random_uuid(), gen_random_uuid());
   
   -- Clean up test
   DELETE FROM completion_ready WHERE bounty_id NOT IN (SELECT id FROM bounties);
   ```

## Rollback

If you need to rollback this migration:

```sql
-- Drop tables and indexes
DROP TABLE IF EXISTS public.completion_submissions;
DROP TABLE IF EXISTS public.completion_ready;

-- Optionally remove accepted_by column from bounties
-- ALTER TABLE public.bounties DROP COLUMN IF EXISTS accepted_by;
```

## Migration: 20251119_add_bounty_requests_table.sql

This migration adds the bounty_requests table that tracks hunter applications for bounties.

### Tables Created

1. **bounty_requests** - Stores applications from hunters to bounties
   - `id` (uuid, PK)
   - `bounty_id` (uuid, FK to bounties)
   - `hunter_id` (uuid, FK to profiles) - The applicant
   - `poster_id` (uuid, FK to profiles) - Denormalized for faster queries
   - `status` (request_status_enum) - 'pending', 'accepted', 'rejected'
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

### Indexes Created

- `idx_bounty_requests_bounty_id` - Fast lookups by bounty
- `idx_bounty_requests_hunter_id` - Fast lookups by hunter
- `idx_bounty_requests_poster_id` - Fast lookups by poster
- `idx_bounty_requests_status` - Fast lookups by status

### Row Level Security (RLS)

The migration includes comprehensive RLS policies:
- Posters can view and update requests for their bounties
- Hunters can view and create their own applications
- Hunters can delete their own pending applications
- Posters can delete requests for their bounties

### Related Files

This migration supports the bounty acceptance flow:
- `lib/services/bounty-request-service.ts` - Service layer for applications
- `components/bountydetailmodal.tsx` - Apply button functionality
- `components/applicant-card.tsx` - Request card UI
- `app/tabs/postings-screen.tsx` - Request list and accept/reject handlers

---

## Related Files (Completion Flow)

The completion migration supports the following code changes:
- `lib/services/completion-service.ts` - Service layer for completion operations
- `components/my-posting-expandable.tsx` - UI for bounty progress tracking
- `components/poster-review-modal.tsx` - UI for poster review actions
- `app/tabs/postings-screen.tsx` - List views with refresh support
