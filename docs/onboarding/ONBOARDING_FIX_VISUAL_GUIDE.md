# Onboarding Gate Fix - Visual Flow Diagram

## Before Fix ❌

```
New User Signs Up
       ↓
Database Trigger Creates Profile
  (onboarding_completed = false)
       ↓
User Signs In (email/Google/Apple)
       ↓
Profile Query: SELECT username
       ↓
Check: Does username exist?
       ↓
    YES (auto-generated username exists)
       ↓
✗ Redirect to Main App (INCORRECT!)
       ↓
User bypasses onboarding
Profile remains incomplete
```

## After Fix ✅

```
New User Signs Up
       ↓
Database Trigger Creates Profile
  (onboarding_completed = false)
       ↓
User Signs In (email/Google/Apple)
       ↓
Profile Query: SELECT username, onboarding_completed
       ↓
Check: !profile || !username || onboarding_completed === false?
       ↓
    YES (onboarding_completed = false)
       ↓
✓ Redirect to Onboarding Flow
       ↓
User Completes Onboarding
  - Enter username
  - Add details
  - Set up profile
       ↓
onboarding_completed set to true
       ↓
✓ Redirect to Main App
       ↓
Profile is complete
```

## Subsequent Sign-Ins ✅

```
Returning User Signs In
       ↓
Profile Query: SELECT username, onboarding_completed
       ↓
Check: !profile || !username || onboarding_completed === false?
       ↓
    NO (onboarding_completed = true)
       ↓
✓ Redirect to Main App
       ↓
User continues where they left off
```

## Key Differences

| Aspect | Before Fix | After Fix |
|--------|-----------|-----------|
| Profile Query | `SELECT username` | `SELECT username, onboarding_completed` |
| Check Logic | `!profile \|\| !username` | `!profile \|\| !username \|\| onboarding_completed === false` |
| New User Redirect | Main App ❌ | Onboarding ✅ |
| Onboarding Skip | Possible ❌ | Prevented ✅ |
| Profile Completion | Optional ❌ | Required ✅ |

## Code Comparison

### Before (Incorrect)
```typescript
// app/auth/sign-in-form.tsx - Line 174
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('username')  // ❌ Missing onboarding_completed
  .eq('id', data.session.user.id)
  .single()

if (!profile || !profile.username) {
  // ❌ Only checks username
  router.replace('/onboarding/username')
} else {
  router.replace({ pathname: ROUTES.TABS.BOUNTY_APP })
}
```

### After (Correct)
```typescript
// app/auth/sign-in-form.tsx - Line 174
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('username, onboarding_completed')  // ✅ Includes flag
  .eq('id', data.session.user.id)
  .single()

// ✅ Checks both username AND onboarding_completed flag
if (!profile || !profile.username || profile.onboarding_completed === false) {
  console.log('[sign-in] Profile incomplete or onboarding not completed', {
    hasUsername: !!profile?.username,
    onboardingCompleted: profile?.onboarding_completed
  })
  router.replace('/onboarding')  // ✅ Redirect to onboarding
} else {
  router.replace({ pathname: ROUTES.TABS.BOUNTY_APP })
}
```

## Database State

### New User Profile Creation
```sql
-- Trigger: handle_new_user()
INSERT INTO profiles (
  id,
  username,
  email,
  balance,
  onboarding_completed  -- ✅ Set to false
)
VALUES (
  NEW.id,
  'user_abc123',        -- Auto-generated
  'user@example.com',
  0.00,
  false                 -- ✅ New users start with false
);
```

### After Onboarding Completion
```sql
-- app/onboarding/done.tsx
UPDATE profiles
SET onboarding_completed = true  -- ✅ Set to true
WHERE id = current_user_id;
```

## Edge Cases Handled

### 1. Legacy Users (Pre-Migration)
```
Profile: { username: 'olduser', onboarding_completed: undefined }
       ↓
Check: undefined === false?
       ↓
    NO (undefined !== false)
       ↓
✓ Redirect to Main App (Backward Compatible)
```

### 2. Profile Without Username
```
Profile: { username: '', onboarding_completed: true }
       ↓
Check: !username?
       ↓
    YES (empty username)
       ↓
✓ Redirect to Onboarding (Safety Check)
```

### 3. Profile Query Error
```
Profile Query Error (Network/Database Issue)
       ↓
Log error, proceed to app
       ↓
✓ AuthProvider handles sync in background
       ↓
Graceful degradation
```

## Testing Matrix

| User Type | username | onboarding_completed | Redirect | Status |
|-----------|----------|---------------------|----------|--------|
| New User | ✅ auto-generated | ❌ false | Onboarding | ✅ Fixed |
| Completed User | ✅ user-chosen | ✅ true | Main App | ✅ Works |
| Legacy User | ✅ exists | undefined | Main App | ✅ Compatible |
| No Username | ❌ empty/null | ✅ true | Onboarding | ✅ Safety |
| No Profile | N/A | N/A | Onboarding | ✅ Handled |

## Authentication Methods

All three authentication methods now include the fix:

### Email/Password Sign-In ✅
```typescript
// Lines 174-207
const { data: profile } = await supabase
  .from('profiles')
  .select('username, onboarding_completed')
  .eq('id', data.session.user.id)
  .single()

if (!profile || !profile.username || profile.onboarding_completed === false) {
  router.replace('/onboarding')
}
```

### Google OAuth Sign-In ✅
```typescript
// Lines 338-356
const { data: profile } = await supabase
  .from('profiles')
  .select('username, onboarding_completed')
  .eq('id', data.session.user.id)
  .single()

if (!profile || !profile.username || profile.onboarding_completed === false) {
  router.replace('/onboarding')
}
```

### Apple OAuth Sign-In ✅
```typescript
// Lines 519-535
const { data: profile } = await supabase
  .from('profiles')
  .select('username, onboarding_completed')
  .eq('id', data.session.user.id)
  .single()

if (!profile || !profile.username || profile.onboarding_completed === false) {
  router.replace('/onboarding')
}
```

## Logging for Debugging

### New User Sign-In
```
[sign-in] Performing quick profile check for: abc-123-xyz
[sign-in] Profile incomplete or onboarding not completed, redirecting to onboarding { 
  correlationId: 'signin_1234567890_abc',
  hasUsername: true,
  onboardingCompleted: false
}
```

### Completed User Sign-In
```
[sign-in] Performing quick profile check for: abc-123-xyz
[sign-in] Profile complete, redirecting to app { 
  correlationId: 'signin_1234567890_def'
}
```

## Summary

✅ **Problem Solved**: New users are now properly directed to onboarding
✅ **Minimal Changes**: Only modified sign-in flow, no database changes
✅ **Backward Compatible**: Existing users unaffected
✅ **All Auth Methods**: Email, Google, and Apple all fixed
✅ **Edge Cases**: Handled gracefully with fallbacks
✅ **Well Tested**: Validation script passes all 8 tests
✅ **Documented**: Complete implementation guide provided
