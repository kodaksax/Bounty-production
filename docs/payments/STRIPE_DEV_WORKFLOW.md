# Stripe developer workflow (VS Code + Stripe CLI) — TEST MODE ONLY

How to inspect Stripe test API requests, forward webhook events, trigger test
events, debug the webhook handler with breakpoints, and reconcile Bounty's
payment records against Stripe — all from VS Code.

Everything here runs against **Stripe test mode** and the **staging** (or
development) Supabase project. The helper script refuses live keys and the
production Supabase project (`xwlwqzzphmmhghiqvkeu`). Verified 2026-11-04.

## Environments

| Env | Stripe account (test) | Supabase project | Keys from |
| --- | --- | --- | --- |
| staging (default) | `acct_1SCOhHQu3TJHRHBb` "Coal Spinner" | `gwumwpoomwvkjyibdmpj` | `.env.staging` |
| development | `acct_1TEzjpQp3LB9UccR` "BNTY-development" | `ajsbkocnixpwbrjokvnq` | `.env.development` |

The CLI's old `default` profile is the **production** Stripe account
(`acct_1PGppVJekUCspsfJ` — it matches the app's `pk_live_` key), and its login
expired 2026-05-24. A plain `stripe login` re-pairs *that* profile, i.e.
production. That is why the workspace pins the extension to its own
`bounty-staging` profile (below): day-to-day debugging never touches the
production account. Staging and development are separate Stripe accounts, not
the production account's test mode.

## One-time setup

1. **Extension** — install *Stripe for Visual Studio Code* (`stripe.vscode-stripe`,
   recommended in `.vscode/extensions.json`; v4.2.0 is installed on this machine).
2. **CLI** — `stripe version` must work (v1.50.1 installed; v1.55.8 available:
   `npm i -g @stripe/cli`). `stripe docs` needs CLI ≥ 1.50.9 *and* a login.
3. **Authenticate the extension's profile** (browser device flow — no keys in chat):

   ```sh
   stripe login --project-name bounty-staging
   ```

   Pick the **Coal Spinner** sandbox in the browser. `.vscode/settings.json`
   sets `"stripe.projectName": "bounty-staging"`, so the extension's Events,
   Logs, Webhooks and Trigger panes use exactly that account. Check with
   `stripe whoami --project-name bounty-staging`. Login keys expire after 90
   days; re-run the command when the extension reports an expired key.
4. **Helper script** — needs nothing beyond step 2: it reads the test key from
   the git-ignored `.env.staging`. `node scripts/stripe-dev.mjs whoami`.
5. **Local function runtime** — Deno ≥ 2 (`deno --version`). Docker is *not*
   required (it is not installed on this machine, so `supabase functions serve`
   is unavailable; the script runs the function under plain Deno instead).

## Daily commands

All of these are also VS Code tasks (*Terminal → Run Task → "Stripe: …"*), each
prompting for staging/development.

| What | Command |
| --- | --- |
| Which account / project am I on | `node scripts/stripe-dev.mjs whoami` |
| Webhook endpoints and the events they miss | `node scripts/stripe-dev.mjs endpoints` |
| Stream test API request logs | `node scripts/stripe-dev.mjs logs` (or extension → *Start streaming API logs*) |
| Stream test events (no forwarding) | `node scripts/stripe-dev.mjs listen` (or extension → *Start streaming events*) |
| Trigger a test event | `node scripts/stripe-dev.mjs trigger charge.dispute.created` |
| Resend an event to the deployed endpoint | `node scripts/stripe-dev.mjs cli events resend evt_… --webhook-endpoint=we_…` |
| Any CLI command with the test key | `node scripts/stripe-dev.mjs cli get /v1/payment_intents/pi_…` |
| Reconcile Stripe ↔ DB (read-only) | `node scripts/stripe-dev.mjs reconcile --days 30` |
| Payment test suites | task *Payments: run payment test suites* |

## Debugging the webhook handler locally

```sh
node scripts/stripe-dev.mjs serve-webhooks          # staging DB, staging Stripe test account
```

This:

1. gets the CLI listen session's signing secret (`stripe listen --print-secret`);
2. runs the **real** `supabase/functions/webhooks/index.ts` under Deno on
   `http://localhost:8000/webhooks`, with the staging DB credentials and *only*
   the listen secret configured — anything not signed by your CLI session gets 400;
3. runs `stripe listen --forward-to … --forward-connect-to …`, so **platform and
   Connect** events both reach the local handler.

Then trigger events in another terminal. With breakpoints: run the task
*Stripe: serve webhooks locally (wait for debugger)*, then the launch config
*Attach: local webhooks (Deno)*, set breakpoints in `webhooks/index.ts` or
`_shared/*.ts`, and trigger an event.

**Know this before relying on it.** The deployed staging function receives the
same events from the staging endpoint. `claim_stripe_event` guarantees exactly
one processor per event, so a given event is handled *either* locally *or* by
the deployed function — a local `Duplicate delivery ignored` means the deployed
one won. To force a fresh local run, trigger a new event (a resend of an
already-processed event is always a duplicate). The local function writes to
the **staging** database. A local run may rewrite
`supabase/functions/deno.lock` with cached esm.sh entries — don't commit that.

Verified end to end on 2026-11-04: an unsigned POST got 400 locally; a triggered
`charge.dispute.created` flow was forwarded (5 events): two were processed by
the local function and three were deduplicated against the deployed function.

## Things the CLI cannot do here

- `refund.failed`, `charge.dispute.closed` and Connect payout lifecycles are not
  `stripe trigger` fixtures. Use the API (e.g. a test card that disputes,
  `4000000000000259`) or the Dashboard.
- Connect events from a **connected** account need
  `stripe trigger --stripe-account acct_… <event>`.
- Neither test platform has a **Connect webhook endpoint**, so deployed staging
  and development never receive `account.updated` / `transfer.*` / `payout.*`
  from connected accounts. Only the local `serve-webhooks` path does
  (`--forward-connect-to`). See the audit report, finding F-6.

## Safety rules baked into the script

- Live keys (`sk_live_`, `rk_live_`) → exit 2. Production Supabase → exit 2.
- Secrets travel in child-process environment variables (`STRIPE_API_KEY`),
  never on a command line, and are never printed.
- `reconcile` only reads. It never repairs a discrepancy.
