# Delete Account Feature - Visual Guide

## Overview
Added delete account functionality to the Settings screen in the "Log Out" section with comprehensive edge case handling for active bounty interactions.

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
The system checks for active bounty interactions that would prevent deletion.

### Step 2A: Active Bounty Interactions Detected (Blocking)
If the user has any of the following, deletion is blocked:

```
╔══════════════════════════════════════════════════╗
║                   Error                          ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Cannot delete account:                           ║
║                                                  ║
║ • You have 2 active bounty/bounties that you     ║
║   created. Please complete or cancel them first. ║
║                                                  ║
║ • You are currently working on 1 bounty/bounties.║
║   Please complete or withdraw from them first.   ║
║                                                  ║
║ • You have $150.00 in escrow. Please complete    ║
║   or cancel associated bounties first.           ║
║                                                  ║
║                    [OK]                          ║
╚══════════════════════════════════════════════════╝
```

**Blocking Conditions:**
1. **Active Created Bounties**: Bounties in 'open' or 'in_progress' status created by the user
2. **Active Accepted Work**: Bounties in 'in_progress' status where user is the hunter
3. **Pending Escrow**: Any funds held in escrow for active transactions

### Step 2B: No Active Interactions - Confirmation Dialog
If no blocking conditions exist, the confirmation dialog appears:

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

**Smart Deletion Strategy:**
The system only deletes data that won't break other users' experiences:

1. **Profiles**: Deletes user profile data
   - profiles table
   - public_profiles table

2. **Completed Bounties**: Only deletes bounties with status 'completed', 'archived', or 'cancelled'
   - Active bounties are preserved (already blocked by validation)

3. **Bounty Applications**: 
   - Deletes applications only for completed bounties
   - Deletes all rejected applications
   - Preserves applications for active bounties to maintain data integrity

4. **Completion Data**:
   - Deletes completion_submissions and completion_ready entries only for completed bounties
   - Preserves in-progress completion data (already blocked by validation)

5. **Wallet Transactions**:
   - Deletes transactions only for completed bounties
   - Deletes standalone transactions (deposits/withdrawals not tied to bounties)
   - Preserves escrow transactions (already blocked by validation)

6. **Communications**: Clears all user messages and conversation participation

7. **Settings**: Removes notifications, push tokens, and preferences

8. **Local Cleanup**:
   - Clears draft data via authProfileService
   - Removes SecureStore tokens (sb-access-token, sb-refresh-token)

9. **Sign Out**: Signs out from Supabase Auth

10. **Navigation**: Redirects to sign-in screen

11. **Success Confirmation**: Shows completion message

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

## Edge Case Handling

### Protected Scenarios (Account Deletion Blocked)

The system prevents account deletion in these scenarios to protect data integrity:

#### 1. User Has Active Posted Bounties
- **Status**: 'open' or 'in_progress'
- **Reason**: Other users may have applied or be working on these bounties
- **Solution**: User must complete, cancel, or close these bounties first
- **Message**: "You have X active bounty/bounties that you created. Please complete or cancel them first."

#### 2. User is Working on Bounties
- **Status**: User is hunter_id on bounties with 'in_progress' status
- **Reason**: Breaking the connection would orphan the work and prevent payment
- **Solution**: User must complete or withdraw from these bounties first
- **Message**: "You are currently working on X bounty/bounties. Please complete or withdraw from them first."

#### 3. User Has Escrowed Funds
- **Condition**: Wallet transactions with type='escrow' exist
- **Reason**: Money is held for active bounties and needs to be resolved
- **Solution**: Complete or cancel associated bounties to release/refund funds
- **Message**: "You have $X.XX in escrow. Please complete or cancel associated bounties first."

### Allowed Deletion Scenarios

The system safely deletes data in these cases:

#### 1. Completed Bounties
- Bounties with status: 'completed', 'archived', 'cancelled'
- All associated data is safely deleted (applications, submissions, transactions)

#### 2. Rejected Applications
- Applications with status='rejected' on any bounty
- These don't impact other users and can be safely removed

#### 3. Orphaned Data
- Messages from the user
- Notifications for the user
- Push tokens and preferences
- Wallet transactions not tied to bounties (standalone deposits/withdrawals)

### Data Preservation Strategy

To maintain platform integrity when a user deletes their account:

**What Gets Deleted:**
- ✅ User profile and personal information
- ✅ Completed/archived/cancelled bounties created by user
- ✅ Applications to completed bounties
- ✅ Rejected applications to any bounty
- ✅ Completion submissions for completed bounties
- ✅ Wallet transactions for completed bounties
- ✅ Standalone wallet transactions (no bounty_id)
- ✅ User's messages and conversation participation
- ✅ User's notifications, push tokens, and preferences

**What Gets Preserved (if active):**
- ⚠️ Open/in-progress bounties (deletion blocked)
- ⚠️ Applications to active bounties (maintains data for other users)
- ⚠️ In-progress completion data (deletion blocked)
- ⚠️ Escrow transactions (deletion blocked)

## Error Handling

### Error: Active Bounty Interactions
```
╔══════════════════════════════════════════════════╗
║                   Error                          ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║ Cannot delete account:                           ║
║                                                  ║
║ [Specific issues listed based on checks]         ║
║                                                  ║
║                    [OK]                          ║
╚══════════════════════════════════════════════════╝
```

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
- Triple protection: validation check + confirmation dialog + destructive styling
- Clear warnings about data loss
- Specific blocking messages for active interactions

✅ **Edge Case Handling:**
- Prevents deletion if user has active created bounties
- Prevents deletion if user is working on bounties
- Prevents deletion if user has escrowed funds
- Smart data deletion that preserves integrity for other users

✅ **Data Cleanup:**
- Removes all user data from database tables (for completed interactions)
- Clears local storage and secure tokens
- Signs out from authentication

✅ **Data Integrity:**
- Only deletes completed/cancelled bounties
- Preserves applications to active bounties
- Maintains escrow transactions until resolved
- Protects other users' active interactions

✅ **User Experience:**
- Clear feedback at each step
- Specific error messages explaining what needs to be resolved
- Automatic navigation to sign-in screen

✅ **Security:**
- Validates user ID before any operation
- Uses lazy imports to avoid bundling issues
- Proper error logging for debugging
- RLS policies ensure users can only delete their own data

## Testing Checklist

### Basic Flow
- [ ] Verify Delete Account card appears in Settings screen
- [ ] Tap Delete Account button initiates validation checks
- [ ] Cancel button dismisses dialog without action
- [ ] Delete button starts deletion process (when allowed)
- [ ] User is signed out
- [ ] App navigates to sign-in screen
- [ ] Success message is displayed

### Edge Case: Active Posted Bounties
- [ ] User with open bounties cannot delete account
- [ ] Error message shows count of active bounties
- [ ] After completing/cancelling bounties, deletion proceeds

### Edge Case: Active Accepted Work
- [ ] User working on bounties (as hunter) cannot delete account
- [ ] Error message shows count of in-progress work
- [ ] After completing/withdrawing from work, deletion proceeds

### Edge Case: Escrowed Funds
- [ ] User with escrow transactions cannot delete account
- [ ] Error message shows total amount in escrow
- [ ] After resolving escrow (complete/cancel bounties), deletion proceeds

### Edge Case: Multiple Blocking Conditions
- [ ] User with multiple issues sees all blocking reasons
- [ ] Must resolve all issues before deletion is allowed

### Data Deletion Verification
- [ ] Completed bounties are deleted
- [ ] Active bounty applications are preserved
- [ ] Rejected applications are deleted
- [ ] Escrow transactions are preserved until bounty completion
- [ ] Completed bounty transactions are deleted
- [ ] Messages and conversation participation are removed
- [ ] Notifications, push tokens, and preferences are deleted

### Error Handling
- [ ] Error handling works for unauthenticated users
- [ ] Network errors show appropriate messages
- [ ] Database errors are logged properly
