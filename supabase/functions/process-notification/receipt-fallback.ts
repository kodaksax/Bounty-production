// Expo push RECEIPTS -> email fallback (2026-11-06).
//
// Background: a push "ticket" only says Expo accepted the message. Whether
// APNs/FCM could actually hand it to a device comes back later as a RECEIPT
// (fetched with POST /push/getReceipts, available ~15 minutes after the send
// and kept for 24 hours). Before this, nothing in supabase/ read receipts, so
// a poster who had uninstalled the app (DeviceNotRegistered), or whose device
// FCM/APNs rejected, counted as "sent": the ticket was ok, so the email
// fallback never fired and the poster never heard about the applicant.
//
// Pure and dependency-free so the rules are unit-tested; index.ts does the I/O.
// Imported directly by index.ts (the CLI bundler resolves relative imports, as
// it already does for ./email-fallback.ts) -- do not re-inline it.

/** Expo documents receipts as available after ~15 minutes. */
export const RECEIPT_FIRST_CHECK_MINUTES = 15
/** A receipt Expo has not produced yet is asked for again this often. */
export const RECEIPT_RETRY_MINUTES = 10
/**
 * Stop asking after this long. Expo keeps receipts for 24h, but a receipt that
 * has not appeared hours after the send is not coming, and the poster has been
 * waiting that long already.
 */
export const RECEIPT_GIVE_UP_HOURS = 6
/** Expo accepts up to 1000 ids per getReceipts call; stay well under. */
export const RECEIPT_CHUNK_SIZE = 300
/** Tickets examined per invocation (the cron runs every 5 minutes). */
export const RECEIPT_BATCH_LIMIT = 600

export type ParsedReceipt =
  | { status: 'ok' }
  | { status: 'error'; code: string; message: string | null }

/**
 * Expo's getReceipts body is `{ data: { "<ticket id>": { status, message?,
 * details?: { error } } } }`. Ids it has no receipt for are simply absent.
 * Anything malformed is ignored, which leaves that ticket pending (and
 * retried) rather than misread as a failure.
 */
export function parseReceipts(body: unknown): Map<string, ParsedReceipt> {
  const out = new Map<string, ParsedReceipt>()
  const data = (body as { data?: unknown } | null)?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [ticketId, raw] of Object.entries(data as Record<string, unknown>)) {
    const r = raw as { status?: unknown; message?: unknown; details?: { error?: unknown } } | null
    if (!r || typeof r !== 'object') continue
    if (r.status === 'ok') {
      out.set(ticketId, { status: 'ok' })
    } else if (r.status === 'error') {
      const code = typeof r.details?.error === 'string' && r.details.error ? r.details.error : 'unknown'
      const message = typeof r.message === 'string' && r.message ? r.message.slice(0, 300) : null
      out.set(ticketId, { status: 'error', code, message })
    }
  }
  return out
}

export type TicketStatus = 'pending' | 'ok' | 'error' | 'expired'

export interface DueTicket {
  ticket_id: string
  status: TicketStatus
  created_at: string
  attempts: number
}

export type TicketUpdate =
  | { ticketId: string; status: 'ok' }
  | { ticketId: string; status: 'error'; code: string; message: string | null }
  | { ticketId: string; status: 'pending'; attempts: number; checkAfter: string }
  | { ticketId: string; status: 'expired'; attempts: number }

/**
 * What to record for each due ticket given the receipts Expo returned.
 * Missing receipt: retry later, or give up once the ticket is old enough.
 */
export function planTicketUpdates(
  tickets: DueTicket[],
  receipts: Map<string, ParsedReceipt>,
  now: Date
): TicketUpdate[] {
  return tickets.map((t): TicketUpdate => {
    const receipt = receipts.get(t.ticket_id)
    if (receipt?.status === 'ok') return { ticketId: t.ticket_id, status: 'ok' }
    if (receipt?.status === 'error') {
      return { ticketId: t.ticket_id, status: 'error', code: receipt.code, message: receipt.message }
    }
    const ageMs = now.getTime() - new Date(t.created_at).getTime()
    const attempts = (t.attempts ?? 0) + 1
    if (ageMs >= RECEIPT_GIVE_UP_HOURS * 3_600_000) {
      return { ticketId: t.ticket_id, status: 'expired', attempts }
    }
    return {
      ticketId: t.ticket_id,
      status: 'pending',
      attempts,
      checkAfter: new Date(now.getTime() + RECEIPT_RETRY_MINUTES * 60_000).toISOString(),
    }
  })
}

export type GroupVerdict = 'delivered' | 'failed' | 'wait' | 'unknown'

/**
 * One recipient can have several devices, hence several tickets for one
 * notification. They are judged together:
 *  - any receipt ok            -> delivered (one device got it; no email)
 *  - otherwise any still pending -> wait (another device may yet succeed)
 *  - otherwise any error        -> failed (no device got it; send the email)
 *  - otherwise (all expired)    -> unknown (we cannot tell; do not email)
 */
export function groupVerdict(statuses: TicketStatus[]): GroupVerdict {
  if (statuses.includes('ok')) return 'delivered'
  if (statuses.includes('pending')) return 'wait'
  if (statuses.includes('error')) return 'failed'
  return 'unknown'
}

/** Tokens whose receipt says the device is gone for good. Same rule as the
 * ticket path: only DeviceNotRegistered; credential errors never prune. */
export function tokensToPrune(
  updates: TicketUpdate[],
  tokenByTicket: Map<string, string>
): string[] {
  const out = new Set<string>()
  for (const u of updates) {
    if (u.status === 'error' && u.code === 'DeviceNotRegistered') {
      const token = tokenByTicket.get(u.ticketId)
      if (token) out.add(token)
    }
  }
  return [...out]
}

/** Stable key for "this recipient's devices for this notification". */
export function groupKey(outboxId: string, userId: string): string {
  return `${outboxId}:${userId}`
}

/**
 * Why the fallback email went out, in the vocabulary the rest of the pipeline
 * uses for push_failure_reason, with the Expo code kept separately.
 */
export const RECEIPT_FAILURE_REASON = 'push_receipt_error'
