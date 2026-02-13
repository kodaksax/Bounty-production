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

## Migration: 20260212_fix_bounty_requests_rls_policy.sql

**DIAGNOSTIC MIGRATION**: This migration helps diagnose why bounty request acceptance is failing.

### Problem

Bounty request acceptance fails with "Accept Failed" error. Initial investigation suggested RLS policy issues, but the policies are actually correct (they use `bounties.poster_id` as intended for production).

### Root Cause (CORRECTED)

The most likely issue is **NULL `poster_id` values** in the bounties table:
- RLS policy checks: `WHERE bounties.poster_id = auth.uid()`
- If `poster_id IS NULL`, the comparison `NULL = auth.uid()` returns FALSE
- Result: Policy denies access even to the bounty owner

### What This Migration Does

1. **Diagnoses**: Checks for bounties with NULL poster_id and reports count
2. **Maintains**: Ensures RLS policies use `bounties.poster_id` (correct for production)
3. **Guides**: Provides SQL queries to fix any NULL values found

### Running This Migration

```bash
# Option 1: Supabase CLI (shows output messages)
supabase db push

# Option 2: Supabase Dashboard SQL Editor
# Copy contents of 20260212_fix_bounty_requests_rls_policy.sql and execute
# Check the Messages tab for NOTICE/WARNING output
```

**Watch for output like:**
```
NOTICE: Bounties with NULL poster_id: 5 out of 100
WARNING: Found 5 bounties with NULL poster_id...
```

### If NULL Values Found

Use the queries in the migration comments to fix them:

```sql
-- Check which bounties are affected
SELECT id, title, created_at FROM bounties WHERE poster_id IS NULL;

-- If you have user_id column, backfill from it:
UPDATE bounties SET poster_id = user_id 
WHERE poster_id IS NULL AND user_id IS NOT NULL;

-- Then make poster_id NOT NULL to prevent future issues:
ALTER TABLE bounties ALTER COLUMN poster_id SET NOT NULL;
```

### Verification

After fixing NULL values:
1. Run: `SELECT COUNT(*) FROM bounties WHERE poster_id IS NULL;` (should be 0)
2. Log in as a bounty poster in the app
3. Navigate to Requests tab
4. Try accepting a request
5. Should succeed without error ✅

### Related Files

- `REQUEST_ACCEPTANCE_FIX.md` - Detailed diagnostic guide and solutions
- `lib/services/database.types.ts` - Updated BountyRequest type
- `lib/services/bounty-request-service.ts` - Enhanced error logging

---

## Migration: 20251126_add_age_verification_columns.sql

This migration adds age verification columns to support 18+ compliance requirements.

### Columns Added

1. **age_verified** (boolean) - Whether the user confirmed they are 18 or older during sign-up
   - Defaults to `false` for new profiles
   - Set to `true` during profile creation when user checks the 18+ box

2. **age_verified_at** (timestamptz) - Timestamp of when the user agreed to being 18+
   - Used for audit and compliance purposes
   - Set to the current timestamp when age_verified is set to true
   - For backfilled users, uses their profile creation date

### Indexes Created

- `idx_profiles_age_verified` - Fast lookups by age verification status

### Backfill Logic

Existing users who signed up with `age_verified: true` in their auth metadata are automatically backfilled:
- `age_verified` is set to `true`
- `age_verified_at` is set to their profile creation date

### Related Files

- `lib/services/auth-profile-service.ts` - AuthProfile interface and profile creation logic
- `app/auth/sign-up-form.tsx` - Age verification checkbox in sign-up form
- `database/schema.sql` - Main database schema

---

## Migration: risk_management_system.sql

This migration implements the comprehensive Risk Management System to address Stripe's platform liability requirements for negative account balances.

### Overview

This migration adds 7 new tables and extends the `profiles` table with 8 risk management fields to support:
- Seller onboarding compliance
- Risk assessment and scoring
- Automated risk monitoring
- Platform reserves for liability coverage
- Seller communication and remediation workflows

### Tables Extended

1. **profiles** - Extended with 8 risk management columns:
   - `verification_status` (text) - pending, verified, rejected, under_review
   - `kyc_verified_at` (timestamptz) - When KYC verification was completed
   - `business_category` (text) - Business category code
   - `risk_level` (text) - low, medium, high, critical
   - `risk_score` (integer) - Numeric score 0-100
   - `account_restricted` (boolean) - Whether account has restrictions
   - `restriction_reason` (text) - Reason for restriction
   - `restricted_at` (timestamptz) - When account was restricted

### Tables Created

1. **restricted_business_categories** - Compliance rules for business types
   - 26 categories: 6 prohibited, 6 high-risk, 5 medium-risk, 9 low-risk
   - Examples: gambling (prohibited), cryptocurrency (high-risk), general services (low-risk)

2. **risk_assessments** - Historical record of risk evaluations
   - Multi-factor scoring (0-100): transaction velocity, amounts, account age, verification, chargebacks, refunds, business category, geography
   - Tracks assessment type, risk factors, assessed_by

3. **risk_actions** - Mitigation actions taken
   - Action types: hold, restrict, delay_payout, require_verification, suspend, flag_for_review
   - Tracks automated vs manual actions, resolution status

4. **platform_reserves** - Reserves held for liability coverage
   - Reserve types: rolling, fixed, transaction_based
   - Based on risk level: Low (5%), Medium (10%), High (20%), Critical (30%)
   - 90-day default release period

5. **risk_communications** - Communication audit trail
   - Multi-channel: email, in_app, sms, push
   - Tracks delivery and read status

6. **remediation_workflows** - Document verification workflows
   - Workflow types: document_verification, identity_check, business_verification, transaction_review
   - Tracks required vs submitted documents, review status

7. **transaction_patterns** - Fraud/risk pattern detection
   - Pattern types: high_velocity, unusual_amount, geographic_anomaly, chargebacks, refund_pattern
   - Auto-triggered when thresholds exceeded

### Indexes Created

Performance indexes on:
- `profiles(risk_level, account_restricted)`
- `risk_assessments(user_id, created_at)`
- `risk_actions(user_id, status, created_at)`
- `platform_reserves(user_id, status, release_date)`
- `risk_communications(user_id, risk_action_id, sent_at)`
- `remediation_workflows(user_id, status, risk_action_id)`
- `transaction_patterns(user_id, reviewed, detected_at)`

### Row Level Security (RLS)

Comprehensive RLS policies for all tables:
- **Public**: `restricted_business_categories` (read-only for all)
- **User access**: Users can view their own risk data
- **Admin access**: Service role has full management access
- **User updates**: Users can update their own remediation workflows

### Triggers

Automatic `updated_at` timestamp updates for:
- `restricted_business_categories`
- `platform_reserves`
- `remediation_workflows`

### Running This Migration

**Step 1: Main Migration**
```bash
# Via Supabase Dashboard SQL Editor
# Copy contents of risk_management_system.sql and execute
```

**Step 2: Seed Categories**
```bash
# Via Supabase Dashboard SQL Editor
# Copy contents of seed_restricted_categories.sql and execute
```

**Step 3: Verify**
```sql
-- Check all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'risk_%' OR table_name = 'restricted_business_categories';

-- Verify categories seeded (should show 26 total)
SELECT risk_level, COUNT(*) as count
FROM restricted_business_categories
GROUP BY risk_level;
```

### Rollback

If you need to rollback:
```sql
-- Drop all new tables
DROP TABLE IF EXISTS transaction_patterns CASCADE;
DROP TABLE IF EXISTS remediation_workflows CASCADE;
DROP TABLE IF EXISTS risk_communications CASCADE;
DROP TABLE IF EXISTS platform_reserves CASCADE;
DROP TABLE IF EXISTS risk_actions CASCADE;
DROP TABLE IF EXISTS risk_assessments CASCADE;
DROP TABLE IF EXISTS restricted_business_categories CASCADE;

-- Remove columns from profiles
ALTER TABLE profiles
DROP COLUMN IF EXISTS verification_status,
DROP COLUMN IF EXISTS kyc_verified_at,
DROP COLUMN IF EXISTS business_category,
DROP COLUMN IF EXISTS risk_level,
DROP COLUMN IF EXISTS risk_score,
DROP COLUMN IF EXISTS account_restricted,
DROP COLUMN IF EXISTS restriction_reason,
DROP COLUMN IF EXISTS restricted_at;
```

### Related Files

Backend services:
- `services/api/src/services/risk-management-service.ts` - Core risk engine (650 LOC)
- `services/api/src/services/remediation-service.ts` - Remediation workflows (350 LOC)
- `services/api/src/services/wallet-risk-integration.ts` - Transaction monitoring (200 LOC)
- `services/api/src/routes/risk-management.ts` - API endpoints (12 routes)

Documentation:
- `RISK_MANAGEMENT_GUIDE.md` - Complete technical documentation
- `RISK_MANAGEMENT_QUICKSTART.md` - Implementation guide
- `RISK_MANAGEMENT_IMPLEMENTATION_SUMMARY.md` - Overview

---

## Related Files (Completion Flow)

The completion migration supports the following code changes:
- `lib/services/completion-service.ts` - Service layer for completion operations
- `components/my-posting-expandable.tsx` - UI for bounty progress tracking
- `components/poster-review-modal.tsx` - UI for poster review actions
- `app/tabs/postings-screen.tsx` - List views with refresh support
