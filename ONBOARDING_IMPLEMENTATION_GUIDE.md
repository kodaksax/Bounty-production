# Onboarding Flow Implementation - Visual Guide

## Overview
This document provides a visual and textual overview of the new onboarding flow implementation.

## Complete User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEW USER SIGN-UP                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   ONBOARDING INDEX CHECK                        │
│  - Checks AsyncStorage for "@bounty_onboarding_complete"       │
│  - First time: Show Carousel                                    │
│  - Returning: Skip to Username                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    FEATURE CAROUSEL (NEW!)                      │
│  [Skip button in top-right]                                     │
│                                                                 │
│  Screen 1: 🔨 Post Tasks & Earn                                │
│  Screen 2: 👥 Connect with Locals                              │
│  Screen 3: 💬 Real-time Chat                                   │
│  Screen 4: ✅ Safe & Secure                                    │
│                                                                 │
│  [● ○ ○ ○] Progress dots                                       │
│  [Next / Get Started button]                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       USERNAME SCREEN                           │
│  - Pick unique username (required)                              │
│  - Accept legal terms                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DETAILS SCREEN (ENHANCED!)                   │
│                                                                 │
│  Display Name: _______________  (optional)                      │
│                                                                 │
│  Bio: _________________________  (optional, 200 chars)         │
│       _________________________                                 │
│       _________________________  [120/200]                      │
│                                                                 │
│  Location: ___________________  (optional)                      │
│                                                                 │
│  Skills: (tap to select)        (optional)                      │
│  [Handyman] [Cleaning] [Moving] [Delivery] [Pet Care]         │
│  [Gardening] [Photography] [Tutoring] [Tech Support] [Design] │
│                                                                 │
│  Custom Skills: [Your Custom Skill +]                          │
│  [Web Design ✕] [Carpentry ✕]                                 │
│                                                                 │
│  Profile Picture: [📷 Upload]                                  │
│                                                                 │
│  [Next] [Skip for now]                                         │
│  [● ● ○ ○] Progress dots                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         PHONE SCREEN                            │
│  - Add phone number (optional)                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         DONE SCREEN                             │
│  ✓ All Set! Welcome to Bounty!                                 │
│  - Shows profile summary                                        │
│  [Continue to Bounty]                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN APP                                │
└─────────────────────────────────────────────────────────────────┘
```

## Carousel Screens Detail

### Screen 1: Post Tasks & Earn
```
┌────────────────────────────────────┐
│                [Skip]               │
│                                     │
│         ┌─────────────┐            │
│         │   ┌─────┐   │            │
│         │   │ 🔨  │   │  Large     │
│         │   └─────┘   │  circle    │
│         └─────────────┘  with icon │
│                                     │
│      Post Tasks & Earn              │
│                                     │
│  Create bounties for tasks you      │
│  need done, or complete bounties    │
│  to earn money and build your       │
│  reputation.                        │
│                                     │
│         [● ○ ○ ○]                  │
│                                     │
│        [Next →]                     │
└────────────────────────────────────┘
```

### Screen 2: Connect with Locals
```
┌────────────────────────────────────┐
│                [Skip]               │
│                                     │
│         ┌─────────────┐            │
│         │   ┌─────┐   │            │
│         │   │ 👥  │   │            │
│         │   └─────┘   │            │
│         └─────────────┘            │
│                                     │
│    Connect with Locals              │
│                                     │
│  Find trusted people nearby to      │
│  help with tasks, or offer your     │
│  skills to your local community.    │
│                                     │
│         [○ ● ○ ○]                  │
│                                     │
│        [Next →]                     │
└────────────────────────────────────┘
```

### Screen 3: Real-time Chat
```
┌────────────────────────────────────┐
│                [Skip]               │
│                                     │
│         ┌─────────────┐            │
│         │   ┌─────┐   │            │
│         │   │ 💬  │   │            │
│         │   └─────┘   │            │
│         └─────────────┘            │
│                                     │
│      Real-time Chat                 │
│                                     │
│  Coordinate details through         │
│  built-in messaging. Keep all       │
│  communication in one place.        │
│                                     │
│         [○ ○ ● ○]                  │
│                                     │
│        [Next →]                     │
└────────────────────────────────────┘
```

### Screen 4: Safe & Secure
```
┌────────────────────────────────────┐
│                [Skip]               │
│                                     │
│         ┌─────────────┐            │
│         │   ┌─────┐   │            │
│         │   │ ✅  │   │            │
│         │   └─────┘   │            │
│         └─────────────┘            │
│                                     │
│       Safe & Secure                 │
│                                     │
│  Payments held in escrow until      │
│  work is complete. Your money is    │
│  protected every step of the way.   │
│                                     │
│         [○ ○ ○ ●]                  │
│                                     │
│      [Get Started ✓]                │
└────────────────────────────────────┘
```

## Skills Selection Interface

### Common Skills (Unselected State)
```
┌──────────────────────────────────────────────────┐
│ Skills (Optional)                                │
│ What can you help with?                          │
│                                                  │
│ ┌──────────┐ ┌─────────┐ ┌────────┐            │
│ │ Handyman │ │Cleaning │ │ Moving │  ...        │
│ └──────────┘ └─────────┘ └────────┘            │
│                                                  │
│ (Emerald border, transparent background)         │
└──────────────────────────────────────────────────┘
```

### Common Skills (Selected State)
```
┌──────────────────────────────────────────────────┐
│ Skills (Optional)                                │
│ What can you help with?                          │
│                                                  │
│ ┌──────────┐ ┌─────────┐ ┌────────┐            │
│ │ Handyman │ │Cleaning │ │ Moving │  ...        │
│ └──────────┘ └─────────┘ └────────┘            │
│   (emerald       (white     (emerald            │
│   background)    text)      background)          │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Custom Skills
```
┌──────────────────────────────────────────────────┐
│ ┌──────────────┐  ┌─────────────┐               │
│ │ Web Design ✕ │  │ Carpentry ✕ │               │
│ └──────────────┘  └─────────────┘               │
│                                                  │
│ Add another skill: [________________] [+]        │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Color Palette

```
Primary Emerald (Background):     #059669
Emerald 800 (Dark):              #097959
Emerald 200 (Accent/Highlights): #a7f3d0
Dark Text on Emerald:            #052e1b
White Text:                      #ffffff
White Text (80% opacity):        rgba(255,255,255,0.8)
White Text (60% opacity):        rgba(255,255,255,0.6)
Dark Background (Fields):        rgba(5,46,27,0.5)
Border Color:                    rgba(167,243,208,0.3)
```

## Animation Behaviors

### Carousel Scroll Animation
```
Scroll Position:  [----●----]
                 0   50%   100%

Icon Scale:      0.8 → 1.0 → 0.8
Opacity:         0.3 → 1.0 → 0.3
Dot Width:       8px → 24px → 8px
Dot Opacity:     0.3 → 1.0 → 0.3
```

### Skill Selection Animation
```
Unselected → Selected:
- Background: transparent → #a7f3d0
- Text Color: #ffffff → #052e1b
- Border: #a7f3d0 (no change)
- Scale: subtle bounce effect
```

## AsyncStorage Keys Used

| Key | Value | Purpose |
|-----|-------|---------|
| `@bounty_onboarding_complete` | `'true'` | Marks carousel as viewed |
| `BE:userProfile` | JSON object | Stores user profile including bio and skills |
| `BE:allProfiles` | JSON object | Stores all profiles for username uniqueness |
| `BE:acceptedLegal` | `'true'` | Marks legal terms accepted |

## Data Structure

### ProfileData Interface
```typescript
interface ProfileData {
  username: string;          // Required
  displayName?: string;      // Optional
  bio?: string;             // NEW: Optional, max 200 chars
  avatar?: string;          // Optional
  location?: string;        // Optional
  phone?: string;           // Optional, private
  skills?: string[];        // NEW: Optional, array of tags
}
```

### Example Saved Profile
```json
{
  "username": "johndoe",
  "displayName": "John Doe",
  "bio": "Experienced handyman with 10 years in home repairs. I love helping neighbors with their projects!",
  "avatar": "https://...",
  "location": "San Francisco, CA",
  "phone": "+14155551234",
  "skills": [
    "Handyman",
    "Cleaning",
    "Gardening",
    "Web Design"
  ]
}
```

## File Structure

```
app/
├── onboarding/
│   ├── _layout.tsx          (Updated - added carousel & index)
│   ├── index.tsx            (NEW - routing entry point)
│   ├── carousel.tsx         (NEW - 270 lines)
│   ├── username.tsx         (Existing)
│   ├── details.tsx          (Enhanced - +180 lines)
│   ├── phone.tsx            (Existing)
│   └── done.tsx             (Existing)
│
├── auth/
│   └── sign-up-form.tsx     (Updated - routing to index)
│
hooks/
└── useUserProfile.ts        (Updated - added bio & skills)

lib/
└── services/
    └── userProfile.ts       (Updated - added bio & skills)

tests/
└── manual/
    └── onboarding-carousel.test.md (NEW - test plan)
```

## Key Implementation Details

### 1. Carousel Component
- **Technology**: React Native Animated API
- **Performance**: useNativeDriver for transforms
- **Scroll**: FlatList with pagingEnabled
- **Interaction**: Swipe gestures + button navigation

### 2. First-Launch Detection
- **Storage**: AsyncStorage (persistent)
- **Check**: On mount in index.tsx
- **Fallback**: Show carousel on error
- **Clearing**: Only on explicit completion

### 3. Skills Management
- **Common Skills**: Hardcoded array of 10
- **Custom Skills**: User-entered strings
- **Storage**: Combined in single array
- **Validation**: None (flexible input)
- **Display**: Different chip styles

### 4. Bio Field
- **Type**: Multiline TextInput
- **Limit**: 200 characters enforced
- **Counter**: Live character count
- **Keyboard**: Auto-dismiss on submit
- **Validation**: Optional field

## Integration Points

1. **Sign-Up Flow**: Routes to `/onboarding/index`
2. **Sign-In Flow**: Routes to `/onboarding/username` (skips carousel)
3. **Profile Service**: Stores bio and skills in local storage
4. **Auth Profile Service**: Syncs bio to Supabase (skills stay local)
5. **Profile Display**: Can access bio and skills from profile data

## Success Metrics

- ✅ Carousel shows on first launch
- ✅ Skip button works immediately
- ✅ Animations smooth (60fps target)
- ✅ All fields optional (low friction)
- ✅ Data persists correctly
- ✅ Security scan passed (0 alerts)
- ✅ Backwards compatible (existing users unaffected)

## Known Limitations

1. **Skills**: No autocomplete or suggestions from API
2. **Carousel**: No analytics tracking implemented
3. **Bio**: No rich text formatting
4. **Skills**: No categories or grouping
5. **Carousel**: Content not customizable per user

## Future Enhancement Ideas

- Add video demonstrations to carousel
- Implement skills autocomplete from backend
- Add bio rich text formatting (bold, links)
- Track carousel completion rate
- A/B test different carousel content
- Add skill categories/tags
- Localize carousel content for i18n
- Add gamification (badges for profile completion)
