# Wallet posting fee + purchase summary — prod rollout

Brings prod (`xwlwqzzphmmhghiqvkeu`) to the same posting behaviour as staging
(`gwumwpoomwvkjyibdmpj`): posters pay the bounty reward **plus a $1 posting
fee** from their wallet when they post, and see a Purchase summary (subtotal,
posting fee, total, card on file) before the bounty is created.

Nothing here has been applied to prod. Run it after PR #855 is merged, in the
order below.

## What staging has that prod does not (checked 2026-09-30)

| Object | Staging | Prod |
|---|---|---|
| `bounties.posting_checkout_attempt_id`, `bounty_posting_checkouts`, `fn_consume_posting_checkout` | yes | **no** |
| `wallet_tx_type_enum` value `posting_fee` | yes | no |
| `payment_experiment_config.wallet_posting_fee`, `fn_get_wallet_posting_fee()` | yes (1.00) | no |
| Fee branch in `fn_reserve_bounty_escrow`, `posting_fee` leg in `fn_ledger_upsert_from_wallet_transaction` | yes | no |
| `deferred_funding_enabled` | **false** | true |

Prod's live `fn_reserve_bounty_escrow`, `fn_ledger_upsert_from_wallet_transaction`
and `fn_bounties_normalize_funding_mode` were diffed against the migration
bodies below. Apart from what the migrations add, they are identical, so
applying them does not revert anything that is live on prod.

## Order matters

1. **Schema migrations (steps 1–3).** They change nothing yet: the fee
   defaults to 0 and deferral stays on. Safe to apply before or after the OTA.
2. **OTA** the merged `main` to production.
3. **Edge functions** `wallet` and `webhooks`, so fee rows get their label.
4. **Config (step 5)** turns the behaviour on. Do this last: an older build
   checks the balance against the reward only, so with the fee on it lets a
   poster who is exactly $1 short tap Post, and the server then refuses the
   insert.

## 1. `20260921120000_posting_checkout_service_fee.sql` (required first)

`fn_reserve_bounty_escrow` from step 3 reads `NEW.posting_checkout_attempt_id`.
PL/pgSQL only resolves that field when the trigger runs, so if this migration
is skipped, step 3 still applies cleanly and then **every funded bounty insert
on prod fails**.

Apply it with the Supabase MCP `apply_migration` tool (project
`xwlwqzzphmmhghiqvkeu`, name `posting_checkout_service_fee`, the file's full
contents), or with psql:

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260921120000_posting_checkout_service_fee.sql
```

Do **not** use `supabase db push`: the local migration history does not match
what prod has recorded, and push would replay about 96 old migrations.

## 2. `20260929170000_wallet_tx_type_posting_fee.sql`

This one must run in its own transaction, separate from step 3. Postgres cannot
use a new enum value inside the transaction that added it.

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260929170000_wallet_tx_type_posting_fee.sql
```

## 3. `20260929170100_wallet_posting_fee.sql`

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260929170100_wallet_posting_fee.sql
```

### Verify steps 1–3

`apply_migration` has silently skipped a `CREATE OR REPLACE FUNCTION` in a
batch before, so check the function bodies themselves, not the migration
history:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bounties'
            AND column_name = 'posting_checkout_attempt_id')                     AS has_attempt_col,
  to_regclass('public.bounty_posting_checkouts') IS NOT NULL                    AS has_checkouts,
  EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'wallet_tx_type_enum' AND e.enumlabel = 'posting_fee') AS has_enum,
  pg_get_functiondef('public.fn_reserve_bounty_escrow()'::regprocedure)
    LIKE '%wallet_posting_fee%'                                                  AS escrow_has_fee,
  pg_get_functiondef('public.fn_ledger_upsert_from_wallet_transaction(wallet_transactions)'::regprocedure)
    LIKE '%posting_fee%'                                                         AS ledger_has_fee,
  pg_get_functiondef('public.fn_bounties_normalize_funding_mode()'::regprocedure)
    LIKE '%bounty_posting_checkouts%'                                            AS normalize_has_checkout,
  public.fn_get_wallet_posting_fee()                                             AS fee_now,  -- expect 0
  has_function_privilege('anon', 'public.fn_get_wallet_posting_fee()', 'EXECUTE') AS anon_exec; -- expect false
```

Every column should be `true`, except `fee_now` (expect `0`) and `anon_exec`
(expect `false`).

## 4. OTA and edge functions

- OTA: **Actions → EAS Update - Production → Run workflow** on `main` (see
  `docs/deployment/EAS_UPDATE_POLICY.md`). The client change is JS-only (the
  Purchase summary reuses `PaymentMethodsModal`, which is already in the
  binary), so no EAS build is needed.
- Edge functions (they are not part of the OTA):

  ```bash
  npx supabase functions deploy wallet webhooks --project-ref xwlwqzzphmmhghiqvkeu
  ```

  Without this, `posting_fee` rows in the wallet history show the generic
  "Recorded" label. Nothing breaks.

## 5. Turn it on (matches staging)

```sql
UPDATE public.payment_experiment_config
SET wallet_posting_fee = 1.00,
    deferred_funding_enabled = false,
    updated_at = now();
```

What this changes:

- **Pay-at-accept stops for new bounties.** Every new paid bounty is funded at
  post: reward + $1 is debited from the wallet, and a poster without that
  balance is sent to top up before the bounty is created. On 2026-09-30, 24
  open or in-progress prod bounties are `at_accept`. `funding_mode` is
  immutable, so those still charge at acceptance and pay no fee.
- **The fee applies only to funded-at-post bounties.** If you set only
  `wallet_posting_fee` and leave deferral on, deferred bounties skip the fee
  entirely.

## Rollback

Config only, instant, no deploy:

```sql
UPDATE public.payment_experiment_config
SET wallet_posting_fee = 0,
    deferred_funding_enabled = true,
    updated_at = now();
```

The schema from steps 1–3 is inert at `wallet_posting_fee = 0` and can stay.
Posting fees already charged are not refunded by this; they are
`posting_fee` rows in `wallet_transactions`.
