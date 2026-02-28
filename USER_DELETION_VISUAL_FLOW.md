# User Account Deletion Flow - Visual Guide

## Overview
This document provides visual diagrams and flow charts to understand the user account deletion process.

## Before Fix vs After Fix

### Before Fix: Failure Scenarios

```
┌─────────────────────────────────────────────────────────────┐
│                    User Deletion Flow - BEFORE              │
└─────────────────────────────────────────────────────────────┘

User clicks "Delete Account"
        │
        ▼
┌──────────────────────┐
│ Check Authentication │
└──────────────────────┘
        │
        │ Uses: supabase.auth.getUser()
        │ Problem: Fails if token expired
        │
        ▼
    ❌ Session Expired?
        │
        ├─YES─► "No authenticated user found"
        │       [User stuck, cannot delete]
        │
        └─NO───► Continue to API call
                      │
                      ▼
              ┌──────────────────┐
              │ Call API Server  │
              └──────────────────┘
                      │
                      ├─Server Down?
                      │     │
                      │     └─YES─► "Failed to delete account"
                      │             [No fallback]
                      │
                      ├─Database Error?
                      │     │
                      │     └─YES─► "Database error deleting user"
                      │             [FK constraints blocking]
                      │
                      └─Connection Timeout?
                            │
                            └─YES─► [Hangs forever]
                                    [No timeout]
```

### After Fix: Success Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Deletion Flow - AFTER               │
└─────────────────────────────────────────────────────────────┘

User clicks "Delete Account"
        │
        ▼
┌──────────────────────┐
│ Show Confirmation    │
│ Dialog               │
└──────────────────────┘
        │
        ▼
User confirms deletion
        │
        ▼
┌──────────────────────┐
│ Check Session        │
│ getSession()         │
└──────────────────────┘
        │
        ├─Session Valid?
        │     │
        │     ├─NO──► Clear error message:
        │     │       "No active session. Please sign in again."
        │     │       ✅ User knows what to do
        │     │
        │     └─YES──► Continue
        │
        ▼
┌──────────────────────┐
│ Get User Info        │
│ (from cleanup)       │
└──────────────────────┘
        │
        ▼
Show: "Please wait while we delete your account..."
        │
        ▼
┌──────────────────────┐
│ Call API Server      │
│ with 30s timeout     │
└──────────────────────┘
        │
        ├─Success?
        │     │
        │     └─YES──► ✅ "Account deleted successfully"
        │              Shows cleanup details:
        │              - X bounties archived
        │              - $Y refunded
        │              → Redirect to sign-in
        │
        ├─Network Error?
        │     │
        │     └─YES──► Try Fallback ↓
        │
        ├─Timeout?
        │     │
        │     └─YES──► "Request timed out. Check connection."
        │              ✅ Actionable message
        │
        └─API Down?
              │
              └─YES──► Try Fallback ↓

┌──────────────────────────────┐
│ FALLBACK: Direct Deletion    │
└──────────────────────────────┘
        │
        ▼
Delete profile from Supabase directly
        │
        ├─Success?
        │     │
        │     └─YES──► ✅ "Account data deleted successfully"
        │              ⚠️  "Note: Complete deletion requires API"
        │              → Redirect to sign-in
        │
        └─Failed?
              │
              └─YES──► ❌ Detailed error message
                       "Contact support with this error: [details]"
```

## Component Interaction Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                 Component Interaction Flow                    │
└──────────────────────────────────────────────────────────────┘

┌─────────────────┐
│   User (UI)     │
└─────────────────┘
        │
        │ Clicks "Delete Account"
        ▼
┌─────────────────────────────┐
│  SettingsScreen             │
│  (settings-screen.tsx)      │
└─────────────────────────────┘
        │
        │ Shows confirmation dialog
        │ User confirms
        ▼
┌─────────────────────────────┐
│  AccountDeletionService     │
│  (account-deletion-service) │
└─────────────────────────────┘
        │
        ├─1─► Check session (getSession)
        │
        ├─2─► Get deletion info (bounties, escrow, etc)
        │
        ├─3─► Call API endpoint
        │     │
        │     ▼
        │   ┌──────────────────────────┐
        │   │  API Server              │
        │   │  (api/server.js)         │
        │   └──────────────────────────┘
        │           │
        │           ├─► Verify token
        │           │
        │           ├─► Delete from auth.users
        │           │   (Supabase Admin)
        │           │   │
        │           │   ▼
        │           │ ┌─────────────────────────┐
        │           │ │  Supabase Auth          │
        │           │ └─────────────────────────┘
        │           │           │
        │           │           │ CASCADE
        │           │           ▼
        │           │ ┌─────────────────────────┐
        │           │ │  Profiles Table         │
        │           │ └─────────────────────────┘
        │           │           │
        │           │           │ TRIGGER
        │           │           ▼
        │           │ ┌─────────────────────────┐
        │           │ │  Cleanup Function       │
        │           │ │  - Archive bounties     │
        │           │ │  - Refund escrow        │
        │           │ │  - Clear notifications  │
        │           │ └─────────────────────────┘
        │           │
        │           └─► Return success
        │
        └─4─► Sign out user
              │
              └─► Navigate to sign-in

```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Error Handling Matrix                     │
└─────────────────────────────────────────────────────────────┘

┌────────────────────┬──────────────────┬─────────────────────┐
│   Error Type       │   Old Behavior   │   New Behavior      │
├────────────────────┼──────────────────┼─────────────────────┤
│ Session Expired    │ Generic error    │ "Please sign in     │
│                    │ User confused    │  again" + auto      │
│                    │                  │  redirect           │
├────────────────────┼──────────────────┼─────────────────────┤
│ Network Error      │ Hangs/fails      │ Timeout after 30s   │
│                    │ No feedback      │ + clear message     │
├────────────────────┼──────────────────┼─────────────────────┤
│ API Server Down    │ Total failure    │ Try fallback        │
│                    │ No alternative   │ + partial success   │
├────────────────────┼──────────────────┼─────────────────────┤
│ Token Invalid      │ Generic error    │ "Invalid token.     │
│                    │                  │  Sign in again."    │
├────────────────────┼──────────────────┼─────────────────────┤
│ Database Error     │ No details       │ Full error + logs   │
│                    │                  │ + support contact   │
└────────────────────┴──────────────────┴─────────────────────┘
```

## Data Cleanup Flow

```
┌─────────────────────────────────────────────────────────────┐
│              Database Cleanup Trigger Flow                   │
└─────────────────────────────────────────────────────────────┘

DELETE FROM auth.users WHERE id = 'user-id'
        │
        │ CASCADE to profiles
        ▼
DELETE FROM profiles WHERE id = 'user-id'
        │
        │ BEFORE DELETE trigger fires
        ▼
┌──────────────────────────────────────┐
│  handle_user_deletion_cleanup()      │
└──────────────────────────────────────┘
        │
        ├─1─► Archive active bounties
        │     (status → 'archived')
        │
        ├─2─► Create refund transactions
        │     (for pending escrow)
        │
        ├─3─► Release hunter assignments
        │     (accepted_by → NULL, reopen bounties)
        │
        ├─4─► Reject pending applications
        │     (status → 'rejected')
        │
        └─5─► Delete notifications & tokens
              (personal data removal)
        
        Then: CASCADE/SET NULL for related tables
        │
        ├─► Messages: DELETE CASCADE
        ├─► Skills: DELETE CASCADE
        ├─► Bounties: SET NULL (preserve for audit)
        ├─► Transactions: SET NULL (preserve for audit)
        └─► Reports: SET NULL (preserve for audit)

Final Result: User deleted, data cleaned, audit trail preserved
```

## State Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                Account Deletion State Machine                │
└─────────────────────────────────────────────────────────────┘

        ┌─────────────┐
        │   INITIAL   │
        │  (Logged In)│
        └─────────────┘
              │
              │ User clicks "Delete Account"
              ▼
        ┌─────────────┐
        │ CONFIRMING  │
        │ (Show Alert)│
        └─────────────┘
              │
              ├─Cancel─► Back to INITIAL
              │
              │ Confirm
              ▼
        ┌─────────────┐
        │ VALIDATING  │
        │ (Check Auth)│
        └─────────────┘
              │
              ├─Invalid─► ERROR (Auth Failed)
              │           │
              │           └─► Show "Sign in again"
              │
              │ Valid
              ▼
        ┌─────────────┐
        │  DELETING   │
        │ (API Call)  │
        └─────────────┘
              │
              ├─Success─► DELETED
              │           │
              │           └─► Sign out & redirect
              │
              ├─Network Error─► FALLBACK
              │                 │
              │                 └─► Try direct deletion
              │
              └─Timeout─► ERROR (Timeout)
                          │
                          └─► Show retry option

States:
• INITIAL: User logged in, normal operation
• CONFIRMING: Showing confirmation dialog
• VALIDATING: Checking authentication
• DELETING: API call in progress
• FALLBACK: Trying alternative deletion
• DELETED: Success, cleanup complete
• ERROR: Failed with message
```

## Security Flow

```
┌─────────────────────────────────────────────────────────────┐
│                 Security Validation Flow                     │
└─────────────────────────────────────────────────────────────┘

Client Request
        │
        │ Include: Bearer <access_token>
        ▼
┌────────────────────────┐
│  API Server            │
└────────────────────────┘
        │
        ▼
┌────────────────────────┐
│ 1. Check Authorization │
│    Header Present?     │
└────────────────────────┘
        │
        ├─NO──► 401 Unauthorized
        │
        └─YES──► Continue
        
        ▼
┌────────────────────────┐
│ 2. Verify Token with   │
│    Supabase Admin      │
└────────────────────────┘
        │
        ├─Invalid─► 401 Invalid Token
        │
        └─Valid──► Continue
        
        ▼
┌────────────────────────┐
│ 3. Extract User ID     │
│    from Token          │
└────────────────────────┘
        │
        ▼
┌────────────────────────┐
│ 4. Log Deletion        │
│    Attempt             │
└────────────────────────┘
        │
        ▼
┌────────────────────────┐
│ 5. Delete User         │
│    (auth.users)        │
└────────────────────────┘
        │
        ├─Failed─► 500 Deletion Error
        │          + Log details
        │
        └─Success─► 200 Success
                    + Log completion
```

## Timeline: Typical Successful Deletion

```
Time (seconds)
  0s ├─► User clicks "Delete Account"
     │
     │   [Confirmation Dialog]
  1s ├─► User confirms
     │
     │   [Session Validation]
  1.5s ├─► Session valid
     │
     │   [Get deletion info]
  2s ├─► Info retrieved (bounties, escrow)
     │
     │   [API Call Starts]
  2.5s ├─► Request sent to /auth/delete-account
     │
     │   [Backend Processing]
  3s ├─► Token verified
     │
  3.5s ├─► Deletion triggered
     │
  4s ├─► Cleanup trigger runs
     │
  4.5s ├─► Auth user deleted
     │
  5s ├─► Success response received
     │
     │   [Client Cleanup]
  5.5s ├─► Clear tokens
     │
  6s ├─► Sign out
     │
  6.5s ├─► Show success message
     │
  7s ├─► Redirect to sign-in
     │
     └─► ✅ Complete

Total: ~7 seconds for complete deletion
```

## Migration Impact

```
┌─────────────────────────────────────────────────────────────┐
│           Migration: Before vs After Deletion               │
└─────────────────────────────────────────────────────────────┘

WITHOUT MIGRATION (Before):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DELETE FROM profiles WHERE id = 'user-id'
        │
        ▼
    ❌ ERROR: FK constraint violation
    "Cannot delete - referenced by bounties table"
    
    Result: Deletion blocked, user stuck


WITH MIGRATION (After):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DELETE FROM profiles WHERE id = 'user-id'
        │
        ▼
    TRIGGER fires (BEFORE DELETE)
        │
        ├─► Archive 3 bounties
        ├─► Refund $150 escrow
        ├─► Release 2 assignments
        ├─► Reject 5 applications
        └─► Delete 47 notifications
        
        ▼
    DELETE proceeds with SET NULL
        │
        ├─► Bounties: user_id → NULL (preserved)
        ├─► Transactions: user_id → NULL (preserved)
        ├─► Messages: CASCADE (deleted)
        └─► Skills: CASCADE (deleted)
        
        ▼
    ✅ SUCCESS: User deleted, data managed
    
    Result: Clean deletion, audit trail maintained
```

## Summary

The fix transforms user deletion from a brittle, error-prone process into a robust, user-friendly operation with:

1. ✅ **Reliable Authentication**: Session-based validation
2. ✅ **Graceful Fallbacks**: Multiple paths to success
3. ✅ **Clear Feedback**: Users always know what's happening
4. ✅ **Secure**: Proper token verification
5. ✅ **Auditable**: Comprehensive logging
6. ✅ **Data Integrity**: Migration handles cleanup

The flow is now predictable, handles edge cases well, and provides excellent user experience even when things go wrong.
