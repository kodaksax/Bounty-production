# Bounty email design system (v2)

Source of truth for every Bounty email: `scripts/emails/` builds the HTML + plain
text for each Resend template and the Supabase Auth emails.

```
node scripts/emails/build.mjs emails   # → emails/templates, emails/previews, emails/manifest.json
```

The build fails if a template uses a variable it does not declare, declares one
it never uses, or leaves a placeholder unfilled in a preview. No dependencies.

## Design system

| Token | Value | Use |
|---|---|---|
| Canvas | `#F3EEE7` | Page background (brand cream `#D7CBBD`, lifted to read as paper) |
| Card | `#FFFFFF`, 20px radius, `#E6DCCF` hairline | Message surface |
| Brand green | `#18A772` | Accents only: status strip, dots, rules (3.1:1 on white, so never small text) |
| Secondary green | `#008E2A` | Reward numerals, step numbers (large text) |
| Action green | `#00742A` | Buttons and links (white text 5.95:1, AA) |
| Ink / body / muted | `#121A15` / `#3A403B` / `#5C615A` | Text (10.6 / 6.3 / 5.5:1 on surfaces) |
| Tones | success · action (amber) · alert (red) · neutral (cream) | Status stamp + card strip |
| Type | Archivo (display) and Inter (text), system fallbacks | No web-font request (privacy, Gmail ignores them) |
| Logo | `https://www.bountyfinder.net/assets/img/brandmark-design__6_.png` + live-text BOUNTY | Brand survives image blocking |

Components (`design-system.mjs`): shell (header with logo + status stamp, card with
tone strip, footer), **bounty ticket** (title above a perforation, reward below;
`done` variant strikes the title through), numbered steps, tips, money/trust
callout, status rows (exact state for money and hiring), two-up choice tiles,
stat block, chips, forwardable box, sign-off.

Every template: table layout, inline styles, 600px max, mobile stacking at
620px, dark mode for Apple Mail / iOS (`prefers-color-scheme`) and Outlook.com
(`[data-ogsc]` / `[data-ogsb]`), hidden preheader, hand-written plain text.

## Rules for senders

- Resend inserts `{{{VAR}}}` **unescaped**. HTML-escape every user-controlled value
  (titles, names, messages). Variables marked `html: true` in the manifest are
  pre-rendered markup the sender owns.
- Variables ending in `_TEXT` feed the plain-text part. They carry the same copy
  **unescaped**, because entities like `&#39;` would show literally there.
- Drop empty values instead of sending `""`; the template fallback applies.
  Every declared variable has a non-empty fallback (Resend rejects a send when a
  declared variable has none).
- Pass `subject` per send when it should be specific; payload subject overrides
  the template default.
- Money copy must reflect the real state: escrow at hire, release to the hunter's
  Bounty balance on approval (minus the platform fee), bank payout only when the
  hunter withdraws. Never say "paid" for "released".

## Templates

`manifest.json` lists every template with its Resend ID, trigger, audience,
variables and fallbacks. Bounty sends only these (the pre-v2 Resend templates
were deleted on 2026-10-25).

| Alias | For | Kind | Sent by |
|---|---|---|---|
| `bounty-v2-posted` | Poster: bounty is live | transactional | `send-notification-email`, type `bounty_posted` |
| `bounty-v2-notice-action` | Any notification with a button | transactional | `send-notification-email`, every other type with a link |
| `bounty-v2-notice-info` | Any notification without a button | transactional | `send-notification-email`, every other type without a link |
| `bounty-v2-team-alert` | Bounty team (internal) | internal | `send-notification-email` support and admin alerts; `contact-support` |
| `bounty-v2-new-applicants` | Poster: applicants (needs `APPLICANT_ROWS`) | transactional | nothing yet |
| `bounty-v2-closing-soon` | Poster: applications about to expire | transactional | nothing yet |
| `bounty-v2-ready-for-review` | Poster: work submitted | transactional | nothing yet |
| `bounty-v2-hired` | Poster: hire confirmed | transactional | nothing yet |
| `bounty-v2-payment-failed` | Poster: pay-at-hire card failed | transactional | nothing yet |
| `bounty-v2-no-applicants` | Poster: no applicants after a day | transactional | nothing yet |
| `bounty-v2-hunter-cancelled` | Poster: hunter cancelled | transactional | nothing yet |
| `bounty-v2-getting-started` | Poster intent, no post | lifecycle | nothing yet |
| `bounty-v2-concierge` | Offer to write the post for them | lifecycle | nothing yet |
| `bounty-v2-unfinished-post` | Started, did not publish | lifecycle | nothing yet |
| `bounty-v2-checkout-abandoned` | Web checkout not finished | lifecycle | nothing yet |
| `bounty-v2-first-done` | First bounty completed | lifecycle | nothing yet |
| `bounty-v2-dormant-poster` | Re-engage past poster | lifecycle | nothing yet |
| `bounty-v2-pass-it-on` | Forward to a friend | lifecycle | nothing yet |
| `auth-*` (6) | Supabase Auth: confirm signup, sign-in code, reset password / account access, change email, reauthentication, invite | auth | Supabase Auth; paste per [supabase-auth.md](supabase-auth.md) |

The events the "nothing yet" templates describe still get an email today,
through the notice templates with the producer's own copy. A dedicated template
replaces that only once a sender builds its variables. Lifecycle emails carry an
unsubscribe link (`UNSUBSCRIBE_URL`); set a real one before wiring any of them.

## Sending behaviour

- v2 is the default. `EMAIL_DESIGN_V2=off` (Supabase function secret) is the
  kill switch: every email goes out in the inline layout, which needs no Resend
  template. No redeploy is needed either way.
- If Resend rejects a template send outright (400/403/404/422: template
  missing or unpublished, bad variables), the same email is sent in the inline
  layout, so a template problem never loses an email. 409/429/5xx are not
  retried inline, because the email may already exist.
- SendGrid, if it is ever the provider, always uses the inline layout.

## Changing a template

1. Edit `scripts/emails/templates.mjs` (copy) or `design-system.mjs` (look).
2. `node scripts/emails/build.mjs emails`. The build fails on variable mistakes.
3. Update the template in Resend with the new HTML, text and variables, then
   **publish** it. Edits to a published template are not live until
   republished.
4. If you added a variable, update the sender and
   `__tests__/unit/email-design-v2.test.ts`. The contract test fails when a
   sender passes a variable the template does not declare.
