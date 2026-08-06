# Honor-bounty backfill plan

**Status:** Plan only. Nothing in this document has been executed.
**Date:** 2026-08-01
**Scope:** The 49 existing honor (`$0`) bounties in production, decided per-status.

---

## 1. Decision: exclude the 16 `completed` honor bounties entirely

Checked against the premise that these hold real completion evidence worth preserving — they
don't:

| Check | Result |
|---|---|
| Posted by a real (non-seed) user | **0 of 16** — all from `poster007`, `jordan`, `hunter`, `apptestboi`, plus `nick`/`noti` (also clearly QA) |
| Titles | *"Testing production pt 5," "Testing dispute 2nd day," "Let's test submission"* — dev/QA testing, not real tasks |
| `completed_at` set | **0 of 16** (also true of all 11 paid `completed` bounties — see §4, this is a separate live bug, now fixed) |
| Has a proof photo/attachment | **1 of 16**, and that one is also titled "test dem notes fr" |

**Decision: exclude all 16 from anything user-facing.** There is no real completion evidence
in this set. Archiving/hiding them is cleanup, not data loss.

---

## 2. The remaining 33 are not what they first looked like either

Of the 49 total honor bounties, 33 are not `completed`. Breaking that down by status revealed
most of these are also QA/dev debris still sitting in the **live, real-user-visible feed**
today — not dormant backfill candidates:

| Status | Count | Real (non-seed) posters | Notes |
|---|---|---|---|
| `open` | 8 | **7** (`kxc`, `whitetig3rlilly07`, `ewalkerw` ×2, `tonkagisil_1167`, `justchillin17`, `KevinY`) + 1 seed (`bounty0j`) | These are the only genuine backfill candidates. |
| `in_progress` | 14 | **0** — all `poster007`/`bounty0j`/`jordan`/`hunter` | Titles: *"Test to your hearts content," "Use for dispute check," "Dispute transaction test," "Testing if postings work now."* Every one has a hunter marked `accepted_by`, but this is QA furniture, not real work in progress. |
| `deleted` | 6 | — | Already not user-visible; no action needed. |
| `cancelled` | 4 | — | Already terminal; no action needed. |
| `archived` | 1 | — | Already not in the default feed; no action needed. |

**This surfaces a finding independent of the backfill question:** the 14 `in_progress` +
1 `open` seed-account honor bounties are currently live in the production feed
(`components/bounty-feed.tsx` applies no honor filter and no account filter — see the earlier
diagnosis). Real users can see and apply to QA test bounties like "Dispute transaction test"
today. This is worth a separate, small cleanup (flip these 15 to `archived` or a new
`internal_test` status) independent of whatever the backfill decision is for real users' posts
— it's not a data-loss risk since nothing here is real, but it's actively diluting the board
for real users right now.

---

## 3. Backfill plan for the real candidates (7 open, non-seed)

| Bounty | Poster | Category | Posted |
|---|---|---|---|
| "Send me dog pic" | kxc | writing | 2026-03-18 |
| "Clean my pool" | whitetig3rlilly07 | labor | 2026-04-09 |
| "Wash my dishes" | ewalkerw | (none) | 2026-04-14 |
| "Clean my pool" | ewalkerw | (none) | 2026-04-14 |
| "marketing art" | tonkagisil_1167 | writing | 2026-06-09 |
| "Dog sitting" | justchillin17 | labor | 2026-07-13 |
| "Nanny" | KevinY | (none) | 2026-07-27 |

None of these have a hunter assigned (`accepted_by` is null on all 7) — no in-flight work to
protect, which simplifies the options considerably.

**Proposed approach — a one-time prompt, not a forced conversion:**

1. Send each poster an in-app notification / re-engagement moment (reusing the existing
   `fn_enqueue_activation_moment` mechanism already used for other bounty-lifecycle nudges):
   *"Want [title] to get more attention? Add a budget — paid bounties on Bounty get picked up
   faster."* Link straight into the amount step of the edit/create flow, pre-filled with the
   category default.
2. **Do not auto-convert or auto-hide anything.** If the poster doesn't respond, the bounty
   stays exactly as it is today — visible in a Favors lane (once item 2 of the broader plan
   ships), not silently altered or deleted. A silent status change on a real user's existing
   post is out of scope without explicit confirmation from that user.
3. No deadline/expiry forced on this prompt. It rides alongside the existing lifecycle
   notification system rather than introducing a new one-off campaign mechanism.

**Explicitly not in scope for this plan:** deleting, archiving, or converting any of these 7
without the poster's own action. The only executable step here is the notification/moment —
everything else is the poster's choice.

---

## 4. Related fix already applied

While investigating the 16 `completed` bounties, found `completed_at` was `NULL` on **all**
27 `completed`-status bounties in production (16 honor + 11 paid) — not hand-set QA data, a
live bug: the two real completion call sites
(`lib/services/completion-service.ts:approveSubmission`,
`app/postings/[bountyId]/payout.tsx` handlePayout/handleMarkComplete) set `status: 'completed'`
but never wrote `completed_at`. Fixed in both call sites (now also added to the `Bounty` type
in `lib/services/database.types.ts`, which was missing the field entirely). This was a
prerequisite for evaluating this backfill honestly and also unblocks any future feature that
needs a real completion timestamp (streaks, "completed this week" copy, retention pushes).
