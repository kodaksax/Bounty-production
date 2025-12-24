# Authentication State and Onboarding Redirect Fix

## Issue Summary
**Problem**: Users who completed onboarding were being incorrectly redirected to the onboarding flow on app refresh, causing loss of progress and confusion.

**Root Causes**:
1. Multiple conflicting checks for onboarding completion
2. Inconsistent AsyncStorage keys (`@bounty_onboarding_complete` vs `@bounty_onboarding_completed`)
3. Redundant onboarding checks in bounty-app.tsx overriding correct routing
4. New users not explicitly marked with `onboarding_completed = false`
5. Race condition between session loading and profile fetching (documented in AUTH_RACE_CONDITION_FIX.md)

## Solution Overview

### Key Principle: Single Source of Truth
The database `onboarding_completed` flag is now the single source of truth for determining if a user needs onboarding.

**Routing Logic** (in `app/index.tsx`):
- `onboarding_completed === false` → Go to onboarding
- `onboarding_completed === true` → Go to main app
- `onboarding_completed === undefined` → Treat as completed (legacy profiles)
- No username → Go to onboarding (safety check)

## Changes Made

### 1. app/index.tsx - Central Routing Logic
**File**: `/app/index.tsx`

**Changes**:
```typescript
// OLD: Treated undefined as incomplete
const onboardingComplete = profileData?.onboarding_completed !== false

// NEW: Treat undefined as completed (legacy), only explicit false needs onboarding
const onboardingFlag = profileData?.onboarding_completed
const needsOnboarding = !hasUsername || onboardingFlag === false
```

**Why**: 
- Legacy profiles (created before the flag) have `undefined` - they completed onboarding before the flag existed
- New users get `onboarding_completed = false` explicitly
- Only redirect to onboarding if flag is explicitly false OR username is missing

**Added**: Detailed console logging for debugging routing decisions

### 2. app/tabs/bounty-app.tsx - Remove Redundant Check
**File**: `/app/tabs/bounty-app.tsx`

**Removed**:
```typescript
// Removed entire useEffect that checked onboarding status
useEffect(() => {
  const checkOnboarding = async () => {
    const onboardingComplete = await storage.getItem('@bounty_onboarding_completed');
    if (!isComplete || onboardingComplete !== 'true') {
      router.push('/onboarding/username');
    }
  };
  checkOnboarding();
}, [profileLoading, isComplete, hasCheckedOnboarding, router]);
```

**Why**: 
- This created a second routing decision point that could override the correct routing from index.tsx
- The AsyncStorage check (`@bounty_onboarding_completed`) was conflicting with the database flag
- `app/index.tsx` is the proper auth gate and should be the only place making initial routing decisions

### 3. app/onboarding/done.tsx - Enhanced Completion Marking
**File**: `/app/onboarding/done.tsx`

**Enhanced**:
```typescript
// Set the permanent completion flag in AsyncStorage for backward compatibility
await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');

// IMPORTANT: Update the Supabase profile to mark onboarding as complete
// This is the source of truth for determining if a user should see onboarding
if (userId) {
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', userId);
}

// Clean up temporary onboarding state from carousel flow
await AsyncStorage.removeItem('@bounty_onboarding_complete');
```

**Why**:
- Explicitly sets the database flag to `true` when onboarding completes
- Cleans up conflicting AsyncStorage keys
- Added proper logging for debugging

### 4. lib/services/auth-profile-service.ts - New User Flag
**File**: `/lib/services/auth-profile-service.ts`

**Added**:
```typescript
const insertData: Record<string, any> = {
  id: userId,
  username: username,
  email: email,
  balance: 0,
  age_verified: age_verified,
  onboarding_completed: false, // NEW: Mark new users as not completed
};
```

**Why**:
- New users are explicitly marked with `onboarding_completed = false`
- This ensures they go through onboarding
- Without this, new users would have `undefined` and be treated as completed

### 5. app/onboarding/username.tsx - Profile Creation Flag
**File**: `/app/onboarding/username.tsx`

**Added**:
```typescript
const { error: insertError } = await supabase
  .from('profiles')
  .insert({
    id: userId,
    username,
    balance: 0,
    onboarding_completed: false, // User is in onboarding, not yet completed
  });
```

**Why**:
- Handles edge case where profile is created during onboarding (not through auth-profile-service)
- Ensures consistency - any profile created during onboarding has `onboarding_completed = false`

## Flow Diagrams

### New User Flow
```
1. User signs up
   ↓
2. AuthProfileService creates minimal profile with onboarding_completed = false
   ↓
3. app/index.tsx checks profile
   ↓
4. onboarding_completed === false → Redirect to /onboarding/username
   ↓
5. User completes onboarding
   ↓
6. app/onboarding/done.tsx sets onboarding_completed = true in database
   ↓
7. User navigates to /tabs/bounty-app
   ↓
8. On next app launch, index.tsx sees onboarding_completed === true → Main app
```

### Returning User Flow (Completed Onboarding)
```
1. User opens app
   ↓
2. AuthProvider loads session and profile (with race condition fix)
   ↓
3. app/index.tsx checks profile
   ↓
4. onboarding_completed === true → Redirect to /tabs/bounty-app
   ↓
5. User continues using app
```

### Legacy User Flow (Profile Before Flag)
```
1. Existing user opens app
   ↓
2. AuthProvider loads session and profile
   ↓
3. Profile has onboarding_completed === undefined (created before flag existed)
   ↓
4. app/index.tsx treats undefined as completed (legacy behavior)
   ↓
5. Has username → Redirect to /tabs/bounty-app
   ↓
6. User continues using app
```

## Database Schema

### Migration: 20251122_add_onboarding_completed.sql
```sql
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Set existing profiles to true (assume they've already gone through onboarding)
UPDATE profiles 
  SET onboarding_completed = true 
  WHERE username IS NOT NULL AND username != '';
```

**Key Points**:
- Default value is `false` for new profiles
- Existing profiles with usernames are migrated to `true`
- This ensures backward compatibility with existing users

## AsyncStorage Keys

### Clarified Usage
- `@bounty_onboarding_complete`: Temporary flag set when carousel is viewed (still used for carousel skip logic)
- `@bounty_onboarding_completed`: Backward compatibility flag set when onboarding completes
- **Database `onboarding_completed`**: **PRIMARY SOURCE OF TRUTH** for routing decisions

### Cleanup Strategy
When onboarding completes:
1. Set `@bounty_onboarding_completed = 'true'` (backward compatibility)
2. Remove `@bounty_onboarding_complete` (carousel tracking)
3. Set database `onboarding_completed = true` (source of truth)

## Testing Checklist

### Manual Testing Required
- [ ] **New User**: Sign up → Goes to onboarding → Completes → Goes to app → Refresh → Stays in app
- [ ] **Returning User**: Open app → Goes directly to app (no onboarding flash)
- [ ] **Legacy User**: User from before flag → Opens app → Goes to app (treated as completed)
- [ ] **Interrupted Onboarding**: Sign up → Start onboarding → Close app → Reopen → Returns to onboarding
- [ ] **No Flash**: No momentary flash of onboarding screen for completed users
- [ ] **Sign Out/In**: Sign out → Sign in as completed user → Goes to app
- [ ] **Fallback**: Unauthenticated user → Shows sign-in form (not onboarding)

### Log Verification
Check console logs for proper routing decisions:
```
[index] Routing decision: { hasUsername: true, onboardingFlag: true, needsOnboarding: false }
[index] Redirecting to main app
```

### Database Verification
Query profiles table to verify flag is set correctly:
```sql
-- Check flag distribution
SELECT 
  onboarding_completed,
  COUNT(*) as count
FROM profiles
GROUP BY onboarding_completed;

-- Should see:
-- true: existing users
-- false: new users who haven't completed
-- null: legacy users (treated as completed in code)
```

## Related Documentation
- [AUTHENTICATION_RACE_CONDITION_FIX.md](./AUTHENTICATION_RACE_CONDITION_FIX.md) - Race condition fix for profile loading
- [AUTH_STATE_PERSISTENCE.md](./AUTH_STATE_PERSISTENCE.md) - Authentication persistence implementation
- [AUTH_ONBOARDING_INTEGRATION.md](./AUTH_ONBOARDING_INTEGRATION.md) - Auth and onboarding integration

## Benefits

1. **Consistent Behavior**: Users no longer lose progress on refresh
2. **Single Source of Truth**: Database flag is authoritative, reducing conflicts
3. **Legacy Compatible**: Existing users without the flag are treated correctly
4. **New User Ready**: New signups explicitly marked as needing onboarding
5. **Better Debugging**: Added logging for routing decisions
6. **Reduced Complexity**: Removed redundant checks and conflicting logic

## Deployment Notes

### No Breaking Changes
- Existing users continue working (treated as completed)
- New users get proper onboarding flow
- Database migration already applied
- No environment variable changes needed

### Monitoring
After deployment, monitor for:
- Users stuck in onboarding loop (should not happen)
- Users incorrectly bypassing onboarding (should not happen)
- Console logs showing unexpected routing decisions

## Future Improvements

1. **Add Tests**: Unit tests for routing logic in index.tsx
2. **Add Telemetry**: Track onboarding completion rates and user flows
3. **Add Timeout**: Handle case where profile loading takes too long
4. **User Feedback**: Add subtle loading indicator during profile check
5. **Admin Tools**: Admin dashboard to view user onboarding status

## Conclusion

This fix resolves the critical issue of users being incorrectly sent to onboarding after completing it. By establishing the database `onboarding_completed` flag as the single source of truth and removing conflicting checks, we ensure:

1. New users go through onboarding exactly once
2. Returning users go directly to the app
3. Legacy users are handled correctly
4. No race conditions cause incorrect routing

The solution is minimal, maintainable, and backward compatible with existing user data.
