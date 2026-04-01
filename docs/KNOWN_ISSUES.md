# Known Issues — External Beta

This document lists known limitations, bugs, and incomplete features in the current external beta. It is updated as issues are resolved or newly discovered.

**Last updated**: 2026-03-25

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 | Critical / show-stopper — under active investigation |
| 🟡 | Known limitation — workaround exists or impact is limited |
| 🟢 | Resolved in a recent build |
| 🔵 | Planned post-beta — intentionally deferred |

---

## Payments & Wallet

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| PAY-1 | 🔵 | **Hunter payouts (Stripe Connect transfers) not active.** Escrow release is recorded in-app but no real bank transfer is triggered in this beta. | Payment records are visible in transaction history; real transfers will be enabled at launch. | Deferred post-beta |
| PAY-2 | 🟡 | **Stripe webhook processing** requires a correctly configured `STRIPE_WEBHOOK_SECRET`. In beta environments where this is not set, webhook events are silently ignored. | Payment UI reflects Stripe status via client polling; most flows still complete. | Documented |
| PAY-3 | 🟡 | **Add Money flow** may show a stale balance for up to 5 seconds after a successful deposit. | Pull-to-refresh on the Wallet screen forces an immediate update. | Known |

---

## Messaging

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| MSG-1 | 🔵 | **End-to-end encryption** is not implemented. Messages are encrypted in transit (TLS) but are stored in plain text in the database. | Avoid sending highly sensitive information over chat. E2E encryption is on the roadmap. | Deferred post-beta |
| MSG-2 | 🟡 | **Typing indicator** occasionally persists for a few seconds after the other user stops typing. | Cosmetic only; no functional impact. | Known |
| MSG-3 | 🟡 | **Offline queue** — messages queued while offline may be delivered out of order if multiple messages are queued before reconnection. | Reconnect with a single message, or accept minor ordering inconsistency. | Under investigation |

---

## Bounty Flows

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| BNT-1 | 🟡 | **Bounty location** is stored as free-form text and is not geocoded or validated against real addresses. | Enter a human-readable location string (city, neighbourhood). Map-based selection is planned. | Planned improvement |
| BNT-2 | 🟡 | **Status transitions** — a bounty can only move forward (open → in_progress → completed). Cancellation UI is not yet implemented. | Contact the other party via chat. Cancellation flow is planned for the next release. | Planned post-beta |
| BNT-3 | 🟡 | **Stale bounty detection** — bounties that are inactive for an extended period are not automatically archived in this beta. | Posters should manually archive old bounties via the bounty detail screen. | Planned improvement |

---

## Authentication & Onboarding

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| AUTH-1 | 🟡 | **"Remember Me"** session restoration may fail on first install if SecureStore permissions are not granted by the OS. | Sign in manually if auto-restore fails on first launch. | Known |
| AUTH-2 | 🟡 | **Email verification** re-send can be rate-limited by Supabase (typically after 3 attempts in 5 minutes). | Wait a few minutes and try again. | Known / third-party limit |

---

## Profile & Settings

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| PRF-1 | 🔵 | **Ratings & reputation system** is not yet implemented. User profiles show no ratings or feedback score. | Planned post-beta. | Deferred post-beta |
| PRF-2 | 🟡 | **Avatar upload** is not yet supported. Profile images use initials-based placeholders. | Planned for an upcoming release. | Deferred |

---

## Security

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| SEC-1 | 🔵 | **Content-Security-Policy nonces** — the CSP currently uses `unsafe-inline` for scripts. Nonce-based CSP (more secure) is scheduled for post-beta hardening. | This is a web-layer concern; the mobile app is not affected. | Planned post-beta |
| SEC-2 | 🟡 | **Engagement tracking** in search uses approximate client-side counters. Actual analytics events are a post-beta feature. | No user-facing impact. | Planned post-beta |

---

## Performance

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| PERF-1 | 🟡 | **Postings feed** may feel slow on first load if caches are cold. Subsequent loads use cached data and are fast. | Normal on first use. Pull-to-refresh forces a fresh load. | Known |
| PERF-2 | 🟡 | **Chat history** scrolling can stutter on older devices (pre-2020 low-end Android) when a conversation has 100+ messages. | Load older messages on demand is planned; FlatList optimisation in progress. | Under investigation |

---

## Platform-Specific

| # | Severity | Description | Workaround | Status |
|---|----------|-------------|------------|--------|
| PLT-1 | 🟡 | **Android back gesture** on some screens may not correctly dismiss modals. | Use the on-screen close button (✕) instead of the Android back gesture. | Under investigation |
| PLT-2 | 🟡 | **Push notifications on iOS** require explicit permission grant during onboarding. Declining them means no in-app push alerts. | Enable notifications in iOS Settings → BOUNTYExpo. | Known / OS constraint |

---

## Reporting New Issues

If you encounter a problem not listed here, please [open a Bug Report](https://github.com/kodaksax/Bounty-production/issues/new?template=bug_report.yml) on GitHub.

For security vulnerabilities, use the [GitHub Security Advisory](https://github.com/kodaksax/Bounty-production/security/advisories/new) form.
