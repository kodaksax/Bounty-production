# Bounty Applications System - Setup & Verification Guide

## Overview

The Bounty Applications system enables the complete bounty acceptance flow:
1. Hunters can apply to open bounties
2. Posters can view, accept, or reject applications  
3. Accepting triggers escrow and conversation creation
4. The bounty status transitions to "in_progress"

This document explains how to set up and verify the system works correctly.

---

## Prerequisites

### Required Environment Variables

Ensure your `.env` file has these configured:

```bash
# Supabase (required for bounty applications)
EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
```

Without Supabase configured, the app will fall back to the API backend, which may not have bounty-request endpoints implemented.

---

## Database Setup

### Step 1: Apply the Migration

The `bounty_requests` table must exist in your Supabase database.

**Option A: Supabase CLI (Recommended)**
```bash
# Link to your project (first time only)
supabase link --project-ref your-project-ref

# Apply the migration
supabase db push
```

**Option B: Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Open `supabase/migrations/20251119_add_bounty_requests_table.sql`
4. Copy and paste the entire content
5. Click "Run"

**Option C: Direct PostgreSQL**
```bash
psql -h your-db-host -U postgres -d postgres \
  -f supabase/migrations/20251119_add_bounty_requests_table.sql
```

### Step 2: Verify Table Creation

Run this query in the Supabase SQL Editor:

```sql
-- Check table exists
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'bounty_requests';

-- Should return:
-- table_name      | table_type
-- bounty_requests | BASE TABLE

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'bounty_requests';

-- Should return:
-- tablename       | rowsecurity
-- bounty_requests | t (true)

-- Check columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'bounty_requests'
ORDER BY ordinal_position;

-- Should return:
-- column_name  | data_type
-- id           | uuid
-- bounty_id    | uuid
-- hunter_id    | uuid
-- poster_id    | uuid
-- status       | USER-DEFINED (request_status_enum)
-- created_at   | timestamp with time zone
-- updated_at   | timestamp with time zone
```

---

## Code Architecture

### Frontend Components

1. **Apply Button**: `components/bountydetailmodal.tsx`
   - Function: `handleApplyForBounty()`
   - Creates a bounty request via `bountyRequestService.create()`
   - Shows email verification gate
   - Sends notification to poster

2. **Applicant List**: `app/tabs/postings-screen.tsx` (Requests tab)
   - Displays all applications using `ApplicantCard` component
   - Only shows requests for open bounties owned by current user

3. **Applicant Card**: `components/applicant-card.tsx`
   - Shows hunter profile, rating, bounty details
   - Accept/Reject buttons
   - Profile navigation on tap

4. **Accept/Reject Handlers**: `app/tabs/postings-screen.tsx`
   - `handleAcceptRequest()`: Main acceptance flow
   - `handleRejectRequest()`: Deletes rejected applications

### Service Layer

**File**: `lib/services/bounty-request-service.ts`

Key functions:
- `create()`: Create new application
- `getAll()`: Get requests with filters
- `getAllWithDetails()`: Get requests with bounty + profile data
- `acceptRequest()`: Update status to accepted
- `delete()`: Remove application

The service uses Supabase-first approach with API fallback.

---

## Testing the Flow

### Test Scenario 1: Hunter Applies to Bounty

1. **Setup**: Create a bounty as User A (poster)
2. **Action**: As User B (hunter), open the bounty detail
3. **Expected**:
   - "Apply for Bounty" button is visible
   - Button is disabled if email not verified
   - Button shows "Applied" if already applied

4. **Action**: Tap "Apply for Bounty"
5. **Expected**:
   - Loading indicator appears
   - Success alert: "Application Submitted"
   - Button text changes to "Applied"
   - Notification sent to poster

6. **Verification**:
   ```sql
   SELECT * FROM bounty_requests 
   WHERE bounty_id = '<bounty-id>' 
   AND hunter_id = '<user-b-id>';
   
   -- Should return 1 row with status = 'pending'
   ```

### Test Scenario 2: Poster Views Applications

1. **Setup**: Complete Test Scenario 1
2. **Action**: As User A (poster), go to Postings → Requests tab
3. **Expected**:
   - See ApplicantCard for User B
   - Shows User B's username and rating
   - Shows bounty title and amount
   - Accept and Reject buttons visible

### Test Scenario 3: Poster Accepts Application

1. **Setup**: Complete Test Scenario 2
2. **Action**: Tap "Accept" button on User B's request
3. **Expected**:
   - If paid bounty and insufficient balance: Alert to add money
   - If sufficient balance or honor bounty:
     - Loading indicator on Accept button
     - Success alert with escrow details
     - Request moves to "Accepted" status
     - Other competing requests disappear

4. **Verification**:
   ```sql
   -- Check bounty status changed
   SELECT status, accepted_by 
   FROM bounties 
   WHERE id = '<bounty-id>';
   -- Should return: status = 'in_progress', accepted_by = '<user-b-id>'
   
   -- Check request status
   SELECT status 
   FROM bounty_requests 
   WHERE bounty_id = '<bounty-id>' 
   AND hunter_id = '<user-b-id>';
   -- Should return: status = 'accepted'
   
   -- Check competing requests deleted
   SELECT COUNT(*) 
   FROM bounty_requests 
   WHERE bounty_id = '<bounty-id>' 
   AND hunter_id != '<user-b-id>';
   -- Should return: 0
   
   -- Check escrow created (if paid bounty)
   SELECT * 
   FROM wallet_transactions 
   WHERE bounty_id = '<bounty-id>' 
   AND type = 'escrow';
   -- Should return 1 row
   
   -- Check conversation created
   SELECT * 
   FROM conversations 
   WHERE bounty_id = '<bounty-id>';
   -- Should return 1 row with both users as participants
   ```

### Test Scenario 4: Poster Rejects Application

1. **Setup**: Have User C apply to the same bounty
2. **Action**: As User A, tap "Reject" on User C's request
3. **Expected**:
   - Confirmation alert: "Request Rejected"
   - Request disappears from list

4. **Verification**:
   ```sql
   SELECT * FROM bounty_requests 
   WHERE bounty_id = '<bounty-id>' 
   AND hunter_id = '<user-c-id>';
   -- Should return: 0 rows (deleted)
   ```

---

## Edge Cases to Test

### 1. Duplicate Applications
**Test**: Try to apply to same bounty twice as same hunter
**Expected**: Should show error or disable button after first application

### 2. Insufficient Balance
**Test**: Accept a $500 bounty with only $100 in wallet
**Expected**: Alert prompting to add money, acceptance blocked

### 3. Email Not Verified
**Test**: Try to apply without verified email
**Expected**: Alert requiring email verification, application blocked

### 4. Bounty Already Taken
**Test**: Try to apply to a bounty with status = 'in_progress'
**Expected**: Error message or application blocked

### 5. Self-Application
**Test**: Try to apply to your own bounty
**Expected**: Error: "You cannot apply to your own bounty"

---

## Troubleshooting

### Issue: "Failed to create bounty request"

**Possible Causes**:
1. Table doesn't exist
2. RLS policies blocking insert
3. Missing required fields

**Solution**:
```sql
-- Check if table exists
SELECT * FROM information_schema.tables 
WHERE table_name = 'bounty_requests';

-- Check RLS policies
SELECT * FROM pg_policies 
WHERE tablename = 'bounty_requests';

-- Try manual insert to test permissions
INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id, status)
VALUES (
  '<valid-bounty-id>',
  '<your-user-id>',
  '<poster-user-id>',
  'pending'
);
```

### Issue: Applications not showing in Requests tab

**Possible Causes**:
1. Bounty status is not 'open'
2. RLS policy blocking SELECT
3. Data fetch error

**Solution**:
```sql
-- Check bounty status
SELECT id, status FROM bounties WHERE poster_id = auth.uid();

-- Check requests exist
SELECT * FROM bounty_requests 
WHERE poster_id = auth.uid();

-- Test RLS policy
SELECT * FROM bounty_requests 
WHERE bounty_id IN (
  SELECT id FROM bounties WHERE poster_id = auth.uid()
);
```

### Issue: Accept button doesn't work

**Check**:
1. Console for error messages
2. Network tab for failed requests
3. Supabase logs for RLS violations

**Common Fix**:
Ensure the poster_id is correctly populated when creating the request:
```typescript
const request = await bountyRequestService.create({
  bounty_id: bounty.id,
  hunter_id: currentUserId,
  poster_id: posterId, // Must be set!
  status: 'pending',
});
```

---

## RLS Policy Reference

The migration creates these policies:

1. **Posters can view requests for their bounties**
   ```sql
   SELECT ... WHERE EXISTS (
     SELECT 1 FROM bounties 
     WHERE bounties.id = bounty_requests.bounty_id 
     AND bounties.poster_id = auth.uid()
   )
   ```

2. **Hunters can view their own applications**
   ```sql
   SELECT ... WHERE hunter_id = auth.uid()
   ```

3. **Hunters can create applications**
   ```sql
   INSERT ... WITH CHECK (hunter_id = auth.uid())
   ```

4. **Posters can update requests for their bounties**
   ```sql
   UPDATE ... WHERE EXISTS (
     SELECT 1 FROM bounties 
     WHERE bounties.id = bounty_requests.bounty_id 
     AND bounties.poster_id = auth.uid()
   )
   ```

5. **Hunters can delete their pending applications**
   ```sql
   DELETE ... WHERE hunter_id = auth.uid() AND status = 'pending'
   ```

6. **Posters can delete requests**
   ```sql
   DELETE ... WHERE EXISTS (
     SELECT 1 FROM bounties 
     WHERE bounties.id = bounty_requests.bounty_id 
     AND bounties.poster_id = auth.uid()
   )
   ```

---

## API Backend (Optional)

If you're using the API backend instead of Supabase, you'll need to implement these endpoints:

### Required Endpoints

```
POST   /api/bounty-requests          - Create application
GET    /api/bounty-requests          - List applications (with filters)
GET    /api/bounty-requests/:id      - Get single application
PATCH  /api/bounty-requests/:id      - Update application (accept/reject)
DELETE /api/bounty-requests/:id      - Delete application
```

**Reference Implementation**: See `services/api/src/index.ts` for similar bounty endpoints pattern.

---

## Monitoring & Analytics

### Key Metrics to Track

1. **Application Rate**: Applications per bounty
2. **Acceptance Rate**: Accepted / Total applications
3. **Time to Accept**: Duration from post to first acceptance
4. **Competing Applications**: Average applications per bounty

### Sample Queries

```sql
-- Applications per bounty
SELECT bounty_id, COUNT(*) as application_count
FROM bounty_requests
GROUP BY bounty_id
ORDER BY application_count DESC;

-- Acceptance rate
SELECT 
  COUNT(*) FILTER (WHERE status = 'accepted') * 100.0 / COUNT(*) as acceptance_rate
FROM bounty_requests;

-- Average applications per bounty
SELECT AVG(application_count) as avg_applications
FROM (
  SELECT bounty_id, COUNT(*) as application_count
  FROM bounty_requests
  GROUP BY bounty_id
) subquery;
```

---

## Next Steps After Setup

1. ✅ Apply migration to production database
2. ✅ Test complete flow in staging
3. ✅ Monitor error logs for RLS violations
4. ✅ Set up analytics tracking
5. ✅ Document any custom modifications
6. ✅ Train support team on new flow

---

## Related Documentation

- [Bounty Acceptance Implementation Summary](./BOUNTY_ACCEPTANCE_IMPLEMENTATION_SUMMARY.md)
- [Acceptance Flow Diagram](./ACCEPTANCE_FLOW_DIAGRAM.md)
- [Testing Guide](./BOUNTY_ACCEPTANCE_TESTING.md)
- [Supabase Migrations README](./supabase/migrations/README.md)

---

## Support

If you encounter issues not covered in this guide:

1. Check Supabase logs for RLS violations
2. Review browser console for client errors
3. Verify environment variables are correct
4. Ensure migration was applied successfully
5. Check that all required services are running

For questions, contact the development team or open an issue.
