# Completed-bounty proof pages

A completed bounty can become a public case study at
`https://www.bountyfinder.net/proof/<title>-<city>-<public id>`, linked from
city and category pages and listed in `/proof/sitemap.xml`. This runbook is
for the person who reviews them.

Schema and rules: `supabase/migrations/20261027120000_bounty_proof_pages.sql`.
Website: Bounty-landing-page `worker/proof.js` (README "Proof pages").

## How a bounty gets there

1. **It is eligible**, checked by `fn_proof_eligibility(bounty_id)` on every
   public read: completed, not a test, in person, a cash reward, a public
   location of exactly "City, ST", an accepted hunter, an approved completion
   submission, and no dispute, live cancellation, refund, moderation hold, or
   deleted, restricted or internal poster account. If any of these stops being
   true, the page goes down by itself.
2. **The poster says yes.** Between 24 hours and 30 days after completion,
   `fn_request_proof_consent` (cron `proof-consent-requests-hourly`) sends one
   `proof_consent_request` notification. It is in the `marketing` category, so
   the poster's marketing switches and quiet hours apply. The email links to
   `/manage/?view=share&bounty=<id>`. A poster can also get there from any
   completed bounty on `/manage/`. Accepting the Terms is **not** consent.
3. **You review it** and publish.

Nothing goes up without steps 2 and 3, and nothing stays up without step 1.

## Reviewing

```sql
-- Waiting for a decision (SQL editor, or with the service role).
select * from public.proof_admin_queue();
```

For each row, check:

- **The title** is fit to print. It is shown exactly as written. If it names a
  person, a street, a business or anything private, don't publish. Ask the
  poster to edit the title, or leave it unpublished.
- **Photos**, only if `consent_photos` is true. Open each file the bounty
  already has (completion submission `proof_items`, bounty attachments). Use
  a photo only if it shows the work and **nothing identifying**: no faces, no
  house numbers or street signs, no number plates, no access codes or keypads,
  no mail or documents, and no private interiors beyond the work itself. HEIC
  files can't be used (browsers can't show them), and neither can anything
  that isn't JPEG, PNG or WebP.
- **Roles.** `before` and `after` only as a pair from the same job. A single
  photo, or several of the finished work, is `completion`.
- **Alt text** for every photo, 8–200 characters, describing what the photo
  actually shows ("TV mounted above a brick fireplace, no cables visible"),
  not what you'd like it to imply.
- **The quote**, only if `has_testimonial`. Publish it as written or not at
  all; don't edit someone's words.

```sql
select public.proof_admin_publish(
  '<bounty id>',
  '[{"path": "bounties/<bounty id>/proofs/<file>.jpg", "role": "completion",
     "alt": "Assembled six-drawer dresser against a bedroom wall"}]'::jsonb,
  true,                    -- include the approved quote
  'checked photos: no faces, no house numbers'
);
```

It refuses anything that isn't consented, eligible, this bounty's own file,
or labelled correctly. Once published, the page is live within about three
minutes (the website caches for up to 120 seconds).

## Taking one down

```sql
select public.proof_admin_unpublish('<bounty id>', 'why, in a sentence');
```

The page becomes a 404 and leaves listings and the sitemap within about three
minutes. Photos stop loading within five. Re-publishing needs
`proof_admin_publish` again.

A poster can withdraw at any time on `/manage/?view=share`. Saying no takes
the page down at once, with no review. Withdrawing only the photos, the quote
or the name removes that part at once. Adding something new (a quote, photo
permission) waits for your next review.

## What is recorded

Every answer and decision is in `bounty_events` (`source = 'proof_pages'`):
`proof.consent_recorded`, `proof.published`, `proof.unpublished`. The poster's
answers themselves are in `public.bounty_proofs`, which has no client access.

## Known gaps

- The app has no in-app consent screen. The notification opens the app's
  notification list, and the email and the website are where the poster
  answers.
- Publishing is SQL-only. There is no admin screen yet. The `proof_admin_*`
  functions have no `authenticated` grant, so a screen would call them from
  an Edge Function (service role) that checks `is_admin()` first.
- Bounties completed before this shipped were never asked. Every real
  completed bounty as of 2026-10-27 is also ineligible: no "City, ST"
  location, no category, and 13 of 19 were for honor. So the first pages
  depend on new completions.
