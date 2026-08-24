# Auth / onboarding entry — device matrix

Sign-off runbook for the changes in `fix/auth-onboarding-entry-hardening`. Automated coverage
proves the state machine in isolation; this proves it on a real device, where the things that
actually broke live — cold start, backgrounding, SecureStore persistence, and real network latency.

**Run every row before publishing at 100%.** Rows marked **P0** are the three reported beta
failures and are release-blocking on their own.

---

## Before you start

**Two accounts, and one of them must be brand new.** Most of these bugs only reproduce on an
account that has never completed onboarding — a returning account takes a different branch on
every single screen involved.

| | |
|---|---|
| `NEW@…` | Never registered. Created fresh during Test A. Use a real inbox you control. |
| `OLD@…` | Existing, fully onboarded, password known. |

**Reset device state before Test A** (otherwise you are testing the returning-user path):
delete and reinstall the app. That clears SecureStore (the Supabase session) and AsyncStorage
(`@bounty_has_signed_in_before`, the per-user onboarding flag, and the onboarding draft). A
logout is **not** equivalent — `@bounty_has_signed_in_before` survives it deliberately, which is
what makes a logged-out returning user see the log-in form instead of first-run onboarding.

**Watch these while testing.** They are how you tell "it worked" from "it happened to look right":

- Console (Metro, or Xcode/logcat on a store build): `[index] Routing decision:`,
  `[onboarding]`, `[sign-in]`, `[sign-up]`, `[AuthProvider]`.
- PostHog live events: `auth_signup_started` → `auth_signup_success` → `onboarding_started`
  (with `authenticated: true`). A stray `onboarding_welcome_viewed` **after** a successful
  registration is the exact regression this branch fixes.
- `auth_signin_blocked` — a sign-in tap rejected locally before any request. Previously invisible;
  if this fires during normal use, the throttle is too aggressive.
- `auth_signup_session_failed` — account created, session not established. Should be ~never.

---

## P0 — the three reported failures

### A. Brand-new user reaches onboarding without re-authenticating

The headline bug. **Do this on a freshly reinstalled app.**

1. Open the app → Welcome (role CTAs + "Log In").
2. Pick a role → sign-in step → **Continue with email**.
3. Fill the form, tap **Create Account**.

| Check | Expected |
|---|---|
| A1 | You land on an **onboarding step**, not Welcome and not the log-in form. |
| A2 | You are **never asked for a password again**. |
| A3 | No Welcome screen flashes in transit, even for a frame. |
| A4 | PostHog: `auth_signup_success` then `onboarding_started` with `authenticated: true`. |
| A5 | Complete onboarding through to the app. |

> **Historical note (2026-08-24):** this used to also call out running A with the role step
> skipped, via the `onboarding-skip-role-selection` PostHog test arm ("Get started" instead of two
> role buttons) — that arm never recorded an intent, and is where this bug failed 100% of the
> time. That arm's code was deleted once the flag was confirmed disabled in PostHog (see
> `app/onboarding/welcome.tsx`'s top comment), so there is no longer a "skip role selection" path
> to force. The automated equivalent, `__tests__/components/onboarding/onboarding-gate.test.tsx`
> (first case), still covers a signed-in user with no recorded intent — that scenario can still
> happen for a resumed draft from an older build.

### B. Wrong password is fully recoverable

Use `OLD@…`.

1. Enter the correct email and a **wrong** password → **Sign In**.
2. Observe the error banner.
3. Correct the password → **Sign In** again.

| Check | Expected |
|---|---|
| B1 | The error appears and the spinner stops. |
| B2 | The password field is editable again (not stuck disabled). |
| B3 | The retry **actually fires a request** — you see a spinner, not a dead tap. |
| B4 | **Try Again** on the banner works too. |
| B5 | Correct password signs in and lands in the app. |
| B6 | Editing either field clears the stale error banner. |

**B-extended (the sticky-CAPTCHA path — this is what made it look permanent):**

7. Fail **three** times in a row. A "Security Check" arithmetic challenge appears.
8. Tap **Sign In** without solving it → an error naming the security check, *anchored to the
   challenge*, not a generic failure.
9. Solve it, enter the correct password → signs in.
10. **Force quit, reopen, sign out, and sign in again.** The CAPTCHA must **not** still be armed.
    (Before this branch it was, forever.)
11. Fail **five** times → 5-minute lockout with a countdown. Wait it out → the form comes back
    **clean**, with no CAPTCHA still armed and no second lockout.

### C. A brand-new user can actually get into the app

Not a separate defect — A + B on one person — but verify the whole arc end to end:

register → session → profile → onboarding → **app** → force quit → reopen → **still signed in**.

---

## Session & lifecycle

### D. Cold start keeps you signed in

1. Signed in, sitting on the feed.
2. Force quit (swipe from app switcher — not just backgrounding).
3. Reopen.

| Check | Expected |
|---|---|
| D1 | Lands on the app. |
| D2 | **Welcome/log-in never flashes**, not even for a frame. A brief spinner is fine. |
| D3 | Repeat 3× — must be deterministic, not "usually". |

### E. Background → foreground

1. Signed in → background the app for **> 1 hour** (this is what exercises token refresh; a
   30-second background proves nothing).
2. Foreground it.

| Check | Expected |
|---|---|
| E1 | Still signed in; no re-auth prompt. |
| E2 | Data loads (the token refreshed rather than silently expiring). |

### F. Logout → login

1. Settings → Log Out.
2. Confirm you land on the **log-in form** (not first-run Welcome — the device has signed in before).
3. Sign back in.

| Check | Expected |
|---|---|
| F1 | Logout returns to sign-in. |
| F2 | Sign-in works immediately afterward. |
| F3 | **No data from the previous session is visible** at any point. |

**F-extended — account switching (a security check, not a UX one):**

4. Log out of `OLD@…`, log in as `NEW@…` **immediately**, without killing the app.
5. Watch the profile tab, wallet balance, and feed during the transition.

| Check | Expected |
|---|---|
| F4 | You never see `OLD@…`'s name, avatar, or balance while `NEW@…` is signing in. |

### G. Interrupted onboarding resumes

1. Register a new account, get partway through onboarding.
2. **Force quit** mid-flow.
3. Reopen.

| Check | Expected |
|---|---|
| G1 | Resumes in onboarding — **not** at Welcome, **not** at the log-in form. |
| G2 | Previously entered details are still there. |
| G3 | You can finish and reach the app. |

---

## Adverse conditions

### H. Slow / flaky network

Use iOS Network Link Conditioner ("Very Bad Network" / 3G) or Android emulator throttling.

| Check | Expected |
|---|---|
| H1 | Cold start on a slow network does **not** conclude you are logged out. |
| H2 | A slow sign-in shows a spinner and either succeeds or gives a retryable error — it never hangs forever. |
| H3 | After any failure, the button is usable again. |

### I. Offline

1. Signed in → airplane mode → force quit → reopen.

| Check | Expected |
|---|---|
| I1 | You stay signed in (the persisted session is read locally). |
| I2 | You get a connectivity error or a "Connection interrupted / Retry" screen — **not** a log-out. |
| I3 | Restore connectivity → **Retry** recovers without a re-login. |

### J. Registration edge cases

| Check | Expected |
|---|---|
| J1 | Registering an **already-registered** email → clear "already registered, sign in instead". |
| J2 | Taken username → clear message, form still usable. |
| J3 | Kill the network **right after** tapping Create Account → either you land in onboarding, or you get the **"Your account is ready — Sign In"** recovery screen. Never a dead end, and never "sign-up failed" for an account that exists. |
| J4 | From J3's recovery screen, **Sign In** works and the email is **prefilled**. |

### K. Delete account → recreate on the same device (P0)

Added 2026-08-24 after a report that a deleted-and-recreated account landed in an "old/legacy"
onboarding experience. Root cause: `clearLocalUserData()` in
`lib/services/account-deletion-service.ts` was clearing a hardcoded list of AsyncStorage key names
that no longer matched what the app actually writes, so **in-app account deletion was a near
no-op for local state** — unlike the delete-and-reinstall reset used in "Before you start" above,
which wipes AsyncStorage entirely by construction. See `app/onboarding/welcome.tsx`'s top comment
for the related welcome-screen-experiment-arm caching bug fixed at the same time.

1. Sign in as `OLD@…` (or any account), get partway or all the way through onboarding.
2. **Settings → Delete Account** (in-app deletion — do *not* reinstall the app for this test; the
   whole point is that in-app deletion must clean up as thoroughly as a reinstall does).
3. Immediately register a **brand-new** account (`NEW@…`) on the same device, same session.

| Check | Expected |
|---|---|
| K1 | Step 1's app opens on **Welcome**, not the log-in form — `@bounty_has_signed_in_before` was cleared. |
| K2 | The new account lands on the **current** welcome screen (proof-card / poster-first layout) — there is no other design left for it to fall back to. |
| K3 | Onboarding starts genuinely fresh: no leftover bio/skills/task text, no role pre-selected from the deleted account's draft. |
| K4 | `AsyncStorage` has no lingering `@bounty_onboarding_state`, `@bounty_onboarding_state:<oldUserId>`, or `@bounty_onboarding_completed:<oldUserId>` keys (inspect via Flipper/React Native debugger if available). |
| K5 | If the deletion response logged `PARTIAL DELETION` (Metro/device console), re-registering with the **same** email correctly fails with "already registered" rather than silently succeeding — file that as its own bug, it means the backend's `admin.deleteUser` failed and only the profile row was removed. |

Automated equivalent: `__tests__/lib/services/account-deletion-service.test.ts`.

---

## Sign-off

| Platform | Build | Tester | Date | Result |
|---|---|---|---|---|
| iOS | | | | |
| Android | | | | |

Blockers found:

Publish decision: ☐ 100%  ☐ staged at ____%  ☐ hold

---

## Notes on what is *not* covered here

- **The `onboarding-skip-role-selection` test arm** is the highest-risk population and the hardest
  to force manually. If you cannot bucket into it, treat the automated gate test as the evidence.
- **Real Apple/Google sign-in** paths share the post-auth routing but not the sign-up form; A and C
  cover the email path only. Run A once via Apple sign-in if that is a meaningful share of signups
  (recent production data says it is — most recent registrations are Apple/Google, not email).
