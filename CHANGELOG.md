# Changelog

All notable changes to BOUNTYExpo are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [External Beta] — 2026-03-25

### 🎉 Welcome to the External Beta

This is the first release of BOUNTYExpo open to external beta testers. The core marketplace flows are feature-complete and stable. Your feedback will directly shape the path to the public launch.

**What to test** — see the full [Beta Guide](docs/BETA_GUIDE.md).

---

### Added

#### Core Marketplace
- **Create Bounty**: Multi-step creation flow with title, description, compensation (amount or "for honor"), and optional location.
- **Postings Feed**: Browse open bounties with search and filtering.
- **Accept & Apply**: Hunters can apply to open bounties; posters review and accept applicants.
- **Escrow Wallet**: Funds are escrowed on acceptance and released upon completion.
- **Completion Flow**: Poster confirms completion, escrow is released to the hunter.

#### Messaging
- **Conversations**: 1:1 chat auto-initiated when a request is accepted.
- **Real-time Updates**: Messages arrive via Supabase Realtime without manual refresh.
- **Offline Queue**: Messages queued locally when offline and sent on reconnect.
- **Read Receipts & Typing Indicators**: Visual feedback during active conversations.

#### Authentication & Onboarding
- **Sign Up / Sign In**: Email + password via Supabase Auth.
- **Email Verification Gate**: Unverified accounts cannot access the main app.
- **Onboarding Flow**: Username, display name, location, and optional phone (4-step).
- **Password Reset**: Secure reset-by-email flow.
- **Remember Me**: Optional persistent sessions across app restarts.

#### Payments (Stripe)
- **Add Money**: Deposit funds to in-app wallet via Stripe.
- **Secure Tokenisation**: Card data handled exclusively by Stripe — never stored server-side.
- **Transaction History**: Full wallet transaction log.
- **Stripe Connect Scaffold**: Foundation for hunter payouts (full implementation post-beta).

#### Profile & Settings
- **Edit Profile**: Avatar, display name, bio, location.
- **Privacy Controls**: Granular visibility settings (profile, location, activity).
- **Blocking**: Block/unblock other users.
- **Notification Preferences**: Push and in-app notification settings.

#### Search & Discovery
- **Bounty Search**: Full-text search across postings.
- **Skill Tags**: Tag bounties and filter by skill.
- **Location-Based Discovery**: Optional location filter on the postings feed.

#### Accessibility
- **VoiceOver / TalkBack Support**: Core flows labelled and navigable via screen reader.
- **High-Contrast Mode**: System high-contrast respected throughout the UI.
- **Reduced Motion**: Animations suppressed when system reduced-motion is enabled.

#### Security
- **Input Sanitisation**: All user-supplied text sanitised before storage and display.
- **JWT / SecureStore**: Auth tokens in hardware-backed encrypted storage.
- **Rate Limiting**: Client- and server-side limits on auth and payment endpoints.
- **Content Moderation Hooks**: Infrastructure for flagging/reporting content.

#### Infrastructure
- **Error Monitoring**: Structured logging via `lib/utils/error-logger` with offline buffering.
- **Analytics**: Opt-in event tracking (Mixpanel-compatible events).
- **Push Notifications**: Expo Push Notifications for messages and bounty activity.
- **Offline Support**: Offline detection banner; write operations queued for retry.
- **Multi-Environment Config**: Separate development / preview / production env profiles.

---

### Known Limitations (Beta)

See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) for the full list. Highlights:

- Hunter **payouts** (Stripe Connect transfers) are scaffolded but not fully active in beta.
- **End-to-end message encryption** is on the roadmap but not implemented in this release.
- **Rating / Reputation system** is planned but not yet built.
- **Recurring bounties** and **advanced scheduling** are post-beta features.
- Content-Security-Policy nonces (replacing `unsafe-inline`) are scheduled for post-beta.

---

## [Internal Beta] — Prior to 2026-03-25

Internal testing builds used by the core team. Changelog not publicly tracked.
