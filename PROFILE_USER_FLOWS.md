# User Profile Feature - User Flows

## Navigation Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         BountyExpo App                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │   Bounty     │  │  Messenger   │  │   Profile    │
    │   Feed       │  │    Inbox     │  │     Tab      │
    └──────────────┘  └──────────────┘  └──────────────┘
            │                 │                 │
            │                 │                 │
            ▼                 ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Tap Bounty   │  │ Tap Avatar   │  │ View Own     │
    │   Detail     │  │ in List      │  │   Profile    │
    └──────────────┘  └──────────────┘  └──────────────┘
            │                 │                 │
            │                 │                 │
            ▼                 ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Tap User     │  │              │  │              │
    │   Info       │  │              │  │              │
    └──────────────┘  │              │  │              │
            │         │              │  │              │
            │         │              │  │              │
            └─────────┴──────────────┴──┴──────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │  /profile/[userId]     │
                │  (Public Profile View) │
                └────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │   Message    │ │  Follow/     │ │ Edit Profile │
    │    User      │ │  Unfollow    │ │ (Own Only)   │
    └──────────────┘ └──────────────┘ └──────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │  Followers/Following   │
                │  Lists (Feature Flag)  │
                └────────────────────────┘
```

## Flow 1: View Profile from Bounty

```
User Journey:
1. User browses bounty feed on main screen
2. User taps on a bounty to see details
3. Bounty detail modal opens showing:
   - User avatar and name (clickable)
   - Bounty details
   - Message input
4. User taps on the poster's name/avatar
5. Navigate to /profile/[userId]
6. Profile screen shows:
   - Avatar with initials
   - Display name and username
   - Title and bio
   - Skills and languages
   - Message button
   - Follow button (if feature enabled)

Actions Available:
- Message: Opens conversation with user
- Follow/Unfollow: Toggle follow status (if enabled)
- View Followers: Navigate to followers list (if enabled)
- View Following: Navigate to following list (if enabled)
- Back: Return to bounty detail
```

## Flow 2: View Profile from Messenger

```
User Journey:
1. User opens Messenger inbox
2. User sees list of conversations
3. User taps avatar of any 1:1 conversation
   OR
   User taps conversation to open chat
   Then taps avatar/name in chat header
4. Navigate to /profile/[userId]
5. Profile screen shows user information

Note: Group conversations don't show individual profile navigation from list.
In group chat header, profile navigation is disabled.
```

## Flow 3: View Own Profile

```
User Journey:
1. User taps Profile tab in bottom navigation
2. Current ProfileScreen is displayed (legacy view)
   OR
   User navigates to /profile (redirects to /profile/<myUserId>)
3. Profile screen shows with Edit button instead of Message/Follow
4. User can tap Edit to modify profile

Actions Available:
- Edit Profile: Navigate to /profile/edit
- View Followers: See who follows you (if enabled)
- View Following: See who you follow (if enabled)
```

## Flow 4: Edit Profile

```
User Journey:
1. From own profile, tap "Edit Profile"
2. Navigate to /profile/edit
3. Edit form shows:
   - Avatar placeholder (upload coming soon)
   - Display name field
   - Username field
   - Title field
   - Bio text area
   - Languages (comma-separated)
   - Skills (comma-separated)
4. User makes changes
5. User taps "Save" in header
6. Optimistic update applied
7. Success alert shown
8. Navigate back to profile

Error Handling:
- If save fails, changes are reverted
- Error banner appears with dismiss button
- User can retry or cancel
```

## Flow 5: Follow/Unfollow (Feature Flagged)

```
User Journey:
1. User views another user's profile
2. User sees Follow/Unfollow button
3. User taps button
4. Optimistic update: button changes immediately
5. Count updates (+1 or -1 follower)
6. API call made in background
7. If successful: state remains updated
8. If error: state reverts, error banner shown

States:
- Not Following: Button shows "Follow" with person-add icon
- Following: Button shows "Following" with person-remove icon
- Loading: Shows activity indicator

Feature Flag:
Set FOLLOW_FEATURE_ENABLED = true in lib/feature-flags.ts
```

## Flow 6: View Followers/Following Lists

```
User Journey:
1. From any profile (own or others)
2. Tap on "X Followers" or "Y Following" count
3. Navigate to /profile/followers or /profile/following
4. See FlatList of users with:
   - Avatar
   - Name and username
   - Title
   - Chevron indicating clickable
5. Tap any user to navigate to their profile
6. Can navigate back to previous profile

Empty States:
- No Followers: "No followers yet"
- No Following: "Not following anyone yet"

Note: Only visible if FOLLOW_FEATURE_ENABLED = true
```

## Screen Components

### Profile Screen (`/profile/[userId]`)
**Components:**
- Header with back button and title
- Error banner (dismissible)
- Avatar (large circle with initials)
- Display name and username
- Title badge
- Action buttons row (Message, Follow/Unfollow, Edit)
- Stats row (Followers, Following counts)
- Bio section
- Info section (languages, join date)
- Skills section (chip layout)
- Empty state (if no bio and own profile)

### Edit Profile Screen (`/profile/edit`)
**Components:**
- Header with back button, title, and Save button
- Error banner (dismissible)
- Avatar section with change photo button
- Form fields (text inputs and text area)
- Help text for comma-separated values
- Bottom padding for keyboard

### Followers/Following Lists (`/profile/followers`, `/profile/following`)
**Components:**
- Header with back button and title
- Error banner with retry button
- FlatList of user items
- Empty state centered view
- User items with avatar, name, username, title, chevron

## Technical Details

### State Management
- Profile data: `useProfile(userId)` hook
- Follow status: `useFollow(userId, currentUserId)` hook
- Optimistic updates for follow/unfollow
- Error recovery with rollback

### Navigation
- Expo Router file-based routing
- Dynamic routes: `[userId]` parameter
- Nested navigation supported
- Back stack maintained

### Styling
- Mobile-first responsive design
- Emerald color scheme (#1a3d2e, #10b981)
- Safe area insets respected
- Bottom padding for BottomNav clearance
- High contrast for accessibility

### Performance
- FlatList for long lists (followers/following)
- React.memo for user items (can be added)
- Optimistic updates reduce perceived latency

### Data Flow
```
User Action → Hook → Service → In-Memory Store → Hook → UI Update
                                     ↓
                              (Future: API Call)
```

## Analytics Events (Ready to Implement)

```javascript
// Profile view
analytics.track('profile_view', {
  viewerId: currentUserId,
  profileUserId: targetUserId,
  source: 'bounty_detail' | 'messenger_list' | 'chat_header' | 'direct_link'
})

// Follow action
analytics.track('follow_toggle', {
  actorId: currentUserId,
  targetId: targetUserId,
  action: 'follow' | 'unfollow',
  source: 'profile_screen'
})

// Profile edit
analytics.track('profile_edit', {
  userId: currentUserId,
  fieldsChanged: ['name', 'bio', 'skills', ...]
})

// Message from profile
analytics.track('message_from_profile', {
  actorId: currentUserId,
  targetId: targetUserId
})
```

## Error Scenarios

### Network Errors
- Profile load failure: Show error screen with Go Back button
- Follow toggle failure: Revert state, show banner with retry
- Edit save failure: Revert changes, show banner

### Not Found
- Invalid userId: Show "Profile not found" error screen
- Deleted user: Same as invalid userId

### Permissions
- Edit attempt on other profile: Button not shown (enforced by component)
- Follow own profile: Button not shown (enforced by component)

## Future Enhancements

1. **Real-time Updates**
   - WebSocket for follower count updates
   - Live follow status changes

2. **Rich Profiles**
   - Portfolio/work samples
   - Ratings and reviews
   - Badges and achievements

3. **Social Features**
   - Mutual followers indication
   - Suggested users to follow
   - Activity feed

4. **Privacy Controls**
   - Private profiles
   - Block/mute users
   - Follower approval

5. **Enhanced Messaging**
   - Direct conversation creation from profile
   - Quick messages/templates
   - Message preview in profile

## Testing Checklist

### Functional Tests
- [ ] Navigate to profile from bounty
- [ ] Navigate to profile from messenger
- [ ] View own profile
- [ ] Edit profile successfully
- [ ] Follow/unfollow user (feature flag on)
- [ ] View followers list
- [ ] View following list
- [ ] Navigate between multiple profiles
- [ ] Back navigation works correctly

### Error Tests
- [ ] Invalid userId shows error
- [ ] Network error shows banner
- [ ] Edit save failure reverts changes
- [ ] Follow failure shows error and reverts

### UI Tests
- [ ] Safe areas respected on iOS
- [ ] Bottom nav doesn't overlap content
- [ ] Long bios display correctly
- [ ] Many skills wrap properly
- [ ] Empty states show helpful messages

### Performance Tests
- [ ] Large followers list scrolls smoothly
- [ ] Profile loads quickly
- [ ] Optimistic updates feel instant
- [ ] No memory leaks on navigation

## Support

For issues or questions about the profile feature:
1. Check PROFILE_FEATURE.md for implementation details
2. Run `node scripts/test-profile-routes.js` to verify setup
3. Check console for navigation errors
4. Verify feature flag state for follow functionality
