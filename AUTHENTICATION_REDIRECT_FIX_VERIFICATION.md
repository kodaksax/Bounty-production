# Authentication Redirect Fix - Verification Guide

## Issue Fixed
Users were being redirected to onboarding flow on every refresh/reload, even after completing onboarding.

## Root Cause
The `app/index.tsx` routing logic only checked for `profile.username` existence without checking the `onboarding_completed` field that tracks whether a user has finished the onboarding flow.

## Solution
1. Added `onboarding_completed` field to the `AuthProfile` interface
2. Updated all profile mapping locations to fetch and include this field
3. Enhanced routing logic to check both username AND onboarding completion status

## Test Scenarios

### Scenario 1: Existing User with Completed Onboarding
**Expected Behavior:** User goes directly to the bounty app dashboard

**Steps:**
1. Sign in as an existing user who has completed onboarding
2. Verify you're on the bounty app dashboard (middle tab active)
3. Close and reopen the app
4. **VERIFY:** App loads directly to bounty app dashboard (no redirect to onboarding)
5. Pull to refresh on any screen
6. **VERIFY:** No redirect to onboarding occurs

**What to Look For:**
- No flash of the onboarding screen
- No navigation to `/onboarding/username`
- Console shows: `[index] Navigation error to main app:` or successful navigation

### Scenario 2: New User Without Profile
**Expected Behavior:** User is directed to onboarding flow

**Steps:**
1. Create a new account or use an account without a profile
2. **VERIFY:** User is redirected to `/onboarding/username`
3. Complete the username step
4. **VERIFY:** Can progress through onboarding normally

**What to Look For:**
- Immediate redirect to onboarding username screen
- Console shows: `[index] Navigation error to onboarding:` or successful navigation

### Scenario 3: User Who Started But Didn't Complete Onboarding
**Expected Behavior:** User is returned to onboarding

**Steps:**
1. Start onboarding but don't complete it (quit before reaching done screen)
2. Close the app
3. Reopen the app
4. **VERIFY:** User is returned to onboarding flow

**What to Look For:**
- Profile has `username` but `onboarding_completed` is `false`
- User is redirected to onboarding

### Scenario 4: User Completing Onboarding for First Time
**Expected Behavior:** After completing onboarding, user stays in the app

**Steps:**
1. Start as a new user or without a profile
2. Complete the entire onboarding flow to the "You're All Set!" screen
3. Tap "Start Exploring"
4. **VERIFY:** Navigate to bounty app dashboard
5. Close and reopen the app
6. **VERIFY:** User goes directly to bounty app (not back to onboarding)

**What to Look For:**
- `onboarding_completed` is set to `true` in the database after completing onboarding
- Subsequent app opens don't redirect to onboarding

### Scenario 5: Database Migration Verification
**Expected Behavior:** Existing profiles have `onboarding_completed = true`

**Steps:**
1. Check the database for existing profiles
2. **VERIFY:** Profiles with usernames have `onboarding_completed = true`
3. Sign in with an old account (created before this fix)
4. **VERIFY:** User is not redirected to onboarding

**What to Look For:**
- SQL: `SELECT id, username, onboarding_completed FROM profiles WHERE username IS NOT NULL`
- All should show `onboarding_completed = true`

## Code Changes Verification

### Check 1: AuthProfile Interface
**File:** `lib/services/auth-profile-service.ts`

Look for:
```typescript
export interface AuthProfile {
  // ... other fields
  onboarding_completed?: boolean; // Track if user has completed onboarding flow
}
```

### Check 2: Profile Mapping Locations
**File:** `lib/services/auth-profile-service.ts`

Verify `onboarding_completed` is mapped in:
1. `getProfileById()` - Line ~142
2. `fetchAndSyncProfile()` - Line ~242
3. `createMinimalProfile()` - Line ~362
4. `updateProfile()` - Line ~413

Each should have:
```typescript
onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
```

### Check 3: Routing Logic
**File:** `app/index.tsx`

Look for (around line 50-59):
```typescript
// User needs to complete onboarding if:
// 1. No profile exists, OR
// 2. Profile has no username, OR
// 3. onboarding_completed flag is explicitly false
// Note: onboarding_completed will be true for existing users (via migration)
// and undefined for very old profiles, so we treat undefined as completed
const hasUsername = profileData && profileData.username
const onboardingComplete = profileData?.onboarding_completed !== false

if (!hasUsername || !onboardingComplete) {
  // User needs to complete onboarding
  router.replace('/onboarding/username')
} else {
  // User has completed onboarding, go to main app
  router.replace(ROUTES.TABS.BOUNTY_APP)
}
```

## Console Logs to Monitor

### Successful Auth Load (Existing User)
```
[AuthProvider] Session loaded: authenticated
[AuthProvider] Profile update received, setting isLoading to false: {
  hasSession: true,
  hasProfile: true,
  username: 'user123'
}
```

### Profile with Onboarding Complete
Check the profile object in console logs - should see:
```javascript
{
  id: '...',
  username: '...',
  onboarding_completed: true,
  // ... other fields
}
```

### Navigation Decision
Look for navigation logs:
```
[index] Navigation error to main app: // or successful navigation
```

OR

```
[index] Navigation error to onboarding: // or successful navigation
```

## Common Issues and Fixes

### Issue: User still redirected to onboarding after fix
**Possible Causes:**
1. Profile not loaded yet (check `isLoading` state)
2. `onboarding_completed` field not in database (run migration)
3. Profile cache needs clearing

**Fix:**
- Clear AsyncStorage: `await AsyncStorage.clear()`
- Re-run migration: `20251122_add_onboarding_completed.sql`
- Check profile in database: `SELECT * FROM profiles WHERE id = '...'`

### Issue: New users can't access onboarding
**Possible Causes:**
1. Logic error in routing condition

**Debug:**
- Check if `profileData` is null or has no username
- Check if `onboardingComplete` evaluates correctly

## Performance Considerations

This fix adds one boolean field to the profile, which:
- ✅ Minimal memory overhead (1 byte per profile)
- ✅ No additional database queries (field is fetched with existing profile query)
- ✅ Fast evaluation (simple boolean check)
- ✅ Backward compatible (treats undefined as completed)

## Security Considerations

- ✅ No sensitive data exposed
- ✅ User cannot bypass onboarding by manipulating this field (server-side validation exists)
- ✅ AsyncStorage flag is a convenience, not the source of truth (database is authoritative)

## Rollback Plan

If issues arise, revert by:
1. Remove the `onboarding_completed` check from routing logic
2. Restore original logic: `if (!profileData || !profileData.username)`
3. Keep the field in the database (no harm, just unused)

## Success Criteria

✅ Existing users with completed onboarding go directly to app on refresh  
✅ New users are directed to onboarding  
✅ Users who quit mid-onboarding can resume  
✅ No flash of incorrect screen during navigation  
✅ Database migration applied successfully  
✅ All profile mapping locations include the new field  

## Monitoring

After deployment, monitor:
1. User retention (should improve if users were frustrated by re-onboarding)
2. Onboarding completion rate (should remain stable or improve)
3. Error logs for navigation failures
4. Support tickets about onboarding issues (should decrease)
