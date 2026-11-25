// Canonical marketplace events for steps that happen on the website, not in
// the app, so no client ever sends them (PostHog audit 2026-11-23):
//
//   bounty_published      web checkout created the bounty (webhooks, both
//                         Checkout modes) or the owner confirmed a held post
//                         (poster-web /held-posts/:id/confirm)
//   application_accepted  poster-web /requests/:id/accept
//   bounty_completed      poster-web /bounties/:id/confirm-completion, only
//                         when that call moved the bounty to completed
//
// Same rules as the server signup_completed (signup-completed-event.ts):
// distinct_id is the Supabase user id; the uuid is derived from the event name
// and the row id, so a retried send is deduplicated rather than counted twice;
// `source` names the function, so a dashboard can tell these from the app's
// own events of the same name. Ids, amounts and enums only: no email, no title,
// no free text.
//
// Pure module (no Deno APIs) so jest can pin the payloads and the gates.

export interface ServerEvent {
  event: string
  distinct_id: string
  uuid: string
  /** ISO time of the business moment, when the row records one. */
  timestamp?: string
  properties: Record<string, unknown>
}

export type SendServerEvent = (event: ServerEvent) => void

export type WebEventSource = 'webhooks' | 'poster-web'

/** Surface values. The app's own surfaces never use these. */
export const WEB_CHECKOUT_SURFACE = 'web_checkout'
export const WEB_POSTER_PAGE_SURFACE = 'web_poster_page'

// Fixed namespace for these event uuids (UUIDv5). Changing it would change
// every uuid and break deduplication against events already sent.
const EVENT_UUID_NAMESPACE = '5d0c8f2e-6b1a-4c3e-9f47-2a8b3e6d1c90'

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * RFC 4122 version 5 uuid of `name`: the same name always gives the same id.
 * Uses Web Crypto, which Deno and Node both provide.
 */
export async function deterministicEventUuid(name: string): Promise<string> {
  const ns = uuidBytes(EVENT_UUID_NAMESPACE)
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(ns.length + nameBytes.length)
  input.set(ns, 0)
  input.set(nameBytes, ns.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  const b = hash.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

function amountOf(value: unknown): number | null {
  const n = Number(value)
  return value == null || Number.isNaN(n) ? null : n
}

// ── bounty_published ─────────────────────────────────────────────────────────

export interface PublishedBountyRow {
  id: string
  poster_id?: string | null
  user_id?: string | null
  amount?: unknown
  category?: string | null
  funding_mode?: string | null
  created_at?: string | null
}

/** null when the row has no id or no owner: nothing to attribute it to. */
export async function buildWebBountyPublishedEvent(
  bounty: PublishedBountyRow | null | undefined,
  source: WebEventSource
): Promise<ServerEvent | null> {
  const posterId = bounty?.poster_id ?? bounty?.user_id ?? null
  if (!bounty?.id || !posterId) return null
  return {
    event: 'bounty_published',
    distinct_id: posterId,
    uuid: await deterministicEventUuid(`bounty_published:${bounty.id}`),
    timestamp: isoOrUndefined(bounty.created_at),
    properties: {
      role: 'poster',
      bounty_id: bounty.id,
      amount: amountOf(bounty.amount),
      category: bounty.category ?? null,
      funding_mode: bounty.funding_mode ?? null,
      surface: WEB_CHECKOUT_SURFACE,
      source,
    },
  }
}

const READ_TIMEOUT_MS = 3000

/**
 * Sends bounty_published for a bounty a web flow just created. Only when the
 * creating call reports a first creation (`created === true`), never on a
 * replay, and only after reading the bounty row back, so the event cannot
 * exist without the row. Never throws: analytics must not change what the
 * webhook or the page returns.
 */
export async function sendWebBountyPublished(args: {
  // deno-lint-ignore no-explicit-any
  supabase: any
  bountyId: string | null | undefined
  created: unknown
  source: WebEventSource
  send: SendServerEvent
}): Promise<'sent' | 'skipped' | 'error'> {
  const { supabase, bountyId, created, source, send } = args
  if (created !== true || !bountyId) return 'skipped'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = supabase
      .from('bounties')
      .select('id, poster_id, user_id, amount, category, funding_mode, created_at')
      .eq('id', bountyId)
      .maybeSingle()
    const { data, error } = (await Promise.race([
      Promise.resolve(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('read_timeout')), READ_TIMEOUT_MS)
      }),
    ])) as { data: PublishedBountyRow | null; error: { code?: string } | null }
    clearTimeout(timer)
    if (error || !data) {
      console.warn('[web-marketplace-events] bounty_published skipped: bounty not readable', { bountyId, code: error?.code })
      return 'error'
    }
    const event = await buildWebBountyPublishedEvent(data, source)
    if (!event) return 'skipped'
    send(event)
    return 'sent'
  } catch (err) {
    clearTimeout(timer)
    console.warn('[web-marketplace-events] bounty_published not sent', { bountyId, err: String(err) })
    return 'error'
  }
}

// ── application_accepted ─────────────────────────────────────────────────────

/**
 * Same property names as the app (hooks/useAcceptRequest.ts). null unless
 * this call's outcome is 'accepted': 'already_accepted' (a repeat click) and
 * every failure send nothing.
 */
export async function buildWebApplicationAcceptedEvent(args: {
  outcome: string
  posterId: string
  bounty: { id: string; amount?: unknown; is_for_honor?: boolean | null }
  request: { id: string; hunter_id?: string | null } | null
}): Promise<ServerEvent | null> {
  const { outcome, posterId, bounty, request } = args
  if (outcome !== 'accepted' || !request?.id || !bounty?.id || !posterId) return null
  return {
    event: 'application_accepted',
    distinct_id: posterId,
    uuid: await deterministicEventUuid(`application_accepted:${request.id}`),
    properties: {
      role: 'poster',
      bounty_id: bounty.id,
      application_id: request.id,
      hunter_id: request.hunter_id ?? null,
      is_for_honor: bounty.is_for_honor === true,
      amount: amountOf(bounty.amount),
      surface: WEB_POSTER_PAGE_SURFACE,
      source: 'poster-web',
    },
  }
}

// ── bounty_completed ─────────────────────────────────────────────────────────

/**
 * null unless this call itself moved the bounty to completed (the guarded
 * UPDATE ... WHERE status = 'in_progress' returned the row). An already
 * complete bounty, a release that is still on its way, a blocked payout and
 * every failure send nothing.
 */
export async function buildWebBountyCompletedEvent(args: {
  completedByThisCall: boolean
  posterId: string
  bounty: { id: string; amount?: unknown; is_for_honor?: boolean | null }
  completedAt?: string
}): Promise<ServerEvent | null> {
  const { completedByThisCall, posterId, bounty, completedAt } = args
  if (!completedByThisCall || !bounty?.id || !posterId) return null
  return {
    event: 'bounty_completed',
    distinct_id: posterId,
    uuid: await deterministicEventUuid(`bounty_completed:${bounty.id}`),
    timestamp: isoOrUndefined(completedAt),
    properties: {
      bounty_id: bounty.id,
      amount: amountOf(bounty.amount),
      isForHonor: bounty.is_for_honor === true,
      via: 'web_confirm',
      surface: WEB_POSTER_PAGE_SURFACE,
      source: 'poster-web',
    },
  }
}
