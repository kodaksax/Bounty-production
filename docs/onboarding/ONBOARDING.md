# Post-Signup Onboarding Flow

## Overview

The onboarding flow collects essential user profile information immediately after signup or when a profile is incomplete.

## Flow Steps

1. **Username** (required) - Unique identifier, validated format
2. **Details** (optional) - Display name, location, avatar placeholder
3. **Phone** (optional) - Private contact number, never displayed publicly
4. **Done** - Confirmation and summary

## Implementation

### Routes

- `/app/onboarding/username.tsx` - Username collection and validation
- `/app/onboarding/details.tsx` - Display name, location
- `/app/onboarding/phone.tsx` - Private phone number
- `/app/onboarding/done.tsx` - Completion screen
- `/app/onboarding/_layout.tsx` - Stack navigator layout

### Services

- `lib/services/userProfile.ts` - Profile CRUD operations
- `hooks/useUserProfile.ts` - React hook for profile state management

### Data Model

```typescript
interface ProfileData {
  username: string;        // Required, unique, validated
  displayName?: string;    // Optional, shown in UI
  avatar?: string;         // Optional, placeholder for now
  location?: string;       // Optional, city/state/country
  phone?: string;          // Optional, PRIVATE - never displayed
}
```

## Username Validation Rules

- **Length**: 3-20 characters
- **Format**: Lowercase letters (a-z), numbers (0-9), underscores (_)
- **Uniqueness**: Checked client-side (stub for server-side check)

## Phone Privacy

The phone number is:
- ✅ Stored securely
- ✅ Used for trust/verification
- ✅ Used for notifications
- ❌ NEVER displayed in any UI
- ❌ NEVER shared with other users
- ❌ Sanitized in logs

## Gating Logic

In `app/tabs/bounty-app.tsx`:

```typescript
const { isComplete, loading } = useUserProfile();

useEffect(() => {
  if (!loading && !isComplete) {
    router.push('/onboarding/username');
  }
}, [loading, isComplete]);
```

## Testing

### Clear Profile (Simulate New User)

```javascript
// In React Native debugger console
clearProfileForTesting()
```

### Set Test Profile (Skip Onboarding)

```javascript
// In React Native debugger console
setTestProfile()
```

### Manual Testing Steps

1. Start the app: `npm start`
2. Clear profile to trigger onboarding: `clearProfileForTesting()`
3. Reload the app
4. Walk through onboarding:
   - Enter username (e.g., "johndoe")
   - Add optional details
   - Add optional phone
   - Confirm completion
5. Verify Profile screen shows saved data
6. Restart app - onboarding should NOT show again
7. Verify phone number is never visible in Profile UI

## UI/UX

- **Theme**: Emerald (#059669, #a7f3d0)
- **Mobile-first**: Optimized for thumb reach
- **Safe areas**: Respected on iOS
- **Bottom padding**: Added to avoid BottomNav overlap when returning to tabs
- **Progress indicators**: 4-dot pagination
- **Animations**: Check mark on completion, smooth transitions

## Storage

Profile data is stored in AsyncStorage:
- Key: `BE:userProfile` - Current user's profile
- Key: `BE:allProfiles` - All profiles (for uniqueness checking)

## Future Enhancements

- Server-side username uniqueness check
- Avatar upload and cropping
- Phone SMS verification
- Email verification integration
- Social graph integration
- Import from existing platforms

## Navigation Flow

```
New User → Sign Up → Username → Details → Phone → Done → Main App (Profile)
                         ↓          ↓        ↓
                      Required   Optional  Optional
```

## Error Handling

- Inline validation with real-time feedback
- Error messages with dismiss action
- Graceful fallbacks on save failures
- Retry mechanisms for network errors

## Accessibility

- Proper labels and hints
- Keyboard navigation support
- Screen reader compatible
- Clear focus indicators
- High contrast text

## Localization Ready

All strings are hardcoded for now but structured for easy extraction to i18n files in the future.
