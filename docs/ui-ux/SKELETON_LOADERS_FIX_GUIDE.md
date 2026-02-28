# Skeleton Loaders Fix - Testing Guide

## Issue Fixed
Skeleton loaders were stuck in loading state and never showed real data from Supabase.

## Root Cause
When Supabase was not configured, `authProfileService` returned null immediately, causing loading to complete but with no data to display.

## Solution
Added fallback profile creation when Supabase is not configured, ensuring the app functions in development and degrades gracefully on errors.

---

## Testing Instructions

### Test 1: Without Supabase Configuration
**Purpose:** Verify app works in development without full Supabase setup

1. **Remove Supabase environment variables** (or use a fresh install without them):
   ```bash
   # Make sure these are NOT set or are invalid
   EXPO_PUBLIC_SUPABASE_URL=
   EXPO_PUBLIC_SUPABASE_ANON_KEY=
   ```

2. **Start the app:**
   ```bash
   npm start
   ```

3. **Check console logs** - You should see:
   ```
   [authProfileService] Supabase not configured - creating fallback profile
   [authProfileService] Using fallback profile: user_12345678
   ```

4. **Navigate to Profile screen:**
   - Skeleton loader should appear briefly
   - Should transition to show fallback profile:
     - Username: `user_12345678` (first 8 chars of user ID)
     - About: "Development user (Supabase not configured)"
     - Avatar: Default/placeholder
     - Stats: 0 jobs, 0 bounties, 0 badges

5. **Expected Result:** ✅ Profile displays with fallback data, no skeleton stuck

---

### Test 2: With Supabase Configuration
**Purpose:** Verify real data loads from Supabase when configured

1. **Set Supabase environment variables:**
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

2. **Start the app:**
   ```bash
   npm start
   ```

3. **Check console logs** - You should see:
   ```
   [authProfileService] Fetching profile from Supabase...
   [authProfileService] Profile loaded successfully: actual_username
   [authProfileService] Notified X listeners
   ```

4. **Navigate to Profile screen:**
   - Skeleton loader should appear briefly
   - Should transition to show REAL profile from database:
     - Username: Your actual username from database
     - Avatar: Your actual avatar if uploaded
     - About: Your actual bio
     - Stats: Real job/bounty counts

5. **Expected Result:** ✅ Profile displays with real data from database

---

### Test 3: Profile Not Found in Database
**Purpose:** Verify minimal profile creation when user doesn't exist yet

1. **With Supabase configured**, sign up as a **brand new user**

2. **Check console logs** - You should see:
   ```
   [authProfileService] Profile not found, creating minimal profile
   ```

3. **Navigate to Profile screen:**
   - Should show newly created minimal profile
   - Username should be generated from email or user ID
   - Should prompt for onboarding if `onboarding_completed = false`

4. **Expected Result:** ✅ New user gets minimal profile automatically

---

### Test 4: Network/Fetch Error
**Purpose:** Verify fallback behavior on network errors

1. **With Supabase configured**, **disconnect from network** or **use invalid Supabase URL**

2. **Check console logs** - You should see:
   ```
   [authProfileService] Error fetching profile: [error details]
   [authProfileService] Creating fallback profile due to error
   ```

3. **Navigate to Profile screen:**
   - Should show fallback profile with error message
   - About: "Error loading profile"
   - App should remain functional

4. **Expected Result:** ✅ Graceful degradation, no crash

---

### Test 5: Other Profile Screens
**Purpose:** Verify fix applies to all profile loading scenarios

Test these screens/components:

1. **User Profile Screen** (`/profile/[userId]`):
   - Navigate to another user's profile
   - Should load their profile or show fallback
   - ✅ No skeleton stuck

2. **Enhanced Profile Section** (in various contexts):
   - Own profile in profile screen
   - Other user profiles
   - ✅ All load properly

3. **Postings/Bounty cards** showing user avatars:
   - Should load profile data for poster
   - ✅ Avatars and usernames display

---

## Console Log Examples

### Success Case (Supabase Configured)
```
[authProfileService] setSession called, newUserId: abc-123-def-456
[authProfileService] Fetching and syncing profile for userId: abc-123-def-456
[authProfileService] Fetching profile from Supabase...
[authProfileService] Supabase fetch result: { hasData: true, error: null }
[authProfileService] Profile loaded successfully: john_doe
[authProfileService] Notified 3 listeners
[useNormalizedProfile] State: {
  localLoading: false,
  authHookLoading: false,
  sbLoading: false,
  loading: false,
  hasProfile: true,
  isViewingSelf: true
}
```

### Fallback Case (Supabase Not Configured)
```
[authProfileService] setSession called, newUserId: abc-123-def-456
[authProfileService] Fetching and syncing profile for userId: abc-123-def-456
[authProfileService] Supabase not configured - creating fallback profile
[authProfileService] Using fallback profile: user_abc12345
[authProfileService] Fetch and sync complete, profile: found
[useNormalizedProfile] State: {
  localLoading: false,
  authHookLoading: false,
  sbLoading: false,
  loading: false,
  hasProfile: true,
  isViewingSelf: true
}
```

---

## Troubleshooting

### Skeleton Still Stuck?

1. **Check console logs** - Look for:
   - `[useNormalizedProfile] State:` - Is `loading` stuck on `true`?
   - `[authProfileService]` - Any errors in profile fetch?

2. **Verify environment variables** are set correctly:
   ```bash
   npx expo config --type public | grep SUPABASE
   ```

3. **Check Supabase connection:**
   - URL format: `https://<project-ref>.supabase.co`
   - Anon key should be ~40+ characters (JWT token)
   - Project ref in URL should match ref in key

4. **Clear cache and restart:**
   ```bash
   npx expo start --clear
   ```

### Profile Shows Fallback Instead of Real Data?

1. **Check Supabase is configured:**
   ```javascript
   import { isSupabaseConfigured } from './lib/supabase';
   console.log('Supabase configured:', isSupabaseConfigured);
   ```

2. **Check profile exists in database:**
   - Go to Supabase Dashboard
   - Open `profiles` table
   - Search for your user ID
   - If missing, profile will be created on first access

3. **Check RLS policies:**
   - Ensure authenticated users can read their own profile
   - Policy: `auth.uid() = id`

---

## Success Indicators

✅ **Skeleton loaders appear briefly then transition to content**  
✅ **Profile data displays (either real or fallback)**  
✅ **No infinite loading spinners**  
✅ **Console logs show data loading flow**  
✅ **App remains functional even without Supabase**  
✅ **Clear error messages when configuration issues occur**  

---

## Related Files
- `lib/services/auth-profile-service.ts` - Profile fetching logic
- `hooks/useNormalizedProfile.ts` - Profile data aggregation
- `hooks/useAuthProfile.ts` - Auth profile subscription
- `app/tabs/profile-screen.tsx` - Profile screen UI
- `components/enhanced-profile-section.tsx` - Profile component

## Further Help
If issues persist after following this guide:
1. Share console logs showing the loading flow
2. Verify Supabase configuration with `isSupabaseConfigured`
3. Check network tab for failed requests
4. Verify profile exists in database
