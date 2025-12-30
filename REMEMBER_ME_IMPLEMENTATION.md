# Remember Me Authentication Implementation

## Overview

This implementation enhances the authentication system with a "remember me" feature that controls session persistence across app reloads. When users select "remember me" during sign-in, their session persists in secure storage. When they don't select it, the session only exists in memory and is cleared on app reload.

## Problem Statement

The requirement was to:
- Implement a sign-in flow where selecting 'remember me' ensures persistent user sessions across page reloads
- When 'remember me' is deselected, users should be redirected to the login page upon reload
- Ensure token management, error handling, and logout processes function seamlessly
- Maintain secure, efficient, and user-friendly login mechanisms
- Avoid over-engineering (especially regarding Supabase timeout handling)

## Solution Architecture

### Storage Adapter Pattern

The implementation uses a custom storage adapter for Supabase that checks the "remember me" preference on every storage operation:

```typescript
// lib/auth-session-storage.ts
export const createAuthSessionStorageAdapter = () => {
  return {
    getItem: async (key: string): Promise<string | null> => {
      const rememberMe = await getRememberMePreference();
      if (!rememberMe) {
        // Force re-authentication by returning null
        return null;
      }
      // Read from secure storage
      return await SecureStore.getItemAsync(key);
    },
    
    setItem: async (key: string, value: string): Promise<void> => {
      const rememberMe = await getRememberMePreference();
      if (!rememberMe) {
        // Don't persist to secure storage
        return;
      }
      // Persist to secure storage
      await SecureStore.setItemAsync(key, value);
    },
    
    removeItem: async (key: string): Promise<void> => {
      // Always remove from secure storage
      await SecureStore.deleteItemAsync(key);
    },
  };
};
```

### Key Behaviors

1. **Sign In with Remember Me Checked**:
   - User checks "remember me" checkbox
   - Preference is saved BEFORE authentication
   - When Supabase stores the session, adapter persists it to secure storage
   - On app reload: adapter reads preference (true) → reads session from storage → user stays logged in

2. **Sign In with Remember Me Unchecked**:
   - User doesn't check "remember me" checkbox
   - Preference defaults to false or is explicitly set to false
   - When Supabase stores the session, adapter doesn't persist it
   - On app reload: adapter reads preference (false) → returns null → user sees login screen

3. **Sign Out**:
   - Clears remember me preference
   - Calls Supabase signOut (which calls removeItem in adapter)
   - Clears all session data from secure storage
   - Next app start: no preference set → returns null → login screen

### Flow Diagrams

#### Sign In Flow (Remember Me = true)

```
User enters credentials + checks "remember me"
    ↓
setRememberMePreference(true) → Saves to SecureStore
    ↓
supabase.auth.signInWithPassword()
    ↓
Supabase calls adapter.setItem(sessionKey, sessionData)
    ↓
Adapter checks getRememberMePreference() → returns true
    ↓
Adapter saves session to SecureStore
    ↓
User navigates to app
    
--- App Reload ---
    ↓
Supabase calls adapter.getItem(sessionKey)
    ↓
Adapter checks getRememberMePreference() → returns true
    ↓
Adapter reads session from SecureStore → returns session
    ↓
User stays logged in ✓
```

#### Sign In Flow (Remember Me = false)

```
User enters credentials (doesn't check "remember me")
    ↓
setRememberMePreference(false) → Saves to SecureStore
    ↓
supabase.auth.signInWithPassword()
    ↓
Supabase calls adapter.setItem(sessionKey, sessionData)
    ↓
Adapter checks getRememberMePreference() → returns false
    ↓
Adapter doesn't persist (returns immediately)
    ↓
User navigates to app (session exists in memory)
    
--- App Reload ---
    ↓
Supabase calls adapter.getItem(sessionKey)
    ↓
Adapter checks getRememberMePreference() → returns false
    ↓
Adapter returns null (no session to restore)
    ↓
User redirected to login screen ✓
```

## Implementation Details

### Files Modified

1. **lib/auth-session-storage.ts** (new file)
   - Custom storage adapter for Supabase
   - Functions to manage remember me preference
   - Chunking support for large session objects
   - Clear session data functionality

2. **lib/supabase.ts**
   - Updated to use new auth session storage adapter
   - Removed old SecureStore adapter code

3. **app/auth/sign-in-form.tsx**
   - Import setRememberMePreference
   - Call setRememberMePreference(rememberMe) BEFORE authentication
   - Social auth (Google/Apple) defaults to remember me = true

4. **components/social-auth-controls/sign-out-button.tsx**
   - Clear remember me preference on sign out
   - Clear all session data

5. **components/settings-screen.tsx**
   - Clear remember me preference on logout
   - Clear all session data

6. **lib/services/account-deletion-service.ts**
   - Clear remember me preference before account deletion
   - Clear all session data

### Why This Approach Works

1. **Leverages Supabase's Built-in Flow**: 
   - No changes to Supabase's internal session management
   - Works with token refresh, auto-refresh, and all existing features

2. **Single Source of Truth**: 
   - The remember me preference controls everything
   - No need for complex state management

3. **Secure**:
   - Uses SecureStore for both preference and session
   - On iOS, uses AFTER_FIRST_UNLOCK for background token refresh

4. **Simple**:
   - Clean separation of concerns
   - Easy to understand and maintain
   - No complex timeout logic (as per requirements)

5. **Consistent**:
   - Works for email/password, Google, and Apple sign-in
   - Same behavior across all authentication methods

## Testing Strategy

### Manual Testing Checklist

- [ ] **Test 1: Remember Me Checked**
  1. Open app, navigate to sign-in
  2. Enter credentials, check "remember me"
  3. Sign in successfully
  4. Close app completely (force quit)
  5. Reopen app
  6. Expected: User should be logged in automatically

- [ ] **Test 2: Remember Me Unchecked**
  1. Open app, navigate to sign-in
  2. Enter credentials, DON'T check "remember me"
  3. Sign in successfully
  4. Close app completely (force quit)
  5. Reopen app
  6. Expected: User should see login screen

- [ ] **Test 3: Sign Out**
  1. Sign in with remember me checked
  2. Navigate to settings
  3. Click "Log Out"
  4. Expected: User sees login screen
  5. Close app, reopen
  6. Expected: User sees login screen (remember me cleared)

- [ ] **Test 4: Social Auth (Google)**
  1. Sign in with Google
  2. Close app, reopen
  3. Expected: User stays logged in (social auth defaults to remember me = true)

- [ ] **Test 5: Social Auth (Apple)**
  1. Sign in with Apple on iOS
  2. Close app, reopen
  3. Expected: User stays logged in

- [ ] **Test 6: Token Refresh**
  1. Sign in with remember me checked
  2. Wait for token to be close to expiration
  3. Expected: Token refreshes automatically, user stays logged in

- [ ] **Test 7: Session Switching**
  1. Sign in with remember me unchecked
  2. Close app, reopen → see login screen
  3. Sign in with remember me checked
  4. Close app, reopen → stay logged in

### Automated Tests

The existing test suite in `__tests__/integration/auth-persistence.test.tsx` covers:
- Session restoration on app restart
- Token refresh behavior
- Auth state change handling

Additional tests could be added specifically for remember me:
- Test preference storage/retrieval
- Test adapter behavior with different preference values
- Test sign out clears preference

## Edge Cases Handled

1. **Missing Preference**: If preference is not set, defaults to false (require login)
2. **Storage Errors**: On any error reading preference, defaults to false (secure default)
3. **Partial Sign Out**: Even if sign out fails, preference and session are cleared
4. **Account Deletion**: Preference and session are cleared before deletion
5. **Multiple Devices**: Each device maintains its own remember me preference

## Security Considerations

1. **Secure Storage**: Both preference and session use SecureStore
2. **iOS Background Access**: Uses AFTER_FIRST_UNLOCK for token refresh
3. **Default Secure**: On error or missing preference, requires re-authentication
4. **Complete Cleanup**: All sign-out paths clear both preference and session
5. **No Sensitive Data in Preference**: Preference only stores boolean flag

## Performance Considerations

1. **Async Checks**: Preference check is async but cached by SecureStore
2. **Minimal Overhead**: Single boolean read per storage operation
3. **No Network Calls**: All preference logic is local
4. **Chunking**: Large sessions are automatically chunked for SecureStore

## Maintenance Notes

1. **Preference Key**: `auth_remember_me_preference` in SecureStore
2. **Session Key**: `supabase.auth.token` (managed by Supabase)
3. **Chunk Suffix**: `__chunkCount` for chunked data
4. **Chunk Marker**: `__chunked__` indicates chunked data

## Future Enhancements

Potential improvements:
1. Add remember me duration options (1 week, 1 month, etc.)
2. Add biometric authentication option
3. Add device trust management for remember me
4. Add analytics tracking for remember me usage
5. Add admin option to enforce/disable remember me

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Expo SecureStore Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Mobile Auth Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html)
