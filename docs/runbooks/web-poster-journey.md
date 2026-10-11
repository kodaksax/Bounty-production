# Web-only poster journey: deploy and operate

Branch `feat/web-poster-journey` here and in `Bounty-landing-page`.

A poster who only uses a browser and email can now review applicants, accept
or decline, confirm the job is done, and reach a person. They don't need the
app at any step.

## Why

Bounty `5e96aaed` (Alexandria, $35, posted on the web 2026-10-06). Verified
from production data and code:

| Failure | Cause |
|---|---|
| Five "Someone applied" emails could not be acted on | The button was `bountyexpo-workspace://postings/<id>` (`NOTIFICATION_APP_LINK_BASE` default). It does nothing without the app, and Gmail web strips it. The body said "Accept or decline in the Bounty app". |
| Her "Accept" reply did nothing | Every notification sets `Reply-To: support@bountyfinder.app`, and nothing reads that inbox or turns a reply into a case. |
| The account email after payment led nowhere | `webhooks` sends `resetPasswordForEmail` with `redirectTo: https://bountyfinder.app/auth/callback`. That host fails TLS (checked 2026-10-08). |
| Push never reached her | `no_deliverable_token` on all 11 outbox rows. She never installed the app. |
| No nearby matching | The pending row had no coordinates, `bounties.geom` stayed NULL, and nothing retried. 22 open in-person bounties have no point as of 2026-10-08. |
| "You're live" email | `fn_email_bounty_posted` (live, never committed) also links to the app scheme. |

## What ships

| Piece | Where |
|---|---|
| `poster-web`: list, detail, accept, decline, confirm completion, support | `supabase/functions/poster-web/` |
| Email links go to `https://www.bountyfinder.net/manage/` | `_shared/web-links.ts`, `process-notification`, `fn_email_bounty_posted` |
| Reply handling, off until configured | `email-inbound/`, `_shared/reply-context.ts` |
| Geocode retry plus a support case when it gives up | `geocode-bounties/`, migration RPCs |
| Support cases (`public.support_cases`) and alert emails | `_shared/support-cases.ts`, `send-notification-email` `supportAlert` |
| The page itself | `Bounty-landing-page`: `manage/index.html`, `assets/manage.js` |

Accept, decline and completion run **as the signed-in user** through the same
paths as the app: `fn_accept_bounty_request` and RLS updates. Completion calls
the **unchanged** `bounty-payments/release` with the user's token. No Stripe
code changed.

`send-notification-email` now includes the Resend-template code that was
deployed by hand on 2026-10-02 (v34) but never committed. Without it, this
deploy would have removed the "You're live" template.

## Deploy order

Merging to `main` deploys every changed function automatically
(`deploy-edge-functions.yml`). That workflow first checks production against
`supabase/security/rls-manifest.json`, which now expects the new tables and
RPCs. So **apply the migration before merging**, or the deploy job fails.

1. **Migration**: apply `20261008120000_web_poster_journey.sql`. It only adds
   tables and functions; it changes no existing rows. It also redefines
   `fn_email_bounty_posted`; only `ctaUrl` differs from the live definition.
2. **Supabase Auth → URL Configuration → Redirect URLs**: add
   `https://www.bountyfinder.net/manage/**`. Without it, sign-in links fall
   back to the Site URL. The homepage forwards them to `/manage/`, so the
   flow still works, but don't rely on that.
3. **Supabase Auth → Email templates → Magic Link**: check that it reads
   well for a first-time customer. The dashboard sends it with
   `create_user: false`.
4. **Secrets**: if `BOUNTY_AUTH_REDIRECT_URL` is set to the
   `bountyfinder.app` callback, unset it or point it at
   `https://www.bountyfinder.net/manage/`. Optional: `SUPPORT_ALERT_EMAIL`
   (defaults to the reply-to support address), `WEB_MANAGE_BASE`,
   `POSTER_WEB_ALLOWED_ORIGINS`.
5. **Merge** this branch. CI deploys `poster-web`, `email-inbound`,
   `geocode-bounties`, `process-notification`, `send-notification-email` and
   `webhooks`.
6. **Website**: merge and deploy `Bounty-landing-page`. Check
   `/manage/`, `/support` (redirects to help) and the homepage.
7. **Cron**: schedule `geocode-bounties` every 15 minutes (`net.http_post`
   with the service-role bearer, as the other cron jobs do). The first run
   works through the backlog: it opens one `geocode_failed` case for each
   in-person bounty with no address on file (about 18), and sends **one**
   digest email for the run.

### Reply handling (optional, later)

Until all of the following is done, replies keep going to support and the
email says so plainly.

1. Choose a subdomain, e.g. `reply.bountyfinder.net`. Don't use the domain
   `support@` lives on.
2. DNS: point that subdomain's MX at Resend inbound. In Resend, add a webhook
   for `email.received` → `…/functions/v1/email-inbound`.
3. Secrets: `RESEND_INBOUND_WEBHOOK_SECRET` (the `whsec_…` value) and
   `EMAIL_REPLY_DOMAIN` (the bare host). The function is fail-closed without
   them.

A reply never accepts or declines anyone. It opens a support case and emails
the account owner a confirm link. See `email-inbound/logic.ts`.

### Rollback

- Functions: redeploy the previous versions (the deploy job records them).
- Links: setting `WEB_MANAGE_BASE` cannot bring back the app scheme; that is
  deliberate. To point links somewhere else, set it to another https URL.
- Database: the new tables are unused once the functions are rolled back. To
  restore the old "You're live" link, re-run the previous
  `fn_email_bounty_posted` with
  `'bountyexpo-workspace://postings/' || new.id::text`.

## Operating it

- Open cases:
  `select * from support_cases where status <> 'resolved' order by created_at desc;`
- Kinds:
  - `release_blocked`: the poster confirmed, but the hunter isn't payout-ready.
  - `completion_without_submission`: the poster says it's done; the hunter
    never marked it done.
  - `email_reply` / `email_reply_unmatched`: someone replied to an email.
  - `problem_report` / `web_contact`: sent from the help form; may include a
    call-back number in `metadata.callback_phone`.
  - `geocode_failed`: an in-person bounty with no usable location.
- To resolve a case: set `status = 'resolved'`, `resolved_at = now()` and
  `resolved_by`.
- PostHog events, server-side:
  - `web_applicant_decision_completed`
  - `web_completion_confirmed`
  - `web_support_requested`
  - `support_intervention_required`
  - `email_reply_received`
  - `bounty_geocode_result`

  Client-side events are listed in the landing repo's
  `docs/analytics/WEB_FUNNEL.md`.

## Known gaps

- **3 bounties already have more than one accepted request.** A unique index
  can't be added until a person resolves them. `fn_accept_bounty_request`'s
  locks stop new duplicates on this path.
- **`bounty_payments` has never reached `released`, and most hunters aren't
  Connect-ready.** Web completion will often end in `release_blocked`. The
  poster sees an honest message, the money stays held, and support gets a
  case.
- **Migrations 20261001130000 through 20261006230000 are in the repo but not
  applied to production**, including the paid-completion guard and the 72h
  review window. `poster-web` completes a paid bounty only after a confirmed
  release, whether or not that guard is live.
- **A geocoded bounty older than 24 hours becomes findable but does not send
  a "just posted near you" push.** This is existing, deliberate behaviour of
  `fn_bounties_claim_nearby_notification`.
