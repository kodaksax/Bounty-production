# Authentication & Profile Integration Guide

## Overview

This document describes the enhanced authentication and profile management system in BountyExpo, which ensures tight coupling between Supabase authentication and user profile data throughout the application.

## Architecture

### Core Components

1. **AuthProfileService** (`lib/services/auth-profile-service.ts`)
   - Singleton service managing authenticated user profile data
   - Handles Supabase profile CRUD operations
   - Maintains local cache with 5-minute expiry
   - Provides subscription mechanism for real-time updates
   - Automatically creates minimal profiles for new users

2. **useAuthProfile Hook** (`hooks/useAuthProfile.ts`)
   - React hook for accessing authenticated user profile
   - Subscribes to profile changes from AuthProfileService
   - Provides `updateProfile` and `refreshProfile` methods
   - Returns `profile`, `loading`, `userId` state

3. **AuthProvider** (`providers/auth-provider.tsx`)
   - Wraps entire app with authentication context
   - Syncs Supabase auth session with AuthProfileService
   - Notifies all listeners on auth state changes
   - Integrates with `useAuthContext()` hook

4. **getCurrentUserId()** (`lib/utils/data-utils.ts`)
   - Utility function to get authenticated user ID
   - Returns authenticated user ID or fallback
   - Used throughout app to ensure user context

## Data Flow

### Authentication Flow
```
User Login
  ↓
Supabase Auth
  ↓
AuthProvider.onAuthStateChange()
  ↓
authProfileService.setSession(session)
  ↓
Fetch/Create Profile from Supabase
  ↓
Cache Profile Locally
  ↓
Notify All Subscribers (useAuthProfile, etc.)
  ↓
UI Components Update
```

### Profile Update Flow
```
User Edits Profile
  ↓
EditProfileScreen.handleSave()
  ↓
updateProfile() (local userProfile service)
  ↓
updateAuthProfile() (Supabase sync)
  ↓
authProfileService.updateProfile()
  ↓
Update Supabase profiles table
  ↓
Update Local Cache
  ↓
Notify All Subscribers
  ↓
UI Components Update
```

### User Action Flow (e.g., Creating Bounty)
```
User Creates Bounty
  ↓
PostingsScreen.handlePost()
  ↓
getCurrentUserId() → Returns authenticated user ID
  ↓
bountyService.create({ user_id: currentUserId, ... })
  ↓
Bounty saved with correct user_id
  ↓
UI reflects user's bounty
```

## Usage Examples

### Getting Authenticated User Profile

```typescript
import { useAuthProfile } from '../hooks/useAuthProfile';

function MyComponent() {
  const { profile, loading, userId } = useAuthProfile();
  
  if (loading) return <Loading />;
  if (!profile) return <NotAuthenticated />;
  
  return (
    <View>
      <Text>Welcome, {profile.username}!</Text>
      <Text>Email: {profile.email}</Text>
      <Text>Balance: ${profile.balance}</Text>
    </View>
  );
}
```

### Updating User Profile

```typescript
import { useAuthProfile } from '../hooks/useAuthProfile';

function EditProfile() {
  const { profile, updateProfile } = useAuthProfile();
  
  const handleSave = async () => {
    const updated = await updateProfile({
      about: newAbout,
      avatar: newAvatar,
    });
    
    if (updated) {
      console.log('Profile updated successfully!');
    }
  };
  
  return (
    <Button onPress={handleSave}>Save Profile</Button>
  );
}
```

### Getting Current User ID

```typescript
import { getCurrentUserId } from 'lib/utils/data-utils';

function createBounty(bountyData) {
  const currentUserId = getCurrentUserId();
  
  const bounty = await bountyService.create({
    ...bountyData,
    user_id: currentUserId,
  });
}
```

### Checking if Profile is Own

```typescript
import { getCurrentUserId } from 'lib/utils/data-utils';

function ProfileScreen({ userId }) {
  const currentUserId = getCurrentUserId();
  const isOwnProfile = userId === currentUserId;
  
  return (
    <View>
      {isOwnProfile && <EditButton />}
      {!isOwnProfile && <FollowButton />}
    </View>
  );
}
```

## Profile Data Structure

### AuthProfile Interface
```typescript
interface AuthProfile {
  id: string;           // User ID from Supabase auth
  username: string;     // Unique username
  email?: string;       // User email
  avatar?: string;      // Avatar URL
  about?: string;       // Bio/description
  phone?: string;       // Phone number (stored, never displayed in UI)
  balance: number;      // Wallet balance
  created_at?: string;  // Profile creation timestamp
  updated_at?: string;  // Last update timestamp
}
```

## Integration Points

### 1. Postings Screen
- Uses `getCurrentUserId()` to set bounty owner
- Loads user's bounties with `bountyService.getByUserId(currentUserId)`
- Displays correct username based on current user ID

### 2. Messenger Screen
- Uses `getCurrentUserId()` to filter conversations
- Shows correct participant (other user) in conversations
- Enables navigation to correct user profiles

### 3. Profile Screens
- `/profile/index.tsx` redirects to current user's profile
- `/profile/edit.tsx` loads and updates authenticated user's profile
- `/profile/[userId].tsx` checks if viewing own profile with `isOwnProfile`

### 4. Profile Screen (Tab)
- Uses `useAuthProfile()` to display current user data
- Loads statistics for authenticated user
- Syncs profile updates from settings

### 5. Edit Profile Flow
- Updates local profile service (`useUserProfile`)
- Syncs changes to Supabase via `useAuthProfile`
- Notifies all subscribers of changes

## Error Handling

### Profile Not Found
```typescript
// AuthProfileService automatically creates minimal profile
if (!profile) {
  return await this.createMinimalProfile(userId);
}
```

### Supabase Not Configured
```typescript
if (!isSupabaseConfigured) {
  logger.error('Supabase not configured', { userId });
  // Falls back to cached profile or returns null
}
```

### Network Errors
```typescript
try {
  await authProfileService.updateProfile(updates);
} catch (error) {
  logger.error('Error updating profile', { error });
  // Returns null, UI shows error message
}
```

## Best Practices

### DO:
1. ✅ Use `getCurrentUserId()` instead of `CURRENT_USER_ID` constant
2. ✅ Use `useAuthProfile()` for authenticated user profile
3. ✅ Use `useAuthContext()` to check if user is logged in
4. ✅ Update both local and Supabase profiles when editing
5. ✅ Check `isOwnProfile` before showing edit buttons
6. ✅ Handle loading and error states properly

### DON'T:
1. ❌ Don't use hardcoded `CURRENT_USER_ID` constant
2. ❌ Don't bypass `authProfileService` for profile updates
3. ❌ Don't assume user is always authenticated
4. ❌ Don't mix up profile types (AuthProfile vs UserProfile)
5. ❌ Don't display phone numbers in UI (stored for backend only)
6. ❌ Don't forget to handle Supabase not configured scenario

## Testing

### Manual Testing Checklist

- [ ] Login with valid credentials
- [ ] Verify profile loads correctly after login
- [ ] Edit profile and verify changes persist
- [ ] Create bounty and verify user_id is correct
- [ ] View own profile and see edit button
- [ ] View other user's profile and see follow button
- [ ] Send message and verify correct sender
- [ ] Navigate between screens and verify user context preserved
- [ ] Logout and verify profile cleared
- [ ] Login again and verify cached profile restored

### Test Scenarios

1. **New User Registration**
   - Register new user
   - Verify minimal profile created automatically
   - Edit profile and save
   - Verify changes saved to Supabase

2. **Profile Data Consistency**
   - Edit profile in settings
   - Navigate to profile tab
   - Verify changes reflected
   - Refresh app
   - Verify changes persisted

3. **User Context Preservation**
   - Create bounty
   - Navigate to postings tab
   - Verify bounty appears in "My Postings"
   - View bounty details
   - Verify correct username displayed

4. **Multi-User Scenarios**
   - Login as User A
   - Create bounty
   - Logout
   - Login as User B
   - View bounty list
   - Verify User A's bounty shows User A's name

## Migration Notes

### Breaking Changes
- `CURRENT_USER_ID` constant is deprecated (kept for fallback)
- All code should use `getCurrentUserId()` instead

### Legacy Code
- Old `userProfileService` in `lib/services/userProfile.ts` still used for local storage
- `user-profile-service.ts` provides in-memory profiles for testing
- Both are being phased out in favor of `auth-profile-service.ts`

### Backward Compatibility
- `getCurrentUserId()` returns fallback ID if not authenticated
- Profile screens handle both authenticated and unauthenticated states
- Edit profile screen updates both local and Supabase profiles

## Troubleshooting

### Profile Not Loading
1. Check Supabase configuration in `.env`
2. Verify `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Check console for auth errors
4. Verify profiles table exists in Supabase

### Profile Updates Not Persisting
1. Check network connectivity
2. Verify Supabase RLS policies allow updates
3. Check console for update errors
4. Verify profiles table schema matches AuthProfile interface

### Wrong User Context
1. Verify using `getCurrentUserId()` not `CURRENT_USER_ID`
2. Check if user is authenticated with `useAuthContext()`
3. Verify `authProfileService.getAuthUserId()` returns correct ID
4. Check console for session errors

### Cache Issues
1. Clear cache by logging out and logging back in
2. Force refresh with `refreshProfile()`
3. Check cache expiry (5 minutes default)
4. Clear AsyncStorage if needed: `AsyncStorage.clear()`

## Future Enhancements

### Planned Improvements
- [ ] Add profile completion tracking
- [ ] Implement profile verification badges
- [ ] Add profile photo upload to cloud storage
- [ ] Add profile activity history
- [ ] Implement profile settings preferences
- [ ] Add profile privacy controls
- [ ] Implement profile sharing features
- [ ] Add profile analytics/insights

### Performance Optimizations
- [ ] Implement incremental profile updates (patch instead of full replace)
- [ ] Add profile pre-fetching for better UX
- [ ] Optimize cache strategy with smarter invalidation
- [ ] Add offline profile editing with sync queue
- [ ] Implement profile data compression for storage

## Security Considerations

### Profile Data Privacy
- Phone numbers stored but NEVER displayed in UI
- Email only visible to authenticated user (their own)
- Profile updates validated server-side (Supabase RLS)
- Avatar URLs validated to prevent XSS

### Authentication Security
- Session tokens stored in secure storage (expo-secure-store)
- Auth state synced with Supabase auth service
- Profile actions require valid auth session
- RLS policies enforce user can only edit their own profile

### Best Practices
1. Never log sensitive data (phone, email)
2. Validate all inputs before sending to Supabase
3. Use RLS policies for all profile operations
4. Sanitize avatar URLs and other user content
5. Handle auth errors gracefully without exposing details

## Support & Feedback

For questions or issues related to authentication and profile integration:
- Check this documentation first
- Review code in `lib/services/auth-profile-service.ts`
- Check console logs for errors
- File an issue in the repository with detailed description

---

**Last Updated**: 2025-10-10
**Version**: 1.0.0
**Author**: BountyExpo Team
