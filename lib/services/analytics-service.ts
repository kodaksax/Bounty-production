// lib/services/analytics-service.ts - Analytics tracking service backed by PostHog
//
// PostHog is the single source of truth for product analytics. This service
// provides a typed, app-wide facade over the shared PostHog client defined in
// `lib/posthog.ts`, so non-React surfaces (services, hooks, startup) emit the
// exact same events into the exact same PostHog project as the React
// `usePostHog()` hook and autocapture.
import type { analytics as HeyCatchAnalytics } from '@heycatch/sdk';
import { Platform } from 'react-native';
import {
    isPostHogReady,
    capture as posthogCapture,
    flush as posthogFlush,
    identify as posthogIdentify,
    reset as posthogReset,
    screen as posthogScreen,
    setPersonProperties as posthogSetPersonProperties,
} from '../posthog';

// @heycatch/sdk is resolved lazily and defensively instead of being imported
// at module scope.
//
// app/_layout.tsx imports this service, so a static import here is evaluated
// as part of the root layout module. Anything the SDK -- or the separate copy
// of posthog-react-native it bundles -- throws on import would then take the
// app down before React ever mounts, leaving it frozen on the splash screen
// with no crash report and no Sentry event. See the note in app/_layout.tsx.
//
// Deferring it means the first failure surfaces at an ordinary call site
// (all of which already swallow errors) rather than at startup.
type HeyCatchApi = typeof HeyCatchAnalytics;

let heycatchModule: HeyCatchApi | null | undefined;

const heycatch = (): HeyCatchApi | null => {
  if (heycatchModule !== undefined) return heycatchModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    // Cast through unknown: @heycatch/sdk ships separate declaration files per
    // export condition, so the type require() resolves to is structurally
    // identical to the imported one but not identical by nominal identity.
    heycatchModule =
      ((require('@heycatch/sdk').analytics ?? null) as unknown) as HeyCatchApi | null;
  } catch {
    heycatchModule = null;
  }
  return heycatchModule;
};

// Track key user events according to requirements.
//
// ── CANONICAL MARKETPLACE-LIFECYCLE EVENTS ─────────────────────────────────
// The names below are the canonical taxonomy for the real marketplace
// lifecycle. Several were renamed in place from older names on 2026-08-28
// (see docs/analytics/EVENT_TAXONOMY_CUTOVER.md § "Canonical rename"):
//
//   composer_opened        (was post_flow_started)
//   bounty_started         (was post_started)
//   bounty_submitted       (new — publish attempt, before success)
//   bounty_published       (unchanged name; post_published folded into it)
//   bounty_cancelled       (unchanged)
//   bounty_viewed          (unchanged)
//   application_started    (was bounty_claim_started)
//   application_submitted  (was bounty_claim_submitted)
//   application_failed     (was bounty_claim_failed)
//   application_withdrawn  (new — hunter retracts a pending application)
//   application_accepted   (was bounty_claimed / bounty_accepted, de-duped)
//   work_started           (new — bounty transitions to in_progress)
//   completion_submitted   (new — hunter submits work for review)
//   bounty_completed       (unchanged)
//   dispute_started        (was dispute_opened; now also covers workflow disputes)
//   signup_completed       (was user_signed_up)
//   onboarding_completed   (unchanged)
//   role_selected          (was onboarding_role_selected)
//   poster_activated       (new — first successful publish, see lib/analytics/lifecycle.ts)
//   hunter_activated       (new — first accepted application)
//
// Every canonical event SHOULD carry, where known: bounty_id, amount,
// application_id, role ('poster' | 'hunter'), surface, and source/referrer.
// Never attach raw message/description text, emails, or precise coordinates.
// PostHog is behavioural analytics; the Supabase row state is operational truth.
// ──────────────────────────────────────────────────────────────────────────
export type AnalyticsEvent =
  // App lifecycle / acquisition funnel
  | 'app_opened'
  // Auth events
  // `signup_completed` (renamed from `user_signed_up`) is the single signup
  // conversion event. The `auth_signup_*` events below are diagnostic detail
  // on how a registration attempt ended — keep them distinct.
  | 'signup_completed'
  | 'user_logged_in'
  | 'user_logged_out'
  | 'email_verified'
  // Registration lifecycle. `signup_completed` above stays the single conversion
  // event; these describe HOW a registration attempt ended so a future
  // "new users can't get in" report is traceable without a device in hand.
  // Deliberately NOT one event per auth stage — the per-stage traces stay
  // local (see lib/utils/auth-diagnostics.ts) to avoid drowning PostHog.
  | 'auth_signup_started'
  | 'auth_signup_success'
  | 'auth_signup_failed'
  // Registration succeeded but the immediate sign-in that follows it did not,
  // so the account exists with no session. The user is NOT in the app.
  | 'auth_signup_session_failed'
  // The backend created the account without an active session because email
  // confirmation is required.
  | 'auth_signup_requires_confirmation'
  // A sign-in tap was rejected locally (CAPTCHA required / lockout active)
  // before any request was made. Previously invisible — the user experiences
  // it as "the Sign In button stopped working".
  | 'auth_signin_blocked'
  // Onboarding funnel — see app/onboarding/*. Fired in order for a fresh
  // signup: welcome_viewed -> role_selected -> auth_started -> auth_completed
  // -> style_step_viewed -> (style_selected)* -> profile_step_viewed ->
  // (profile_submitted | step_skipped)* -> completed
  | 'onboarding_welcome_viewed'
  // Fired by the onboarding gate (app/onboarding/index.tsx) each time it
  // resolves a destination: `onboarding_started` for a fresh entry,
  // `onboarding_resumed` when an in-progress draft is picked back up. Both
  // carry `authenticated`, which is what distinguishes "new user continuing
  // straight from registration" from "logged-out visitor browsing the intro".
  | 'onboarding_started'
  | 'onboarding_resumed'
  // Canonical: the user picked poster / hunter intent (was `onboarding_role_selected`).
  | 'role_selected'
  // Fired by app/onboarding/welcome.tsx (the poster_first design, formerly
  // the 'test' arm of the now-concluded 'welcome-page-redesign' PostHog
  // experiment — the 'control' layout it was compared against was deleted
  // 2026-08-24). `variant` is always 'poster_first' now; kept as a payload
  // field for continuity with historical events grouped by it.
  | 'first_screen_viewed'
  | 'first_screen_proof_impression'
  | 'first_screen_cta_tapped'
  // Historical only — fired by the "Get started" CTA of the now-deleted
  // 'onboarding-skip-role-selection' test arm. No longer emitted; kept so
  // past events remain queryable under this type.
  | 'onboarding_role_selection_skipped'
  | 'onboarding_intent_switched'
  | 'onboarding_login_tapped'
  // Sign-in screen rendered its intent-aware "why sign in / what's next" line
  // to a visitor who picked a role but hasn't authenticated yet.
  | 'onboarding_signin_context_shown'
  | 'onboarding_auth_started'
  | 'onboarding_auth_completed'
  | 'onboarding_style_step_viewed'
  | 'onboarding_style_selected'
  | 'onboarding_profile_step_viewed'
  | 'onboarding_profile_submitted'
  | 'onboarding_step_skipped'
  | 'onboarding_bounty_posted'
  | 'onboarding_bounty_posted_screen_shown'
  // RENAMED from 'onboarding_bounty_accepted' (2026-08). It fires when the
  // HUNTER's sample application is submitted — nothing "accepts" anything
  // here (no poster action occurred). The old name collided with the
  // genuinely poster-side `bounty_accepted`/`bounty_claimed` fired from
  // hooks/useAcceptRequest.ts, which measure a completely different funnel
  // step. Flagging in case a dashboard still queries the old name.
  | 'onboarding_bounty_applied'
  | 'onboarding_application_submitted_screen_shown'
  | 'onboarding_completed'
  // Settings — fired when a user changes a display/layout preference after
  // onboarding, so it can be compared against the onboarding-time choice.
  | 'settings_bounty_format_changed'
  // Hunter discovery step (part of onboarding_profile_step_viewed with
  // intent=hunter) — see HunterLocationPrompt.tsx / HunterSampleBountyScreen.tsx.
  // One of granted/denied fires per "Use my location" tap; zip_searched fires
  // per ZIP submission; exactly one of nearby_bounties_shown/no_nearby_bounties
  // fires once a search resolves; online_bounties_viewed fires whenever the
  // online/remote fallback is shown (skip, denial, or the "Browse Online
  // Bounties" CTA).
  | 'onboarding_location_permission_granted'
  | 'onboarding_location_permission_denied'
  | 'onboarding_zip_searched'
  | 'onboarding_nearby_bounties_shown'
  | 'onboarding_no_nearby_bounties'
  | 'onboarding_online_bounties_viewed'
  | 'onboarding_notify_me_requested'
  | 'unserviceable_region_shown'
  // Moments Queue — post-onboarding contextual activation prompts, see lib/moments/*
  // Funnel order for one moment instance: moment_event_enqueued (the real
  // business event that made it eligible) -> moment_shown (presented) ->
  // exactly one
  // of moment_accepted/moment_dismissed/moment_snoozed/moment_skipped ->
  // (accepted only) moment_completed, or moment_expired if it was shown
  // maxShownCount times without ever being resolved.
  | 'moment_event_enqueued'
  | 'moment_shown'
  | 'moment_dismissed'
  | 'moment_snoozed'
  | 'moment_accepted'
  | 'moment_completed'
  | 'moment_skipped'
  | 'moment_expired'
  // Identity verification (Stripe Connect KYC).
  //
  // `identity_onboarding_started` fires each time the payout-setup screen opens
  // the hosted Stripe onboarding (including retries). `identity_onboarding_outcome`
  // fires once the flow reaches a terminal state, carrying the derived `outcome`
  // (success | pending | action_required | cancelled | verify_error) plus the
  // eligibility booleans. Together they give the funnel a start, a failure, and
  // an outcome — previously only `identity_verified` (the success case) was
  // visible, so a blocked flow left no signal.
  | 'identity_onboarding_started'
  | 'identity_onboarding_outcome'
  | 'identity_submitted'
  | 'identity_verified'
  // Posting funnel — the canonical drop-off funnel for "does a published
  // bounty actually have money escrowed at publish". Fired from BOTH posting
  // surfaces (app/screens/CreateBounty/* and the onboarding poster branch in
  // app/onboarding/details.tsx) so the two can be analysed as one funnel;
  // every event carries `surface: 'create_flow' | 'onboarding'`.
  //
  // Happy path, in order:
  //   bounty_started -> category_selected -> amount_set -> payment_attached
  //   -> bounty_submitted -> bounty_published -> first_submission_received
  //
  // `category_selected` is genuinely optional (the category step allows skip),
  // so treat it as an informational step rather than a required funnel stage.
  //
  // NOTE ON `payment_attached`: under payment architecture v1 (the only one
  // that has ever run in production) money is reserved from the poster's
  // pre-loaded custodial wallet balance by the `fn_reserve_bounty_escrow` DB
  // trigger at INSERT time. So this event means "funds are confirmed
  // available to cover this amount" — either the existing balance already
  // covered it (`source: 'existing_balance'`) or a deposit just succeeded
  // (`source: 'deposit'`). It is NOT a card authorization.
  //
  // `first_submission_received` is emitted by the HUNTER's client when their
  // application is the first one on that bounty, so its distinct_id is the
  // hunter, not the poster. Join it to `post_published` on `bountyId` rather
  // than treating it as a person-level funnel step.
  //
  // `post_started` MEANS: the poster demonstrated intent to create a bounty
  // by interacting with the composer — focusing the title field, editing the
  // draft, advancing a step, or attempting to publish. The emitting property
  // `trigger` says which. It fires at most once per composer instance.
  //
  // It explicitly does NOT mean any of: tapping the Post tab, tab focus,
  // screen mount, navigating into the composer, returning to it, an app
  // resume, a re-render, or the composer UI merely being on screen.
  //
  // That distinction is not hypothetical. Until 2026-08-24 this event fired
  // from the composer's mount effect, and the host screen mounts the composer
  // whenever the Post tab is selected — so every pass through the tab bar
  // produced a post_started + post_abandoned pair. Production over the 30
  // days to 2026-08-24: 1253 post_started against 61 post_published, a MEDIAN
  // of 0.91s between start and abandon, 879 of 1072 pairs under 3 seconds,
  // 100% of post_step_abandoned in `exit_method: 'tab'`, and single sessions
  // reaching 29 and 35 "composer opens" without one keystroke. Anything
  // comparing across that boundary must split on 2026-08-24 — the event's
  // denominator changed meaning, so pre-fix conversion rates are not
  // comparable to post-fix ones.
  //
  // `post_abandoned` is the exact mirror: it fires only when a composition
  // that produced a post_started ends without a publish, so start/abandon
  // stay 1:1 per genuine composition. A composer torn down without any
  // interaction produces NEITHER. Both surfaces (create_flow and onboarding)
  // follow this contract — see the note above the shared funnel.
  // Canonical: first genuine interaction with the composer (was `post_started`).
  | 'bounty_started'
  | 'post_step_viewed'
  | 'category_selected'
  | 'amount_set'
  | 'payment_attached'
  // Canonical: the poster committed a publish attempt (tapped "Post Bounty").
  // Fires once per create attempt, BEFORE the create/escrow round-trip, so
  // `bounty_published ÷ bounty_submitted` is the publish success rate.
  | 'bounty_submitted'
  | 'first_submission_received'
  | 'post_abandoned'
  // Post-flow "graveyard" funnel (2026-08 Part C spec) — a finer-grained,
  // per-step drop-off funnel layered ON TOP OF (not replacing) the posting
  // funnel above: post_flow_started/post_step_completed/post_step_abandoned/
  // bounty_published add step timing (seconds_on_step/seconds_total) and an
  // exit_method breakdown that post_started/post_abandoned/post_published
  // don't carry. `post_step_viewed` is shared — this spec's step_index/
  // step_name/variant properties are added onto the SAME event above rather
  // than duplicated under a new name.
  //
  // Currently wired for the control arm only (the existing 6-step flow in
  // app/screens/CreateBounty/index.tsx) — `variant` is hardcoded 'control'
  // until a second arm exists to compare against. The key ratio this funnel
  // exists to expose: bounty_published ÷ post_flow_started.
  //
  // `post_flow_started` fires only for a mount that a call site attests was
  // caused by a deliberate "Post a bounty" tap (see CreateBountyFlowProps'
  // `deliberateTap`) — NOT for every time the composer happens to render,
  // which also includes plain bottom-nav tab focus and (on the legacy
  // app/tabs/postings-screen.tsx route, still reachable from moments —
  // see lib/moments/registry.ts) a default-selected tab nobody tapped into.
  // Counting those mounts inflated the denominator without any matching
  // engagement, so `bounty_published ÷ post_flow_started` understated
  // conversion. `post_field_focused` (below) is the composer-engagement
  // signal to pair it with — it fires on the first real interaction
  // (the title field's first focus) regardless of how the poster arrived.
  //
  // NOTE: `deliberateTap` gates this event but NOT `post_started`, and the
  // two answer different questions. A bottom-nav Post-tab press IS a
  // deliberate tap, so post_flow_started still counts tab traffic by design
  // — it measures "arrived at the composer on purpose". Production bears
  // this out: 353 post_flow_started against 44 post_title_typed since it
  // shipped. `post_started` is the stricter, intent-based denominator; use
  // post_flow_started for entry attribution and post_started for
  // composition conversion, and don't substitute one for the other.
  //
  // `post_step_abandoned` fires for ANY mounted flow torn down without a
  // publish, matching post_flow_started's mount-level denominator. It
  // carries `composer_started` (boolean) so incidental tab teardowns can be
  // filtered out at query time. Its `exit_method` is a residual bucket —
  // 'tab' is the default whenever no explicit exit path was taken, which in
  // practice is nearly always, so treat 'tab' as "unattributed teardown"
  // rather than an observed user action. `post_abandoned` carries the same
  // `exit_method`, but only ever for a real composition — that is the one
  // to trust.
  // Canonical: composer reached on purpose (was `post_flow_started`).
  | 'composer_opened'
  | 'post_field_focused'
  // Fired when a poster opens a contextual help tooltip in the composer (e.g.
  // the marketplace-term tooltips on the Task step). Carries `surface`,
  // `step_index`, and `term` so help engagement can be paired with the shared
  // `post_step_viewed` step funnel WITHOUT adding a step to it.
  | 'post_help_opened'
  | 'post_step_completed'
  | 'post_step_abandoned'
  | 'post_title_typed'
  // Canonical terminal event for a live bounty. `post_published` (the old
  // posting-funnel terminal) was folded into this on 2026-08-28 — the two
  // used to BOTH fire on every create_flow publish, which was a duplicate.
  | 'bounty_published'
  // NOT YET WIRED — no UI exists for these today. The redesigned fast-path
  // flow they belong to (category chips on the title step, a price-anchor
  // display sourced from historical bounty amounts per category, and a
  // post-publish "add detail" surface for photos/time/address/notes deferred
  // off the critical path) hasn't been built. Wire these up alongside that
  // work rather than faking them now.
  | 'post_chip_tapped'
  | 'post_price_anchor_shown'
  | 'post_publish_detail_added'
  // Posting funnel — the two ways a priced bounty becomes a $0 one. These
  // exist to size the single biggest known leak: posters who choose an amount
  // and then publish for free instead. Both carry `previousAmount` so
  // "set a price, then bailed" is separable from "never wanted to pay".
  | 'post_switched_to_honor'
  | 'post_funding_skipped_to_honor'
  // Fired when a poster taps a preset amount that exceeds their wallet
  // balance and the UI refuses to apply it — a dead end with no in-flow way
  // to add funds. Sizes how often the amount step is unusable.
  | 'post_amount_blocked_by_balance'
  // Bounty events
  | 'bounty_created'
  | 'bounty_queued'
  // Optional details (photos, location, schedule) added to an ALREADY-LIVE
  // bounty from the two-step flow's confirmation screen. Measures how many
  // posters enrich a bounty after publishing versus leaving it bare.
  | 'bounty_details_added'
  | 'bounty_viewed'
  // Canonical: the POSTER accepted a hunter's application (open -> in_progress),
  // fired from hooks/useAcceptRequest.ts. Was `bounty_claimed` + `bounty_accepted`
  // (a dual-emit) — de-duped into one event on 2026-08-28. Distinct from the
  // hunter-side `application_*` funnel below (different actor, different stage).
  | 'application_accepted'
  // Canonical: work on an accepted bounty has begun. Emitted alongside
  // `application_accepted` once the server confirms the in_progress transition.
  | 'work_started'
  // Canonical: the hunter submitted completed work for the poster's review
  // (completion_submissions insert). Fired from lib/services/completion-service.ts.
  | 'completion_submitted'
  // `bounty_completed` fires from 3 real completion paths (payout release,
  // manual mark-complete, and poster approving a submitted-work review) plus
  // the hunter application funnel below carries `is_onboarding_demo` on every
  // event so tutorial completions (there is no fixed demo bounty — see
  // `application_started` below) never contaminate a real liquidity metric.
  | 'bounty_completed'
  | 'bounty_cancelled'
  // Fired once a bounty row is actually removed from the poster's active view
  // (hard delete, or a soft delete to status='deleted' when payment records
  // must be preserved). Carries `is_for_honor` and `amount` so a deletion that
  // stranded escrowed funds is measurable — this had no event before.
  | 'bounty_deleted'
  // Bounty browse/discovery events — see docs on the supply-vs-plumbing
  // question these resolve. `bounty_list_viewed` fires whenever a
  // list/feed/map of bounties renders with results (including zero — the
  // empty case is the most informative outcome, so it is NOT filtered out).
  // `bounty_search` fires when a bounty search query resolves; it carries
  // `query_length`, never the raw query text (PII risk).
  | 'bounty_list_viewed'
  | 'bounty_search'
  // Canonical hunter application funnel — application_started (Apply tapped) ->
  // application_submitted (insert succeeded) or application_failed.
  // Renamed from bounty_claim_started / bounty_claim_submitted / bounty_claim_failed
  // on 2026-08-28. `application_withdrawn` fires when the hunter retracts a
  // still-pending application (postings-screen / inbox-screen).
  // `is_onboarding_demo` is MANDATORY on all four and on `bounty_completed`.
  //
  // There is no fixed "demo bounty" — the onboarding hunter tutorial applies
  // to a real, live, randomly-selected open bounty (see
  // app/onboarding/details.tsx:handleApplyToSample), so `is_onboarding_demo`
  // cannot be derived from the bounty ID. It is instead set by the calling
  // surface: `false` from the two real apply screens
  // (components/bountydetailmodal.tsx, app/bounty/[id]/public.tsx), `true`
  // from the onboarding tutorial. Same convention as the posting funnel's
  // `surface: 'create_flow' | 'onboarding'` property above.
  | 'application_started'
  | 'application_submitted'
  | 'application_failed'
  | 'application_withdrawn'
  // Payment events
  | 'payment_initiated'
  | 'payment_completed'
  | 'payment_failed'
  | 'payment_error'
  | 'payment_security_warning'
  | 'payment_sca_required'
  | 'payment_method_removed'
  | 'payment_method_saved'
  // Fired when the Apple Pay button is tapped but isApplePaySupported()/the
  // native SDK reports Apple Pay as unusable, so the tap dead-ends before any
  // backend call — otherwise invisible in analytics (see hooks/use-wallet-deposit.ts).
  | 'apple_pay_unavailable'
  | 'escrow_funded'
  | 'escrow_released'
  | 'escrow_refunded'
  // ---------------------------------------------------------------------
  // "Post first, pay at accept" experiment
  // (PostHog flag 'post-first-pay-at-accept', see
  //  lib/experiments/deferred-funding-variant.ts).
  //
  // These do NOT replace the posting/payment events above — they fill the
  // gaps the existing funnel cannot express, because until now "published"
  // and "funded" were the same instant. The measurable funnel is:
  //
  //   post_flow_started            (existing) — poster opened the composer
  //   post_published               (existing) — bounty is live
  //     └ bounty_posted_unfunded   (NEW)      — ...and NO money was captured
  //   bounty_viewed                (existing) — a hunter saw it
  //   first_submission_received    (existing) — a hunter applied
  //   accept_funding_required      (NEW)      — poster tapped Select; a charge is due
  //   accept_funding_started       (NEW)      — poster confirmed the charge
  //   payment_sca_required         (existing) — top-up needed 3DS/SCA
  //   payment_completed            (existing) — top-up deposit succeeded
  //   accept_funding_succeeded     (NEW)      — escrow reserved + hunter accepted
  //     └ escrow_funded            (existing, timing:'at_accept')
  //     └ bounty_claimed           (existing) — the acceptance itself
  //   bounty_work_started          (NEW)      — bounty is funded AND in_progress
  //   bounty_completed             (existing)
  //
  // Failure/abandon branches:
  //   accept_funding_failed        (NEW) — carries `reason` from
  //                                        classifyAcceptFundingError, never a
  //                                        raw DB/Stripe message
  //   accept_funding_abandoned     (NEW) — poster backed out of the pay gate
  //
  // Every event in this block carries `variant` (control | deferred),
  // `fundingMode` ('at_post' | 'at_accept') and `firstBounty`, so the two arms
  // are separable without a join. None of them ever carries a card, token,
  // PaymentIntent, customer id or exact balance — amounts are bucketed by
  // amountBucket() in lib/services/bounty-funding-service.ts.
  | 'bounty_posted_unfunded'
  | 'accept_funding_required'
  | 'accept_funding_started'
  | 'accept_funding_succeeded'
  | 'accept_funding_failed'
  | 'accept_funding_abandoned'
  | 'bounty_work_started'
  // Stripe Phase 2 (payment_architecture_version=2) bounty escrow routing —
  // see lib/utils/payment-architecture.ts. escrow_funded/escrow_released/
  // escrow_refunded above are reused for both architectures (properties
  // carry `architecture: 'v1' | 'v2'`); this event is v2-routing-specific.
  | 'payment_architecture_routed'
  // Payout (withdrawal) events. `payout_failed` means Stripe was actually
  // asked to move money and the attempt failed — see classifyPayoutFailure()
  // in lib/utils/payout-analytics.ts, the single place both withdrawal paths
  // (legacy bank transfer and Connect-native payout/instant-payout) decide
  // which of these three fires. A pre-flight rejection by a Bounty business
  // rule (validation, insufficient balance, disabled payouts, etc.) must
  // fire `payout_rejected`, never `payout_failed` — conflating the two is
  // what made a single hunter's 36 retries against an already-pending
  // withdrawal look like 36 independent provider failures (2026-08-24).
  | 'payout_initiated'
  | 'payout_success'
  | 'payout_failed'
  // The hunter already had a withdrawal in flight (409
  // withdrawal_already_in_progress) and the backend refused to start a
  // second one before ever contacting Stripe. Broken out from
  // `payout_rejected` because it is the single highest-signal case for
  // "duplicate/pending attempt rate" and is expected to fire more than once
  // per underlying pending withdrawal — that repetition is the metric, not
  // a bug in it.
  | 'payout_already_pending'
  // Any other pre-flight business-rule rejection: validation failure,
  // insufficient balance, account not eligible, payouts disabled, no bank
  // account/debit card linked, instant-payout limits, etc. Stripe was never
  // called for this attempt.
  | 'payout_rejected'
  // SetupIntent events
  | 'setup_intent_created'
  | 'setup_intent_confirmed'
  | 'setup_intent_failed'
  // ACH / Financial Connections events
  | 'ach_link_started'
  | 'ach_link_completed'
  | 'ach_link_failed'
  | 'ach_link_cancelled'
  | 'ach_deposit_started'
  | 'ach_deposit_failed'
  // Messaging events
  | 'message_sent'
  | 'conversation_started'
  | 'conversation_viewed'
  // Profile events
  | 'profile_viewed'
  | 'profile_updated'
  // Sharing events (bounty + profile) — see lib/utils/share-utils.ts.
  // Funnel per share attempt: {bounty,profile}_shared (share sheet opened)
  // -> exactly one of share_completed/share_cancelled/share_link_copied.
  // deep_link_opened fires app-side when a bountyfinder.app/bounty|profile
  // link (or its custom-scheme equivalent) opens the app, independent of
  // whether that open originated from a share.
  | 'bounty_shared'
  | 'profile_shared'
  | 'share_completed'
  | 'share_cancelled'
  | 'share_link_copied'
  | 'deep_link_opened'
  // Dispute events. Canonical `dispute_started` (was `dispute_opened`) covers
  // BOTH the cancellation-derived dispute and the workflow-stage dispute
  // (createWorkflowDispute previously emitted nothing). `stage` disambiguates.
  | 'dispute_started'
  | 'dispute_resolved'
  // User-lifecycle activation milestones — first time this device sees the
  // user complete the defining action of a role. Emitted (once, AsyncStorage-
  // guarded) from lib/analytics/lifecycle.ts. NOT a running count.
  | 'poster_activated'
  | 'hunter_activated'
  // Search events
  | 'search_performed'
  | 'filter_applied'
  // Admin — bounty moderation queue. `moderation_action` fires when an admin
  // transitions a listing (properties: from_state, to_state, reason,
  // signal_score, applications); `moderation_alert_viewed` fires when the
  // founder opens an alert from the queue.
  | 'moderation_action'
  | 'moderation_alert_viewed';

export interface AnalyticsProperties {
  [key: string]: string | number | boolean | string[] | undefined;
}

// Historically this expanded every property key into both its snake_case and
// camelCase form (so a call site passing `stepTitle` would also emit
// `step_title` AND `steptitle` — the latter from lowercasing an
// already-camelCase key with no underscores to convert, which is not a real
// spelling anyone intended). That silently multiplied every event's property
// count and fragmented PostHog breakdowns across spurious spellings of the
// same field (see the `post_step_viewed` property audit). Call sites now emit
// exactly the property keys they mean; this stays as an identity pass so any
// future normalization need has one obvious place to live.
const normalizePropertyKeys = (properties?: AnalyticsProperties): AnalyticsProperties =>
  properties ? { ...properties } : {};

// HeyCatch's event-property type is Record<string, string | number | boolean | null> —
// narrower than AnalyticsProperties (which also allows string[] and undefined).
// Arrays are joined so the value still reaches the dashboard instead of being dropped.
// Takes Record<string, unknown> rather than AnalyticsProperties because callers
// (e.g. trackEvent's enrichedProperties) legitimately widen fields like `userId`
// to `string | null`, which AnalyticsProperties' index signature doesn't allow.
const toHeyCatchProperties = (
  properties: Record<string, unknown>
): Record<string, string | number | boolean | null> => {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.join(',');
    } else if (value instanceof Error) {
      result[key] = String(value);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[key] = value;
    } else {
      try {
        result[key] = JSON.stringify(value) ?? '[unserializable]';
      } catch {
        result[key] = '[unserializable]';
      }
    }
  }
  return result;
};

class AnalyticsService {
  private initialized = false;
  private userId: string | null = null;

  /**
   * Initialize analytics services. The shared PostHog client in `lib/posthog.ts`
   * is constructed eagerly at import time, so initialization here is mostly a
   * readiness check kept for API compatibility with existing callers.
   *
   * @param _legacyToken - Ignored. Retained so existing callers that pass a
   *   Mixpanel-style token continue to compile. Passing the literal
   *   placeholder `'YOUR_MIXPANEL_TOKEN'` still skips initialization.
   */
  async initialize(_legacyToken?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      if (_legacyToken !== 'YOUR_MIXPANEL_TOKEN' && !isPostHogReady()) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Analytics] PostHog client not ready — events will be dropped until configured'
        );
      }

      this.initialized = true;
    } catch (error) {
      console.error('[Analytics] Failed to initialize:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Identify a user for analytics
   * @param userId - Unique user identifier
   * @param properties - Additional user properties
   */
  async identifyUser(userId: string, properties?: AnalyticsProperties): Promise<void> {
    this.userId = userId;

    try {
      // Identify in PostHog via the shared client.
      try {
        posthogIdentify(userId, properties);
      } catch {
        // ignore — PostHog may not be ready
      }

      try {
        heycatch()?.setIdentity(userId, properties);
      } catch {
        // ignore — HeyCatch may not be ready
      }

      // Set user in Sentry
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser({ id: userId, ...properties });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to identify user:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track an analytics event
   * @param event - Event name
   * @param properties - Event properties
   */
  async trackEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): Promise<void> {
    try {
      const normalizedProperties = normalizePropertyKeys(properties);
      const enrichedProperties = {
        ...normalizedProperties,
        platform: Platform.OS,
        timestamp: new Date().toISOString(),
        userId: this.userId,
        user_id: this.userId,
      };

      // Track in PostHog via the shared client. The helper is a no-op when
      // the client hasn't initialized yet (e.g. missing key in Expo Go).
      try {
        posthogCapture(event, enrichedProperties);
      } catch {
        // ignore — never let analytics failures bubble up to the caller
      }

      try {
        heycatch()?.trackEvent(event, toHeyCatchProperties(enrichedProperties));
      } catch {
        // ignore — HeyCatch may not be ready
      }

      // Add breadcrumb to Sentry for context (if available)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.addBreadcrumb({
          category: 'analytics',
          message: event,
          level: 'info',
          data: enrichedProperties,
        });
      } catch {
        // ignore when Sentry is not installed in this runtime
      }
    } catch (error) {
      console.error('[Analytics] Failed to track event:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Update user properties
   * @param properties - User properties to update
   */
  async updateUserProperties(properties: AnalyticsProperties): Promise<void> {
    try {
      try {
        posthogSetPersonProperties(properties);
      } catch {
        // ignore — PostHog may not be ready
      }

      try {
        heycatch()?.setPersonProperties(properties);
      } catch {
        // ignore — HeyCatch may not be ready
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser({ id: this.userId || undefined, ...properties });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to update user properties:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Increment a user property.
   *
   * PostHog does not support atomic client-side increments of person
   * properties (that is a server-side operation). To preserve the analytics
   * signal we capture a dedicated event carrying the property name and delta,
   * which can be aggregated in PostHog insights.
   *
   * @param property - Property name
   * @param value - Value to increment by (default: 1)
   */
  async incrementUserProperty(property: string, value: number = 1): Promise<void> {
    try {
      posthogCapture('user_property_incremented', {
        property,
        increment: value,
        userId: this.userId,
      });
    } catch (error) {
      console.error('[Analytics] Failed to increment user property:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track screen view
   * @param screenName - Name of the screen
   * @param properties - Additional properties
   */
  async trackScreenView(screenName: string, properties?: AnalyticsProperties): Promise<void> {
    try {
      const screenProperties = {
        screen_name: screenName,
        ...properties,
      };

      try {
        posthogScreen(screenName, screenProperties);
      } catch {
        // ignore
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.addBreadcrumb({
          category: 'navigation',
          message: `Screen: ${screenName}`,
          level: 'info',
          data: screenProperties,
        });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to track screen view:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track timing (performance monitoring)
   * @param eventName - Event name
   * @param duration - Duration in milliseconds
   * @param properties - Additional properties
   */
  async trackTiming(
    eventName: string,
    duration: number,
    properties?: AnalyticsProperties
  ): Promise<void> {
    try {
      const normalizedProperties = normalizePropertyKeys(properties);
      const timingProperties = {
        ...normalizedProperties,
        timing_name: eventName,
        timingName: eventName,
        duration_ms: duration,
      };

      try {
        posthogCapture('performance_timing', timingProperties);
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to track timing:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Reset analytics (on logout)
   */
  async reset(): Promise<void> {
    try {
      this.userId = null;

      try {
        posthogReset();
      } catch {
        // ignore
      }

      try {
        heycatch()?.resetIdentity();
      } catch {
        // ignore — HeyCatch may not be ready
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser(null);
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to reset analytics:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch (_e) {
        // ignore
      }
    }
  }

  /**
   * Flush pending events (useful before app exit)
   */
  async flush(): Promise<void> {
    try {
      await posthogFlush();
    } catch (error) {
      console.error('[Analytics] Failed to flush events:', error);
    }
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Check if analytics is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
