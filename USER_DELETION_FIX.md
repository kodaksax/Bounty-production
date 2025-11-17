# User Deletion Fix - Implementation Guide

## Problem Statement

Previously, when attempting to delete authenticated users from Supabase, the operation would fail with a "Database error deleting user" message. This was caused by:

1. **Active posted bounties** - Users with open or in-progress bounties that others had applied to or were working on
2. **Active hunter work** - Users currently working on bounties (as hunter), which would orphan the work
3. **Escrowed funds** - Users with pending escrow transactions that needed to be resolved

The root cause was that the foreign key constraints were set to `ON DELETE CASCADE`, but the cascading deletes would fail due to complex data relationships and potential data integrity violations.

## Solution Overview

The fix implements a two-pronged approach:

### 1. Modified Foreign Key Constraints

Changed foreign key constraints from `ON DELETE CASCADE` to `ON DELETE SET NULL` for tables where we want to preserve historical data:

- **bounties.user_id** → SET NULL (preserves bounty records with anonymized poster)
- **bounty_requests.user_id** → SET NULL (preserves application history)
- **wallet_transactions.user_id** → SET NULL (preserves transaction audit trail)
- **completion_submissions.hunter_id** → SET NULL (preserves submission records)
- **reports.user_id** → SET NULL (preserves report history)

Kept `ON DELETE CASCADE` for personal data that should be deleted:
- **messages.user_id** → CASCADE (personal messages)
- **conversation_participants.user_id** → CASCADE (participation records)
- **skills.user_id** → CASCADE (user-specific skills)
- **blocked_users** → CASCADE (block relationships)
- **payment_methods.user_id** → CASCADE (payment information)

### 2. Automatic Cleanup Trigger

Created a database trigger that runs before profile deletion to:

1. **Archive active bounties** - Changes status from 'open' or 'in_progress' to 'archived'
2. **Refund escrowed funds** - Creates refund transactions for any pending escrow
3. **Release hunter assignments** - Sets `accepted_by` to NULL and reopens in-progress bounties
4. **Reject pending applications** - Updates pending bounty_requests to 'rejected' status
5. **Clean up notifications** - Removes user's notifications and push tokens

## Installation

### Step 1: Apply the Migration

The migration file is located at `supabase/migrations/20251117_safe_user_deletion.sql`.

**Option A: Using Supabase CLI (Recommended)**

```bash
# Make sure you're in the project root
cd /path/to/bountyexpo

# Apply all pending migrations
supabase db push

# Or apply this specific migration
supabase db push --include-all
```

**Option B: Using Supabase Dashboard**

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the entire contents of `supabase/migrations/20251117_safe_user_deletion.sql`
4. Paste into a new query
5. Click "Run" to execute

**Option C: Using psql (Direct Database Access)**

```bash
# Connect to your Supabase database
psql "postgresql://postgres.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Run the migration
\i supabase/migrations/20251117_safe_user_deletion.sql
```

### Step 2: Verify Installation

Check that the trigger was created successfully:

```sql
-- Check if the function exists
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'handle_user_deletion_cleanup';

-- Check if the trigger exists
SELECT trigger_name 
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_user_deletion_cleanup';

-- Verify foreign key constraints were updated
SELECT 
  tc.table_name, 
  kcu.column_name, 
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name IN ('user_id', 'hunter_id', 'poster_id')
ORDER BY tc.table_name, kcu.column_name;
```

Expected output should show `SET NULL` for most user_id columns and `CASCADE` for personal data tables.

## Testing

### Quick Test Script

Run this test to verify the solution works:

```sql
-- Test Script for User Deletion
BEGIN;

-- 1. Create test user profile (assuming auth.users entry exists)
-- Note: In a real scenario, create via Supabase Auth first
INSERT INTO profiles (id, username, email, balance)
VALUES ('00000000-0000-0000-0000-000000000099', 'testdeleteuser', 'testdelete@example.com', 100.00)
ON CONFLICT (id) DO NOTHING;

-- 2. Create active bounty
INSERT INTO bounties (id, user_id, title, description, amount, status)
VALUES ('test-bounty-del-001', '00000000-0000-0000-0000-000000000099', 'Test Bounty For Deletion', 'Test Description', 50.00, 'open')
ON CONFLICT (id) DO NOTHING;

-- 3. Create escrow transaction
INSERT INTO wallet_transactions (user_id, type, amount, bounty_id, status)
VALUES ('00000000-0000-0000-0000-000000000099', 'escrow', 50.00, 'test-bounty-del-001', 'pending');

-- 4. Check current state
SELECT 'BEFORE DELETION - Profile:' as info, * FROM profiles WHERE id = '00000000-0000-0000-0000-000000000099'
UNION ALL
SELECT 'BEFORE DELETION - Bounty:', * FROM bounties WHERE id = 'test-bounty-del-001'
UNION ALL  
SELECT 'BEFORE DELETION - Transactions:', * FROM wallet_transactions WHERE user_id = '00000000-0000-0000-0000-000000000099';

-- 5. Delete the user (simulating auth.users deletion cascade)
DELETE FROM profiles WHERE id = '00000000-0000-0000-0000-000000000099';

-- 6. Check results
SELECT 'AFTER DELETION - Bounty (should be archived, user_id NULL):' as info, id, user_id, status FROM bounties WHERE id = 'test-bounty-del-001'
UNION ALL
SELECT 'AFTER DELETION - Transactions (should include refund):', id::text, user_id::text, type FROM wallet_transactions WHERE bounty_id = 'test-bounty-del-001';

ROLLBACK; -- Rollback test changes
```

### Test Scenario 1: User with Active Bounty

1. Create a test user in Supabase Auth
2. Create a bounty posted by this user (status = 'open')
3. Have another user apply to the bounty
4. Delete the test user from Supabase Auth
5. **Expected Result:**
   - ✅ User is deleted successfully
   - ✅ Bounty status changes to 'archived'
   - ✅ Bounty.user_id is set to NULL
   - ✅ Application record is preserved with user_id = NULL

### Test Scenario 2: User with Escrowed Funds

1. Create a test user
2. Create bounty with escrow transaction (type = 'escrow', status = 'pending')
3. Delete the user
4. **Expected Result:**
   - ✅ User is deleted successfully
   - ✅ Refund transaction is created (type = 'refund', status = 'completed')
   - ✅ Original escrow transaction status changes to 'completed'

### Test Scenario 3: User Working as Hunter

1. Create two test users (poster and hunter)
2. Create bounty by poster
3. Have hunter accept the bounty (bounty.accepted_by = hunter_id, status = 'in_progress')
4. Delete the hunter user
5. **Expected Result:**
   - ✅ Hunter is deleted successfully
   - ✅ Bounty.accepted_by is set to NULL
   - ✅ Bounty status changes back to 'open'

## Deleting Users from Supabase

After applying the migration, users can be deleted in multiple ways:

### Method 1: Supabase Dashboard (Easiest)

1. Go to **Authentication → Users** in Supabase Dashboard
2. Find the user you want to delete
3. Click the menu (⋯) next to the user
4. Select **Delete user**
5. Confirm the deletion
6. ✅ User and related data are now cleaned up automatically!

### Method 2: Supabase Admin API (Server-Side)

```javascript
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Requires service role key
)

// Delete user by ID
const { data, error } = await supabaseAdmin.auth.admin.deleteUser('user-id-here')

if (error) {
  console.error('Failed to delete user:', error)
} else {
  console.log('User deleted successfully')
}
```

### Method 3: Client-Side (Updated Implementation)

The `account-deletion-service.ts` has been updated to work seamlessly with the database trigger:

```typescript
import { deleteUserAccount } from '../lib/services/account-deletion-service'

// In your React component or service
const handleDeleteAccount = async () => {
  const result = await deleteUserAccount()
  
  if (result.success) {
    console.log('Success:', result.message)
    // Optional: Display what was cleaned up
    if (result.info) {
      console.log('Cleanup details:', result.info)
    }
  } else {
    console.error('Error:', result.message)
  }
}
```

The service now:
- ✅ Provides transparency about what will be cleaned up
- ✅ Handles both admin API and direct profile deletion
- ✅ Returns detailed information about the cleanup process
- ✅ Gracefully handles permission issues

## What Happens During Deletion

When a user is deleted, the following automatic cleanup occurs:

### Data Preserved (Anonymized)
- ✅ **Bounties** - Archived and user_id set to NULL (preserves public records)
- ✅ **Wallet Transactions** - user_id set to NULL (preserves audit trail)
- ✅ **Bounty Applications** - user_id set to NULL (preserves application history)
- ✅ **Completion Submissions** - hunter_id set to NULL (preserves submission records)
- ✅ **Reports** - user_id set to NULL (preserves moderation history)

### Data Deleted (Privacy)
- 🗑️ **Profile** - Completely removed
- 🗑️ **Messages** - Personal messages deleted
- 🗑️ **Conversation Participants** - Participation records removed
- 🗑️ **Skills** - User-specific skills deleted
- 🗑️ **Payment Methods** - Payment information removed
- 🗑️ **Blocked Users** - Block relationships removed
- 🗑️ **Notifications** - All notifications cleared
- 🗑️ **Push Tokens** - Device tokens removed

### Special Actions
- 💰 **Escrow Refunds** - Pending escrow automatically refunded
- 🔓 **Hunter Release** - In-progress bounties reopened when hunter is deleted
- ❌ **Application Rejection** - Pending applications marked as rejected

## Rollback

If you need to rollback this migration:

```sql
-- Remove the trigger
DROP TRIGGER IF EXISTS trigger_user_deletion_cleanup ON profiles;

-- Remove the function
DROP FUNCTION IF EXISTS handle_user_deletion_cleanup();

-- Restore original foreign key constraints (example for bounties)
ALTER TABLE bounties 
  DROP CONSTRAINT IF EXISTS bounties_user_id_fkey,
  ADD CONSTRAINT bounties_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- Repeat for other tables as needed...
-- (See the migration file for the complete list of tables)
```

## Security Considerations

1. **Data Retention**: The solution preserves important audit trails (transactions, bounties, reports) by setting foreign keys to NULL instead of deleting
2. **Privacy Compliance**: Personal data (messages, skills, payment methods) is still deleted via CASCADE, ensuring GDPR/privacy compliance
3. **Escrow Safety**: Funds in escrow are automatically refunded before deletion, preventing financial loss
4. **No Orphaned Work**: In-progress bounties are reopened when hunters are deleted, preventing work from being lost

## Monitoring & Troubleshooting

### Check Deletion Success

```sql
-- Check recent deletions (look for archived bounties with NULL user_id)
SELECT id, title, user_id, status, updated_at
FROM bounties
WHERE user_id IS NULL AND status = 'archived'
ORDER BY updated_at DESC
LIMIT 10;

-- Check recent refunds (auto-created during deletion)
SELECT id, type, amount, bounty_id, created_at, description
FROM wallet_transactions
WHERE type = 'refund' AND description LIKE '%deletion%'
ORDER BY created_at DESC
LIMIT 10;
```

### Common Issues

**Issue 1: "Database error deleting user" still appears**
- ✅ Verify the migration was applied: Check for the trigger in `information_schema.triggers`
- ✅ Check PostgreSQL logs for detailed error messages
- ✅ Ensure you're using the latest version of the migration

**Issue 2: Admin API not available (client-side)**
- ✅ This is expected - client-side code doesn't have admin privileges
- ✅ The service will fall back to direct profile deletion
- ✅ An admin will need to manually delete from auth.users if needed

**Issue 3: Some data not being cleaned up**
- ✅ Check if the table has the correct foreign key constraint (SET NULL or CASCADE)
- ✅ Look for exceptions in the trigger function logs
- ✅ Verify RLS policies aren't blocking the cleanup operations

### Logs and Monitoring

Monitor deletion operations:

```sql
-- Create a simple audit log (optional)
CREATE TABLE IF NOT EXISTS user_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id uuid NOT NULL,
  deleted_at timestamptz DEFAULT NOW(),
  bounties_archived integer,
  escrow_refunded numeric(10,2),
  notes text
);

-- Add to trigger function to log deletions (optional enhancement)
```

## Support

If you encounter issues:

1. **Check Migration Status**: Verify the migration was applied successfully
2. **Review PostgreSQL Logs**: Look for detailed error messages from the trigger function
3. **Test with Script**: Use the test script above to verify functionality
4. **Check Constraints**: Verify foreign key constraints with the verification query above
5. **Contact Support**: If issues persist, provide the output from the verification queries

## Related Files

- **Migration**: `supabase/migrations/20251117_safe_user_deletion.sql`
- **Schema**: `database/schema.sql`
- **Service**: `lib/services/account-deletion-service.ts`
- **Admin UI**: `app/(admin)/users.tsx`

## Summary

This solution enables safe deletion of Supabase auth users by:

1. ✅ Automatically handling active bounties, escrow, and hunter assignments
2. ✅ Preserving important audit trails while respecting user privacy
3. ✅ Preventing data integrity issues and orphaned records
4. ✅ Providing transparency to users about what will be cleaned up
5. ✅ Supporting multiple deletion methods (dashboard, API, client-side)

**The migration makes user deletion "just work"** - no more manual cleanup or blocked deletions!
