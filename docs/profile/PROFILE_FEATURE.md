# User Profile Feature - Implementation Guide

## Overview
This document describes the implementation of visitable user profiles with unique routes and an optional follow system for the BountyExpo application.

## Features Implemented

### 1. Profile Routes (Expo Router)
- **`/profile/[userId]`** - Public profile view for any user
  - Displays user information (avatar, name, username, title, bio)
  - Shows follower/following counts (if feature enabled)
  - Action buttons: Message, Follow/Unfollow (if enabled), Edit (for own profile)
  - Skills and language tags
  - Empty states for incomplete profiles
  - Error handling with inline dismissible banners

- **`/profile`** - Redirects to current user's profile (`/profile/<myUserId>`)

- **`/profile/edit`** - Edit profile screen
  - Editable fields: Display name, username, title, bio, languages, skills
  - Optimistic updates with error rollback
  - Avatar upload placeholder (coming soon)

- **`/profile/followers`** - List of followers (feature-flagged)
  - FlatList for performance
  - Empty states
  - Navigate to follower profiles

- **`/profile/following`** - List of users being followed (feature-flagged)
  - FlatList for performance
  - Empty states
  - Navigate to followed user profiles

### 2. Feature Flag
**Location:** `lib/feature-flags.ts`

```typescript
export const FOLLOW_FEATURE_ENABLED = false; // Toggle to enable follow/follower functionality
```

Set to `true` to enable the follow/unfollow buttons and follower/following lists.

### 3. Data Types (Additive)
**Location:** `lib/types.ts`

Existing types used:
- `UserProfile` - User profile information
- `Follow` - Follow relationship
- `FollowEdge` - Alias for Follow (added)

No breaking changes to existing types.

### 4. Services & Hooks
Already implemented and used:
- `lib/services/user-profile-service.ts` - Profile CRUD operations (in-memory stub)
- `lib/services/follow-service.ts` - Follow/unfollow operations (in-memory stub)
- `hooks/useProfile.ts` - Profile data fetching and updates
- `hooks/useFollow.ts` - Follow status and toggle operations

### 5. Navigation Entry Points

#### From Bounty Listings
**Location:** `components/bountydetailmodal.tsx`
- User info section in bounty detail modal is now clickable
- Tapping navigates to the bounty poster's profile
- Shows chevron icon to indicate clickability

**Updated:** `components/bounty-list-item.tsx`, `app/tabs/bounty-app.tsx`
- Pass `user_id` from bounty data to detail modal

#### From Messenger
**Location:** `app/tabs/messenger-screen.tsx`, `components/chat-detail-screen.tsx`
- Tapping avatar in conversation list navigates to user profile
- Tapping avatar/name in chat header navigates to user profile
- Only works for 1:1 conversations (not groups)
- Filters out current user from participant list

### 6. UI/UX Details

#### Layout
- Mobile-first design with emerald theme (#1a3d2e background, #10b981 accents)
- Safe area insets respected (iOS notch, Android navigation)
- Bottom padding added to avoid BottomNav overlap (100px + safe area)
- No BottomNav rendered inside profile screens (as per guidelines)

#### Actions
- **Message Button**: Opens conversation with user (placeholder for now)
- **Follow Button**: Toggles follow status with optimistic updates
- **Edit Button**: Opens edit profile screen (own profile only)
- **Followers/Following Counts**: Tap to view lists (if feature enabled)

#### Error Handling
- Inline dismissible error banners (red background, white text, X button)
- Loading states with ActivityIndicator
- Empty states with helpful messages and primary actions
- Network errors show Retry option

#### Accessibility
- Proper button roles and labels
- Touch targets meet minimum size requirements
- High contrast text colors

## Testing

### Manual Testing Checklist
- [ ] Navigate to own profile from profile tab
- [ ] View another user's profile from bounty detail
- [ ] View another user's profile from messenger conversation
- [ ] Edit own profile and save changes
- [ ] Toggle follow/unfollow (with feature flag enabled)
- [ ] View followers list
- [ ] View following list
- [ ] Navigate back from profile screens
- [ ] Test on iOS (safe area insets)
- [ ] Test on Android (navigation bar)
- [ ] Test error states (network failures)
- [ ] Test empty states (no bio, no followers)

### Type Check
```bash
npx tsc --noEmit
```
Note: Pre-existing TypeScript configuration issues exist (module resolution). Profile-specific code has no type errors.

### Build
```bash
npx expo start
```

## File Changes Summary

### New Files
- `lib/feature-flags.ts` - Feature flag configuration
- `app/profile/[userId].tsx` - Public profile view
- `app/profile/index.tsx` - Profile redirect
- `app/profile/edit.tsx` - Edit profile screen
- `app/profile/followers.tsx` - Followers list
- `app/profile/following.tsx` - Following list
- `PROFILE_FEATURE.md` - This documentation

### Modified Files
- `lib/types.ts` - Added FollowEdge type alias
- `components/bountydetailmodal.tsx` - Added profile navigation from user info
- `components/bounty-list-item.tsx` - Pass user_id to modal
- `app/tabs/bounty-app.tsx` - Pass user_id to BountyListItem
- `app/tabs/messenger-screen.tsx` - Added profile navigation from conversation list
- `components/chat-detail-screen.tsx` - Added profile navigation from chat header

## Future Enhancements (Out of Scope)
- Real backend persistence (currently in-memory stubs)
- Avatar upload with camera/gallery picker
- Profile badges and verification markers
- Reputation system
- Activity feed on profile
- Group profile navigation
- Handle validation and uniqueness checks
- Bio length limits
- Profile link sharing

## Analytics Events (Ready for Implementation)
```typescript
// Track profile views
trackEvent('profile_view', { viewerId: currentUserId, profileUserId: targetUserId })

// Track follow actions
trackEvent('follow_toggle', { actorId: currentUserId, targetId: targetUserId, action: 'follow' | 'unfollow' })

// Track message from profile
trackEvent('message_from_profile', { actorId: currentUserId, targetId: targetUserId })
```

## Security Notes
- Profile viewing is public (within app, authenticated users only)
- Editing restricted to own profile (enforced by checking CURRENT_USER_ID)
- No sensitive PII displayed beyond profile fields
- Email and private IDs not exposed in UI

## Known Limitations
1. Follow data is in-memory (resets on app restart)
2. Profile data is seeded with mock users (current-user, user-1, user-2)
3. Avatar upload not implemented (placeholder shows initials)
4. Message button navigates back to app root (conversation creation pending)
5. TypeScript strict mode warnings exist globally (not profile-specific)

## Migration Path
When ready to connect to real backend:
1. Update `lib/services/user-profile-service.ts` to use API endpoints
2. Update `lib/services/follow-service.ts` to use API endpoints
3. Add authentication checks in profile routes
4. Implement avatar upload service
5. Add profile validation logic
6. Connect Message button to conversation creation

## Questions?
Refer to the main README.md for overall app architecture and navigation guidelines.
