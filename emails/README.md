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
variables and fallbacks. Summary:

| Alias | For | Kind | Wired today? |
|---|---|---|---|
| `bounty-v2-posted` | Poster: bounty is live | transactional | `bounty_posted` — v2 behind `EMAIL_DESIGN_V2` |
| `bounty-v2-notice-action` | Any notification with a button | transactional | all other Resend types — behind `EMAIL_DESIGN_V2` |
| `bounty-v2-notice-info` | Any notification without a button | transactional | as above |
| `bounty-v2-new-applicants` | Poster: applicants (needs `APPLICANT_ROWS`) | transactional | no producer yet |
| `bounty-v2-closing-soon` | Poster: applications about to expire | transactional | no producer yet |
| `bounty-v2-ready-for-review` | Poster: work submitted | transactional | no producer yet |
| `bounty-v2-hired` | Poster: hire confirmed | transactional | no producer yet |
| `bounty-v2-payment-failed` | Poster: pay-at-hire card failed | transactional | no producer yet |
| `bounty-v2-no-applicants` | Poster: no applicants after a day | transactional | no producer yet |
| `bounty-v2-hunter-cancelled` | Poster: hunter cancelled | transactional | no producer yet |
| `bounty-v2-getting-started` | Poster intent, no post | lifecycle | no producer yet |
| `bounty-v2-concierge` | Offer to write the post for them | lifecycle | no producer yet |
| `bounty-v2-unfinished-post` | Started, did not publish | lifecycle | no producer yet |
| `bounty-v2-checkout-abandoned` | Web checkout not finished | lifecycle | no producer yet |
| `bounty-v2-first-done` | First bounty completed | lifecycle | no producer yet |
| `bounty-v2-dormant-poster` | Re-engage past poster | lifecycle | no producer yet |
| `bounty-v2-pass-it-on` | Forward to a friend | lifecycle | no producer yet |
| `auth-confirm-signup` | Supabase Auth signup confirmation | auth | paste into Supabase dashboard |
| `auth-magic-link` | Supabase Auth sign-in link | auth | paste into Supabase dashboard |
| `auth-reset-password` | Supabase Auth password reset | auth | paste into Supabase dashboard |

Lifecycle emails carry an unsubscribe link (`UNSUBSCRIBE_URL`); transactional
and auth emails do not.

## Rollout

1. Publish the v2 templates in Resend (they were created as drafts).
2. Deploy `send-notification-email` with `EMAIL_DESIGN_V2` unset — behaviour is
   byte-for-byte unchanged (verified with a handler harness).
3. Set `EMAIL_DESIGN_V2=on` in staging, trigger each type, check Resend logs.
4. Set it in production. Rollback: unset the variable.
