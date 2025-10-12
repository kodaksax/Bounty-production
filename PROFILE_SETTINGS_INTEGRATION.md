# Profile and Settings Screen Integration

## Overview
This document describes the implementation of tight coupling between the Profile screen and Settings screens, ensuring that profile data updates are immediately reflected across all screens without requiring manual refresh.

## Problem Statement
Previously, the Profile and Settings screens maintained separate local state for profile data, leading to:
- Profile updates not being reflected in the Profile screen after editing from Settings
- Multiple sources of truth for profile data (local state, AsyncStorage, hooks)
- No real-time synchronization between screens
- Users having to manually refresh or re-login to see profile changes

## Solution Architecture

### Single Source of Truth: `authProfileService`
The `authProfileService` (in `lib/services/auth-profile-service.ts`) serves as the central source of truth for authenticated user profile data. It:
- Manages profile data from Supabase `profiles` table
- Maintains an in-memory cache of the current profile
- Notifies all subscribers when profile changes occur
- Provides a singleton instance accessible throughout the app

### Key Components

#### 1. **ProfileScreen** (`app/tabs/profile-screen.tsx`)
**Changes Made:**
- Uses `useAuthProfile()` and `useNormalizedProfile()` hooks to access profile data
- Implements `handleSettingsClose()` to refresh profile data when returning from Settings
- Shows success/error notifications when profile updates complete
- Listens to profile changes through hook subscriptions

**How it Works:**
```typescript
const { profile: authProfile, refreshProfile: refreshAuthProfile } = useAuthProfile()
const { profile: userProfile, refresh: refreshUserProfile } = useNormalizedProfile()

const handleSettingsClose = async () => {
  setShowSettings(false)
  try {
    await Promise.all([refreshAuthProfile(), refreshUserProfile()])
    setUpdateMessage('Profile refreshed')
  } catch (error) {
    setUpdateMessage('Failed to refresh profile')
  }
}
```

#### 2. **SettingsScreen** (`components/settings-screen.tsx`)
**Changes Made:**
- Removed local `profileData` state in favor of hooks
- Uses `useAuthProfile()` and `useNormalizedProfile()` to get real-time profile data
- No longer needs to manage profile state - it's automatically updated by authProfileService

**Before:**
```typescript
const [profileData, setProfileData] = useState({
  name: '@jon_Doe',
  about: '',
  // ... local state
})
```

**After:**
```typescript
const { profile: authProfile } = useAuthProfile()
const { profile: normalizedProfile } = useNormalizedProfile()

const profileData = {
  name: authProfile?.username || normalizedProfile?.username || '@user',
  about: authProfile?.about || normalizedProfile?.bio || '',
  // ... derived from hooks
}
```

#### 3. **EditProfileScreen** (`components/edit-profile-screen.tsx`)
**Changes Made:**
- Updates `authProfileService` as the primary source of truth
- Implements proper error handling with loading and error states
- Shows saving indicator during save operation
- Provides success/error feedback to users

**Key Implementation:**
```typescript
const handleSave = async () => {
  setIsSaving(true)
  try {
    // Update Supabase profile via auth profile service
    const updatedProfile = await updateAuthProfile({
      username: name.trim(),
      about: (bio || about || '').trim(),
      avatar: avatar?.trim()
    })
    
    if (!updatedProfile) {
      throw new Error('Failed to save profile')
    }
    
    // Also update local profile for backward compatibility
    await updateProfile(updates).catch(e => {
      console.warn('[EditProfile] local profile update failed (non-critical):', e)
    })
    
    setUploadMessage('✓ Profile updated successfully!')
    setTimeout(() => onBack && onBack(), 300)
  } catch (e) {
    setUploadMessage('Error saving profile. Please try again.')
  } finally {
    setIsSaving(false)
  }
}
```

#### 4. **app/profile/edit.tsx**
**Changes Made:**
- Updated to use `authProfileService` for consistency with other edit screens
- Ensures all edit paths follow the same update pattern

## Data Flow

```
User edits profile in Settings
         ↓
EditProfileScreen saves changes
         ↓
authProfileService.updateProfile() called
         ↓
Supabase profiles table updated
         ↓
authProfileService notifies all subscribers
         ↓
useAuthProfile() hook receives update
         ↓
ProfileScreen receives new profile data
         ↓
UI updates automatically
```

## Error Handling

### Loading States
- **EditProfileScreen**: Shows loading spinner while fetching profile data
- **ProfileScreen**: Shows "Loading profile..." message during refresh

### Error States
- **EditProfileScreen**: 
  - Shows error banner if profile fails to load
  - Displays validation errors for invalid input
  - Shows error message if save fails
- **ProfileScreen**: 
  - Shows error notification if refresh fails
  - Dismissible error banners

### Empty States
- Profile fields display placeholder text when empty
- Avatar shows fallback initials when no image is set
- Skills show default skills if none are set

## User Experience Improvements

1. **Immediate Feedback**: 
   - Success messages appear after saving
   - Loading indicators during save operations
   - Error messages with actionable instructions

2. **No Manual Refresh Required**:
   - Profile updates propagate automatically
   - Screens refresh when navigating back
   - Real-time synchronization through subscribers

3. **Consistent State**:
   - Single source of truth eliminates conflicts
   - All screens show the same profile data
   - Changes persist across navigation

4. **Graceful Degradation**:
   - Falls back to local profile if Supabase unavailable
   - Cached data used when offline
   - Non-critical errors don't block user actions

## Testing Recommendations

### Manual Testing Flow
1. Navigate to Profile screen
2. Click Settings icon
3. Click "Edit Profile"
4. Update name, bio, or avatar
5. Click Save
6. Verify success message appears
7. Click Back to return to Settings
8. Click Back to return to Profile screen
9. Verify profile changes are reflected immediately
10. Navigate away and back to Profile screen
11. Verify changes persist

### Edge Cases to Test
- [ ] Save profile with empty name (should show validation error)
- [ ] Save profile with invalid avatar URL (should show error)
- [ ] Save profile while offline (should handle gracefully)
- [ ] Navigate away during save operation
- [ ] Rapid successive saves
- [ ] Profile updates from multiple devices/sessions

## Future Enhancements

1. **Real-time Sync**: Consider adding Supabase real-time subscriptions for instant updates across devices
2. **Optimistic Updates**: Update UI immediately before server confirms (already partially implemented)
3. **Conflict Resolution**: Handle concurrent edits from multiple sessions
4. **Change History**: Track profile change history for audit purposes
5. **Offline Support**: Queue profile updates when offline and sync when online

## Technical Notes

### Dependencies
- `@supabase/supabase-js` - Database and authentication
- `@react-native-async-storage/async-storage` - Local caching
- React hooks - State management and subscriptions

### Performance Considerations
- Profile cache expires after 5 minutes
- Subscribers are cleaned up on component unmount
- Profile refreshes are debounced/throttled where appropriate

### Security Considerations
- Profile updates require authentication
- User can only update their own profile
- Avatar URLs are validated to prevent XSS
- Phone numbers are kept private and not exposed in UI

## Related Files
- `lib/services/auth-profile-service.ts` - Central profile service
- `hooks/useAuthProfile.ts` - Hook for auth profile
- `hooks/useNormalizedProfile.ts` - Hook for normalized profile
- `hooks/useProfile.ts` - Hook for local profile
- `app/tabs/profile-screen.tsx` - Main profile screen
- `components/settings-screen.tsx` - Settings screen
- `components/edit-profile-screen.tsx` - Edit profile form
- `app/profile/edit.tsx` - Alternative edit profile route

## Conclusion
This implementation establishes a robust, single-source-of-truth architecture for profile data management. Profile updates from Settings are immediately reflected in the Profile screen, providing a seamless user experience without requiring manual refreshes or re-login.
