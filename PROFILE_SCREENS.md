# User Profile Screens - Layout Reference

## Screen 1: Public Profile View (`/profile/[userId]`)

```
┌─────────────────────────────────────────┐
│ ◄ Profile                               │  ← Header (emerald-600)
├─────────────────────────────────────────┤
│                                         │
│              ┌─────┐                    │
│              │  J  │                    │  ← Avatar (96x96, emerald-500)
│              └─────┘                    │     Shows initials
│                                         │
│           Jon Doe                       │  ← Display name (bold, 24px)
│          @jon_doe                       │  ← Username (gray, 16px)
│    Full Stack Developer                 │  ← Title (emerald-400, 14px)
│                                         │
├─────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐     │
│  │  💬 Message  │ │  ➕ Follow   │     │  ← Action buttons
│  └──────────────┘ └──────────────┘     │     (emerald-500 primary)
├─────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │   127 Followers  │  89 Following │  │  ← Stats (if feature enabled)
│  └──────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  About                                  │  ← Section header
│  ─────                                  │
│  Passionate developer with 5+ years     │
│  of experience building web and         │  ← Bio text
│  mobile applications.                   │
│                                         │
│  Information                            │
│  ───────────                            │
│  🌐 English, Spanish                    │  ← Languages
│  📅 Joined March 2023                   │  ← Join date
│                                         │
│  Skills                                 │
│  ──────                                 │
│  ┌────────┐ ┌────────┐ ┌──────────┐   │
│  │ React  │ │ Node.js│ │TypeScript│   │  ← Skill chips
│  └────────┘ └────────┘ └──────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

**Key Elements:**
- Scrollable content
- Bottom padding: 100px + safe area
- No BottomNav rendered
- Error banner at top (if error)
- Loading spinner on initial load

## Screen 2: Edit Profile (`/profile/edit`)

```
┌─────────────────────────────────────────┐
│ ◄ Edit Profile                Save  │  ← Header with Save button
├─────────────────────────────────────────┤
│                                         │
│              ┌─────┐                    │
│              │  J  │                    │  ← Avatar (96x96)
│              └─────┘                    │
│           📷 Change Photo               │  ← Avatar button
│    Avatar upload coming soon            │     (placeholder)
│                                         │
├─────────────────────────────────────────┤
│  Display Name                           │
│  ┌─────────────────────────────────┐   │
│  │ Jon Doe                         │   │  ← Text input
│  └─────────────────────────────────┘   │
│                                         │
│  Username                               │
│  ┌─────────────────────────────────┐   │
│  │ @jon_doe                        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Title                                  │
│  ┌─────────────────────────────────┐   │
│  │ Full Stack Developer            │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Bio                                    │
│  ┌─────────────────────────────────┐   │
│  │ Passionate developer...         │   │
│  │                                 │   │  ← Text area
│  │                                 │   │     (4 lines)
│  └─────────────────────────────────┘   │
│                                         │
│  Languages                              │
│  ┌─────────────────────────────────┐   │
│  │ English, Spanish                │   │
│  └─────────────────────────────────┘   │
│  Separate with commas                   │  ← Help text
│                                         │
│  Skills                                 │
│  ┌─────────────────────────────────┐   │
│  │ React, Node.js, TypeScript      │   │
│  └─────────────────────────────────┘   │
│  Separate with commas                   │
│                                         │
└─────────────────────────────────────────┘
```

**Key Elements:**
- Scrollable form
- All inputs editable
- Save button in header (top right)
- Optimistic update on save
- Error banner if save fails
- Success alert then navigate back

## Screen 3: Followers List (`/profile/followers`)

```
┌─────────────────────────────────────────┐
│ ◄ Followers                             │  ← Header
├─────────────────────────────────────────┤
│                                         │
│  ┌──┐  Olivia Grant              ›     │  ← Follower item
│  │OG│  @olivia_grant                   │     (clickable)
│  └──┘  UI/UX Designer                  │
│                                         │
│  ┌──┐  John Alfaro               ›     │
│  │JA│  @john_alfaro                    │
│  └──┘  Backend Engineer                │
│                                         │
│  ┌──┐  Sarah Chen                ›     │
│  │SC│  @sarah_chen                     │
│  └──┘  Product Designer                │
│                                         │
│  ┌──┐  Mike Ross                 ›     │
│  │MR│  @mike_ross                      │
│  └──┘  Mobile Developer                │
│                                         │
└─────────────────────────────────────────┘
```

**Empty State:**
```
┌─────────────────────────────────────────┐
│ ◄ Followers                             │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│              👥                         │  ← Large icon
│                                         │
│        No followers yet                 │  ← Empty title
│                                         │
│   When people follow this user,         │  ← Empty message
│     they'll appear here.                │
│                                         │
│                                         │
└─────────────────────────────────────────┘
```

**Key Elements:**
- FlatList for performance
- Avatar (48x48) with initials
- Name, username, title per item
- Chevron indicates clickable
- Tap to navigate to user profile
- Empty state centered

## Screen 4: Following List (`/profile/following`)

```
┌─────────────────────────────────────────┐
│ ◄ Following                             │  ← Header
├─────────────────────────────────────────┤
│                                         │
│  ┌──┐  Tech Guru                 ›     │
│  │TG│  @tech_guru                      │
│  └──┘  Software Architect              │
│                                         │
│  ┌──┐  Design Master             ›     │
│  │DM│  @design_master                  │
│  └──┘  Creative Director               │
│                                         │
└─────────────────────────────────────────┘
```

**Key Elements:**
- Same layout as followers
- Shows users current user is following
- Empty state: "Not following anyone yet"

## Screen 5: Profile Not Found (Error State)

```
┌─────────────────────────────────────────┐
│ ◄ Profile                               │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│              ⚠️                         │  ← Error icon (48px)
│                                         │
│        Profile not found                │  ← Error title (20px)
│                                         │
│   This user profile could not           │  ← Error message
│          be loaded.                     │
│                                         │
│        ┌──────────┐                     │
│        │ Go Back  │                     │  ← Action button
│        └──────────┘                     │
│                                         │
└─────────────────────────────────────────┘
```

## Screen 6: Own Profile (Edit Button)

```
┌─────────────────────────────────────────┐
│ ◄ Profile                               │
├─────────────────────────────────────────┤
│              ┌─────┐                    │
│              │  J  │                    │
│              └─────┘                    │
│           Jon Doe                       │
│          @jon_doe                       │
│    Full Stack Developer                 │
│                                         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐   │
│  │      ✏️ Edit Profile           │   │  ← Edit button (full width)
│  └─────────────────────────────────┘   │     Only shown for own profile
├─────────────────────────────────────────┤
│  (Rest of profile content...)           │
└─────────────────────────────────────────┘
```

**Difference from other profiles:**
- No Message button
- No Follow button
- Shows Edit button instead
- Still shows stats if feature enabled

## Screen 7: Profile with Follow Button (Feature Enabled)

```
┌─────────────────────────────────────────┐
│ ◄ Profile                               │
├─────────────────────────────────────────┤
│              ┌─────┐                    │
│              │  O  │                    │
│              └─────┘                    │
│         Olivia Grant                    │
│        @olivia_grant                    │
│       UI/UX Designer                    │
│                                         │
├─────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐     │
│  │  💬 Message  │ │ ✓ Following  │     │  ← Following state
│  └──────────────┘ └──────────────┘     │     (light bg, green text)
├─────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │   234 Followers  │ 156 Following │  │  ← Counts are clickable
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Follow Button States:**
1. **Not Following**: Solid emerald, "Follow" text, person-add icon
2. **Following**: Light emerald bg, green text, "Following", person-remove icon
3. **Loading**: ActivityIndicator in button

## Color Palette

```
Background:  #1a3d2e  (Dark emerald)
Primary:     #10b981  (Emerald-500)
Text Light:  #fffef5  (Off-white)
Text Gray:   #9ca3af  (Gray-400)
Accent:      #10b981  (Emerald-500)
Border:      #374151  (Gray-700)
Error:       #dc2626  (Red-600)
```

## Typography

```
Headers:      20-24px, bold, #fffef5
Body:         15-16px, regular, #d1d5db
Small:        12-14px, regular, #9ca3af
Buttons:      16px, semi-bold, #fffef5
```

## Spacing

```
Screen padding:       16px horizontal
Section spacing:      24px vertical
Element spacing:      12px
Button height:        48px
Avatar (large):       96x96px
Avatar (small):       48x48px
Touch target:         Min 44x44px
```

## Interactions

### Animations
- Page transitions: Slide from right
- Button press: Scale 0.98 with opacity
- Follow toggle: Immediate UI update (optimistic)
- Error banner: Slide down from top

### Gestures
- Tap: Primary interaction
- Swipe: Back navigation (iOS)
- Scroll: Vertical content

## Accessibility

- All buttons have proper labels
- High contrast text (4.5:1 minimum)
- Touch targets meet 44pt minimum
- Screen reader support via accessibilityLabel
- Error messages are clear and actionable

## Responsive Behavior

- Fits iPhone SE to iPhone Pro Max
- Safe area insets on iOS (notch, home indicator)
- Android navigation bar clearance
- Keyboard avoidance on edit screen
- Dynamic type support (future)

## State Management Flow

```
User Interaction
      ↓
 Component Event
      ↓
   Hook Call (useProfile, useFollow)
      ↓
Optimistic Update → UI reflects change immediately
      ↓
   Service Call
      ↓
   Success? ───→ Keep update
      ↓
    Failure ───→ Revert + Show error banner
```

## Navigation Flow

```
Entry Points:
  - Bounty Detail Modal user info
  - Messenger conversation avatar
  - Chat header avatar/name
  - Direct link /profile/[userId]
  - Profile tab → /profile

Exit Points:
  - Back button
  - Message button → Messenger
  - Edit button → /profile/edit
  - Follower item → /profile/[userId]
```

## Performance Optimizations

1. **FlatList** for followers/following (only renders visible items)
2. **Optimistic updates** reduce perceived latency
3. **Memoization** can be added for expensive computations
4. **Image caching** ready for avatar uploads
5. **Lazy loading** for follower/following lists

## Testing Scenarios

### Happy Path
1. View profile from bounty
2. See complete profile information
3. Tap Message → opens conversation
4. Navigate back successfully

### Error Scenarios
1. Invalid userId → Error screen
2. Network failure → Error banner with retry
3. Save failure → Revert changes, show error
4. Follow failure → Revert button state

### Edge Cases
1. Very long bio → Scrolls correctly
2. Many skills → Wraps to multiple lines
3. No bio → Shows empty state with Edit CTA
4. Empty followers → Shows helpful message

## Future Enhancements Visual

### Version 2: Portfolio
```
┌─────────────────────────────────────────┐
│  Portfolio                              │
│  ─────────                              │
│  ┌────┐ ┌────┐ ┌────┐                  │
│  │Img1│ │Img2│ │Img3│                  │  ← Grid of work samples
│  └────┘ └────┘ └────┘                  │
└─────────────────────────────────────────┘
```

### Version 3: Activity Feed
```
┌─────────────────────────────────────────┐
│  Recent Activity                        │
│  ───────────────                        │
│  🎯 Completed: Lawn Mowing     2h ago  │
│  📝 Posted: Website Design     5h ago  │  ← Timeline of actions
│  ⭐ Received 5-star rating    1d ago   │
└─────────────────────────────────────────┘
```

### Version 4: Badges
```
┌─────────────────────────────────────────┐
│  Achievements                           │
│  ────────────                           │
│  🏆 Top Performer  ✓ Verified  ⚡ Fast │  ← Badge row
└─────────────────────────────────────────┘
```

---

**Note:** These are text-based wireframes. Actual implementation follows React Native/Expo styling patterns with proper components, safe areas, and theme consistency.
