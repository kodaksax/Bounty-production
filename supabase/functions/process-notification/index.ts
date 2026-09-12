// Supabase Edge Function: process-notification
// POST { id: '<outbox-uuid>' }
//
// Notification redesign (2026-07-25): channel decisions now come from
// notification_channel_preferences (category x channel) instead of the
// drifted notification_preferences table; quiet hours are checked before the
// push (and email) sends; email fan-out is dispatched via the dedicated
// send-notification-email function. See lib/config/notification-taxonomy.ts
// for the client-side mirror of TYPE_CATEGORY/URGENT_TYPES below — keep both
// in sync by hand, since Deno's bundler can't import from lib/.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Inlined from ./message (local imports are not supported by the Supabase bundler)
function createExpoMessage(to: string, opts: { title?: string; body?: string; data?: any; sound?: string } = {}) {
  const { title = '', body = '', data = {}, sound = 'default' } = opts
  return { to, title, body, data, sound }
}
function createMessages(tokens: string[], opts?: { title?: string; body?: string; data?: any; sound?: string }) {
  return (tokens || []).map(t => createExpoMessage(t, opts))
}

// Inlined from ./push-delivery-diagnostics
const MAX_LOGGED_RECIPIENTS = 20
function buildZeroTokenWarning(params: {
  notificationId: unknown
  notificationType: unknown
  pushRecipients: string[]
}) {
  const recipients = params.pushRecipients ?? []
  return {
    notificationId: String(params.notificationId ?? 'unknown'),
    notificationType: String(params.notificationType || 'unknown'),
    recipientCount: recipients.length,
    recipients: recipients.slice(0, MAX_LOGGED_RECIPIENTS),
    truncated: recipients.length > MAX_LOGGED_RECIPIENTS,
  }
}

// Inlined from ./recipients
function normalizeRecipients(raw: any): string[] {
  let recipients: string[] = []
  try {
    if (raw == null) {
      recipients = []
    } else if (Array.isArray(raw)) {
      recipients = raw.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          recipients = parsed.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
        } else if (typeof parsed === 'string' && parsed.trim()) {
          recipients = [parsed.trim()]
        }
      } catch (_e) {
        if (raw.trim()) recipients = [raw.trim()]
      }
    } else if (typeof raw === 'object') {
      if (Array.isArray((raw as any).ids)) {
        recipients = (raw as any).ids.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
      } else {
        const values = Object.values(raw as Record<string, unknown>)
        recipients = values
          .filter((v) => typeof v === 'string' && (v as string).trim())
          .map((v) => (v as string).trim())
      }
    }
  } catch (_e) {
    recipients = []
  }
  return recipients
}

// ---------------------------------------------------------------------------
// Category taxonomy (mirror of lib/config/notification-taxonomy.ts)
// ---------------------------------------------------------------------------
type Category = 'marketplace' | 'messages' | 'payments' | 'security' | 'verification' | 'followers' | 'marketing'

const TYPE_CATEGORY: Record<string, Category> = {
  application: 'marketplace', acceptance: 'marketplace', completion: 'marketplace',
  cancellation_request: 'marketplace', cancellation_accepted: 'marketplace', cancellation_rejected: 'marketplace',
  stale_bounty: 'marketplace', stale_bounty_cancelled: 'marketplace', stale_bounty_reposted: 'marketplace',
  update: 'marketplace', bounty_nearby: 'marketplace', bounty_expiry: 'marketplace', review_needed: 'marketplace',
  bounty_quality_nudge: 'marketplace',
  message: 'messages',
  payment: 'payments', payout_paid: 'payments', payout_failed: 'payments', payout_canceled: 'payments',
  withdrawal_reversed: 'payments', bank_disconnected: 'payments', payout_method_changed: 'payments',
  balance_update: 'payments',
  dispute_created: 'security', dispute_resolved: 'security', workflow_dispute_created: 'security',
  dispute_escalated: 'security', account_warning: 'security', account_restricted: 'security',
  // Operator-facing payment-integrity page (Phase 4). 'security' is deliberate,
  // not a workaround: it is the only category whose push and in-app channels
  // cannot be switched off (isForcedChannel) and which bypasses quiet hours
  // (isUrgent). Under the default 'marketplace' fallback this alert would be
  // user-disableable and suppressed overnight — a page that waits until 8am is
  // not a page. Only ever addressed to admin accounts.
  reconciliation_alert: 'security',
  // Daily informational digest of warning/info findings. 'payments' (non-security)
  // so delivery is not forced and quiet hours apply.
  reconciliation_digest: 'payments',
  verification_submitted: 'verification', verification_verified: 'verification',
  verification_rejected: 'verification', verification_canceled: 'verification',
  follow: 'followers',
  marketing_promo: 'marketing',
}

function categoryForType(type: string): Category {
  return TYPE_CATEGORY[type] ?? 'marketplace'
}

// Types that bypass quiet hours (see notification-taxonomy.ts urgency table).
const URGENT_TYPES = new Set<string>([
  'dispute_created', 'dispute_resolved', 'workflow_dispute_created', 'dispute_escalated',
  'account_warning', 'account_restricted',
  'payout_failed', 'payout_canceled', 'withdrawal_reversed', 'bank_disconnected',
  'verification_rejected',
])

function isUrgent(type: string): boolean {
  // Every security-category type is urgent, even ones not individually listed above.
  return categoryForType(type) === 'security' || URGENT_TYPES.has(type)
}

// security/verification: push + in-app cannot be disabled by the user (account
// integrity notifications always deliver on those two channels; email stays
// user-controllable).
function isForcedChannel(category: Category, channel: string): boolean {
  return (category === 'security' || category === 'verification') && (channel === 'push' || channel === 'in_app')
}

function isChannelEnabled(
  prefMap: Map<string, boolean>,
  userId: string,
  channel: 'push' | 'email' | 'in_app',
  category: Category
): boolean {
  if (isForcedChannel(category, channel)) return true
  const key = `${userId}:${channel}`
  if (prefMap.has(key)) return prefMap.get(key) as boolean
  return true // row-absent = allow (fail open)
}

// Minutes-since-midnight comparison in the user's IANA timezone. Returns false
// (never blocks) if quiet hours aren't configured or the timezone is invalid —
// fail open rather than silently swallowing a notification because we don't
// know the user's local time.
function isInQuietHours(quietStart: number | null, quietEnd: number | null, tz: string | null): boolean {
  if (quietStart == null || quietEnd == null || !tz || quietStart === quietEnd) return false
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    })
    const parts = fmt.formatToParts(new Date())
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
    const minutesNow = hour * 60 + minute
    if (quietStart < quietEnd) return minutesNow >= quietStart && minutesNow < quietEnd
    return minutesNow >= quietStart || minutesNow < quietEnd // wraps midnight
  } catch (_e) {
    return false
  }
}

// Data-key normalization: the DB trigger functions (handle_new_message_notification,
// handle_bounty_request_notification, etc.) write snake_case keys into
// notifications_outbox.data (bounty_id, sender_id, conversation_id, hunter_id...),
// but every application-code notification producer (webhooks/index.ts,
// dispute-service.ts's send_system_notification calls) and the ENTIRE client-side
// notification-tap/deep-link logic (lib/services/notification-deep-links.ts,
// lib/types.ts's Notification.data) use camelCase. This meant notification taps
// for messages/applications/acceptances — the highest-volume notification types —
// never actually matched any deep-link case and silently went nowhere. Fixing this
// once here (rather than in every trigger) covers every current and future producer.
// Additive only: original snake_case keys are preserved alongside the alias.
const SNAKE_TO_CAMEL_DATA_KEYS: Record<string, string> = {
  bounty_id: 'bountyId',
  sender_id: 'senderId',
  conversation_id: 'conversationId',
  hunter_id: 'hunterId',
  follower_id: 'followerId',
  message_id: 'messageId',
  cancellation_id: 'cancellationId',
  request_id: 'requestId',
}
function normalizeDataKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL_DATA_KEYS)) {
    if (out[snake] !== undefined && out[camel] === undefined) out[camel] = out[snake]
  }
  return out
}

// Inlined from ./push-receipts
const PERMANENT_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials'])
function extractInvalidTokens(chunkTokens: string[], expoResponseBody: unknown): string[] {
  const tickets = (expoResponseBody as { data?: unknown })?.data
  if (!Array.isArray(tickets)) return []
  const invalid: string[] = []
  tickets.forEach((ticket: unknown, index: number) => {
    const t = ticket as { status?: string; details?: { error?: string } } | null
    if (t && t.status === 'error') {
      const errorCode = t.details?.error
      if (errorCode && PERMANENT_TOKEN_ERRORS.has(errorCode) && chunkTokens[index]) {
        invalid.push(chunkTokens[index])
      }
    }
  })
  return invalid
}

// PostHog delivery-funnel instrumentation (notification_generated/sent/failed).
// Same HTTP capture pattern as process-analytics-person/index.ts. Every event
// for a single outbox-row invocation is queued (see `posthogEvents` in the
// handler) and flushed as ONE batch call via schedulePostHogCapture below,
// rather than one HTTP request per outcome type -- a row can fan out to
// dozens/hundreds of recipients, and separate requests per branch would
// multiply network overhead for no benefit. Best-effort: a PostHog outage
// must never affect notification delivery.
async function capturePostHogEvents(
  events: Array<{ event: string; distinct_id: string; properties?: Record<string, unknown> }>
): Promise<void> {
  if (events.length === 0) return
  const posthogKey = Deno.env.get('POSTHOG_PROJECT_API_KEY')
  if (!posthogKey) return
  try {
    const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com'
    // Short timeout: this is background/best-effort telemetry, not something
    // the caller should ever wait meaningfully long for.
    await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3_000),
      body: JSON.stringify({
        api_key: posthogKey,
        batch: events.map((e) => ({
          event: e.event,
          distinct_id: e.distinct_id,
          properties: { ...e.properties, source: 'process-notification' },
          timestamp: new Date().toISOString(),
        })),
      }),
    })
  } catch (e) {
    console.error('[process-notification] PostHog capture failed (non-fatal)', e)
  }
}

// Fire-and-forget: schedules the capture without the caller awaiting network
// latency to PostHog. EdgeRuntime.waitUntil is the Supabase/Deno Edge Runtime's
// supported mechanism for background work that keeps running after the
// response is returned -- used when available so the task reliably completes;
// falls back to a detached, un-awaited call otherwise (still best-effort).
function schedulePostHogCapture(
  events: Array<{ event: string; distinct_id: string; properties?: Record<string, unknown> }>
): void {
  if (events.length === 0) return
  const task = capturePostHogEvents(events)
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(task)
  } else {
    task.catch(() => {})
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitizeUuid(value: unknown): string {
  const text = String(value ?? '').trim()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(text)) throw new Error('Invalid UUID')
  return text
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Track the outbox id and supabase client so the top-level catch can record
  // the failure reason on the row instead of swallowing it as an opaque 500.
  let supabaseAdmin: SupabaseClient | null = null
  let outboxId: string | null = null
  let outboxAttempts = 0

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500)

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (req.method !== 'POST') return jsonResponse({ error: 'Invalid method' }, 405)

    let payload: any
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    // Support both direct {id} and Supabase Webhook {record: {id}} formats
    const id = sanitizeUuid(payload.record?.id || payload.id);
    outboxId = id;

    // Fetch outbox row
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('notifications_outbox')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) {
      console.error('[process-notification] fetch error', fetchErr)
      let nextAttempts = outboxAttempts + 1
      const { data: attemptsRow, error: attemptsErr } = await supabaseAdmin
        .from('notifications_outbox')
        .select('attempts')
        .eq('id', id)
        .maybeSingle()
      if (attemptsErr) {
        console.error('[process-notification] failed to refresh attempts after fetch error', attemptsErr)
      } else if (attemptsRow && typeof attemptsRow.attempts === 'number') {
        nextAttempts = attemptsRow.attempts + 1
      }
      const { error: markFailedErr } = await supabaseAdmin
        .from('notifications_outbox')
        .update({ status: 'failed', last_error: String(fetchErr), attempts: nextAttempts })
        .eq('id', id)
      if (markFailedErr) {
        console.error('[process-notification] failed to mark outbox row failed after fetch error', markFailedErr)
      }
      return jsonResponse({ error: 'Failed to fetch outbox item' }, 500)
    }

    if (!rows) return jsonResponse({ error: 'Outbox item not found' }, 404)

    outboxAttempts = typeof rows.attempts === 'number' ? rows.attempts : 0

    if (rows.status === 'sent') return jsonResponse({ message: 'Already processed' })

    const recipients = normalizeRecipients(rows.recipients)
    if (recipients.length === 0) {
      // Mark as sent to avoid reprocessing
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent' }).eq('id', id)
      return jsonResponse({ message: 'No recipients, marked sent' })
    }

    // Determine the notification type/category from the outbox payload so we
    // can honor per-category-per-channel preferences and stamp the in-app row.
    const rawOutboxData: Record<string, unknown> = (rows.data && typeof rows.data === 'object') ? rows.data : {}
    const outboxData = normalizeDataKeys(rawOutboxData)
    const notificationType = typeof outboxData.type === 'string' ? outboxData.type : 'system'
    const category = categoryForType(notificationType)
    const urgent = isUrgent(notificationType)
    const bundleCount = typeof rows.count === 'number' && rows.count > 0 ? rows.count : 1
    // Set by callers (e.g. the Stripe webhook handler) that already inserted
    // the in-app `notifications` row themselves via their own idempotent
    // insert-then-update-on-conflict logic (keyed on stripe_payout_id etc.) —
    // this outbox row exists purely to trigger push/email fan-out without
    // creating a duplicate bell entry.
    const skipInApp = outboxData.skipInApp === true

    // Load channel preferences + quiet-hours settings for all recipients in
    // two batched queries. Missing rows default to "allow" / "no quiet hours".
    const prefMap = new Map<string, boolean>() // `${userId}:${channel}` -> enabled
    try {
      const { data: prefRows } = await supabaseAdmin
        .from('notification_channel_preferences')
        .select('user_id, channel, enabled')
        .in('user_id', recipients)
        .eq('category', category)
      for (const p of ((prefRows || []) as { user_id: string; channel: string; enabled: boolean }[])) {
        prefMap.set(`${p.user_id}:${p.channel}`, p.enabled)
      }
    } catch (e) {
      console.error('[process-notification] channel preference lookup failed (continuing with defaults)', e)
    }

    const quietHoursByUser = new Map<string, { start: number | null; end: number | null; tz: string | null }>()
    try {
      const { data: profileRows } = await supabaseAdmin
        .from('profiles')
        .select('id, quiet_hours_start, quiet_hours_end, notification_timezone')
        .in('id', recipients)
      for (const p of ((profileRows || []) as any[])) {
        quietHoursByUser.set(p.id, { start: p.quiet_hours_start, end: p.quiet_hours_end, tz: p.notification_timezone })
      }
    } catch (e) {
      console.error('[process-notification] quiet-hours lookup failed (continuing with quiet hours disabled)', e)
    }

    // Split recipients by channel based on preferences + (for push) quiet hours.
    const inAppRecipients: string[] = []
    const pushRecipients: string[] = []
    const emailRecipients: string[] = []
    for (const userId of recipients) {
      if (isChannelEnabled(prefMap, userId, 'in_app', category)) inAppRecipients.push(userId)

      if (isChannelEnabled(prefMap, userId, 'push', category)) {
        const qh = quietHoursByUser.get(userId)
        const blocked = !urgent && qh ? isInQuietHours(qh.start, qh.end, qh.tz) : false
        if (!blocked) pushRecipients.push(userId)
      }

      if (isChannelEnabled(prefMap, userId, 'email', category)) emailRecipients.push(userId)
    }

    // Every PostHog event for this single invocation is queued here and
    // flushed exactly once, in the background, right before each return --
    // see schedulePostHogCapture.
    const posthogEvents: Array<{ event: string; distinct_id: string; properties?: Record<string, unknown> }> = []

    // notification_generated: one event per recipient who will receive this
    // through at least one channel, listing which. Fired once per outbox row
    // per recipient regardless of retry (a retry only re-attempts delivery,
    // it doesn't regenerate the notification).
    if (rows.status === 'pending') {
      const channelsByUser = new Map<string, string[]>()
      for (const userId of inAppRecipients) channelsByUser.set(userId, [...(channelsByUser.get(userId) || []), 'in_app'])
      for (const userId of pushRecipients) channelsByUser.set(userId, [...(channelsByUser.get(userId) || []), 'push'])
      for (const userId of emailRecipients) channelsByUser.set(userId, [...(channelsByUser.get(userId) || []), 'email'])
      for (const [userId, channels] of channelsByUser.entries()) {
        posthogEvents.push({
          event: 'notification_generated',
          distinct_id: userId,
          properties: {
            notification_type: notificationType,
            category,
            bounty_id: outboxData.bountyId ?? null,
            channels,
            urgent,
          },
        })
      }
    }

    // Persist in-app notifications so the feed bell badge + list update for
    // every outbox-driven event (messages, applications, acceptances, etc.).
    // Guard on 'pending' so a retry of a previously-'failed' row does not
    // create duplicate bell entries (the rows were inserted on the first pass).
    if (!skipInApp && rows.status === 'pending' && inAppRecipients.length > 0) {
      const notificationRows = inAppRecipients.map((userId) => ({
        user_id: userId,
        type: notificationType,
        category,
        count: bundleCount,
        title: rows.title || '',
        body: rows.body || '',
        data: outboxData,
      }))
      const { error: insertErr } = await supabaseAdmin.from('notifications').insert(notificationRows)
      if (insertErr) {
        // Non-fatal for push delivery, but surface it for observability. As of
        // the 2026-07-25 CHECK-constraint migration this should no longer
        // silently drop known outbox types the way it previously did.
        console.error('[process-notification] failed to insert in-app notifications', insertErr)
      }
    }

    // Fire email fan-out (best-effort, does not block push delivery below).
    if (emailRecipients.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            userIds: emailRecipients,
            category,
            type: notificationType,
            title: rows.title || '',
            body: rows.body || '',
            data: outboxData,
          }),
        })
      } catch (e) {
        console.error('[process-notification] email fan-out request failed (non-fatal)', e)
      }
    }

    if (pushRecipients.length === 0) {
      // No one wants a push for this event; in-app rows (if any) are saved.
      schedulePostHogCapture(posthogEvents)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ message: 'In-app notifications saved; no push recipients', inApp: inAppRecipients.length })
    }

    // Fetch enabled tokens for push recipients, keeping the owning profile_id
    // so delivery outcomes can be attributed to the specific recipient rather
    // than reported for the whole pushRecipients set.
    const { data: tokens, error: tokenErr } = await supabaseAdmin
      .from('push_tokens')
      .select('profile_id, token')
      .in('profile_id', pushRecipients)
      .eq('enabled', true)

    if (tokenErr) {
      console.error('[process-notification] token lookup error', tokenErr)
      schedulePostHogCapture(posthogEvents)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: String(tokenErr), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ error: 'Failed to lookup tokens' }, 500)
    }

    const tokenRows = ((tokens || []) as { profile_id: string; token: string }[]).filter((r) => !!r.token && !!r.profile_id)
    // Positionally aligned: tokensList[i] belongs to tokenOwners[i]. Kept as
    // parallel arrays (not objects) because createMessages/extractInvalidTokens
    // already index by position.
    const tokensList = tokenRows.map((r) => r.token)
    const tokenOwners = tokenRows.map((r) => r.profile_id)

    // A recipient who wanted a push but has zero enabled tokens is a delivery
    // failure for THEM specifically, whether or not other recipients on the
    // same outbox row have deliverable devices.
    const recipientsWithToken = new Set(tokenOwners)
    const recipientsWithoutToken = pushRecipients.filter((userId) => !recipientsWithToken.has(userId))
    if (recipientsWithoutToken.length > 0) {
      // Absence of a deliverable token is otherwise indistinguishable from a
      // healthy send — the warning (and the notification_failed events below)
      // are the only signal that a delivery gap exists. Their absence is how
      // a push regression can run for months without surfacing anywhere.
      console.warn(
        '[process-notification] some push recipients have no deliverable token',
        buildZeroTokenWarning({ notificationId: id, notificationType, pushRecipients: recipientsWithoutToken })
      )
      for (const userId of recipientsWithoutToken) {
        posthogEvents.push({
          event: 'notification_failed',
          distinct_id: userId,
          properties: { notification_type: notificationType, category, reason: 'no_deliverable_token' },
        })
      }
    }

    if (tokensList.length === 0) {
      // Nobody has a deliverable token at all. The row is still marked
      // 'sent' below, because retrying cannot conjure a device.
      schedulePostHogCapture(posthogEvents)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ message: 'In-app notifications saved; no tokens for recipients', inApp: inAppRecipients.length })
    }

    // Build Expo messages, keeping them positionally aligned with tokensList so
    // we can map Expo error tickets back to the originating token (and, via
    // tokenOwners, the originating recipient).
    const messages = createMessages(tokensList, { title: rows.title || '', body: rows.body || '', data: outboxData, sound: 'default' })

    // Chunk and send directly to Expo Push API
    const chunkSize = 100
    const fetchImpl = fetch
    let sent = 0
    const errors: any[] = []
    const invalidTokens: string[] = []
    // Per-recipient outcome across all their tokens/chunks. A success on any
    // one device means the push was genuinely attempted-and-accepted for that
    // recipient, so 'sent' always wins over a 'failed' recorded for a
    // different (or earlier-processed) device of the same person.
    const outcomeByUser = new Map<string, 'sent' | 'failed'>()
    const markOutcome = (userId: string, outcome: 'sent' | 'failed') => {
      if (outcome === 'sent' || outcomeByUser.get(userId) !== 'sent') outcomeByUser.set(userId, outcome)
    }

    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize)
      const chunkTokens = tokensList.slice(i, i + chunkSize)
      const chunkOwners = tokenOwners.slice(i, i + chunkSize)
      try {
        const resp = await fetchImpl('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        })

        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          errors.push({ status: resp.status, body: text })
          for (const userId of chunkOwners) markOutcome(userId, 'failed')
          continue
        }

        // Inspect per-message tickets to detect dead tokens for pruning, and
        // to attribute this chunk's actual per-recipient outcome.
        const respBody = await resp.json().catch(() => null)
        const tickets = (respBody as { data?: unknown } | null)?.data
        if (Array.isArray(tickets)) {
          tickets.forEach((ticket: unknown, index: number) => {
            const owner = chunkOwners[index]
            if (!owner) return
            const isError = !!ticket && (ticket as { status?: string }).status === 'error'
            markOutcome(owner, isError ? 'failed' : 'sent')
          })
        } else {
          // Unexpected response shape from an otherwise-ok HTTP response —
          // no per-ticket detail to attribute, so treat the chunk as sent
          // rather than silently dropping its recipients from both funnels.
          for (const userId of chunkOwners) markOutcome(userId, 'sent')
        }
        for (const dead of extractInvalidTokens(chunkTokens, respBody)) {
          invalidTokens.push(dead)
        }

        sent += chunk.length
      } catch (e) {
        errors.push(String(e))
        for (const userId of chunkOwners) markOutcome(userId, 'failed')
      }
    }

    for (const [userId, outcome] of outcomeByUser.entries()) {
      posthogEvents.push(
        outcome === 'sent'
          ? {
              event: 'notification_sent',
              distinct_id: userId,
              properties: { notification_type: notificationType, category, channel: 'push', bounty_id: outboxData.bountyId ?? null },
            }
          : {
              event: 'notification_failed',
              distinct_id: userId,
              properties: { notification_type: notificationType, category, reason: 'push_send_error' },
            }
      )
    }

    // Disable tokens Expo reported as permanently undeliverable so future
    // sends skip them and deliverability metrics stay healthy.
    if (invalidTokens.length > 0) {
      try {
        await supabaseAdmin
          .from('push_tokens')
          .update({ enabled: false, last_failed_at: new Date().toISOString() })
          .in('token', invalidTokens)
      } catch (e) {
        console.error('[process-notification] failed to disable invalid tokens', e)
      }
    }

    if (errors.length > 0) {
      schedulePostHogCapture(posthogEvents)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: JSON.stringify(errors), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ ok: false, sent, errors, prunedTokens: invalidTokens.length }, 500)
    }

    await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)

    schedulePostHogCapture(posthogEvents)

    return jsonResponse({ ok: true, sent, inApp: inAppRecipients.length, prunedTokens: invalidTokens.length })
  } catch (error) {
    console.error('[process-notification] error', error)
    // Best-effort: persist the failure reason on the outbox row so the cause is
    // diagnosable in the DB instead of being lost as an opaque 500. Marks the row
    // 'failed' and bumps attempts, consistent with the Expo-delivery error path,
    // rather than leaving it stuck in 'pending' with no last_error.
    if (supabaseAdmin && outboxId) {
      try {
        const { error: markFailedErr } = await supabaseAdmin
          .from('notifications_outbox')
          .update({ status: 'failed', last_error: String(error), attempts: outboxAttempts + 1 })
          .eq('id', outboxId)
        if (markFailedErr) {
          console.error('[process-notification] failed to record error on outbox row', markFailedErr)
        }
      } catch (updateErr) {
        console.error('[process-notification] failed to record error on outbox row (exception)', updateErr)
      }
    }
    return jsonResponse({ error: String(error) }, 500)
  }
})
