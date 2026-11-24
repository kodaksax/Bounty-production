-- Payout reconciliation: bounty_events ledger rows ↔ PostHog server events.
-- See EVENT_TAXONOMY_CUTOVER.md, "Server-side payout events — 2026-11-24".
--
-- Step 1: run this in Supabase (project xwlwqzzphmmhghiqvkeu, read-only).
--         Set `since` to the webhooks deploy time (UTC).
-- Step 2: paste `hogql_per_ledger_row` into PostHog SQL (project 461576).
--         Pass: every row has posthog_events = 1 AND same_user_and_amount = 1.
-- Step 3: paste `hogql_events_without_ledger_row` into PostHog SQL.
--         Pass: no rows (no server payout event without a ledger row).
--
-- Scope: only ledger rows whose withdrawal has a Stripe payout (`po_…`). A
-- withdrawal that failed before Stripe created a payout (e.g. 2026-11-13,
-- platform balance_insufficient at transfer_create) and transfer.failed /
-- transfer.reversed rows (`tr_…`) never reach a payout webhook, so they have no
-- payout_failed by design. Step 4 lists them so they are seen, not lost.
--
-- Counts are distinct uuids: PostHog merges a resent duplicate in the
-- background, so raw rows can briefly read 2 for one payout.

with params as (select timestamptz '2026-11-25 00:00:00+00' as since),  -- <- deploy time
ledger as (
  select
    case e.event_type when 'payout.completed' then 'payout_completed' else 'payout_failed' end as ph_event,
    e.metadata->>'transaction_id' as transaction_id,
    e.actor_id::text as user_id,
    e.amount::numeric(14,2) as amount,
    e.correlation_id as stripe_payout_id
  from public.bounty_events e, params p
  where e.event_type in ('payout.completed', 'payout.failed')
    and e.occurred_at >= p.since
    and e.correlation_id like 'po\_%'
),
lit as (
  select count(*) as ledger_rows,
    coalesce(string_agg(format('(%L, %L, %L, %s, %L)', ph_event, transaction_id, user_id, amount, stripe_payout_id), ', '), '') as tuples,
    coalesce(string_agg(format('(%L, %L)', ph_event, transaction_id), ', '), '') as keys,
    (select to_char(since at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from params) as since
  from ledger
)
select ledger_rows,
  case when ledger_rows = 0 then '-- no ledger rows since deploy; nothing to match' else
  'SELECT x.l.1 AS ph_event, x.l.2 AS transaction_id, x.l.3 AS user_id, x.l.4 AS ledger_amount, x.l.5 AS stripe_payout_id, '
  || 'uniqIf(e.uuid, e.event != '''') AS posthog_events, '
  || 'uniqIf(e.uuid, e.event != '''' AND e.distinct_id = x.l.3 AND round(toFloat(e.amount), 2) = x.l.4) AS same_user_and_amount '
  || 'FROM (SELECT arrayJoin([' || tuples || ']) AS l) AS x '
  || 'LEFT JOIN (SELECT uuid, event, distinct_id, properties.transaction_id AS transaction_id, properties.amount AS amount FROM events '
  || 'WHERE event IN (''payout_completed'', ''payout_failed'') AND properties.source = ''stripe_webhook'' AND timestamp >= ''' || since || ''') AS e '
  || 'ON e.event = x.l.1 AND e.transaction_id = x.l.2 '
  || 'GROUP BY ph_event, transaction_id, user_id, ledger_amount, stripe_payout_id ORDER BY posthog_events, ph_event'
  end as hogql_per_ledger_row,
  'SELECT event, properties.transaction_id AS transaction_id, properties.stripe_payout_id AS stripe_payout_id, distinct_id, uniq(uuid) AS events '
  || 'FROM events WHERE event IN (''payout_completed'', ''payout_failed'') AND properties.source = ''stripe_webhook'' AND timestamp >= ''' || since || ''' '
  || 'AND (event, toString(properties.transaction_id)) NOT IN (SELECT arrayJoin([' || case when keys = '' then '(''_'', ''_'')' else keys end || '])) '
  || 'GROUP BY event, transaction_id, stripe_payout_id, distinct_id' as hogql_events_without_ledger_row
from lit;

-- Step 4 (Supabase): ledger payout rows with no Stripe payout. No server event
-- is expected; the client's payout_failed (code platform_balance_insufficient
-- etc.) is the only PostHog trace.
-- select e.event_type, e.metadata->>'transaction_id' as transaction_id, e.actor_id, e.amount,
--        e.correlation_id, e.occurred_at
-- from public.bounty_events e
-- where e.event_type in ('payout.completed', 'payout.failed')
--   and e.occurred_at >= timestamptz '2026-11-25 00:00:00+00'
--   and (e.correlation_id is null or e.correlation_id not like 'po\_%')
-- order by e.occurred_at;
