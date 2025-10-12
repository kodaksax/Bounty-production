# Profile-Settings Integration Data Flow

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  ProfileScreen                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 1. User taps Settings icon                                 │ │
│  │ 2. Opens SettingsScreen                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  SettingsScreen                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 3. Displays current profile from useAuthProfile() hook    │ │
│  │ 4. User taps "Edit Profile"                                │ │
│  │ 5. Opens EditProfileScreen                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  EditProfileScreen                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 6. User edits name, bio, avatar                            │ │
│  │ 7. User taps Save button                                   │ │
│  │ 8. Validation checks pass                                  │ │
│  │ 9. Call authProfileService.updateProfile()                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  authProfileService (Single Source of Truth)                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 10. Update Supabase profiles table                         │ │
│  │ 11. Update in-memory cache                                 │ │
│  │ 12. Notify all subscribers                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                     ▼                       ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  useAuthProfile() Hook      │   │  useNormalizedProfile()     │
│  (Listener 1)               │   │  (Listener 2)               │
│  ┌────────────────────────┐ │   │  ┌────────────────────────┐ │
│  │ 13. Receives update    │ │   │  │ 13. Receives update    │ │
│  │ 14. Triggers re-render │ │   │  │ 14. Triggers re-render │ │
│  └────────────────────────┘ │   │  └────────────────────────┘ │
└─────────────────────────────┘   └─────────────────────────────┘
                     │                       │
                     └───────────┬───────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  ALL SCREENS USING PROFILE DATA AUTO-UPDATE                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ • ProfileScreen shows new data                             │ │
│  │ • SettingsScreen shows new data                            │ │
│  │ • EditProfileScreen (if still open) shows new data         │ │
│  │ • Any other profile-dependent screens update               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  USER SEES UPDATED PROFILE IMMEDIATELY                          │
│  ✅ No manual refresh needed                                     │
│  ✅ Consistent data across all screens                           │
│  ✅ Changes persist across navigation                            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components Interaction

### Before Changes (❌ Broken Flow)
```
ProfileScreen (local state A)
    ↓
SettingsScreen (local state B)
    ↓
EditProfileScreen (local state C)
    ↓
Save → Updates only local state C
    ↓
❌ ProfileScreen still shows old data
❌ Manual refresh required
```

### After Changes (✅ Fixed Flow)
```
ProfileScreen ──┐
                │
SettingsScreen ─┼──→ useAuthProfile() hook ──→ authProfileService
                │                                      ↓
EditProfileScreen┘                              Supabase DB
                                                      ↓
                                         Notify all subscribers
                                                      ↓
                                    ┌─────────────────┴─────────────────┐
                                    ▼                                   ▼
                          ProfileScreen updates             SettingsScreen updates
                          ✅ Automatic                      ✅ Automatic
```

## State Management Pattern

### Subscriber Pattern
```typescript
// authProfileService maintains list of listeners
private listeners: Array<(profile: AuthProfile | null) => void> = []

// When profile updates:
updateProfile(updates) {
  // 1. Update Supabase
  const updated = await supabase.from('profiles').update(updates)
  
  // 2. Update cache
  this.currentProfile = updated
  
  // 3. Notify all subscribers
  this.notifyListeners(updated)
}

// Components subscribe via useAuthProfile() hook
useEffect(() => {
  const unsubscribe = authProfileService.subscribe((profile) => {
    setProfile(profile) // Auto re-render
  })
  return unsubscribe
}, [])
```

## Error Handling Flow

```
User Edits Profile
    ↓
Validation Check
    ├─ ❌ Invalid → Show error banner → User fixes → Retry
    └─ ✅ Valid → Continue
    ↓
Network Request
    ├─ ❌ Failed → Show error banner → Offer retry → Log error
    └─ ✅ Success → Continue
    ↓
Update Service
    ├─ ❌ Failed → Revert changes → Show error → Offer retry
    └─ ✅ Success → Continue
    ↓
Notify Subscribers
    └─ ✅ Success → All screens update
    ↓
Show Success Message
    └─ ✅ "Profile updated successfully!"
    ↓
Auto-close after 300ms
    └─ ✅ Return to previous screen
```

## Loading States Timeline

```
Time: 0ms
├─ User taps Save
├─ setSaving(true)
└─ Save button shows loading spinner

Time: 100-500ms
├─ Validation runs
├─ Network request sent to Supabase
└─ Loading spinner continues

Time: 500-1000ms
├─ Supabase response received
├─ authProfileService updates
├─ Subscribers notified
└─ Loading spinner continues

Time: 1000ms
├─ Success message appears
├─ setSaving(false)
└─ Save button returns to normal

Time: 1300ms
├─ Success message dismissed
└─ Screen closes automatically

Time: 1500ms
└─ ProfileScreen shows updated data
```

## Cache Strategy

```
┌─────────────────────────────────────┐
│  authProfileService Cache           │
├─────────────────────────────────────┤
│  • In-memory: currentProfile        │
│  • AsyncStorage: cached profile     │
│  • Cache TTL: 5 minutes             │
│  • Strategy: Cache-first with TTL   │
└─────────────────────────────────────┘
                │
                ▼
        Profile Request
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
    Cache Hit        Cache Miss
        │                │
        ▼                ▼
   Return Cache     Fetch from DB
        │                │
        │                ▼
        │         Update Cache
        │                │
        └────────┬───────┘
                 ▼
          Return Profile
```

## Multi-Screen Consistency

```
┌────────────────┐
│ ProfileScreen  │ ──┐
└────────────────┘   │
                     │
┌────────────────┐   │    ┌─────────────────────┐
│ SettingsScreen │ ──┼───→│ authProfileService  │
└────────────────┘   │    │  (Single Source)    │
                     │    └─────────────────────┘
┌────────────────┐   │              ↕
│ MessengerScreen│ ──┘      Supabase profiles
└────────────────┘              (Database)

ALL SCREENS ALWAYS SHOW SAME DATA
✅ No conflicts
✅ No stale data
✅ No manual sync needed
```

## Persistence Flow

```
User Updates Profile
    ↓
authProfileService.updateProfile()
    ↓
┌─────────────────┴────────────────┐
│                                  │
▼                                  ▼
Supabase DB                    AsyncStorage
(Permanent)                    (Cache - 5min TTL)
    │                                  │
    │                                  │
    ▼                                  ▼
Persists forever               Cleared on logout
Syncs across devices           Local device only
Source of truth               Fallback when offline

    │                                  │
    └──────────────┬──────────────────┘
                   ▼
         Both ensure persistence
         across app restarts and
         navigation changes
```

## Benefits Visualization

### Data Consistency
```
BEFORE: 🔴🟡🔵 (Different data in different screens)
AFTER:  🟢🟢🟢 (Same data everywhere)
```

### User Experience
```
BEFORE: 
Edit → Save → Back → ❌ No change → 😞 Confused user

AFTER:
Edit → Save → Back → ✅ Updated → 😊 Happy user
```

### Developer Experience
```
BEFORE:
Component A ─┐
Component B ─┼─→ Different state management
Component C ─┘    in each component

AFTER:
Component A ─┐
Component B ─┼─→ authProfileService
Component C ─┘    (One place to manage)
```

## Success Criteria Checklist

✅ Profile updates from Settings appear in Profile screen immediately
✅ No manual refresh required
✅ Single source of truth (authProfileService)
✅ Changes persist across navigation
✅ Changes persist after app restart
✅ Error handling with clear messages
✅ Loading states for all async operations
✅ Success notifications for user feedback
✅ Backward compatible with existing code
✅ Follows BOUNTYExpo conventions
✅ TypeScript, React Native, Expo Router used correctly

## Conclusion

This implementation provides a robust, scalable solution for profile data management with:
- **Immediate updates** across all screens
- **Consistent data** throughout the app
- **Excellent UX** with feedback and error handling
- **Maintainable code** with single source of truth
- **Future-proof** architecture for additional features
