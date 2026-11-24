// Server-side payout outcome events (PostHog audit 2026-11-23).
//
//   payout_completed  webhooks `payout.paid`, once the matched withdrawal row
//                     is `completed` (bounty_events payout.completed)
//   payout_failed     webhooks `payout.failed` / `payout.canceled` /
//                     `payout.closed`, only when that delivery moved the
//                     withdrawal row to failed (bounty_events payout.failed)
//
// The app's payout_initiated / payout_success / payout_failed are a tap and an
// API acceptance, not a payout. Dashboards count payouts from these events
// only: `source = 'stripe_webhook'` (docs/analytics/EVENT_TAXONOMY_CUTOVER.md).
//
// Same rules as signup-completed-event.ts and web-marketplace-events.ts:
// distinct_id is the hunter's Supabase user id; the uuid is fixed per
// (event, Stripe payout), so a redelivered webhook is deduplicated by PostHog
// instead of counted twice; the timestamp is fixed too, because PostHog only
// merges duplicates that share the uuid AND the day. Ids, amounts and enums
// only: no account number, no bank name or last4, no failure_message.
//
// Pure module (no Deno APIs) so jest can pin the payloads and the gates.

import { deterministicEventUuid, type ServerEvent } from './web-marketplace-events.ts'

export const PAYOUT_EVENT_SOURCE = 'stripe_webhook'

export type PayoutArchitecture = 'connect_native' | 'legacy_transfer'

/** The Stripe Payout fields these events read. */
export interface PayoutLike {
  id: string
  amount?: number | null
  currency?: string | null
  method?: string | null
  failure_code?: string | null
}

/** The matched wallet_transactions withdrawal row. */
export interface WithdrawalRowLike {
  id: string
  amount?: unknown
  status?: string | null
  payout_method?: string | null
  completed_at?: string | null
  metadata?: Record<string, unknown> | null
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Stripe `event.created` is in seconds.
    return new Date(value * 1000).toISOString()
  }
  if (typeof value !== 'string' || !value) return undefined
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

/** The ledger amount, which is what bounty_events.amount records (ABS). */
function ledgerAmount(row: WithdrawalRowLike, payout: PayoutLike): number | null {
  const n = Number(row.amount)
  if (row.amount != null && Number.isFinite(n)) return Math.abs(n)
  return typeof payout.amount === 'number' ? payout.amount / 100 : null
}

function payoutMethod(payout: PayoutLike, row: WithdrawalRowLike): 'standard' | 'instant' | null {
  const m = payout.method ?? row.payout_method ?? null
  return m === 'instant' || m === 'standard' ? m : null
}

export function payoutArchitecture(row: WithdrawalRowLike): PayoutArchitecture {
  return row.metadata?.connect_native === true ? 'connect_native' : 'legacy_transfer'
}

function baseProperties(payout: PayoutLike, row: WithdrawalRowLike) {
  return {
    role: 'hunter',
    amount: ledgerAmount(row, payout),
    currency: (payout.currency ?? 'usd').toLowerCase(),
    method: payoutMethod(payout, row),
    payout_architecture: payoutArchitecture(row),
    // Stripe object id and our ledger row id: the keys the reconciliation
    // query joins on (bounty_events.correlation_id / metadata.transaction_id).
    stripe_payout_id: payout.id,
    transaction_id: row.id,
    platform: 'server',
    source: PAYOUT_EVENT_SOURCE,
  }
}

/**
 * null unless the withdrawal row is `completed` after this delivery: either
 * this call's compare-and-set promoted it, or another writer had already
 * completed it (that writer sends no event, so this is the row's only one).
 * The timestamp is the row's completed_at, so every redelivery produces the
 * identical event and PostHog keeps one.
 */
export async function buildPayoutCompletedEvent(args: {
  userId: string | null | undefined
  payout: PayoutLike
  row: WithdrawalRowLike | null | undefined
}): Promise<ServerEvent | null> {
  const { userId, payout, row } = args
  if (!userId || !payout?.id || !row?.id || row.status !== 'completed') return null
  return {
    event: 'payout_completed',
    distinct_id: userId,
    uuid: await deterministicEventUuid(`payout_completed:${payout.id}`),
    timestamp: isoOrUndefined(row.completed_at),
    properties: {
      ...baseProperties(payout, row),
      failure_code: null,
    },
  }
}

/**
 * null unless this delivery itself moved the row to failed (the CAS update
 * returned the row, or fail_legacy_withdrawal reported `refunded: true`). A
 * duplicate delivery, an unmatched (foreign) payout and a row that was already
 * terminal send nothing. Keyed on the event name, not Stripe's event type, so
 * payout.failed followed by payout.closed for the same payout cannot make two.
 */
export async function buildPayoutFailedEvent(args: {
  userId: string | null | undefined
  payout: PayoutLike
  row: WithdrawalRowLike | null | undefined
  outcome: 'failed' | 'canceled'
  failedByThisCall: boolean
  /** Stripe `event.created` (seconds); fixed across redeliveries. */
  stripeEventCreated?: number | null
}): Promise<ServerEvent | null> {
  const { userId, payout, row, outcome, failedByThisCall, stripeEventCreated } = args
  if (!failedByThisCall || !userId || !payout?.id || !row?.id) return null
  return {
    event: 'payout_failed',
    distinct_id: userId,
    uuid: await deterministicEventUuid(`payout_failed:${payout.id}`),
    timestamp: isoOrUndefined(stripeEventCreated ?? undefined),
    properties: {
      ...baseProperties(payout, row),
      outcome,
      // Stripe's own code; null for most cancellations.
      failure_code: payout.failure_code ?? null,
    },
  }
}

/**
 * Builds and sends; never throws. Analytics must not change whether the
 * webhook returns 200 (a throw here would make Stripe redeliver a payout
 * event whose ledger work already succeeded).
 */
export async function sendPayoutEvent(
  build: () => Promise<ServerEvent | null>,
  send: (event: ServerEvent) => void
): Promise<'sent' | 'skipped' | 'error'> {
  try {
    const event = await build()
    if (!event) return 'skipped'
    send(event)
    return 'sent'
  } catch (err) {
    console.warn('[payout-events] not sent', { err: String(err) })
    return 'error'
  }
}
