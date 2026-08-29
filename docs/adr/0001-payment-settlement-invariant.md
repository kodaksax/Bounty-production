# ADR 0001 — The Payment Settlement Invariant

**Status:** **Accepted** 2026-08-24 — decisions 1–5 resolved at review (§8). Not yet implemented.
**Date:** 2026-08-24
**Supersedes:** nothing. **Depends on:** [docs/payment-architecture-audit.md](../payment-architecture-audit.md)
**Related:** [V2_FUNDING_MIGRATION_SCOPE.md](../payments/V2_FUNDING_MIGRATION_SCOPE.md),
[CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md](../payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md),
[RECONCILIATION_AND_LEGACY_RETIREMENT.md](../payments/RECONCILIATION_AND_LEGACY_RETIREMENT.md),
[_shared/payout-state.ts](../../supabase/functions/_shared/payout-state.ts)

---

## 1. Context

The Phase 1 audit established that v1 — the architecture behind **all 44** bounties ever marked
completed — is a closed custodial ledger with no Stripe call on either the escrow or release
side. That is not a defect to be patched; it is what v1 *is*. The defect is that the system
**describes** a v1 ledger credit using the vocabulary of settlement.

Three concrete consequences, all verified live on 2026-08-24:

- "Walk my cat" (`53656a8b…`) is `status='completed'` with a `release` row of `+$73.60`,
  `status='completed'`, and a hunter whose `stripe_connect_account_id` is **NULL**. Both parties
  believe this settled.
- **2 of 315** profiles are `stripe_connect_payouts_enabled`. A v1 release to any of the other
  313 produces the same unwithdrawable credit.
- The reconciliation invariant sweep that would notice is **not scheduled** (audit NEW-2), and
  its findings go to a table nobody is paged from.

There is also a live regression path: the admin `force_retry` action still writes
`status='completed'` on a Transfer alone (audit NEW-1), and the 2026-08-15 grandfathering cutoff
makes it succeed *silently* on exactly the legacy rows it targets.

### 1.1 The invariant this ADR proposes

> **A record may only be described to a user as settled when a Stripe object confirms it.
> Everything else must be described as what it actually is.**

Note the shape: this is a **truthfulness** invariant, not a prohibition on ledger-only movement.
v1's behaviour is not itself wrong — an in-app balance is a legitimate product primitive. What is
wrong is calling it "paid".

### 1.2 A correction to the brief's framing

The Phase 2 brief's option B says to block fund release until `payouts_enabled = true`. Applied
to v1 as written, that would be a **net harm**, and §4 explains why: a v1 balance credit is
*recoverable* (the hunter onboards later and withdraws), whereas a blocked release strands the
poster's escrow and leaves the hunter with nothing for work already done. Blocking is right for
v2, where the Transfer genuinely cannot be created; for v1 the right control is honest labelling
plus an onboarding prompt. §4 presents this as a decision with options rather than assuming it —
it is item 2 on the approval checklist.

---

## 2. Decision A — `settlement_state`

### 2.1 The vocabulary

```sql
CREATE TYPE public.settlement_state_enum AS ENUM (
  'ledger_only',     -- money moved only inside our database
  'stripe_pending',  -- a Stripe object exists; it has not reached a terminal success
  'stripe_settled'   -- Stripe confirmed terminal success
);
```

Three states, not two, because the middle one is where every correctly-behaving withdrawal lives
for 1–2 business days. Collapsing it into either neighbour is how the 2026-08-13 incident
happened: a submitted payout got called settled.

### 2.2 Mapping

| Row | `settlement_state` | Rationale |
|---|---|---|
| v1 `escrow` | `ledger_only` | poster's balance debited; nothing left Postgres |
| v1 `release` | `ledger_only` | **all 20 existing rows** |
| v1 `refund` | `ledger_only` | same |
| `deposit` w/ `stripe_payment_intent_id` | `stripe_settled` | the one genuinely Stripe-backed v1 flow |
| `withdrawal`, payout id present, not yet `paid` | `stripe_pending` | correct in-flight state |
| `withdrawal`, `payout.paid` observed | `stripe_settled` | |
| `withdrawal`, `status='completed'`, **no** payout id | `ledger_only` | the 25 historical rows — see §2.5 |
| `admin_adjustment` | `ledger_only` | by definition |

### 2.3 Derivation, not assignment

**No writer sets this column.** It is derived by a `BEFORE INSERT OR UPDATE` trigger from the
evidence columns already on the row. This matters for three reasons:

1. It cannot drift from the evidence, because it *is* the evidence, restated.
2. It requires **zero changes** to the four Edge Functions that write ledger rows — a much
   smaller blast radius than threading a new field through each.
3. It covers writers that no application-layer change could reach — in particular
   `fn_release_wallet_escrow_for_dispute`
   ([20260520_add_fn_release_wallet_escrow_for_dispute.sql:180-205](../../supabase/migrations/20260520_add_fn_release_wallet_escrow_for_dispute.sql#L180-L205)),
   a `SECURITY DEFINER` PL/pgSQL function that inserts `type='release', status='completed'`
   directly and bypasses `/wallet/release` entirely. **The audit did not surface this third
   release path; it turned up while designing this ADR.**

> ✅ **RESOLVED 2026-08-24 (review).** Derive `settlement_state` from **Stripe evidence fields
> only — never from `status`.** Rationale, and it is decisive: of the 27 withdrawals marked
> `completed` before 2026-08-16, **25 have no `stripe_payout_id`**. A rule that reads `status`
> would certify exactly those 25 as settled — the precise bug this ADR exists to close. `status`
> is an assertion the application makes; the Stripe id is evidence. Only evidence counts.

**A correction this forced.** The draft above referenced `metadata->>'payout_status'`. That key
is **NULL on all 30 withdrawal rows in production** — verified directly.

Code to write it does exist — `connect` sets it at insert
([connect/index.ts:1152](../../supabase/functions/connect/index.ts#L1152)) and the payout webhooks
patch it ([webhooks/index.ts:413, 823, 2362](../../supabase/functions/webhooks/index.ts#L413)) —
but no live row carries it, because every row predates those writers or never reached them: the 25
historical rows are from the pre-fix flow, the 1 `pending` row never got a payout created, and the
2 with payout ids were not written by that path. `decidePayoutEventAction` reads the key
([payout-state.ts:233](../../supabase/functions/_shared/payout-state.ts#L233)) purely as a
refund-once guard, not as settlement evidence.

So the key is unpopulated *and* structurally the wrong place for this: it is buried in JSONB, has
no constraint, and no index. The first draft of this trigger was wrong to lean on it.

That leaves a genuine gap: with `status` excluded and `payout_status` empty, nothing on the row
distinguishes *"payout created, in transit"* from *"payout paid"*. The fix is to **record the
Stripe fact explicitly** rather than infer it:

```sql
-- Written ONLY by the payout.paid / payout.failed / payout.canceled webhook
-- handlers, from Stripe's own payout.status. Never set by any other writer.
ALTER TABLE public.wallet_transactions
  ADD COLUMN stripe_payout_status text
  CHECK (stripe_payout_status IN ('paid','pending','in_transit','canceled','failed'));
```

```sql
CREATE OR REPLACE FUNCTION public.fn_derive_settlement_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Evidence only. `status` is deliberately never consulted: it is what the
  -- application believes, and the 25 historical rows are what happens when
  -- belief is treated as proof. See ADR 0001 §2.3.
  NEW.settlement_state :=
    CASE NEW.type
      WHEN 'withdrawal' THEN
        CASE
          WHEN NEW.stripe_payout_id IS NULL              THEN 'ledger_only'
          WHEN NEW.stripe_payout_status = 'paid'         THEN 'stripe_settled'
          ELSE 'stripe_pending'
        END
      WHEN 'deposit' THEN
        CASE WHEN NEW.stripe_payment_intent_id IS NOT NULL
               OR NEW.stripe_charge_id IS NOT NULL       THEN 'stripe_settled'
             ELSE 'ledger_only' END
      WHEN 'release' THEN
        CASE WHEN NEW.stripe_transfer_id IS NOT NULL     THEN 'stripe_settled'
             ELSE 'ledger_only' END
      WHEN 'refund' THEN
        CASE WHEN NEW.stripe_refund_id IS NOT NULL       THEN 'stripe_settled'
             ELSE 'ledger_only' END
      ELSE 'ledger_only'
    END::settlement_state_enum;
  RETURN NEW;
END;
$$;
```

**Accepted consequence.** At backfill, the 2 withdrawals that have a payout id but no
`stripe_payout_status` land in `stripe_pending`, not `stripe_settled` — a deliberate,
conservative downgrade of two rows that are *probably* genuinely settled. Phase 5's Stripe lookup
resolves them by reading the real payout status and writing it to the new column. Being briefly
too cautious about 2 rows is the correct trade against being wrong about 25.

### 2.4 The storage-level backstop

The trigger derives; a `CHECK` guarantees independently that the column can never overclaim,
even if the trigger is dropped or replaced:

```sql
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_settlement_state_requires_evidence
  CHECK (
    settlement_state <> 'stripe_settled'
    OR stripe_payout_id IS NOT NULL
    OR stripe_transfer_id IS NOT NULL
    OR stripe_charge_id IS NOT NULL
    OR stripe_payment_intent_id IS NOT NULL
    OR stripe_refund_id IS NOT NULL
  );
```

Note the deliberate absence of a date-based escape clause. Unlike
`wallet_transactions_completed_withdrawal_requires_payout`, this constraint is satisfiable by
every historical row *without* exemption, because the honest classification of those rows is
`ledger_only`. **Truth needs no grandfathering** — that is the main argument for this design over
tightening the existing constraint.

### 2.5 What this does for the 25 historical rows

They become permanently and precisely identifiable, independent of any cutoff date:

```sql
WHERE type = 'withdrawal' AND status = 'completed' AND settlement_state = 'ledger_only'
```

which reads, in English: *our ledger says this withdrawal completed and Stripe has no record of
it.* That is exactly the sentence Phase 5 needs, and today it can only be expressed as a
date-bounded heuristic.

### 2.6 `bounty_payments` (v2)

v2 already encodes this in `status` — `released` requires `stripe_transfer_id`, and only the
`transfer.created` webhook may set it
([_shared/bounty-payment-settlement-state.ts](../../supabase/functions/_shared/bounty-payment-settlement-state.ts)).
Add the same column for a uniform API contract, derived from `status`:

| `bounty_payments.status` | `settlement_state` |
|---|---|
| `pending_payment`, `authorized` | `ledger_only` |
| `captured`, `release_pending` | `stripe_pending` |
| `released` | `stripe_settled` |
| `failed`, `refunded`, `canceled` | derive from which stripe id is present |

### 2.7 The user-facing rule

One shared helper, used by both the Edge Functions and the client, replaces every ad-hoc string:

```ts
// supabase/functions/_shared/settlement-vocabulary.ts  (mirrored to lib/utils/)
export type SettlementState = 'ledger_only' | 'stripe_pending' | 'stripe_settled';

export function describeSettlement(
  type: WalletTxType,
  state: SettlementState
): { label: string; detail: string; tone: 'neutral' | 'pending' | 'success' } {
  if (type === 'release') {
    return state === 'stripe_settled'
      ? { label: 'Paid',              detail: 'Sent to your bank via Stripe.',        tone: 'success' }
      : { label: 'Added to balance',  detail: 'Available in your Bounty balance. '
                                            + 'Set up payouts to move it to your bank.', tone: 'neutral' };
  }
  if (type === 'withdrawal') {
    switch (state) {
      case 'stripe_settled': return { label: 'Paid',      detail: 'Arrived in your bank account.',      tone: 'success' };
      case 'stripe_pending': return { label: 'On its way', detail: 'Typically 1–2 business days.',       tone: 'pending' };
      default:               return { label: 'Unconfirmed', detail: 'We could not confirm this payout. '
                                                                 + 'Contact support.',                  tone: 'neutral' };
    }
  }
  /* … escrow / refund / deposit / admin_adjustment … */
}
```

**Only `stripe_settled` may produce the word "Paid".** The lint rule in §7.3 makes that
mechanical rather than a matter of reviewer diligence.

### 2.8 Before / after sketches

**`wallet/index.ts:246` — the null-status default (audit finding #1)**

```diff
  const formattedTransactions = (transactions ?? []).map((tx: WalletTransaction) => ({
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    date: tx.created_at,
    details: {
      title: tx.description,
      method: tx.stripe_payment_intent_id ? 'Stripe' : 'Wallet',
-     status: tx.status ?? 'completed',
+     // A null status is not a settled one. Mirrors connect/index.ts:3027.
+     status: tx.status ?? 'pending',
+     settlementState: tx.settlement_state,
+     ...describeSettlement(tx.type, tx.settlement_state),
      bounty_id: tx.bounty_id,
    },
  }));
```

**`wallet/index.ts:904` — the release response message**

```diff
- message: `$${hunterAmount.toFixed(2)} released to hunter.`,
+ settlementState: 'ledger_only',
+ message:
+   `$${hunterAmount.toFixed(2)} added to the hunter's Bounty balance.`,
+ // Deliberately not "paid": for a v1 bounty no Stripe object exists and the
+ // hunter may not be able to withdraw it at all. See ADR 0001.
```

**`transaction-detail-modal.tsx:187` — the "Paid to" label (audit finding #7)**

```diff
- label: transaction.type === 'bounty_completed' ? 'Paid to' : 'From',
+ label: transaction.type === 'bounty_completed'
+   ? (transaction.details.settlementState === 'stripe_settled' ? 'Paid to' : 'Credited to')
+   : 'From',
```

**`admin-withdrawals/index.ts:914-928` — audit NEW-1, the live regression path**

```diff
+ // A Transfer is hop one of two. It puts money in the connected account, not
+ // in a bank. Completing here is the 2026-08-13 bug. Create the Payout and let
+ // payout.paid finish the row — the same shape as /connect/transfer.
+ let retryPayout: Stripe.Payout | null = null;
+ try {
+   retryPayout = await stripe.payouts.create(
+     { amount: Math.round(amount * 100), currency: 'usd', method: 'standard' },
+     { stripeAccount: p.stripe_connect_account_id,
+       idempotencyKey: `admin_retry_payout_${transactionId}_${retryCount + 1}` }
+   );
+ } catch (e) {
+   logCritical('admin force-retry: transfer landed but payout creation failed', { … });
+ }
+
+ if (!canTransition(t.status, 'pending')) { /* refuse rather than force */ }
+
  await supabase
    .from('wallet_transactions')
    .update({
      stripe_transfer_id: transfer.id,
-     status: 'completed',
+     stripe_payout_id: retryPayout?.id ?? null,
+     // NOT 'completed'. Only payout.paid may promote this row.
+     status: 'pending',
      metadata: { …t.metadata, retry_count: retryCount + 1, … },
    })
    .eq('id', transactionId);
```

This also repairs the illegal `failed → completed` transition: `failed` is terminal in
`ALLOWED_TRANSITIONS`, so the state machine needs an explicit, auditable
`failed → pending` re-open reserved to this admin action.

---

## 3. Decision C — real-time alerts on `critical` findings

*(Presented before Decision B because B's rollout depends on the observability C provides.)*

### 3.1 Existing infrastructure — audited, nothing new invented

| Mechanism | Verdict |
|---|---|
| `notifications_outbox` → `process-notification`, drained by cron job 7 **every minute** ([20260316_add_notifications_outbox.sql](../../supabase/migrations/20260316_add_notifications_outbox.sql)) | ✅ **Use this.** Delivers in-app bell **and** push. Service-role-only, so a `SECURITY DEFINER` trigger can write to it. Sub-minute latency. |
| `send-notification-email` Edge Function | ✅ Use as a second channel for `critical` only. |
| `send_system_notification()` RPC | ❌ Writes to `notifications` (in-app only, no push) and validates `p_type` against a dispute-only allowlist. Wrong tool. |
| Slack | ❌ **Does not exist.** No webhook, no client, no reference anywhere in the repo. Would be new infrastructure. |

### 3.2 Recipients — resolvable, but not the obvious way

Admins are identified by `auth.users.raw_app_meta_data->>'role' = 'admin'` — **2 accounts**
today. `profiles.role = 'admin'` returns **0 rows**; that column is dead in production (a trap
this codebase has fallen into before). Any implementation reading `profiles.role` will silently
address zero recipients and look like it works.

> ✅ **RESOLVED 2026-08-24 (review).** Both accounts are real and current — `leewright093@gmail.com`
> (created 2025-12-31) and `jordanmag11@yahoo.com` (created 2026-02-23, active, signed in the
> same day). Neither is stale, so the resolver is correct as written.
>
> ⚠️ **One item still open, and it is not a data question:** whether `jordanmag11@yahoo.com`
> should be on the receiving end of payment-critical pages. That is an on-call decision, not
> something the schema can answer. Until it is confirmed, implement `fn_admin_recipient_ids()` as
> specified — it is correct either way — but treat the roster as provisional. If the answer is
> "no", the fix is a dedicated ops recipient rather than a change to the function.

```sql
CREATE OR REPLACE FUNCTION public.fn_admin_recipient_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  FROM auth.users
  WHERE raw_app_meta_data->>'role' = 'admin';
$$;
```

### 3.3 The trigger

```sql
CREATE OR REPLACE FUNCTION public.fn_alert_on_critical_finding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipients uuid[];
BEGIN
  -- Coalesce: at most one alert per (finding_type) per hour. Without this the
  -- first scheduled reconciliation run pages twice for a backlog that is
  -- already known and already being worked (audit §6.4, §8.4).
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_alerts_sent
    WHERE finding_type = NEW.finding_type AND sent_at > now() - INTERVAL '1 hour'
  ) THEN
    RETURN NULL;
  END IF;

  v_recipients := public.fn_admin_recipient_ids();
  IF array_length(v_recipients, 1) IS NULL THEN
    RAISE WARNING 'critical finding % has no admin recipient', NEW.finding_type;
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    to_jsonb(v_recipients),
    'Critical reconciliation finding',
    NEW.finding_type || ' — ' || COALESCE(NEW.details->>'transaction_id', NEW.user_id::text, 'see details'),
    jsonb_build_object('kind', 'reconciliation_alert',
                       'finding_id', NEW.id,
                       'finding_type', NEW.finding_type,
                       'details', NEW.details)
  );

  INSERT INTO public.reconciliation_alerts_sent (finding_type, finding_id, sent_at)
  VALUES (NEW.finding_type, NEW.id, now());
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An alerting failure must never roll back the finding itself. A finding
  -- that vanishes is worse than one that arrives silently.
  RAISE WARNING 'fn_alert_on_critical_finding failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_reconciliation_findings_critical_alert
  AFTER INSERT ON public.reconciliation_findings
  FOR EACH ROW WHEN (NEW.severity = 'critical')
  EXECUTE FUNCTION public.fn_alert_on_critical_finding();
```

Three properties worth stating explicitly:

- **`AFTER … FOR EACH ROW WHEN (…)`** means the predicate is evaluated by Postgres, not inside
  the function — no per-row function call for the ~940 non-critical findings.
- **The exception handler is load-bearing.** Section 6.4 of the audit records a prior incident
  where findings were silently discarded for weeks because an error was logged and swallowed. The
  handler here fails in the *opposite* direction: the finding always commits.
- **It fires on the DB-function findings *and* the Edge Function findings**, because both insert
  into the same table. No caller changes needed.

### 3.4 Scope — real-time for `critical`, daily digest for the rest

The trigger fires on `severity = 'critical'` only. That is:

- **Covered:** `balance_drift`, `negative_or_inconsistent_balance`, `stuck_pending_withdrawal`,
  `duplicate_idempotency_key`, `multiple_pending_withdrawals`, `duplicate_transfer_id`,
  `orphan_stripe_payout`, `amount_mismatch`, `status_mismatch`, `transfer_fully_reversed`,
  `orphan_ledger_withdrawal`, `completed_withdrawal_without_payout(_total)`,
  `reconciliation_run_failed`.
- **NOT covered by real-time alerts:** the 416 `platform_balance_drift` (`warning`) and 524
  `connect_account_balance_drift` (470 `info` + 54 `warning`).

> ✅ **RESOLVED 2026-08-24 (review).** Do **not** promote the 940 to `critical`. Balance-drift
> findings routinely reflect ordinary Stripe settlement-timing lag rather than a defect, so
> paging on them would reproduce the alert-fatigue failure this ADR flags for the 27-row
> backlog — at thirty times the scale. Instead: **keep real-time alerts scoped to `critical`,
> and add a scheduled daily digest covering any `warning`/`info` finding still unresolved after
> 48 hours.**
>
> The 48-hour threshold is what makes the digest a signal rather than a second firehose: *a
> drift that clears on its own is noise; one that persists is the finding.* Today's 940 rows are
> mostly stale (`platform_balance_drift` last wrote 2026-08-08) and would all appear on digest
> #1 — so the first run needs the same one-off suppression as §3.5, or an explicit
> acknowledge-the-backlog pass before enabling it.

```sql
-- Daily at 09:45 UTC, after both reconciliation jobs have run.
CREATE OR REPLACE FUNCTION public.fn_digest_unresolved_findings()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows jsonb;
  v_total int;
BEGIN
  SELECT jsonb_agg(t), COALESCE(sum(t.n), 0) INTO v_rows, v_total
  FROM (
    SELECT finding_type, severity, count(*) AS n, min(run_at) AS oldest
    FROM public.reconciliation_findings
    WHERE acknowledged_at IS NULL
      AND severity IN ('warning', 'info')
      AND run_at < now() - INTERVAL '48 hours'
    GROUP BY finding_type, severity
  ) t;

  IF v_total = 0 THEN RETURN; END IF;   -- silence is the healthy state

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    to_jsonb(public.fn_admin_recipient_ids()),
    'Reconciliation digest',
    v_total || ' unresolved findings older than 48h',
    jsonb_build_object('kind', 'reconciliation_digest', 'breakdown', v_rows)
  );
END;
$$;
```

Note `IF v_total = 0 THEN RETURN` — a digest that arrives every day regardless of content trains
people to ignore it. It should only appear when there is something to say.

### 3.5 The dependency nobody should skip

Alerting on a job that does not run is theatre. **Audit NEW-2 must be fixed in the same PR**:

```sql
SELECT cron.schedule(
  'payment-reconciliation-invariant-sweep', '30 9 * * *',
  $$SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/reconciliation',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliation_cron_secret')),
      timeout_milliseconds := 55000)$$
);
```

Offset 30 minutes after job 5 so the two do not contend. **Do not enable this before the
coalescing table in §3.3 exists** — the first run will re-detect 25 + 2 known findings at once.

---

## 4. Decision B — the Connect-onboarding gate

### 4.1 Where acceptance is recorded

`bounties.accepted_by` has exactly one authoritative writer:
`fn_accept_bounty_request()`
([20260421_fix_fn_accept_bounty_request.sql:69](../../supabase/migrations/20260421_fix_fn_accept_bounty_request.sql#L69)),
reached only through the `accept-bounty-request` Edge Function
([index.ts](../../supabase/functions/accept-bounty-request/index.ts)), whose callers are
[hooks/useAcceptRequest.ts:96](../../hooks/useAcceptRequest.ts#L96),
[lib/utils/data-utils.ts:189](../../lib/utils/data-utils.ts#L189) and
[components/notifications/notification-action-sheet.tsx:77](../../components/notifications/notification-action-sheet.tsx#L77) —
all via `bountyRequestService.acceptRequest`. One chokepoint. Good.

**Release**, by contrast, has **three** entry points, and any app-layer gate must cover all
three or it is decorative:

| # | Path | Reachable by |
|---|---|---|
| 1 | `POST /wallet/release` ([wallet/index.ts:558](../../supabase/functions/wallet/index.ts#L558)) | normal v1 completion |
| 2 | `POST /bounty-payments/release` ([bounty-payments/index.ts:431](../../supabase/functions/bounty-payments/index.ts#L431)) | v2 — **already gated** ([:517-540](../../supabase/functions/bounty-payments/index.ts#L517-L540)) |
| 3 | `fn_release_wallet_escrow_for_dispute()` (PL/pgSQL, `SECURITY DEFINER`) | dispute resolved for hunter — **ungated, and unreachable by any TypeScript change** |

### 4.2 The options

| | Behaviour | Hunter learns… | Cost |
|---|---|---|---|
| **B1** | Block acceptance until `payouts_enabled` | before starting work | 313/315 hunters cannot accept anything. Launch-blocking. |
| **B2** | Block release until `payouts_enabled` | after finishing work | Poster's escrow is stranded; hunter has done work and has nothing. Turns a silent problem into a stuck bounty. |
| **B3** ✅ | **Warn at accept, block only where a Stripe object is genuinely required (v2 + withdrawal), label honestly everywhere else** | at accept, non-blocking | Requires the §2 labelling to be truthful, or it is just a dismissible dialog. |

### 4.3 Recommendation — B3, with the reasoning stated plainly

A v1 release to a non-onboarded hunter is **not** a loss of funds. The $73.60 sits in their
balance and becomes withdrawable the moment they finish Connect onboarding. The failure is
informational: nobody told them, and the UI implied there was nothing to do.

B2 fixes the wrong half. Blocking the release leaves the poster's $80 in escrow, the bounty
unable to complete, and the hunter unpaid for finished work — a worse outcome than an
unspendable balance, and one that requires human intervention to unwind. It is the right control
for v2 (where the Transfer *cannot* be created and the money is genuinely stuck at the platform)
and the wrong one for v1.

**Proposed shape:**

1. **Accept time — informational, non-blocking.** `accept-bounty-request` returns the hunter's
   payout readiness alongside its success payload; the client shows a one-time sheet linking to
   [app/wallet/connect/embedded-onboarding.tsx](../../app/wallet/connect/embedded-onboarding.tsx).
   Enqueue the existing `stripe_connect_onboarding` moment.
2. **Release time (v1) — allow, label, notify.** The release proceeds and is recorded
   `ledger_only`. The hunter gets a notification: *"$73.60 added to your Bounty balance. Set up
   payouts to move it to your bank."* The poster sees "Credited to", not "Paid to".
3. **Release time (v2) — hard block.** Already built; keep as is.
4. **Withdrawal — tighten.** [connect/index.ts:3067-3075](../../supabase/functions/connect/index.ts#L3067-L3075)
   currently gates on `stripe_connect_onboarded_at`, which is set once and **never cleared**, so
   a since-restricted hunter passes. Change to `stripe_connect_payouts_enabled`, the
   webhook-synced field.
5. **Dispute release (path 3) — same treatment as path 1**, implemented in PL/pgSQL since no TS
   change can reach it.

```diff
--- a/supabase/functions/accept-bounty-request/index.ts
+++ b/supabase/functions/accept-bounty-request/index.ts
   const data = await rpcResp.json().catch(() => null);
-  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
+
+  // Payout readiness travels with the acceptance so the client can prompt the
+  // hunter to finish Connect onboarding *before* they start work. Advisory
+  // only — it never blocks the accept (ADR 0001 §4.3). A lookup failure must
+  // not fail an otherwise-successful acceptance.
+  let hunterPayoutReady: boolean | null = null;
+  try {
+    const hunterId = data?.hunter_id;
+    if (hunterId) {
+      const r = await fetch(
+        `${baseUrl}/rest/v1/profiles?id=eq.${hunterId}&select=stripe_connect_payouts_enabled`,
+        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
+      );
+      hunterPayoutReady = (await r.json())?.[0]?.stripe_connect_payouts_enabled === true;
+    }
+  } catch { /* advisory only */ }
+
+  return new Response(
+    JSON.stringify({ success: true, data, hunterPayoutReady }),
+    { status: 200 }
+  );
```

> ✅ **RESOLVED 2026-08-24 (review) — B3 approved as written.** Confirmed reasoning: blocking a
> v1 release strands the poster's escrow and pays the hunter nothing for completed work, over a
> payout-eligibility gap that self-resolves the moment they onboard — a worse failure than the
> one it fixes. Implement all five sub-items above, including the dispute-path parity change and
> the withdrawal gate moving from `stripe_connect_onboarded_at` to `stripe_connect_payouts_enabled`.

---

## 5. Decision D — rollout and the v1 sunset

### 5.1 Why nothing in flight breaks

Release/refund routing already reads **each bounty's own** `payment_architecture_version` via
`isPhase2Bounty()` ([lib/utils/payment-architecture.ts](../../lib/utils/payment-architecture.ts)),
never the global flag. Every change proposed here is additive:

- `settlement_state` is derived, defaulted, and backfilled — no writer changes semantics.
- The `CHECK` is satisfiable by every existing row without exemption (§2.4).
- The alert trigger is `AFTER INSERT` and swallows its own errors.
- B3 blocks nothing that is not already blocked.

The one behaviour change that can reject a write is the `force_retry` fix — which is the point,
and it affects exactly **1** row today.

### 5.2 Stages

| Stage | Contents | Reversible? | Gate to advance |
|---|---|---|---|
| **0** | Fix audit NEW-1 (`force_retry`). Standalone, no dependencies. | yes | reviewed |
| **1** | `settlement_state` type, column, trigger, backfill, CHECK. Read-only for consumers. | yes (drop column) | backfill classifies 20 releases `ledger_only`, 2 withdrawals `stripe_settled`, 25 `ledger_only` |
| **2** | `describeSettlement()` + API/UI adoption. **User-visible.** | yes (revert client) | screenshot review of wallet, transaction detail, payout history |
| **3** | Coalescing table + critical-finding trigger + **schedule the reconciliation sweep** (§3.5). Ship together. | yes (unschedule) | one full cycle with no alert storm |
| **4** | B3: accept-time advisory, v1 release notification, withdrawal gate → `payouts_enabled`, dispute-path parity. | yes | payout-ready conversion measurable |
| **5** | v1 sunset — see §5.3. | no | §5.3 preconditions |

Stages 0–3 are pure hardening and could ship in one week. Stage 4 is product-facing.

### 5.3 Sunsetting v1

**v1 cannot be sunset on a date. It can only be sunset on preconditions**, and the honest
statement today is that the two thresholds in
[V2_FUNDING_MIGRATION_SCOPE.md §5](../payments/V2_FUNDING_MIGRATION_SCOPE.md) — 15 funded
posts/week, or $500 platform balance — are **the wrong triggers for this ADR's concern**. They
measure whether v2 is *worth building*. The relevant question here is whether v2 is *safe to
switch to*, which is a different set of gates:

| Precondition | Today | Why it blocks |
|---|---|---|
| Withdrawal rewrite (`CONNECT_NATIVE_PAYOUT_ARCHITECTURE` Phases 2–6) shipped | not shipped | a v2-paid hunter would see `$0` in a UI reading `profiles.balance` — documented there as risk R2 |
| In-flow card linking at post time | not built | [V2_FUNDING_MIGRATION_SCOPE §1](../payments/V2_FUNDING_MIGRATION_SCOPE.md) |
| Payout-ready hunter population | **2 / 315** | under v2 every release *hard-fails* for the other 313 — v2 converts v1's silent problem into a loud one, which is better only once hunters can actually onboard |
| Reconciliation sweep scheduled + alerting live | no (NEW-2) | flipping architectures blind |
| Legacy balances drained | $-- (see [RECONCILIATION_AND_LEGACY_RETIREMENT](../payments/RECONCILIATION_AND_LEGACY_RETIREMENT.md) §3.3) | Stage A/B/C has its own blocker |

**Proposed sequencing** (weeks are *after preconditions are met*, not from today):

- **T+0** Stages 0–3 above.
- **T+2w** Stage 4; begin measuring payout-ready conversion.
- **Gate:** payout-ready ≥ 60% of hunters who accept a bounty, sustained 2 weeks.
- **T+?** `PAYMENT_ARCHITECTURE_VERSION=2` for **new** bounties only. v1 bounties keep releasing
  via v1 — guaranteed by `isPhase2Bounty()`.
- **T+? +90d** v1 release path becomes read-only once the last v1 bounty terminates. Retain the
  v1 ledger rows permanently; `settlement_state='ledger_only'` keeps them honest forever.

**Recommendation:** do not commit to a sunset date. Commit to the gate. The audit found three
separate cases where "applied"/"scheduled"/"deployed" was believed true and was not; a date on a
sunset would be a fourth.

> ✅ **RESOLVED 2026-08-24 (review) — gate, not date, approved.**

---

## 6. Migrations required

| # | File (proposed) | Contents | Risk |
|---|---|---|---|
| 0b | `2026MMDD_add_stripe_payout_status_column.sql` | `ALTER TABLE wallet_transactions ADD COLUMN stripe_payout_status text CHECK (…)` (§2.3). **Must precede #2** — the trigger reads it. Webhook handlers in `webhooks/index.ts` must be updated to write it. | low |
| 1 | `2026MMDD_add_settlement_state_enum_and_column.sql` | `CREATE TYPE settlement_state_enum`; `ALTER TABLE wallet_transactions ADD COLUMN settlement_state … NOT NULL DEFAULT 'ledger_only'` | low — table is ~60 rows |
| 2 | `2026MMDD_derive_settlement_state_trigger.sql` | `fn_derive_settlement_state()` + `BEFORE INSERT OR UPDATE` trigger | low |
| 3 | `2026MMDD_backfill_settlement_state.sql` | one `UPDATE` re-deriving every existing row; **must run after 2, so the trigger and backfill agree** | low, but verify counts (§5.2 gate) |
| 4 | `2026MMDD_settlement_state_requires_evidence_check.sql` | the `CHECK` in §2.4, added `VALID` | low — satisfiable by all rows |
| 5 | `2026MMDD_add_settlement_state_to_bounty_payments.sql` | same column on `bounty_payments`, derived from `status` (§2.6) | low — 4 rows |
| 6 | `2026MMDD_reconciliation_alerts_sent.sql` | coalescing table + index + RLS (service-role only) | low |
| 7 | `2026MMDD_fn_admin_recipient_ids.sql` | recipient resolver reading `auth.users.raw_app_meta_data` (§3.2) | low |
| 8 | `2026MMDD_alert_on_critical_finding_trigger.sql` | `fn_alert_on_critical_finding()` + `AFTER INSERT … WHEN` trigger | **medium** — writes to `notifications_outbox`; verify no push storm |
| 9 | `2026MMDD_schedule_reconciliation_invariant_sweep.sql` | `cron.schedule` for the `reconciliation` Edge Function (§3.5, audit NEW-2) | **medium** — ship with 6 + 8, never alone |
| 10 | `2026MMDD_allow_failed_to_pending_admin_reopen.sql` | explicit, audited `failed → pending` transition for `force_retry` (§2.8) | medium — loosens a terminal state; must be admin-only and logged |
| 11 | `2026MMDD_unresolved_findings_daily_digest.sql` | `fn_digest_unresolved_findings()` + `cron.schedule` at 09:45 UTC (§3.4) | **medium** — first run covers today's 940-row backlog unless suppressed or acknowledged first |

Edge Function redeploys: `wallet`, `admin-withdrawals`, `accept-bounty-request`, `reconciliation`
(new cron target). **Per [docs deploy history], verify each with `get_edge_function` after
deploying — `git push` does not reliably redeploy.**

No migration is required for Decision B beyond #10; B3 is application-layer plus the dispute-path
parity change, which is a function replacement rather than a schema change.

---

## 7. Consequences

### 7.1 Positive

- The 25 historical rows become expressible as a predicate rather than a date range (§2.5).
- The dispute release path is covered without any TypeScript reaching it (§2.3).
- Critical findings reach a human in under a minute, on infrastructure that already exists.
- The reconciliation sweep actually runs.
- `force_retry` stops being able to recreate the incident.

### 7.2 Negative / accepted costs

- **A third status concept.** `wallet_transactions` will carry `status`, `dispute_status` and
  `settlement_state`. Justified because `status` answers *"is our ledger done with this row"*
  and `settlement_state` answers *"did money actually move"* — the whole audit is the story of
  those two being conflated. Worth a comment on the column saying exactly this.
- **The alert trigger adds work to a money-path transaction.** Mitigated by `WHEN`, the
  coalescing check, and the exception handler.
- **B3 does not stop unwithdrawable balances**, it only stops lying about them. That is the
  deliberate trade in §4.3 and should be re-examined once payout-ready conversion is known.
- **The 940 drift findings stay silent** (§3.4).

### 7.3 Follow-on work this ADR does *not* cover

- A lint rule (`no-settlement-vocabulary-without-state`) forbidding the literals `Paid`,
  `Settled`, `Sent to your bank` in `components/` and `app/` outside `describeSettlement()`.
  Without it §2.7 decays.
- The orphaned escrow `bba5e784…` (audit §7.5, NEW-3) — refund the poster $1.00. Ledger-only, no
  Stripe lookup needed. Phase 5.
- A settlement guard on the admin bounty screen
  ([app/(admin)/bounty/[id].tsx:150](../../app/%28admin%29/bounty/%5Bid%5D.tsx#L150)), which
  audit NEW-3 shows can mark a bounty completed with an unsettled escrow. Not covered by
  Decision B, which addresses release paths rather than status writes.
- Phase 5 historical remediation — Stripe object lookups now available via the reviewer's
  authorized connector.

---

## 8. Reviewer decisions — all resolved 2026-08-24

| # | Question | Decision |
|---|---|---|
| 1 | §2.3 — trust `status`, or require Stripe evidence? | **Evidence only, never `status`.** New `stripe_payout_status` column recorded by the payout webhooks; 25 rows correctly classify as `ledger_only`; 2 rows conservatively `stripe_pending` pending the Phase 5 lookup. |
| 2 | §4.2 — B1, B2 or B3? | **B3**, as written, all five sub-items. |
| 3 | §3.2 — alert recipients | Resolver correct; both accounts live. **Open:** whether `jordanmag11@yahoo.com` should be on payment-critical call. Roster provisional, implementation unaffected. |
| 4 | §3.4 — promote the 940 drift findings? | **No.** Real-time stays `critical`-only; add a **daily digest of `warning`/`info` findings unresolved > 48h**. |
| 5 | §5.3 — sunset timing | **Gate, not date.** |
| 6 | "Walk my cat" user-facing correction | **Still open** — approval-checklist item 5, below. |

### 8.1 The one still open

Does "Walk my cat" need a direct user-facing correction, or is the Stage 2 relabel enough?

Stage 2 silently changes what both parties see — the poster's "Paid to" becomes "Credited to",
and the hunter's row gains *"Set up payouts to move it to your bank."* That may be sufficient
and is certainly less alarming than an unprompted message about a payment problem.

My inclination remains a direct message to the hunter. They are owed **$73.60** they currently
cannot reach, they have no Connect account, and nothing in the relabel tells them *why* it now
says something different or that action on their part unlocks the money. A relabel explains the
state; it does not prompt the fix.

---

**Stop point.** Per the Phase 2 instruction, no code has been written. Decisions 1–5 are settled,
so **Phase 3 is unblocked.** Item 6 does not gate implementation — it is an outreach decision that
can be made in parallel.

### 8.2 Scope added since the first draft

Phase 3 should now also carry, from audit §7.5 (NEW-3):

- the orphaned-escrow refund for `bba5e784…` (Phase 5 remediation item), and
- a settlement guard on the admin bounty-status write, which NEW-3 shows is a demonstrated rather
  than theoretical defect (§7.3).
