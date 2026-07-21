// Feature flags for phased rollout
export const FOLLOW_FEATURE_ENABLED = false; // Toggle to enable follow/follower functionality

// Temporarily disabled: users could bypass authentication entirely from the
// onboarding sign-in screen (app/onboarding/username.tsx) via a "Skip for
// now" link. Product decision to require authentication before continuing
// onboarding. The link itself lives in components/onboarding/SkipAuthLink.tsx
// and is fully wired — flip this back to true to restore it.
export const ONBOARDING_SKIP_AUTH_ENABLED = false;
