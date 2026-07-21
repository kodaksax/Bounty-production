# Withdrawal System — Support Runbook

> For L1 support. Goal: resolve the large majority of withdrawal tickets without looping in engineering. See [01-system-overview.md](01-system-overview.md) first if you haven't — the single most important fact is that **`'completed'` in the app means the money left the platform, not that it's arrived in the hunter's bank.**

## Before anything else: find the row

Every ticket starts here. You need `wallet_transactions.status`, `metadata`, and `created_at` for the hunter's most recent withdrawal. If you have SQL access, use `scripts/reconcile_and_triage.sql` §3b's query pattern, or ask engineering to pull it. If you have the admin panel, check **Admin → Transactions** or the new **Admin → Withdrawal Recovery** screen's log (shows admin-initiated actions, not every transaction).

## Expected timelines

| Stage | Timeline | Where it's coming from |
|---|---|---|
| Transfer (app shows "completed") | Immediate — this is synchronous | The `/connect/transfer` API call itself |
| Payout (bank receives funds) | 1-2 business days, typically | The app's own stated estimate — **not an internally-measured SLA**, this is Stripe's typical timing for standard ACH payouts |
| Weekend/holiday delays | Possible, Stripe-side | Bounty's code has no special-case handling; any delay beyond 1-2 business days near a weekend/holiday is expected, not a bug |

**Reassure within the 1-2 business day window. Past it, treat as a genuine investigation, not a "just wait" case** — there's no internal data confidently saying whether "past 2 days" is common or rare, so don't guess.

## Common scenarios

### "My withdrawal is stuck"

1. Find the row. Check `status`:
   - **`'completed'`, no `payout_status` in metadata** → not actually stuck. The Transfer succeeded; the Payout just hasn't resolved yet or hasn't been checked. This is the most common case and is normal within the 1-2 day window.
   - **`'pending'` and more than a few minutes old** → **this should never happen.** See [Escalation](#escalation) immediately — this is the signature of a specific historical regression class.
   - **`'failed'`** → balance should already be refunded (verify via the reconciliation findings or ask engineering to check). Hunter can self-serve a retry in-app if `retry_count < 3`.

2. **Internal tools:** Stripe Dashboard → Connect → [account] → Payouts (source of truth for whether money actually left the connected account); the new **Admin → Withdrawal Recovery** log for any admin actions already taken on this transaction.

### "I never received my money"

Same investigation as "stuck." `'completed'` only proves the Transfer succeeded — check the Stripe Dashboard Payouts tab for the connected account to see if a Payout exists and its actual status. If Stripe shows the payout as `canceled` or `failed` but the local row still says `'completed'` with no `payout_status` in metadata, escalate — the webhook may not have been delivered.

### "The app says completed but my bank shows nothing"

This is expected behavior within the 1-2 business day window given the two-hop design (§ Overview) — not a bug, unless that window has clearly passed.

### "My Stripe account isn't verified" / onboarding won't complete

1. The app checks `charges_enabled && payouts_enabled` live against Stripe on every check — this can flip from working yesterday to blocked today if Stripe now wants more information.
2. Check the Stripe Dashboard's `account.requirements` for the specific missing item (identity doc, SSN, address, etc.) — the app doesn't surface Stripe's exact requirement text, so you may need to relay it manually or direct the hunter back through onboarding.
3. If the hunter was onboarded in the past but is now restricted, the profile's "onboarded" timestamp will still be set (it's never cleared) — go by the live capability flags, not that timestamp.

### "My withdrawal failed"

Balance should already be auto-refunded. If `retry_count < 3`, direct the hunter to retry in-app. If `retry_count >= 3` (`permanently_failed`), self-service is exhausted — escalate for an admin-initiated retry (see below), don't tell them to keep tapping retry.

### "My payout was canceled"

Handled automatically as of this pass (`payout.canceled` has a real handler: refund + notify). If the hunter describes this and the balance wasn't refunded, escalate — check whether the Stripe Dashboard event was actually delivered (Developers → Webhooks → delivery log).

### "My bank account disappeared"

Bank accounts aren't stored in Bounty's database — the app lists them live from Stripe every time the screen loads. If one is missing, it was removed on Stripe's side (the hunter removed it, or Stripe rejected/closed it). There's no local audit trail beyond Edge Function logs.

### "I withdrew to the wrong account"

As of the bank-account-selection fix, the app now actually wires the hunter's selection through to Stripe (promotes it to the payout default before transferring). If a hunter reports this for a withdrawal made **before** that fix shipped, it's plausible the selection was cosmetic-only at the time — check the transaction's `created_at` against when the fix deployed. For anything after, the selected account should be correct; if not, escalate as a genuine bug, not user error.

**Residual limitation to know about:** Stripe's automatic payout sweep pulls the connected account's *entire* balance on its own schedule. Two withdrawals made close together with *different* bank selections can still get swept together to whichever account was default at sweep time. This is a known, accepted limitation — confirm which account actually received the money via the Stripe Dashboard before promising a specific outcome.

### "Can you just retry it / fix my balance for me"

As of this pass, support/engineering has a real tool for this: the **Admin → Withdrawal Recovery** screen, which calls an audited backend endpoint. It requires admin credentials and a written reason for every action — if you don't have admin access, escalate to someone who does rather than asking for a raw SQL fix.

As of 2026-07-18, the same screen also supports **marking a withdrawal as externally settled** (for cases resolved outside the app, e.g. paid by another means after confirming with Stripe that no payout landed) and **on-demand reconciliation** (re-run the drift/stuck-withdrawal checks immediately instead of waiting for the daily job). A withdrawal marked this way shows `status: 'manually_paid'` — this is permanent and intentional; it will never auto-retry or auto-refund again, and support/engineering should never try to "fix" it back to a normal state.

## Escalation

Escalate immediately, don't attempt to explain it away, when you see:

- A `'pending'` row older than a few minutes
- Any withdrawal where the balance doesn't match expectations after a `'failed'` status
- A `permanently_failed` withdrawal (`retry_count >= 3`) — needs an admin-initiated retry or manual review
- A Stripe Dashboard payout status that doesn't match the local row's status/metadata
- Anything the reconciliation job flags as `critical` severity (ask engineering — findings land in a table, not a place support has direct visibility into yet)

**What to include when escalating:** the `wallet_transactions.id`, `stripe_transfer_id` if present, the hunter's user ID, and exact timestamps. This is the minimum an engineer needs to investigate without going back and forth.

## Communication templates

**Reassurance (within the timeline window):**
> "Your withdrawal of $[amount] was initiated on [date] and is on its way — bank transfers typically take 1-2 business days from our side. If it hasn't arrived by [date+2 business days], let us know and we'll look into it."

**Failed, retry-eligible:**
> "Your withdrawal couldn't be completed — your balance has already been restored, no funds were lost. You can try again from the Withdraw screen. If it fails again, let us know the exact error shown."

**Failed, retries exhausted:**
> "Your withdrawal has failed multiple times and needs a closer look from our team — I've flagged this for review and someone will follow up. Your balance has not been charged."

**Escalated / under investigation:**
> "I'm looking into this with our engineering team and will follow up as soon as I have an update — thanks for your patience."

## FAQ

**Q: Why does it say 1-2 business days if the app says "completed" immediately?**
A: Two separate steps happen. The money leaves Bounty's platform balance immediately (that's what "completed" means); it then takes Stripe's normal bank transfer time to actually land in the hunter's account.

**Q: Can a hunter cancel a withdrawal once submitted?**
A: No — the confirmation dialog explicitly warns it can't be canceled once started, because the Transfer step is synchronous and irreversible from the app's side by the time the response comes back.

**Q: Is there a minimum/maximum withdrawal amount?**
A: Yes, $10 minimum and $10,000 maximum per transaction, both configurable server-side values (not hardcoded policy) — if a hunter disputes these, that's a product/business decision to relay upward, not something support can override.

**Q: A hunter says they never got a push notification about their withdrawal.**
A: Possible — withdrawal/payout events currently write to the in-app notification inbox, not necessarily the push-notification queue. Don't assume a missing push notification means something failed; check the in-app notifications tab.
