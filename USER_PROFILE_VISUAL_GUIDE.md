# User Profile Enhancement - Visual Guide

## Navigation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    BOUNTY FEED / POSTINGS                       │
│                                                                 │
│  ┌────────────────────────────────────────────────────┐         │
│  │  [👤 Avatar] John Doe                              │         │
│  │  Mow My Lawn                                       │         │
│  │  2 mi away                                   $50   │         │
│  └────────────────────────────────────────────────────┘         │
│                          │                                      │
│                          │ Tap Avatar                           │
│                          ▼                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

                            OR

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                   BOUNTY DETAIL MODAL                           │
│                                                                 │
│  ┌────────────────────────────────────────────────────┐         │
│  │  [👤 Avatar] John Doe                         [>]  │         │
│  │  Posted 2h ago                                     │         │
│  │                                                    │         │
│  │  Mow My Lawn                                       │         │
│  │  $50 • 2 mi away                                   │         │
│  │  Description: I need someone to mow...             │         │
│  └────────────────────────────────────────────────────┘         │
│                          │                                      │
│                          │ Tap Avatar/Profile                   │
│                          ▼                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

                            ▼

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              ENHANCED USER PROFILE SCREEN                       │
│                                                                 │
│  ┌────────────────────────────────────────────────────┐         │
│  │  [<]    🎯 BOUNTY                           [⋮]    │         │
│  │                                                    │         │
│  │  ┌──────────────────────────────────────────┐     │         │
│  │  │       [👤 Large Avatar]                  │     │         │
│  │  │                                          │     │         │
│  │  │       @johndoe                           │     │         │
│  │  │       John Doe                           │     │         │
│  │  │       ⭐ Verified                        │     │         │
│  │  │                                          │     │         │
│  │  │  Jobs: 15 | Bounties: 8 | Badges: 3     │     │         │
│  │  └──────────────────────────────────────────┘     │         │
│  │                                                    │         │
│  │  ┌──────────────────┐  ┌───────────────────┐     │         │
│  │  │ 💬 Send Message  │  │ 👤 Follow         │     │         │
│  │  └──────────────────┘  └───────────────────┘     │         │
│  │                                                    │         │
│  │  ┌──────────────────────────────────────────┐     │         │
│  │  │  Followers: 124      Following: 89       │     │         │
│  │  └──────────────────────────────────────────┘     │         │
│  │                                                    │         │
│  │  📋 Skillsets                                     │         │
│  │  [Verified contact] [Based in Seattle]            │         │
│  │  [Joined Jan 2024]                                │         │
│  │                                                    │         │
│  │  🎨 Portfolio                                     │         │
│  │  [Image 1] [Image 2] [Image 3]                    │         │
│  │                                                    │         │
│  │  🏆 Achievements                                  │         │
│  │  [Badge 1] [Badge 2] [Badge 3]                    │         │
│  │                                                    │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## More Menu (Three Dots)

```
When viewing another user's profile, tap [⋮] in header:

┌────────────────────────┐
│  📤 Share Profile       │
│  ⚠️  Report             │
│  🚫 Block               │
└────────────────────────┘
```

## Conditional UI Elements

### Viewing Other User's Profile:
```
┌───────────────────────────────────────┐
│  [<]  🎯 BOUNTY           [⋮]        │  ← More menu available
│                                       │
│  [Large Profile Section]              │
│                                       │
│  [💬 Send Message] [👤 Follow]       │  ← Message + Follow buttons
│                                       │
│  [Followers/Following Stats]          │
│  [Skillsets]                          │
│  [Portfolio]                          │
│  [Achievements]                       │
└───────────────────────────────────────┘
```

### Viewing Own Profile:
```
┌───────────────────────────────────────┐
│  [<]  🎯 BOUNTY           [ ]        │  ← No more menu
│                                       │
│  [Large Profile Section]              │
│                                       │
│  [✏️ Edit Profile]                   │  ← Edit button instead
│                                       │
│  [Followers/Following Stats]          │
│  [Skillsets]                          │
│  [Portfolio]                          │
│  [Achievements]                       │
└───────────────────────────────────────┘
```

## Key Features Visualization

### 1. Send Message Flow
```
[💬 Send Message]
        │
        ▼
  Creating conversation...
        │
        ▼
  Navigate to Messenger
        │
        ▼
  Conversation opened
```

### 2. Follow/Unfollow
```
Initial State: [👤 Follow]
        │
        ▼
Tap to follow
        │
        ▼
Loading... [⏳]
        │
        ▼
Followed! [✓ Following]
        │
        ▼
Tap again to unfollow
        │
        ▼
Unfollowed! [👤 Follow]
```

### 3. Report User Flow
```
[⋮] More Menu
        │
        ▼
[⚠️ Report]
        │
        ▼
Select Reason:
  • Spam
  • Inappropriate
        │
        ▼
Report submitted
        │
        ▼
"Thank you for keeping our community safe"
```

## Color Theme (Emerald)

```
┌─────────────────────────────────────┐
│  EMERALD THEME COLORS               │
├─────────────────────────────────────┤
│  Background:     #059669 (emerald-600)
│  Header:         #059669 (emerald-600)
│  Buttons:        #a7f3d0 (emerald-200)
│  Button Text:    #065f46 (emerald-800)
│  Accents:        #10b981 (emerald-500)
│  Text:           #ffffff (white)
│  Secondary Text: #a7f3d0 (emerald-200)
└─────────────────────────────────────┘
```

## Component Hierarchy

```
UserProfileScreen
│
├── Header
│   ├── Back Button [<]
│   ├── BOUNTY Logo (center)
│   └── More Menu [⋮] (conditional)
│
├── More Menu Dropdown (conditional)
│   ├── Share Profile
│   ├── Report
│   └── Block
│
├── ScrollView
│   │
│   ├── EnhancedProfileSection
│   │   ├── Avatar (large)
│   │   ├── Username & Name
│   │   ├── Verification Badge
│   │   └── Activity Stats
│   │
│   ├── Action Buttons
│   │   ├── Send Message (conditional)
│   │   ├── Follow/Following (conditional)
│   │   └── Edit Profile (conditional)
│   │
│   ├── Stats Container (conditional)
│   │   ├── Followers Count
│   │   └── Following Count
│   │
│   ├── Skillsets Section
│   │   └── SkillsetChips
│   │
│   ├── Portfolio Section
│   │   └── PortfolioSection
│   │
│   └── Achievements Section
│       └── AchievementsGrid
```

## State Flow

```
┌─────────────────┐
│  Initial Load   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  Fetch Profile Data     │
│  - useNormalizedProfile │
│  - useFollow            │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Load Stats             │
│  - bountyService        │
│  - bountyRequestService │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Load Skills            │
│  - AsyncStorage         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Render Profile         │
│  - Show all sections    │
│  - Conditional UI       │
└─────────────────────────┘
```

## Error Handling

```
┌─────────────────┐
│   Try Load      │
└────────┬────────┘
         │
    [Success?]─────Yes─────▶ Show Profile
         │
        No
         │
         ▼
┌─────────────────────────┐
│  Show Error Screen      │
│  - Error icon           │
│  - Error message        │
│  - "Go Back" button     │
└─────────────────────────┘
```

## Accessibility Features

```
✓ accessibilityRole on all buttons
✓ accessibilityLabel for screen readers
✓ accessibilityHint for context
✓ Minimum 44x44 touch targets
✓ High contrast colors
✓ Clear visual feedback
✓ Error messages in plain language
```

## Integration Points

```
┌────────────────────────────────────────┐
│  External Services Used                │
├────────────────────────────────────────┤
│  ✓ messageService                      │
│    - Create/get conversations          │
│                                        │
│  ✓ reportService                       │
│    - Report users                      │
│                                        │
│  ✓ bountyService                       │
│    - Fetch user's posted bounties      │
│                                        │
│  ✓ bountyRequestService                │
│    - Fetch user's accepted jobs        │
│                                        │
│  ✓ useFollow hook                      │
│    - Follow/unfollow functionality     │
│                                        │
│  ✓ useNormalizedProfile hook           │
│    - Fetch user profile data           │
└────────────────────────────────────────┘
```

## Summary

This visual guide shows:
1. **Navigation paths** from bounty screens to user profiles
2. **UI layout** with all sections and components
3. **Conditional elements** for own vs. other profiles
4. **Feature flows** for messaging, following, and reporting
5. **Color theme** consistency with emerald design
6. **Component structure** and relationships
7. **State management** and data flow
8. **Error handling** patterns
9. **Accessibility** considerations
10. **Integration points** with services and hooks
