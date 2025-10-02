# Authentication Navigation Flow

This document describes the authentication navigation flow in the BountyExpo app.

## Overview

All authentication screens use **Expo Router** (`expo-router`) for navigation, providing a consistent and type-safe navigation experience.

## Navigation Routes

### Auth Screens
- **Sign In**: `/auth/sign-in-form`
- **Sign Up**: `/auth/sign-up-form`
- **Reset Password**: `/auth/reset-password`

### Main App
- **Dashboard/Home**: `/` (root index, renders BountyApp)

## Navigation Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Flow                       │
└─────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │  Sign In     │
                    │  /auth/sign- │
                    │  in-form     │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ↓                  ↓                  ↓
   [Register]      [Forgot Password?]   [Login Success]
        │                  │                  │
        ↓                  ↓                  ↓
  ┌──────────┐      ┌─────────────┐    ┌──────────┐
  │ Sign Up  │      │Reset Password│    │Main App  │
  │ /auth/   │      │/auth/reset-  │    │    /     │
  │ sign-up  │      │password      │    └──────────┘
  │ -form    │      └──────┬───────┘          ↑
  └────┬─────┘             │                  │
       │                   │                  │
       │            [Back to Sign In]         │
       │                   │                  │
       └───────────────────┴──────────────────┘
            [After confirmation/Have account]
```

## Implementation Details

### Sign In Form (`app/auth/sign-in-form.tsx`)

**Navigation Hooks:**
```tsx
import { useRouter } from 'expo-router'
const router = useRouter()
```

**Navigation Actions:**
1. **Toggle to Register** → `router.push('/auth/sign-up-form')`
2. **Forgot Password Link** → `router.push('/auth/reset-password')`
3. **"Don't have an account?" Link** → `router.push('/auth/sign-up-form')`
4. **After Successful Sign In** → `router.replace('/')` (prevents back navigation)

### Sign Up Form (`app/auth/sign-up-form.tsx`)

**Navigation Hooks:**
```tsx
import { useRouter } from 'expo-router'
const router = useRouter()
```

**Navigation Actions:**
1. **Toggle to Login** → `router.push('/auth/sign-in-form')`
2. **After Registration Success** → Button to `router.push('/auth/sign-in-form')`
3. **"Have an account?" Link** → `router.push('/auth/sign-in-form')`

### Reset Password (`app/auth/reset-password.tsx`)

**Navigation Hooks:**
```tsx
import { useRouter } from 'expo-router'
const router = useRouter()
```

**Navigation Actions:**
1. **Back to Sign In Button** → `router.push('/auth/sign-in-form')`

### Logout (Settings Screen)

**Navigation:**
Located in `components/settings-screen.tsx`

**Actions:**
1. Signs out from Supabase
2. Clears stored tokens
3. Navigates to sign-in: `router.replace('/auth/sign-in-form')`

## Key Features

### Navigation Methods

- **`router.push(path)`**: Navigates forward, allows back navigation
- **`router.replace(path)`**: Replaces current route, prevents back navigation (used after successful auth)

### Consistent User Experience

1. **Toggle Buttons**: Segmented controls at top of sign-in/sign-up for quick switching
2. **Contextual Links**: "Forgot password?", "Don't have an account?", etc.
3. **Clear CTAs**: Primary action buttons with loading states
4. **Post-Auth Security**: Using `router.replace()` prevents users from going back to auth screens after logging in

## Authentication Status Flow

```
┌───────────────┐
│ Unauthenticated│
└───────┬────────┘
        │
        ↓
  ┌──────────┐
  │ Sign In  │ ←──────────┐
  │ Sign Up  │            │
  │  Reset   │            │
  └────┬─────┘            │
       │                  │
       ↓                  │
  ┌──────────┐            │
  │Authenticated          │
  │Main App  │            │
  └────┬─────┘            │
       │                  │
       ↓                  │
  [Logout] ───────────────┘
```

## Testing Checklist

- [ ] Sign in → Sign up toggle works
- [ ] Sign up → Sign in toggle works
- [ ] Forgot password link navigates correctly
- [ ] After successful sign in, user lands on main app
- [ ] After successful sign up, user can navigate to sign in
- [ ] Back button on reset password goes to sign in
- [ ] Logout redirects to sign in screen
- [ ] Cannot navigate back to auth screens after logging in

## Notes

- All navigation now uses `expo-router` instead of `@react-navigation/native`
- Auth state is managed by Supabase
- Tokens are stored in secure storage (`expo-secure-store`)
- The app uses file-based routing via Expo Router
