// Feature flags for phased rollout
export const FOLLOW_FEATURE_ENABLED = false; // Toggle to enable follow/follower functionality
export const HUNTER_CAPABILITIES_ENABLED = false;

// Temporarily disabled: users could bypass authentication entirely from the
// onboarding sign-in screen (app/onboarding/username.tsx) via a "Skip for
// now" link. Product decision to require authentication before continuing
// onboarding. The link itself lives in components/onboarding/SkipAuthLink.tsx
// and is fully wired — flip this back to true to restore it.
export const ONBOARDING_SKIP_AUTH_ENABLED = false;

// The poster's 72-hour review window: "You have until … If you don't
// respond, Bounty reviews it" / "Bounty support is reviewing this"
// (lib/utils/review-deadline.ts, and the matching dispute-reason help text).
// Nothing backs that promise until migrations
// 20261002120000_escrow_recourse_states and
// 20261002120100_review_window_and_recourse_queue are applied — as of
// 2026-10-19 they are applied on neither staging nor production, and no
// cron reviews overdue work. Flip to true in the same release that applies
// both on production (a JS-only change, so OTA-safe). (SBA-10)
export const REVIEW_WINDOW_ENABLED = false;
