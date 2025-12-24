# Quick Testing Guide - Onboarding Redirect Fix

## Prerequisites
- Access to a test environment or development build
- Ability to clear app data / reinstall app
- Test user accounts (or ability to create new ones)

## Test Scenarios

### Scenario 1: New User Signup ✨
**Goal**: Verify new users go through onboarding once

**Steps**:
1. Open app (not signed in)
2. Click "Sign Up"
3. Complete signup with new email
4. Verify email and sign in
5. **Expected**: Redirected to onboarding (/onboarding/username)
6. Complete onboarding (username, details, phone, etc.)
7. **Expected**: Redirected to main app (/tabs/bounty-app)
8. Close and reopen app
9. **Expected**: Still in main app (no onboarding redirect)
10. Check database: `onboarding_completed = true`

**Success Criteria**:
- ✅ New user sees onboarding
- ✅ After completion, goes to main app
- ✅ On refresh, stays in main app
- ✅ Database flag set to true

### Scenario 2: Returning User ✨
**Goal**: Verify completed users bypass onboarding

**Steps**:
1. Sign in with existing user who has completed onboarding
2. **Expected**: Immediately redirected to main app
3. Observe no flash of onboarding screen
4. Force quit and reopen app
5. **Expected**: Still goes directly to main app
6. Sign out and sign back in
7. **Expected**: Goes directly to main app

**Success Criteria**:
- ✅ No onboarding screen shown
- ✅ No flash/flicker during loading
- ✅ Consistent behavior across refreshes
- ✅ Database shows `onboarding_completed = true`

### Scenario 3: Interrupted Onboarding 🔄
**Goal**: Verify partial onboarding can be resumed

**Steps**:
1. Sign up with new user
2. Start onboarding (enter username)
3. Force quit app before completing
4. Reopen app
5. **Expected**: Returns to onboarding (not main app)
6. Complete onboarding
7. **Expected**: Goes to main app
8. Refresh
9. **Expected**: Stays in main app

**Success Criteria**:
- ✅ Partial progress preserved
- ✅ User can complete onboarding
- ✅ After completion, no more onboarding

### Scenario 4: Legacy User (Migration) 👴
**Goal**: Verify users from before flag treat as completed

**Note**: This requires a user created before the `onboarding_completed` migration

**Steps**:
1. Query database: `SELECT onboarding_completed FROM profiles WHERE username = 'legacy_user'`
2. **Expected**: `null` or `undefined`
3. Sign in as this user
4. **Expected**: Goes directly to main app (not onboarding)
5. Check console logs: Should show treating undefined as completed

**Success Criteria**:
- ✅ Legacy users bypass onboarding
- ✅ No need for manual migration of user data

### Scenario 5: Unauthenticated User 🔐
**Goal**: Verify proper fallback for non-authenticated users

**Steps**:
1. Open app when signed out
2. **Expected**: Shows sign-in form (not onboarding)
3. Try to navigate without signing in
4. **Expected**: Stays on sign-in form

**Success Criteria**:
- ✅ Unauthenticated users see sign-in
- ✅ Not redirected to onboarding without auth

## Console Log Verification

### What to Look For

**New User First Login**:
```
[AuthProvider] Session loaded: authenticated
[AuthProvider] Profile update received, setting isLoading to false: { hasSession: true, hasProfile: true, username: 'newuser123' }
[index] Routing decision: { hasUsername: true, onboardingFlag: false, needsOnboarding: true, userId: '...' }
[index] Redirecting to onboarding
```

**Completed User Login**:
```
[AuthProvider] Session loaded: authenticated
[AuthProvider] Profile update received, setting isLoading to false: { hasSession: true, hasProfile: true, username: 'completeduser' }
[index] Routing decision: { hasUsername: true, onboardingFlag: true, needsOnboarding: false, userId: '...' }
[index] Redirecting to main app
```

**Legacy User Login**:
```
[index] Routing decision: { hasUsername: true, onboardingFlag: undefined, needsOnboarding: false, userId: '...' }
[index] Redirecting to main app
```

**Onboarding Completion**:
```
[Onboarding] Successfully marked onboarding as complete in database
[Onboarding] Notification permissions granted
```

## Database Verification

### Check Onboarding Status
```sql
-- See distribution of onboarding status
SELECT 
  CASE 
    WHEN onboarding_completed IS NULL THEN 'null/legacy'
    WHEN onboarding_completed = true THEN 'completed'
    WHEN onboarding_completed = false THEN 'incomplete'
  END as status,
  COUNT(*) as count
FROM profiles
GROUP BY onboarding_completed;
```

### Check Specific User
```sql
SELECT 
  id,
  username,
  onboarding_completed,
  created_at,
  updated_at
FROM profiles
WHERE email = 'test@example.com';
```

### Verify New Users Start with False
```sql
-- Check recently created profiles
SELECT 
  username,
  onboarding_completed,
  created_at
FROM profiles
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

-- Should see onboarding_completed = false for new users
```

## Common Issues & Fixes

### Issue: User stuck in onboarding loop
**Symptom**: User completes onboarding but is sent back to onboarding on refresh

**Check**:
1. Console logs - is `onboarding_completed` being set in database?
2. Database - does the user have `onboarding_completed = true`?
3. Are there errors in the `done.tsx` completion logic?

**Fix**: Manually set flag in database:
```sql
UPDATE profiles 
SET onboarding_completed = true 
WHERE id = 'user-id-here';
```

### Issue: New user bypasses onboarding
**Symptom**: New signup goes directly to main app

**Check**:
1. Database - is `onboarding_completed` set to false for new users?
2. Is the profile being created with the correct default?
3. Check auth-profile-service.ts createMinimalProfile function

**Fix**: Manually set flag:
```sql
UPDATE profiles 
SET onboarding_completed = false 
WHERE id = 'user-id-here';
```

### Issue: Legacy users forced through onboarding
**Symptom**: Existing users see onboarding unexpectedly

**Check**:
1. Database - is `onboarding_completed` null/undefined?
2. Does the user have a username?
3. Check routing logic in index.tsx

**Fix**: Set legacy users to completed:
```sql
UPDATE profiles 
SET onboarding_completed = true 
WHERE username IS NOT NULL 
  AND username != '' 
  AND onboarding_completed IS NULL;
```

## Performance Checks

### Profile Loading Time
- Should complete within 1-2 seconds
- Check for race condition logs in AuthProvider
- Verify `isLoading` becomes false only after profile loads

### Navigation Smoothness
- No visible flash between screens
- Smooth transition from splash to app/onboarding
- Loading indicator should be brief

## Security Verification

### Unauthenticated Access
- ✅ Cannot access main app without signing in
- ✅ Cannot bypass onboarding by URL manipulation
- ✅ Session properly validated

### Profile Data
- ✅ Users can only update their own profile
- ✅ Onboarding completion flag cannot be spoofed
- ✅ RLS policies enforce proper access

## Automation Test Script

Run the validation script:
```bash
cd /home/runner/work/Bounty-production/Bounty-production
node scripts/validate-onboarding-logic.js
```

Should output:
```
✨ All tests passed! Logic is correct.
```

## Checklist Summary

- [ ] New user signup → onboarding → app → refresh → app
- [ ] Returning user → app (no onboarding)
- [ ] Interrupted onboarding → resume → complete → app
- [ ] Legacy user → app (no onboarding)
- [ ] Unauthenticated → sign-in form
- [ ] Console logs show correct routing decisions
- [ ] Database flags set correctly
- [ ] No visual flashing or glitches
- [ ] Validation script passes

## Reporting Issues

If you encounter issues during testing:

1. **Collect Logs**: Copy console logs showing routing decisions
2. **Database State**: Query and include the user's profile data
3. **Steps to Reproduce**: Exact sequence that causes the issue
4. **Expected vs Actual**: What should happen vs what does happen
5. **Environment**: Development/staging/production

## Success Criteria

The fix is successful if:
- ✅ New users see onboarding exactly once
- ✅ Completed users never see onboarding again
- ✅ Legacy users are not affected
- ✅ No console errors or race conditions
- ✅ All validation tests pass
- ✅ Database flags are accurate
- ✅ User experience is smooth and predictable
