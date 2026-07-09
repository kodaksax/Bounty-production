# Bounty Onboarding — Final Wireframe Spec (Production Validation)

Implementation-ready spec for the finalized onboarding flow. This is the source of
truth for copy, sequencing, CTA hierarchy, and edge cases, ready for user testing
and engineering handoff.

Resolves the design direction in issue #634: trust + intent welcome, role choice
("I need help with something" vs "I want to earn money"), sign-up, verification with
clear justification, payment/safety explanation, and a final ready state that pushes
a meaningful first action.

---

## 1. Summary of What Changed

| Area | Before | After |
| --- | --- | --- |
| Carousel length | 7 slides (welcome + 4 poster steps + hunter + safety) | 5 slides — poster steps condensed from 4 to 2; welcome carries trust + intent |
| Role choice | None — single "Get Started" CTA | Final slide asks "How do you want to start?" with dual role CTAs: **Start earning nearby** (hunter, primary) and **Get something done** (poster, secondary) |
| Role awareness | Onboarding ended in generic "Start Exploring" | Role intent stored on device; Done screen CTA becomes **Post your first bounty** / **Find bounties nearby** |
| Trust messaging | Escrow mentioned mid-flow | Escrow ("your money stays protected until the job is done") stated on slide 1 and reinforced on the payment slide and final safety slide |
| Verification copy | Explained benefit but not deferral | Phone + identity copy now states what the step is, why it exists, that it's skippable, and where to complete it later |
| Microcopy | Mixed length, some redundancy | Each screen answers: what is this / why am I seeing it / what happens next |

No new colors, typography, spacing, components, or navigation patterns were introduced.
The secondary role CTA reuses the existing theme surface/border tokens and the pill
button shape already used by the primary CTA.

---

## 2. Screen-by-Screen Final Wireframe Spec

### Screen order

```
Auth (sign up / sign in)
  → Onboarding entry (routing gate — no UI)
  → 01 Welcome carousel (first-time users only, 5 slides, ends in role choice)
  → 02 Username
  → 03 Details (display name, location, avatar — optional)
  → 04 Identity verification (skippable, deferred-friendly)
  → 05 Done / ready state (role-aware first action)
  → Main app
```

Phone verification (`phone.tsx` → `verify-phone.tsx`) is intentionally **deferred out
of the critical path** — it is available from the profile and surfaced when trust
benefits apply (more matches, 2FA). This keeps the flow short per the constraint
"delay heavy verification until it is needed, but make the benefit clear."

---

### 01 · Welcome carousel — `app/onboarding/carousel.tsx`

**Purpose:** Establish trust + intent in under 10 seconds and capture the user's role.

| Slide | Title | Final copy | Notes |
| --- | --- | --- | --- |
| 1 | Welcome to Bounty | "Post tasks and trusted locals get them done — or earn money completing tasks nearby. Your money stays protected until the job is done." | Trust (escrow) + intent (both roles) on the very first screen |
| 2 | Post What You Need Done | "Describe the task, set your budget and location. Nearby hunters apply — review their profiles and ratings, then accept the best match." | STEP 1 badge; poster path condensed (post + review merged) |
| 3 | Chat, Complete & Pay | "Coordinate in the app while your payment is held safely in escrow. Confirm completion to release it, then rate each other to build trust." | STEP 2 badge; payment language lives here |
| 4 | Or Browse & Earn | "Browse bounties near you, apply to the ones that fit your skills, and get paid when the work is done. You work on your schedule." | Hunter perspective |
| 5 | You're Protected | "Escrow-backed payments, verified profiles, and ratings on every job. How do you want to start?" | Trust recap + role prompt |

- **Primary CTA (slides 1–4):** `Next` (arrow icon)
- **Final slide CTAs:**
  - Primary (filled, theme primary): `Start earning nearby` → stores role `hunter`
  - Secondary (surface + border, same pill shape): `Get something done` → stores role `poster`
  - Both route to `/onboarding/username` and set `@bounty_onboarding_complete`.
- **Secondary action (all slides):** `Skip` (top-right) → confirmation modal
  (`Skip Tutorial?` / `Continue Tour` / `Skip`) → username screen, no role stored.
- **Role storage:** AsyncStorage key `@bounty_onboarding_role` (`'poster' | 'hunter'`).
  Device-local intent only — it does not gate any feature; both roles see the full app.

**Edge cases**
- Skip: no role stored → Done screen falls back to generic `Start Exploring`.
- AsyncStorage write failure: logged and ignored; navigation always proceeds.
- Returning users (`@bounty_onboarding_complete === 'true'`): carousel is bypassed
  entirely by `onboarding/index.tsx`.

**Mobile UX / animation**
- Paged horizontal `FlatList`, snap per screen; slides fade/scale via scroll
  interpolation (existing behavior, unchanged).
- Animated dot indicator (active dot widens 8 → 24).
- CTAs sit in the bottom action container within thumb reach; safe-area insets respected.

---

### 02 · Username — `app/onboarding/username.tsx`

**Purpose:** Create the public identity; the only hard-required step.

- **Title:** `Choose Your Username`
- **Copy:** "This is how posters and hunters will find you on Bounty. Pick something
  unique — you can add your name and photo next." *(what + why + what's next)*
- **Primary CTA:** `Continue` (disabled until valid + ToS accepted)
- **Trust/legal:** Terms of Service + Privacy Policy checkbox with links.
- **Edge cases:** live format validation (3–20 chars, lowercase/numbers/underscores),
  debounced uniqueness check, inline error text; users with an existing username are
  routed past this screen by `onboarding/index.tsx`.

### 03 · Details — `app/onboarding/details.tsx`

**Purpose:** Optional humanizing info (display name, location, avatar, skills, bio).

- **Primary CTA:** `Continue` · **Secondary:** `Skip`
- **Edge cases:** avatar upload failure offers retry/skip alerts; every path continues
  forward to identity verification — no dead ends.

### 04 · Identity verification — `app/onboarding/identity-verification.tsx`

**Purpose:** Lightweight KYC (ID front + selfie) with clear justification and deferral.

- **Title:** `Verify Your Identity`
- **Copy (verification + trust language):** "Verifying your identity builds trust with
  other users and unlocks faster payouts. Your documents are encrypted and only used
  for verification — never shared publicly. You can skip for now and verify later from
  your profile."
- **Primary CTA:** `Submit for Verification` (enabled once both photos are added;
  progress labels: `Uploading ID…` / `Uploading selfie…` / `Submitting…`)
- **Secondary action:** `Skip for now`
- **Submitted state:** "Thanks! Your ID and selfie are securely uploaded and queued for
  review. Most submissions are reviewed within 24–48 hours. You can keep using Bounty
  while we verify your identity." CTA: `Continue`.
- **Edge cases:** camera/library permission denial handled by picker alerts; upload
  failure keeps state and allows retry; skip is never punished — verification remains
  available from profile.

### Deferred · Phone verification — `app/onboarding/phone.tsx` + `verify-phone.tsx`

**Purpose:** Optional trust booster, out of the critical path.

- **Copy:** "A verified phone helps keep every job on Bounty trustworthy — verified
  users get more matches and responses. Your number stays private, and you can skip
  this and verify later."
- Benefit bullets: verified badge · more responses · enables 2FA.
- **Edge cases:** OTP resend with cooldown; skip continues the flow; number is never
  displayed publicly (privacy notice with lock icon).

### 05 · Done / ready state — `app/onboarding/done.tsx`

**Purpose:** Confirm success and push toward the first meaningful, role-aware action.

- **Title:** `You're All Set!` · **Subtitle:** `Welcome to Bounty, @{username}!`
- Profile summary card (username, name, location, skills, phone shown as
  `✓ Added (private)` — never the actual number).
- **Primary CTA (role-aware):**
  - poster → `Post your first bounty`
  - hunter → `Find bounties nearby`
  - no stored role → `Start Exploring`
  - All route to `/tabs/bounty-app` (dashboard), where posting and the nearby feed are
    both one tap away.
- **Helper copy:** "You can update your profile anytime from the Profile tab".
- **Edge cases:** profile persistence is timeout-guarded (8s) so a slow network never
  strands the user; the completion flag is written early to prevent redirect loops;
  the CTA shows a spinner while persisting; role read failure falls back to the
  generic label.
- **Animation:** spring check-mark scale-in followed by 300ms content fade (existing).

---

### First-time vs returning users

| State | Behavior |
| --- | --- |
| Brand-new user | Full flow: carousel → username → details → identity verification → done |
| Seen carousel, incomplete profile | `onboarding/index.tsx` skips carousel → username |
| Has username already | Skips straight to details |
| Onboarding complete | Never re-enters onboarding (per-user completion flag) |

---

## 3. Recommended Follow-up Experiments

1. **Role CTA split test:** measure poster vs hunter selection rate and 7-day
   activation (first bounty posted / first application) per chosen role.
2. **Skip-rate on identity verification:** if >70% skip, test moving the screen to
   the first payout/post moment ("verify to release your $X") instead of onboarding.
3. **Carousel length:** test 5 slides vs a single welcome screen with role choice
   only (fastest possible path) against comprehension survey scores.
4. **Done-screen deep link:** route poster CTA directly into the bounty composer and
   hunter CTA into the nearby feed with location prompt, and measure drop-off vs the
   current dashboard landing.
5. **Trust copy comprehension:** 5-second test — can users explain escrow after
   slide 1? Iterate the one-liner if not.

## 4. Checklist of Files / Components

Updated in this change:
- [x] `app/onboarding/carousel.tsx` — 5 slides, tightened copy, dual role CTAs, role storage
- [x] `app/onboarding/done.tsx` — role-aware final CTA
- [x] `app/onboarding/username.tsx` — subtitle copy (what/why/next)
- [x] `app/onboarding/phone.tsx` — subtitle copy (trust + privacy + skippable)
- [x] `app/onboarding/identity-verification.tsx` — subtitle copy (deferral made explicit)
- [x] `docs/onboarding/ONBOARDING_FINAL_SPEC.md` — this spec

Likely to be touched by follow-up experiments (not changed now):
- [ ] `app/onboarding/index.tsx` — routing gate (if flow order changes)
- [ ] `app/onboarding/_layout.tsx` — stack registration (if screens are added/removed)
- [ ] `app/onboarding/details.tsx` — if role-specific detail prompts are tested
- [ ] `app/tabs/bounty-app.tsx` — if the Done CTA deep-links into composer/feed
- [ ] `lib/context/onboarding-context.tsx` — if role intent should persist to profile
