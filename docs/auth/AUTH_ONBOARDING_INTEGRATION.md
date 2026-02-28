# Authentication & Onboarding Integration

## Overview

This document describes the integration of the authentication profile service with the login/signup and onboarding workflows to ensure that all authenticated users have properly synced profile data.

## Problem Addressed

The original implementation had gaps:

1. **Detached Auth Users**: Users could exist in `auth.users` table without corresponding records in the `profiles` table
2. **No Onboarding Check**: Sign-in/sign-up flows didn't verify profile completion before allowing app access
3. **Local-Only Onboarding**: Onboarding data was stored locally but not synced to Supabase profiles table
4. **Race Conditions**: Multiple attempts to create profiles could cause conflicts

## Solution

### 1. Enhanced Sign-In Flow

**File: `app/auth/sign-in-form.tsx`**

After successful authentication, the app now:
1. Checks if user has a profile record in Supabase `profiles` table
2. Verifies the profile has a username (indicating onboarding completion)
3. Routes to onboarding if profile is missing or incomplete
4. Routes to main app if profile is complete

```typescript
// After successful sign-in
if (data.session) {
  // Check if user has completed onboarding
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', data.session.user.id)
    .single()
  
  if (!profile || !profile.username) {
    // User needs to complete onboarding
    router.replace('/onboarding/username')
  } else {
    // User has completed onboarding
    router.replace({ pathname: ROUTES.TABS.BOUNTY_APP })
  }
}
```

This check is applied to:
- Email/password sign-in
- Google OAuth sign-in
- Apple sign-in (iOS)

### 2. Enhanced Sign-Up Flow

**File: `app/auth/sign-up-form.tsx`**

New users are always routed to onboarding:
```typescript
if (data.session) {
  // New users always need to complete onboarding
  router.replace('/onboarding/username')
}
```

### 3. Onboarding Integration with AuthProfileService

All onboarding screens now sync data with both local storage and Supabase:

#### Username Screen
**File: `app/onboarding/username.tsx`**

- Uses `useAuthProfile()` hook for Supabase integration
- Checks if profile exists in Supabase before creating/updating
- Syncs username to both local storage and Supabase profiles table
- Handles race conditions gracefully

```typescript
// Check if profile exists
const { data: existingProfile } = await supabase
  .from('profiles')
  .select('id')
  .eq('id', userId)
  .single();

if (existingProfile) {
  // Update existing profile
  await updateAuthProfile({ username });
} else {
  // Create new profile in Supabase
  await supabase.from('profiles').insert({
    id: userId,
    username,
    balance: 0,
  });
}
```

#### Details Screen
**File: `app/onboarding/details.tsx`**

- Syncs display name and location to local storage
- Syncs location to Supabase `profiles.about` field
- Uses AuthProfileService for persistence

#### Phone Screen
**File: `app/onboarding/phone.tsx`**

- Syncs phone number to both local storage and Supabase
- Maintains privacy (phone never displayed in UI)
- Uses AuthProfileService for secure storage

### 4. Enhanced AuthProfileService

**File: `lib/services/auth-profile-service.ts`**

Improved `createMinimalProfile()` method:

1. **Race Condition Protection**: Checks if profile was created concurrently
2. **Duplicate Key Handling**: Gracefully handles conflicts
3. **Better Logging**: Tracks profile creation for debugging
4. **Email-Based Username**: Uses email prefix as temporary username

```typescript
// Check for concurrent creation
const { data: existing } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single();

if (existing) {
  // Use existing profile
  return existing;
}

// Handle duplicate key errors
if (error.code === '23505') {
  // Fetch and return existing profile
}
```

## User Flows

### New User Registration

```
Sign Up
  ↓
Create Auth User (Supabase Auth)
  ↓
Route to /onboarding/username
  ↓
User enters username
  ↓
Create profile in Supabase profiles table
  ↓
Sync with AuthProfileService
  ↓
Continue to /onboarding/details
  ↓
User enters display name & location
  ↓
Update profile in Supabase
  ↓
Continue to /onboarding/phone
  ↓
User enters phone (optional)
  ↓
Update profile in Supabase
  ↓
Complete onboarding
  ↓
Navigate to main app
```

### Existing User Sign-In (With Profile)

```
Sign In
  ↓
Authenticate (Supabase Auth)
  ↓
Check profiles table
  ↓
Profile exists with username ✓
  ↓
Navigate to main app
```

### Detached Auth User (No Profile)

```
Sign In
  ↓
Authenticate (Supabase Auth)
  ↓
Check profiles table
  ↓
Profile missing or no username ✗
  ↓
Route to /onboarding/username
  ↓
Complete onboarding
  ↓
Navigate to main app
```

### OAuth Sign-In (Google/Apple) - New User

```
OAuth Sign In
  ↓
Create Auth User (Supabase Auth)
  ↓
Check profiles table
  ↓
Profile doesn't exist
  ↓
Route to /onboarding/username
  ↓
Complete onboarding
  ↓
Navigate to main app
```

### OAuth Sign-In (Google/Apple) - Existing User

```
OAuth Sign In
  ↓
Authenticate (Supabase Auth)
  ↓
Check profiles table
  ↓
Profile exists ✓
  ↓
Navigate to main app
```

## Data Synchronization

### Profile Data Flow

```
Onboarding Input
       ↓
   ┌───────────────────┐
   │ Local Storage     │ ← useUserProfile()
   │ (AsyncStorage)    │
   └───────────────────┘
       ↓
   ┌───────────────────┐
   │ Supabase profiles │ ← useAuthProfile()
   │ table             │
   └───────────────────┘
       ↓
   ┌───────────────────┐
   │ AuthProfileService│
   │ (cache + sync)    │
   └───────────────────┘
       ↓
   App Components
```

### Profile Fields Mapping

| Onboarding Field | Local Storage Key | Supabase Column |
|------------------|-------------------|-----------------|
| Username | `username` | `username` |
| Display Name | `displayName` | N/A (local only) |
| Location | `location` | `about` |
| Phone | `phone` | `phone` |
| Avatar | `avatar` | `avatar` |

## Error Handling

### Profile Creation Failures

1. **Network Error**: User sees error message, can retry
2. **Duplicate Username**: Validation prevents submission
3. **Concurrent Creation**: Service handles gracefully
4. **Missing Auth Session**: User redirected to sign-in

### Detached Auth Users

1. **Detection**: Profile check after authentication
2. **Recovery**: Automatic routing to onboarding
3. **Profile Creation**: Handled during onboarding
4. **Fallback**: Minimal profile created if needed

## Security Considerations

1. **Phone Privacy**: Phone numbers stored but never displayed
2. **User ID Validation**: All operations verify authenticated user
3. **Profile Ownership**: Users can only edit their own profile
4. **RLS Policies**: Supabase enforces row-level security

## Testing Scenarios

### Test 1: New User Sign-Up
1. Sign up with email/password
2. Verify routed to /onboarding/username
3. Complete onboarding
4. Verify profile created in Supabase
5. Verify successful app access

### Test 2: Detached Auth User
1. Manually create auth user without profile
2. Sign in with credentials
3. Verify routed to /onboarding/username
4. Complete onboarding
5. Verify profile created and linked

### Test 3: OAuth New User
1. Sign in with Google (first time)
2. Verify routed to /onboarding/username
3. Complete onboarding
4. Verify profile created in Supabase

### Test 4: Returning User
1. Sign in with existing account
2. Verify profile check passes
3. Verify direct navigation to app
4. Verify no onboarding prompt

### Test 5: Incomplete Onboarding
1. Start onboarding, exit before completion
2. Sign out, sign back in
3. Verify routed back to onboarding
4. Complete onboarding
5. Verify successful app access

### Test 6: Race Condition
1. Trigger concurrent profile creation
2. Verify no duplicate profiles
3. Verify one profile wins
4. Verify no errors displayed

## Migration Path

### For Existing Users

Existing users with profiles in Supabase will:
1. Sign in normally
2. Pass profile check
3. Continue to app without interruption

### For Detached Auth Users

Users with auth accounts but no profiles will:
1. Sign in normally
2. Fail profile check
3. Be routed to onboarding
4. Complete profile creation
5. Continue to app

### For New Users

New users will:
1. Sign up
2. Automatically route to onboarding
3. Create profile during onboarding
4. Access app after completion

## Monitoring & Debugging

### Log Points

1. **Profile Check**: Log result of profile query after auth
2. **Profile Creation**: Log successful profile creation
3. **Onboarding Completion**: Log when user completes onboarding
4. **Race Conditions**: Log concurrent profile creation attempts

### Console Messages

```typescript
'[sign-in] User has profile, navigating to app'
'[sign-in] User needs onboarding, navigating to username screen'
'[onboarding] Profile created successfully'
'[auth-profile-service] Created minimal profile for new user'
'[auth-profile-service] Profile already exists (concurrent creation)'
```

## Performance Considerations

1. **Profile Check**: Single query after authentication (~100ms)
2. **Onboarding Sync**: Parallel updates to local + Supabase (~200ms)
3. **Cache**: AuthProfileService uses 5-minute cache
4. **Network**: Minimal additional requests

## Future Enhancements

1. **Profile Completion Percentage**: Track how complete user profile is
2. **Onboarding Skip Options**: Allow users to complete later
3. **Social Login Profile Import**: Auto-fill from OAuth provider data
4. **Profile Verification**: Email/phone verification during onboarding
5. **Avatar Upload**: Add during onboarding
6. **Skills Selection**: Add to onboarding flow

---

**Last Updated**: 2025-10-10  
**Version**: 1.1.0  
**Status**: Production Ready ✅
