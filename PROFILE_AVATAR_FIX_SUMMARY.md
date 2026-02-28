# Profile Avatar & Username Resolution Fix

## Problem Statement
Users across the app (messenger, bounty listings, bounty detail modal, requests tab, etc.) were seeing "Unknown Poster" instead of actual usernames, and profile avatars were not displaying properly.

## Root Causes Identified

1. **Missing Avatar URLs**: Components were using placeholder URLs instead of fetching actual profile avatars
2. **No Loading States**: Components immediately showed "Unknown Poster" even while profiles were still loading
3. **Profile Navigation**: Missing or incomplete navigation to user profiles from avatars/usernames
4. **Data Flow**: Bounties from database only include `user_id`, requiring additional profile lookups

## Changes Made

### 1. Avatar Display Fixes

#### `components/bountydetailmodal.tsx`
- ✅ Changed avatar source from placeholder to `normalizedPoster?.avatar`
- ✅ Fixed avatar fallback substring (was using 1-3, now uses 0-2)
- ✅ Added loading state detection
- ✅ Shows "Loading..." while fetching profile
- ✅ Added debug logging for unresolved usernames

#### `components/bounty-list-item.tsx`
- ✅ Added loading state detection from `useNormalizedProfile`
- ✅ Shows "Loading..." while fetching profile
- ✅ Only shows "Unknown Poster" after loading completes

#### `app/tabs/messenger-screen.tsx`
- ✅ Added import for `useNormalizedProfile` hook
- ✅ Fetch other user's profile data in ConversationItem
- ✅ Display actual username and avatar from profile
- ✅ Fallback to conversation name/avatar for group chats

#### `app/tabs/chat-detail-screen.tsx`
- ✅ Added import for `useNormalizedProfile` hook
- ✅ Fetch other user's profile data
- ✅ Display actual username and avatar in chat header
- ✅ Handle group vs 1:1 chat scenarios

#### `components/chat-detail-screen.tsx`
- ✅ Added same profile fetching logic as app/tabs version
- ✅ Display actual username and avatar

### 2. Profile Navigation Fixes

#### `components/applicant-card.tsx`
- ✅ Added `useRouter` import
- ✅ Made entire header clickable with TouchableOpacity
- ✅ Added `handleProfilePress` function to navigate to `/profile/${user_id}`
- ✅ Added chevron icon to indicate clickability
- ✅ Disabled navigation when user_id is not available

#### All Other Components
- ✅ Profile navigation was already implemented in bountydetailmodal.tsx
- ✅ Profile navigation was already implemented in messenger-screen.tsx
- ✅ Profile navigation was already implemented in chat-detail-screen.tsx

### 3. Data Security & Privacy

#### Verified:
- ✅ `useNormalizedProfile` properly distinguishes between viewing self vs. others
- ✅ Profile queries use appropriate service methods based on context
- ✅ Public profile view (`app/profile/[userId].tsx`) only displays public info (no email, phone, balance)
- ✅ Supabase RLS policies should control what data is exposed
- ✅ No cross-user data leakage in our implementation

## Testing Recommendations

### Manual Testing Checklist:
- [ ] Create a bounty and verify your avatar displays in the listing
- [ ] View a bounty created by another user and verify their username/avatar display
- [ ] Click on a user's avatar/username in bounty detail modal → should navigate to their profile
- [ ] Click on a user's avatar in messenger conversation list → should navigate to their profile
- [ ] Click on a user's name/avatar in chat header → should navigate to their profile
- [ ] Click on an applicant's name/avatar in requests tab → should navigate to their profile
- [ ] Verify profile page shows correct information and doesn't expose sensitive data
- [ ] Verify "Loading..." appears briefly before resolving to username or "Unknown Poster"

### Edge Cases to Test:
- [ ] User with no profile created yet
- [ ] User with profile but no username set
- [ ] Viewing your own bounties (should not see "Unknown Poster" for yourself)
- [ ] Group chat avatars (should not navigate to profile)
- [ ] Offline mode (cached profiles should still display)

## Debug Logging

Added console logging in `bountydetailmodal.tsx` to help diagnose username resolution issues:
```typescript
console.log('[BountyDetailModal] Could not resolve username for user_id:', bounty.user_id, 'Profile:', normalizedPoster)
```

If "Unknown Poster" still appears after this fix, check browser/app console for these logs.

## Files Modified

1. `components/bountydetailmodal.tsx` - Avatar display, loading states, debug logging
2. `components/bounty-list-item.tsx` - Loading states
3. `app/tabs/messenger-screen.tsx` - Profile fetching, avatar display
4. `app/tabs/chat-detail-screen.tsx` - Profile fetching, avatar display
5. `components/chat-detail-screen.tsx` - Profile fetching, avatar display
6. `components/applicant-card.tsx` - Profile navigation, avatar display

## Technical Notes

### Profile Data Flow:
1. Bounty created with `user_id` from authenticated user
2. When viewing bounty, `useNormalizedProfile(user_id)` is called
3. Hook fetches profile from multiple sources and normalizes:
   - Supabase profiles table (via `authProfileService.getProfileById`)
   - Local profile cache
   - Auth profile hook (for current user)
4. Normalized profile includes: `{ id, username, avatar, name, bio, etc. }`
5. Components use this data to display username and avatar

### Why "Unknown Poster" Appeared:
- Profiles were loading asynchronously
- Components immediately set "Unknown Poster" as fallback
- By the time profile loaded, username wasn't updating
- Solution: Add loading state and only show "Unknown Poster" after loading completes

### Avatar URL Priority:
1. Normalized profile avatar (from Supabase profiles table)
2. Conversation avatar (for messenger)
3. Placeholder SVG as final fallback

## Future Improvements

- [ ] Consider prefetching profiles for all bounty posters when loading bounty list
- [ ] Add profile avatar upload functionality (placeholder exists)
- [ ] Consider adding profile cache warming on app startup
- [ ] Add retry mechanism for failed profile fetches
- [ ] Consider optimistic UI updates for profile changes
