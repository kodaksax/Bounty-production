# Email Verification Gate Implementation

## Overview
This document describes the email verification gate feature that restricts posting and applying for bounties until users verify their email addresses.

## User Flows

### 1. Signup → Onboarding → Dashboard
**Current Implementation:**
- After successful signup, users are automatically routed to onboarding (`/onboarding/username`)
- Users can complete onboarding without email verification
- Upon completing onboarding, users are routed to the dashboard (`/tabs/bounty-app`)
- Session remains active throughout the flow

**File:** `app/auth/sign-up-form.tsx`
- Line 76-78: Routes to onboarding after successful signup with active session

**File:** `app/onboarding/done.tsx`
- Line 47-50: Routes to `/tabs/bounty-app` on completion

### 2. Email Verification Status
**Implementation:**
The `isEmailVerified` flag is derived from multiple sources in priority order:

1. `session.user.email_confirmed_at` (Supabase primary field)
2. `session.user.confirmed_at` (Supabase alternative field)
3. `profile.email_verified` (Custom API field, if available)
4. Default: `false`

**Files:**
- `hooks/use-auth-context.tsx` - Type definition for `isEmailVerified`
- `providers/auth-provider.tsx` - Computation and state management

### 3. Email Verification Gates

#### Gate 1: Posting Bounties
**Locations:**
- `app/tabs/postings-screen.tsx`
  - `handleShowConfirmation()` - Blocks showing confirmation card
  - `handlePostBounty()` - Double-checks before API submission
  
- `app/screens/CreateBounty/StepReview.tsx`
  - `handleSubmit()` - Blocks final submission in multi-step flow

**Behavior:**
When an unverified user attempts to post, they see:
```
Title: "Email verification required"
Message: "Please verify your email to post bounties. We've sent a verification link to your inbox."
Button: "OK"
```

#### Gate 2: Applying to Bounties
**Location:**
- `components/bountydetailmodal.tsx`
  - `handleApplyForBounty()` - Blocks application submission

**Behavior:**
When an unverified user attempts to apply, they see:
```
Title: "Email verification required"
Message: "Please verify your email to apply for bounties. We've sent a verification link to your inbox."
Button: "OK"
```

### 4. Email Verification Service
**File:** `lib/services/auth-service.ts`

**Functions:**
- `resendVerification(email: string)` - Triggers Supabase to resend verification email
- `checkEmailVerified()` - Utility to check current verification status

**Usage:**
```typescript
import { resendVerification } from 'lib/services/auth-service'

const result = await resendVerification(user.email)
if (result.success) {
  Alert.alert('Success', result.message)
} else {
  Alert.alert('Error', result.message)
}
```

## What Users Can Do Without Verification
✅ **Allowed:**
- Complete signup
- Complete onboarding flow
- Browse bounties in the feed
- View bounty details
- Send messages in bounty detail modal
- Access wallet screen (viewing only)
- Access messenger
- View their profile

❌ **Blocked:**
- Post new bounties
- Apply to bounties

## Testing Guide

### Manual Test Plan

#### Test 1: Signup Flow
1. Navigate to signup screen
2. Create a new account with valid email/password
3. ✅ **Expected:** Automatically routed to `/onboarding/username`
4. Complete all onboarding steps
5. ✅ **Expected:** Routed to dashboard (`/tabs/bounty-app`) with active session

#### Test 2: Post Bounty While Unverified
1. Log in with an unverified account
2. Navigate to Postings → New tab
3. Fill in bounty form with valid data
4. Tap the Post/Confirm button
5. ✅ **Expected:** Alert displayed: "Email verification required"
6. ✅ **Expected:** Bounty is NOT posted

#### Test 3: Apply to Bounty While Unverified
1. Log in with an unverified account
2. Navigate to dashboard and open any bounty detail
3. Tap "Apply for Bounty"
4. ✅ **Expected:** Alert displayed: "Email verification required"
5. ✅ **Expected:** Application is NOT submitted

#### Test 4: Verify Email and Retry
**Note:** For development/testing, you can simulate verification by:
- Checking the Supabase email in development
- Or temporarily modifying the provider to force `setIsEmailVerified(true)`

1. Complete email verification (check email link)
2. Refresh/restart the app
3. Attempt to post a bounty
4. ✅ **Expected:** Post succeeds without alert
5. Attempt to apply to a bounty
6. ✅ **Expected:** Application succeeds without alert

#### Test 5: Multi-Step Create Flow
1. Log in with an unverified account
2. Navigate to the multi-step create bounty flow (if enabled)
3. Complete all steps and reach the Review step
4. Tap "Post Bounty" on the review screen
5. ✅ **Expected:** Alert displayed before escrow modal
6. ✅ **Expected:** Bounty is NOT posted

### Automated Testing (Future)
To add automated tests, consider:
- Mock `useAuthContext` to return `isEmailVerified: false`
- Render PostingsScreen and simulate post action
- Assert that Alert.alert was called with correct message
- Assert that bounty service was NOT called

## Architecture Notes

### State Management
- Email verification status is managed at the auth provider level
- Consumed by screens/components via `useAuthContext()` hook
- Updates automatically on auth state changes

### Design Decisions
1. **Why check at both form and submit stages?**
   - Form level: Provides immediate feedback
   - Submit level: Defensive programming, prevents API calls if state is stale

2. **Why allow onboarding without verification?**
   - Better UX: Users can complete profile setup immediately
   - Reduces friction in signup flow
   - Verification gate only applies to actions that affect other users

3. **Why use Alert.alert instead of inline banners?**
   - Mobile-first: Native alerts are accessible and familiar on mobile
   - Immediate blocking action: Forces user acknowledgment
   - Inline banners can be added later as complementary UI

## Future Enhancements
- [ ] Add "Resend Verification Email" button in alerts
- [ ] Add banner in Profile screen showing verification status
- [ ] Add verification reminder after X days of inactivity
- [ ] Track verification conversion metrics
- [ ] Add inline banner warning before filling out forms

## Troubleshooting

### Issue: User verified email but still seeing alert
**Solution:**
1. Check if email was actually confirmed in Supabase Auth dashboard
2. Force user to sign out and sign back in (refreshes session)
3. Check that `email_confirmed_at` field is populated

### Issue: Gate not working (unverified users can post/apply)
**Solution:**
1. Verify `useAuthContext()` is imported correctly in gated screens
2. Check that `isEmailVerified` is being destructured
3. Add console.log to see actual value of `isEmailVerified`
4. Ensure auth provider is wrapping the app correctly

## Related Files
- `hooks/use-auth-context.tsx` - Auth context type definition
- `providers/auth-provider.tsx` - Auth state management
- `lib/services/auth-service.ts` - Email verification utilities
- `app/auth/sign-up-form.tsx` - Signup flow
- `app/onboarding/done.tsx` - Onboarding completion
- `app/tabs/postings-screen.tsx` - Post bounty gate
- `components/bountydetailmodal.tsx` - Apply bounty gate
- `app/screens/CreateBounty/StepReview.tsx` - Multi-step post gate
