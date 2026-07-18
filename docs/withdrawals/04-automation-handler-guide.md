# Withdrawal System — Automation Handler Guide

> Written for a future AI or automated support agent handling withdrawal issues. If you are that agent: read this whole document before acting on any withdrawal ticket. It defines what you may decide autonomously, what you must escalate, and exactly what to query to tell the difference. When in doubt, escalate — every boundary in this document is deliberately conservative because the failure mode of "moved real money incorrectly" is categorically worse than "asked a human."

## Inputs you'll typically have

- A hunter's user ID, username, or a support ticket describing a symptom ("my withdrawal is stuck," "I never got my money," etc.)
- Possibly a `wallet_transactions.id` or `stripe_transfer_id` if the human/system already found it
- Read access to the database (via SQL or the Supabase MCP tools) and to Stripe (via the Stripe MCP tools or Dashboard equivalent)

## Hard boundaries — read this before the decision tree

**You may always, without escalation:**
- Read any table, run any read-only SQL query, call any Stripe read endpoint (`retrieve`, `list`)
- Classify a ticket and explain the current state to a human
- Draft a customer-facing message using the templates in the Support Runbook
- Call `admin-withdrawals` with `action: 'list_log'` (read-only)

**You must escalate to a human before:**
- Calling `admin-withdrawals` with `action: 'force_retry'` or `action: 'manual_adjustment'` — these move real money or directly alter a real balance. Even though the endpoint is audited and reason-gated, an automation agent initiating these autonomously is out of scope for this guide's authorization. Present the recommended action and the evidence for it; let a human execute it (or explicitly, narrowly authorize you to, per your own operating constraints — that authorization does not come from this document).
- Minting or using any real user's session/auth token
- Directly calling `stripe.transfers.create`, `stripe.payouts.*` write methods, or any other Stripe write endpoint
- Directly writing to `profiles.balance`, `wallet_transactions`, or any other financial table via SQL
- Telling a hunter a definitive resolution timeline beyond what the Support Runbook's templates already say

**Never, under any circumstances:**
- Attempt to "test" the withdrawal flow end-to-end against production with real money
- Clear `balance_frozen` on a profile (the code comment is explicit: a lost dispute stays frozen pending manual admin review, by design)
- Bypass or reinterpret the amount limits (`WITHDRAW_MIN_USD`/`WITHDRAW_MAX_USD`)

## Decision tree

```mermaid
flowchart TD
    Start[Ticket received] --> Find{Can you find\nthe wallet_transactions row?}
    Find -- No --> NoRow[Check Stripe directly by any\nprovided transfer/payout ID.\nIf genuinely nothing exists anywhere,\nESCALATE — likely a CRITICAL\nhistory-insert-failure case]
    Find -- Yes --> Status{status?}

    Status -- pending --> PendingAge{Older than\na few minutes?}
    PendingAge -- No --> PendingWait[Not an issue yet.\nReassure using the Support\nRunbook SOP 1 template.]
    PendingAge -- Yes --> PendingCrit[ESCALATE immediately.\nThis should be structurally\nimpossible — see System\nOverview §\"Why never pending\".\nDo not attempt any fix.]

    Status -- completed --> PayoutCheck{Query Stripe:\ndoes a Payout object exist\nfor this Transfer's connected\naccount matching the amount?}
    PayoutCheck -- "Yes, paid" --> AllGood[Resolved. Confirm to the\nhuman/hunter, no action needed.]
    PayoutCheck -- "Yes, in_transit,\nwithin 1-2 business days" --> Normal[Normal. Reassure with\nSupport Runbook SOP 1.]
    PayoutCheck -- "Yes, in_transit,\npast 1-2 business days" --> Delayed[Investigate — check webhook\ndelivery log in Stripe Dashboard\nfor missed events. If truly\nunexplained, ESCALATE.]
    PayoutCheck -- "Yes, but status is\nfailed/canceled and local\nrow still shows completed" --> WebhookGap[A webhook was likely missed\nor not yet delivered.\nESCALATE with the Payout ID\nand its Stripe status —\ndo NOT self-correct the balance.]
    PayoutCheck -- No payout object found --> NoPayout[Could be pre-sweep (normal,\nrecent) or a deeper gap (old).\nCheck transaction age; if\n>2 business days old with no\nPayout object, ESCALATE.]

    Status -- failed --> RetryCount{metadata.retry_count}
    RetryCount -- "< 3" --> SelfService[Not an escalation. Confirm\nthe balance was refunded\n(cross-check ledger), then tell\nthe hunter to retry in-app.]
    RetryCount -- ">= 3\n(permanently_failed)" --> NeedsAdmin[Confirm balance was refunded.\nGather: transactionId, userId,\namount, and WHY the original\nfailures happened (Stripe error\ncodes from metadata).\nPresent a force_retry\nrecommendation to a human —\ndo not execute it yourself.]
```

## Diagnostics — what to query for each classification

**Confirm the transaction and its metadata:**
```sql
SELECT id, user_id, amount, status, stripe_transfer_id, stripe_connect_account_id,
       idempotency_key, metadata, created_at
FROM wallet_transactions
WHERE user_id = '<user_id>' AND type IN ('withdrawal', 'admin_adjustment')
ORDER BY created_at DESC LIMIT 5;
```

**Confirm balance reconciles against the ledger** (a real drift here is `critical` — see below):
```sql
SELECT p.id, p.balance,
       COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0) AS ledger_balance
FROM profiles p LEFT JOIN wallet_transactions wt ON wt.user_id = p.id
WHERE p.id = '<user_id>' GROUP BY p.id, p.balance;
```

**Check for any unacknowledged reconciliation findings for this user** (populated daily by `run_withdrawal_reconciliation()` — see Engineering Runbook):
```sql
SELECT finding_type, severity, details, run_at
FROM reconciliation_findings
WHERE user_id = '<user_id>' AND acknowledged_at IS NULL
ORDER BY run_at DESC;
```

**Check any prior admin actions on this user/transaction** (read-only, always allowed):
```
POST /admin-withdrawals  { "action": "list_log", "userId": "<user_id>" }
```

**Stripe objects to inspect (read-only):**
- `stripe.transfers.retrieve(stripe_transfer_id)` — confirm the Transfer itself succeeded and check its `reversed`/`amount_reversed` fields
- `stripe.accounts.retrieve(stripe_connect_account_id)` — confirm `payouts_enabled`, check `requirements` for onboarding blockers
- List Payouts on the connected account (Dashboard, since the Payouts list isn't directly filterable by Transfer in the API) and match by amount/timing to the Transfer

## Resolution flow — retry / wait / notify / escalate / refund / file a ticket

| Situation | Your action | Rationale |
|---|---|---|
| `pending`, < a few minutes old | Wait, note it, don't act | Could still be mid-request |
| `pending`, > a few minutes old | **Escalate immediately, file an engineering ticket** | Structurally should be impossible; treat as an active incident, not a queue item |
| `completed`, payout `in_transit`, within window | Notify hunter with reassurance template, no ticket needed | Normal operation |
| `completed`, payout `in_transit`, past window | Escalate to engineering for webhook-delivery check | Could be a missed webhook, not necessarily broken |
| `completed`, payout `paid` | Notify hunter it's resolved, close ticket | Confirmed delivered |
| `completed`, payout `failed`/`canceled` in Stripe but local row unchanged | **Escalate — do not touch the balance yourself** | This is exactly the class of gap the new webhook handlers close automatically when delivered; if you're seeing this, delivery likely failed and needs investigation, not a workaround |
| `failed`, `retry_count < 3` | Direct hunter to self-service retry, no ticket needed | Self-healing by design |
| `failed`, `retry_count >= 3` | **Recommend `force_retry` to a human with full context; do not execute** | Exhausted self-service; needs judgment on whether retrying is actually the right call (e.g., don't blindly retry into a still-restricted account) |
| Balance drift found (ledger ≠ cached) for this user | **Escalate with the exact drift amount; do not self-correct via `manual_adjustment`** | A drift can have multiple causes (in-flight transaction, historical bug, legitimate admin action not yet reflected) — a human should confirm the cause before correcting it, even though the tool to correct it exists |
| Nothing found anywhere (no local row, no Stripe object) for a hunter claiming a specific withdrawal | Escalate — could be user confusion (wrong account) or a genuinely lost transaction | Don't guess |

## Writing to the human you escalate to

Always include: the `wallet_transactions.id` (if found), `stripe_transfer_id` (if found), the user ID, exact timestamps, and — critically — **the specific Stripe object state you observed**, not just "it looks stuck." A human acting on your escalation needs your diagnostic trail, not just your conclusion.

## What "safely handle the majority of cases" actually means here

Most withdrawal tickets are **not** anomalies — they're a hunter asking about a transfer that's simply still `in_transit` within the normal window. You can resolve those directly with a reassurance message, no escalation, no ticket. The boundaries above exist for the minority of cases that touch real money movement or balance correction — treat those as genuinely requiring a human, not as friction to route around.
