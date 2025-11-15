# Delete Account Feature - Visual Guide

## Overview
Added delete account functionality to the Settings screen in the "Log Out" section.

## UI Changes

### Settings Screen Location
The new "Delete Account" card appears **after** the "Log Out" card in the Settings screen.

### Delete Account Card
```
┌─────────────────────────────────────────────────────┐
│ 🗑️ Delete Account                                   │
│                                                      │
│ Permanently delete your account and all             │
│ associated data. This action cannot be undone.      │
│                                                      │
│ [Delete Account]                                     │
└─────────────────────────────────────────────────────┘
```

**Visual Properties:**
- Icon: `delete-forever` (Material Icons)
- Title: "Delete Account"
- Description: Warning about permanent deletion
- Primary Button: "Delete Account" (emerald-700 background)
- Follows the same card styling as other SettingsCard components

## User Flow

### Step 1: User taps "Delete Account" button
The app displays a confirmation dialog.

### Step 2: Confirmation Dialog
```
╔══════════════════════════════════════════════════╗
║              Delete Account                      ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Are you sure you want to delete your account?   ║
║ This will permanently delete:                    ║
║                                                  ║
║ • Your profile and personal information          ║
║ • All your bounties (posted and accepted)        ║
║ • Your wallet transactions and balance           ║
║ • All messages and conversations                 ║
║ • All notifications and settings                 ║
║                                                  ║
║ This action cannot be undone.                    ║
║                                                  ║
║            [Cancel]   [Delete]                   ║
╚══════════════════════════════════════════════════╝
```

**Dialog Properties:**
- Cancel button: Default style (safe action)
- Delete button: Destructive style (red/dangerous action)

### Step 3: Account Deletion Process (if user confirms)
1. Deletes user data from all application tables:
   - profiles
   - public_profiles
   - bounties
   - wallet_transactions
   - messages
   - conversation_participants
   - notifications
   - push_tokens
   - notification_preferences

2. Clears local data:
   - Draft data via authProfileService
   - SecureStore tokens (sb-access-token, sb-refresh-token)

3. Signs out from Supabase Auth

4. Navigates to sign-in screen

5. Shows success confirmation

### Step 4: Success Confirmation
```
╔══════════════════════════════════════════════════╗
║             Account Deleted                      ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Your account has been permanently deleted.       ║
║                                                  ║
║                    [OK]                          ║
╚══════════════════════════════════════════════════╝
```

## Error Handling

### Error: Unable to Identify User
```
╔══════════════════════════════════════════════════╗
║                   Error                          ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Unable to identify user account.                 ║
║                                                  ║
║                    [OK]                          ║
╚══════════════════════════════════════════════════╝
```

### Error: Deletion Failed
```
╔══════════════════════════════════════════════════╗
║                   Error                          ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Failed to delete account. Please contact         ║
║ support.                                         ║
║                                                  ║
║                    [OK]                          ║
╚══════════════════════════════════════════════════╝
```

## Code Structure

### Files Modified/Created:

1. **components/settings-screen.tsx**
   - Added new SettingsCard component for "Delete Account"
   - Integrated confirmation dialog with detailed warnings
   - Implemented account deletion flow with proper cleanup

2. **lib/services/account-deletion-service.ts** (NEW)
   - Contains `deleteUserAccount()` function
   - Handles data deletion from multiple Supabase tables
   - Implements error handling and logging
   - Returns success/failure status with messages

## Key Features

✅ **User Safety:**
- Double confirmation required (card button + dialog)
- Clear warnings about data loss
- Destructive styling on delete button

✅ **Data Cleanup:**
- Removes all user data from database tables
- Clears local storage and secure tokens
- Signs out from authentication

✅ **User Experience:**
- Clear feedback at each step
- Error handling with helpful messages
- Automatic navigation to sign-in screen

✅ **Security:**
- Validates user ID before deletion
- Uses lazy imports to avoid bundling issues
- Proper error logging for debugging

## Testing Checklist

- [ ] Verify Delete Account card appears in Settings screen
- [ ] Tap Delete Account button shows confirmation dialog
- [ ] Cancel button dismisses dialog without action
- [ ] Delete button starts deletion process
- [ ] All user data is removed from database
- [ ] Local tokens are cleared
- [ ] User is signed out
- [ ] App navigates to sign-in screen
- [ ] Success message is displayed
- [ ] Error handling works for edge cases
