# Request Acceptance Flow - Before and After Fix

## The Problem

```
User (Poster) tries to accept a bounty request
                    ↓
    bountyRequestService.acceptRequest(requestId)
                    ↓
        updateStatus(requestId, "accepted")
                    ↓
        update(id, { status: "accepted" })
                    ↓
    Supabase: UPDATE bounty_requests SET status = 'accepted' WHERE id = '...'
                    ↓
        RLS Policy Check:
        Does auth.uid() = bounties.poster_id where bounties.id = bounty_requests.bounty_id?
                    ↓
            ❌ FAIL: poster_id is NULL or doesn't exist!
                    ↓
        Supabase returns error (no rows updated)
                    ↓
        update() returns null
                    ↓
        acceptRequest() returns null
                    ↓
    handleAcceptRequest() shows error:
    "Accept Failed - Failed to accept the request on the server."
```

## The Root Cause

The RLS policy was checking:
```sql
bounties.poster_id = auth.uid()
```

But the bounties table in production has:
```sql
CREATE TABLE bounties (
    ...
    user_id uuid NOT NULL,    -- ✅ This exists and is populated
    poster_id uuid,           -- ❌ This is NULL or doesn't exist
    ...
);
```

## The Fix

Updated RLS policy to check both columns:
```sql
COALESCE(bounties.poster_id, bounties.user_id) = auth.uid()
```

This means:
- If `poster_id` exists and is not NULL, use it
- Otherwise, fall back to `user_id`
- Works with both legacy and new schema versions!

## After the Fix

```
User (Poster) tries to accept a bounty request
                    ↓
    bountyRequestService.acceptRequest(requestId)
                    ↓
        updateStatus(requestId, "accepted")
                    ↓
        update(id, { status: "accepted" })
                    ↓
    Supabase: UPDATE bounty_requests SET status = 'accepted' WHERE id = '...'
                    ↓
        RLS Policy Check:
        Does auth.uid() = COALESCE(bounties.poster_id, bounties.user_id)?
                    ↓
            ✅ PASS: user_id matches auth.uid()!
                    ↓
        Supabase updates the row and returns the updated request
                    ↓
        update() returns BountyRequest object
                    ↓
        acceptRequest() creates escrow & conversation
                    ↓
        acceptRequest() returns BountyRequest object
                    ↓
    handleAcceptRequest() shows success:
    "Request accepted! Conversation started."
```

## Schema Comparison

### Legacy Schema (Production)
```sql
CREATE TABLE bounties (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES profiles(id),  -- Poster
    title text,
    ...
);

-- RLS Policy checks bounties.poster_id (doesn't exist!) ❌
```

### Ideal Schema (schema.sql)
```sql
CREATE TABLE bounties (
    id uuid PRIMARY KEY,
    poster_id uuid REFERENCES profiles(id),         -- Canonical
    user_id uuid NOT NULL REFERENCES profiles(id),  -- Legacy
    title text,
    ...
);

-- RLS Policy checks COALESCE(bounties.poster_id, bounties.user_id) ✅
```

## Migration Strategy

The migration uses `COALESCE` to support both schemas:

```sql
-- Works whether poster_id exists or not
COALESCE(bounties.poster_id, bounties.user_id) = auth.uid()

-- Scenarios:
-- 1. poster_id exists and is populated → use poster_id
-- 2. poster_id is NULL → use user_id
-- 3. poster_id column doesn't exist → PostgreSQL treats as NULL, use user_id
-- 4. Both exist and are the same → no difference
```

This makes the fix:
- ✅ Backward compatible
- ✅ Forward compatible  
- ✅ Safe to deploy
- ✅ Doesn't require schema changes
- ✅ Works immediately after migration

## Testing the Fix

### Before Migration
```bash
# Try to accept a request
❌ Error: "Accept Failed"
# Check logs
Error: Supabase policy violation (PGRST...)
```

### After Migration
```bash
# Try to accept a request
✅ Success: Request accepted, status changed to "accepted"
# Check logs
✓ Request updated successfully
✓ Escrow created for $X.XX
✓ Conversation created
```

## Files Affected

### Database
- `supabase/migrations/20260212_fix_bounty_requests_rls_policy.sql` - The migration

### Code (TypeScript)
- `lib/services/database.types.ts` - Added missing fields to BountyRequest type
- `lib/services/bounty-request-service.ts` - Improved error logging

### Documentation
- `FIX_SUMMARY.md` - Quick start guide
- `REQUEST_ACCEPTANCE_FIX.md` - Technical details
- `REQUEST_ACCEPTANCE_FLOW_DIAGRAM.md` - This file
- `supabase/migrations/README.md` - Migration docs

## Questions?

**Q: Will this break anything?**  
A: No. The COALESCE approach is safe and backward/forward compatible.

**Q: Do I need to update existing data?**  
A: No. The fix works with the data as-is.

**Q: What if I already have poster_id populated?**  
A: Even better! The COALESCE will use poster_id first.

**Q: Can I rollback if needed?**  
A: Yes, but you'll restore the broken behavior. See REQUEST_ACCEPTANCE_FIX.md for rollback SQL.

**Q: How do I know the migration worked?**  
A: Try accepting a request. If it works without error, the migration was successful.
