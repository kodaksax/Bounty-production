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

Run the migration file against your Supabase database:

```bash
# Using Supabase CLI
supabase db push

# Or manually via SQL editor in Supabase Dashboard
# Copy and paste the contents of:
# supabase/migrations/20251117_safe_user_deletion.sql
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
```

## Testing

### Test Scenario 1: User with Active Bounty

1. Create a test user in Supabase Auth
2. Create a bounty posted by this user (status = 'open')
3. Have another user apply to the bounty
4. Delete the test user from Supabase Auth
5. **Expected Result:**
   - User is deleted successfully
   - Bounty status changes to 'archived'
   - Bounty.user_id is set to NULL
   - Application record is preserved with user_id = NULL

### Test Scenario 2: User with Escrowed Funds

1. Create a test user
2. Create bounty with escrow transaction (type = 'escrow', status = 'pending')
3. Delete the user
4. **Expected Result:**
   - User is deleted successfully
   - Refund transaction is created (type = 'refund', status = 'completed')
   - Original escrow transaction status changes to 'completed'

### Test Scenario 3: User Working as Hunter

1. Create two test users (poster and hunter)
2. Create bounty by poster
3. Have hunter accept the bounty (bounty.accepted_by = hunter_id, status = 'in_progress')
4. Delete the hunter user
5. **Expected Result:**
   - Hunter is deleted successfully
   - Bounty.accepted_by is set to NULL
   - Bounty status changes back to 'open'

### Complete Test Script

```sql
-- Test Script for User Deletion
BEGIN;

-- 1. Create test user in profiles (assuming they exist in auth.users)
INSERT INTO profiles (id, username, email, balance)
VALUES ('test-user-id-123', 'testuser', 'test@example.com', 100.00);

-- 2. Create active bounty
INSERT INTO bounties (id, user_id, title, description, amount, status)
VALUES ('test-bounty-123', 'test-user-id-123', 'Test Bounty', 'Test Description', 50.00, 'open');

-- 3. Create escrow transaction
INSERT INTO wallet_transactions (user_id, type, amount, bounty_id, status)
VALUES ('test-user-id-123', 'escrow', 50.00, 'test-bounty-123', 'pending');

-- 4. Check current state
SELECT * FROM profiles WHERE id = 'test-user-id-123';
SELECT * FROM bounties WHERE id = 'test-bounty-123';
SELECT * FROM wallet_transactions WHERE user_id = 'test-user-id-123';

-- 5. Delete the user (simulating auth.users deletion cascade)
DELETE FROM profiles WHERE id = 'test-user-id-123';

-- 6. Check results
SELECT * FROM bounties WHERE id = 'test-bounty-123'; -- Should be archived, user_id NULL
SELECT * FROM wallet_transactions WHERE bounty_id = 'test-bounty-123'; -- Should have refund

ROLLBACK; -- Rollback test changes
```

## Deleting Users from Supabase

After applying the migration, users can be deleted in two ways:

### Method 1: Supabase Dashboard

1. Go to Authentication → Users in Supabase Dashboard
2. Find the user you want to delete
3. Click the menu (⋯) → Delete user
4. Confirm the deletion
5. ✅ User and related data are now cleaned up automatically

### Method 2: Admin API

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Requires service role key
)

// Delete user by ID
const { data, error } = await supabase.auth.admin.deleteUser('user-id-here')

if (error) {
  console.error('Failed to delete user:', error)
} else {
  console.log('User deleted successfully')
}
```

### Method 3: Client-Side (requires admin privileges)

The existing `account-deletion-service.ts` can be simplified since the database now handles cleanup automatically:

```typescript
// lib/services/account-deletion-service.ts (updated)
export async function deleteUserAccount(): Promise<{ success: boolean; message: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, message: 'No authenticated user found' };
    }

    // The database trigger handles all cleanup automatically
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    
    if (error) {
      return { 
        success: false, 
        message: `Failed to delete account: ${error.message}` 
      };
    }

    return {
      success: true,
      message: 'Account deleted successfully',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to delete account',
    };
  }
}
```

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
```

## Security Considerations

1. **Data Retention**: The solution preserves important audit trails (transactions, bounties, reports) by setting foreign keys to NULL instead of deleting
2. **Privacy Compliance**: Personal data (messages, skills, payment methods) is still deleted via CASCADE
3. **Escrow Safety**: Funds in escrow are automatically refunded before deletion
4. **No Orphaned Work**: In-progress bounties are reopened when hunters are deleted

## Monitoring

After deployment, monitor:

1. **Deletion Success Rate**: Track user deletion attempts vs. successes
2. **Refund Transactions**: Monitor automatic refunds created during deletion
3. **Archived Bounties**: Track bounties archived due to user deletion
4. **Error Logs**: Check PostgreSQL logs for any warnings from the cleanup function

## Support

If you encounter issues:

1. Check PostgreSQL logs for detailed error messages
2. Verify the migration was applied: `SELECT * FROM schema_migrations`
3. Test with the provided test script
4. Check foreign key constraints: `\d+ table_name` in psql

## Related Files

- Migration: `supabase/migrations/20251117_safe_user_deletion.sql`
- Schema: `database/schema.sql`
- Service: `lib/services/account-deletion-service.ts`
- Admin UI: `app/(admin)/users.tsx`
