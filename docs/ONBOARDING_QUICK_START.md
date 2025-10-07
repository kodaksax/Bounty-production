# Onboarding Quick Start

## What Is It?
Post-signup onboarding flow that collects essential user profile information:
- **Required**: Username (unique, validated)
- **Optional**: Display name, location
- **Private**: Phone number (stored, never displayed)

## First Time Setup

### For New Users
1. Start the app: `npm start`
2. First launch will automatically show onboarding
3. Complete the 4-step flow:
   - Username → Details → Phone → Done
4. Profile is saved and you're redirected to the main app

### For Testing (Simulate New User)
```javascript
// In React Native debugger console
clearProfileForTesting()
// Then reload app (Cmd+R or Ctrl+R)
```

### For Development (Skip Onboarding)
```javascript
// In React Native debugger console
setTestProfile()
// Then reload app - goes straight to main app
```

## Flow Overview

```
┌─────────────────────────────────────────────────────┐
│  New User Launches App                              │
└─────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│  Check Profile Completeness                         │
│  (BountyApp checks if username exists)              │
└─────────────────────────────────────────────────────┘
                     ↓
        ┌────────────┴────────────┐
        │                         │
   Incomplete                 Complete
        │                         │
        ↓                         ↓
┌──────────────┐        ┌──────────────────┐
│  Onboarding  │        │  Main App        │
│  Flow        │        │  (Dashboard)     │
└──────────────┘        └──────────────────┘
        │
        ↓
┌──────────────────────┐
│ Step 1: Username     │
│ • Required           │
│ • Validated          │
│ • Unique             │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Step 2: Details      │
│ • Display name       │
│ • Location           │
│ • Avatar (coming)    │
│ ← Can skip           │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Step 3: Phone        │
│ • Private number     │
│ • Never displayed    │
│ ← Can skip           │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Step 4: Done         │
│ • Success animation  │
│ • Profile summary    │
│ • → Main app         │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Main App             │
│ (Dashboard)          │
└──────────────────────┘
```

## Key Features

### ✅ Username Validation
- **Format**: Lowercase letters, numbers, underscores
- **Length**: 3-20 characters
- **Uniqueness**: Checked in real-time (client-side)
- **Feedback**: Instant validation with check mark or error

### ✅ Privacy First
- **Phone Number**: Stored but NEVER displayed
- **Logging**: Always sanitized ("+14***34")
- **Edit Screen**: Shows "***-***-****"
- **Profile**: Shows only "✓ verified contact" badge

### ✅ User Experience
- **Progress**: 4-dot indicator shows current step
- **Navigation**: Back button on steps 2-3
- **Flexibility**: Skip optional fields
- **Persistence**: No re-onboarding after completion
- **Theme**: Emerald green, mobile-first

## File Structure

```
app/onboarding/
├── _layout.tsx      → Stack navigator
├── username.tsx     → Step 1 (required)
├── details.tsx      → Step 2 (optional)
├── phone.tsx        → Step 3 (private)
└── done.tsx         → Step 4 (complete)

lib/services/
└── userProfile.ts   → Profile CRUD + validation

hooks/
└── useUserProfile.ts → Profile state hook
```

## Common Use Cases

### 1. Testing New User Flow
```bash
# Terminal
npm start

# Debugger console
clearProfileForTesting()

# App (Cmd+R to reload)
# Walk through onboarding
```

### 2. Testing with Pre-filled Profile
```bash
# Debugger console
setTestProfile()

# App reloads directly to dashboard
```

### 3. Testing Username Validation
```bash
# In Username screen, try:
"ab"           → Error: too short
"Test123"      → Error: uppercase
"test-user"    → Error: special chars
"test_user_123" → Valid ✓
```

### 4. Testing Phone Privacy
```bash
# Complete onboarding with phone
# Check Profile screen → No phone visible
# Check Edit Profile → Shows "***-***-****"
# Check console logs → Shows "+14***34"
```

## API Reference

### `userProfileService`
```typescript
// Get current profile
const profile = await userProfileService.getProfile()

// Save profile
const result = await userProfileService.saveProfile({
  username: 'johndoe',
  displayName: 'John Doe',
  location: 'San Francisco',
  phone: '+14155551234'
})

// Check completeness
const completeness = await userProfileService.checkCompleteness()
```

### `useUserProfile` Hook
```typescript
const {
  profile,           // Current profile data
  loading,           // Loading state
  error,             // Error message
  isComplete,        // Is profile complete?
  saveProfile,       // Save new profile
  updateProfile,     // Update existing
  refresh,           // Reload from storage
} = useUserProfile()
```

## Validation Rules

### Username
- ✅ Allowed: `a-z`, `0-9`, `_`
- ❌ Not allowed: `A-Z`, spaces, special chars
- Length: 3-20 characters
- Must be unique

### Display Name
- Optional
- Any characters allowed
- Displayed in profile

### Location
- Optional
- Any format (city, state, country)
- Displayed in profile

### Phone
- Optional
- Formatted to E.164 on save
- **Private**: Never displayed
- Used for verification/notifications only

## Troubleshooting

### Onboarding Not Showing
```javascript
// Check if profile exists
const profile = await userProfileService.getProfile()
console.log('Profile:', profile)

// Clear it if needed
clearProfileForTesting()
```

### Profile Not Saving
```javascript
// Check for errors
const result = await userProfileService.saveProfile({...})
console.log('Save result:', result)
```

### Phone Validation Issues
```javascript
// Check formatting
const formatted = formatPhone('4155551234')
console.log('Formatted:', formatted) // +14155551234
```

## Security Notes

1. **Phone Privacy**:
   - Never rendered in any UI component
   - Always sanitized in logs
   - Stored in local AsyncStorage
   - Future: Move to secure backend

2. **Username Uniqueness**:
   - Currently client-side check
   - Future: Server-side validation required
   - Race condition possible with multiple users

3. **Data Storage**:
   - AsyncStorage (local, unencrypted)
   - Keys: `BE:userProfile`, `BE:allProfiles`
   - Future: Backend sync recommended

## Next Steps

After onboarding completes:
1. Profile screen shows your data
2. Username appears throughout app
3. Display name shown where applicable
4. Location in profile skills
5. Phone verification badge (not number)

Ready to use the app!

## Support

- **Implementation**: See `docs/ONBOARDING.md`
- **Testing**: See `docs/ONBOARDING_TEST_CHECKLIST.md`
- **Full Details**: See `docs/PR_IMPLEMENTATION_SUMMARY.md`

## Future Enhancements

- Server-side validation
- SMS verification
- Avatar upload
- Social profiles
- Profile sync across devices
- Email verification
