# Marketing attribution links

All public app CTAs must point to the `app-link` Edge Function through this public route:

```text
https://bountyfinder.net/r/<source>/<campaign>
```

Configure the `bountyfinder.net` reverse proxy so `/r/*` maps to:

```text
https://<supabase-project>.supabase.co/functions/v1/app-link/*
```

The medium defaults to `guerilla`. Use lowercase, short campaign slugs:

```text
bountyfinder.net/r/reddit/orangecounty
bountyfinder.net/r/facebook/mission-viejo
bountyfinder.net/r/nextdoor/mission-viejo
bountyfinder.net/r/craigslist/orange-county
```

The handoff logs `app_store_redirect_clicked`, creates a Branch link, opens the app when installed, and otherwise preserves the source and campaign through the store install. Do not link directly to App Store or Play Store URLs from the public site.

If `BRANCH_KEY` is unset, or Branch link creation fails, `app-link` still logs the click (with `link_provider: 'store_fallback'`) and redirects by user agent: iOS to the App Store, Android to the Play Store (UTMs passed as the install `referrer`), anything else to `PUBLIC_MARKETING_ORIGIN`. This fallback loses deferred deep linking and install-level attribution; the click event remains.

`app-link` is called anonymously, so `supabase/config.toml` sets `verify_jwt = false` for it.

## Required deployment configuration

- EAS: `EXPO_PUBLIC_BRANCH_KEY`, `EXPO_PUBLIC_BRANCH_DOMAIN`
- Supabase Edge Functions: `POSTHOG_PROJECT_API_KEY`
- Optional Edge Function values: `BRANCH_KEY` (store fallback without it), `POSTHOG_HOST`, `PUBLIC_MARKETING_ORIGIN`

Deploy `app-link`, `marketing-attribute`, and `process-analytics-person`, then apply migration `20260808000000_add_posthog_person_property_sync.sql`. A new native EAS build is required because Branch includes native code; an OTA update is not sufficient.

## Social growth pilot — audit (2026-10-15)

Repository evidence, not a claim about deployed configuration:

| Area | Existing capability / gap |
| --- | --- |
| Sharing | `lib/utils/share-utils.ts` shares bounty/profile links; bounty cards, details, dashboards and profiles already call it. Reuse it, not a second sharing service. Android chooser resolution was incorrectly recorded as completion; web's no-clipboard fallback was incorrectly recorded as a copy. |
| Public previews | `share-bounty`, `share-profile`, `share-og-image`, `_shared/og-html.ts` and `_shared/share-page-storage.ts` already generate PNG/OG pages and publish HTML to the existing `share-pages` bucket. Domain proxy wiring is explicitly unconfirmed in the function comments. |
| Privacy | Bounty SELECT is authenticated-only (`20261001120200_bounties_policy_consolidation.sql`). The old public share handlers used service-role reads to expose free text, identities and attachments anyway. A listing is not authorization to syndicate a person's details. The pilot makes **bounty** previews generic, including direct image requests. Rich public projections require separately reviewed consent/moderation design. Existing profile previews remain a separate privacy-review gate before promoting profile sharing. |
| Links | `app.json` associates **bountyfinder.app**, not **bountyfinder.net**, with iOS/Android bounty/profile routes. `app/_layout.tsx` handles Branch bounty/profile navigation and records `deep_link_opened`. Do not switch existing links to `.net` and silently break app associations. |
| Attribution | `app-link` already logs `app_store_redirect_clicked`, creates Branch links, and has the real iOS store ID. Share pages already hand off with source `share`, campaign `bounty`/`profile`, medium `organic`. `services/marketingAttribution.ts` reads Branch first-referring parameters / Android Play referrer; `marketing-attribute` and `process-analytics-person` persist/sync attribution. Keys and deployment status cannot be established from source. |
| Website | This checkout contains legal pages (`docs/index.html`), not the production `.net` marketing implementation. Fetching `.net` was unavailable in this environment; its actual landing pages, proxy routes and consent/analytics configuration remain unverified, not “absent.” Coordinate with its owner rather than replacing legal pages. |
| Marketplace | `app/screens/CreateBounty/useBountyPublish.ts` publishes; `index.tsx` emits canonical `bounty_published` after success and retains the live ID for `quick/StepPostPublish.tsx`. Applications/acceptance use `lib/services/bounty-request-service.ts`; completion uses `completion-service.ts` and `completion-approval.ts`. No changes to these transactions are needed. Application is not acceptance, and completion is not proof of payout. |
| Activation | `lib/analytics/lifecycle.ts` already emits `poster_activated` / `hunter_activated` with device-local guards. They are not globally unique first-ever actions. Existing signup, publish, accept and complete events should be reused, not duplicated. |
| Referrals | `lib/moments/referral-service.ts` is deliberately dormant. No operational referral code, recipient conversion ledger or reward system is established here. A shared link is not a verified referral conversion. |
| Content | Completion submissions, attachments, verified reputation/reviews and moments are reusable **candidate signals**, not assets approved for marketing. There is no demonstrated marketing consent ledger, human editorial queue or authorized social-publishing integration. |
| Consent/auth | Supabase auth, onboarding, permissions and legal pages already exist. OS camera/photo/location permission and marketplace acceptance are not marketing consent. Do not change auth, payment, escrow, RLS or migrations for this pilot; those require human review. |

### Platform constraints and verification boundary

Official references for account owners to re-check before enabling integrations:

- Instagram `@bountyfinderapp`: [Sharing to Stories](https://developers.facebook.com/docs/instagram/sharing-to-stories/). Dedicated Stories sharing uses native intents/pasteboard and Meta app configuration; a text/link OS share is **not** a guaranteed Stories integration. Account publishing requires the applicable account eligibility, authorization and permissions.
- Facebook **Bounty finder**: [Sharing](https://developers.facebook.com/docs/sharing/). Start with user-initiated public-link sharing and valid OG previews. Users choose communities in Facebook; do not implement automatic group posting or assume a Groups API is available. The exact official Page URL must be supplied/verified before adding a link.
- TikTok `@bountyinc_`: [Share Kit](https://developers.tiktok.com/doc/share-kit/) and [Content Posting API](https://developers.tiktok.com/products/content-posting-api/). Text-link sharing is not video upload. Share Kit needs supported media/native setup; API publishing needs authorization, scopes, review/audit and current platform limits. Never infer posting capability from having a TikTok account.

Direct developer-document fetches were unavailable in this environment. Search located these official references, but current scopes, quotas, account eligibility and app approvals have **not** been validated in an owner developer console. No social API or automatic publisher is enabled by this change.

## Growth-loop design and priorities

Assumptions: retain mobile-only app architecture, existing navigation, both iOS and Android, optional user-initiated sharing, no marketing use of private data, no paid service procurement or production deployment.

First loop: **successful publish → optional share → branded, generic bounty preview → existing Branch/store handoff → signup → first published bounty → accepted work → completed bounty → another optional share**. The share page invites viewers to post their own task as well as open the linked task. Details remain behind existing app access checks; deleted/completed links must be handled by the app's normal unavailable-task UI. No claim that every link refers to a still-open task.

The “Post a task of your own” CTA uses the existing `app-link/share/poster` handoff (source `share`, campaign `poster`, medium `organic`). It opens the app/store home, not a new unauthenticated posting route; users then follow the normal posting flow. The separate website fallback stays visible.

Prioritize one local community and poster-oriented content. Invite hunters only where open bounties lack applicants; monitor unclaimed time, acceptance and completion before expanding geography.

Costs below are relative implementation/maintenance scope, not monetary or duration estimates:

| Priority / feature | Expected growth impact | Cost | Dependencies / risks |
| --- | --- | --- | --- |
| P0: optional post-publish share; accurate outcomes; generic branded previews (this slice) | Existing posters seed local audiences; poster CTA can recruit their next poster; links also help fill tasks | Small; existing RN Share, OG and PostHog stack | Feature gate, working `.app` proxy/storage and store/Branch configuration; generic cards trade task specificity for privacy |
| P0: `.net/r/instagram/local-poster`, `/facebook/local-poster`, `/tiktok/local-poster` with `?medium=organic_social` | Measure which official channels recruit activated posters, not followers | Small website/config work; **external checkout** | Existing `app-link` route; use distinct campaign slugs per creative/category; in-app browsers can block app opens |
| P1: mobile `.net` poster landing and consent-aware analytics | Clear “Post a task” primary CTA, “Earn by helping” secondary; improves visitor-to-poster conversion | Medium website work | Website owner, consent configuration, accessible page, existing `/r/*`; do not send contact details in UTMs |
| P1: server-approved public bounty projection + richer cards | Specific task/category content should improve qualified local clicks | Medium backend/product work | Explicit consent, moderation/availability checks, revocation/cache purge, security review; schema changes require reviewer approval |
| P1: after-completion outcome / before-after / review candidate queue | Authentic proof builds poster trust and can compound referrals | Medium backend + editorial operation | Verified completion, rights and consent from all identifiable parties; never expose submission photos by default |
| P1: general invite + durable referral ledger | Recruit posters from satisfied users; measure real recipient activation | Medium backend work | Attribution window, authenticated conversion authority, fraud/self-referral rules, consent and migration review; no reward promises |
| P2: Instagram Stories assets; TikTok video export | More native creative and reach, after the poster loop is proven | Medium/high native/media maintenance | Supported SDK/intent, media permissions, account approval where applicable, new binary/device tests; no guaranteed publish callback |
| P2: authorized account publishing | Reduces editorial operations cost, not a prerequisite to growth | High ongoing platform maintenance | Human-approved assets, OAuth scopes, secure token storage/rotation, rate limits, audit/review and revocation |
| P2: earned milestones/profile promotion | Hunter supply and trust once local poster demand exists | Medium | Verified reputation, profile privacy review, opt-in and no misleading earnings claims |

### Authentic content pipeline (design, not an automatic publisher)

Use existing completion/review/moment records to propose candidates. A future queue should have `candidate → consent_requested → consented → editorial_review → approved → exported/published`, plus rejected/revoked states. Dedupe by event ID + format; record evidence, asset rights, approvals, expiration and revocation. Consent must specify the asset, caption, channels and duration; platform OAuth is not the subject's consent. Require all identifiable people/property owners as appropriate. Consent revocation must disable pending publishing and trigger deletion/cache-purge procedures for already-public assets.

| Candidate | Draft/creative format | Required next step |
| --- | --- | --- |
| Verified completed bounty | “A task off the list” outcome card; CTA “What would you get done?” | Draft only; request permission before task specifics/photos or identifying anyone |
| Before/after transformation | Two consented frames, clear before/after labels, no addresses/faces/plates | Rights check, redact metadata/identifiers, human review; export manually first |
| Hunter achievement | Verified completed-task count; no promised/typical earnings | Hunter opt-in; reputation source validation; editorial approval |
| Testimonial | Exact approved quote, never fabricated/paraphrased as a real review | Author permission, transaction verification and context check |
| Local/category milestone | Aggregated verified activity, suppressed small cells | Privacy review of aggregation; no identifying users or invented numbers |
| Founder/product story | “Here is a task I would post” / app demonstration | Use founder-owned or demo material clearly labeled; no implied customer outcome |

Instagram template: one outcome headline, branded frame, approved image, “Post your next task” CTA. Facebook template: practical homeowner problem/result and a local poster CTA; user chooses an appropriate community. TikTok template: problem → task/demo → verified result → poster CTA; captions, licensed audio, no fabricated earnings. Founder updates can run without borrowing customer activity. Initially export manually to the verified official accounts; account owners decide whether/where to publish.

## Measurement specification

Reuse canonical events; requested names below are reporting actions/aliases, **not duplicate raw emissions**:

| Requested concept | Canonical data / limitation |
| --- | --- |
| `social_share_initiated` | `bounty_shared` or `profile_shared`, with `content_type`, `content_id`, `surface`; intent only, not confirmed sheet presentation |
| `social_share_completed` | `share_completed` with `completion_scope=native_activity`, iOS only; OS-reported activity completion is not proof of a public social post |
| Share presented / copied | `share_presented` on Android; `share_link_copied` only after a successful clipboard write; `share_cancelled` for observed iOS dismissal; errors never count as completion |
| `referral_link_opened` | Not yet a real referral event. `deep_link_opened` is an app open; `share_link_events.page_view` includes crawlers. Do not rename either into a verified referral |
| `social_landing_page_viewed` | Website-owner instrumentation required, once per real page view under the site's consent policy; separate bots/preview fetches from human sessions |
| `app_install_or_first_open_attributed` | Existing marketing attribution record/person properties, only where Branch or Play referrer supplies evidence; report provider/method and observed vs inferred confidence separately; no fabricated install event |
| `signup_completed` | Existing canonical signup event; use identified-user cohorts, not anonymous redirect UUIDs |
| `first_bounty_posted` | First `bounty_published` per poster, validated against Supabase history; `poster_activated` is first seen on that device only |
| `first_bounty_claimed` | First accepted assignment, not `hunter_activated` (application); use existing accept event and authoritative `accepted_by` history |
| `first_bounty_completed` | First verified `bounty_completed` per user/role and bounty; completion is not payout confirmation |
| `referral_conversion_completed` | Deferred until a server-verifiable referral ledger exists; never substitute share completion |

Campaign contract: lowercase source (`instagram`, `facebook`, `tiktok`, or `share` when destination unknown), medium (`organic_social` for official profile/content links, `organic` for OS shares), campaign slug per creative/category/local test. Use the existing `/r/<source>/<campaign>?medium=...` route, not a second redirect service. Avoid usernames, addresses, contact data and arbitrary free text in campaign parameters. OS sharing cannot reliably identify the target social platform; iOS `activity_type` is only an OS hint.

Build the following PostHog dashboard from identified cohorts joined to authoritative marketplace outcomes where available. Use a declared 30-day activation window, exclude internal/test accounts, dedupe people and bounty IDs, and retain unattributed users:

1. Source/campaign → unique consented human landing visitors → signups → first posters. Show signup/visitor and poster/signup rates; visitor rates remain **unavailable** until website session linkage is verified.
2. First-time posters and completed bounties per source/campaign; category breakdown from authoritative bounty records, not private share captions.
3. Acquired posters' published → accepted → completed bounties, plus unclaimed time and completion rate. Segment by local market so more hunters cannot mask insufficient demand.
4. Repeat posters: a second distinct published bounty within 30 days, and completed transactions per acquired poster.
5. Sharing intent → OS-reported completion / chooser presentation / copied link, separated by OS and surface. Never sum these as confirmed social posts.
6. Referral-recipient activated users and completed bounties: explicitly “not available” until the referral ledger exists.
7. Attribution coverage: observed Branch/referrer evidence, unattributed, and any modeled/inferred cohort separately. No install or revenue causal claims from a redirect alone.

Success gate: verify one real bounty can be shared without private data; a human visitor can follow the preview/handoff, sign up and post; acceptance/completion remain intact; attributable cohorts appear where evidence exists. Then compare first-time posters, completed bounties and repeat-poster rates against the pre-pilot local baseline. Do not scale on likes/downloads alone; stop if unclaimed time, scam reports or completion rate deteriorate.

## Pilot deployment readiness (no production deployment authorized)

- `EXPO_PUBLIC_SOCIAL_SHARING_ENABLED=true` enables only the new optional post-publish prompt; default off. Existing detail/profile share actions remain available. Disable it to remove the new prompt.
- No new package, paid service, permission, schema migration, auth/payment change or native SDK is introduced. This JS-only prompt can use the existing OTA workflow **only on a compatible installed binary**. Adding/configuring Branch where absent, `.net` app associations, or dedicated Stories/TikTok SDKs requires a separately reviewed native build.
- Reuse existing Supabase `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), Storage `share-pages`, and PostHog/Branch configuration above. Confirm bucket access and function JWT settings with the operator. No keys belong in share links.
- Verify `.app/bounty/*` proxies to `share-bounty`, and that the linked OG image endpoint is public and returns `image/png`. Do not assume the live `.net` reverse proxy exists. Coordinate `/r/*` there with the website owner.
- Deploy the bounty page and image privacy changes together. Remove **previously generated bounty HTML objects** from `share-pages/bounty/` and request crawler/CDN cache refreshes; changing code cannot revoke previously downloaded previews. Do not delete profile objects or unrelated assets.
- Confirm installed app and store fallbacks on real iOS/Android devices, with and without Branch, including Facebook/Instagram/TikTok in-app browsers. Desktop and blocked app opens must retain a visible website CTA.
- Preserve existing profile sharing, but do not amplify it until its separate consent/public-projection review is complete. No automatic sharing after completion, media upload or contact access is enabled.
- Manual acceptance: flag off/on; post once; optional share/cancel/retry; Android does not emit completion; web clipboard missing/rejected does not emit copy; public page/direct image reveal no bounty title, description, address, identity, reward or photo; existing profile preview still renders; unavailable bounty handled in app; PostHog events and attribution person properties verified without duplicate signup/activation emissions.

### Verification record

- `npx tsc --noEmit`: passed.
- Seven focused Jest suites: **113 tests passed**, including share privacy/outcomes, feature-gate/live-ID wiring, repeated-tap control, posting/funding/timing regressions and existing marketing attribution.
- Existing ESLint on changed mobile files: no errors; five pre-existing hook warnings in the posting orchestrator.
- Existing esbuild bundles the changed edge entry points successfully. Deno runtime/type validation and deployed Storage/PNG/crawler checks remain operator gates. Confirm actual card text and crosshair render, not merely a successful response or the solid-color error fallback.
- Secret scan: no findings. Automated review was unavailable; supplemental read-only code review found no significant issues. CodeQL analysis was **skipped because the database was too large**, not a completed clean security analysis.
- Expo started locally in offline mode. Browser preview transport was unavailable and the installed Playwright browser executable was missing; no screenshot or physical-device verification is claimed.
- Live `.app`/`.net` routing, signed-out signup destination preservation, in-app browsers, platform approvals, end-to-end conversion/attribution and cache purging remain unverified. These are release gates, not completed production checks.
