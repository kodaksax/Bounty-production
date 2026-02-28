# Supabase Setup Guide for Bounty Completion Flow

## Quick Answer

Before merging this PR, you need to run the migration file to add **2 new tables** and their indexes to your Supabase database:

1. **`completion_ready`** - Tracks when hunters mark bounties as ready
2. **`completion_submissions`** - Stores completion submissions with proof

## How to Apply the Migration

### Option 1: Supabase Dashboard (Easiest)

1. Open your Supabase project at https://app.supabase.com
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the contents of `supabase/migrations/20251022_inprogress_flow.sql`
5. Paste into the SQL editor
6. Click **Run** or press `Ctrl+Enter`

### Option 2: Supabase CLI

```bash
# If not already linked
supabase link --project-ref your-project-ref

# Apply the migration
supabase db push
```

### Option 3: Direct psql Connection

```bash
psql -h your-db-host -U postgres -d postgres -f supabase/migrations/20251022_inprogress_flow.sql
```

---

## What Gets Created

### Tables

#### 1. completion_ready
```sql
CREATE TABLE public.completion_ready (
  bounty_id uuid NOT NULL,
  hunter_id uuid NOT NULL,
  ready_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, hunter_id)
);
```
**Purpose**: When a hunter clicks "Ready to Submit", this table stores that signal.

#### 2. completion_submissions
```sql
CREATE TABLE public.completion_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL,
  hunter_id uuid NOT NULL,
  message text,
  proof_items jsonb,
  status text CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected')),
  poster_feedback text,
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  revision_count integer DEFAULT 0
);
```
**Purpose**: Stores the actual completion submissions with proof items, status, and poster feedback.

### Indexes (for Performance)

```sql
-- Fast lookup of ready status by bounty
CREATE INDEX idx_completion_ready_bounty_id 
  ON public.completion_ready(bounty_id, ready_at DESC);

-- Fast lookup of submissions by bounty
CREATE INDEX idx_completion_submissions_bounty_id 
  ON public.completion_submissions(bounty_id, submitted_at DESC);

-- Fast lookup of submissions by hunter
CREATE INDEX idx_completion_submissions_hunter_id 
  ON public.completion_submissions(hunter_id, submitted_at DESC);
```

### Optional: accepted_by Column

The migration also adds an `accepted_by` column to the `bounties` table if it doesn't already exist:

```sql
ALTER TABLE public.bounties ADD COLUMN accepted_by uuid;
```
**Purpose**: Tracks which hunter was accepted for each bounty.

---

## Permissions

The migration grants these basic permissions:

```sql
-- Read access for authenticated users
GRANT SELECT ON public.completion_ready TO authenticated;
GRANT SELECT ON public.completion_submissions TO authenticated;

-- Write access for hunters
GRANT INSERT, UPDATE ON public.completion_ready TO authenticated;
GRANT INSERT ON public.completion_submissions TO authenticated;

-- Update access for posters (to approve/request revisions)
GRANT UPDATE ON public.completion_submissions TO authenticated;
```

---

## Security Policies (IMPORTANT!)

⚠️ **The migration includes commented-out RLS policies that you should enable and customize.**

### Why RLS Policies Matter

Without Row Level Security (RLS) policies, authenticated users could:
- View all submissions (not just their own)
- Modify submissions they shouldn't have access to
- Mark bounties ready that aren't assigned to them

### Recommended RLS Policies

The migration file includes examples starting at line 75. Here's what you should enable:

#### For completion_submissions table:

```sql
-- Enable RLS
ALTER TABLE public.completion_submissions ENABLE ROW LEVEL SECURITY;

-- Hunters can view their own submissions
CREATE POLICY "Users can view their own submissions" ON public.completion_submissions
  FOR SELECT
  USING (auth.uid() = hunter_id);

-- Posters can view submissions for their bounties
CREATE POLICY "Posters can view submissions for their bounties" ON public.completion_submissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = completion_submissions.bounty_id 
      AND bounties.poster_id = auth.uid()
    )
  );

-- Hunters can insert their own submissions
CREATE POLICY "Hunters can insert their own submissions" ON public.completion_submissions
  FOR INSERT
  WITH CHECK (auth.uid() = hunter_id);

-- Posters can update submissions for their bounties
CREATE POLICY "Posters can update submissions for their bounties" ON public.completion_submissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = completion_submissions.bounty_id 
      AND bounties.poster_id = auth.uid()
    )
  );
```

#### For completion_ready table:

```sql
ALTER TABLE public.completion_ready ENABLE ROW LEVEL SECURITY;

-- Hunters can manage their own ready markers
CREATE POLICY "Hunters can manage ready markers" ON public.completion_ready
  FOR ALL
  USING (auth.uid() = hunter_id);

-- Posters can view ready markers for their bounties
CREATE POLICY "Posters can view ready markers" ON public.completion_ready
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = completion_ready.bounty_id 
      AND bounties.poster_id = auth.uid()
    )
  );
```

---

## Verification Steps

After running the migration, verify everything is set up correctly:

### 1. Check Tables Exist

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('completion_ready', 'completion_submissions');
```

**Expected Output**: Should return 2 rows

### 2. Check Indexes Exist

```sql
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('completion_ready', 'completion_submissions');
```

**Expected Output**: Should return 3 index names

### 3. Check Permissions

```sql
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE table_name IN ('completion_ready', 'completion_submissions')
AND grantee = 'authenticated';
```

**Expected Output**: Should show SELECT, INSERT, UPDATE grants

### 4. Test Data Insert (Optional)

```sql
-- Insert test data
INSERT INTO completion_ready (bounty_id, hunter_id) 
VALUES (gen_random_uuid(), gen_random_uuid());

-- Verify it's there
SELECT * FROM completion_ready;

-- Clean up
DELETE FROM completion_ready WHERE bounty_id NOT IN (SELECT id FROM bounties);
```

---

## What Happens if You DON'T Run the Migration?

If you merge without running the migration:

❌ **The app will fail when:**
- A hunter clicks "Ready to Submit" → Database error (table doesn't exist)
- A hunter submits completion → Database error (table doesn't exist)
- A poster tries to review → No submission found (table doesn't exist)

✅ **The app will gracefully fallback to API endpoints if:**
- `isSupabaseConfigured` is `false` in the environment
- However, you'd need to implement those API endpoints separately

---

## Rollback (If Needed)

If something goes wrong, you can rollback the migration:

```sql
-- Drop the tables (this will delete all data in them!)
DROP TABLE IF EXISTS public.completion_submissions;
DROP TABLE IF EXISTS public.completion_ready;

-- Optionally remove the accepted_by column
ALTER TABLE public.bounties DROP COLUMN IF EXISTS accepted_by;
```

---

## Summary Checklist

Before merging this PR, complete these steps:

- [ ] Run the migration file in Supabase (using one of the 3 methods above)
- [ ] Verify tables were created (run verification query)
- [ ] Verify indexes were created (run verification query)
- [ ] Enable RLS policies (uncomment and customize from migration file)
- [ ] Test RLS policies with a test user
- [ ] Test the complete flow in your app:
  - [ ] Hunter marks ready
  - [ ] Hunter submits completion
  - [ ] Poster reviews and approves
  - [ ] Bounty status changes to completed

---

## Need Help?

If you encounter issues:

1. Check Supabase logs for error messages
2. Verify your database user has permission to CREATE TABLE
3. Check that your Supabase project is on a plan that supports custom tables
4. Review the migration file for any conflicts with existing schema

## Questions?

- **Q: Do I need to run this on production AND staging?**  
  A: Yes, run it on every environment where you'll test or deploy this feature.

- **Q: Will this affect existing data?**  
  A: No, this only adds new tables. Existing bounty data is not modified.

- **Q: Can I run this migration multiple times?**  
  A: Yes, it uses `IF NOT EXISTS` so it's safe to run multiple times.

- **Q: Do I need to restart my app after running the migration?**  
  A: No, the app will immediately be able to use the new tables.
