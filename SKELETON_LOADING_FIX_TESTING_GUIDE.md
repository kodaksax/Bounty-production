# Perpetual Skeleton Loading Fix - Manual Testing Guide

## Overview
This guide helps verify that the perpetual skeleton loading issue has been resolved by testing profile creation, loading state management, and error handling.

## Prerequisites
1. Access to Supabase dashboard
2. Ability to clear app data or use a fresh device/emulator
3. Test user credentials or ability to create new accounts

## Test Scenarios

### Scenario 1: New User Sign-Up
**Purpose**: Verify profile is automatically created during sign-up

**Steps**:
1. Clear app data or use a fresh install
2. Open the app
3. Sign up with a new email address
4. Complete the sign-up process

**Expected Results**:
- ✅ No perpetual skeleton loading screens
- ✅ App redirects to onboarding flow
- ✅ Profile screen loads within 10 seconds
- ✅ Check Supabase: `profiles` table should have a new row with:
  - `id` matching auth.users.id
  - `username` generated from email or UUID
  - `onboarding_completed` = false
  - `balance` = 0.00
  - `age_verified` based on sign-up metadata

**Database Verification** (via Supabase SQL Editor):
```sql
-- Check profile was created
SELECT p.id, p.username, p.email, p.onboarding_completed, p.created_at, u.email as auth_email
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'your-test-email@example.com';

-- Should return 1 row with matching IDs
```

### Scenario 2: Existing User Without Profile
**Purpose**: Verify profile is created when auth user exists but profile doesn't

**Steps**:
1. In Supabase dashboard, create a user in `auth.users` table
2. Do NOT create a corresponding `profiles` row
3. Use the user's credentials to sign in to the app
4. Observe the app behavior

**Expected Results**:
- ✅ App creates a minimal profile automatically
- ✅ No perpetual skeleton loading
- ✅ Profile screen loads within 10 seconds
- ✅ User is directed to complete onboarding

**Database Verification**:
```sql
-- Check profile was created for auth user
SELECT p.*, u.email
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE u.email = 'test-user@example.com';

-- Profile should exist now
```

### Scenario 3: Network Error During Profile Fetch
**Purpose**: Verify loading states are cleared even when network fails

**Steps**:
1. Sign in with valid credentials
2. Immediately enable Airplane Mode or disable network
3. Observe the app behavior

**Expected Results**:
- ✅ Skeleton screens appear briefly
- ✅ Within 10 seconds, loading states clear
- ✅ Either shows cached profile data OR
- ✅ Shows "Profile not found" or appropriate error message
- ✅ No infinite loading spinners

**Console Logs to Check**:
```
[AuthProvider] Safety timeout: forcing isLoading = false after 10s
[useNormalizedProfile] Safety timeout: forcing sbLoading = false after 8s
```

### Scenario 4: Supabase RLS Permission Issues
**Purpose**: Verify app handles permission errors gracefully

**Steps**:
1. In Supabase, temporarily disable INSERT permission on profiles table
2. Sign up with a new account
3. Observe the app behavior

**Expected Results**:
- ✅ App logs RLS permission error
- ✅ Loading state clears within 10 seconds
- ✅ Shows appropriate error message or fallback UI
- ✅ No perpetual skeleton loading

**Console Logs to Check**:
```
[authProfileService] Supabase RLS blocked profile insert
```

### Scenario 5: Race Condition - Concurrent Profile Creation
**Purpose**: Verify duplicate profile creation is handled correctly

**Steps**:
1. Sign up with a new account on two devices simultaneously using same email (if possible)
2. OR trigger rapid profile fetch/create cycles

**Expected Results**:
- ✅ Only one profile row is created in database
- ✅ Duplicate key errors are handled gracefully
- ✅ Existing profile is fetched and used
- ✅ No app crashes or perpetual loading

**Database Verification**:
```sql
-- Check for duplicate profiles (should be 0)
SELECT id, username, email, COUNT(*)
FROM profiles
GROUP BY id, username, email
HAVING COUNT(*) > 1;
```

### Scenario 6: Profile Screen Loading States
**Purpose**: Verify profile screens properly show and hide skeleton loaders

**Steps**:
1. Sign in with valid credentials
2. Navigate to Profile tab
3. Pull to refresh
4. Navigate away and back to Profile tab

**Expected Results**:
- ✅ Initial load: skeleton shows briefly, then real content
- ✅ Refresh: skeleton shows briefly, then updated content
- ✅ Navigation: cached content or brief skeleton, then current content
- ✅ Maximum skeleton display time: 8-10 seconds
- ✅ No infinite skeleton displays

### Scenario 7: Postings Screen Loading States
**Purpose**: Verify postings screen handles missing/loading profiles

**Steps**:
1. Sign in with valid credentials
2. Navigate to Postings tab
3. Switch between tabs (New, In Progress, My Postings, Requests)
4. Pull to refresh on each tab

**Expected Results**:
- ✅ Skeleton loaders show briefly on each tab
- ✅ Empty states or data appear within 3 seconds
- ✅ No perpetual skeleton loading
- ✅ Tabs without data show appropriate empty states

### Scenario 8: Onboarding Completion Tracking
**Purpose**: Verify onboarding status is properly tracked

**Steps**:
1. Sign up with a new account
2. Check `onboarding_completed` in database (should be false)
3. Complete onboarding flow
4. Check `onboarding_completed` again (should be true)

**Expected Results**:
- ✅ New profiles have `onboarding_completed` = false
- ✅ After completing onboarding, flag is set to true
- ✅ Returning users see main app, not onboarding

**Database Verification**:
```sql
-- Check onboarding status
SELECT id, username, onboarding_completed, created_at
FROM profiles
WHERE email = 'your-test-email@example.com';
```

## Console Logs to Monitor

### Successful Profile Creation:
```
[authProfileService] Profile not found (PGRST116), creating minimal profile
[authProfileService] Created minimal profile for new user
[AuthProvider] Profile update received, setting isLoading to false
```

### Error Handling:
```
[authProfileService] No cached profile available, returning null
[authProfileService] Notifying listeners with null
[AuthProvider] Safety timeout: forcing isLoading = false after 10s
```

### Profile Fetch Success:
```
[authProfileService] fetchAndSyncProfile START
[authProfileService] Supabase query completed
[authProfileService] Profile data mapped
[authProfileService] fetchAndSyncProfile SUCCESS
```

## Database Trigger Verification

### Check Trigger Exists:
```sql
-- Check if trigger function exists
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'handle_new_user';

-- Check if trigger is active
SELECT tgname, tgenabled, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';
```

### Test Trigger Manually:
```sql
-- Create a test user (this should auto-create profile)
-- DO NOT DO THIS IN PRODUCTION
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'trigger-test@example.com',
  crypt('testpassword123', gen_salt('bf')),
  NOW(),
  '{"age_verified": true}'::jsonb,
  NOW(),
  NOW()
);

-- Check if profile was created automatically
SELECT * FROM profiles WHERE email = 'trigger-test@example.com';
```

## Performance Benchmarks

### Loading Time Targets:
- Profile fetch (cached): < 100ms
- Profile fetch (network): < 2 seconds
- Profile creation: < 3 seconds
- Skeleton timeout (max): 10 seconds
- Skeleton timeout (normal): 8 seconds

### Monitoring:
Watch for these timing logs:
```
[AuthProvider] Profile update received, setting isLoading to false
Time since app start: [should be < 5 seconds]
```

## Troubleshooting

### If Skeleton Still Persists:
1. Check console for safety timeout logs
2. Verify Supabase connection (`isSupabaseConfigured`)
3. Check database trigger is installed
4. Verify RLS policies allow authenticated users to:
   - SELECT from profiles
   - INSERT into profiles where id = auth.uid()
5. Check for network connectivity
6. Clear app cache and try again

### If Profiles Aren't Created:
1. Verify trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created'`
2. Check trigger function: `SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user'`
3. Review Supabase logs for trigger errors
4. Check auth.users and profiles tables for orphaned records

## Success Criteria

All scenarios should pass with:
- ✅ No perpetual skeleton loading (max 10 seconds)
- ✅ Profiles automatically created on sign-up
- ✅ Loading states cleared on errors
- ✅ Appropriate error messages shown
- ✅ No app crashes
- ✅ Consistent behavior across multiple attempts

## Reporting Issues

If any scenario fails, collect:
1. Console logs (from app start to failure)
2. Database query results
3. Supabase logs
4. Device/emulator info
5. Network conditions
6. Steps to reproduce

## Additional Verification

### Code Quality:
- Run type checker: `npx tsc --noEmit`
- Run linter: `npm run lint`
- Run tests: `npm test`

### Database Integrity:
```sql
-- Check for auth users without profiles
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL;
-- Should return 0 rows

-- Check for profiles without auth users (orphaned)
SELECT p.id, p.username, p.email
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;
-- Should return 0 rows
```
