# BOUNTYExpo Routing Audit Report

## Summary

This document provides a complete audit of the BOUNTYExpo app's navigation routes using Expo Router file-based routing.

## Route Map

### Root Routes (`app/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/` | `app/index.tsx` | Root entry - renders SignInForm | N/A (entry point) |
| `/_layout` | `app/_layout.tsx` | Root layout with providers | N/A |

### Authentication Routes (`app/auth/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/auth/sign-in-form` | `app/auth/sign-in-form.tsx` | Sign in screen | ✅ Can navigate to sign-up, reset-password |
| `/auth/sign-up-form` | `app/auth/sign-up-form.tsx` | Sign up screen | ✅ `router.back()` to sign-in |
| `/auth/reset-password` | `app/auth/reset-password.tsx` | Password reset request | ✅ `router.push('/auth/sign-in-form')` |
| `/auth/email-confirmation` | `app/auth/email-confirmation.tsx` | Email confirmation screen | ✅ `router.replace('/auth/sign-in-form')` |
| `/auth/update-password` | `app/auth/update-password.tsx` | Update password after reset | ✅ Multiple navigation options |
| `/auth/splash` | `app/auth/splash.tsx` | Branded splash screen | N/A (display only) |

### Onboarding Routes (`app/onboarding/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/onboarding/` | `app/onboarding/index.tsx` | Entry point - redirects to carousel or username | ✅ Redirects |
| `/onboarding/carousel` | `app/onboarding/carousel.tsx` | Onboarding carousel | ✅ `router.replace('/onboarding/username')` |
| `/onboarding/username` | `app/onboarding/username.tsx` | Username setup | ✅ `router.push('/onboarding/details')` |
| `/onboarding/details` | `app/onboarding/details.tsx` | Profile details | ✅ `router.back()`, `router.push('/onboarding/phone')` |
| `/onboarding/phone` | `app/onboarding/phone.tsx` | Phone verification | ✅ `router.back()`, `router.push('/onboarding/done')` |
| `/onboarding/done` | `app/onboarding/done.tsx` | Onboarding complete | ✅ `router.replace('/tabs/bounty-app')` |

### Main Tab Routes (`app/tabs/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/tabs/bounty-app` | `app/tabs/bounty-app.tsx` | Main app container with BottomNav | ✅ Tab navigation |
| `/tabs/messenger-screen` | `app/tabs/messenger-screen.tsx` | Messaging screen | ✅ Via BottomNav |
| `/tabs/postings-screen` | `app/tabs/postings-screen.tsx` | User's postings | ✅ Via BottomNav |
| `/tabs/wallet-screen` | `app/tabs/wallet-screen.tsx` | Wallet management | ✅ Via BottomNav |
| `/tabs/profile-screen` | `app/tabs/profile-screen.tsx` | Profile view | ✅ Via BottomNav |
| `/tabs/search` | `app/tabs/search.tsx` | Search bounties/users | ✅ `router.back()` |
| `/tabs/choose-people-screen` | `app/tabs/choose-people-screen.tsx` | Select chat participants | ✅ `router.back()` |
| `/tabs/chat-detail-screen` | `app/tabs/chat-detail-screen.tsx` | Chat detail view | ✅ Via component callback |

### Profile Routes (`app/profile/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/profile/` | `app/profile/index.tsx` | Redirects to current user's profile | ✅ Redirect |
| `/profile/[userId]` | `app/profile/[userId].tsx` | User profile view | ✅ `router.back()` |
| `/profile/edit` | `app/profile/edit.tsx` | Edit profile | ✅ `router.back()` |
| `/profile/followers` | `app/profile/followers.tsx` | Followers list | ✅ `router.back()` |
| `/profile/following` | `app/profile/following.tsx` | Following list | ✅ `router.back()` |

### Bounty Routes (`app/bounty/[id]/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/bounty/[id]/` | `app/bounty/[id]/index.tsx` | **NEW** - Bounty router (determines user role) | ✅ Redirects or `router.back()` |
| `/bounty/[id]/cancel` | `app/bounty/[id]/cancel.tsx` | Cancel bounty request | ✅ `router.back()` |
| `/bounty/[id]/cancellation-response` | `app/bounty/[id]/cancellation-response.tsx` | Respond to cancellation | ✅ `router.back()` |
| `/bounty/[id]/dispute` | `app/bounty/[id]/dispute.tsx` | Dispute bounty | ✅ `router.back()` |

### Postings Routes (`app/postings/[bountyId]/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/postings/[bountyId]/` | `app/postings/[bountyId]/index.tsx` | Bounty dashboard (poster view) | ✅ `router.back()` |
| `/postings/[bountyId]/review-and-verify` | `app/postings/[bountyId]/review-and-verify.tsx` | Review submissions | ✅ `router.back()` or navigate to postings |
| `/postings/[bountyId]/payout` | `app/postings/[bountyId]/payout.tsx` | Payout screen | ✅ `router.back()` or `router.replace('/tabs/bounty-app')` |

### Hunter In-Progress Routes (`app/in-progress/[bountyId]/hunter/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/in-progress/[bountyId]/hunter/` | `app/in-progress/[bountyId]/hunter/index.tsx` | Hunter flow router | ✅ Redirects based on status |
| `/in-progress/[bountyId]/hunter/apply` | `app/in-progress/[bountyId]/hunter/apply.tsx` | Apply for bounty | ✅ `router.back()` |
| `/in-progress/[bountyId]/hunter/work-in-progress` | `app/in-progress/[bountyId]/hunter/work-in-progress.tsx` | Work in progress | ✅ `router.back()` |
| `/in-progress/[bountyId]/hunter/review-and-verify` | `app/in-progress/[bountyId]/hunter/review-and-verify.tsx` | Submit for review | ✅ `router.back()` |
| `/in-progress/[bountyId]/hunter/payout` | `app/in-progress/[bountyId]/hunter/payout.tsx` | Payout received | ✅ `router.back()` or `router.replace('/tabs/bounty-app')` |

### Admin Routes (`app/(admin)/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/(admin)/` | `app/(admin)/index.tsx` | Admin dashboard | ✅ AdminHeader with back |
| `/(admin)/users` | `app/(admin)/users.tsx` | User management | ✅ `router.back()` |
| `/(admin)/user/[id]` | `app/(admin)/user/[id].tsx` | User detail | ✅ `router.back()` |
| `/(admin)/bounties` | `app/(admin)/bounties.tsx` | Bounty management | ✅ `router.back()` |
| `/(admin)/bounty/[id]` | `app/(admin)/bounty/[id].tsx` | Bounty detail | ✅ `router.back()` |
| `/(admin)/transactions` | `app/(admin)/transactions.tsx` | Transaction history | ✅ `router.back()` |
| `/(admin)/analytics` | `app/(admin)/analytics.tsx` | Analytics dashboard | ✅ `router.back()` |
| `/(admin)/reports` | `app/(admin)/reports.tsx` | Moderation queue | ✅ `router.back()` |
| `/(admin)/blocked-users` | `app/(admin)/blocked-users.tsx` | Blocked users | ✅ `router.back()` |
| `/(admin)/audit-logs` | `app/(admin)/audit-logs.tsx` | Audit logs | ✅ `router.back()` |
| `/(admin)/settings/` | `app/(admin)/settings/index.tsx` | Admin settings | ✅ `router.back()` |
| `/(admin)/settings/general` | `app/(admin)/settings/general.tsx` | General settings | ✅ `router.back()` |
| `/(admin)/settings/notifications` | `app/(admin)/settings/notifications.tsx` | Notification settings | ✅ `router.back()` |
| `/(admin)/settings/security` | `app/(admin)/settings/security.tsx` | Security settings | ✅ `router.back()` |
| `/(admin)/settings/audit-log` | `app/(admin)/settings/audit-log.tsx` | Settings audit log | ✅ `router.back()` |
| `/(admin)/support/` | `app/(admin)/support/index.tsx` | Support center | ✅ `router.back()` |
| `/(admin)/support/help` | `app/(admin)/support/help.tsx` | Help center | ✅ `router.back()` |
| `/(admin)/support/feedback` | `app/(admin)/support/feedback.tsx` | Send feedback | ✅ `router.back()` |
| `/(admin)/not-found` | `app/(admin)/not-found.tsx` | Admin 404 page | ✅ Go to dashboard or back |

### Legal Routes (`app/legal/`)

| Route | File | Description | Back Navigation |
|-------|------|-------------|-----------------|
| `/legal/terms` | `app/legal/terms.tsx` | Terms of service | ✅ `router.back()` |
| `/legal/privacy` | `app/legal/privacy.tsx` | Privacy policy | ✅ `router.back()` |

### Screen Components (Not Routes)

| File | Description |
|------|-------------|
| `app/screens/CreateBounty/index.tsx` | Create bounty flow (rendered inline) |
| `app/screens/CreateBounty/StepTitle.tsx` | Title step |
| `app/screens/CreateBounty/StepDetails.tsx` | Details step |
| `app/screens/CreateBounty/StepCompensation.tsx` | Compensation step |
| `app/screens/CreateBounty/StepLocation.tsx` | Location step |
| `app/screens/CreateBounty/StepReview.tsx` | Review step |

## Issues Found and Fixed

### 1. Dead End: `/bounty/[id]` Route

**Problem**: The `components/notifications-bell.tsx` navigated to `/bounty/${data.bountyId}` but there was no `index.tsx` file in `app/bounty/[id]/`. This caused a 404 or navigation error.

**Solution**: Created:
- `app/bounty/[id]/_layout.tsx` - Stack layout for bounty routes
- `app/bounty/[id]/index.tsx` - Smart router that determines user role (poster/hunter) and redirects appropriately

### 2. Missing Layout File

**Problem**: `app/bounty/[id]/` folder had no `_layout.tsx` file, which is required for consistent Stack navigation.

**Solution**: Added `app/bounty/[id]/_layout.tsx` with proper Stack configuration.

## Deep Linking Configuration

The app is configured with deep linking support in `app.json`:

```json
{
  "expo": {
    "scheme": "bountyexpo-workspace",
    "extra": {
      "router": {}
    }
  }
}
```

### Supported Deep Link Patterns

- `bountyexpo-workspace://` - App scheme (configured in app.json)
- Bounty links: `bountyexpo-workspace://bounty/{id}`
- Profile links: `bountyexpo-workspace://profile/{userId}`
- Postings: `bountyexpo-workspace://postings/{bountyId}`
- Notification deep links handled in `components/notifications-bell.tsx`

**Note**: The app also references `bountyexpo://bounties/{id}` in share functionality (bountydetailmodal.tsx), 
which should be updated to use the configured scheme `bountyexpo-workspace://`.

## Navigation Patterns Used

### 1. `router.push()` - Stack navigation (adds to history)
Used for: Navigating to detail views, modals, flows where back is expected

### 2. `router.replace()` - Replace current screen
Used for: Completing flows, authentication redirects, role-based routing

### 3. `router.back()` - Go back in stack
Used for: All screens have back navigation via buttons or gestures

### 4. Tab Navigation via BottomNav
The main app uses a custom BottomNav component rather than Expo Router tabs.
State is managed in `app/tabs/bounty-app.tsx` with `activeScreen` state.

## Screens with Modal Dismissal

All modals have proper close buttons and dismiss handlers:
- `BountyDetailModal` - X button, handleClose function
- `ReportModal` - Close button
- `EditPostingModal` - Cancel/Save buttons
- `PaymentMethodsModal` - Close button
- `AddCardModal` - Cancel button
- `TransactionDetailModal` - Close button

## Orphaned Routes

No orphaned routes were found. All routes are reachable from appropriate entry points.

## Recommendations

1. **Consider adding a tabs `_layout.tsx`**: While the current implementation works, adding a layout file for tabs would enable Expo Router's built-in tab navigation features.

2. **Type-safe navigation**: Consider using typed routes with `expo-router/typed` for compile-time route checking.

3. **Deep link testing**: Test all deep link patterns on both iOS and Android simulators.

4. **Route guards**: Add authentication guards in layout files rather than individual screens for consistency.
